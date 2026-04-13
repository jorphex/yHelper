from __future__ import annotations

import time
from datetime import UTC, datetime
from json import loads
from urllib.request import Request, urlopen

import psycopg
from psycopg.rows import dict_row

from app.common import (
    _raw_current_debt_usd_sum_sql,
    _raw_hidden_sql,
    _raw_retired_sql,
    _seconds_since,
    _to_float_or_none,
    _user_visible_filter_sql,
)
from app.config import (
    APY_MAX,
    APY_MIN,
    DEFAULT_MIN_TVL_USD,
    EXCLUDED_CHAIN_IDS,
    KONG_REST_VAULTS_URL,
    SOCIAL_PREVIEW_LIVE_TTL_SEC,
    USER_VISIBLE_KIND,
    USER_VISIBLE_VERSION_PREFIX,
)

_SOCIAL_PREVIEW_LIVE_CACHE: dict[str, float | dict[str, object] | None] = {
    "fetched_at": 0.0,
    "highest_est_apy_vault": None,
}


def _freshness_snapshot(
    conn: psycopg.Connection, *, stale_threshold_seconds: int, split_limit: int = 8, min_tvl_usd: float = DEFAULT_MIN_TVL_USD
) -> dict[str, object]:
    now = datetime.now(UTC)
    now_epoch = int(now.timestamp())
    result: dict[str, object] = {
        "as_of_utc": now.isoformat(),
        "stale_threshold_seconds": stale_threshold_seconds,
        "stale_threshold_hours": round(stale_threshold_seconds / 3600, 2),
        "min_tvl_usd": min_tvl_usd,
        "latest_pps_at": None,
        "latest_pps_age_seconds": None,
        "pps_vaults_total": 0,
        "pps_vaults_stale": 0,
        "pps_stale_ratio": None,
        "metrics_rows": 0,
        "metrics_newest_point_at": None,
        "metrics_newest_age_seconds": None,
        "stale_by_chain": [],
        "stale_by_category": [],
        "ingestion_jobs": {},
        "alerts": {},
    }
    job_names = ("kong_vault_snapshot", "kong_pps_metrics")

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            WITH latest AS (
                SELECT p.chain_id, p.vault_address, MAX(p.ts) AS latest_ts
                FROM pps_timeseries p
                GROUP BY p.chain_id, p.vault_address
            ),
            counts AS (
                SELECT p.chain_id, p.vault_address, COUNT(*) AS points_count
                FROM pps_timeseries p
                GROUP BY p.chain_id, p.vault_address
            )
            SELECT
                MAX(to_timestamp(l.latest_ts)) AS latest_pps_at,
                SUM(c.points_count) AS pps_points,
                COUNT(*) AS pps_vaults
            FROM latest l
            JOIN counts c
              ON c.chain_id = l.chain_id
             AND c.vault_address = l.vault_address
            JOIN vault_dim d
              ON d.chain_id = l.chain_id
             AND d.vault_address = l.vault_address
             AND {_user_visible_filter_sql("d", include_retired=False)}
             AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            """,
            {"min_tvl_usd": min_tvl_usd},
        )
        row = cur.fetchone() or {}
        latest_pps_at = row.get("latest_pps_at")
        result["latest_pps_at"] = latest_pps_at.isoformat() if latest_pps_at else None
        result["latest_pps_age_seconds"] = _seconds_since(latest_pps_at, now)

        cur.execute(
            f"""
            WITH latest AS (
                SELECT chain_id, vault_address, MAX(ts) AS latest_ts
                FROM pps_timeseries
                GROUP BY chain_id, vault_address
            )
            SELECT
                COUNT(*) AS pps_vaults_total,
                COUNT(*) FILTER (WHERE %(now_epoch)s - latest_ts > %(stale_threshold)s) AS pps_vaults_stale
            FROM latest l
            JOIN vault_dim d
              ON d.chain_id = l.chain_id
             AND d.vault_address = l.vault_address
             AND {_user_visible_filter_sql("d", include_retired=False)}
             AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            """,
            {"now_epoch": now_epoch, "stale_threshold": stale_threshold_seconds, "min_tvl_usd": min_tvl_usd},
        )
        row = cur.fetchone() or {}
        pps_vaults_total = int(row.get("pps_vaults_total") or 0)
        pps_vaults_stale = int(row.get("pps_vaults_stale") or 0)
        result["pps_vaults_total"] = pps_vaults_total
        result["pps_vaults_stale"] = pps_vaults_stale
        result["pps_stale_ratio"] = (pps_vaults_stale / pps_vaults_total) if pps_vaults_total > 0 else None

        cur.execute(
            """
            SELECT
                COUNT(*) AS metrics_rows,
                MAX(last_point_time) AS metrics_newest_point_at
            FROM vault_metrics_latest
            """
        )
        row = cur.fetchone() or {}
        metrics_newest = row.get("metrics_newest_point_at")
        result["metrics_rows"] = int(row.get("metrics_rows") or 0)
        result["metrics_newest_point_at"] = metrics_newest.isoformat() if metrics_newest else None
        result["metrics_newest_age_seconds"] = _seconds_since(metrics_newest, now)

        cur.execute(
            f"""
            WITH latest AS (
                SELECT chain_id, vault_address, MAX(ts) AS latest_ts
                FROM pps_timeseries
                GROUP BY chain_id, vault_address
            ),
            annotated AS (
                SELECT
                    l.chain_id,
                    l.vault_address,
                    l.latest_ts,
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (%(now_epoch)s - l.latest_ts) AS age_seconds
                FROM latest l
                JOIN vault_dim d
                 ON d.chain_id = l.chain_id
                 AND d.vault_address = l.vault_address
                 AND {_user_visible_filter_sql("d", include_retired=False)}
                 AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            )
            SELECT
                chain_id,
                COUNT(*) AS vaults,
                COUNT(*) FILTER (WHERE age_seconds > %(stale_threshold)s) AS stale_vaults,
                CASE
                    WHEN COUNT(*) > 0
                    THEN (COUNT(*) FILTER (WHERE age_seconds > %(stale_threshold)s))::DOUBLE PRECISION / COUNT(*)
                    ELSE NULL
                END AS stale_ratio,
                SUM(tvl_usd) AS tvl_usd,
                SUM(tvl_usd) FILTER (WHERE age_seconds > %(stale_threshold)s) AS stale_tvl_usd
            FROM annotated
            GROUP BY chain_id
            ORDER BY stale_ratio DESC NULLS LAST, stale_vaults DESC, tvl_usd DESC
            LIMIT %(split_limit)s
            """,
            {
                "now_epoch": now_epoch,
                "stale_threshold": stale_threshold_seconds,
                "split_limit": split_limit,
                "min_tvl_usd": min_tvl_usd,
            },
        )
        result["stale_by_chain"] = cur.fetchall()

        cur.execute(
            f"""
            WITH latest AS (
                SELECT chain_id, vault_address, MAX(ts) AS latest_ts
                FROM pps_timeseries
                GROUP BY chain_id, vault_address
            ),
            annotated AS (
                SELECT
                    l.chain_id,
                    l.vault_address,
                    l.latest_ts,
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (%(now_epoch)s - l.latest_ts) AS age_seconds
                FROM latest l
                JOIN vault_dim d
                 ON d.chain_id = l.chain_id
                 AND d.vault_address = l.vault_address
                 AND {_user_visible_filter_sql("d", include_retired=False)}
                 AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            )
            SELECT
                category,
                COUNT(*) AS vaults,
                COUNT(*) FILTER (WHERE age_seconds > %(stale_threshold)s) AS stale_vaults,
                CASE
                    WHEN COUNT(*) > 0
                    THEN (COUNT(*) FILTER (WHERE age_seconds > %(stale_threshold)s))::DOUBLE PRECISION / COUNT(*)
                    ELSE NULL
                END AS stale_ratio,
                SUM(tvl_usd) AS tvl_usd,
                SUM(tvl_usd) FILTER (WHERE age_seconds > %(stale_threshold)s) AS stale_tvl_usd
            FROM annotated
            GROUP BY category
            ORDER BY stale_ratio DESC NULLS LAST, stale_vaults DESC, tvl_usd DESC
            LIMIT %(split_limit)s
            """,
            {
                "now_epoch": now_epoch,
                "stale_threshold": stale_threshold_seconds,
                "split_limit": split_limit,
                "min_tvl_usd": min_tvl_usd,
            },
        )
        result["stale_by_category"] = cur.fetchall()

        jobs: dict[str, dict[str, object]] = {}
        for job_name in job_names:
            cur.execute(
                """
                SELECT
                    MAX(started_at) FILTER (WHERE status = 'running') AS running_started_at,
                    MAX(ended_at) FILTER (WHERE status = 'success') AS last_success_at,
                    MAX(started_at) FILTER (WHERE status = 'failed') AS last_failed_at
                FROM ingestion_runs
                WHERE job_name = %s
                """,
                (job_name,),
            )
            job_row = cur.fetchone() or {}
            running_started_at = job_row.get("running_started_at")
            last_success_at = job_row.get("last_success_at")
            last_failed_at = job_row.get("last_failed_at")
            jobs[job_name] = {
                "running": running_started_at is not None,
                "running_for_seconds": _seconds_since(running_started_at, now),
                "last_success_at": last_success_at.isoformat() if last_success_at else None,
                "last_success_age_seconds": _seconds_since(last_success_at, now),
                "last_failed_at": last_failed_at.isoformat() if last_failed_at else None,
                "last_failed_age_seconds": _seconds_since(last_failed_at, now),
            }
        result["ingestion_jobs"] = jobs

        cur.execute("SELECT to_regclass('public.alert_state') AS table_name")
        alert_table = (cur.fetchone() or {}).get("table_name")
        if alert_table:
            cur.execute(
                """
                SELECT
                    alert_key,
                    job_name,
                    status,
                    threshold_seconds,
                    current_age_seconds,
                    last_success_at,
                    last_checked_at,
                    last_fired_at,
                    last_recovered_at,
                    last_notified_at,
                    notify_channels,
                    last_notify_result
                FROM alert_state
                WHERE job_name = ANY(%s)
                ORDER BY alert_key
                """,
                (list(job_names),),
            )
            alerts: dict[str, object] = {}
            for row in cur.fetchall():
                alert_key = row.get("alert_key")
                if not alert_key:
                    continue
                alerts[str(alert_key)] = {
                    "job_name": row.get("job_name"),
                    "status": row.get("status"),
                    "is_firing": row.get("status") == "firing",
                    "threshold_seconds": row.get("threshold_seconds"),
                    "current_age_seconds": row.get("current_age_seconds"),
                    "last_success_at": row.get("last_success_at").isoformat() if row.get("last_success_at") else None,
                    "last_checked_at": row.get("last_checked_at").isoformat() if row.get("last_checked_at") else None,
                    "last_fired_at": row.get("last_fired_at").isoformat() if row.get("last_fired_at") else None,
                    "last_recovered_at": row.get("last_recovered_at").isoformat()
                    if row.get("last_recovered_at")
                    else None,
                    "last_notified_at": row.get("last_notified_at").isoformat() if row.get("last_notified_at") else None,
                    "notify_channels": row.get("notify_channels") or [],
                    "last_notify_result": row.get("last_notify_result"),
                }
            result["alerts"] = alerts

    return result


def _fetch_kong_vaults() -> list[dict]:
    request = Request(KONG_REST_VAULTS_URL, headers={"User-Agent": "yHelper/0.1"})
    with urlopen(request, timeout=8.0) as response:
        payload = loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, list) else []


def _extract_kong_est_apy(vault: dict[str, object]) -> float | None:
    performance = vault.get("performance")
    performance_obj = performance if isinstance(performance, dict) else {}
    oracle = performance_obj.get("oracle")
    oracle_obj = oracle if isinstance(oracle, dict) else {}
    for key in ("apy", "netAPY", "netApy"):
        value = oracle_obj.get(key)
        parsed = _to_float_or_none(value)
        if parsed is not None:
            return parsed
    return None


def _extract_kong_tvl_usd(vault: dict[str, object]) -> float | None:
    tvl = vault.get("tvl")
    if isinstance(tvl, dict):
        return _to_float_or_none(tvl.get("close") if "close" in tvl else tvl.get("tvl"))
    return _to_float_or_none(tvl)


def _live_social_preview_highest_vault() -> dict[str, object]:
    now_mono = time.monotonic()
    cached_at = float(_SOCIAL_PREVIEW_LIVE_CACHE.get("fetched_at") or 0.0)
    cached_value = _SOCIAL_PREVIEW_LIVE_CACHE.get("highest_est_apy_vault")
    if cached_value is not None and now_mono - cached_at < SOCIAL_PREVIEW_LIVE_TTL_SEC:
        return dict(cached_value)

    best: dict[str, object] = {}
    best_score = float("-inf")
    best_tvl = float("-inf")
    try:
        for vault in _fetch_kong_vaults():
            if not isinstance(vault, dict):
                continue
            if str(vault.get("kind") or "") != USER_VISIBLE_KIND:
                continue
            if not str(vault.get("apiVersion") or vault.get("version") or "").startswith(USER_VISIBLE_VERSION_PREFIX):
                continue
            raw_chain_id = vault.get("chainID") or vault.get("chainId") or vault.get("chain_id")
            try:
                chain_id = int(raw_chain_id) if raw_chain_id is not None else None
            except (TypeError, ValueError):
                chain_id = None
            if chain_id is None or chain_id in EXCLUDED_CHAIN_IDS:
                continue
            if bool(vault.get("isHidden")) or bool(vault.get("isRetired")):
                continue
            est_apy = _extract_kong_est_apy(vault)
            if est_apy is None:
                continue
            tvl_usd = _extract_kong_tvl_usd(vault)
            candidate_tvl = float("-inf") if tvl_usd is None else tvl_usd
            if est_apy < best_score or (est_apy == best_score and candidate_tvl <= best_tvl):
                continue
            best_score = est_apy
            best_tvl = candidate_tvl
            best = {
                "vault_address": vault.get("address"),
                "name": vault.get("name"),
                "symbol": vault.get("symbol"),
                "chain_id": chain_id,
                "tvl_usd": tvl_usd,
                "est_apy": est_apy,
                "current_est_apy": est_apy,
                "current_net_apy": est_apy,
                "yield_kind": "estimated_apy",
                "source": "kong_rest_live",
            }
    except Exception:
        if isinstance(cached_value, dict):
            return dict(cached_value)
        return {}

    _SOCIAL_PREVIEW_LIVE_CACHE["fetched_at"] = now_mono
    _SOCIAL_PREVIEW_LIVE_CACHE["highest_est_apy_vault"] = dict(best) if best else None
    return best


def _coverage_snapshot(
    conn: psycopg.Connection, *, min_tvl_usd: float, min_points: int, split_limit: int = 8
) -> dict[str, object]:
    now = datetime.now(UTC)
    params = {"min_tvl_usd": min_tvl_usd, "min_points": min_points, "split_limit": split_limit}
    out: dict[str, object] = {
        "as_of_utc": now.isoformat(),
        "filters": {"min_tvl_usd": min_tvl_usd, "min_points": min_points, "apy_bounds": {"min": APY_MIN, "max": APY_MAX}},
        "global": {
            "active_vaults": 0,
            "eligible_vaults": 0,
            "excluded_vaults": 0,
            "missing_metrics": 0,
            "below_tvl": 0,
            "low_points": 0,
            "active_tvl_usd": 0.0,
            "eligible_tvl_usd": 0.0,
            "excluded_tvl_usd": 0.0,
        },
        "by_chain": [],
        "by_category": [],
    }

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            WITH base AS (
                SELECT
                    d.vault_address,
                    COALESCE(d.chain_id, -1) AS chain_id,
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (m.vault_address IS NOT NULL) AS has_metrics,
                    (m.apy_30d IS NOT NULL) AS has_scoreable_apy,
                    (COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s) AS pass_tvl,
                    (COALESCE(m.points_count, 0) >= %(min_points)s) AS pass_points
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {_user_visible_filter_sql("d", include_retired=False)}
            )
            SELECT
                COUNT(*) AS active_vaults,
                COUNT(*) FILTER (WHERE has_scoreable_apy AND pass_tvl AND pass_points) AS eligible_vaults,
                COUNT(*) FILTER (WHERE NOT has_metrics OR (pass_points AND NOT has_scoreable_apy)) AS missing_metrics,
                COUNT(*) FILTER (WHERE has_scoreable_apy AND NOT pass_tvl) AS below_tvl,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND NOT pass_points) AS low_points,
                SUM(tvl_usd) AS active_tvl_usd,
                SUM(tvl_usd) FILTER (WHERE has_scoreable_apy AND pass_tvl AND pass_points) AS eligible_tvl_usd
            FROM base
            """,
            params,
        )
        row = cur.fetchone() or {}
        active_vaults = int(row.get("active_vaults") or 0)
        eligible_vaults = int(row.get("eligible_vaults") or 0)
        active_tvl = float(row.get("active_tvl_usd") or 0.0)
        eligible_tvl = float(row.get("eligible_tvl_usd") or 0.0)

        out["global"] = {
            "active_vaults": active_vaults,
            "eligible_vaults": eligible_vaults,
            "excluded_vaults": max(0, active_vaults - eligible_vaults),
            "missing_metrics": int(row.get("missing_metrics") or 0),
            "below_tvl": int(row.get("below_tvl") or 0),
            "low_points": int(row.get("low_points") or 0),
            "active_tvl_usd": active_tvl,
            "eligible_tvl_usd": eligible_tvl,
            "excluded_tvl_usd": max(0.0, active_tvl - eligible_tvl),
        }

        cur.execute(
            f"""
            WITH base AS (
                SELECT
                    COALESCE(d.chain_id, -1) AS chain_id,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (m.vault_address IS NOT NULL) AS has_metrics,
                    (m.apy_30d IS NOT NULL) AS has_scoreable_apy,
                    (COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s) AS pass_tvl,
                    (COALESCE(m.points_count, 0) >= %(min_points)s) AS pass_points
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {_user_visible_filter_sql("d", include_retired=False)}
            )
            SELECT
                chain_id,
                COUNT(*) AS active_vaults,
                COUNT(*) FILTER (WHERE has_scoreable_apy AND pass_tvl AND pass_points) AS eligible_vaults,
                COUNT(*) FILTER (WHERE NOT has_metrics OR (pass_points AND NOT has_scoreable_apy)) AS missing_metrics,
                COUNT(*) FILTER (WHERE has_scoreable_apy AND NOT pass_tvl) AS below_tvl,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND NOT pass_points) AS low_points,
                SUM(tvl_usd) AS active_tvl_usd,
                SUM(tvl_usd) FILTER (WHERE has_scoreable_apy AND pass_tvl AND pass_points) AS eligible_tvl_usd
            FROM base
            GROUP BY chain_id
            ORDER BY eligible_tvl_usd DESC NULLS LAST, active_tvl_usd DESC
            LIMIT %(split_limit)s
            """,
            params,
        )
        out["by_chain"] = cur.fetchall()

        cur.execute(
            f"""
            WITH base AS (
                SELECT
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (m.vault_address IS NOT NULL) AS has_metrics,
                    (m.apy_30d IS NOT NULL) AS has_scoreable_apy,
                    (COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s) AS pass_tvl,
                    (COALESCE(m.points_count, 0) >= %(min_points)s) AS pass_points
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.chain_id = d.chain_id AND m.vault_address = d.vault_address
                WHERE {_user_visible_filter_sql("d", include_retired=False)}
            )
            SELECT
                category,
                COUNT(*) AS active_vaults,
                COUNT(*) FILTER (WHERE has_scoreable_apy AND pass_tvl AND pass_points) AS eligible_vaults,
                COUNT(*) FILTER (WHERE NOT has_metrics OR (pass_points AND NOT has_scoreable_apy)) AS missing_metrics,
                COUNT(*) FILTER (WHERE has_scoreable_apy AND NOT pass_tvl) AS below_tvl,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND NOT pass_points) AS low_points,
                SUM(tvl_usd) AS active_tvl_usd,
                SUM(tvl_usd) FILTER (WHERE has_scoreable_apy AND pass_tvl AND pass_points) AS eligible_tvl_usd
            FROM base
            GROUP BY category
            ORDER BY eligible_tvl_usd DESC NULLS LAST, active_tvl_usd DESC
            LIMIT %(split_limit)s
            """,
            params,
        )
        out["by_category"] = cur.fetchall()
    return out


