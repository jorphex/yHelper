from __future__ import annotations

import psycopg

from app.common import (
    _alias_realized_apy_fields,
    _alias_realized_apy_many,
    _rank_gate_filter_sql,
    _user_visible_filter_sql,
)
from app.config import APY_MAX, APY_MIN, MOMENTUM_ABS_MAX


def _regime_from_momentum_sql(momentum_sql: str, *, vol_sql: str = "m.vol_30d") -> str:
    return """
    CASE
        WHEN {vol_sql} IS NULL OR {momentum_sql} IS NULL THEN 'unknown'
        WHEN {vol_sql} >= 0.20 THEN 'choppy'
        WHEN {momentum_sql} >= 0.010 THEN 'rising'
        WHEN {momentum_sql} <= -0.010 THEN 'falling'
        ELSE 'stable'
    END
    """.format(vol_sql=vol_sql, momentum_sql=momentum_sql)


def _bounded_metric_sql(expr: str, lower: float | str, upper: float | str) -> str:
    return f"CASE WHEN {expr} IS NULL THEN NULL ELSE LEAST(GREATEST({expr}, {lower}), {upper}) END"


def _safe_apy_sql() -> str:
    return _bounded_metric_sql("m.apy_30d", APY_MIN, APY_MAX)


def _safe_momentum_sql(alias: str = "m") -> str:
    lower = -abs(MOMENTUM_ABS_MAX)
    upper = abs(MOMENTUM_ABS_MAX)
    return _bounded_metric_sql(f"{alias}.momentum_7d_30d", lower, upper)


def _regime_case_sql(alias: str = "m") -> str:
    safe_momentum = _safe_momentum_sql(alias)
    return _regime_from_momentum_sql(safe_momentum, vol_sql=f"{alias}.vol_30d")


def _quality_score_sql() -> str:
    safe_apy = _safe_apy_sql()
    return f"({safe_apy} - 0.5 * COALESCE(m.vol_30d, 0.0))"


def _composition_filtered_cte(*, max_vaults: int | None) -> str:
    safe_momentum_sql = _safe_momentum_sql("m")
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    return f"""
    WITH filtered AS (
        SELECT
            d.vault_address,
            d.chain_id,
            COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
            COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
            COALESCE(NULLIF(d.symbol, ''), d.vault_address) AS symbol,
            COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
            {_bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")} AS safe_apy_30d,
            {safe_momentum_sql} AS momentum_7d_30d,
            m.consistency_score
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
        WHERE
            {_user_visible_filter_sql("d", include_retired=False)}
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            {rank_clause}
    )
    """


