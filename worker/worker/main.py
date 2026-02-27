from __future__ import annotations

import json
import logging
import math
import os
import statistics
import time
from datetime import UTC, datetime

import psycopg
import requests
from psycopg.types.json import Json

YDAEMON_URL = os.getenv("YDAEMON_URL", "https://ydaemon.yearn.fi/vaults/detected?limit=2000")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://yhelper:change_me@yhelper-postgres:5432/yhelper")
KONG_GQL_URL = os.getenv("KONG_GQL_URL", "https://kong.yearn.farm/api/gql")
KONG_MAX_VAULTS = int(os.getenv("KONG_MAX_VAULTS", "120"))
KONG_MIN_TVL_USD = float(os.getenv("KONG_MIN_TVL_USD", "100000"))
KONG_PPS_LIMIT = int(os.getenv("KONG_PPS_LIMIT", "120"))
KONG_TIMEOUT_SEC = int(os.getenv("KONG_TIMEOUT_SEC", "12"))
KONG_SLEEP_BETWEEN_REQ_MS = int(os.getenv("KONG_SLEEP_BETWEEN_REQ_MS", "10"))
JOB_YDAEMON = "ydaemon_snapshot"
JOB_KONG = "kong_pps_metrics"
ALERT_STALE_SECONDS = int(os.getenv("ALERT_STALE_SECONDS", "86400"))
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "21600"))
ALERT_NOTIFY_ON_RECOVERY = os.getenv("ALERT_NOTIFY_ON_RECOVERY", "1") == "1"
ALERT_TELEGRAM_BOT_TOKEN = os.getenv("ALERT_TELEGRAM_BOT_TOKEN", "").strip()
ALERT_TELEGRAM_CHAT_ID = os.getenv("ALERT_TELEGRAM_CHAT_ID", "").strip()
ALERT_DISCORD_WEBHOOK_URL = os.getenv("ALERT_DISCORD_WEBHOOK_URL", "").strip()
RUNNING_STALE_SECONDS = int(os.getenv("RUNNING_STALE_SECONDS", "1800"))

KONG_PPS_QUERY = """
query Query($label: String!, $chainId: Int, $address: String, $component: String, $limit: Int) {
  timeseries(label: $label, chainId: $chainId, address: $address, component: $component, limit: $limit) {
    time
    value
  }
}
"""

DDL = """
CREATE TABLE IF NOT EXISTS vault_dim (
    vault_address TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    name TEXT,
    symbol TEXT,
    category TEXT,
    kind TEXT,
    version TEXT,
    token_address TEXT,
    token_symbol TEXT,
    token_name TEXT,
    tvl_usd DOUBLE PRECISION,
    apr_net DOUBLE PRECISION,
    feature_score DOUBLE PRECISION,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_dim_active_rank
    ON vault_dim(feature_score DESC NULLS LAST, tvl_usd DESC NULLS LAST, vault_address)
    WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_vault_dim_active_tvl
    ON vault_dim(tvl_usd DESC NULLS LAST, vault_address)
    WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id BIGSERIAL PRIMARY KEY,
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    records INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT
);

CREATE TABLE IF NOT EXISTS pps_timeseries (
    vault_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    ts BIGINT NOT NULL,
    pps_raw DOUBLE PRECISION NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vault_address, ts)
);

CREATE INDEX IF NOT EXISTS idx_pps_chain_ts ON pps_timeseries(chain_id, ts DESC);

CREATE TABLE IF NOT EXISTS vault_metrics_latest (
    vault_address TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    points_count INTEGER NOT NULL DEFAULT 0,
    last_point_time TIMESTAMPTZ,
    apy_7d DOUBLE PRECISION,
    apy_30d DOUBLE PRECISION,
    apy_90d DOUBLE PRECISION,
    vol_30d DOUBLE PRECISION,
    momentum_7d_30d DOUBLE PRECISION,
    consistency_score DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_vault_metrics_points ON vault_metrics_latest(points_count DESC, vault_address);

CREATE TABLE IF NOT EXISTS alert_state (
    alert_key TEXT PRIMARY KEY,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    threshold_seconds INTEGER NOT NULL,
    current_age_seconds INTEGER,
    last_success_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_fired_at TIMESTAMPTZ,
    last_recovered_at TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ,
    notify_channels TEXT[] NOT NULL DEFAULT '{}',
    last_notify_result JSONB
);
"""