def _tracked_scope_snapshot(cur: psycopg.Cursor) -> dict[str, object]:
    cur.execute(
        f"""
        WITH all_vaults AS (
            SELECT
                d.chain_id,
                d.vault_address,
                d.active,
                COALESCE(d.kind, '') AS kind,
                COALESCE(d.tvl_usd, 0.0)::numeric AS tvl_usd,
                {_raw_retired_sql('d')} AS is_retired,
                {_raw_hidden_sql('d')} AS is_hidden
            FROM vault_dim d
        ),
        active_visible AS (
            SELECT *
            FROM all_vaults
            WHERE active = TRUE
              AND is_retired = FALSE
              AND is_hidden = FALSE
        ),
        strategy_debt_usd AS (
            {_raw_current_debt_usd_sum_sql('m')}
            WHERE m.active = TRUE
              AND COALESCE(m.kind, '') = 'Multi Strategy'
              AND {_raw_retired_sql('m')} = FALSE
              AND {_raw_hidden_sql('m')} = FALSE
            GROUP BY 1, 2
        ),
        single_independent AS (
            SELECT
                SUM(
                    GREATEST(
                        a.tvl_usd - COALESCE(sd.debt_usd, 0),
                        0
                    )
                ) AS tvl_usd
            FROM active_visible a
            LEFT JOIN strategy_debt_usd sd
              ON sd.chain_id = a.chain_id
             AND sd.vault_address = a.vault_address
            WHERE a.kind = 'Single Strategy'
        ),
        multi_visible AS (
            SELECT SUM(a.tvl_usd) AS tvl_usd
            FROM active_visible a
            WHERE a.kind = 'Multi Strategy'
        ),
        other_visible AS (
            SELECT SUM(a.tvl_usd) AS tvl_usd
            FROM active_visible a
            WHERE a.kind NOT IN ('Multi Strategy', 'Single Strategy')
        )
        SELECT
            (SELECT COUNT(*) FROM all_vaults) AS total_vaults,
            (SELECT COUNT(*) FROM active_visible) AS active_vaults,
            (
                COALESCE((SELECT tvl_usd FROM multi_visible), 0)
                + COALESCE((SELECT tvl_usd FROM single_independent), 0)
                + COALESCE((SELECT tvl_usd FROM other_visible), 0)
            )::double precision AS tracked_tvl_active_usd,
            (
                SELECT COUNT(DISTINCT (a.chain_id, a.vault_address))
                FROM active_visible a
                JOIN vault_metrics_latest m
                  ON m.chain_id = a.chain_id
                 AND m.vault_address = a.vault_address
                WHERE m.apy_30d IS NOT NULL
            ) AS active_with_metrics
        """
    )
    row = cur.fetchone() or {}
    return {
        "total_vaults": int(row.get("total_vaults") or 0),
        "active_vaults": int(row.get("active_vaults") or 0),
        "tracked_tvl_active_usd": _to_float_or_none(row.get("tracked_tvl_active_usd")),
        "active_with_metrics": int(row.get("active_with_metrics") or 0),
        "criteria": {
            "active": True,
            "exclude_hidden": True,
            "exclude_retired": True,
            "tracked_tvl_method": "debt_adjusted_single_strategy_overlap",
        },
    }