def _changes_base_cte(*, max_vaults: int | None) -> str:
    safe_momentum_sql = _safe_momentum_sql("m")
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    return f"""
    WITH eligible AS (
        SELECT
            d.vault_address,
            d.chain_id,
            d.name,
            d.symbol,
            COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
            COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
            COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
            d.est_apy,
            {_bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")} AS safe_apy_30d,
            m.points_count,
            m.last_point_time,
            {safe_momentum_sql} AS momentum_7d_30d,
            m.consistency_score,
            m.vol_30d
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
        WHERE
            {_user_visible_filter_sql("d", include_retired=False)}
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            {rank_clause}
    ),
    latest AS (
        SELECT p.chain_id, p.vault_address, MAX(p.ts) AS latest_ts
        FROM pps_timeseries p
        JOIN eligible e
          ON e.chain_id = p.chain_id
         AND e.vault_address = p.vault_address
        GROUP BY p.chain_id, p.vault_address
    ),
    anchors AS (
        SELECT
            e.vault_address,
            e.chain_id,
            e.name,
            e.symbol,
            e.token_symbol,
            e.category,
            e.tvl_usd,
            e.est_apy,
            e.safe_apy_30d,
            e.points_count,
            e.last_point_time,
            e.momentum_7d_30d,
            e.consistency_score,
            e.vol_30d,
            l.latest_ts,
            latest_point.ts AS latest_point_ts,
            latest_point.pps_raw AS latest_pps,
            curr_point.ts AS curr_ts,
            curr_point.pps_raw AS curr_pps,
            prev_point.ts AS prev_ts,
            prev_point.pps_raw AS prev_pps
        FROM eligible e
        JOIN latest l
          ON l.chain_id = e.chain_id
         AND l.vault_address = e.vault_address
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM pps_timeseries p
            WHERE p.chain_id = e.chain_id AND p.vault_address = e.vault_address AND p.ts <= l.latest_ts
            ORDER BY p.ts DESC
            LIMIT 1
        ) latest_point ON TRUE
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM pps_timeseries p
            WHERE p.chain_id = e.chain_id
              AND p.vault_address = e.vault_address
              AND p.ts >= l.latest_ts - %(window_sec)s
              AND p.ts < l.latest_ts
            ORDER BY p.ts ASC
            LIMIT 1
        ) curr_point ON TRUE
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM pps_timeseries p
            WHERE p.chain_id = e.chain_id
              AND p.vault_address = e.vault_address
              AND p.ts >= curr_point.ts - %(window_sec)s
              AND p.ts < curr_point.ts
            ORDER BY p.ts ASC
            LIMIT 1
        ) prev_point ON TRUE
    ),
    scored AS (
        SELECT
            a.*,
            CASE
                WHEN a.latest_pps > 0
                    AND a.curr_pps > 0
                    AND a.latest_point_ts > a.curr_ts
                THEN POWER(a.latest_pps / a.curr_pps, 31536000.0 / NULLIF((a.latest_point_ts - a.curr_ts), 0)) - 1
                ELSE NULL
            END AS apy_window_raw,
            CASE
                WHEN a.curr_pps > 0
                    AND a.prev_pps > 0
                    AND a.curr_ts > a.prev_ts
                THEN POWER(a.curr_pps / a.prev_pps, 31536000.0 / NULLIF((a.curr_ts - a.prev_ts), 0)) - 1
                ELSE NULL
            END AS apy_prev_window_raw,
            (%(now_epoch)s - a.latest_point_ts) AS age_seconds
        FROM anchors a
    ),
    normalized AS (
        SELECT
            s.*,
            {_bounded_metric_sql("s.apy_window_raw", "%(apy_min)s", "%(apy_max)s")} AS safe_apy_window,
            {_bounded_metric_sql("s.apy_prev_window_raw", "%(apy_min)s", "%(apy_max)s")} AS safe_apy_prev_window
        FROM scored s
    )
    """


def _fetch_change_movers(
    cur: psycopg.Cursor, *, base_cte: str, params: dict[str, object], limit: int
) -> dict[str, list[dict]]:
    movers_params = dict(params)
    movers_params["limit"] = limit
    movers_sql = (
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
            n.safe_apy_30d,
            n.points_count,
            n.last_point_time,
            n.safe_apy_window,
            n.safe_apy_prev_window,
            (n.safe_apy_window - n.safe_apy_prev_window) AS delta_apy,
            n.momentum_7d_30d,
            n.consistency_score,
            n.vol_30d,
            n.age_seconds
        FROM normalized n
        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
        ORDER BY {order_expr}, n.tvl_usd DESC
        LIMIT %(limit)s
        """
    )
    cur.execute(movers_sql.format(order_expr="delta_apy DESC"), movers_params)
    risers = cur.fetchall()
    cur.execute(movers_sql.format(order_expr="delta_apy ASC"), movers_params)
    fallers = cur.fetchall()
    cur.execute(movers_sql.format(order_expr="ABS((n.safe_apy_window - n.safe_apy_prev_window)) DESC"), movers_params)
    largest = cur.fetchall()
    _alias_realized_apy_many(risers)
    _alias_realized_apy_many(fallers)
    _alias_realized_apy_many(largest)
    return {"risers": risers, "fallers": fallers, "largest_abs_delta": largest}


def _compact_mover_rows(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for row in rows:
        out.append(
            _alias_realized_apy_fields({
                "vault_address": row.get("vault_address"),
                "chain_id": row.get("chain_id"),
                "symbol": row.get("symbol"),
                "token_symbol": row.get("token_symbol"),
                "category": row.get("category"),
                "tvl_usd": row.get("tvl_usd"),
                "safe_apy_30d": row.get("safe_apy_30d"),
                "safe_apy_window": row.get("safe_apy_window"),
                "safe_apy_prev_window": row.get("safe_apy_prev_window"),
                "delta_apy": row.get("delta_apy"),
                "age_seconds": row.get("age_seconds"),
            })
        )
    return out