UPSERT_SQL = """
INSERT INTO vault_dim (
    vault_address,
    chain_id,
    name,
    symbol,
    category,
    kind,
    version,
    token_address,
    token_symbol,
    token_name,
    tvl_usd,
    apr_net,
    feature_score,
    active,
    last_seen_at,
    raw
) VALUES (
    %(vault_address)s,
    %(chain_id)s,
    %(name)s,
    %(symbol)s,
    %(category)s,
    %(kind)s,
    %(version)s,
    %(token_address)s,
    %(token_symbol)s,
    %(token_name)s,
    %(tvl_usd)s,
    %(apr_net)s,
    %(feature_score)s,
    TRUE,
    NOW(),
    %(raw)s
)
ON CONFLICT (vault_address) DO UPDATE SET
    chain_id = EXCLUDED.chain_id,
    name = EXCLUDED.name,
    symbol = EXCLUDED.symbol,
    category = EXCLUDED.category,
    kind = EXCLUDED.kind,
    version = EXCLUDED.version,
    token_address = EXCLUDED.token_address,
    token_symbol = EXCLUDED.token_symbol,
    token_name = EXCLUDED.token_name,
    tvl_usd = EXCLUDED.tvl_usd,
    apr_net = EXCLUDED.apr_net,
    feature_score = EXCLUDED.feature_score,
    active = TRUE,
    last_seen_at = NOW(),
    raw = EXCLUDED.raw
"""


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [yhelper-worker] %(message)s",
    )


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_vault(vault: dict) -> dict:
    token = vault.get("token") or {}
    tvl = vault.get("tvl") or {}
    apr = vault.get("apr") or {}
    return {
        "vault_address": str(vault.get("address", "")).lower(),
        "chain_id": int(vault.get("chainID") or 0),
        "name": vault.get("name"),
        "symbol": vault.get("symbol"),
        "category": vault.get("category"),
        "kind": vault.get("kind"),
        "version": vault.get("version"),
        "token_address": token.get("address"),
        "token_symbol": token.get("symbol"),
        "token_name": token.get("name"),
        "tvl_usd": _to_float(tvl.get("tvl")),
        "apr_net": _to_float(apr.get("netAPR")),
        "feature_score": _to_float(vault.get("featuringScore")),
        "raw": Json(vault),
    }


def _connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def _ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


def _insert_run(conn: psycopg.Connection, job_name: str, started_at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ingestion_runs (job_name, started_at, status)
            VALUES (%s, %s, 'running')
            RETURNING id
            """,
            (job_name, started_at),
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def _mark_stale_running_runs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET
                status = 'abandoned',
                ended_at = NOW(),
                error_summary = COALESCE(
                    error_summary,
                    json_build_object(
                        'error',
                        'marked abandoned by worker due to stale running status',
                        'stale_threshold_seconds',
                        %s
                    )::text
                )
            WHERE status = 'running'
              AND started_at < NOW() - (%s * INTERVAL '1 second')
            """,
            (RUNNING_STALE_SECONDS, RUNNING_STALE_SECONDS),
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def _mark_boot_orphaned_runs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET
                status = 'abandoned',
                ended_at = NOW(),
                error_summary = COALESCE(
                    error_summary,
                    json_build_object(
                        'error',
                        'marked abandoned on worker boot due to orphan running status'
                    )::text
                )
            WHERE status = 'running'
            """
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def _complete_run(conn: psycopg.Connection, run_id: int, status: str, records: int, error_summary: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET ended_at = %s, status = %s, records = %s, error_summary = %s
            WHERE id = %s
            """,
            (datetime.now(UTC), status, records, error_summary, run_id),
        )
    conn.commit()


def _send_telegram(message: str) -> bool:
    if not ALERT_TELEGRAM_BOT_TOKEN or not ALERT_TELEGRAM_CHAT_ID:
        return False
    response = requests.post(
        f"https://api.telegram.org/bot{ALERT_TELEGRAM_BOT_TOKEN}/sendMessage",
        json={"chat_id": ALERT_TELEGRAM_CHAT_ID, "text": message, "disable_web_page_preview": True},
        timeout=10,
    )
    response.raise_for_status()
    return True


