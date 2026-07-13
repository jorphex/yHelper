from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row

from app.analytics_service import _changes_base_cte
from app.common import _chain_label, _to_float_or_none
from app.config import (
    APY_MAX,
    APY_MIN,
    DATABASE_URL,
    UNIVERSE_CORE_MAX_VAULTS,
    UNIVERSE_CORE_MIN_POINTS,
    UNIVERSE_CORE_MIN_TVL_USD,
)


PULSE_DELTA_THRESHOLD = 0.0015
PULSE_FRESHNESS_SECONDS = 48 * 3600
PULSE_MIN_COVERAGE_RATIO = 0.5
PULSE_MIN_FRESH_TVL_RATIO = 0.75


def _overview_pulse_snapshot(cur: psycopg.Cursor) -> dict[str, object]:
    params: dict[str, object] = {
        "window_sec": 7 * 86400,
        "min_tvl_usd": UNIVERSE_CORE_MIN_TVL_USD,
        "min_points": UNIVERSE_CORE_MIN_POINTS,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
        "delta_threshold": PULSE_DELTA_THRESHOLD,
        "freshness_sec": PULSE_FRESHNESS_SECONDS,
        "max_vaults": UNIVERSE_CORE_MAX_VAULTS,
    }
    base_cte = _changes_base_cte(max_vaults=UNIVERSE_CORE_MAX_VAULTS)
    cur.execute(
        base_cte
        + """
        SELECT
            COUNT(*) AS vaults_eligible,
            COUNT(*) FILTER (
                WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
            ) AS vaults_with_change,
            SUM(COALESCE(n.tvl_usd, 0.0)) AS total_tvl_usd,
            SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
            ) AS comparable_tvl_usd,
            SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                WHERE n.apy_window_raw IS NOT NULL
                  AND n.apy_prev_window_raw IS NOT NULL
                  AND (n.safe_apy_window - n.safe_apy_prev_window) >= %(delta_threshold)s
            ) AS improving_tvl_usd,
            SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                WHERE n.apy_window_raw IS NOT NULL
                  AND n.apy_prev_window_raw IS NOT NULL
                  AND (n.safe_apy_window - n.safe_apy_prev_window) <= -%(delta_threshold)s
            ) AS softening_tvl_usd,
            SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                WHERE n.apy_window_raw IS NOT NULL
                  AND n.apy_prev_window_raw IS NOT NULL
                  AND ABS(n.safe_apy_window - n.safe_apy_prev_window) < %(delta_threshold)s
            ) AS steady_tvl_usd,
            SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                WHERE n.apy_window_raw IS NOT NULL
                  AND n.apy_prev_window_raw IS NOT NULL
                  AND n.age_seconds <= %(freshness_sec)s
            ) AS fresh_comparable_tvl_usd,
            MAX(n.latest_ts) FILTER (
                WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
            ) AS latest_data_epoch,
            MIN(n.latest_ts) FILTER (
                WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
            ) AS oldest_data_epoch,
            CASE
                WHEN SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                    WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                ) > 0
                THEN SUM(COALESCE(n.tvl_usd, 0.0) * n.safe_apy_window) FILTER (
                    WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                ) / SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                    WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                )
                ELSE NULL
            END AS tvl_weighted_safe_apy_window,
            CASE
                WHEN SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                    WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                ) > 0
                THEN SUM(COALESCE(n.tvl_usd, 0.0) * n.safe_apy_prev_window) FILTER (
                    WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                ) / SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                    WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                )
                ELSE NULL
            END AS tvl_weighted_safe_apy_prev_window,
            COUNT(*) FILTER (
                WHERE n.apy_window_raw IS NOT NULL
                  AND n.apy_prev_window_raw IS NOT NULL
                  AND n.age_seconds <= %(freshness_sec)s
            ) AS fresh_comparable_vaults
        FROM normalized n
        """,
        params,
    )
    return cur.fetchone() or {}


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return max(0.0, min(1.0, numerator / denominator))


def _epoch_iso(value: object) -> str | None:
    epoch = _to_float_or_none(value)
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, tz=UTC).isoformat()


