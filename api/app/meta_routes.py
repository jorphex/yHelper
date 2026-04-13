from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import _bounded_metric_sql, _changes_base_cte, _compact_mover_rows, _fetch_change_movers
from app.common import _alias_realized_apy_fields, _alias_realized_coverage_fields, _user_visible_filter_sql
from app.config import APY_MAX, APY_MIN, DATABASE_URL, DEFAULT_MIN_POINTS, DEFAULT_MIN_TVL_USD
from app.meta_service import (
    _coverage_snapshot,
    _deduped_yearn_scope_snapshot,
    _freshness_snapshot,
    _live_social_preview_highest_vault,
    _protocol_context_snapshot,
    _tracked_scope_snapshot,
)

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/meta/freshness")
async def meta_freshness(
    threshold: Literal["24h", "7d", "30d"] = "24h",
    split_limit: int = Query(default=8, ge=1, le=25),
    min_tvl_usd: float = Query(default=DEFAULT_MIN_TVL_USD, ge=0.0),
) -> dict[str, object]:
    threshold_seconds = {"24h": 24 * 3600, "7d": 7 * 24 * 3600, "30d": 30 * 24 * 3600}[threshold]
    with psycopg.connect(DATABASE_URL) as conn:
        snapshot = _freshness_snapshot(
            conn,
            stale_threshold_seconds=threshold_seconds,
            split_limit=split_limit,
            min_tvl_usd=min_tvl_usd,
        )
    snapshot["threshold"] = threshold
    return snapshot


@router.get("/api/meta/coverage")
async def meta_coverage(
    min_tvl_usd: float = Query(default=DEFAULT_MIN_TVL_USD, ge=0.0),
    min_points: int = Query(default=DEFAULT_MIN_POINTS, ge=0),
    split_limit: int = Query(default=8, ge=1, le=25),
) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL) as conn:
        return _coverage_snapshot(conn, min_tvl_usd=min_tvl_usd, min_points=min_points, split_limit=split_limit)


@router.get("/api/meta/protocol-context")
async def meta_protocol_context() -> dict[str, object]:
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                current_yearn = _deduped_yearn_scope_snapshot(
                    cur,
                    include_hidden=False,
                    include_retired=False,
                    include_fantom=False,
                )
                total_yearn = _deduped_yearn_scope_snapshot(
                    cur,
                    include_hidden=True,
                    include_retired=True,
                    include_fantom=True,
                )
        return _protocol_context_snapshot(current_yearn=current_yearn, total_yearn=total_yearn)
    except Exception as exc:
        return {
            "source": "internal",
            "status": "unavailable",
            "as_of_utc": datetime.now(UTC).isoformat(),
            "error": str(exc),
        }


@router.get("/api/meta/movers")
async def meta_movers(
    window: Literal["24h", "7d", "30d"] = "7d",
    limit: int = Query(default=12, ge=1, le=50),
    min_tvl_usd: float = Query(default=100000.0, ge=0.0),
    min_points: int = Query(default=30, ge=0),
    include_freshness: bool = Query(default=False),
) -> dict[str, object]:
    window_seconds = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}[window]
    params = {
        "window_sec": window_seconds,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
    }
    base_cte = _changes_base_cte(max_vaults=None)
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                base_cte
                + """
                SELECT
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS tracked_vaults,
                    SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS tracked_tvl_usd,
                    AVG(n.safe_apy_window - n.safe_apy_prev_window) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS avg_delta_apy,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                        AND n.apy_prev_window_raw IS NOT NULL
                        AND (n.safe_apy_window - n.safe_apy_prev_window) > 0
                    ) AS positive_delta_count,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                        AND n.apy_prev_window_raw IS NOT NULL
                        AND (n.safe_apy_window - n.safe_apy_prev_window) < 0
                    ) AS negative_delta_count
                FROM normalized n
                """,
                params,
            )
            summary = cur.fetchone() or {}
            movers = _fetch_change_movers(cur, base_cte=base_cte, params=params, limit=limit)

        freshness = None
        if include_freshness:
            freshness = _freshness_snapshot(
                conn,
                stale_threshold_seconds=2 * window_seconds,
                split_limit=5,
                min_tvl_usd=min_tvl_usd,
            )

    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "filters": {
            "window": window,
            "window_seconds": window_seconds,
            "limit": limit,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
            "include_freshness": include_freshness,
        },
        "summary": summary,
        "movers": {
            "risers": _compact_mover_rows(movers["risers"]),
            "fallers": _compact_mover_rows(movers["fallers"]),
            "largest_abs_delta": _compact_mover_rows(movers["largest_abs_delta"]),
        },
        "freshness": freshness,
    }


@router.get("/api/meta/social-preview")
async def meta_social_preview() -> dict[str, object]:
    tracked_scope: dict[str, object] = {}
    highest_est_row = _live_social_preview_highest_vault()
    highest_realized_fallback_row: dict[str, object] = {}
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            tracked_scope = _tracked_scope_snapshot(cur)
            if not highest_est_row:
                cur.execute(
                    f"""
                    SELECT
                        a.vault_address,
                        a.name,
                        a.symbol,
                        a.chain_id,
                        a.tvl_usd,
                        {_bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")} AS safe_apy_30d
                    FROM vault_dim a
                    JOIN vault_metrics_latest m
                      ON m.chain_id = a.chain_id
                     AND m.vault_address = a.vault_address
                    WHERE m.apy_30d IS NOT NULL
                      AND {_user_visible_filter_sql("a", include_retired=False)}
                    ORDER BY safe_apy_30d DESC, COALESCE(a.tvl_usd, 0.0) DESC, a.vault_address
                    LIMIT 1
                    """,
                    {"apy_min": APY_MIN, "apy_max": APY_MAX},
                )
                highest_realized_fallback_row = cur.fetchone() or {}
                _alias_realized_apy_fields(highest_realized_fallback_row)
                if highest_realized_fallback_row:
                    highest_realized_fallback_row["source"] = "postgres_realized_fallback"
                    highest_realized_fallback_row["yield_kind"] = "realized_apy_30d"
    _alias_realized_coverage_fields(tracked_scope)
    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "filters": {
            "total_vaults_scope": "all rows in vault_dim",
            "active_vaults_scope": "active + non-retired + non-hidden vaults in vault_dim",
            "tracked_tvl_scope": "active + non-retired + non-hidden, debt-adjusted for single-strategy overlap",
            "highest_est_apy_scope": "live Kong REST user-visible multi-strategy v3 scope",
            "fallback_highest_realized_apy_scope": "Postgres user-visible scored-vault fallback, realized APY 30d",
            "highest_apy_scope": "legacy alias for highest_est_apy_scope",
            "exclude_retired": True,
            "exclude_hidden": True,
        },
        "summary": {
            "total_vaults": tracked_scope.get("total_vaults"),
            "active_vaults": tracked_scope.get("active_vaults"),
            "tracked_tvl_active_usd": tracked_scope.get("tracked_tvl_active_usd"),
            "active_with_metrics": tracked_scope.get("active_with_metrics"),
            "active_with_realized_apy": tracked_scope.get("active_with_metrics"),
        },
        "highest_est_apy_vault": highest_est_row or None,
        "highest_realized_apy_fallback_vault": highest_realized_fallback_row or None,
        "highest_apy_vault": highest_est_row or None,
    }