def _send_discord(message: str) -> bool:
    if not ALERT_DISCORD_WEBHOOK_URL:
        return False
    response = requests.post(ALERT_DISCORD_WEBHOOK_URL, json={"content": message}, timeout=10)
    response.raise_for_status()
    return True


def _send_notifications(message: str) -> dict[str, object]:
    attempted: list[str] = []
    delivered: list[str] = []
    errors: list[str] = []

    if ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID:
        attempted.append("telegram")
        try:
            if _send_telegram(message):
                delivered.append("telegram")
        except Exception as exc:
            errors.append(f"telegram:{exc}")

    if ALERT_DISCORD_WEBHOOK_URL:
        attempted.append("discord")
        try:
            if _send_discord(message):
                delivered.append("discord")
        except Exception as exc:
            errors.append(f"discord:{exc}")

    return {"attempted": attempted, "delivered": delivered, "errors": errors}


def _get_job_status(conn: psycopg.Connection, job_name: str) -> tuple[datetime | None, int | None]:
    now = datetime.now(UTC)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(ended_at) FILTER (WHERE status = 'success') AS last_success_at
            FROM ingestion_runs
            WHERE job_name = %s
            """,
            (job_name,),
        )
        row = cur.fetchone()
    if not row:
        return None, None
    last_success_at = row[0]
    if not isinstance(last_success_at, datetime):
        return None, None
    if last_success_at.tzinfo is None:
        last_success_at = last_success_at.replace(tzinfo=UTC)
    age_seconds = max(0, int((now - last_success_at).total_seconds()))
    return last_success_at, age_seconds


def _get_alert_state(conn: psycopg.Connection, alert_key: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                status,
                last_notified_at,
                last_fired_at,
                last_recovered_at
            FROM alert_state
            WHERE alert_key = %s
            """,
            (alert_key,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "status": row[0],
        "last_notified_at": row[1],
        "last_fired_at": row[2],
        "last_recovered_at": row[3],
    }


