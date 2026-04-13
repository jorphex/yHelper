from __future__ import annotations

import json
import logging
import math
import statistics
import time
from datetime import UTC, datetime, timedelta

import psycopg
import requests

from .config import (
    DB_CLEANUP_ENABLED,
    DB_CLEANUP_MIN_INTERVAL_SEC,
    HARVEST_RETENTION_DAYS,
    INGESTION_RUN_RETENTION_DAYS,
    JOB_KONG_PPS,
    JOB_KONG_SNAPSHOT,
    KONG_GQL_URL,
    KONG_MAX_VAULTS,
    KONG_MIN_TVL_USD,
    KONG_PPS_ANCHOR_SLACK_DAYS,
    KONG_PPS_LIMIT,
    KONG_PPS_LOOKBACK_DAYS,
    KONG_PPS_QUERY,
    KONG_SLEEP_BETWEEN_REQ_MS,
    KONG_TIMEOUT_SEC,
    KONG_VAULTS_SNAPSHOT_QUERY,
    PPS_RETENTION_DAYS,
    PRODUCT_ACTIVITY_RETENTION_DAYS,
    STYFI_RETENTION_DAYS,
    STYFI_SNAPSHOT_RETENTION_DAYS,
    UPSERT_SQL,
)
from .db_state import _assert_snapshot_size_guard, _complete_run, _insert_run
from .eth import _first_present, _normalize_vault, _parse_chain_id, _post_kong_gql_json

LAST_CLEANUP_AT: datetime | None = None
def _fetch_kong_snapshot() -> list[dict]:
    payload = _post_kong_gql_json(KONG_VAULTS_SNAPSHOT_QUERY, {"origin": "yearn"})
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Kong snapshot GraphQL response missing data")
    vaults = data.get("vaults")
    if not isinstance(vaults, list):
        raise ValueError("Kong snapshot GraphQL response missing vault list")
    return [vault for vault in vaults if isinstance(vault, dict)]


def _store_snapshot(conn: psycopg.Connection, vaults: list[dict]) -> int:
    rows_by_identity: dict[tuple[int, str], dict] = {}
    numeric_failures = {"tvl_usd": 0, "est_apy": 0}
    skipped_missing_identity = 0
    duplicate_identities = 0
    for vault in vaults:
        raw_address = _first_present(vault, ("address", "vaultAddress", "vault_address"))
        vault_address = str(raw_address or "").strip().lower()
        raw_chain_id = _first_present(vault, ("chainID", "chainId", "chain_id"))
        chain_id = _parse_chain_id(raw_chain_id)
        if not vault_address or chain_id is None:
            skipped_missing_identity += 1
            continue
        row, parse_failures = _normalize_vault(vault, vault_address=vault_address, chain_id=chain_id)
        for field in parse_failures:
            numeric_failures[field] += 1
        identity = (chain_id, vault_address)
        if identity in rows_by_identity:
            duplicate_identities += 1
        rows_by_identity[identity] = row

    rows = list(rows_by_identity.values())
    if not rows:
        raise ValueError(
            "Snapshot normalization produced 0 valid rows "
            f"(payload={len(vaults)}, skipped_missing_identity={skipped_missing_identity})"
        )
    _assert_snapshot_size_guard(
        conn,
        normalized_count=len(rows),
        payload_count=len(vaults),
        skipped_missing_identity=skipped_missing_identity,
    )

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("UPDATE vault_dim SET active = FALSE WHERE active = TRUE")
            cur.executemany(UPSERT_SQL, rows)

    if skipped_missing_identity or duplicate_identities:
        logging.warning(
            "Snapshot normalization anomalies: skipped_missing_identity=%s duplicate_identities=%s",
            skipped_missing_identity,
            duplicate_identities,
        )
    if any(numeric_failures.values()):
        logging.warning(
            "Snapshot numeric parse fallbacks: tvl_usd=%s est_apy=%s",
            numeric_failures["tvl_usd"],
            numeric_failures["est_apy"],
        )
    return len(rows)


