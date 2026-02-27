from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from json import loads
from typing import Literal
from urllib.request import Request, urlopen

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import psycopg
from psycopg.rows import dict_row


def _parse_origins(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


app = FastAPI(title="yHelper API", version="0.1.0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://yhelper:change_me@yhelper-postgres:5432/yhelper")
APY_MIN = float(os.getenv("API_APY_MIN", "-0.95"))
APY_MAX = float(os.getenv("API_APY_MAX", "3.0"))
MOMENTUM_ABS_MAX = float(os.getenv("API_MOMENTUM_ABS_MAX", "1.0"))
DEFAULT_MIN_TVL_USD = float(os.getenv("API_MIN_TVL_USD", "100000"))
DEFAULT_MIN_POINTS = int(os.getenv("API_MIN_POINTS", "30"))
UNIVERSE_CORE_MIN_TVL_USD = float(os.getenv("API_UNIVERSE_CORE_MIN_TVL_USD", "1000000"))
UNIVERSE_EXTENDED_MIN_TVL_USD = float(os.getenv("API_UNIVERSE_EXTENDED_MIN_TVL_USD", "250000"))
UNIVERSE_RAW_MIN_TVL_USD = float(os.getenv("API_UNIVERSE_RAW_MIN_TVL_USD", "0"))
UNIVERSE_CORE_MIN_POINTS = int(os.getenv("API_UNIVERSE_CORE_MIN_POINTS", "45"))
UNIVERSE_EXTENDED_MIN_POINTS = int(os.getenv("API_UNIVERSE_EXTENDED_MIN_POINTS", "20"))
UNIVERSE_RAW_MIN_POINTS = int(os.getenv("API_UNIVERSE_RAW_MIN_POINTS", "0"))
UNIVERSE_CORE_MAX_VAULTS = int(os.getenv("API_UNIVERSE_CORE_MAX_VAULTS", "250"))
UNIVERSE_EXTENDED_MAX_VAULTS = int(os.getenv("API_UNIVERSE_EXTENDED_MAX_VAULTS", "700"))
UNIVERSE_RAW_MAX_VAULTS = int(os.getenv("API_UNIVERSE_RAW_MAX_VAULTS", "0"))
DEFI_LLAMA_PROTOCOL_URL = os.getenv("DEFI_LLAMA_PROTOCOL_URL", "https://api.llama.fi/protocol/yearn-finance")
DEFI_LLAMA_TIMEOUT_SEC = float(os.getenv("DEFI_LLAMA_TIMEOUT_SEC", "8"))
DEFI_LLAMA_CACHE_TTL_SEC = int(os.getenv("DEFI_LLAMA_CACHE_TTL_SEC", "600"))

_defillama_cache: dict[str, object] = {"fetched_at_epoch": 0.0, "snapshot": None}

cors_origins = _parse_origins(os.getenv("CORS_ORIGINS", "http://localhost:3010"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _seconds_since(ts: datetime | None, now: datetime) -> int | None:
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return max(0, int((now - ts).total_seconds()))


def _resolve_universe_gate(
    universe: Literal["core", "extended", "raw"],
    *,
    min_tvl_usd: float | None,
    min_points: int | None,
    max_vaults: int | None,
) -> dict[str, float | int | str | None]:
    defaults = {
        "core": {
            "min_tvl_usd": UNIVERSE_CORE_MIN_TVL_USD,
            "min_points": UNIVERSE_CORE_MIN_POINTS,
            "max_vaults": UNIVERSE_CORE_MAX_VAULTS,
        },
        "extended": {
            "min_tvl_usd": UNIVERSE_EXTENDED_MIN_TVL_USD,
            "min_points": UNIVERSE_EXTENDED_MIN_POINTS,
            "max_vaults": UNIVERSE_EXTENDED_MAX_VAULTS,
        },
        "raw": {
            "min_tvl_usd": UNIVERSE_RAW_MIN_TVL_USD,
            "min_points": UNIVERSE_RAW_MIN_POINTS,
            "max_vaults": UNIVERSE_RAW_MAX_VAULTS,
        },
    }
    fallback = defaults[universe]
    resolved_min_tvl_usd = float(fallback["min_tvl_usd"] if min_tvl_usd is None else min_tvl_usd)
    resolved_min_points = int(fallback["min_points"] if min_points is None else min_points)
    resolved_max_vaults = int(fallback["max_vaults"] if max_vaults is None else max_vaults)
    if resolved_max_vaults <= 0:
        resolved_max_vaults = None
    return {
        "universe": universe,
        "min_tvl_usd": resolved_min_tvl_usd,
        "min_points": resolved_min_points,
        "max_vaults": resolved_max_vaults,
        "defaults": fallback,
    }


def _rank_gate_filter_sql(alias: str, *, max_vaults: int | None) -> str:
    if max_vaults is None or max_vaults <= 0:
        return ""
    return """
    {alias}.vault_address IN (
        SELECT r.vault_address
        FROM vault_dim r
        WHERE r.active = TRUE
        ORDER BY r.feature_score DESC NULLS LAST, r.tvl_usd DESC NULLS LAST, r.vault_address
        LIMIT %(max_vaults)s
    )
    """.format(alias=alias)


def _freshness_snapshot(
    conn: psycopg.Connection, *, stale_threshold_seconds: int, split_limit: int = 8
) -> dict[str, object]:
    now = datetime.now(UTC)
    now_epoch = int(now.timestamp())
    result: dict[str, object] = {
        "as_of_utc": now.isoformat(),
        "stale_threshold_seconds": stale_threshold_seconds,
        "stale_threshold_hours": round(stale_threshold_seconds / 3600, 2),
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
    job_names = ("ydaemon_snapshot", "kong_pps_metrics")

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
                MAX(to_timestamp(ts)) AS latest_pps_at,
                COUNT(*) AS pps_points,
                COUNT(DISTINCT vault_address) AS pps_vaults
            FROM pps_timeseries
            """
        )
        row = cur.fetchone() or {}
        latest_pps_at = row.get("latest_pps_at")
        result["latest_pps_at"] = latest_pps_at.isoformat() if latest_pps_at else None
        result["latest_pps_age_seconds"] = _seconds_since(latest_pps_at, now)

        cur.execute(
            """
            WITH latest AS (
                SELECT vault_address, MAX(ts) AS latest_ts
                FROM pps_timeseries
                GROUP BY vault_address
            )
            SELECT
                COUNT(*) AS pps_vaults_total,
                COUNT(*) FILTER (WHERE %(now_epoch)s - latest_ts > %(stale_threshold)s) AS pps_vaults_stale
            FROM latest
            """,
            {"now_epoch": now_epoch, "stale_threshold": stale_threshold_seconds},
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
            """
            WITH latest AS (
                SELECT vault_address, MAX(ts) AS latest_ts
                FROM pps_timeseries
                GROUP BY vault_address
            ),
            annotated AS (
                SELECT
                    l.vault_address,
                    l.latest_ts,
                    COALESCE(d.chain_id, -1) AS chain_id,
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (%(now_epoch)s - l.latest_ts) AS age_seconds
                FROM latest l
                LEFT JOIN vault_dim d ON d.vault_address = l.vault_address AND d.active = TRUE
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
            },
        )
        result["stale_by_chain"] = cur.fetchall()

        cur.execute(
            """
            WITH latest AS (
                SELECT vault_address, MAX(ts) AS latest_ts
                FROM pps_timeseries
                GROUP BY vault_address
            ),
            annotated AS (
                SELECT
                    l.vault_address,
                    l.latest_ts,
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (%(now_epoch)s - l.latest_ts) AS age_seconds
                FROM latest l
                LEFT JOIN vault_dim d ON d.vault_address = l.vault_address AND d.active = TRUE
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
                ORDER BY alert_key
                """
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
            """
            WITH base AS (
                SELECT
                    d.vault_address,
                    COALESCE(d.chain_id, -1) AS chain_id,
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (m.vault_address IS NOT NULL) AS has_metrics,
                    (COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s) AS pass_tvl,
                    (COALESCE(m.points_count, 0) >= %(min_points)s) AS pass_points
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE d.active = TRUE
            )
            SELECT
                COUNT(*) AS active_vaults,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND pass_points) AS eligible_vaults,
                COUNT(*) FILTER (WHERE NOT has_metrics) AS missing_metrics,
                COUNT(*) FILTER (WHERE has_metrics AND NOT pass_tvl) AS below_tvl,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND NOT pass_points) AS low_points,
                SUM(tvl_usd) AS active_tvl_usd,
                SUM(tvl_usd) FILTER (WHERE has_metrics AND pass_tvl AND pass_points) AS eligible_tvl_usd
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
            """
            WITH base AS (
                SELECT
                    COALESCE(d.chain_id, -1) AS chain_id,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (m.vault_address IS NOT NULL) AS has_metrics,
                    (COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s) AS pass_tvl,
                    (COALESCE(m.points_count, 0) >= %(min_points)s) AS pass_points
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE d.active = TRUE
            )
            SELECT
                chain_id,
                COUNT(*) AS active_vaults,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND pass_points) AS eligible_vaults,
                COUNT(*) FILTER (WHERE NOT has_metrics) AS missing_metrics,
                COUNT(*) FILTER (WHERE has_metrics AND NOT pass_tvl) AS below_tvl,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND NOT pass_points) AS low_points,
                SUM(tvl_usd) AS active_tvl_usd,
                SUM(tvl_usd) FILTER (WHERE has_metrics AND pass_tvl AND pass_points) AS eligible_tvl_usd
            FROM base
            GROUP BY chain_id
            ORDER BY eligible_tvl_usd DESC NULLS LAST, active_tvl_usd DESC
            LIMIT %(split_limit)s
            """,
            params,
        )
        out["by_chain"] = cur.fetchall()

        cur.execute(
            """
            WITH base AS (
                SELECT
                    COALESCE(NULLIF(d.category, ''), 'unknown') AS category,
                    COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                    (m.vault_address IS NOT NULL) AS has_metrics,
                    (COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s) AS pass_tvl,
                    (COALESCE(m.points_count, 0) >= %(min_points)s) AS pass_points
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE d.active = TRUE
            )
            SELECT
                category,
                COUNT(*) AS active_vaults,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND pass_points) AS eligible_vaults,
                COUNT(*) FILTER (WHERE NOT has_metrics) AS missing_metrics,
                COUNT(*) FILTER (WHERE has_metrics AND NOT pass_tvl) AS below_tvl,
                COUNT(*) FILTER (WHERE has_metrics AND pass_tvl AND NOT pass_points) AS low_points,
                SUM(tvl_usd) AS active_tvl_usd,
                SUM(tvl_usd) FILTER (WHERE has_metrics AND pass_tvl AND pass_points) AS eligible_tvl_usd
            FROM base
            GROUP BY category
            ORDER BY eligible_tvl_usd DESC NULLS LAST, active_tvl_usd DESC
            LIMIT %(split_limit)s
            """,
            params,
        )
        out["by_category"] = cur.fetchall()
    return out


def _to_float_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _extract_defillama_tvl_series(raw_tvl: object) -> list[tuple[int, float]]:
    if not isinstance(raw_tvl, list):
        return []
    series: list[tuple[int, float]] = []
    for point in raw_tvl:
        if not isinstance(point, dict):
            continue
        ts_raw = point.get("date")
        try:
            ts = int(ts_raw)
        except (TypeError, ValueError):
            continue
        tvl = _to_float_or_none(point.get("totalLiquidityUSD"))
        if tvl is None:
            continue
        series.append((ts, tvl))
    series.sort(key=lambda item: item[0])
    return series


def _series_change_pct(series: list[tuple[int, float]], *, lookback_days: int) -> float | None:
    if not series:
        return None
    latest_ts, latest_value = series[-1]
    target_ts = latest_ts - (lookback_days * 86400)
    baseline: float | None = None
    for ts, value in reversed(series):
        if ts <= target_ts:
            baseline = value
            break
    if baseline is None:
        baseline = series[0][1]
    if baseline <= 0:
        return None
    return (latest_value / baseline) - 1.0


def _defillama_snapshot() -> dict[str, object]:
    now_epoch = time.time()
    cached = _defillama_cache.get("snapshot")
    fetched_epoch = float(_defillama_cache.get("fetched_at_epoch") or 0.0)
    if isinstance(cached, dict) and (now_epoch - fetched_epoch) <= DEFI_LLAMA_CACHE_TTL_SEC:
        return cached

    try:
        request = Request(
            DEFI_LLAMA_PROTOCOL_URL,
            headers={"User-Agent": "yhelper/0.1"},
        )
        with urlopen(request, timeout=DEFI_LLAMA_TIMEOUT_SEC) as response:
            payload = loads(response.read().decode("utf-8"))

        raw_tvl = payload.get("tvl")
        series = _extract_defillama_tvl_series(raw_tvl)
        tvl_usd = series[-1][1] if series else _to_float_or_none(raw_tvl)
        mcap_usd = _to_float_or_none(payload.get("mcap"))
        mcap_tvl_ratio = (mcap_usd / tvl_usd) if mcap_usd is not None and tvl_usd and tvl_usd > 0 else None
        current_chain_tvls = payload.get("currentChainTvls") or {}
        if not isinstance(current_chain_tvls, dict):
            current_chain_tvls = {}

        top_chains: list[dict[str, object]] = []
        for chain_name, raw_value in current_chain_tvls.items():
            numeric = _to_float_or_none(raw_value)
            if numeric is None:
                continue
            top_chains.append({"chain": str(chain_name), "tvl_usd": numeric})
        top_chains.sort(key=lambda item: float(item.get("tvl_usd") or 0.0), reverse=True)

        snapshot: dict[str, object] = {
            "source": "defillama",
            "source_url": DEFI_LLAMA_PROTOCOL_URL,
            "status": "ok",
            "fetched_at_utc": datetime.now(UTC).isoformat(),
            "cache_ttl_seconds": DEFI_LLAMA_CACHE_TTL_SEC,
            "protocol_name": payload.get("name") or "Yearn Finance",
            "protocol_slug": payload.get("slug") or "yearn-finance",
            "tvl_usd": tvl_usd,
            "mcap_usd": mcap_usd,
            "mcap_tvl_ratio": mcap_tvl_ratio,
            "tvl_change_7d_pct": _series_change_pct(series, lookback_days=7),
            "tvl_change_30d_pct": _series_change_pct(series, lookback_days=30),
            "chain_count": len(top_chains),
            "top_chains": top_chains[:8],
        }
        _defillama_cache["fetched_at_epoch"] = now_epoch
        _defillama_cache["snapshot"] = snapshot
        return snapshot
    except Exception as exc:
        stale = cached if isinstance(cached, dict) else None
        snapshot = {
            "source": "defillama",
            "source_url": DEFI_LLAMA_PROTOCOL_URL,
            "status": "unavailable",
            "fetched_at_utc": datetime.now(UTC).isoformat(),
            "cache_ttl_seconds": DEFI_LLAMA_CACHE_TTL_SEC,
            "error": str(exc),
            "stale_snapshot": stale,
        }
        if stale is not None:
            return {**stale, "status": "stale", "error": str(exc)}
        return snapshot


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta/freshness")
async def meta_freshness(
    threshold: Literal["24h", "7d", "30d"] = "24h",
    split_limit: int = Query(default=8, ge=1, le=25),
) -> dict[str, object]:
    threshold_seconds = {"24h": 24 * 3600, "7d": 7 * 24 * 3600, "30d": 30 * 24 * 3600}[threshold]
    with psycopg.connect(DATABASE_URL) as conn:
        snapshot = _freshness_snapshot(conn, stale_threshold_seconds=threshold_seconds, split_limit=split_limit)
    snapshot["threshold"] = threshold
    return snapshot


@app.get("/api/meta/coverage")
async def meta_coverage(
    min_tvl_usd: float = Query(default=DEFAULT_MIN_TVL_USD, ge=0.0),
    min_points: int = Query(default=DEFAULT_MIN_POINTS, ge=0),
    split_limit: int = Query(default=8, ge=1, le=25),
) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL) as conn:
        return _coverage_snapshot(conn, min_tvl_usd=min_tvl_usd, min_points=min_points, split_limit=split_limit)


@app.get("/api/meta/protocol-context")
async def meta_protocol_context() -> dict[str, object]:
    return _defillama_snapshot()


@app.get("/api/meta/movers")
async def meta_movers(
    window: Literal["24h", "7d", "30d"] = "7d",
    limit: int = Query(default=12, ge=1, le=50),
    min_tvl_usd: float = Query(default=100000.0, ge=0.0),
    min_points: int = Query(default=30, ge=0),
    include_freshness: bool = Query(default=False),
) -> dict[str, object]:
    window_seconds = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}[window]
    params = {
        "window_sec": window_seconds,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
    }
    base_cte = _changes_base_cte()
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                base_cte
                + """
                SELECT
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS tracked_vaults,
                    SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS tracked_tvl_usd,
                    AVG(n.safe_apy_window - n.safe_apy_prev_window) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS avg_delta_apy,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                        AND n.apy_prev_window_raw IS NOT NULL
                        AND (n.safe_apy_window - n.safe_apy_prev_window) > 0
                    ) AS positive_delta_count,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                        AND n.apy_prev_window_raw IS NOT NULL
                        AND (n.safe_apy_window - n.safe_apy_prev_window) < 0
                    ) AS negative_delta_count
                FROM normalized n
                """,
                params,
            )
            summary = cur.fetchone() or {}
            movers = _fetch_change_movers(cur, base_cte=base_cte, params=params, limit=limit)

        freshness = None
        if include_freshness:
            freshness = _freshness_snapshot(conn, stale_threshold_seconds=2 * window_seconds, split_limit=5)

    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "filters": {
            "window": window,
            "window_seconds": window_seconds,
            "limit": limit,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
            "include_freshness": include_freshness,
        },
        "summary": summary,
        "movers": {
            "risers": _compact_mover_rows(movers["risers"]),
            "fallers": _compact_mover_rows(movers["fallers"]),
            "largest_abs_delta": _compact_mover_rows(movers["largest_abs_delta"]),
        },
        "freshness": freshness,
    }


@app.get("/api/overview")
async def overview() -> dict[str, object]:
    active_vaults = None
    total_vaults = None
    pps_points = None
    metrics_count = None
    freshness: dict[str, object] | None = None
    coverage: dict[str, object] | None = None
    protocol_context: dict[str, object] | None = None
    lifecycle: dict[str, object] | None = None
    last_runs: dict[str, dict[str, object] | None] = {"ydaemon_snapshot": None, "kong_pps_metrics": None}
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE active) AS active_vaults,
                        COUNT(*) AS total_vaults
                    FROM vault_dim
                    """
                )
                row = cur.fetchone()
                active_vaults, total_vaults = row["active_vaults"], row["total_vaults"]
                cur.execute("SELECT COUNT(*) FROM pps_timeseries")
                pps_points = cur.fetchone()["count"]
                cur.execute("SELECT COUNT(*) FROM vault_metrics_latest")
                metrics_count = cur.fetchone()["count"]
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE active) AS active_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE((raw->'info'->>'isRetired')::boolean, FALSE)) AS retired_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE((raw->'info'->>'isHighlighted')::boolean, FALSE)) AS highlighted_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE((raw->'migration'->>'available')::boolean, FALSE)) AS migration_ready_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(raw->'info'->>'riskLevel', '') = '-1') AS risk_unrated_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(raw->'info'->>'riskLevel', '') = '0') AS risk_0_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(raw->'info'->>'riskLevel', '') = '1') AS risk_1_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(raw->'info'->>'riskLevel', '') = '2') AS risk_2_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(raw->'info'->>'riskLevel', '') = '3') AS risk_3_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(raw->'info'->>'riskLevel', '') = '4') AS risk_4_vaults
                    FROM vault_dim
                    """
                )
                lifecycle = cur.fetchone()
                for job_name in last_runs:
                    cur.execute(
                        """
                        SELECT status, started_at, ended_at, records, error_summary
                        FROM ingestion_runs
                        WHERE job_name = %s
                        ORDER BY id DESC
                        LIMIT 1
                        """,
                        (job_name,),
                    )
                    row = cur.fetchone()
                    if row:
                        last_runs[job_name] = {
                            "status": row["status"],
                            "started_at": row["started_at"].isoformat() if row["started_at"] else None,
                            "ended_at": row["ended_at"].isoformat() if row["ended_at"] else None,
                            "records": row["records"],
                            "error_summary": row["error_summary"],
                        }
            freshness = _freshness_snapshot(conn, stale_threshold_seconds=24 * 3600, split_limit=8)
            coverage = _coverage_snapshot(
                conn,
                min_tvl_usd=DEFAULT_MIN_TVL_USD,
                min_points=DEFAULT_MIN_POINTS,
                split_limit=6,
            )
            protocol_context = _defillama_snapshot()
            if isinstance(protocol_context, dict) and isinstance(coverage, dict):
                tvl_usd = _to_float_or_none(protocol_context.get("tvl_usd"))
                eligible_tvl_usd = _to_float_or_none((coverage.get("global") or {}).get("eligible_tvl_usd"))
                if tvl_usd and tvl_usd > 0 and eligible_tvl_usd is not None:
                    protocol_context["eligible_vs_protocol_tvl_ratio"] = max(0.0, eligible_tvl_usd / tvl_usd)
                    protocol_context["eligible_vs_protocol_tvl_gap_usd"] = tvl_usd - eligible_tvl_usd
    except Exception:
        # DB may be empty/not yet initialized during bootstrap.
        pass

    return {
        "project": "yHelper",
        "status": "Phase 6 Hardening (Freshness Calibration In Progress)",
        "server_time_utc": datetime.now(UTC).isoformat(),
        "sources": {
            "ydaemon": os.getenv("YDAEMON_URL", "https://ydaemon.yearn.fi/vaults/detected?limit=2000"),
            "kong_gql": os.getenv("KONG_GQL_URL", "https://kong.yearn.farm/api/gql"),
        },
        "ingestion": {
            "active_vaults": active_vaults,
            "total_vaults": total_vaults,
            "pps_points": pps_points,
            "metrics_count": metrics_count,
            "last_runs": last_runs,
        },
        "freshness": freshness,
        "coverage": coverage,
        "protocol_context": protocol_context,
        "lifecycle": lifecycle,
        "message": "Phase 6 hardening is in progress: freshness calibration, trust diagnostics, UX consistency, and data-quality safeguards are actively being refined.",
    }


def _regime_case_sql(alias: str = "m") -> str:
    safe_momentum = _safe_momentum_sql(alias)
    return """
    CASE
        WHEN {alias}.momentum_7d_30d IS NULL OR {alias}.vol_30d IS NULL THEN 'unknown'
        WHEN {alias}.vol_30d >= 0.20 THEN 'choppy'
        WHEN {safe_momentum} >= 0.010 THEN 'rising'
        WHEN {safe_momentum} <= -0.010 THEN 'falling'
        ELSE 'stable'
    END
    """.format(alias=alias, safe_momentum=safe_momentum)


def _quality_score_sql() -> str:
    safe_apy = _safe_apy_sql()
    return f"({safe_apy} - 0.5 * COALESCE(m.vol_30d, 0.0))"


def _safe_apy_sql() -> str:
    return f"LEAST(GREATEST(COALESCE(m.apy_30d, 0.0), {APY_MIN}), {APY_MAX})"


def _safe_momentum_sql(alias: str = "m") -> str:
    lower = -abs(MOMENTUM_ABS_MAX)
    upper = abs(MOMENTUM_ABS_MAX)
    return f"LEAST(GREATEST(COALESCE({alias}.momentum_7d_30d, 0.0), {lower}), {upper})"


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
            LEAST(GREATEST(COALESCE(m.apy_30d, 0.0), %(apy_min)s), %(apy_max)s) AS safe_apy_30d,
            {safe_momentum_sql} AS momentum_7d_30d,
            m.consistency_score
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
        WHERE
            d.active = TRUE
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
            m.points_count,
            m.last_point_time,
            {safe_momentum_sql} AS momentum_7d_30d,
            m.consistency_score,
            m.vol_30d
        FROM vault_dim d
        JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
        WHERE
            d.active = TRUE
            AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
            AND COALESCE(m.points_count, 0) >= %(min_points)s
            {rank_clause}
    ),
    latest AS (
        SELECT p.vault_address, MAX(p.ts) AS latest_ts
        FROM pps_timeseries p
        JOIN eligible e ON e.vault_address = p.vault_address
        GROUP BY p.vault_address
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
        JOIN latest l ON l.vault_address = e.vault_address
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM pps_timeseries p
            WHERE p.vault_address = e.vault_address AND p.ts <= l.latest_ts
            ORDER BY p.ts DESC
            LIMIT 1
        ) latest_point ON TRUE
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM pps_timeseries p
            WHERE p.vault_address = e.vault_address AND p.ts <= l.latest_ts - %(window_sec)s
            ORDER BY p.ts DESC
            LIMIT 1
        ) curr_point ON TRUE
        JOIN LATERAL (
            SELECT p.ts, p.pps_raw
            FROM pps_timeseries p
            WHERE p.vault_address = e.vault_address AND p.ts <= l.latest_ts - (2 * %(window_sec)s)
            ORDER BY p.ts DESC
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
            LEAST(GREATEST(COALESCE(s.apy_window_raw, 0.0), %(apy_min)s), %(apy_max)s) AS safe_apy_window,
            LEAST(GREATEST(COALESCE(s.apy_prev_window_raw, 0.0), %(apy_min)s), %(apy_max)s) AS safe_apy_prev_window
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
    return {"risers": risers, "fallers": fallers, "largest_abs_delta": largest}


def _compact_mover_rows(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for row in rows:
        out.append(
            {
                "vault_address": row.get("vault_address"),
                "chain_id": row.get("chain_id"),
                "symbol": row.get("symbol"),
                "token_symbol": row.get("token_symbol"),
                "category": row.get("category"),
                "tvl_usd": row.get("tvl_usd"),
                "safe_apy_window": row.get("safe_apy_window"),
                "safe_apy_prev_window": row.get("safe_apy_prev_window"),
                "delta_apy": row.get("delta_apy"),
                "age_seconds": row.get("age_seconds"),
            }
        )
    return out


@app.get("/api/discover")
async def discover(
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    chain_id: int | None = Query(default=None),
    category: str | None = Query(default=None),
    token_symbol: str | None = Query(default=None),
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    include_retired: bool = Query(default=False),
    migration_only: bool = Query(default=False),
    highlighted_only: bool = Query(default=False),
    sort_by: Literal["quality", "tvl", "apy_7d", "apy_30d", "momentum", "consistency"] = "quality",
    direction: Literal["asc", "desc"] = "desc",
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    safe_momentum_sql = _safe_momentum_sql()
    retired_sql = "COALESCE((d.raw->'info'->>'isRetired')::boolean, FALSE)"
    highlighted_sql = "COALESCE((d.raw->'info'->>'isHighlighted')::boolean, FALSE)"
    migration_sql = "COALESCE((d.raw->'migration'->>'available')::boolean, FALSE)"
    risk_level_sql = "COALESCE(NULLIF(d.raw->'info'->>'riskLevel', ''), 'unknown')"
    strategies_count_sql = (
        "CASE WHEN jsonb_typeof(d.raw->'strategies') = 'array' THEN jsonb_array_length(d.raw->'strategies') ELSE 0 END"
    )
    order_map = {
        "quality": _quality_score_sql(),
        "tvl": "COALESCE(d.tvl_usd, 0.0)",
        "apy_7d": "COALESCE(m.apy_7d, -999999.0)",
        "apy_30d": "COALESCE(m.apy_30d, -999999.0)",
        "momentum": f"COALESCE(({safe_momentum_sql}), -999999.0)",
        "consistency": "COALESCE(m.consistency_score, -999999.0)",
    }
    order_expr = order_map[sort_by]
    order_dir = "ASC" if direction == "asc" else "DESC"
    filters = ["d.active = TRUE", "COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s", "COALESCE(m.points_count, 0) >= %(min_points)s"]
    params: dict[str, object] = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
        "offset": offset,
    }
    if not include_retired and not migration_only:
        filters.append(f"{retired_sql} = FALSE")
    if migration_only:
        filters.append(f"{migration_sql} = TRUE")
    if highlighted_only:
        filters.append(f"{highlighted_sql} = TRUE")
    if chain_id is not None:
        filters.append("d.chain_id = %(chain_id)s")
        params["chain_id"] = chain_id
    if category:
        filters.append("LOWER(COALESCE(d.category, '')) = LOWER(%(category)s)")
        params["category"] = category
    if token_symbol:
        filters.append("LOWER(COALESCE(d.token_symbol, '')) = LOWER(%(token_symbol)s)")
        params["token_symbol"] = token_symbol
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    if rank_filter_sql:
        filters.append(rank_filter_sql)
        params["max_vaults"] = max_vaults

    where_sql = " AND ".join(filters)
    regime_sql = _regime_case_sql()
    quality_sql = _quality_score_sql()
    safe_apy_sql = _safe_apy_sql()

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE {where_sql}
                """,
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT
                    COUNT(*) AS vaults,
                    COUNT(DISTINCT d.chain_id) AS chains,
                    COUNT(DISTINCT LOWER(COALESCE(d.token_symbol, ''))) FILTER (WHERE COALESCE(d.token_symbol, '') <> '') AS tokens,
                    COUNT(DISTINCT LOWER(COALESCE(d.category, ''))) FILTER (WHERE COALESCE(d.category, '') <> '') AS categories,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS total_tvl_usd,
                    AVG({safe_apy_sql}) AS avg_safe_apy_30d,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {safe_apy_sql}) AS median_safe_apy_30d,
                    AVG({safe_momentum_sql}) AS avg_momentum_7d_30d,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {safe_momentum_sql}) AS median_momentum_7d_30d,
                    AVG(COALESCE(m.consistency_score, 0.0)) AS avg_consistency_score,
                    AVG(COALESCE(d.feature_score, 0.0)) AS avg_feature_score,
                    COUNT(*) FILTER (WHERE {retired_sql} = TRUE) AS retired_vaults,
                    COUNT(*) FILTER (WHERE {highlighted_sql} = TRUE) AS highlighted_vaults,
                    COUNT(*) FILTER (WHERE {migration_sql} = TRUE) AS migration_ready_vaults,
                    AVG({strategies_count_sql}) AS avg_strategies_per_vault,
                    CASE
                        WHEN SUM(COALESCE(d.tvl_usd, 0.0)) > 0
                        THEN SUM(COALESCE(d.tvl_usd, 0.0) * {safe_apy_sql}) / SUM(COALESCE(d.tvl_usd, 0.0))
                        ELSE NULL
                    END AS tvl_weighted_safe_apy_30d,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} < 0.0) AS apy_negative_vaults,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} >= 0.0 AND {safe_apy_sql} < 0.05) AS apy_low_vaults,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} >= 0.05 AND {safe_apy_sql} < 0.15) AS apy_mid_vaults,
                    COUNT(*) FILTER (WHERE {safe_apy_sql} >= 0.15) AS apy_high_vaults
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE {where_sql}
                """,
                params,
            )
            summary = cur.fetchone() or {}

            cur.execute(
                f"""
                SELECT
                    {risk_level_sql} AS risk_level,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS tvl_usd
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE {where_sql}
                GROUP BY risk_level
                ORDER BY
                    CASE
                        WHEN {risk_level_sql} = '-1' THEN -1
                        WHEN {risk_level_sql} ~ '^[0-9]+$' THEN {risk_level_sql}::INT
                        ELSE 999
                    END,
                    tvl_usd DESC NULLS LAST
                LIMIT 8
                """,
                params,
            )
            risk_mix = cur.fetchall()

            cur.execute(
                f"""
                SELECT
                    {regime_sql} AS regime,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0.0)) AS tvl_usd
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE {where_sql}
                GROUP BY regime
                ORDER BY tvl_usd DESC NULLS LAST, vaults DESC
                LIMIT 8
                """,
                params,
            )
            regime_mix = cur.fetchall()

            cur.execute(
                f"""
                SELECT
                    d.vault_address,
                    d.chain_id,
                    d.name,
                    d.symbol,
                    d.category,
                    d.kind,
                    d.version,
                    d.token_symbol,
                    d.tvl_usd,
                    d.feature_score,
                    m.points_count,
                    m.last_point_time,
                    {risk_level_sql} AS risk_level,
                    {retired_sql} AS is_retired,
                    {highlighted_sql} AS is_highlighted,
                    {migration_sql} AS migration_available,
                    {strategies_count_sql} AS strategies_count,
                    m.apy_7d,
                    m.apy_30d,
                    m.apy_90d,
                    {safe_apy_sql} AS safe_apy_30d,
                    m.vol_30d,
                    {safe_momentum_sql} AS momentum_7d_30d,
                    m.consistency_score,
                    {quality_sql} AS quality_score,
                    {regime_sql} AS regime
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE {where_sql}
                ORDER BY {order_expr} {order_dir}, d.tvl_usd DESC
                LIMIT %(limit)s OFFSET %(offset)s
                """,
                params,
            )
            rows = cur.fetchall()

    return {
        "filters": {
            "universe": universe,
            "chain_id": chain_id,
            "category": category,
            "token_symbol": token_symbol,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "include_retired": include_retired,
            "migration_only": migration_only,
            "highlighted_only": highlighted_only,
            "sort_by": sort_by,
            "direction": direction,
        },
        "universe_gate": universe_gate,
        "pagination": {"limit": limit, "offset": offset, "total": total},
        "summary": summary,
        "risk_mix": risk_mix,
        "regime_mix": regime_mix,
        "rows": rows,
    }


@app.get("/api/regimes")
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
    filters = ["d.active = TRUE", "COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s", "COALESCE(m.points_count, 0) >= %(min_points)s"]
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
    safe_apy_sql = _safe_apy_sql()
    safe_momentum_sql = _safe_momentum_sql()

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    {regime_sql} AS regime,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(d.tvl_usd, 0)) AS tvl_usd
                FROM vault_dim d
                JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
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
                JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
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


@app.get("/api/chains/rollups")
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
                    COUNT(*) FILTER (WHERE d.active) AS active_vaults,
                    COUNT(*) FILTER (WHERE d.active AND m.vault_address IS NOT NULL) AS with_metrics,
                    SUM(COALESCE(d.tvl_usd, 0)) FILTER (WHERE d.active) AS total_tvl_usd,
                    CASE
                        WHEN SUM(COALESCE(d.tvl_usd, 0)) FILTER (WHERE d.active AND m.apy_30d IS NOT NULL) > 0
                        THEN
                            SUM(
                                (
                                    COALESCE(d.tvl_usd, 0)
                                    *
                                    LEAST(GREATEST(COALESCE(m.apy_30d, 0.0), %(apy_min)s), %(apy_max)s)
                                )
                            ) FILTER (WHERE d.active AND m.apy_30d IS NOT NULL)
                            /
                            SUM(COALESCE(d.tvl_usd, 0)) FILTER (WHERE d.active AND m.apy_30d IS NOT NULL)
                        ELSE NULL
                    END AS weighted_apy_30d,
                    AVG(
                        LEAST(GREATEST(COALESCE(m.momentum_7d_30d, 0.0), %(momentum_min)s), %(momentum_max)s)
                    ) FILTER (WHERE d.active AND m.momentum_7d_30d IS NOT NULL) AS avg_momentum_7d_30d,
                    AVG(m.consistency_score) FILTER (WHERE d.active AND m.consistency_score IS NOT NULL) AS avg_consistency
                FROM vault_dim d
                LEFT JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE COALESCE(d.tvl_usd, 0) >= %(min_tvl_usd)s
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
        apy = _to_float_or_none(row.get("weighted_apy_30d"))

        row["metrics_coverage_ratio"] = (with_metrics / active_vaults) if active_vaults > 0 else None
        row["tvl_share"] = (tvl / total_tvl) if total_tvl > 0 else None

        if apy is not None and tvl > 0:
            weighted_apy_num += tvl * apy
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


@app.get("/api/assets")
async def assets(
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
    sort_by: Literal["tvl", "spread", "best_apy", "venues"] = "tvl",
    direction: Literal["asc", "desc"] = "desc",
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    order_map = {
        "tvl": "total_tvl_usd",
        "spread": "spread_safe_apy_30d",
        "best_apy": "best_safe_apy_30d",
        "venues": "venues",
    }
    order_expr = order_map[sort_by]
    order_dir = "ASC" if direction == "asc" else "DESC"
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    tokens_cte = f"""
        WITH filtered AS (
            SELECT
                LOWER(COALESCE(d.token_symbol, '')) AS token_symbol_key,
                COALESCE(NULLIF(d.token_symbol, ''), 'unknown') AS token_symbol,
                d.chain_id,
                COALESCE(d.tvl_usd, 0.0) AS tvl_usd,
                LEAST(GREATEST(COALESCE(m.apy_30d, 0.0), %(apy_min)s), %(apy_max)s) AS safe_apy_30d
            FROM vault_dim d
            JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
            WHERE
                d.active = TRUE
                AND COALESCE(d.token_symbol, '') <> ''
                AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
                AND COALESCE(m.points_count, 0) >= %(min_points)s
                {rank_clause}
        ),
        token_agg AS (
            SELECT
                token_symbol,
                COUNT(*) AS venues,
                COUNT(DISTINCT chain_id) AS chains,
                SUM(tvl_usd) AS total_tvl_usd,
                MAX(safe_apy_30d) AS best_safe_apy_30d,
                MIN(safe_apy_30d) AS worst_safe_apy_30d,
                MAX(safe_apy_30d) - MIN(safe_apy_30d) AS spread_safe_apy_30d,
                CASE
                    WHEN SUM(tvl_usd) > 0
                    THEN SUM(tvl_usd * safe_apy_30d) / SUM(tvl_usd)
                    ELSE NULL
                END AS weighted_safe_apy_30d
            FROM filtered
            GROUP BY token_symbol_key, token_symbol
        )
    """
    sql_params = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
    }
    if max_vaults is not None:
        sql_params["max_vaults"] = max_vaults

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                tokens_cte
                + """
                SELECT
                    token_symbol,
                    venues,
                    chains,
                    total_tvl_usd,
                    best_safe_apy_30d,
                    worst_safe_apy_30d,
                    spread_safe_apy_30d,
                    weighted_safe_apy_30d
                FROM token_agg
                ORDER BY {order_expr} {order_dir}, total_tvl_usd DESC
                LIMIT %(limit)s
                """.format(order_expr=order_expr, order_dir=order_dir),
                sql_params,
            )
            rows = cur.fetchall()

            cur.execute(
                tokens_cte
                + """
                SELECT
                    COUNT(*) AS tokens,
                    SUM(total_tvl_usd) AS total_tvl_usd,
                    SUM(venues) AS total_venues,
                    AVG(venues) AS avg_venues_per_token,
                    COUNT(*) FILTER (WHERE chains > 1) AS multi_chain_tokens,
                    COUNT(*) FILTER (WHERE spread_safe_apy_30d >= 0.02) AS high_spread_tokens,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY spread_safe_apy_30d) AS median_spread_safe_apy_30d,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY best_safe_apy_30d) AS median_best_safe_apy_30d,
                    CASE
                        WHEN SUM(total_tvl_usd) > 0
                        THEN SUM(total_tvl_usd * weighted_safe_apy_30d) / SUM(total_tvl_usd)
                        ELSE NULL
                    END AS tvl_weighted_safe_apy_30d,
                    (SELECT token_symbol FROM token_agg ORDER BY total_tvl_usd DESC NULLS LAST LIMIT 1) AS top_token_symbol,
                    (
                        SELECT MAX(total_tvl_usd) / NULLIF(SUM(total_tvl_usd), 0)
                        FROM token_agg
                    ) AS top_token_tvl_share
                FROM token_agg
                """,
                sql_params,
            )
            summary = cur.fetchone() or {}

    total_tvl = float(summary.get("total_tvl_usd") or 0.0)
    for row in rows:
        tvl = float(row.get("total_tvl_usd") or 0.0)
        row["tvl_share"] = (tvl / total_tvl) if total_tvl > 0 else None

    return {
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "limit": limit,
            "sort_by": sort_by,
            "direction": direction,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "rows": rows,
    }


@app.get("/api/assets/{token_symbol:path}/venues")
async def asset_venues(
    token_symbol: str,
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    limit: int = Query(default=150, ge=1, le=500),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    regime_sql = _regime_case_sql()
    quality_sql = _quality_score_sql()
    safe_apy_sql = _safe_apy_sql()
    safe_momentum_sql = _safe_momentum_sql()
    params = {
        "token_symbol": token_symbol.strip(),
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "limit": limit,
    }
    rank_filter_sql = _rank_gate_filter_sql("d", max_vaults=max_vaults)
    rank_clause = f"AND {rank_filter_sql}" if rank_filter_sql else ""
    if max_vaults is not None:
        params["max_vaults"] = max_vaults

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    d.vault_address,
                    d.chain_id,
                    d.name,
                    d.symbol,
                    d.category,
                    d.kind,
                    d.version,
                    d.tvl_usd,
                    m.points_count,
                    m.last_point_time,
                    m.apy_7d,
                    m.apy_30d,
                    m.apy_90d,
                    {safe_apy_sql} AS safe_apy_30d,
                    m.vol_30d,
                    {safe_momentum_sql} AS momentum_7d_30d,
                    m.consistency_score,
                    {quality_sql} AS quality_score,
                    {regime_sql} AS regime
                FROM vault_dim d
                JOIN vault_metrics_latest m ON m.vault_address = d.vault_address
                WHERE
                    d.active = TRUE
                    AND LOWER(COALESCE(d.token_symbol, '')) = LOWER(%(token_symbol)s)
                    AND COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s
                    AND COALESCE(m.points_count, 0) >= %(min_points)s
                    {rank_clause}
                ORDER BY safe_apy_30d DESC, d.tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            rows = cur.fetchall()

    total_tvl = sum(float(row.get("tvl_usd") or 0.0) for row in rows)
    weighted_safe_apy = None
    if total_tvl > 0:
        weighted_safe_apy = sum(float(row.get("tvl_usd") or 0.0) * float(row.get("safe_apy_30d") or 0.0) for row in rows) / total_tvl

    summary = {
        "venues": len(rows),
        "chains": len({int(row["chain_id"]) for row in rows if row.get("chain_id") is not None}),
        "total_tvl_usd": total_tvl,
        "best_safe_apy_30d": max((row.get("safe_apy_30d") for row in rows), default=None),
        "worst_safe_apy_30d": min((row.get("safe_apy_30d") for row in rows), default=None),
        "weighted_safe_apy_30d": weighted_safe_apy,
        "best_venue_vault": rows[0]["vault_address"] if rows else None,
        "best_venue_symbol": rows[0]["symbol"] if rows else None,
    }
    best = summary["best_safe_apy_30d"]
    worst = summary["worst_safe_apy_30d"]
    summary["spread_safe_apy_30d"] = (best - worst) if best is not None and worst is not None else None
    apy_values = [float(row.get("safe_apy_30d")) for row in rows if row.get("safe_apy_30d") is not None]
    momentum_values = [float(row.get("momentum_7d_30d")) for row in rows if row.get("momentum_7d_30d") is not None]
    weighted_momentum_num = 0.0
    weighted_momentum_den = 0.0
    regime_counts: dict[str, int] = {}
    for row in rows:
        regime = str(row.get("regime") or "unknown")
        regime_counts[regime] = regime_counts.get(regime, 0) + 1
        tvl = float(row.get("tvl_usd") or 0.0)
        momentum = _to_float_or_none(row.get("momentum_7d_30d"))
        if momentum is not None and tvl > 0:
            weighted_momentum_num += tvl * momentum
            weighted_momentum_den += tvl
    summary["median_safe_apy_30d"] = _median(apy_values)
    summary["median_momentum_7d_30d"] = _median(momentum_values)
    summary["tvl_weighted_momentum_7d_30d"] = (
        weighted_momentum_num / weighted_momentum_den if weighted_momentum_den > 0 else None
    )
    summary["regime_counts"] = [{"regime": regime, "vaults": count} for regime, count in sorted(regime_counts.items())]

    return {
        "token_symbol": token_symbol.upper(),
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "limit": limit,
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "rows": rows,
    }


@app.get("/api/composition")
async def composition(
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
    top_n: int = Query(default=12, ge=3, le=50),
    crowding_limit: int = Query(default=20, ge=1, le=80),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    params = {
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "top_n": top_n,
        "crowding_limit": crowding_limit,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    filtered_cte = _composition_filtered_cte(max_vaults=max_vaults)

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                filtered_cte
                + """
                SELECT
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS total_tvl_usd,
                    AVG(safe_apy_30d) AS avg_safe_apy_30d
                FROM filtered
                """,
                params,
            )
            summary = cur.fetchone() or {"vaults": 0, "total_tvl_usd": 0.0, "avg_safe_apy_30d": None}
            total_tvl = float(summary.get("total_tvl_usd") or 0.0)

            cur.execute(
                filtered_cte
                + """
                SELECT
                    chain_id,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    CASE
                        WHEN SUM(tvl_usd) > 0 THEN SUM(tvl_usd * safe_apy_30d) / SUM(tvl_usd)
                        ELSE NULL
                    END AS weighted_safe_apy_30d
                FROM filtered
                GROUP BY chain_id
                ORDER BY tvl_usd DESC
                LIMIT %(top_n)s
                """,
                params,
            )
            chains = cur.fetchall()

            cur.execute(
                filtered_cte
                + """
                SELECT
                    category,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    CASE
                        WHEN SUM(tvl_usd) > 0 THEN SUM(tvl_usd * safe_apy_30d) / SUM(tvl_usd)
                        ELSE NULL
                    END AS weighted_safe_apy_30d
                FROM filtered
                GROUP BY category
                ORDER BY tvl_usd DESC
                LIMIT %(top_n)s
                """,
                params,
            )
            categories = cur.fetchall()

            cur.execute(
                filtered_cte
                + """
                SELECT
                    token_symbol,
                    COUNT(*) AS vaults,
                    SUM(tvl_usd) AS tvl_usd,
                    CASE
                        WHEN SUM(tvl_usd) > 0 THEN SUM(tvl_usd * safe_apy_30d) / SUM(tvl_usd)
                        ELSE NULL
                    END AS weighted_safe_apy_30d
                FROM filtered
                GROUP BY token_symbol
                ORDER BY tvl_usd DESC
                LIMIT %(top_n)s
                """,
                params,
            )
            tokens = cur.fetchall()

            cur.execute(
                filtered_cte
                + """
                , chain_agg AS (
                    SELECT chain_id::TEXT AS grp, SUM(tvl_usd) AS tvl
                    FROM filtered
                    GROUP BY chain_id
                )
                , category_agg AS (
                    SELECT category AS grp, SUM(tvl_usd) AS tvl
                    FROM filtered
                    GROUP BY category
                )
                , token_agg AS (
                    SELECT token_symbol AS grp, SUM(tvl_usd) AS tvl
                    FROM filtered
                    GROUP BY token_symbol
                )
                SELECT
                    (SELECT SUM(POWER(c.tvl / NULLIF((SELECT SUM(tvl) FROM chain_agg), 0), 2)) FROM chain_agg c) AS chain_hhi,
                    (SELECT SUM(POWER(ca.tvl / NULLIF((SELECT SUM(tvl) FROM category_agg), 0), 2)) FROM category_agg ca) AS category_hhi,
                    (SELECT SUM(POWER(t.tvl / NULLIF((SELECT SUM(tvl) FROM token_agg), 0), 2)) FROM token_agg t) AS token_hhi
                """,
                params,
            )
            concentration = cur.fetchone() or {"chain_hhi": None, "category_hhi": None, "token_hhi": None}

            crowding_sql = (
                filtered_cte
                + """
                , scored AS (
                    SELECT
                        f.*,
                        LN(1 + f.tvl_usd) AS ln_tvl,
                        AVG(LN(1 + f.tvl_usd)) OVER () AS mean_ln_tvl,
                        STDDEV_SAMP(LN(1 + f.tvl_usd)) OVER () AS sd_ln_tvl,
                        AVG(f.safe_apy_30d) OVER () AS mean_apy,
                        STDDEV_SAMP(f.safe_apy_30d) OVER () AS sd_apy
                    FROM filtered f
                )
                SELECT
                    vault_address,
                    chain_id,
                    symbol,
                    token_symbol,
                    category,
                    tvl_usd,
                    safe_apy_30d,
                    momentum_7d_30d,
                    consistency_score,
                    COALESCE((ln_tvl - mean_ln_tvl) / NULLIF(sd_ln_tvl, 0), 0) AS z_tvl,
                    COALESCE((safe_apy_30d - mean_apy) / NULLIF(sd_apy, 0), 0) AS z_apy,
                    COALESCE((ln_tvl - mean_ln_tvl) / NULLIF(sd_ln_tvl, 0), 0)
                    - COALESCE((safe_apy_30d - mean_apy) / NULLIF(sd_apy, 0), 0) AS crowding_index
                FROM scored
                ORDER BY crowding_index {order_dir}, tvl_usd DESC
                LIMIT %(crowding_limit)s
                """
            )
            cur.execute(crowding_sql.format(order_dir="DESC"), params)
            crowded = cur.fetchall()
            cur.execute(crowding_sql.format(order_dir="ASC"), params)
            uncrowded = cur.fetchall()

    def _share(rows: list[dict]) -> list[dict]:
        if total_tvl <= 0:
            return rows
        for row in rows:
            row["share_tvl"] = float(row.get("tvl_usd") or 0.0) / total_tvl
        return rows

    return {
        "filters": {
            "universe": universe,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "top_n": top_n,
            "crowding_limit": crowding_limit,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "concentration": concentration,
        "chains": _share(chains),
        "categories": _share(categories),
        "tokens": _share(tokens),
        "crowding": {"most_crowded": crowded, "least_crowded": uncrowded},
    }


@app.get("/api/changes")
async def changes(
    window: Literal["24h", "7d", "30d"] = "7d",
    stale_threshold: Literal["auto", "24h", "7d", "30d"] = "auto",
    limit: int = Query(default=20, ge=1, le=80),
    universe: Literal["core", "extended", "raw"] = "core",
    min_tvl_usd: float | None = Query(default=None, ge=0.0),
    min_points: int | None = Query(default=None, ge=0),
    max_vaults: int | None = Query(default=None, ge=0),
) -> dict[str, object]:
    universe_gate = _resolve_universe_gate(
        universe, min_tvl_usd=min_tvl_usd, min_points=min_points, max_vaults=max_vaults
    )
    min_tvl_usd = float(universe_gate["min_tvl_usd"])
    min_points = int(universe_gate["min_points"])
    max_vaults = universe_gate["max_vaults"]
    window_seconds = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}[window]
    threshold_seconds_map = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}
    stale_threshold_seconds = (
        2 * window_seconds if stale_threshold == "auto" else threshold_seconds_map[stale_threshold]
    )
    params = {
        "window_sec": window_seconds,
        "stale_threshold_sec": stale_threshold_seconds,
        "limit": limit,
        "min_tvl_usd": min_tvl_usd,
        "min_points": min_points,
        "apy_min": APY_MIN,
        "apy_max": APY_MAX,
        "now_epoch": int(datetime.now(UTC).timestamp()),
    }
    if max_vaults is not None:
        params["max_vaults"] = max_vaults
    base_cte = _changes_base_cte(max_vaults=max_vaults)
    regime_sql = _regime_case_sql("n")
    freshness: dict[str, object] | None = None

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                base_cte
                + """
                SELECT
                    COUNT(*) AS vaults_eligible,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS vaults_with_change,
                    COUNT(*) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL
                        AND n.apy_prev_window_raw IS NOT NULL
                        AND n.age_seconds > %(stale_threshold_sec)s
                    ) AS stale_vaults,
                    SUM(COALESCE(n.tvl_usd, 0.0)) AS total_tvl_usd,
                    AVG(n.safe_apy_window) AS avg_safe_apy_window,
                    AVG(n.safe_apy_prev_window) AS avg_safe_apy_prev_window,
                    AVG(n.safe_apy_window - n.safe_apy_prev_window) AS avg_delta,
                    SUM(COALESCE(n.tvl_usd, 0.0)) FILTER (
                        WHERE n.apy_window_raw IS NOT NULL AND n.apy_prev_window_raw IS NOT NULL
                    ) AS tracked_tvl_usd
                FROM normalized n
                """,
                params,
            )
            summary = cur.fetchone() or {}

            cur.execute(
                base_cte
                + f"""
                SELECT
                    {regime_sql} AS regime,
                    COUNT(*) AS vaults,
                    SUM(COALESCE(n.tvl_usd, 0.0)) AS tvl_usd
                FROM normalized n
                GROUP BY regime
                ORDER BY tvl_usd DESC NULLS LAST
                """,
                params,
            )
            regime_counts = cur.fetchall()

            movers = _fetch_change_movers(cur, base_cte=base_cte, params=params, limit=limit)

            cur.execute(
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
                    n.points_count,
                    n.last_point_time,
                    n.safe_apy_window,
                    n.safe_apy_prev_window,
                    (n.safe_apy_window - n.safe_apy_prev_window) AS delta_apy,
                    n.age_seconds
                FROM normalized n
                ORDER BY n.age_seconds DESC, n.tvl_usd DESC
                LIMIT %(limit)s
                """,
                params,
            )
            stale = cur.fetchall()
        freshness = _freshness_snapshot(conn, stale_threshold_seconds=stale_threshold_seconds, split_limit=8)

    if freshness is not None:
        tracked = int(summary.get("vaults_with_change") or 0)
        stale_vaults = int(summary.get("stale_vaults") or 0)
        freshness["window_stale_vaults"] = stale_vaults
        freshness["window_tracked_vaults"] = tracked
        freshness["window_stale_ratio"] = (stale_vaults / tracked) if tracked > 0 else None

    return {
        "filters": {
            "universe": universe,
            "window": window,
            "stale_threshold": stale_threshold,
            "limit": limit,
            "min_tvl_usd": min_tvl_usd,
            "min_points": min_points,
            "max_vaults": max_vaults,
            "window_seconds": window_seconds,
            "stale_threshold_seconds": stale_threshold_seconds,
            "apy_bounds": {"min": APY_MIN, "max": APY_MAX},
        },
        "universe_gate": universe_gate,
        "summary": summary,
        "freshness": freshness,
        "regime_counts": regime_counts,
        "movers": movers,
        "stale": stale,
    }