def _upsert_alert_state(
    conn: psycopg.Connection,
    *,
    alert_key: str,
    job_name: str,
    status: str,
    threshold_seconds: int,
    current_age_seconds: int | None,
    last_success_at: datetime | None,
    last_fired_at: datetime | None,
    last_recovered_at: datetime | None,
    last_notified_at: datetime | None,
    notify_channels: list[str],
    notify_result: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO alert_state (
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
            ) VALUES (
                %(alert_key)s,
                %(job_name)s,
                %(status)s,
                %(threshold_seconds)s,
                %(current_age_seconds)s,
                %(last_success_at)s,
                NOW(),
                %(last_fired_at)s,
                %(last_recovered_at)s,
                %(last_notified_at)s,
                %(notify_channels)s,
                %(last_notify_result)s
            )
            ON CONFLICT (alert_key) DO UPDATE SET
                job_name = EXCLUDED.job_name,
                status = EXCLUDED.status,
                threshold_seconds = EXCLUDED.threshold_seconds,
                current_age_seconds = EXCLUDED.current_age_seconds,
                last_success_at = EXCLUDED.last_success_at,
                last_checked_at = NOW(),
                last_fired_at = EXCLUDED.last_fired_at,
                last_recovered_at = EXCLUDED.last_recovered_at,
                last_notified_at = EXCLUDED.last_notified_at,
                notify_channels = EXCLUDED.notify_channels,
                last_notify_result = EXCLUDED.last_notify_result
            """,
            {
                "alert_key": alert_key,
                "job_name": job_name,
                "status": status,
                "threshold_seconds": threshold_seconds,
                "current_age_seconds": current_age_seconds,
                "last_success_at": last_success_at,
                "last_fired_at": last_fired_at,
                "last_recovered_at": last_recovered_at,
                "last_notified_at": last_notified_at,
                "notify_channels": notify_channels,
                "last_notify_result": Json(notify_result),
            },
        )
    conn.commit()


def _evaluate_job_stale_alert(conn: psycopg.Connection, *, job_name: str) -> None:
    alert_key = f"ingestion_stale:{job_name}"
    now = datetime.now(UTC)
    last_success_at, age_seconds = _get_job_status(conn, job_name)
    previous = _get_alert_state(conn, alert_key)
    previous_status = (previous or {}).get("status")
    previous_notified = (previous or {}).get("last_notified_at")

    status = "ok"
    message: str | None = None
    notify_result: dict[str, object] = {"attempted": [], "delivered": [], "errors": []}
    last_fired_at = (previous or {}).get("last_fired_at")
    last_recovered_at = (previous or {}).get("last_recovered_at")
    last_notified_at = previous_notified

    if age_seconds is None:
        status = "unknown"
    elif age_seconds > ALERT_STALE_SECONDS:
        status = "firing"
        should_notify = previous_status != "firing"
        if not should_notify and isinstance(previous_notified, datetime):
            if previous_notified.tzinfo is None:
                previous_notified = previous_notified.replace(tzinfo=UTC)
            elapsed = max(0, int((now - previous_notified).total_seconds()))
            should_notify = elapsed >= ALERT_COOLDOWN_SECONDS
        if should_notify:
            age_hours = round(age_seconds / 3600, 2)
            threshold_hours = round(ALERT_STALE_SECONDS / 3600, 2)
            message = (
                f"[yHelper] stale ingestion alert\n"
                f"job={job_name}\n"
                f"age_hours={age_hours}\n"
                f"threshold_hours={threshold_hours}\n"
                f"last_success_at={last_success_at.isoformat() if last_success_at else 'n/a'}"
            )
            notify_result = _send_notifications(message)
            if notify_result.get("delivered"):
                last_notified_at = now
            last_fired_at = now
    else:
        if previous_status == "firing" and ALERT_NOTIFY_ON_RECOVERY:
            age_hours = round(age_seconds / 3600, 2)
            threshold_hours = round(ALERT_STALE_SECONDS / 3600, 2)
            message = (
                f"[yHelper] ingestion recovered\n"
                f"job={job_name}\n"
                f"age_hours={age_hours}\n"
                f"threshold_hours={threshold_hours}\n"
                f"last_success_at={last_success_at.isoformat() if last_success_at else 'n/a'}"
            )
            notify_result = _send_notifications(message)
            if notify_result.get("delivered"):
                last_notified_at = now
            last_recovered_at = now

    configured_channels: list[str] = []
    if ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID:
        configured_channels.append("telegram")
    if ALERT_DISCORD_WEBHOOK_URL:
        configured_channels.append("discord")

    _upsert_alert_state(
        conn,
        alert_key=alert_key,
        job_name=job_name,
        status=status,
        threshold_seconds=ALERT_STALE_SECONDS,
        current_age_seconds=age_seconds,
        last_success_at=last_success_at,
        last_fired_at=last_fired_at,
        last_recovered_at=last_recovered_at,
        last_notified_at=last_notified_at,
        notify_channels=configured_channels,
        notify_result=notify_result,
    )

    if message:
        logging.info(
            "Alert notify attempted for %s: delivered=%s errors=%s",
            alert_key,
            len(notify_result.get("delivered", [])),
            len(notify_result.get("errors", [])),
        )


def _evaluate_alerts(conn: psycopg.Connection) -> None:
    _evaluate_job_stale_alert(conn, job_name=JOB_YDAEMON)
    _evaluate_job_stale_alert(conn, job_name=JOB_KONG)


def _fetch_ydaemon_snapshot() -> list[dict]:
    response = requests.get(YDAEMON_URL, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise ValueError("yDaemon response is not a list")
    return payload


def _store_snapshot(conn: psycopg.Connection, vaults: list[dict]) -> int:
    rows = [_normalize_vault(v) for v in vaults if v.get("address") and v.get("chainID") is not None]
    with conn.cursor() as cur:
        cur.execute("UPDATE vault_dim SET active = FALSE")
        cur.executemany(UPSERT_SQL, rows)
    conn.commit()
    return len(rows)


def _select_kong_vaults(conn: psycopg.Connection) -> list[tuple[int, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address
            FROM vault_dim
            WHERE active = TRUE AND tvl_usd >= %s
            ORDER BY feature_score DESC NULLS LAST, tvl_usd DESC
            LIMIT %s
            """,
            (KONG_MIN_TVL_USD, KONG_MAX_VAULTS),
        )
        return [(int(row[0]), str(row[1])) for row in cur.fetchall()]


