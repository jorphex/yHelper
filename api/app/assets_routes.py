from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import (
    _bounded_metric_sql,
    _quality_score_sql,
    _regime_case_sql,
    _safe_apy_sql,
    _safe_momentum_sql,
)
from app.common import (
    _alias_realized_apy_fields,
    _alias_realized_apy_many,
    _apply_aliases_many,
    _median,
    _rank_gate_filter_sql,
    _resolve_universe_gate,
    _to_float_or_none,
    _user_visible_filter_sql,
)
from app.config import (
    APY_MAX,
    APY_MIN,
    ASSETS_FEATURED_MIN_CHAINS,
    ASSETS_FEATURED_MIN_TVL_USD,
    ASSETS_FEATURED_MIN_VENUES,
    DATABASE_URL,
)

router = APIRouter()


@router.get("/api/assets")
async def assets(
    universe: Literal["core", "extended", "raw"] = "core",
    token_scope: Literal["featured", "canonical", "all"] = "featured",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
    sort_by: Literal["tvl", "spread", "best_apy", "best_est_apy", "venues"] = "tvl",
    direction: Literal["asc", "desc"] = "desc",
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    order_map = {
        "tvl": "total_tvl_usd",
        "spread": "spread_safe_apy_30d",
        "best_apy": "best_est_apy",
        "best_est_apy": "best_est_apy",
        "venues": "venues",
    }
    order_expr = order_map[sort_by]
    order_dir = "ASC" if direction == "asc" else "DESC"
    canonical_sort_by = "best_est_apy" if sort_by == "best_apy" else sort_by
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    token_type_sql = """
        CASE
            WHEN COALESCE(d.token_symbol, '') ~ '[-_/]' THEN 'structured'
            WHEN LOWER(COALESCE(d.token_symbol, '')) LIKE '%%curve%%' THEN 'structured'
            WHEN LOWER(COALESCE(d.token_symbol, '')) LIKE '%%pool%%' THEN 'structured'
            WHEN LOWER(COALESCE(d.token_symbol, '')) LIKE 'lp%%' THEN 'structured'
            WHEN LOWER(COALESCE(d.token_symbol, '')) LIKE '%%-lp%%' THEN 'structured'
            WHEN LENGTH(COALESCE(d.token_symbol, '')) > 14 THEN 'structured'
            ELSE 'canonical'
        END
    """
    tokens_cte = f"""
        WITH filtered AS (
            SELECT
                LOWER(COALESCE(d.token_symbol, '')) AS token_symbol_key,
                COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
                {token_type_sql} AS token_type,
                d.chain_id,
                COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                d.est_apy AS est_apy,
                {_bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")} AS safe_apy_30d
            FROM vault_dim d
            JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
            WHERE
                {_user_visible_filter_sql("d", include_retired=False)}
                AND COALESCE(d.token_symbol, '') <> ''
                AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
                AND COALESCE(m.points_count, 0) >= %(min_points)s
                {rank_clause}
        ),
        token_all AS (
            SELECT
                token_symbol_key,
                token_symbol,
                MAX(token_type) AS token_type
            FROM filtered
            GROUP BY token_symbol_key, token_symbol
        ),
        scoped_tokens AS (
            SELECT token_symbol_key, token_symbol, token_type
            FROM token_all
            WHERE %(token_scope)s = 'all' OR token_type = 'canonical'
        ),
        scoped AS (
            SELECT
                f.token_symbol_key,
                f.token_symbol,
                t.token_type,
                f.chain_id,
                f.tvl_usd,
                f.est_apy,
                f.safe_apy_30d
            FROM filtered f
            JOIN scoped_tokens t
              ON t.token_symbol_key = f.token_symbol_key
             AND t.token_symbol = f.token_symbol
        ),
        token_agg AS (
            SELECT
                token_symbol,
                token_type,
                COUNT(*) AS venues,
                COUNT(DISTINCT chain_id) AS chains,
                SUM(tvl_usd) AS total_tvl_usd,
                MAX(est_apy) AS best_est_apy,
                MAX(safe_apy_30d) AS best_safe_apy_30d,
                MIN(safe_apy_30d) AS worst_safe_apy_30d,
                MAX(safe_apy_30d) - MIN(safe_apy_30d) AS spread_safe_apy_30d,
                CASE
                    WHEN SUM(tvl_usd) FILTER (WHERE est_apy IS NOT NULL) > 0
                    THEN SUM(tvl_usd * est_apy) FILTER (WHERE est_apy IS NOT NULL)
                         / SUM(tvl_usd) FILTER (WHERE est_apy IS NOT NULL)
                    ELSE NULL
                END AS weighted_est_apy,
                CASE
                    WHEN SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL) > 0
                    THEN SUM(tvl_usd * safe_apy_30d) FILTER (WHERE safe_apy_30d IS NOT NULL)
                         / SUM(tvl_usd) FILTER (WHERE safe_apy_30d IS NOT NULL)
                    ELSE NULL
                END AS weighted_safe_apy_30d
            FROM scoped
            GROUP BY token_symbol_key, token_symbol, token_type
        ),
        final_tokens AS (
            SELECT *
            FROM token_agg
            WHERE
                %(token_scope)s <> 'featured'
                OR (
                    token_type = 'canonical'
                    AND total_tvl_usd >= %(featured_min_tvl_usd)s
                    AND venues >= %(featured_min_venues)s
                    AND chains >= %(featured_min_chains)s
                )
        )
    """
    sql_params = {
        "token_scope": token_scope,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "featured_min_tvl_usd": ASSETS_FEATURED_MIN_TVL_USD,
        "featured_min_venues": ASSETS_FEATURED_MIN_VENUES,
        "featured_min_chains": ASSETS_FEATURED_MIN_CHAINS,
    }
    if max_vaults is not None:
        sql_params["max_vaults"] = max_vaults

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                tokens_cte
                + """
                SELECT
                    token_symbol,
                    token_type,
                    venues,
                    chains,
                    total_tvl_usd,
                    best_est_apy,
                    best_safe_apy_30d,
                    worst_safe_apy_30d,
                    spread_safe_apy_30d,
                    weighted_est_apy,
                    weighted_safe_apy_30d
                FROM final_tokens
                ORDER BY {order_expr} {order_dir}, total_tvl_usd DESC
                LIMIT %(limit)s
                """.format(order_expr=order_expr, order_dir=order_dir),
                sql_params,
            )
            rows = cur.fetchall()

            cur.execute(
                tokens_cte
                + """
                SELECT
                    COUNT(*) AS tokens,
                    SUM(total_tvl_usd) AS total_tvl_usd,
                    SUM(venues) AS total_venues,
                    AVG(venues) AS avg_venues_per_token,
                    COUNT(*) FILTER (WHERE chains > 1) AS multi_chain_tokens,
                    COUNT(*) FILTER (WHERE spread_safe_apy_30d >= 0.02) AS high_spread_tokens,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY spread_safe_apy_30d) AS median_spread_safe_apy_30d,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY best_est_apy) AS median_best_est_apy,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY best_safe_apy_30d) AS median_best_safe_apy_30d,
                    CASE
                        WHEN SUM(total_tvl_usd) FILTER (WHERE weighted_est_apy IS NOT NULL) > 0
                        THEN SUM(total_tvl_usd * weighted_est_apy) FILTER (WHERE weighted_est_apy IS NOT NULL)
                             / SUM(total_tvl_usd) FILTER (WHERE weighted_est_apy IS NOT NULL)
                        ELSE NULL
                    END AS tvl_weighted_est_apy,
                    CASE
                        WHEN SUM(total_tvl_usd) FILTER (WHERE weighted_safe_apy_30d IS NOT NULL) > 0
                        THEN SUM(total_tvl_usd * weighted_safe_apy_30d) FILTER (WHERE weighted_safe_apy_30d IS NOT NULL)
                             / SUM(total_tvl_usd) FILTER (WHERE weighted_safe_apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS tvl_weighted_safe_apy_30d,
                    (SELECT token_symbol FROM final_tokens ORDER BY total_tvl_usd DESC NULLS LAST LIMIT 1) AS top_token_symbol,
                    (
                        SELECT MAX(total_tvl_usd) / NULLIF(SUM(total_tvl_usd), 0)
                        FROM final_tokens
                    ) AS top_token_tvl_share,
                    (SELECT COUNT(*) FROM token_all) AS tokens_available_all,
                    (SELECT COUNT(*) FROM token_all WHERE token_type = 'canonical') AS tokens_available_canonical,
                    (SELECT COUNT(*) FROM token_all WHERE token_type = 'structured') AS tokens_available_structured,
                    (
                        SELECT COUNT(*)
                        FROM token_agg
                        WHERE token_type = 'canonical'
                          AND total_tvl_usd >= %(featured_min_tvl_usd)s
                          AND venues >= %(featured_min_venues)s
                          AND chains >= %(featured_min_chains)s
                    ) AS tokens_available_featured
                FROM final_tokens
                """,
                sql_params,
            )
            summary = cur.fetchone() or {}

    total_tvl = float(summary.get("total_tvl_usd") or 0.0)
    for row in rows:
        tvl = float(row.get("total_tvl_usd") or 0.0)
        row["tvl_share"] = (tvl / total_tvl) if total_tvl > 0 else None
    _apply_aliases_many(
        rows,
        {
            "best_realized_apy_30d": "best_safe_apy_30d",
            "worst_realized_apy_30d": "worst_safe_apy_30d",
            "weighted_realized_apy_30d": "weighted_safe_apy_30d",
            "realized_spread_30d": "spread_safe_apy_30d",
        },
    )
    _alias_realized_apy_fields(summary)

    return {
        "filters": {
            "universe": universe,
            "token_scope": token_scope,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "limit": limit,
            "sort_by": canonical_sort_by,
            "direction": direction,
            "featured_min_tvl_usd": ASSETS_FEATURED_MIN_TVL_USD,
            "featured_min_venues": ASSETS_FEATURED_MIN_VENUES,
            "featured_min_chains": ASSETS_FEATURED_MIN_CHAINS,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "rows": rows,
    }


@router.get("/api/assets/{token_symbol:path}/venues")
async def asset_venues(
    token_symbol: str,
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    regime_sql = _regime_case_sql()
    quality_sql = _quality_score_sql()
    safe_apy_sql = _safe_apy_sql()
    safe_momentum_sql = _safe_momentum_sql()
    params = {
        "token_symbol": token_symbol.strip(),
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
    }
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    if max_vaults is not None:
        params["max_vaults"] = max_vaults

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
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
                    d.tvl_usd,
                    d.est_apy AS est_apy,
                    m.points_count,
                    m.last_point_time,
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
                JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE
                    {_user_visible_filter_sql("d", include_retired=False)}
                    AND LOWER(COALESCE(d.token_symbol, '')) = LOWER(%(token_symbol)s)
                    AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
                    AND COALESCE(m.points_count, 0) >= %(min_points)s
                    {rank_clause}
                ORDER BY d.est_apy DESC NULLS LAST, safe_apy_30d DESC NULLS LAST, d.tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            rows = cur.fetchall()

    total_tvl = sum(float(row.get("tvl_usd") or 0.0) for row in rows)
    weighted_est_apy = None
    est_apy_weight_tvl = sum(float(row.get("tvl_usd") or 0.0) for row in rows if row.get("est_apy") is not None)
    if est_apy_weight_tvl > 0:
        weighted_est_apy = (
            sum(
                float(row.get("tvl_usd") or 0.0) * float(row.get("est_apy"))
                for row in rows
                if row.get("est_apy") is not None
            )
            / est_apy_weight_tvl
        )
    weighted_safe_apy = None
    apy_weight_tvl = sum(float(row.get("tvl_usd") or 0.0) for row in rows if row.get("safe_apy_30d") is not None)
    if apy_weight_tvl > 0:
        weighted_safe_apy = (
            sum(
                float(row.get("tvl_usd") or 0.0) * float(row.get("safe_apy_30d"))
                for row in rows
                if row.get("safe_apy_30d") is not None
            )
            / apy_weight_tvl
        )

    est_apy_values = [float(row.get("est_apy")) for row in rows if row.get("est_apy") is not None]
    best_apy_values = [float(row.get("safe_apy_30d")) for row in rows if row.get("safe_apy_30d") is not None]

    summary = {
        "venues": len(rows),
        "chains": len({int(row["chain_id"]) for row in rows if row.get("chain_id") is not None}),
        "total_tvl_usd": total_tvl,
        "best_est_apy": max(est_apy_values) if est_apy_values else None,
        "weighted_est_apy": weighted_est_apy,
        "best_safe_apy_30d": max(best_apy_values) if best_apy_values else None,
        "worst_safe_apy_30d": min(best_apy_values) if best_apy_values else None,
        "weighted_safe_apy_30d": weighted_safe_apy,
        "best_venue_vault": rows[0]["vault_address"] if rows else None,
        "best_venue_symbol": rows[0]["symbol"] if rows else None,
    }
    best = summary["best_safe_apy_30d"]
    worst = summary["worst_safe_apy_30d"]
    summary["spread_safe_apy_30d"] = (best - worst) if best is not None and worst is not None else None
    apy_values = [float(row.get("safe_apy_30d")) for row in rows if row.get("safe_apy_30d") is not None]
    momentum_values = [float(row.get("momentum_7d_30d")) for row in rows if row.get("momentum_7d_30d") is not None]
    weighted_momentum_num = 0.0
    weighted_momentum_den = 0.0
    regime_counts: dict[str, int] = {}
    for row in rows:
        regime = str(row.get("regime") or "unknown")
        regime_counts[regime] = regime_counts.get(regime, 0) + 1
        tvl = float(row.get("tvl_usd") or 0.0)
        momentum = _to_float_or_none(row.get("momentum_7d_30d"))
        if momentum is not None and tvl > 0:
            weighted_momentum_num += tvl * momentum
            weighted_momentum_den += tvl
    summary["median_est_apy"] = _median(est_apy_values)
    summary["median_safe_apy_30d"] = _median(apy_values)
    summary["median_momentum_7d_30d"] = _median(momentum_values)
    summary["tvl_weighted_momentum_7d_30d"] = (
        weighted_momentum_num / weighted_momentum_den if weighted_momentum_den > 0 else None
    )
    summary["regime_counts"] = [{"regime": regime, "vaults": count} for regime, count in sorted(regime_counts.items())]
    _alias_realized_apy_many(rows)
    _alias_realized_apy_fields(summary)

    return {
        "token_symbol": token_symbol.upper(),
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "limit": limit,
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "rows": rows,
    }
