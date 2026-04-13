from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row

from app.analytics_service import _changes_base_cte
from app.common import (
    _alias_realized_apy_fields,
    _chain_label,
    _format_compact_usd,
    _safe_int,
    _to_float_or_none,
    _user_visible_filter_sql,
    _yearn_vault_url,
)
from app.config import APY_MAX, APY_MIN, DATABASE_URL


def _overview_note_snapshot(cur: psycopg.Cursor) -> dict[str, object]:
    standout_min_tvl_usd = 100_000.0
    params: dict[str, object] = {
        "window_sec": 7 * 86400,
        "min_tvl_usd": 1_000_000.0,
        "min_points": 45,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
        "standout_min_tvl_usd": standout_min_tvl_usd,
        "max_vaults": 250,
    }
    base_cte = _changes_base_cte(max_vaults=250)
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
            ) AS changed_tvl_usd,
            AVG(n.safe_apy_window) AS avg_safe_apy_window,
            AVG(n.safe_apy_prev_window) AS avg_safe_apy_prev_window,
            AVG(n.safe_apy_window - n.safe_apy_prev_window) AS avg_delta,
            AVG(n.safe_apy_30d) AS avg_safe_apy_30d,
            AVG(n.est_apy) AS avg_est_apy,
            CASE
                WHEN SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.safe_apy_window IS NOT NULL) > 0
                THEN SUM(COALESCE(n.tvl_usd, 0.0) * n.safe_apy_window) FILTER (WHERE n.safe_apy_window IS NOT NULL)
                     / SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.safe_apy_window IS NOT NULL)
                ELSE NULL
            END AS tvl_weighted_safe_apy_window,
            CASE
                WHEN SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.safe_apy_prev_window IS NOT NULL) > 0
                THEN SUM(COALESCE(n.tvl_usd, 0.0) * n.safe_apy_prev_window) FILTER (WHERE n.safe_apy_prev_window IS NOT NULL)
                     / SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.safe_apy_prev_window IS NOT NULL)
                ELSE NULL
            END AS tvl_weighted_safe_apy_prev_window,
            CASE
                WHEN SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.safe_apy_30d IS NOT NULL) > 0
                THEN SUM(COALESCE(n.tvl_usd, 0.0) * n.safe_apy_30d) FILTER (WHERE n.safe_apy_30d IS NOT NULL)
                     / SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.safe_apy_30d IS NOT NULL)
                ELSE NULL
            END AS tvl_weighted_safe_apy_30d,
            CASE
                WHEN SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.est_apy IS NOT NULL) > 0
                THEN SUM(COALESCE(n.tvl_usd, 0.0) * n.est_apy) FILTER (WHERE n.est_apy IS NOT NULL)
                     / SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (WHERE n.est_apy IS NOT NULL)
                ELSE NULL
            END AS tvl_weighted_est_apy
        FROM normalized n
        """,
        params,
    )
    snapshot = cur.fetchone() or {}
    cur.execute(
        f"""
        SELECT
            d.symbol AS standout_est_symbol,
            d.chain_id AS standout_est_chain_id,
            d.vault_address AS standout_est_vault_address,
            d.est_apy AS standout_est_apy,
            COALESCE(d.tvl_usd, 0.0) AS standout_est_tvl_usd
        FROM vault_dim d
        WHERE
            {_user_visible_filter_sql("d", include_retired=False)}
            AND COALESCE(d.tvl_usd, 0.0) >= %(standout_min_tvl_usd)s
            AND d.est_apy IS NOT NULL
        ORDER BY d.est_apy DESC, COALESCE(d.tvl_usd, 0.0) DESC, d.vault_address
        LIMIT 1
        """,
        params,
    )
    snapshot.update(cur.fetchone() or {})
    _alias_realized_apy_fields(snapshot)
    return snapshot


def _build_overview_note_summary(snapshot: dict[str, object]) -> dict[str, object]:
    eligible = int(snapshot.get("vaults_eligible") or 0)
    with_change = int(snapshot.get("vaults_with_change") or 0)
    if eligible <= 0 or with_change <= 0:
        return {"summary": None, "mentioned_vault": None}

    weighted_realized_window = _to_float_or_none(snapshot.get("tvl_weighted_safe_apy_window"))
    weighted_realized_prev = _to_float_or_none(snapshot.get("tvl_weighted_safe_apy_prev_window"))
    weighted_realized_baseline = _to_float_or_none(snapshot.get("tvl_weighted_safe_apy_30d"))
    avg_delta = _to_float_or_none(snapshot.get("avg_delta"))
    realized_window = weighted_realized_window if weighted_realized_window is not None else _to_float_or_none(snapshot.get("avg_safe_apy_window"))
    realized_prev = weighted_realized_prev if weighted_realized_prev is not None else _to_float_or_none(snapshot.get("avg_safe_apy_prev_window"))
    realized_baseline = (
        weighted_realized_baseline
        if weighted_realized_baseline is not None
        else _to_float_or_none(snapshot.get("avg_safe_apy_30d"))
    )
    weighted_est = _to_float_or_none(snapshot.get("tvl_weighted_est_apy"))
    avg_est = _to_float_or_none(snapshot.get("avg_est_apy"))
    total_tvl = _to_float_or_none(snapshot.get("total_tvl_usd"))
    changed_tvl = _to_float_or_none(snapshot.get("changed_tvl_usd"))
    standout_est_symbol = (
        snapshot.get("standout_est_symbol") if isinstance(snapshot.get("standout_est_symbol"), str) else None
    )
    standout_est_chain_id = _safe_int(snapshot.get("standout_est_chain_id"))
    standout_est_vault_address = (
        snapshot.get("standout_est_vault_address")
        if isinstance(snapshot.get("standout_est_vault_address"), str)
        else None
    )
    standout_est_apy = _to_float_or_none(snapshot.get("standout_est_apy"))
    standout_est_tvl = _to_float_or_none(snapshot.get("standout_est_tvl_usd"))
    est_reference = weighted_est if weighted_est is not None else avg_est
    realized_delta = (realized_window - realized_prev) if realized_window is not None and realized_prev is not None else avg_delta
    baseline_gap = (
        realized_window - realized_baseline
        if realized_window is not None and realized_baseline is not None
        else None
    )
    est_gap = (est_reference - realized_window) if est_reference is not None and realized_window is not None else None
    row_breadth_ratio = with_change / eligible
    tvl_breadth_ratio = (changed_tvl / total_tvl) if total_tvl and total_tvl > 0 and changed_tvl is not None else None
    delta_threshold = 0.0015
    baseline_gap_threshold = 0.003
    est_gap_threshold = 0.003
    low_signal_delta_threshold = 0.001
    low_signal_gap_threshold = 0.002

    if (
        realized_delta is not None
        and abs(realized_delta) < low_signal_delta_threshold
        and (baseline_gap is None or abs(baseline_gap) < low_signal_gap_threshold)
        and (est_gap is None or abs(est_gap) < low_signal_gap_threshold)
    ):
        return {"summary": None, "mentioned_vault": None}

    breadth_ratio = tvl_breadth_ratio if tvl_breadth_ratio is not None else row_breadth_ratio
    broad_move = breadth_ratio >= 0.75
    if breadth_ratio >= 0.95:
        breadth_label = "Nearly all tracked vault TVL"
    elif breadth_ratio >= 0.75:
        breadth_label = "Most tracked vault TVL"
    elif breadth_ratio >= 0.4:
        breadth_label = "A meaningful share of tracked vault TVL"
    else:
        breadth_label = "A narrow slice of tracked vault TVL"

    standout_tvl_share = (
        standout_est_tvl / total_tvl
        if standout_est_tvl is not None and total_tvl and total_tvl > 0
        else None
    )
    standout_not_representative = (
        standout_est_apy is not None
        and est_reference is not None
        and standout_tvl_share is not None
        and standout_tvl_share < 0.05
        and (standout_est_apy - est_reference) >= 0.03
    )
    named_standout = None
    if standout_est_symbol and not standout_est_symbol.startswith("0x"):
        named_standout = standout_est_symbol.strip()
    standout_tvl_text = _format_compact_usd(standout_est_tvl)
    mention_named_vault = bool(standout_not_representative and named_standout and standout_tvl_text)
    mentioned_vault: dict[str, str] | None = None

    if baseline_gap is None or abs(baseline_gap) < baseline_gap_threshold:
        if realized_delta is not None and realized_delta <= -delta_threshold:
            first_sentence = f"{breadth_label} is still earning about what it was a month ago, but the last week softened."
        elif realized_delta is not None and realized_delta >= delta_threshold:
            first_sentence = f"{breadth_label} is still earning about what it was a month ago, but the last week improved."
        else:
            first_sentence = f"{breadth_label} is earning about what it was a month ago."
    elif baseline_gap < 0:
        first_sentence = f"{breadth_label} is earning less than it was a month ago."
    else:
        first_sentence = f"{breadth_label} is earning more than it was a month ago."

    if standout_not_representative and mention_named_vault and named_standout and standout_tvl_text:
        second_sentence = (
            f"{named_standout} still shows the highest estimated APY, but its {standout_tvl_text} pool is too small to change the broader picture."
        )
        mentioned_vault_href = _yearn_vault_url(standout_est_chain_id, standout_est_vault_address)
        if mentioned_vault_href:
            mentioned_vault = {"symbol": named_standout, "href": mentioned_vault_href}
    elif standout_not_representative:
        second_sentence = "A few standout estimated APYs remain too isolated to represent where most TVL is earning."
    elif realized_delta is None:
        second_sentence = "The current mix is too patchy to say much more than that."
    elif realized_delta <= -delta_threshold and broad_move:
        if est_gap is not None and est_gap > est_gap_threshold:
            second_sentence = "A few names still show stronger estimated APY, but not enough of the set is moving with them."
        else:
            second_sentence = "Estimated APY is softening with the set rather than offsetting it."
    elif realized_delta <= -delta_threshold:
        second_sentence = "The weaker yields are still concentrated rather than broad across the set."
    elif realized_delta >= delta_threshold and broad_move:
        if est_gap is not None and est_gap < -est_gap_threshold:
            second_sentence = "Realized yields have improved across the set, even if estimated APY has not fully caught up yet."
        else:
            second_sentence = "Estimated APY is improving with the set rather than in just a few names."
    elif realized_delta >= delta_threshold:
        second_sentence = "The stronger yields are still concentrated rather than broad across the set."
    elif broad_move:
        second_sentence = "High estimated APYs are still concentrated rather than broadening the set."
    else:
        second_sentence = "The broader picture is steady, even if a few names still stand out."

    return {"summary": f"{first_sentence} {second_sentence}", "mentioned_vault": mentioned_vault}


def _overview_note_response() -> JSONResponse:
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                payload = _build_overview_note_summary(_overview_note_snapshot(cur))
    except Exception as exc:
        return JSONResponse(status_code=503, content={"summary": None, "mentioned_vault": None, "error": str(exc)})

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
) -> dict[str, object]:
    where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
    cur.execute(
        f"""
        SELECT
            COUNT(*) AS harvest_count,
            COUNT(DISTINCT h.vault_address) AS vault_count,
            COUNT(DISTINCT h.strategy_address) AS strategy_count
        FROM vault_harvests h
        WHERE h.block_time >= NOW() - INTERVAL '24 hours'
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
) -> list[dict[str, object]]:
    where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
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
) -> list[dict[str, object]]:
    if vault_address:
        where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
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
) -> list[dict[str, object]]:
    where_sql, params = _harvest_where_clause(chain_id=chain_id, vault_address=vault_address)
    params["days"] = days
    params["limit"] = limit
    cur.execute(
        f"""
        SELECT
            h.chain_id,
            h.block_time,
            h.tx_hash,
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
            h.gain::text AS gain,
            h.loss::text AS loss,
            h.debt_after::text AS debt_after,
            h.fee_assets::text AS fee_assets,
            h.refund_assets::text AS refund_assets
        FROM vault_harvests h
        LEFT JOIN vault_dim d
          ON d.chain_id = h.chain_id
         AND LOWER(d.vault_address) = LOWER(h.vault_address)
        WHERE h.block_time >= NOW() - (%(days)s * INTERVAL '1 day')
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
            "vault_address": row["vault_address"],
            "vault_symbol": row["vault_symbol"],
            "token_symbol": row["token_symbol"],
            "token_decimals": row["token_decimals"],
            "vault_version": row["vault_version"],
            "strategy_address": row["strategy_address"],
            "gain": row["gain"],
            "loss": row["loss"],
            "debt_after": row["debt_after"],
            "fee_assets": row["fee_assets"],
            "refund_assets": row["refund_assets"],
        }
        for row in rows
    ]
