from __future__ import annotations

import psycopg

from app.common import (
    _market_filter_sql,
    _market_group_sql,
    _rank_gate_filter_sql,
    _user_visible_filter_sql,
)
from app.config import APY_MAX, APY_MIN, MOMENTUM_ABS_MAX


def _bounded_metric_sql(expr: str, lower: float | str, upper: float | str) -> str:
    return f"CASE WHEN {expr} IS NULL THEN NULL ELSE LEAST(GREATEST({expr}, {lower}), {upper}) END"


def _bounded_realized_apy_sql() -> str:
    return _bounded_metric_sql("m.apy_30d", APY_MIN, APY_MAX)


def _bounded_momentum_sql(alias: str = "m") -> str:
    lower = -abs(MOMENTUM_ABS_MAX)
    upper = abs(MOMENTUM_ABS_MAX)
    return _bounded_metric_sql(f"{alias}.momentum_7d_30d", lower, upper)


def _composition_filtered_cte(*, max_vaults: int | None, filter_market: bool = False) -> str:
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    market_clause = f"AND {_market_filter_sql('d')}" if filter_market else ""
    return f"""
    WITH filtered AS (
        SELECT
            d.vault_address,
            d.chain_id,
            COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
            {_market_group_sql("d")} AS market,
            COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
            COALESCE(NULLIF(d.symbol, ''), d.vault_address) AS symbol,
            COALESCE(d.tvl_usd, 0.0) AS tvl_usd
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
        WHERE
            {_user_visible_filter_sql("d", include_retired=False)}
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            {rank_clause}
            {market_clause}
    )
    """


def _changes_base_cte(*, max_vaults: int | None, filter_market: bool = False) -> str:
    bounded_momentum_sql = _bounded_momentum_sql("m")
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    market_clause = f"AND {_market_filter_sql('d')}" if filter_market else ""
    return f"""
    WITH eligible AS (
        SELECT
            d.vault_address,
            d.chain_id,
            d.name,
            d.symbol,
            COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
            COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
            {_market_group_sql("d")} AS market,
            COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
            d.est_apy,
            {_bounded_metric_sql("m.apy_30d", "%(apy_min)s", "%(apy_max)s")} AS realized_apy_30d,
            m.points_count,
            m.last_point_time,
            {bounded_momentum_sql} AS momentum_7d_30d
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
        WHERE
            {_user_visible_filter_sql("d", include_retired=False)}
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            {rank_clause}
            {market_clause}
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
            e.market,
            e.tvl_usd,
            e.est_apy,
            e.realized_apy_30d,
            e.points_count,
            e.last_point_time,
            e.momentum_7d_30d,
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
            {_bounded_metric_sql("s.apy_window_raw", "%(apy_min)s", "%(apy_max)s")} AS realized_apy_window,
            {_bounded_metric_sql("s.apy_prev_window_raw", "%(apy_min)s", "%(apy_max)s")} AS realized_apy_prev_window
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
            n.symbol,
            n.token_symbol,
            n.tvl_usd,
            n.realized_apy_window,
            n.realized_apy_prev_window,
            (n.realized_apy_window - n.realized_apy_prev_window) AS delta_apy,
            n.age_seconds
        FROM normalized n
        WHERE n.apy_window_raw IS NOT NULL
          AND n.apy_prev_window_raw IS NOT NULL
          AND ({sign_filter})
        ORDER BY {order_expr}, n.tvl_usd DESC
        LIMIT %(limit)s
        """
    )
    cur.execute(
        movers_sql.format(
            order_expr="delta_apy DESC",
            sign_filter="(n.realized_apy_window - n.realized_apy_prev_window) > 0",
        ),
        movers_params,
    )
    risers = cur.fetchall()
    cur.execute(
        movers_sql.format(
            order_expr="delta_apy ASC",
            sign_filter="(n.realized_apy_window - n.realized_apy_prev_window) < 0",
        ),
        movers_params,
    )
    fallers = cur.fetchall()
    return {"risers": risers, "fallers": fallers}