def _build_overview_pulse(snapshot: dict[str, object]) -> dict[str, object]:
    eligible = int(snapshot.get("vaults_eligible") or 0)
    comparable = int(snapshot.get("vaults_with_change") or 0)
    total_tvl = _to_float_or_none(snapshot.get("total_tvl_usd"))
    comparable_tvl = _to_float_or_none(snapshot.get("comparable_tvl_usd"))
    fresh_tvl = _to_float_or_none(snapshot.get("fresh_comparable_tvl_usd"))
    latest_apy = _to_float_or_none(snapshot.get("tvl_weighted_safe_apy_window"))
    previous_apy = _to_float_or_none(snapshot.get("tvl_weighted_safe_apy_prev_window"))
    if eligible <= 0 or comparable <= 0 or latest_apy is None or previous_apy is None:
        return {"pulse": None}

    coverage_ratio = _ratio(comparable_tvl, total_tvl)
    fresh_tvl_ratio = _ratio(fresh_tvl, comparable_tvl)
    change = latest_apy - previous_apy
    if change <= -PULSE_DELTA_THRESHOLD:
        trend = "softening"
        directional_tvl = _to_float_or_none(snapshot.get("softening_tvl_usd"))
    elif change >= PULSE_DELTA_THRESHOLD:
        trend = "improving"
        directional_tvl = _to_float_or_none(snapshot.get("improving_tvl_usd"))
    else:
        trend = "steady"
        directional_tvl = _to_float_or_none(snapshot.get("steady_tvl_usd"))

    if coverage_ratio is None or coverage_ratio < PULSE_MIN_COVERAGE_RATIO:
        data_state = "limited"
    elif fresh_tvl_ratio is None or fresh_tvl_ratio < PULSE_MIN_FRESH_TVL_RATIO:
        data_state = "delayed"
    else:
        data_state = "ready"

    pulse = {
        "trend": trend,
        "data_state": data_state,
        "latest_7d_apy": latest_apy,
        "previous_7d_apy": previous_apy,
        "change_7d": change,
        "directional_tvl_ratio": _ratio(directional_tvl, comparable_tvl),
        "coverage_ratio": coverage_ratio,
        "fresh_tvl_ratio": fresh_tvl_ratio,
        "eligible_vaults": eligible,
        "comparable_vaults": comparable,
        "fresh_comparable_vaults": int(snapshot.get("fresh_comparable_vaults") or 0),
        "eligible_tvl_usd": total_tvl,
        "comparable_tvl_usd": comparable_tvl,
        "latest_data_at": _epoch_iso(snapshot.get("latest_data_epoch")),
        "oldest_data_at": _epoch_iso(snapshot.get("oldest_data_epoch")),
        "window_days": 7,
        "freshness_window_hours": PULSE_FRESHNESS_SECONDS // 3600,
        "scope": {
            "name": "Core vault universe",
            "min_tvl_usd": UNIVERSE_CORE_MIN_TVL_USD,
            "min_points": UNIVERSE_CORE_MIN_POINTS,
            "max_vaults": UNIVERSE_CORE_MAX_VAULTS,
        },
    }
    return {"pulse": pulse}


def _overview_pulse_response() -> JSONResponse:
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                payload = _build_overview_pulse(_overview_pulse_snapshot(cur))
    except Exception as exc:
        return JSONResponse(status_code=503, content={"pulse": None, "error": str(exc)})

    return JSONResponse(status_code=200, content=payload)


