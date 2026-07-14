from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.common import _market_filter_sql, _rank_gate_filter_sql, _resolve_universe_gate, _user_visible_filter_sql
from app.config import APY_MAX, APY_MIN, DAILY_APY_LOOKBACK_DAYS, DATABASE_URL
from app.models import TrendsResponse

router = APIRouter()


@router.get("/api/trends/daily", response_model=TrendsResponse)
def daily_trends(
    universe: Literal["core", "extended", "raw"] = "core",
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"] = "all",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    days: int = Query(default=60, ge=14, le=365),
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
        "days": days,
        "history_days": days + DAILY_APY_LOOKBACK_DAYS,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "market": market,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    sql = f"""
        WITH eligible AS (
            SELECT d.vault_address, d.chain_id, COALESCE(d.tvl_usd, 0.0) AS tvl_usd
            FROM vault_dim d
            JOIN vault_metrics_latest m
              ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
            WHERE {_user_visible_filter_sql("d", include_retired=False)}
              AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
              AND COALESCE(m.points_count, 0) >= %(min_points)s
              AND {_market_filter_sql("d")}
              {rank_clause}
        ), daily_ranked AS (
            SELECT
                e.vault_address,
                e.chain_id,
                e.tvl_usd,
                (to_timestamp(p.ts) AT TIME ZONE 'UTC')::date AS day,
                p.pps_raw,
                ROW_NUMBER() OVER (
                    PARTITION BY e.chain_id, e.vault_address,
                                 (to_timestamp(p.ts) AT TIME ZONE 'UTC')::date
                    ORDER BY p.ts DESC
                ) AS rn
            FROM pps_timeseries p
            JOIN eligible e ON e.chain_id = p.chain_id AND e.vault_address = p.vault_address
            WHERE p.ts >= EXTRACT(EPOCH FROM (
                (NOW() AT TIME ZONE 'UTC') - (%(history_days)s * INTERVAL '1 day')
            ))
        ), daily_latest AS (
            SELECT vault_address, chain_id, tvl_usd, day, pps_raw
            FROM daily_ranked
            WHERE rn = 1
        ), vault_daily AS (
            SELECT
                base.tvl_usd,
                base.day,
                CASE WHEN base.pps_raw > 0 AND anchor_7.pps_raw > 0 AND (base.day - anchor_7.day) > 0
                     THEN POWER(base.pps_raw / anchor_7.pps_raw, 365.0 / (base.day - anchor_7.day)) - 1
                     ELSE NULL END AS apy_7d_raw,
                CASE WHEN base.pps_raw > 0 AND anchor_30.pps_raw > 0 AND (base.day - anchor_30.day) > 0
                     THEN POWER(base.pps_raw / anchor_30.pps_raw, 365.0 / (base.day - anchor_30.day)) - 1
                     ELSE NULL END AS apy_30d_raw
            FROM daily_latest base
            LEFT JOIN LATERAL (
                SELECT prior.day, prior.pps_raw
                FROM daily_latest prior
                WHERE prior.chain_id = base.chain_id
                  AND prior.vault_address = base.vault_address
                  AND prior.day >= base.day - 7 AND prior.day < base.day
                ORDER BY prior.day ASC LIMIT 1
            ) anchor_7 ON TRUE
            LEFT JOIN LATERAL (
                SELECT prior.day, prior.pps_raw
                FROM daily_latest prior
                WHERE prior.chain_id = base.chain_id
                  AND prior.vault_address = base.vault_address
                  AND prior.day >= base.day - 30 AND prior.day < base.day
                ORDER BY prior.day ASC LIMIT 1
            ) anchor_30 ON TRUE
        ), bounded AS (
            SELECT
                tvl_usd,
                day,
                CASE WHEN apy_7d_raw IS NULL THEN NULL
                     ELSE LEAST(GREATEST(apy_7d_raw, %(apy_min)s), %(apy_max)s) END AS apy_7d,
                CASE WHEN apy_30d_raw IS NULL THEN NULL
                     ELSE LEAST(GREATEST(apy_30d_raw, %(apy_min)s), %(apy_max)s) END AS apy_30d
            FROM vault_daily
            WHERE day >= ((NOW() AT TIME ZONE 'UTC')::date - %(days)s)
        )
        SELECT
            day::text AS day,
            CASE WHEN SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL) > 0
                 THEN SUM(tvl_usd * apy_7d) FILTER (WHERE apy_7d IS NOT NULL)
                      / SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL)
                 ELSE NULL END AS weighted_apy_7d,
            CASE WHEN SUM(tvl_usd) FILTER (WHERE apy_30d IS NOT NULL) > 0
                 THEN SUM(tvl_usd * apy_30d) FILTER (WHERE apy_30d IS NOT NULL)
                      / SUM(tvl_usd) FILTER (WHERE apy_30d IS NOT NULL)
                 ELSE NULL END AS weighted_apy_30d,
            COUNT(*) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL AND apy_7d > apy_30d)::DOUBLE PRECISION
              / NULLIF(COUNT(*) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL), 0) AS riser_ratio
        FROM bounded
        GROUP BY day
        ORDER BY day
    """
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    return {
        "filters": {
            "universe": universe,
            "market": market,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "days": days,
        },
        "realized_apy_policy": {"kind": "bounded", "min": APY_MIN, "max": APY_MAX},
        "methodology": {
            "membership": "current_selected_vault_set",
            "weighting": "current_tvl_usd",
            "interpretation": "retrospective_yield_for_current_set",
        },
        "rows": rows,
    }