def _select_kong_vaults(conn: psycopg.Connection) -> list[tuple[int, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address
            FROM vault_dim
            WHERE active = TRUE AND tvl_usd >= %s
            ORDER BY tvl_usd DESC NULLS LAST, chain_id, vault_address
            LIMIT %s
            """,
            (KONG_MIN_TVL_USD, KONG_MAX_VAULTS),
        )
        return [(int(row[0]), str(row[1])) for row in cur.fetchall()]


def _utc_midnight_epoch_days_ago(days_ago: int) -> int:
    safe_days = max(0, days_ago)
    midnight = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((midnight - timedelta(days=safe_days)).timestamp())


def _fetch_kong_series(
    *,
    chain_id: int,
    vault_address: str,
    limit: int | None,
    timestamp: int | None,
) -> list[tuple[int, float]]:
    variables = {
        "label": "pps",
        "chainId": chain_id,
        "address": vault_address,
        "component": "raw",
        "limit": limit,
        "timestamp": timestamp,
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


def _fetch_kong_pps(chain_id: int, vault_address: str) -> list[tuple[int, float]]:
    target_lookback_days = max(0, KONG_PPS_LOOKBACK_DAYS)
    candidate_days: list[int] = [target_lookback_days]
    for delta in range(1, KONG_PPS_ANCHOR_SLACK_DAYS + 1):
        candidate_days.append(target_lookback_days + delta)
        candidate_days.append(max(0, target_lookback_days - delta))
    unique_days: list[int] = []
    for value in candidate_days:
        if value not in unique_days:
            unique_days.append(value)

    best_partial: list[tuple[int, float]] = []
    for days_ago in unique_days:
        points = _fetch_kong_series(
            chain_id=chain_id,
            vault_address=vault_address,
            limit=KONG_PPS_LIMIT,
            timestamp=_utc_midnight_epoch_days_ago(days_ago),
        )
        if len(points) >= 2:
            return points
        if len(points) > len(best_partial):
            best_partial = points

    # Fallback path: pull full history if anchored snapshots did not return enough points.
    points = _fetch_kong_series(chain_id=chain_id, vault_address=vault_address, limit=None, timestamp=None)
    if points:
        trimmed = points[-KONG_PPS_LIMIT:] if KONG_PPS_LIMIT > 0 else points
        if len(trimmed) >= len(best_partial):
            return trimmed
    return best_partial


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
            ON CONFLICT (chain_id, vault_address, ts) DO UPDATE SET
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
            ON CONFLICT (chain_id, vault_address) DO UPDATE SET
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


def _cleanup_old_data(conn: psycopg.Connection) -> dict[str, int]:
    deleted_pps = 0
    deleted_runs = 0
    deleted_styfi_snapshots = 0
    deleted_styfi_epochs = 0
    deleted_product_interactions = 0
    deleted_vault_harvests = 0
    with conn.cursor() as cur:
        if PPS_RETENTION_DAYS > 0:
            cutoff_ts = int((datetime.now(UTC) - timedelta(days=PPS_RETENTION_DAYS)).timestamp())
            cur.execute("DELETE FROM pps_timeseries WHERE ts < %s", (cutoff_ts,))
            deleted_pps = cur.rowcount
        if STYFI_SNAPSHOT_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM styfi_snapshots WHERE observed_at < NOW() - (%s * INTERVAL '1 day')",
                (STYFI_SNAPSHOT_RETENTION_DAYS,),
            )
            deleted_styfi_snapshots = cur.rowcount
        if STYFI_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM styfi_epoch_stats WHERE epoch_start < NOW() - (%s * INTERVAL '1 day')",
                (STYFI_RETENTION_DAYS,),
            )
            deleted_styfi_epochs = cur.rowcount
        if INGESTION_RUN_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM ingestion_runs WHERE started_at < NOW() - (%s * INTERVAL '1 day')",
                (INGESTION_RUN_RETENTION_DAYS,),
            )
            deleted_runs = cur.rowcount
        if PRODUCT_ACTIVITY_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM product_interactions WHERE block_time < NOW() - (%s * INTERVAL '1 day')",
                (PRODUCT_ACTIVITY_RETENTION_DAYS,),
            )
            deleted_product_interactions = cur.rowcount
        if HARVEST_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM vault_harvests WHERE block_time < NOW() - (%s * INTERVAL '1 day')",
                (HARVEST_RETENTION_DAYS,),
            )
            deleted_vault_harvests = cur.rowcount
    conn.commit()
    return {
        "pps_timeseries": deleted_pps,
        "styfi_snapshots": deleted_styfi_snapshots,
        "styfi_epoch_stats": deleted_styfi_epochs,
        "ingestion_runs": deleted_runs,
        "product_interactions": deleted_product_interactions,
        "vault_harvests": deleted_vault_harvests,
    }


def _maybe_cleanup_old_data(conn: psycopg.Connection) -> None:
    global LAST_CLEANUP_AT
    if not DB_CLEANUP_ENABLED:
        return
    now = datetime.now(UTC)
    if LAST_CLEANUP_AT is not None:
        elapsed = max(0, int((now - LAST_CLEANUP_AT).total_seconds()))
        if elapsed < DB_CLEANUP_MIN_INTERVAL_SEC:
            return
    result = _cleanup_old_data(conn)
    LAST_CLEANUP_AT = now
    if any(value > 0 for value in result.values()):
        logging.info(
            "DB cleanup removed rows: pps_timeseries=%s styfi_snapshots=%s styfi_epoch_stats=%s ingestion_runs=%s product_interactions=%s vault_harvests=%s",
            result["pps_timeseries"],
            result["styfi_snapshots"],
            result["styfi_epoch_stats"],
            result["ingestion_runs"],
            result["product_interactions"],
            result["vault_harvests"],
        )
    else:
        logging.info("DB cleanup check completed; no rows removed")


def _run_kong_snapshot_ingestion(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_KONG_SNAPSHOT, started_at)
    try:
        vaults = _fetch_kong_snapshot()
        stored = _store_snapshot(conn, vaults)
        _complete_run(conn, run_id, "success", stored)
        logging.info("Kong vault snapshot success: stored %s vault records", stored)
        return run_id, stored
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)}))
        logging.exception("Kong vault snapshot failed: %s", exc)
        return run_id, 0


def _run_kong_ingestion(conn: psycopg.Connection) -> tuple[int, int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_KONG_PPS, started_at)
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

