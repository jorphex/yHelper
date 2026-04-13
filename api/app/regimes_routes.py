from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.analytics_service import _bounded_metric_sql, _regime_case_sql, _regime_from_momentum_sql
from app.common import _delta_or_none, _resolve_universe_gate, _to_float_or_none, _user_visible_filter_sql, _rank_gate_filter_sql
from app.config import APY_MAX, APY_MIN, DAILY_APY_LOOKBACK_DAYS, DATABASE_URL

router = APIRouter()


@router.get("/api/regimes")
async def regimes(
    chain_id: int | None = Query(default=None),
    universe: Literal["core", "extended", "raw"] = "core",
    min_points: int | None = Query(default=None, ge=0),
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=300),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    filters = [
        _user_visible_filter_sql("d", include_retired=False),
        "COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s",
        "COALESCE(m.points_count, 0) >= %(min_points)s",
    ]
    params: dict[str, object] = {"min_tvl_usd": min_tvl_usd, "min_points": min_points, "limit": limit}
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    if rank_filter_sql:
        filters.append(rank_filter_sql)
        params["max_vaults"] = max_vaults
    if chain_id is not None:
        filters.append("d.chain_id = %(chain_id)s")
        params["chain_id"] = chain_id
    where_sql = " AND ".join(filters)
    regime_sql = _regime_case_sql()
    safe_apy_sql = _bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")
    safe_momentum_sql = _bounded_metric_sql("m.momentum_7d_30d", "-1.0", "1.0")
    params["apy_min"] = APY_MIN
    params["apy_max"] = APY_MAX

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    {regime_sql} AS regime,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0)) AS tvl_usd
                FROM vault_dim d
                JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                GROUP BY regime
                ORDER BY vaults DESC
                """,
                params,
            )
            summary = cur.fetchall()

            cur.execute(
                f"""
                SELECT
                    d.vault_address,
                    d.chain_id,
                    d.symbol,
                    d.token_symbol,
                    d.tvl_usd,
                    m.apy_7d,
                    m.apy_30d,
                    {safe_apy_sql} AS safe_apy_30d,
                    m.vol_30d,
                    {safe_momentum_sql} AS momentum_7d_30d,
                    m.consistency_score,
                    {regime_sql} AS regime
                FROM vault_dim d
                JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {where_sql}
                ORDER BY ABS({safe_momentum_sql}) DESC, d.tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            movers = cur.fetchall()

    return {
        "filters": {
            "universe": universe,
            "chain_id": chain_id,
            "min_points": min_points,
            "min_tvl_usd": min_tvl_usd,
            "max_vaults": max_vaults,
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "movers": movers,
    }


@router.get("/api/regimes/transitions")
async def regime_transitions(
    chain_id: int | None = Query(default=None),
    universe: Literal["core", "extended", "raw"] = "core",
    min_points: int | None = Query(default=None, ge=0),
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=12, ge=4, le=30),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]

    filters = [
        _user_visible_filter_sql("d", include_retired=False),
        "COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s",
        "COALESCE(m.points_count, 0) >= %(min_points)s",
    ]
    params: dict[str, object] = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
    }
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    if rank_filter_sql:
        filters.append(rank_filter_sql)
        params["max_vaults"] = max_vaults
    if chain_id is not None:
        filters.append("d.chain_id = %(chain_id)s")
        params["chain_id"] = chain_id
    where_sql = " AND ".join(filters)
    safe_apy_7d_sql = _bounded_metric_sql("m.apy_7d", "%(apy_min)s", "%(apy_max)s")
    safe_apy_30d_sql = _bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")
    safe_apy_90d_sql = _bounded_metric_sql("m.apy_90d", "%(apy_min)s", "%(apy_max)s")
    curr_momentum_sql = f"({safe_apy_7d_sql} - {safe_apy_30d_sql})"
    prev_momentum_sql = f"({safe_apy_30d_sql} - {safe_apy_90d_sql})"
    current_regime_sql = _regime_from_momentum_sql(curr_momentum_sql, vol_sql="m.vol_30d")
    previous_regime_sql = _regime_from_momentum_sql(prev_momentum_sql, vol_sql="m.vol_30d")

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                WITH base AS (
                    SELECT
                        d.vault_address,
                        d.chain_id,
                        COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                        {curr_momentum_sql} AS current_momentum,
                        {prev_momentum_sql} AS previous_momentum,
                        {current_regime_sql} AS current_regime,
                        {previous_regime_sql} AS previous_regime
                    FROM vault_dim d
                    JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                    WHERE {where_sql}
                )
                SELECT
                    previous_regime,
                    current_regime,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    AVG(current_momentum) AS avg_current_momentum,
                    AVG(previous_momentum) AS avg_previous_momentum
                FROM base
                GROUP BY previous_regime, current_regime
                ORDER BY tvl_usd DESC NULLS LAST, vaults DESC
                """,
                params,
            )
            matrix = cur.fetchall()

            cur.execute(
                f"""
                WITH base AS (
                    SELECT
                        COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                        {current_regime_sql} AS current_regime,
                        {previous_regime_sql} AS previous_regime
                    FROM vault_dim d
                    JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                    WHERE {where_sql}
                ),
                scored AS (
                    SELECT
                        previous_regime,
                        current_regime,
                        COUNT(*) AS vaults,
                        SUM(tvl_usd) AS tvl_usd,
                        CASE WHEN previous_regime = current_regime THEN 0 ELSE 1 END AS changed
                    FROM base
                    GROUP BY previous_regime, current_regime
                )
                SELECT
                    SUM(vaults) AS vaults_total,
                    SUM(vaults) FILTER (WHERE changed = 1) AS changed_vaults,
                    SUM(tvl_usd) AS tvl_total,
                    SUM(tvl_usd) FILTER (WHERE changed = 1) AS changed_tvl_usd
                FROM scored
                """,
                params,
            )
            summary = cur.fetchone() or {}

            cur.execute(
                f"""
                WITH base AS (
                    SELECT
                        d.chain_id,
                        COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                        {current_regime_sql} AS current_regime,
                        {previous_regime_sql} AS previous_regime
                    FROM vault_dim d
                    JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                    WHERE {where_sql}
                ),
                chain_scored AS (
                    SELECT
                        chain_id,
                        COUNT(*) AS vaults,
                        SUM(tvl_usd) AS tvl_usd,
                        COUNT(*) FILTER (WHERE previous_regime <> current_regime) AS changed_vaults,
                        SUM(tvl_usd) FILTER (WHERE previous_regime <> current_regime) AS changed_tvl_usd
                    FROM base
                    GROUP BY chain_id
                )
                SELECT
                    chain_id,
                    vaults,
                    tvl_usd,
                    changed_vaults,
                    changed_tvl_usd,
                    CASE WHEN vaults > 0 THEN changed_vaults::DOUBLE PRECISION / vaults ELSE NULL END AS changed_ratio
                FROM chain_scored
                ORDER BY changed_ratio DESC NULLS LAST, changed_tvl_usd DESC NULLS LAST
                LIMIT %(limit)s
                """,
                params,
            )
            chain_breakdown = cur.fetchall()

    vaults_total = int(summary.get("vaults_total") or 0)
    changed_vaults = int(summary.get("changed_vaults") or 0)
    tvl_total = float(summary.get("tvl_total") or 0.0)
    changed_tvl = float(summary.get("changed_tvl_usd") or 0.0)

    return {
        "filters": {
            "universe": universe,
            "chain_id": chain_id,
            "min_points": min_points,
            "min_tvl_usd": min_tvl_usd,
            "max_vaults": max_vaults,
        },
        "universe_gate": universe_gate,
        "summary": {
            "vaults_total": vaults_total,
            "changed_vaults": changed_vaults,
            "changed_ratio": (changed_vaults / vaults_total) if vaults_total > 0 else None,
            "tvl_total_usd": tvl_total,
            "changed_tvl_usd": changed_tvl,
            "changed_tvl_ratio": (changed_tvl / tvl_total) if tvl_total > 0 else None,
        },
        "matrix": matrix,
        "chain_breakdown": chain_breakdown,
    }


@router.get("/api/regimes/transitions/daily")
async def regime_transitions_daily(
    chain_id: int | None = Query(default=None),
    universe: Literal["core", "extended", "raw"] = "core",
    min_points: int | None = Query(default=None, ge=0),
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    max_vaults: int | None = Query(default=None, ge=0),
    group_by: Literal["none", "chain", "category"] = Query(default="none"),
    group_limit: int = Query(default=8, ge=2, le=30),
    days: int = Query(default=120, ge=30, le=365),
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

    current_regime_sql = _regime_from_momentum_sql("current_momentum", vol_sql="vol_30d")
    previous_regime_sql = _regime_from_momentum_sql("previous_momentum", vol_sql="vol_30d")
    daily_regime_cte = f"""
        WITH eligible AS (
            SELECT
                d.vault_address,
                d.chain_id,
                COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                m.vol_30d AS vol_30d
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
                e.vol_30d,
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
                vol_30d,
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
                base.vol_30d,
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
        apy AS (
            SELECT
                vault_address,
                chain_id,
                category,
                tvl_usd,
                vol_30d,
                day,
                CASE
                    WHEN pps_raw > 0 AND pps_7d > 0 AND day_7d IS NOT NULL AND (day - day_7d) > 0
                    THEN LEAST(GREATEST(POWER(pps_raw / pps_7d, 365.0 / NULLIF((day - day_7d), 0)) - 1, %(apy_min)s), %(apy_max)s)
                    ELSE NULL
                END AS apy_7d,
                CASE
                    WHEN pps_raw > 0 AND pps_30d > 0 AND day_30d IS NOT NULL AND (day - day_30d) > 0
                    THEN LEAST(GREATEST(POWER(pps_raw / pps_30d, 365.0 / NULLIF((day - day_30d), 0)) - 1, %(apy_min)s), %(apy_max)s)
                    ELSE NULL
                END AS apy_30d,
                CASE
                    WHEN pps_raw > 0 AND pps_90d > 0 AND day_90d IS NOT NULL AND (day - day_90d) > 0
                    THEN LEAST(GREATEST(POWER(pps_raw / pps_90d, 365.0 / NULLIF((day - day_90d), 0)) - 1, %(apy_min)s), %(apy_max)s)
                    ELSE NULL
                END AS apy_90d
            FROM calc
        ),
        momentum AS (
            SELECT
                vault_address,
                chain_id,
                category,
                tvl_usd,
                vol_30d,
                day,
                (apy_7d - apy_30d) AS current_momentum,
                (apy_30d - apy_90d) AS previous_momentum
            FROM apy
            WHERE day >= ((NOW() AT TIME ZONE 'UTC')::date - ((%(days)s::text || ' days')::interval))
              AND apy_30d IS NOT NULL
              AND apy_90d IS NOT NULL
        ),
        regimes AS (
            SELECT
                vault_address,
                chain_id,
                category,
                tvl_usd,
                day,
                current_momentum,
                previous_momentum,
                {current_regime_sql} AS current_regime,
                {previous_regime_sql} AS previous_regime
            FROM momentum
        )
    """

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                daily_regime_cte
                + """
                SELECT
                    day::text AS day,
                    COUNT(*) AS vaults_total,
                    COUNT(*) FILTER (WHERE previous_regime <> current_regime) AS changed_vaults,
                    SUM(tvl_usd) AS tvl_total_usd,
                    SUM(tvl_usd) FILTER (WHERE previous_regime <> current_regime) AS changed_tvl_usd,
                    AVG(current_momentum) AS avg_current_momentum,
                    AVG(previous_momentum) AS avg_previous_momentum
                FROM regimes
                GROUP BY day
                ORDER BY day
                """,
                params,
            )
            rows = cur.fetchall()
            grouped_rows: list[dict] = []
            if group_by != "none":
                group_expr = "chain_id::text" if group_by == "chain" else "category"
                cur.execute(
                    daily_regime_cte
                    + f"""
                    , grouped AS (
                        SELECT
                            day::text AS day,
                            {group_expr} AS group_key,
                            COUNT(*) AS vaults_total,
                            COUNT(*) FILTER (WHERE previous_regime <> current_regime) AS changed_vaults,
                            SUM(tvl_usd) AS tvl_total_usd,
                            SUM(tvl_usd) FILTER (WHERE previous_regime <> current_regime) AS changed_tvl_usd,
                            AVG(current_momentum) AS avg_current_momentum,
                            AVG(previous_momentum) AS avg_previous_momentum
                        FROM regimes
                        GROUP BY day, group_key
                    ),
                    ranked_groups AS (
                        SELECT
                            group_key,
                            SUM(tvl_total_usd) FILTER (WHERE day = (SELECT MAX(day) FROM grouped)) AS latest_tvl_usd
                        FROM grouped
                        GROUP BY group_key
                        ORDER BY latest_tvl_usd DESC NULLS LAST
                        LIMIT %(group_limit)s
                    )
                    SELECT g.*
                    FROM grouped g
                    JOIN ranked_groups r ON r.group_key = g.group_key
                    ORDER BY g.day, g.group_key
                    """,
                    params,
                )
                grouped_rows = cur.fetchall()

    for row in rows:
        vaults_total = int(row.get("vaults_total") or 0)
        changed_vaults = int(row.get("changed_vaults") or 0)
        tvl_total = float(row.get("tvl_total_usd") or 0.0)
        changed_tvl = float(row.get("changed_tvl_usd") or 0.0)
        row["changed_ratio"] = (changed_vaults / vaults_total) if vaults_total > 0 else None
        row["changed_tvl_ratio"] = (changed_tvl / tvl_total) if tvl_total > 0 else None
        current_m = _to_float_or_none(row.get("avg_current_momentum"))
        previous_m = _to_float_or_none(row.get("avg_previous_momentum"))
        row["momentum_spread"] = (current_m - previous_m) if current_m is not None and previous_m is not None else None
    grouped_series: dict[str, list[dict]] = {}
    grouped_latest: list[dict] = []
    if group_by != "none":
        for row in grouped_rows:
            vaults_total = int(row.get("vaults_total") or 0)
            changed_vaults = int(row.get("changed_vaults") or 0)
            tvl_total = float(row.get("tvl_total_usd") or 0.0)
            changed_tvl = float(row.get("changed_tvl_usd") or 0.0)
            row["changed_ratio"] = (changed_vaults / vaults_total) if vaults_total > 0 else None
            row["changed_tvl_ratio"] = (changed_tvl / tvl_total) if tvl_total > 0 else None
            current_m = _to_float_or_none(row.get("avg_current_momentum"))
            previous_m = _to_float_or_none(row.get("avg_previous_momentum"))
            row["momentum_spread"] = (current_m - previous_m) if current_m is not None and previous_m is not None else None
            group_key = str(row.get("group_key") or "unknown")
            grouped_series.setdefault(group_key, []).append(row)
        latest_group_day = grouped_rows[-1]["day"] if grouped_rows else None
        if latest_group_day is not None:
            grouped_latest = [row for row in grouped_rows if row.get("day") == latest_group_day]
            grouped_latest.sort(key=lambda item: float(item.get("tvl_total_usd") or 0.0), reverse=True)

    latest = rows[-1] if rows else None
    first = rows[0] if rows else None
    summary = {
        "rows": len(rows),
        "latest_day": latest.get("day") if latest else None,
        "latest_changed_ratio": latest.get("changed_ratio") if latest else None,
        "latest_changed_tvl_ratio": latest.get("changed_tvl_ratio") if latest else None,
        "latest_momentum_spread": latest.get("momentum_spread") if latest else None,
        "delta_changed_ratio": _delta_or_none(latest.get("changed_ratio"), first.get("changed_ratio"))
        if latest and first
        else None,
    }

    return {
        "filters": {
            "universe": universe,
            "chain_id": chain_id,
            "min_points": min_points,
            "min_tvl_usd": min_tvl_usd,
            "max_vaults": max_vaults,
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