def _fetch_kong_pps(chain_id: int, vault_address: str) -> list[tuple[int, float]]:
    variables = {
        "label": "pps",
        "chainId": chain_id,
        "address": vault_address,
        "component": "raw",
        "limit": KONG_PPS_LIMIT,
    }
    response = requests.post(
        KONG_GQL_URL,
        json={"query": KONG_PPS_QUERY, "variables": variables},
        timeout=KONG_TIMEOUT_SEC,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise ValueError(f"Kong errors: {payload['errors']}")
    timeseries = (payload.get("data") or {}).get("timeseries") or []
    out: list[tuple[int, float]] = []
    for point in timeseries:
        try:
            t = int(point.get("time"))
            v = float(point.get("value"))
        except (TypeError, ValueError):
            continue
        out.append((t, v))
    out.sort(key=lambda x: x[0])
    return out


def _upsert_pps_points(conn: psycopg.Connection, chain_id: int, vault_address: str, points: list[tuple[int, float]]) -> int:
    if not points:
        return 0
    rows = [
        {
            "vault_address": vault_address,
            "chain_id": chain_id,
            "ts": t,
            "pps_raw": v,
        }
        for t, v in points
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO pps_timeseries (vault_address, chain_id, ts, pps_raw, fetched_at)
            VALUES (%(vault_address)s, %(chain_id)s, %(ts)s, %(pps_raw)s, NOW())
            ON CONFLICT (vault_address, ts) DO UPDATE SET
                chain_id = EXCLUDED.chain_id,
                pps_raw = EXCLUDED.pps_raw,
                fetched_at = NOW()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def _apy_for_window(points: list[tuple[int, float]], days: int) -> float | None:
    if len(points) < 2:
        return None
    latest_t, latest_v = points[-1]
    if latest_v <= 0:
        return None
    target_t = latest_t - days * 86400
    base_t, base_v = points[0]
    for t, v in points:
        if t >= target_t and v > 0:
            base_t, base_v = t, v
            break
    if base_v <= 0 or latest_v <= 0 or latest_t <= base_t:
        return None
    window_days = (latest_t - base_t) / 86400
    if window_days < 1:
        return None
    ratio = latest_v / base_v
    if ratio <= 0:
        return None
    return ratio ** (365 / window_days) - 1


def _vol_30d(points: list[tuple[int, float]]) -> tuple[float | None, float | None]:
    if len(points) < 3:
        return None, None
    latest_t = points[-1][0]
    floor_t = latest_t - 30 * 86400
    recent = [p for p in points if p[0] >= floor_t]
    if len(recent) < 3:
        return None, None
    log_returns: list[float] = []
    positive_count = 0
    for idx in range(1, len(recent)):
        prev = recent[idx - 1][1]
        curr = recent[idx][1]
        if prev <= 0 or curr <= 0:
            continue
        ret = curr / prev - 1
        if ret > 0:
            positive_count += 1
        log_returns.append(math.log(curr / prev))
    if len(log_returns) < 2:
        return None, None
    vol = statistics.pstdev(log_returns) * math.sqrt(365)
    positive_ratio = positive_count / len(log_returns)
    consistency = max(0.0, min(1.0, positive_ratio * (1.0 / (1.0 + vol))))
    return vol, consistency


def _compute_metrics(chain_id: int, vault_address: str, points: list[tuple[int, float]]) -> dict | None:
    if not points:
        return None
    apy_7d = _apy_for_window(points, 7)
    apy_30d = _apy_for_window(points, 30)
    apy_90d = _apy_for_window(points, 90)
    vol_30d, consistency = _vol_30d(points)
    momentum = None
    if apy_7d is not None and apy_30d is not None:
        momentum = apy_7d - apy_30d
    return {
        "vault_address": vault_address,
        "chain_id": chain_id,
        "as_of": datetime.now(UTC),
        "points_count": len(points),
        "last_point_time": datetime.fromtimestamp(points[-1][0], tz=UTC),
        "apy_7d": apy_7d,
        "apy_30d": apy_30d,
        "apy_90d": apy_90d,
        "vol_30d": vol_30d,
        "momentum_7d_30d": momentum,
        "consistency_score": consistency,
    }


def _upsert_metrics(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO vault_metrics_latest (
                vault_address,
                chain_id,
                as_of,
                points_count,
                last_point_time,
                apy_7d,
                apy_30d,
                apy_90d,
                vol_30d,
                momentum_7d_30d,
                consistency_score
            ) VALUES (
                %(vault_address)s,
                %(chain_id)s,
                %(as_of)s,
                %(points_count)s,
                %(last_point_time)s,
                %(apy_7d)s,
                %(apy_30d)s,
                %(apy_90d)s,
                %(vol_30d)s,
                %(momentum_7d_30d)s,
                %(consistency_score)s
            )
            ON CONFLICT (vault_address) DO UPDATE SET
                chain_id = EXCLUDED.chain_id,
                as_of = EXCLUDED.as_of,
                points_count = EXCLUDED.points_count,
                last_point_time = EXCLUDED.last_point_time,
                apy_7d = EXCLUDED.apy_7d,
                apy_30d = EXCLUDED.apy_30d,
                apy_90d = EXCLUDED.apy_90d,
                vol_30d = EXCLUDED.vol_30d,
                momentum_7d_30d = EXCLUDED.momentum_7d_30d,
                consistency_score = EXCLUDED.consistency_score
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def _run_ydaemon_ingestion(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_YDAEMON, started_at)
    try:
        vaults = _fetch_ydaemon_snapshot()
        stored = _store_snapshot(conn, vaults)
        _complete_run(conn, run_id, "success", stored)
        logging.info("yDaemon ingestion success: stored %s vault records", stored)
        return run_id, stored
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)}))
        logging.exception("yDaemon ingestion failed: %s", exc)
        return run_id, 0