def _dau_last_run(cur: psycopg.Cursor) -> dict[str, object] | None:
    cur.execute(
        """
        SELECT status, started_at, ended_at, records, error_summary
        FROM ingestion_runs
        WHERE job_name = 'product_dau'
        ORDER BY id DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "status": row["status"],
        "started_at": row["started_at"].isoformat() if row["started_at"] else None,
        "ended_at": row["ended_at"].isoformat() if row["ended_at"] else None,
        "records": row["records"],
        "error_summary": row["error_summary"],
    }


def _dau_trailing_24h(cur: psycopg.Cursor) -> dict[str, object]:
    cur.execute(
        """
        SELECT
            COUNT(DISTINCT user_account) AS dau_total,
            COUNT(DISTINCT CASE WHEN product_type = 'vault' THEN user_account END) AS dau_vaults,
            COUNT(DISTINCT CASE WHEN product_type = 'styfi' THEN user_account END) AS dau_styfi,
            COUNT(DISTINCT CASE WHEN product_type = 'styfix' THEN user_account END) AS dau_styfix
        FROM product_interactions
        WHERE block_time >= NOW() - INTERVAL '24 hours'
        """
    )
    row = cur.fetchone() or {}
    return {
        "dau_total": int(row.get("dau_total") or 0),
        "dau_vaults": int(row.get("dau_vaults") or 0),
        "dau_styfi": int(row.get("dau_styfi") or 0),
        "dau_styfix": int(row.get("dau_styfix") or 0),
    }


def _dau_daily_series(cur: psycopg.Cursor, *, days: int) -> list[dict[str, object]]:
    cur.execute(
        """
        WITH day_series AS (
            SELECT generate_series(
                (CURRENT_DATE - (%(days)s::int - 1)),
                CURRENT_DATE,
                INTERVAL '1 day'
            )::date AS day_utc
        )
        SELECT
            s.day_utc,
            COALESCE(d.dau_total, 0) AS dau_total,
            COALESCE(d.dau_vaults, 0) AS dau_vaults,
            COALESCE(d.dau_styfi, 0) AS dau_styfi,
            COALESCE(d.dau_styfix, 0) AS dau_styfix
        FROM day_series s
        LEFT JOIN product_dau_daily d ON d.day_utc = s.day_utc
        ORDER BY s.day_utc
        """,
        {"days": days},
    )
    rows = cur.fetchall()
    return [
        {
            "day_utc": row["day_utc"].isoformat() if row["day_utc"] else None,
            "dau_total": int(row["dau_total"] or 0),
            "dau_vaults": int(row["dau_vaults"] or 0),
            "dau_styfi": int(row["dau_styfi"] or 0),
            "dau_styfix": int(row["dau_styfix"] or 0),
        }
        for row in rows
    ]


def _harvest_where_clause(*, chain_id: int | None, vault_address: str | None) -> tuple[str, dict[str, object]]:
    clauses: list[str] = []
    params: dict[str, object] = {}
    if chain_id is not None:
        clauses.append("h.chain_id = %(chain_id)s")
        params["chain_id"] = chain_id
    if vault_address:
        clauses.append("LOWER(h.vault_address) = %(vault_address)s")
        params["vault_address"] = vault_address.lower()
    if not clauses:
        return "", params
    return " AND " + " AND ".join(clauses), params


def _harvest_meaningful_clause(meaningful_only: bool) -> str:
    if not meaningful_only:
        return ""
    return """
        AND (
            COALESCE(h.gain, 0) <> 0
            OR COALESCE(h.loss, 0) <> 0
            OR COALESCE(h.fee_assets, 0) <> 0
            OR COALESCE(h.refund_assets, 0) <> 0
        )
    """


def _harvest_last_run(cur: psycopg.Cursor) -> dict[str, object] | None:
    cur.execute(
        """
        SELECT status, started_at, ended_at, records, error_summary
        FROM ingestion_runs
        WHERE job_name = 'vault_harvests'
        ORDER BY id DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "status": row["status"],
        "started_at": row["started_at"].isoformat() if row["started_at"] else None,
        "ended_at": row["ended_at"].isoformat() if row["ended_at"] else None,
        "records": row["records"],
        "error_summary": row["error_summary"],
    }


def _harvest_trailing_24h(
    cur: psycopg.Cursor,
    *,
    chain_id: int | None,
    vault_address: str | None,
    meaningful_only: bool = False,
) -> dict[str, object]:
    where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
    meaningful_sql = _harvest_meaningful_clause(meaningful_only)
    cur.execute(
        f"""
        SELECT
            COUNT(*) AS harvest_count,
            COUNT(DISTINCT h.vault_address) AS vault_count,
            COUNT(DISTINCT h.strategy_address) AS strategy_count
        FROM vault_harvests h
        WHERE h.block_time >= NOW() - INTERVAL '24 hours'
        {meaningful_sql}
        {where_sql}
        """,
        params,
    )
    row = cur.fetchone() or {}
    return {
        "harvest_count": int(row.get("harvest_count") or 0),
        "vault_count": int(row.get("vault_count") or 0),
        "strategy_count": int(row.get("strategy_count") or 0),
    }


