from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import (
    _changes_base_cte,
    _composition_filtered_cte,
    _fetch_change_movers,
    _quality_score_sql,
    _regime_case_sql,
    _safe_apy_sql,
    _safe_momentum_sql,
)
from app.common import (
    _alias_realized_apy_fields,
    _alias_realized_apy_many,
    _alias_realized_coverage_fields,
    _apply_aliases_many,
    _raw_hidden_sql,
    _raw_highlighted_sql,
    _raw_migration_available_sql,
    _raw_retired_sql,
    _raw_risk_level_sql,
    _raw_strategies_count_sql,
    _rank_gate_filter_sql,
    _resolve_universe_gate,
    _to_float_or_none,
    _user_visible_filter_sql,
)
from app.config import APY_MAX, APY_MIN, DATABASE_URL
from app.meta_service import _freshness_snapshot

router = APIRouter()


@router.get("/api/discover")
async def discover(
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    chain_id: int | None = Query(default=None),
    category: str | None = Query(default=None),
    token_symbol: str | None = Query(default=None),
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    include_retired: bool = Query(default=False),
    migration_only: bool = Query(default=False),
    highlighted_only: bool = Query(default=False),
    sort_by: Literal["quality", "tvl", "est_apy", "apy_7d", "apy_30d", "momentum", "consistency"] = "tvl",
    direction: Literal["asc", "desc"] = "desc",
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    safe_momentum_sql = _safe_momentum_sql()
    retired_sql = _raw_retired_sql("d")
    highlighted_sql = _raw_highlighted_sql("d")
    migration_sql = _raw_migration_available_sql("d")
    risk_level_sql = _raw_risk_level_sql("d")
    strategies_count_sql = _raw_strategies_count_sql("d")
    order_map = {
        "quality": _quality_score_sql(),
        "tvl": "COALESCE(d.tvl_usd, 0.0)",
        "est_apy": "COALESCE(d.est_apy, -999999.0)",
        "apy_7d": "COALESCE(m.apy_7d, -999999.0)",
        "apy_30d": "COALESCE(m.apy_30d, -999999.0)",
        "momentum": f"COALESCE(({safe_momentum_sql}), -999999.0)",
        "consistency": "COALESCE(m.consistency_score, -999999.0)",
    }
    order_expr = order_map[sort_by]
    order_dir = "ASC" if direction == "asc" else "DESC"
    scope_filters = [
        _user_visible_filter_sql("d", include_retired=False),
        "COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s",
    ]
    params: dict[str, object] = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
        "offset": offset,
    }
    if migration_only:
        scope_filters.append(f"{migration_sql} = TRUE")
    if highlighted_only:
        scope_filters.append(f"{highlighted_sql} = TRUE")
    if chain_id is not None:
        scope_filters.append("d.chain_id = %(chain_id)s")
        params["chain_id"] = chain_id
    if category:
        scope_filters.append("LOWER(COALESCE(d.category, '')) = LOWER(%(category)s)")
        params["category"] = category
    if token_symbol:
        scope_filters.append("LOWER(COALESCE(d.token_symbol, '')) = LOWER(%(token_symbol)s)")
        params["token_symbol"] = token_symbol
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    if rank_filter_sql:
        scope_filters.append(rank_filter_sql)
        params["max_vaults"] = max_vaults

    filters = [*scope_filters, "COALESCE(m.points_count, 0) >= %(min_points)s"]
    scope_where_sql = " AND ".join(scope_filters)
    where_sql = " AND ".join(filters)
    regime_sql = _regime_case_sql()
    quality_sql = _quality_score_sql()
    safe_apy_sql = _safe_apy_sql()
    scoreable_apy_sql = "m.apy_30d IS NOT NULL"

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    COUNT(*) AS visible_vaults,
                    COUNT(*) FILTER (
                        WHERE {scoreable_apy_sql}
                          AND COALESCE(m.points_count, 0) >= %(min_points)s
                    ) AS with_metrics,
                    COUNT(*) FILTER (
                        WHERE m.vault_address IS NULL
                           OR (
                                COALESCE(m.points_count, 0) >= %(min_points)s
                                AND NOT ({scoreable_apy_sql})
                           )
                    ) AS missing_metrics,
                    COUNT(*) FILTER (
                        WHERE m.vault_address IS NOT NULL
                          AND COALESCE(m.points_count, 0) < %(min_points)s
                    ) AS low_points,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS visible_tvl_usd,
                    SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (
                        WHERE {scoreable_apy_sql}
                          AND COALESCE(m.points_count, 0) >= %(min_points)s
                    ) AS with_metrics_tvl_usd
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {scope_where_sql}
                """,
                params,
            )
            coverage = cur.fetchone() or {}

            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                """,
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT
                    COUNT(*) AS vaults,
                    COUNT(DISTINCT d.chain_id) AS chains,
                    COUNT(DISTINCT LOWER(COALESCE(d.token_symbol, ''))) FILTER (WHERE COALESCE(d.token_symbol, '') <> '') AS tokens,
                    COUNT(DISTINCT LOWER(COALESCE(d.category, ''))) FILTER (WHERE COALESCE(d.category, '') <> '') AS categories,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS total_tvl_usd,
                    AVG(d.est_apy) AS avg_est_apy,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.est_apy) AS median_est_apy,
                    AVG({safe_apy_sql}) AS avg_safe_apy_30d,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {safe_apy_sql}) AS median_safe_apy_30d,
                    AVG({safe_momentum_sql}) AS avg_momentum_7d_30d,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {safe_momentum_sql}) AS median_momentum_7d_30d,
                    AVG(m.consistency_score) AS avg_consistency_score,
                    COUNT(*) FILTER (WHERE {retired_sql} = TRUE) AS retired_vaults,
                    COUNT(*) FILTER (WHERE {highlighted_sql} = TRUE) AS highlighted_vaults,
                    COUNT(*) FILTER (WHERE {migration_sql} = TRUE) AS migration_ready_vaults,
                    AVG({strategies_count_sql})::DOUBLE PRECISION AS avg_strategies_per_vault,
                    CASE
                        WHEN SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (WHERE d.est_apy IS NOT NULL) > 0
                        THEN SUM(COALESCE(d.tvl_usd, 0.0) * d.est_apy) FILTER (WHERE d.est_apy IS NOT NULL)
                             / SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (WHERE d.est_apy IS NOT NULL)
                        ELSE NULL
                    END AS tvl_weighted_est_apy,
                    CASE
                        WHEN SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (WHERE {safe_apy_sql} IS NOT NULL) > 0
                        THEN SUM(COALESCE(d.tvl_usd, 0.0) * {safe_apy_sql}) FILTER (WHERE {safe_apy_sql} IS NOT NULL)
                             / SUM(COALESCE(d.tvl_usd, 0.0)) FILTER (WHERE {safe_apy_sql} IS NOT NULL)
                        ELSE NULL
                    END AS tvl_weighted_safe_apy_30d,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} < 0.0) AS apy_negative_vaults,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} >= 0.0 AND {safe_apy_sql} < 0.05) AS apy_low_vaults,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} >= 0.05 AND {safe_apy_sql} < 0.15) AS apy_mid_vaults,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} >= 0.15) AS apy_high_vaults
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                """,
                params,
            )
            summary = cur.fetchone() or {}

            cur.execute(
                f"""
                SELECT
                    {risk_level_sql} AS risk_level,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS tvl_usd
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                GROUP BY risk_level
                ORDER BY
                    CASE
                        WHEN {risk_level_sql} = '-1' THEN -1
                        WHEN {risk_level_sql} ~ '^[0-9]+$' THEN {risk_level_sql}::INT
                        ELSE 999
                    END,
                    tvl_usd DESC NULLS LAST
                LIMIT 8
                """,
                params,
            )
            risk_mix = cur.fetchall()

            cur.execute(
                f"""
                SELECT
                    {regime_sql} AS regime,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS tvl_usd
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                GROUP BY regime
                ORDER BY tvl_usd DESC NULLS LAST, vaults DESC
                LIMIT 8
                """,
                params,
            )
            regime_mix = cur.fetchall()

            cur.execute(
                f"""
                SELECT
                    d.vault_address,
                    d.chain_id,
                    d.name,
                    d.symbol,
                    d.category,
                    d.kind,
                    d.version,
                    d.token_symbol,
                    d.tvl_usd,
                    d.est_apy AS est_apy,
                    m.points_count,
                    m.last_point_time,
                    {risk_level_sql} AS risk_level,
                    {retired_sql} AS is_retired,
                    {highlighted_sql} AS is_highlighted,
                    {migration_sql} AS migration_available,
                    {strategies_count_sql} AS strategies_count,
                    m.apy_7d,
                    m.apy_30d,
                    m.apy_90d,
                    {safe_apy_sql} AS safe_apy_30d,
                    m.vol_30d,
                    {safe_momentum_sql} AS momentum_7d_30d,
                    m.consistency_score,
                    {quality_sql} AS quality_score,
                    {regime_sql} AS regime
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                ORDER BY {order_expr} {order_dir}, d.tvl_usd DESC
                LIMIT %(limit)s OFFSET %(offset)s
                """,
                params,
            )
            rows = cur.fetchall()

    visible_vaults = int(coverage.get("visible_vaults") or 0)
    with_metrics = int(coverage.get("with_metrics") or 0)
    low_points = int(coverage.get("low_points") or 0)
    missing_metrics = int(coverage.get("missing_metrics") or 0)
    coverage["missing_or_low_points"] = max(0, visible_vaults - with_metrics)
    coverage["coverage_ratio"] = (with_metrics / visible_vaults) if visible_vaults > 0 else None
    _alias_realized_apy_fields(summary)
    _alias_realized_coverage_fields(coverage)
    _alias_realized_apy_many(rows)

    return {
        "filters": {
            "universe": universe,
            "chain_id": chain_id,
            "category": category,
            "token_symbol": token_symbol,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "include_retired": include_retired,
            "migration_only": migration_only,
            "highlighted_only": highlighted_only,
            "sort_by": sort_by,
            "direction": direction,
        },
        "universe_gate": universe_gate,
        "pagination": {"limit": limit, "offset": offset, "total": total},
        "summary": summary,
        "coverage": {
            "visible_vaults": visible_vaults,
            "with_metrics": with_metrics,
            "with_realized_apy": with_metrics,
            "missing_metrics": missing_metrics,
            "low_points": low_points,
            "missing_or_low_points": coverage["missing_or_low_points"],
            "coverage_ratio": coverage["coverage_ratio"],
            "visible_tvl_usd": _to_float_or_none(coverage.get("visible_tvl_usd")),
            "with_metrics_tvl_usd": _to_float_or_none(coverage.get("with_metrics_tvl_usd")),
            "with_realized_apy_tvl_usd": _to_float_or_none(coverage.get("with_metrics_tvl_usd")),
        },
        "risk_mix": risk_mix,
        "regime_mix": regime_mix,
        "rows": rows,
    }


@router.get("/api/composition")
async def composition(
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    top_n: int = Query(default=12, ge=3, le=50),
    crowding_limit: int = Query(default=20, ge=1, le=80),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    params = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "top_n": top_n,
        "crowding_limit": crowding_limit,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    filtered_cte = _composition_filtered_cte(max_vaults=max_vaults)

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                filtered_cte
                + """
                SELECT
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS total_tvl_usd,
                    AVG(safe_apy_30d) AS avg_safe_apy_30d
                FROM filtered
                """,
                params,
            )
            summary = cur.fetchone() or {"vaults": 0, "total_tvl_usd": 0.0, "avg_safe_apy_30d": None}
            total_tvl = float(summary.get("total_tvl_usd") or 0.0)

            cur.execute(
                filtered_cte
                + """
                SELECT
                    chain_id,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    CASE
                        WHEN SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL) > 0
                        THEN SUM(tvl_usd * safe_apy_30d) FILTER (WHERE safe_apy_30d IS NOT NULL)
                             / SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS weighted_safe_apy_30d
                FROM filtered
                GROUP BY chain_id
                ORDER BY tvl_usd DESC
                LIMIT %(top_n)s
                """,
                params,
            )
            chains = cur.fetchall()

            cur.execute(
                filtered_cte
                + """
                SELECT
                    category,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    CASE
                        WHEN SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL) > 0
                        THEN SUM(tvl_usd * safe_apy_30d) FILTER (WHERE safe_apy_30d IS NOT NULL)
                             / SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS weighted_safe_apy_30d
                FROM filtered
                GROUP BY category
                ORDER BY tvl_usd DESC
                LIMIT %(top_n)s
                """,
                params,
            )
            categories = cur.fetchall()

            cur.execute(
                filtered_cte
                + """
                SELECT
                    token_symbol,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    CASE
                        WHEN SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL) > 0
                        THEN SUM(tvl_usd * safe_apy_30d) FILTER (WHERE safe_apy_30d IS NOT NULL)
                             / SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS weighted_safe_apy_30d
                FROM filtered
                GROUP BY token_symbol
                ORDER BY tvl_usd DESC
                LIMIT %(top_n)s
                """,
                params,
            )
            tokens = cur.fetchall()

            cur.execute(
                filtered_cte
                + """
                , chain_agg AS (
                    SELECT chain_id::TEXT AS grp, SUM(tvl_usd) AS tvl
                    FROM filtered
                    GROUP BY chain_id
                )
                , category_agg AS (
                    SELECT category AS grp, SUM(tvl_usd) AS tvl
                    FROM filtered
                    GROUP BY category
                )
                , token_agg AS (
                    SELECT token_symbol AS grp, SUM(tvl_usd) AS tvl
                    FROM filtered
                    GROUP BY token_symbol
                )
                SELECT
                    (SELECT SUM(POWER(c.tvl / NULLIF((SELECT SUM(tvl) FROM chain_agg), 0), 2)) FROM chain_agg c) AS chain_hhi,
                    (SELECT SUM(POWER(ca.tvl / NULLIF((SELECT SUM(tvl) FROM category_agg), 0), 2)) FROM category_agg ca) AS category_hhi,
                    (SELECT SUM(POWER(t.tvl / NULLIF((SELECT SUM(tvl) FROM token_agg), 0), 2)) FROM token_agg t) AS token_hhi
                """,
                params,
            )
            concentration = cur.fetchone() or {"chain_hhi": None, "category_hhi": None, "token_hhi": None}

            crowding_sql = (
                filtered_cte
                + """
                , scored AS (
                    SELECT
                        f.*,
                        LN(1 + f.tvl_usd) AS ln_tvl,
                        AVG(LN(1 + f.tvl_usd)) OVER () AS mean_ln_tvl,
                        STDDEV_SAMP(LN(1 + f.tvl_usd)) OVER () AS sd_ln_tvl,
                        AVG(f.safe_apy_30d) OVER () AS mean_apy,
                        STDDEV_SAMP(f.safe_apy_30d) OVER () AS sd_apy
                    FROM filtered f
                )
                SELECT
                    vault_address,
                    chain_id,
                    symbol,
                    token_symbol,
                    category,
                    tvl_usd,
                    safe_apy_30d,
                    momentum_7d_30d,
                    consistency_score,
                    COALESCE((ln_tvl - mean_ln_tvl) / NULLIF(sd_ln_tvl, 0), 0) AS z_tvl,
                    COALESCE((safe_apy_30d - mean_apy) / NULLIF(sd_apy, 0), 0) AS z_apy,
                    COALESCE((ln_tvl - mean_ln_tvl) / NULLIF(sd_ln_tvl, 0), 0)
                    - COALESCE((safe_apy_30d - mean_apy) / NULLIF(sd_apy, 0), 0) AS crowding_index
                FROM scored
                ORDER BY crowding_index {order_dir}, tvl_usd DESC
                LIMIT %(crowding_limit)s
                """
            )
            cur.execute(crowding_sql.format(order_dir="DESC"), params)
            crowded = cur.fetchall()
            cur.execute(crowding_sql.format(order_dir="ASC"), params)
            uncrowded = cur.fetchall()

    def _share(rows: list[dict]) -> list[dict]:
        if total_tvl <= 0:
            return rows
        for row in rows:
            row["share_tvl"] = float(row.get("tvl_usd") or 0.0) / total_tvl
        return rows

    _alias_realized_apy_fields(summary)
    _apply_aliases_many(chains, {"weighted_realized_apy_30d": "weighted_safe_apy_30d"})
    _apply_aliases_many(categories, {"weighted_realized_apy_30d": "weighted_safe_apy_30d"})
    _apply_aliases_many(tokens, {"weighted_realized_apy_30d": "weighted_safe_apy_30d"})
    _alias_realized_apy_many(crowded)
    _alias_realized_apy_many(uncrowded)

    return {
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "top_n": top_n,
            "crowding_limit": crowding_limit,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "concentration": concentration,
        "chains": _share(chains),
        "categories": _share(categories),
        "tokens": _share(tokens),
        "crowding": {"most_crowded": crowded, "least_crowded": uncrowded},
    }


@router.get("/api/changes")
async def changes(
    window: Literal["24h", "7d", "30d"] = "7d",
    stale_threshold: Literal["auto", "24h", "7d", "30d"] = "auto",
    limit: int = Query(default=20, ge=1, le=80),
    universe: Literal["core", "extended", "raw"] = "core",
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
    threshold_seconds_map = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}
    stale_threshold_seconds = (
        2 * window_seconds if stale_threshold == "auto" else threshold_seconds_map[stale_threshold]
    )
    params = {
        "window_sec": window_seconds,
        "stale_threshold_sec": stale_threshold_seconds,
        "limit": limit,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    base_cte = _changes_base_cte(max_vaults=max_vaults)
    regime_sql = _regime_case_sql("n")

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                base_cte
                + """
                SELECT
                    COUNT(*) AS vaults_eligible,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS vaults_with_change,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                        AND n.apy_prev_window_raw IS NOT NULL
                        AND n.age_seconds > %(stale_threshold_sec)s
                    ) AS stale_vaults,
                    SUM(COALESCE(n.tvl_usd, 0.0)) AS total_tvl_usd,
                    AVG(n.safe_apy_window) AS avg_safe_apy_window,
                    AVG(n.safe_apy_prev_window) AS avg_safe_apy_prev_window,
                    AVG(n.safe_apy_window - n.safe_apy_prev_window) AS avg_delta,
                    SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS tracked_tvl_usd,
                    SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                          AND n.apy_prev_window_raw IS NOT NULL
                          AND n.age_seconds > %(stale_threshold_sec)s
                    ) AS stale_tracked_tvl_usd
                FROM normalized n
                """,
                params,
            )
            summary = cur.fetchone() or {}

            cur.execute(
                base_cte
                + f"""
                SELECT
                    {regime_sql} AS regime,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(n.tvl_usd, 0.0)) AS tvl_usd
                FROM normalized n
                GROUP BY regime
                ORDER BY tvl_usd DESC NULLS LAST
                """,
                params,
            )
            regime_counts = cur.fetchall()

            movers = _fetch_change_movers(cur, base_cte=base_cte, params=params, limit=limit)

            cur.execute(
                base_cte
                + """
                SELECT
                    n.vault_address,
                    n.chain_id,
                    n.name,
                    n.symbol,
                    n.token_symbol,
                    n.category,
                    n.tvl_usd,
                    n.points_count,
                    n.last_point_time,
                    n.safe_apy_window,
                    n.safe_apy_prev_window,
                    (n.safe_apy_window - n.safe_apy_prev_window) AS delta_apy,
                    n.age_seconds
                FROM normalized n
                WHERE n.age_seconds > %(stale_threshold_sec)s
                ORDER BY n.age_seconds DESC, n.tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            stale = cur.fetchall()

            cur.execute(
                f"""
                SELECT
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS tvl_usd
                FROM vault_dim d
                WHERE
                    d.active = TRUE
                    AND COALESCE(d.chain_id, -1) NOT IN (250)
                    AND COALESCE(d.kind, '') IN ('Multi Strategy', 'Single Strategy')
                    AND {_raw_retired_sql('d')} = FALSE
                    AND {_raw_hidden_sql('d')} = FALSE
                """
            )
            yearn_scope = cur.fetchone() or {}
        freshness = _freshness_snapshot(
            conn,
            stale_threshold_seconds=stale_threshold_seconds,
            split_limit=8,
            min_tvl_usd=min_tvl_usd,
        )

    filtered_total_tvl = float(summary.get("total_tvl_usd") or 0.0)
    yearn_proxy_tvl = float(yearn_scope.get("tvl_usd") or 0.0)
    reference_tvl = {
        "yearn_aligned_proxy": {
            "vaults": int(yearn_scope.get("vaults") or 0),
            "tvl_usd": yearn_proxy_tvl if yearn_scope.get("tvl_usd") is not None else None,
            "criteria": {
                "active": True,
                "exclude_hidden": True,
                "exclude_retired": True,
                "kinds": ["Multi Strategy", "Single Strategy"],
            },
            "comparison_to_filtered_universe": {
                "filtered_total_tvl_usd": filtered_total_tvl if summary.get("total_tvl_usd") is not None else None,
                "gap_usd": (filtered_total_tvl - yearn_proxy_tvl)
                if summary.get("total_tvl_usd") is not None and yearn_scope.get("tvl_usd") is not None
                else None,
                "ratio": (filtered_total_tvl / yearn_proxy_tvl)
                if summary.get("total_tvl_usd") is not None and yearn_proxy_tvl > 0
                else None,
            },
        }
    }

    if freshness is not None:
        tracked = int(summary.get("vaults_with_change") or 0)
        stale_vaults = int(summary.get("stale_vaults") or 0)
        freshness["window_stale_vaults"] = stale_vaults
        freshness["window_tracked_vaults"] = tracked
        freshness["window_stale_ratio"] = (stale_vaults / tracked) if tracked > 0 else None
    _alias_realized_apy_fields(summary)
    _alias_realized_apy_many(movers.get("risers", []))
    _alias_realized_apy_many(movers.get("fallers", []))
    _alias_realized_apy_many(movers.get("largest_abs_delta", []))
    _alias_realized_apy_many(stale)

    return {
        "filters": {
            "universe": universe,
            "window": window,
            "stale_threshold": stale_threshold,
            "limit": limit,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "window_seconds": window_seconds,
            "stale_threshold_seconds": stale_threshold_seconds,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "reference_tvl": reference_tvl,
        "freshness": freshness,
        "regime_counts": regime_counts,
        "movers": movers,
        "stale": stale,
    }
