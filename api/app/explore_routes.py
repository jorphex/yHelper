from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import (
    _bounded_momentum_sql,
    _bounded_realized_apy_sql,
    _changes_base_cte,
    _composition_filtered_cte,
    _fetch_change_movers,
)
from app.common import (
    _market_filter_sql,
    _market_group_sql,
    _rank_gate_filter_sql,
    _resolve_universe_gate,
    _user_visible_filter_sql,
)
from app.config import APY_MAX, APY_MIN, DATABASE_URL
from app.models import ChangesResponse, CompositionResponse, DiscoverResponse

router = APIRouter()


@router.get("/api/discover", response_model=DiscoverResponse)
def discover(
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    chain_id: int | None = Query(default=None),
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"] = "all",
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    sort_by: Literal["tvl", "est_apy", "apy_30d", "momentum"] = "tvl",
    direction: Literal["asc", "desc"] = "desc",
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    realized_apy_sql = _bounded_realized_apy_sql()
    momentum_sql = _bounded_momentum_sql()
    order_map = {
        "tvl": "COALESCE(d.tvl_usd, 0.0)",
        "est_apy": "COALESCE(d.est_apy, -999999.0)",
        "apy_30d": f"COALESCE({realized_apy_sql}, -999999.0)",
        "momentum": f"COALESCE({momentum_sql}, -999999.0)",
    }
    base_filters = [
        _user_visible_filter_sql("d", include_retired=False),
        "COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s",
        _market_filter_sql("d"),
    ]
    params: dict[str, object] = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
        "offset": offset,
        "market": market,
    }
    rank_filter = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    if rank_filter:
        base_filters.append(rank_filter)
        params["max_vaults"] = max_vaults
    base_where = " AND ".join(base_filters)
    eligible_where = f"{base_where} AND COALESCE(m.points_count, 0) >= %(min_points)s"
    selected_where = eligible_where
    if chain_id is not None:
        selected_where += " AND d.chain_id = %(chain_id)s"
        params["chain_id"] = chain_id

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    COUNT(*) AS visible_vaults,
                    COUNT(*) FILTER (
                        WHERE m.apy_30d IS NOT NULL AND COALESCE(m.points_count, 0) >= %(min_points)s
                    ) AS with_realized_apy,
                    COUNT(*) FILTER (
                        WHERE m.apy_30d IS NULL OR COALESCE(m.points_count, 0) < %(min_points)s
                    ) AS without_realized_apy
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m
                  ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {base_where}
                """,
                params,
            )
            coverage = cur.fetchone() or {}
            cur.execute(
                f"""
                SELECT d.chain_id, COUNT(*) AS vaults
                FROM vault_dim d
                JOIN vault_metrics_latest m
                  ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {eligible_where}
                GROUP BY d.chain_id
                ORDER BY SUM(COALESCE(d.tvl_usd, 0.0)) DESC, d.chain_id
                """,
                params,
            )
            chains = cur.fetchall()
            cur.execute(
                f"""
                SELECT
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS total_tvl_usd,
                    CASE
                        WHEN SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (WHERE m.apy_30d IS NOT NULL) > 0
                        THEN SUM(COALESCE(d.tvl_usd, 0.0) * {realized_apy_sql})
                             FILTER (WHERE m.apy_30d IS NOT NULL)
                             / SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (WHERE m.apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS tvl_weighted_realized_apy_30d
                FROM vault_dim d
                JOIN vault_metrics_latest m
                  ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {selected_where}
                """,
                params,
            )
            summary = cur.fetchone() or {}
            total = int(summary.pop("vaults", 0) or 0)
            cur.execute(
                f"""
                SELECT
                    d.vault_address,
                    d.chain_id,
                    d.symbol,
                    {_market_group_sql("d")} AS market,
                    d.tvl_usd,
                    d.est_apy,
                    {realized_apy_sql} AS realized_apy_30d,
                    {momentum_sql} AS momentum_7d_30d
                FROM vault_dim d
                JOIN vault_metrics_latest m
                  ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {selected_where}
                ORDER BY {order_map[sort_by]} {"ASC" if direction == "asc" else "DESC"}, d.tvl_usd DESC
                LIMIT %(limit)s OFFSET %(offset)s
                """,
                params,
            )
            rows = cur.fetchall()

    visible = int(coverage.get("visible_vaults") or 0)
    covered = int(coverage.get("with_realized_apy") or 0)
    return {
        "filters": {
            "universe": universe,
            "market": market,
            "chain_id": chain_id,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "sort_by": sort_by,
            "direction": direction,
        },
        "realized_apy_policy": {"kind": "bounded", "min": APY_MIN, "max": APY_MAX},
        "pagination": {"limit": limit, "offset": offset, "total": total},
        "summary": summary,
        "coverage": {
            "visible_vaults": visible,
            "with_realized_apy": covered,
            "coverage_ratio": covered / visible if visible else None,
            "without_realized_apy": int(coverage.get("without_realized_apy") or 0),
        },
        "facets": {"chains": chains},
        "rows": rows,
    }


@router.get("/api/composition", response_model=CompositionResponse)
def composition(
    universe: Literal["core", "extended", "raw"] = "core",
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"] = "all",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    top_n: int = Query(default=12, ge=3, le=50),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    params: dict[str, object] = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "top_n": top_n,
        "market": market,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    filtered_cte = _composition_filtered_cte(max_vaults=max_vaults, filter_market=True)

    def breakdown(cur: psycopg.Cursor, key_sql: str, key_alias: str) -> list[dict]:
        cur.execute(
            filtered_cte
            + f"""
            SELECT {key_sql} AS {key_alias}, COUNT(*) AS vaults, SUM(tvl_usd) AS tvl_usd
            FROM filtered
            GROUP BY {key_sql}
            ORDER BY tvl_usd DESC
            LIMIT %(top_n)s
            """,
            params,
        )
        return cur.fetchall()

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                filtered_cte + " SELECT COUNT(*) AS vaults, SUM(tvl_usd) AS total_tvl_usd FROM filtered",
                params,
            )
            summary = cur.fetchone() or {"vaults": 0, "total_tvl_usd": 0.0}
            chains = breakdown(cur, "chain_id", "chain_id")
            categories = breakdown(cur, "market", "category")
            tokens = breakdown(cur, "token_symbol", "token_symbol")
    total_tvl = float(summary.get("total_tvl_usd") or 0.0)
    for rows in (chains, categories, tokens):
        for row in rows:
            row["share_tvl"] = float(row.get("tvl_usd") or 0.0) / total_tvl if total_tvl else None
    return {
        "filters": {
            "universe": universe,
            "market": market,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
        },
        "summary": summary,
        "chains": chains,
        "categories": categories,
        "tokens": tokens,
    }


@router.get("/api/changes", response_model=ChangesResponse)
def changes(
    window: Literal["24h", "7d", "30d"] = "7d",
    stale_threshold: Literal["auto", "24h", "7d", "30d"] = "auto",
    limit: int = Query(default=20, ge=1, le=80),
    universe: Literal["core", "extended", "raw"] = "core",
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"] = "all",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    window_seconds = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}[window]
    threshold_seconds = {
        "auto": 2 * window_seconds,
        "24h": 86400,
        "7d": 7 * 86400,
        "30d": 30 * 86400,
    }[stale_threshold]
    params: dict[str, object] = {
        "window_sec": window_seconds,
        "stale_threshold_sec": threshold_seconds,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
        "market": market,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    base_cte = _changes_base_cte(max_vaults=max_vaults, filter_market=True)
    comparable = "n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL"

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                base_cte
                + f"""
                SELECT
                    COUNT(*) AS vaults_eligible,
                    COUNT(*) FILTER (WHERE {comparable}) AS vaults_with_change,
                    SUM(n.tvl_usd) FILTER (WHERE {comparable}) AS tracked_tvl_usd,
                    COUNT(*) FILTER (WHERE {comparable} AND n.realized_apy_window > n.realized_apy_prev_window) AS riser_vaults,
                    COUNT(*) FILTER (WHERE {comparable} AND n.realized_apy_window < n.realized_apy_prev_window) AS faller_vaults,
                    COUNT(*) FILTER (WHERE {comparable} AND n.realized_apy_window = n.realized_apy_prev_window) AS flat_vaults,
                    SUM(n.tvl_usd) FILTER (WHERE {comparable} AND n.realized_apy_window > n.realized_apy_prev_window) AS riser_tvl_usd,
                    SUM(n.tvl_usd) FILTER (WHERE {comparable} AND n.realized_apy_window < n.realized_apy_prev_window) AS faller_tvl_usd,
                    CASE WHEN SUM(n.tvl_usd) FILTER (WHERE {comparable}) > 0
                         THEN SUM(n.tvl_usd * (n.realized_apy_window - n.realized_apy_prev_window)) FILTER (WHERE {comparable})
                              / SUM(n.tvl_usd) FILTER (WHERE {comparable})
                         ELSE NULL END AS tvl_weighted_delta,
                    MIN(n.age_seconds) FILTER (WHERE {comparable}) AS newest_comparison_age_seconds,
                    COUNT(*) FILTER (WHERE {comparable} AND n.age_seconds > %(stale_threshold_sec)s) AS stale_comparisons
                FROM normalized n
                """,
                params,
            )
            summary = cur.fetchone() or {}
            movers = _fetch_change_movers(cur, base_cte=base_cte, params=params, limit=limit)
    tracked = int(summary.get("vaults_with_change") or 0)
    stale = int(summary.pop("stale_comparisons", 0) or 0)
    newest_age = summary.pop("newest_comparison_age_seconds", None)
    return {
        "window": {"name": window, "stale_after_seconds": threshold_seconds},
        "realized_apy_policy": {"kind": "bounded", "min": APY_MIN, "max": APY_MAX},
        "summary": summary,
        "freshness": {
            "newest_comparison_age_seconds": newest_age,
            "current_comparisons": max(0, tracked - stale),
            "tracked_comparisons": tracked,
        },
        "movers": movers,
    }