def _harvest_chain_rollups(
    cur: psycopg.Cursor,
    *,
    days: int,
    chain_id: int | None,
    vault_address: str | None,
    meaningful_only: bool = False,
) -> list[dict[str, object]]:
    where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
    meaningful_sql = _harvest_meaningful_clause(meaningful_only)
    params["days"] = days
    cur.execute(
        f"""
        SELECT
            h.chain_id,
            COUNT(*) AS harvest_count,
            COUNT(DISTINCT h.vault_address) AS vault_count,
            COUNT(DISTINCT h.strategy_address) AS strategy_count,
            MAX(h.block_time) AS last_harvest_at
        FROM vault_harvests h
        WHERE h.block_time >= NOW() - (%(days)s * INTERVAL '1 day')
        {meaningful_sql}
        {where_sql}
        GROUP BY h.chain_id
        ORDER BY harvest_count DESC, h.chain_id
        """,
        params,
    )
    rows = cur.fetchall()
    return [
        {
            "chain_id": int(row["chain_id"]),
            "chain_label": _chain_label(int(row["chain_id"])),
            "harvest_count": int(row["harvest_count"] or 0),
            "vault_count": int(row["vault_count"] or 0),
            "strategy_count": int(row["strategy_count"] or 0),
            "last_harvest_at": row["last_harvest_at"].isoformat() if row["last_harvest_at"] else None,
        }
        for row in rows
    ]


def _harvest_daily_by_chain(
    cur: psycopg.Cursor,
    *,
    days: int,
    chain_id: int | None,
    vault_address: str | None,
    meaningful_only: bool = False,
) -> list[dict[str, object]]:
    if vault_address or meaningful_only:
        where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
        meaningful_sql = _harvest_meaningful_clause(meaningful_only)
        params["days"] = days
        cur.execute(
            f"""
            WITH day_series AS (
                SELECT generate_series(
                    (CURRENT_DATE - (%(days)s::int - 1)),
                    CURRENT_DATE,
                    INTERVAL '1 day'
                )::date AS day_utc
            ),
            chain_series AS (
                SELECT DISTINCT h.chain_id
                FROM vault_harvests h
                WHERE TRUE
                {meaningful_sql}
                {where_sql}
            )
            SELECT
                s.day_utc,
                c.chain_id,
                COALESCE(COUNT(h.tx_hash), 0) AS harvest_count,
                COALESCE(COUNT(DISTINCT h.vault_address), 0) AS vault_count,
                COALESCE(COUNT(DISTINCT h.strategy_address), 0) AS strategy_count
            FROM day_series s
            CROSS JOIN chain_series c
            LEFT JOIN vault_harvests h
              ON (h.block_time AT TIME ZONE 'UTC')::date = s.day_utc
             AND h.chain_id = c.chain_id
             AND h.block_time >= CURRENT_DATE - (%(days)s::int - 1)
             {meaningful_sql}
             {where_sql}
            GROUP BY s.day_utc, c.chain_id
            ORDER BY s.day_utc, c.chain_id
            """,
            params,
        )
    else:
        params = {"days": days}
        where_sql = ""
        if chain_id is not None:
            where_sql = "WHERE d.chain_id = %(chain_id)s"
            params["chain_id"] = chain_id
        cur.execute(
            f"""
            WITH day_series AS (
                SELECT generate_series(
                    (CURRENT_DATE - (%(days)s::int - 1)),
                    CURRENT_DATE,
                    INTERVAL '1 day'
                )::date AS day_utc
            ),
            chain_series AS (
                SELECT DISTINCT chain_id
                FROM vault_harvest_daily_chain d
                {where_sql}
            )
            SELECT
                s.day_utc,
                c.chain_id,
                COALESCE(d.harvest_count, 0) AS harvest_count,
                COALESCE(d.vault_count, 0) AS vault_count,
                COALESCE(d.strategy_count, 0) AS strategy_count
            FROM day_series s
            CROSS JOIN chain_series c
            LEFT JOIN vault_harvest_daily_chain d
              ON d.day_utc = s.day_utc
             AND d.chain_id = c.chain_id
            ORDER BY s.day_utc, c.chain_id
            """,
            params,
        )
    rows = cur.fetchall()
    return [
        {
            "day_utc": row["day_utc"].isoformat() if row["day_utc"] else None,
            "chain_id": int(row["chain_id"]),
            "chain_label": _chain_label(int(row["chain_id"])),
            "harvest_count": int(row["harvest_count"] or 0),
            "vault_count": int(row["vault_count"] or 0),
            "strategy_count": int(row["strategy_count"] or 0),
        }
        for row in rows
    ]