def _run_kong_ingestion(conn: psycopg.Connection) -> tuple[int, int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_KONG, started_at)
    pps_rows_stored = 0
    metrics_rows = 0
    errors: list[str] = []
    try:
        targets = _select_kong_vaults(conn)
        if not targets:
            _complete_run(conn, run_id, "success", 0, json.dumps({"note": "no eligible vaults"}))
            return run_id, 0, 0
        metric_payload: list[dict] = []
        for chain_id, vault_address in targets:
            try:
                points = _fetch_kong_pps(chain_id, vault_address)
                if not points:
                    continue
                pps_rows_stored += _upsert_pps_points(conn, chain_id, vault_address, points)
                computed = _compute_metrics(chain_id, vault_address, points)
                if computed:
                    metric_payload.append(computed)
            except Exception as exc:
                if len(errors) < 10:
                    errors.append(f"{chain_id}:{vault_address}:{exc}")
            if KONG_SLEEP_BETWEEN_REQ_MS > 0:
                time.sleep(KONG_SLEEP_BETWEEN_REQ_MS / 1000)
        metrics_rows = _upsert_metrics(conn, metric_payload)
        summary = {"targets": len(targets), "points": pps_rows_stored, "metrics": metrics_rows, "errors": errors}
        _complete_run(conn, run_id, "success", pps_rows_stored, json.dumps(summary))
        logging.info(
            "Kong ingestion success: targets=%s points=%s metrics=%s errors=%s",
            len(targets),
            pps_rows_stored,
            metrics_rows,
            len(errors),
        )
        return run_id, pps_rows_stored, metrics_rows
    except Exception as exc:
        _complete_run(conn, run_id, "failed", pps_rows_stored, json.dumps({"error": str(exc), "errors": errors}))
        logging.exception("Kong ingestion failed: %s", exc)
        return run_id, pps_rows_stored, metrics_rows


def run_once() -> None:
    logging.info("Tick at %s", datetime.now(UTC).isoformat())
    logging.info("Fetching yDaemon snapshot: %s", YDAEMON_URL)
    with _connect() as conn:
        _ensure_schema(conn)
        abandoned = _mark_stale_running_runs(conn)
        if abandoned > 0:
            logging.warning("Marked %s stale running ingestion rows as abandoned", abandoned)
        _, stored = _run_ydaemon_ingestion(conn)
        if stored > 0:
            _run_kong_ingestion(conn)
        else:
            logging.warning("Skipping Kong ingestion because yDaemon snapshot stored 0 records")
        _evaluate_alerts(conn)


def main() -> None:
    configure_logging()
    interval = int(os.getenv("WORKER_INTERVAL_SEC", "300"))
    logging.info("Worker booted with interval=%ss", interval)
    with _connect() as conn:
        _ensure_schema(conn)
        orphaned = _mark_boot_orphaned_runs(conn)
        if orphaned > 0:
            logging.warning("Marked %s orphaned running ingestion rows as abandoned on boot", orphaned)
    while True:
        run_once()
        time.sleep(interval)


if __name__ == "__main__":
    main()