def _yearn_scope_filter_sql(alias: str, *, include_hidden: bool, include_retired: bool, include_fantom: bool) -> str:
    clauses = [f"{alias}.active = TRUE"]
    if not include_hidden:
        clauses.append(f"{_raw_hidden_sql(alias)} = FALSE")
    if not include_retired:
        clauses.append(f"{_raw_retired_sql(alias)} = FALSE")
    if not include_fantom:
        clauses.append(f"COALESCE({alias}.chain_id, -1) <> 250")
    return " AND ".join(clauses)


def _deduped_yearn_scope_snapshot(
    cur: psycopg.Cursor,
    *,
    include_hidden: bool,
    include_retired: bool,
    include_fantom: bool,
) -> dict[str, object]:
    scope_sql = _yearn_scope_filter_sql(
        "d",
        include_hidden=include_hidden,
        include_retired=include_retired,
        include_fantom=include_fantom,
    )
    parent_scope_sql = _yearn_scope_filter_sql(
        "m",
        include_hidden=include_hidden,
        include_retired=include_retired,
        include_fantom=include_fantom,
    )
    cur.execute(
        f"""
        WITH in_scope AS (
            SELECT
                d.chain_id,
                LOWER(d.vault_address) AS vault_address,
                COALESCE(d.kind, '') AS kind,
                COALESCE(d.tvl_usd, 0.0)::numeric AS tvl_usd
            FROM vault_dim d
            WHERE {scope_sql}
        ),
        strategy_debt_usd AS (
            {_raw_current_debt_usd_sum_sql('m')}
            WHERE {parent_scope_sql}
              AND COALESCE(m.kind, '') = 'Multi Strategy'
            GROUP BY 1, 2
        )
        SELECT
            COUNT(*) AS vaults,
            COUNT(*) FILTER (WHERE kind = 'Multi Strategy') AS multi_vaults,
            COUNT(*) FILTER (WHERE kind = 'Single Strategy') AS single_vaults,
            COUNT(*) FILTER (WHERE kind NOT IN ('Multi Strategy', 'Single Strategy')) AS other_vaults,
            SUM(tvl_usd) FILTER (WHERE kind = 'Multi Strategy') AS multi_tvl_usd,
            SUM(tvl_usd) FILTER (WHERE kind = 'Single Strategy') AS single_raw_tvl_usd,
            SUM(GREATEST(tvl_usd - COALESCE(sd.debt_usd, 0), 0)) FILTER (WHERE kind = 'Single Strategy') AS single_deduped_tvl_usd,
            SUM(tvl_usd) FILTER (WHERE kind NOT IN ('Multi Strategy', 'Single Strategy')) AS other_tvl_usd
        FROM in_scope s
        LEFT JOIN strategy_debt_usd sd
          ON sd.chain_id = s.chain_id
         AND sd.vault_address = s.vault_address
        """
    )
    row = cur.fetchone() or {}
    multi_tvl_usd = _to_float_or_none(row.get("multi_tvl_usd")) or 0.0
    single_raw_tvl_usd = _to_float_or_none(row.get("single_raw_tvl_usd")) or 0.0
    single_deduped_tvl_usd = _to_float_or_none(row.get("single_deduped_tvl_usd")) or 0.0
    other_tvl_usd = _to_float_or_none(row.get("other_tvl_usd")) or 0.0
    return {
        "vaults": int(row.get("vaults") or 0),
        "tvl_usd": multi_tvl_usd + single_deduped_tvl_usd + other_tvl_usd,
        "criteria": {
            "active": True,
            "include_hidden": include_hidden,
            "include_retired": include_retired,
            "include_fantom": include_fantom,
            "tvl_method": "deduped_multi_single_overlap",
        },
        "components": {
            "multi_vaults": int(row.get("multi_vaults") or 0),
            "single_vaults": int(row.get("single_vaults") or 0),
            "other_vaults": int(row.get("other_vaults") or 0),
            "multi_tvl_usd": multi_tvl_usd,
            "single_raw_tvl_usd": single_raw_tvl_usd,
            "single_deduped_tvl_usd": single_deduped_tvl_usd,
            "removed_overlap_usd": max(0.0, single_raw_tvl_usd - single_deduped_tvl_usd),
            "other_tvl_usd": other_tvl_usd,
        },
    }


def _protocol_context_snapshot(
    *,
    current_yearn: dict[str, object] | None,
    total_yearn: dict[str, object] | None,
) -> dict[str, object]:
    return {
        "source": "internal",
        "status": "ok",
        "as_of_utc": datetime.now(UTC).isoformat(),
        "current_yearn": current_yearn if isinstance(current_yearn, dict) else {},
        "total_yearn": total_yearn if isinstance(total_yearn, dict) else {},
    }