def _harvest_recent(
    cur: psycopg.Cursor,
    *,
    days: int,
    chain_id: int | None,
    vault_address: str | None,
    limit: int,
    meaningful_only: bool = False,
) -> list[dict[str, object]]:
    where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
    params["days"] = days
    params["limit"] = limit
    meaningful_sql = _harvest_meaningful_clause(meaningful_only)
    cur.execute(
        f"""
        SELECT
            h.chain_id,
            h.block_time,
            h.tx_hash,
            h.log_index,
            h.vault_address,
            d.symbol AS vault_symbol,
            d.token_symbol,
            COALESCE(
                d.token_decimals,
                CASE
                    WHEN jsonb_typeof(d.raw -> 'asset' -> 'decimals') IN ('number', 'string')
                    THEN NULLIF(d.raw -> 'asset' ->> 'decimals', '')::int
                    ELSE NULL
                END,
                CASE
                    WHEN jsonb_typeof(d.raw -> 'meta' -> 'token' -> 'decimals') IN ('number', 'string')
                    THEN NULLIF(d.raw -> 'meta' -> 'token' ->> 'decimals', '')::int
                    ELSE NULL
                END,
                CASE
                    WHEN jsonb_typeof(d.raw -> 'token' -> 'decimals') IN ('number', 'string')
                    THEN NULLIF(d.raw -> 'token' ->> 'decimals', '')::int
                    ELSE NULL
                END,
                CASE
                    WHEN jsonb_typeof(d.raw -> 'decimals') IN ('number', 'string')
                    THEN NULLIF(d.raw ->> 'decimals', '')::int
                    ELSE NULL
                END
            ) AS token_decimals,
            h.vault_version,
            h.strategy_address,
            COALESCE(NULLIF(s.name, ''), NULLIF(s.symbol, '')) AS strategy_name,
            h.gain::text AS gain,
            h.loss::text AS loss,
            h.debt_after::text AS debt_after,
            h.fee_assets::text AS fee_assets,
            h.refund_assets::text AS refund_assets
        FROM vault_harvests h
        LEFT JOIN vault_dim d
          ON d.chain_id = h.chain_id
         AND LOWER(d.vault_address) = LOWER(h.vault_address)
        LEFT JOIN vault_dim s
          ON s.chain_id = h.chain_id
         AND LOWER(s.vault_address) = LOWER(h.strategy_address)
        WHERE h.block_time >= NOW() - (%(days)s * INTERVAL '1 day')
          {meaningful_sql}
        {where_sql}
        ORDER BY h.block_time DESC, h.chain_id, h.log_index DESC
        LIMIT %(limit)s
        """,
        params,
    )
    rows = cur.fetchall()
    return [
        {
            "chain_id": int(row["chain_id"]),
            "chain_label": _chain_label(int(row["chain_id"])),
            "block_time": row["block_time"].isoformat() if row["block_time"] else None,
            "tx_hash": row["tx_hash"],
            "log_index": int(row["log_index"]),
            "vault_address": row["vault_address"],
            "vault_symbol": row["vault_symbol"],
            "token_symbol": row["token_symbol"],
            "token_decimals": row["token_decimals"],
            "vault_version": row["vault_version"],
            "strategy_address": row["strategy_address"],
            "strategy_name": row["strategy_name"],
            "gain": row["gain"],
            "loss": row["loss"],
            "debt_after": row["debt_after"],
            "fee_assets": row["fee_assets"],
            "refund_assets": row["refund_assets"],
            "report_type": "realized_result"
            if any(
                row.get(field) not in (None, "0", 0)
                for field in ("gain", "loss", "fee_assets", "refund_assets")
            )
            else "accounting_update",
        }
        for row in rows
    ]
