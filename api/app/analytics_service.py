from __future__ import annotations

import psycopg

from app.common import (
    _aggregate_tvl_sql,
    _locked_yvusd_filter_sql,
    _market_filter_sql,
    _market_group_sql,
    _rank_gate_filter_sql,
    _user_visible_filter_sql,
)
from app.config import APY_MAX, APY_MIN, MOMENTUM_ABS_MAX, YVUSD_ADDRESS


def _bounded_metric_sql(expr: str, lower: float | str, upper: float | str) -> str:
    return f"CASE WHEN {expr} IS NULL THEN NULL ELSE LEAST(GREATEST({expr}, {lower}), {upper}) END"


BOUNDED_REALIZED_APY_SQL = _bounded_metric_sql("m.apy_30d", APY_MIN, APY_MAX)
BOUNDED_MOMENTUM_SQL = _bounded_metric_sql("m.momentum_7d_30d", -abs(MOMENTUM_ABS_MAX), abs(MOMENTUM_ABS_MAX))


def _composition_filtered_cte(*, max_vaults: int | None) -> str:
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    return f"""
    WITH filtered AS (
        SELECT
            d.chain_id,
            {_market_group_sql("d")} AS market,
            COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
            COALESCE(d.tvl_usd, 0.0) AS tvl_usd
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
        WHERE
            {_user_visible_filter_sql("d")}
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            AND {_market_filter_sql('d')}
            {rank_clause}
    )
    """


def _changes_base_cte(*, max_vaults: int | None, filter_market: bool = False) -> str:
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults, include_locked=True)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    market_clause = f"AND {_market_filter_sql('d')}" if filter_market else ""
    return f"""
    WITH eligible AS (
        SELECT
            d.vault_address,
            d.chain_id,
            d.symbol,
            COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
            COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
            d.est_apy,
            {_aggregate_tvl_sql("d")} AS aggregate_tvl_usd
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
        WHERE
            {_user_visible_filter_sql("d", include_retired=False, include_locked=True)}
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            {rank_clause}
            {market_clause}
    ),
    performance_points AS (
        SELECT p.chain_id, p.vault_address, p.ts,
            CASE WHEN {_locked_yvusd_filter_sql("p")}
                 THEN p.pps_raw * parent.pps_raw ELSE p.pps_raw END AS pps_raw
        FROM pps_timeseries p
        JOIN eligible e ON e.chain_id=p.chain_id AND e.vault_address=p.vault_address
        LEFT JOIN pps_timeseries parent ON {_locked_yvusd_filter_sql("p")}
            AND parent.chain_id=1 AND parent.vault_address='{YVUSD_ADDRESS}' AND parent.ts=p.ts
        WHERE NOT {_locked_yvusd_filter_sql("p")} OR parent.pps_raw > 0
    ),
    latest AS (
        SELECT p.chain_id, p.vault_address, MAX(p.ts) AS latest_ts
        FROM performance_points p
        GROUP BY p.chain_id, p.vault_address
    ),
    anchors AS (
        SELECT
            e.*,
            l.latest_ts,
            latest_point.pps_raw AS latest_pps,
            curr_point.ts AS curr_ts,
            curr_point.pps_raw AS curr_pps,
            prev_point.ts AS prev_ts,
            prev_point.pps_raw AS prev_pps
        FROM eligible e
        JOIN latest l
          ON l.chain_id = e.chain_id
         AND l.vault_address = e.vault_address
        JOIN performance_points latest_point
          ON latest_point.chain_id = l.chain_id
         AND latest_point.vault_address = l.vault_address
         AND latest_point.ts = l.latest_ts
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM performance_points p
            WHERE p.chain_id = e.chain_id
              AND p.vault_address = e.vault_address
              AND p.ts >= l.latest_ts - %(window_sec)s
              AND p.ts < l.latest_ts
            ORDER BY p.ts ASC
            LIMIT 1
        ) curr_point ON TRUE
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM performance_points p
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
                THEN POWER(a.latest_pps / a.curr_pps, 31536000.0 / (a.latest_ts - a.curr_ts)) - 1
                ELSE NULL
            END AS apy_window_raw,
            CASE
                WHEN a.curr_pps > 0
                    AND a.prev_pps > 0
                THEN POWER(a.curr_pps / a.prev_pps, 31536000.0 / (a.curr_ts - a.prev_ts)) - 1
                ELSE NULL
            END AS apy_prev_window_raw,
            (%(now_epoch)s - a.latest_ts) AS age_seconds
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
            n.aggregate_tvl_usd,
            n.est_apy,
            n.realized_apy_window,
            n.realized_apy_prev_window,
            (n.realized_apy_window - n.realized_apy_prev_window) AS delta_apy,
            n.age_seconds
        FROM normalized n
        WHERE n.apy_window_raw IS NOT NULL
          AND n.apy_prev_window_raw IS NOT NULL
          AND ({sign_filter})
        ORDER BY {order_expr}, n.tvl_usd DESC, n.chain_id, n.vault_address
        LIMIT %(limit)s
        """
    )
    movers = {}
    for side, sign, direction in (("risers", ">", "DESC"), ("fallers", "<", "ASC")):
        cur.execute(
            movers_sql.format(order_expr=f"delta_apy {direction}", sign_filter=f"(n.realized_apy_window - n.realized_apy_prev_window) {sign} 0"),
            movers_params,
        )
        movers[side] = cur.fetchall()
    return movers
