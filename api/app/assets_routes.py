from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import _bounded_momentum_sql, _bounded_realized_apy_sql
from app.common import _rank_gate_filter_sql, _resolve_universe_gate, _user_visible_filter_sql
from app.config import APY_MAX, APY_MIN, DATABASE_URL
from app.models import AssetVaultsResponse

router = APIRouter()


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
    realized_apy_sql = _bounded_realized_apy_sql()
    filtered_cte = f"""
        WITH filtered AS (
            SELECT
                d.vault_address,
                d.chain_id,
                d.symbol,
                d.tvl_usd,
                d.est_apy,
                {realized_apy_sql} AS realized_apy_30d,
                {_bounded_momentum_sql()} AS momentum_7d_30d
            FROM vault_dim d
            JOIN vault_metrics_latest m
              ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
            WHERE {_user_visible_filter_sql("d", include_retired=False)}
              AND LOWER(COALESCE(d.token_symbol, '')) = LOWER(%(token_symbol)s)
              AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
              AND COALESCE(m.points_count, 0) >= %(min_points)s
              {rank_clause}
        )
    """
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                filtered_cte
                + """
                SELECT
                    COUNT(*) AS vaults,
                    COUNT(DISTINCT chain_id) AS chains,
                    COALESCE(SUM(COALESCE(tvl_usd, 0.0)), 0.0) AS total_tvl_usd,
                    MAX(realized_apy_30d) AS best_realized_apy_30d,
                    MIN(realized_apy_30d) AS worst_realized_apy_30d,
                    MAX(realized_apy_30d) - MIN(realized_apy_30d) AS realized_spread_30d,
                    CASE
                        WHEN SUM(COALESCE(tvl_usd, 0.0)) FILTER (WHERE realized_apy_30d IS NOT NULL) > 0
                        THEN SUM(COALESCE(tvl_usd, 0.0) * realized_apy_30d)
                             FILTER (WHERE realized_apy_30d IS NOT NULL)
                             / SUM(COALESCE(tvl_usd, 0.0)) FILTER (WHERE realized_apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS weighted_realized_apy_30d
                FROM filtered
                """,
                params,
            )
            summary = cur.fetchone() or {}
            cur.execute(
                filtered_cte
                + """
                SELECT vault_address, chain_id, symbol, tvl_usd, est_apy,
                       realized_apy_30d, momentum_7d_30d
                FROM filtered
                ORDER BY realized_apy_30d DESC NULLS LAST, tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            rows = cur.fetchall()
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
        "summary": summary,
        "rows": rows,
    }


@router.get(
    "/api/assets/{token_symbol:path}/vaults",
    response_model=AssetVaultsResponse,
    deprecated=True,
    summary="List exact-symbol vaults (deprecated)",
    description=(
        "Compatibility endpoint for existing ySupport clients. New consumers should use "
        "GET /api/discover?token_symbol={symbol}, which is the canonical vault discovery contract."
    ),
)
def asset_vaults(
    token_symbol: str,
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
) -> dict[str, object]:
    return _asset_vaults_response(token_symbol, universe, min_tvl_usd, min_points, max_vaults, limit)
