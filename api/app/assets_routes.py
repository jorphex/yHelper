from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import _bounded_momentum_sql, _bounded_realized_apy_sql
from app.common import _market_filter_sql, _rank_gate_filter_sql, _resolve_universe_gate, _user_visible_filter_sql
from app.config import APY_MAX, APY_MIN, ASSETS_FEATURED_MIN_TVL_USD, DATABASE_URL
from app.models import AssetsResponse, AssetVaultsResponse

router = APIRouter()


@router.get("/api/assets", response_model=AssetsResponse)
def assets(
    universe: Literal["core", "extended", "raw"] = "core",
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"] = "all",
    token_scope: Literal["featured", "all"] = "featured",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
    sort_by: Literal["tvl", "spread", "vaults"] = "tvl",
    direction: Literal["asc", "desc"] = "desc",
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    rank_filter = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter}" if rank_filter else ""
    scope_clause = (
        "WHERE total_tvl_usd >= %(featured_min_tvl_usd)s AND vaults >= 2"
        if token_scope == "featured"
        else ""
    )
    order_map = {
        "tvl": "total_tvl_usd",
        "spread": "realized_spread_30d",
        "vaults": "vaults",
    }
    params: dict[str, object] = {
        "market": market,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "featured_min_tvl_usd": ASSETS_FEATURED_MIN_TVL_USD,
        "limit": limit,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    cte = f"""
        WITH filtered AS (
            SELECT
                COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
                d.chain_id,
                COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                {_bounded_realized_apy_sql()} AS realized_apy_30d
            FROM vault_dim d
            JOIN vault_metrics_latest m
              ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
            WHERE {_user_visible_filter_sql("d", include_retired=False)}
              AND COALESCE(d.token_symbol, '') <> ''
              AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
              AND COALESCE(m.points_count, 0) >= %(min_points)s
              AND {_market_filter_sql("d")}
              {rank_clause}
        ), aggregated AS (
            SELECT
                token_symbol,
                COUNT(*) AS vaults,
                COUNT(DISTINCT chain_id) AS chains,
                SUM(tvl_usd) AS total_tvl_usd,
                MAX(realized_apy_30d) AS best_realized_apy_30d,
                MIN(realized_apy_30d) AS worst_realized_apy_30d,
                MAX(realized_apy_30d) - MIN(realized_apy_30d) AS realized_spread_30d,
                CASE WHEN SUM(tvl_usd) FILTER (WHERE realized_apy_30d IS NOT NULL) > 0
                     THEN SUM(tvl_usd * realized_apy_30d) FILTER (WHERE realized_apy_30d IS NOT NULL)
                          / SUM(tvl_usd) FILTER (WHERE realized_apy_30d IS NOT NULL)
                     ELSE NULL END AS weighted_realized_apy_30d
            FROM filtered
            GROUP BY token_symbol
        ), scoped AS (
            SELECT * FROM aggregated {scope_clause}
        )
    """
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                cte
                + f"""
                SELECT * FROM scoped
                ORDER BY {order_map[sort_by]} {"ASC" if direction == "asc" else "DESC"} NULLS LAST,
                         total_tvl_usd DESC, token_symbol
                LIMIT %(limit)s
                """,
                params,
            )
            rows = cur.fetchall()
            cur.execute(
                cte
                + """
                SELECT COUNT(*) AS tokens, SUM(total_tvl_usd) AS total_tvl_usd,
                       SUM(vaults)::INT AS total_vaults
                FROM scoped
                """,
                params,
            )
            summary = cur.fetchone() or {}
    return {
        "identity": "exact_token_symbol",
        "filters": {
            "universe": universe,
            "market": market,
            "token_scope": token_scope,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "sort_by": sort_by,
            "direction": direction,
        },
        "realized_apy_policy": {"kind": "bounded", "min": APY_MIN, "max": APY_MAX},
        "summary": summary,
        "rows": rows,
    }


def _asset_vaults_response(
    token_symbol: str,
    universe: Literal["core", "extended", "raw"],
    min_tvl_usd: float | None,
    min_points: int | None,
    max_vaults: int | None,
    limit: int,
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    rank_filter = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter}" if rank_filter else ""
    params: dict[str, object] = {
        "token_symbol": token_symbol.strip(),
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    d.vault_address,
                    d.chain_id,
                    d.symbol,
                    d.tvl_usd,
                    d.est_apy,
                    {_bounded_realized_apy_sql()} AS realized_apy_30d,
                    {_bounded_momentum_sql()} AS momentum_7d_30d
                FROM vault_dim d
                JOIN vault_metrics_latest m
                  ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {_user_visible_filter_sql("d", include_retired=False)}
                  AND LOWER(COALESCE(d.token_symbol, '')) = LOWER(%(token_symbol)s)
                  AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
                  AND COALESCE(m.points_count, 0) >= %(min_points)s
                  {rank_clause}
                ORDER BY realized_apy_30d DESC NULLS LAST, d.tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            rows = cur.fetchall()
    total_tvl = sum(float(row.get("tvl_usd") or 0.0) for row in rows)
    realized_rows = [row for row in rows if row.get("realized_apy_30d") is not None]
    realized_weight = sum(float(row.get("tvl_usd") or 0.0) for row in realized_rows)
    values = [float(row["realized_apy_30d"]) for row in realized_rows]
    weighted = (
        sum(float(row.get("tvl_usd") or 0.0) * float(row["realized_apy_30d"]) for row in realized_rows)
        / realized_weight
        if realized_weight > 0
        else None
    )
    best = max(values) if values else None
    worst = min(values) if values else None
    return {
        "token_symbol": token_symbol.upper(),
        "identity": "exact_token_symbol",
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
        },
        "realized_apy_policy": {"kind": "bounded", "min": APY_MIN, "max": APY_MAX},
        "summary": {
            "vaults": len(rows),
            "chains": len({int(row["chain_id"]) for row in rows}),
            "total_tvl_usd": total_tvl,
            "best_realized_apy_30d": best,
            "worst_realized_apy_30d": worst,
            "realized_spread_30d": best - worst if best is not None and worst is not None else None,
            "weighted_realized_apy_30d": weighted,
        },
        "rows": rows,
    }


@router.get("/api/assets/{token_symbol:path}/vaults", response_model=AssetVaultsResponse)
def asset_vaults(
    token_symbol: str,
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
) -> dict[str, object]:
    return _asset_vaults_response(token_symbol, universe, min_tvl_usd, min_points, max_vaults, limit)
