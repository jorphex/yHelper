from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import _bounded_metric_sql
from app.common import (
    _apply_aliases,
    _apply_aliases_many,
    _delta_or_none,
    _median,
    _rank_gate_filter_sql,
    _resolve_universe_gate,
    _user_visible_filter_sql,
)
from app.config import APY_MAX, APY_MIN, DAILY_APY_LOOKBACK_DAYS, DATABASE_URL, MOMENTUM_ABS_MAX

router = APIRouter()


@router.get("/api/chains/rollups")
async def chains_rollups(
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    max_vaults: int | None = Query(default=None, ge=0),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=None, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    max_vaults = universe_gate["max_vaults"]
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    sql_params = {
        "min_tvl_usd": min_tvl_usd,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "momentum_min": -abs(MOMENTUM_ABS_MAX),
        "momentum_max": abs(MOMENTUM_ABS_MAX),
    }
    if max_vaults is not None:
        sql_params["max_vaults"] = max_vaults
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    d.chain_id,
                    COUNT(*) AS active_vaults,
                    COUNT(*) FILTER (WHERE m.apy_30d IS NOT NULL) AS with_metrics,
                    SUM(COALESCE(d.tvl_usd, 0)) AS total_tvl_usd,
                    CASE
                        WHEN SUM(COALESCE(d.tvl_usd, 0)) FILTER (WHERE m.apy_30d IS NOT NULL) > 0
                        THEN
                            SUM(
                                (
                                    COALESCE(d.tvl_usd, 0)
                                    *
                                    {_bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")}
                                )
                            ) FILTER (WHERE m.apy_30d IS NOT NULL)
                            /
                            SUM(COALESCE(d.tvl_usd, 0)) FILTER (WHERE m.apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS weighted_apy_30d,
                    AVG(
                        {_bounded_metric_sql("m.momentum_7d_30d", "%(momentum_min)s", "%(momentum_max)s")}
                    ) FILTER (WHERE m.momentum_7d_30d IS NOT NULL) AS avg_momentum_7d_30d,
                    AVG(m.consistency_score) FILTER (WHERE m.consistency_score IS NOT NULL) AS avg_consistency
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {_user_visible_filter_sql("d", include_retired=False)}
                  AND COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s
                  {rank_clause}
                GROUP BY d.chain_id
                ORDER BY total_tvl_usd DESC NULLS LAST
                """,
                sql_params,
            )
            rows = cur.fetchall()

    total_tvl = sum(float(row.get("total_tvl_usd") or 0.0) for row in rows)
    total_active = sum(int(row.get("active_vaults") or 0) for row in rows)
    total_with_metrics = sum(int(row.get("with_metrics") or 0) for row in rows)
    weighted_apy_num = 0.0
    weighted_apy_den = 0.0
    apy_values: list[float] = []
    top_chain: dict | None = None

    for row in rows:
        active_vaults = int(row.get("active_vaults") or 0)
        with_metrics = int(row.get("with_metrics") or 0)
        tvl = float(row.get("total_tvl_usd") or 0.0)
        apy = row.get("weighted_apy_30d")
        row["metrics_coverage_ratio"] = (with_metrics / active_vaults) if active_vaults > 0 else None
        row["tvl_share"] = (tvl / total_tvl) if total_tvl > 0 else None
        if apy is not None and tvl > 0:
            weighted_apy_num += tvl * float(apy)
            weighted_apy_den += tvl
            apy_values.append(float(apy))
        if top_chain is None or tvl > float(top_chain.get("total_tvl_usd") or 0.0):
            top_chain = row

    summary = {
        "chains": len(rows),
        "total_tvl_usd": total_tvl,
        "active_vaults": total_active,
        "with_metrics": total_with_metrics,
        "metrics_coverage_ratio": (total_with_metrics / total_active) if total_active > 0 else None,
        "tvl_weighted_apy_30d": (weighted_apy_num / weighted_apy_den) if weighted_apy_den > 0 else None,
        "median_chain_apy_30d": _median(apy_values),
        "tvl_hhi": sum(float(row.get("tvl_share") or 0.0) ** 2 for row in rows),
        "top_chain_id": top_chain.get("chain_id") if top_chain else None,
        "top_chain_tvl_share": top_chain.get("tvl_share") if top_chain else None,
    }
    _apply_aliases_many(
        rows,
        {
            "with_realized_apy": "with_metrics",
            "weighted_realized_apy_30d": "weighted_apy_30d",
        },
    )
    _apply_aliases(
        summary,
        {
            "with_realized_apy": "with_metrics",
            "tvl_weighted_realized_apy_30d": "tvl_weighted_apy_30d",
            "median_chain_realized_apy_30d": "median_chain_apy_30d",
        },
    )

    return {
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "max_vaults": max_vaults,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "rows": rows,
    }


@router.get("/api/trends/daily")
async def daily_trends(
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    chain_id: int | None = Query(default=None),
    group_by: Literal["none", "chain", "category"] = Query(default="none"),
    group_limit: int = Query(default=8, ge=2, le=30),
    days: int = Query(default=120, ge=14, le=365),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    chain_clause = "AND d.chain_id = %(chain_id)s" if chain_id is not None else ""

    params: dict[str, object] = {
        "days": days,
        "history_days": days + DAILY_APY_LOOKBACK_DAYS,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "group_limit": group_limit,
    }
    if chain_id is not None:
        params["chain_id"] = chain_id
    if max_vaults is not None:
        params["max_vaults"] = max_vaults

    daily_trends_cte = f"""
        WITH eligible AS (
            SELECT
                d.vault_address,
                d.chain_id,
                COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                COALESCE(d.tvl_usd, 0.0) AS tvl_usd
            FROM vault_dim d
            JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
            WHERE
                {_user_visible_filter_sql("d", include_retired=False)}
                AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
                AND COALESCE(m.points_count, 0) >= %(min_points)s
                {chain_clause}
                {rank_clause}
        ),
        daily_ranked AS (
            SELECT
                e.vault_address,
                e.chain_id,
                e.category,
                e.tvl_usd,
                (to_timestamp(p.ts) AT TIME ZONE 'UTC')::date AS day,
                p.ts,
                p.pps_raw,
                ROW_NUMBER() OVER (
                    PARTITION BY e.chain_id, e.vault_address, (to_timestamp(p.ts) AT TIME ZONE 'UTC')::date
                    ORDER BY p.ts DESC
                ) AS rn
            FROM pps_timeseries p
            JOIN eligible e ON e.chain_id = p.chain_id AND e.vault_address = p.vault_address
            WHERE p.ts >= EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - (%(history_days)s * INTERVAL '1 day')))
        ),
        daily_latest AS (
            SELECT
                vault_address,
                chain_id,
                category,
                tvl_usd,
                day,
                pps_raw
            FROM daily_ranked
            WHERE rn = 1
        ),
        calc AS (
            SELECT
                base.vault_address,
                base.chain_id,
                base.category,
                base.tvl_usd,
                base.day,
                base.pps_raw,
                anchor_7.day AS day_7d,
                anchor_7.pps_raw AS pps_7d,
                anchor_30.day AS day_30d,
                anchor_30.pps_raw AS pps_30d,
                anchor_90.day AS day_90d,
                anchor_90.pps_raw AS pps_90d
            FROM daily_latest base
            LEFT JOIN LATERAL (
                SELECT prior.day, prior.pps_raw
                FROM daily_latest prior
                WHERE prior.chain_id = base.chain_id
                  AND prior.vault_address = base.vault_address
                  AND prior.day >= base.day - 7
                  AND prior.day < base.day
                ORDER BY prior.day ASC
                LIMIT 1
            ) anchor_7 ON TRUE
            LEFT JOIN LATERAL (
                SELECT prior.day, prior.pps_raw
                FROM daily_latest prior
                WHERE prior.chain_id = base.chain_id
                  AND prior.vault_address = base.vault_address
                  AND prior.day >= base.day - 30
                  AND prior.day < base.day
                ORDER BY prior.day ASC
                LIMIT 1
            ) anchor_30 ON TRUE
            LEFT JOIN LATERAL (
                SELECT prior.day, prior.pps_raw
                FROM daily_latest prior
                WHERE prior.chain_id = base.chain_id
                  AND prior.vault_address = base.vault_address
                  AND prior.day >= base.day - 90
                  AND prior.day < base.day
                ORDER BY prior.day ASC
                LIMIT 1
            ) anchor_90 ON TRUE
        ),
        vault_daily AS (
            SELECT
                chain_id,
                category,
                tvl_usd,
                day,
                CASE
                    WHEN pps_raw > 0 AND pps_7d > 0 AND day_7d IS NOT NULL AND (day - day_7d) > 0
                    THEN POWER(pps_raw / pps_7d, 365.0 / NULLIF((day - day_7d), 0)) - 1
                    ELSE NULL
                END AS apy_7d_raw,
                CASE
                    WHEN pps_raw > 0 AND pps_30d > 0 AND day_30d IS NOT NULL AND (day - day_30d) > 0
                    THEN POWER(pps_raw / pps_30d, 365.0 / NULLIF((day - day_30d), 0)) - 1
                    ELSE NULL
                END AS apy_30d_raw,
                CASE
                    WHEN pps_raw > 0 AND pps_90d > 0 AND day_90d IS NOT NULL AND (day - day_90d) > 0
                    THEN POWER(pps_raw / pps_90d, 365.0 / NULLIF((day - day_90d), 0)) - 1
                    ELSE NULL
                END AS apy_90d_raw
            FROM calc
        ),
        trimmed AS (
            SELECT
                chain_id,
                category,
                tvl_usd,
                day,
                LEAST(GREATEST(apy_7d_raw, %(apy_min)s), %(apy_max)s) AS apy_7d,
                LEAST(GREATEST(apy_30d_raw, %(apy_min)s), %(apy_max)s) AS apy_30d,
                LEAST(GREATEST(apy_90d_raw, %(apy_min)s), %(apy_max)s) AS apy_90d
            FROM vault_daily
            WHERE day >= ((NOW() AT TIME ZONE 'UTC')::date - ((%(days)s::text || ' days')::interval))
        )
    """

    sql = (
        daily_trends_cte
        + """
        SELECT
            day::text AS day,
            COUNT(*) AS vaults,
            SUM(tvl_usd) AS total_tvl_usd,
            CASE
                WHEN SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL) > 0
                THEN SUM(tvl_usd * apy_7d) FILTER (WHERE apy_7d IS NOT NULL)
                     / SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL)
                ELSE NULL
            END AS weighted_apy_7d,
            CASE
                WHEN SUM(tvl_usd) FILTER (WHERE apy_30d IS NOT NULL) > 0
                THEN SUM(tvl_usd * apy_30d) FILTER (WHERE apy_30d IS NOT NULL)
                     / SUM(tvl_usd) FILTER (WHERE apy_30d IS NOT NULL)
                ELSE NULL
            END AS weighted_apy_30d,
            CASE
                WHEN SUM(tvl_usd) FILTER (WHERE apy_90d IS NOT NULL) > 0
                THEN SUM(tvl_usd * apy_90d) FILTER (WHERE apy_90d IS NOT NULL)
                     / SUM(tvl_usd) FILTER (WHERE apy_90d IS NOT NULL)
                ELSE NULL
            END AS weighted_apy_90d,
            CASE
                WHEN SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL) > 0
                THEN SUM(tvl_usd * (apy_7d - apy_30d)) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL)
                     / SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL)
                ELSE NULL
            END AS weighted_momentum_7d_30d,
            COUNT(*) FILTER (WHERE apy_30d < 0.0) AS bucket_neg_count,
            COUNT(*) FILTER (WHERE apy_30d >= 0.0 AND apy_30d < 0.05) AS bucket_low_count,
            COUNT(*) FILTER (WHERE apy_30d >= 0.05 AND apy_30d < 0.15) AS bucket_mid_count,
            COUNT(*) FILTER (WHERE apy_30d >= 0.15) AS bucket_high_count,
            COUNT(*) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL AND apy_7d > apy_30d) AS risers_count,
            COUNT(*) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL AND apy_7d < apy_30d) AS fallers_count
        FROM trimmed
        GROUP BY day
        ORDER BY day
        """
    )

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            grouped_rows: list[dict] = []
            if group_by != "none":
                group_expr = "chain_id::text" if group_by == "chain" else "category"
                grouped_sql = (
                    daily_trends_cte
                    + f"""
                    , grouped AS (
                        SELECT
                            day::text AS day,
                            {group_expr} AS group_key,
                            COUNT(*) AS vaults,
                            SUM(tvl_usd) AS total_tvl_usd,
                            CASE
                                WHEN SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL) > 0
                                THEN SUM(tvl_usd * apy_7d) FILTER (WHERE apy_7d IS NOT NULL)
                                     / SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL)
                                ELSE NULL
                            END AS weighted_apy_7d,
                            CASE
                                WHEN SUM(tvl_usd) FILTER (WHERE apy_30d IS NOT NULL) > 0
                                THEN SUM(tvl_usd * apy_30d) FILTER (WHERE apy_30d IS NOT NULL)
                                     / SUM(tvl_usd) FILTER (WHERE apy_30d IS NOT NULL)
                                ELSE NULL
                            END AS weighted_apy_30d,
                            CASE
                                WHEN SUM(tvl_usd) FILTER (WHERE apy_90d IS NOT NULL) > 0
                                THEN SUM(tvl_usd * apy_90d) FILTER (WHERE apy_90d IS NOT NULL)
                                     / SUM(tvl_usd) FILTER (WHERE apy_90d IS NOT NULL)
                                ELSE NULL
                            END AS weighted_apy_90d,
                            CASE
                                WHEN SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL) > 0
                                THEN SUM(tvl_usd * (apy_7d - apy_30d)) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL)
                                     / SUM(tvl_usd) FILTER (WHERE apy_7d IS NOT NULL AND apy_30d IS NOT NULL)
                                ELSE NULL
                            END AS weighted_momentum_7d_30d
                        FROM trimmed
                        GROUP BY day, group_key
                    ),
                    ranked_groups AS (
                        SELECT
                            group_key,
                            SUM(total_tvl_usd) FILTER (WHERE day = (SELECT MAX(day) FROM grouped)) AS latest_tvl_usd
                        FROM grouped
                        GROUP BY group_key
                        ORDER BY latest_tvl_usd DESC NULLS LAST
                        LIMIT %(group_limit)s
                    )
                    SELECT g.*
                    FROM grouped g
                    JOIN ranked_groups r ON r.group_key = g.group_key
                    ORDER BY g.day, g.group_key
                    """
                )
                cur.execute(grouped_sql, params)
                grouped_rows = cur.fetchall()

    for row in rows:
        vaults = int(row.get("vaults") or 0)
        risers = int(row.get("risers_count") or 0)
        fallers = int(row.get("fallers_count") or 0)
        row["riser_ratio"] = (risers / vaults) if vaults > 0 else None
        row["faller_ratio"] = (fallers / vaults) if vaults > 0 else None
        row["bucket_neg_ratio"] = (int(row.get("bucket_neg_count") or 0) / vaults) if vaults > 0 else None
        row["bucket_low_ratio"] = (int(row.get("bucket_low_count") or 0) / vaults) if vaults > 0 else None
        row["bucket_mid_ratio"] = (int(row.get("bucket_mid_count") or 0) / vaults) if vaults > 0 else None
        row["bucket_high_ratio"] = (int(row.get("bucket_high_count") or 0) / vaults) if vaults > 0 else None
    grouped_series: dict[str, list[dict]] = {}
    grouped_latest: list[dict] = []
    if group_by != "none":
        latest_group_day = grouped_rows[-1]["day"] if grouped_rows else None
        for row in grouped_rows:
            group_key = str(row.get("group_key") or "unknown")
            grouped_series.setdefault(group_key, []).append(row)
            if latest_group_day and row.get("day") == latest_group_day:
                grouped_latest.append(row)
        grouped_latest.sort(key=lambda item: float(item.get("total_tvl_usd") or 0.0), reverse=True)

    latest = rows[-1] if rows else None
    first = rows[0] if rows else None
    summary = {
        "rows": len(rows),
        "latest_day": latest.get("day") if latest else None,
        "latest_weighted_apy_7d": latest.get("weighted_apy_7d") if latest else None,
        "latest_weighted_apy_30d": latest.get("weighted_apy_30d") if latest else None,
        "latest_weighted_apy_90d": latest.get("weighted_apy_90d") if latest else None,
        "latest_weighted_momentum_7d_30d": latest.get("weighted_momentum_7d_30d") if latest else None,
        "delta_weighted_apy_30d": _delta_or_none(latest.get("weighted_apy_30d"), first.get("weighted_apy_30d"))
        if latest and first
        else None,
    }

    return {
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "chain_id": chain_id,
            "group_by": group_by,
            "group_limit": group_limit,
            "days": days,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "rows": rows,
        "grouped": {
            "group_by": group_by,
            "rows": grouped_rows,
            "latest": grouped_latest,
            "series": grouped_series,
        },
    }
