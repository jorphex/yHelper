from __future__ import annotations

import json
import logging
import math
import select
import threading
import time
from datetime import UTC, datetime, timedelta

import psycopg
import websocket
from psycopg.types.json import Json

from .config import (
    CHAIN_RPC_URLS,
    EVENT_TOPIC_STRATEGY_REPORTED_V2,
    EVENT_TOPIC_STRATEGY_REPORTED_V3,
    HARVEST_BACKFILL_DAYS,
    HARVEST_BLOCK_SPAN,
    HARVEST_BLOCK_SPAN_BY_CHAIN,
    HARVEST_WSS_CONNECT_TIMEOUT_SEC,
    HARVEST_WSS_ENABLED,
    HARVEST_WSS_HEARTBEAT_SEC,
    HARVEST_WSS_RECONCILE_SEC,
    HARVEST_WSS_REPLAY_BLOCKS,
    HARVEST_WSS_SUBSCRIPTION_CHUNK,
    JOB_VAULT_HARVESTS,
)
from .db_state import _complete_run, _insert_run
from .eth import (
    _chunked,
    _connect,
    _decode_uint256_words,
    _eth_block_number_for_chain,
    _eth_get_block_for_chain,
    _eth_get_logs_for_chain,
    _find_block_at_or_after,
    _hex_to_int,
    _rpc_url_for_chain,
    _topic_address,
    _wss_url_for_chain,
)
from .notifications import _notify_harvest_rows


def _harvest_block_span_for_chain(chain_id: int) -> int:
    return max(1, HARVEST_BLOCK_SPAN_BY_CHAIN.get(chain_id, HARVEST_BLOCK_SPAN))
def _select_harvest_contracts(conn: psycopg.Connection) -> dict[int, dict[str, str]]:
    targets: dict[int, dict[str, str]] = {}
    supported_chain_ids = sorted(CHAIN_RPC_URLS)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address, version
            FROM vault_dim
            WHERE
                COALESCE(TRIM(version), '') <> ''
                AND chain_id = ANY(%(supported_chain_ids)s)
            ORDER BY chain_id, vault_address
            """,
            {"supported_chain_ids": supported_chain_ids},
        )
        for chain_id, vault_address, version in cur.fetchall():
            if not vault_address or not version:
                continue
            chain_targets = targets.setdefault(int(chain_id), {})
            chain_targets[str(vault_address).lower()] = str(version)
    conn.commit()
    return {chain_id: mapping for chain_id, mapping in targets.items() if mapping}


def _harvest_sync_state(conn: psycopg.Connection, chain_id: int) -> tuple[int | None, dict[str, object], datetime | None]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cursor, payload, observed_at
            FROM vault_harvest_sync_state
            WHERE chain_id = %s
            """,
            (chain_id,),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None, {}, None
    cursor_value, payload_value, observed_at = row
    payload = payload_value if isinstance(payload_value, dict) else {}
    cursor = int(cursor_value) if cursor_value is not None else None
    return cursor, payload, observed_at


def _harvest_cursor(conn: psycopg.Connection, chain_id: int) -> int | None:
    cursor, _, _ = _harvest_sync_state(conn, chain_id)
    return cursor


def _upsert_harvest_sync_state(
    conn: psycopg.Connection,
    *,
    chain_id: int,
    cursor: int | None,
    observed_at: datetime,
    payload: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO vault_harvest_sync_state (
                chain_id,
                cursor,
                observed_at,
                payload,
                updated_at
            ) VALUES (
                %(chain_id)s,
                %(cursor)s,
                %(observed_at)s,
                %(payload)s,
                NOW()
            )
            ON CONFLICT (chain_id) DO UPDATE SET
                cursor = COALESCE(EXCLUDED.cursor, vault_harvest_sync_state.cursor),
                observed_at = EXCLUDED.observed_at,
                payload = COALESCE(vault_harvest_sync_state.payload, '{}'::jsonb) || EXCLUDED.payload,
                updated_at = NOW()
            """,
            {
                "chain_id": chain_id,
                "cursor": cursor,
                "observed_at": observed_at,
                "payload": Json(payload),
            },
        )
    conn.commit()


def _parse_harvest_row(
    *,
    chain_id: int,
    vault_address: str,
    vault_version: str,
    log: dict[str, object],
) -> dict[str, object] | None:
    topics = log.get("topics")
    if not isinstance(topics, list) or not topics:
        return None
    topic0 = str(topics[0] or "").lower()
    strategy_address = _topic_address(topics, 1)
    if not strategy_address:
        return None
    values = _decode_uint256_words(log.get("data"))
    if topic0 == EVENT_TOPIC_STRATEGY_REPORTED_V3:
        if len(values) != 6:
            return None
        gain, loss, current_debt, _protocol_fees, total_fees, total_refunds = values
        debt_after = current_debt
        fee_assets = total_fees
        refund_assets = total_refunds
    elif topic0 == EVENT_TOPIC_STRATEGY_REPORTED_V2:
        if len(values) != 8:
            return None
        gain, loss, _debt_paid, _total_gain, _total_loss, total_debt, _debt_added, _debt_ratio = values
        debt_after = total_debt
        fee_assets = None
        refund_assets = None
    else:
        return None
    tx_hash = str(log.get("transactionHash", "")).lower()
    if not tx_hash:
        return None
    block_number = _hex_to_int(log.get("blockNumber"))
    log_index = _hex_to_int(log.get("logIndex"))
    block_timestamp = _hex_to_int(log.get("blockTimestamp"))
    if block_number is None or log_index is None:
        return None
    if block_timestamp is None:
        block = _eth_get_block_for_chain(chain_id, block_number)
        block_timestamp = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
    if block_timestamp is None:
        return None
    return {
        "chain_id": chain_id,
        "block_number": block_number,
        "block_time": datetime.fromtimestamp(block_timestamp, tz=UTC),
        "tx_hash": tx_hash,
        "log_index": log_index,
        "vault_address": vault_address,
        "vault_version": vault_version,
        "strategy_address": strategy_address,
        "gain": gain,
        "loss": loss,
        "debt_after": debt_after,
        "fee_assets": fee_assets,
        "refund_assets": refund_assets,
        "event_topic0": topic0,
        "raw_event": Json(log),
    }


def _upsert_vault_harvests(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO vault_harvests (
                chain_id,
                block_number,
                block_time,
                tx_hash,
                log_index,
                vault_address,
                vault_version,
                strategy_address,
                gain,
                loss,
                debt_after,
                fee_assets,
                refund_assets,
                event_topic0,
                raw_event
            ) VALUES (
                %(chain_id)s,
                %(block_number)s,
                %(block_time)s,
                %(tx_hash)s,
                %(log_index)s,
                %(vault_address)s,
                %(vault_version)s,
                %(strategy_address)s,
                %(gain)s,
                %(loss)s,
                %(debt_after)s,
                %(fee_assets)s,
                %(refund_assets)s,
                %(event_topic0)s,
                %(raw_event)s
            )
            ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
            """,
            rows,
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _recompute_vault_harvest_daily_chain(conn: psycopg.Connection, *, from_day: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM vault_harvest_daily_chain
            WHERE day_utc >= %s::date
            """,
            (from_day.date(),),
        )
        cur.execute(
            """
            INSERT INTO vault_harvest_daily_chain (
                day_utc,
                chain_id,
                harvest_count,
                vault_count,
                strategy_count,
                computed_at
            )
            SELECT
                (block_time AT TIME ZONE 'UTC')::date AS day_utc,
                chain_id,
                COUNT(*) AS harvest_count,
                COUNT(DISTINCT vault_address) AS vault_count,
                COUNT(DISTINCT strategy_address) AS strategy_count,
                NOW()
            FROM vault_harvests
            WHERE block_time >= %s::date
            GROUP BY 1, 2
            ORDER BY 1, 2
            """,
            (from_day.date(),),
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _refresh_vault_harvest_daily_chain_keys(
    conn: psycopg.Connection,
    *,
    day_keys: set[tuple[datetime.date, int]],
) -> int:
    if not day_keys:
        return 0
    inserted = 0
    with conn.cursor() as cur:
        for day_utc, chain_id in sorted(day_keys):
            cur.execute(
                """
                DELETE FROM vault_harvest_daily_chain
                WHERE day_utc = %s AND chain_id = %s
                """,
                (day_utc, chain_id),
            )
            cur.execute(
                """
                INSERT INTO vault_harvest_daily_chain (
                    day_utc,
                    chain_id,
                    harvest_count,
                    vault_count,
                    strategy_count,
                    computed_at
                )
                SELECT
                    %s::date AS day_utc,
                    chain_id,
                    COUNT(*) AS harvest_count,
                    COUNT(DISTINCT vault_address) AS vault_count,
                    COUNT(DISTINCT strategy_address) AS strategy_count,
                    NOW()
                FROM vault_harvests
                WHERE
                    chain_id = %s
                    AND block_time >= %s::date
                    AND block_time < (%s::date + INTERVAL '1 day')
                GROUP BY chain_id
                """,
                (day_utc, chain_id, day_utc, day_utc),
            )
            inserted += cur.rowcount
    conn.commit()
    return inserted


def _harvest_wss_is_healthy(payload: dict[str, object], _now: datetime) -> bool:
    if not HARVEST_WSS_ENABLED:
        return False
    if payload.get("wss_connected") is not True:
        return False
    connected_raw = payload.get("wss_connected_at")
    error_raw = payload.get("wss_last_error_at")
    if not isinstance(error_raw, str):
        return True
    if not isinstance(connected_raw, str):
        return True
    try:
        connected_at = datetime.fromisoformat(connected_raw)
        error_at = datetime.fromisoformat(error_raw)
    except ValueError:
        return True
    if connected_at.tzinfo is None:
        connected_at = connected_at.replace(tzinfo=UTC)
    if error_at.tzinfo is None:
        error_at = error_at.replace(tzinfo=UTC)
    return connected_at >= error_at


def _harvest_wss_reconcile_due(payload: dict[str, object], now: datetime) -> bool:
    last_reconcile_raw = payload.get("last_http_reconcile_at")
    if not isinstance(last_reconcile_raw, str):
        return True
    try:
        last_reconcile = datetime.fromisoformat(last_reconcile_raw)
    except ValueError:
        return True
    if last_reconcile.tzinfo is None:
        last_reconcile = last_reconcile.replace(tzinfo=UTC)
    return (now - last_reconcile) >= timedelta(seconds=HARVEST_WSS_RECONCILE_SEC)


def _harvest_http_start_block(
    *,
    chain_id: int,
    cursor: int | None,
    latest_block: int,
    payload: dict[str, object],
) -> int:
    if cursor is None:
        backfill_start = int((datetime.now(UTC) - timedelta(days=HARVEST_BACKFILL_DAYS)).timestamp())
        return _find_block_at_or_after(chain_id, backfill_start)
    default_start = cursor + 1
    last_seen_value = payload.get("wss_last_seen_block")
    last_seen_block = int(last_seen_value) if isinstance(last_seen_value, int) else None
    if last_seen_block is None and isinstance(last_seen_value, str) and last_seen_value.isdigit():
        last_seen_block = int(last_seen_value)
    replay_anchor = last_seen_block if last_seen_block is not None else latest_block
    replay_start = max(0, replay_anchor - HARVEST_WSS_REPLAY_BLOCKS)
    return max(default_start, replay_start)


class HarvestWssListener(threading.Thread):
    def __init__(self, chain_id: int, contracts: dict[str, str]):
        super().__init__(name=f"harvest-wss-{chain_id}", daemon=True)
        self.chain_id = chain_id
        self._lock = threading.Lock()
        self._contracts = dict(contracts)
        self._restart = threading.Event()
        self._stop_event = threading.Event()

    def update_contracts(self, contracts: dict[str, str]) -> None:
        with self._lock:
            if contracts == self._contracts:
                return
            self._contracts = dict(contracts)
        self._restart.set()

    def stop(self) -> None:
        self._stop_event.set()
        self._restart.set()

    def run(self) -> None:
        backoff = 1.0
        while not self._stop_event.is_set():
            wss_url = _wss_url_for_chain(self.chain_id)
            with self._lock:
                contracts = dict(self._contracts)
            if not wss_url or not contracts:
                time.sleep(1)
                continue
            try:
                self._run_session(wss_url=wss_url, contracts=contracts)
                backoff = 1.0
            except Exception as exc:
                if self._stop_event.is_set():
                    return
                if str(exc) == "contract_set_changed":
                    backoff = 1.0
                    continue
                logging.warning("Harvest WSS listener reconnect: chain=%s error=%s", self.chain_id, exc)
                with _connect() as conn:
                    _upsert_harvest_sync_state(
                        conn,
                        chain_id=self.chain_id,
                        cursor=None,
                        observed_at=datetime.now(UTC),
                        payload={
                            "wss_connected": False,
                            "wss_last_error": str(exc),
                            "wss_last_error_at": datetime.now(UTC).isoformat(),
                        },
                    )
                time.sleep(min(backoff, 30.0))
                backoff = min(backoff * 2, 30.0)

    def _run_session(self, *, wss_url: str, contracts: dict[str, str]) -> None:
        ws = websocket.create_connection(wss_url, timeout=HARVEST_WSS_CONNECT_TIMEOUT_SEC)
        try:
            with _connect() as conn:
                subscription_id = 1
                for address_chunk in _chunked(sorted(contracts), HARVEST_WSS_SUBSCRIPTION_CHUNK):
                    ws.send(
                        json.dumps(
                            {
                                "jsonrpc": "2.0",
                                "id": subscription_id,
                                "method": "eth_subscribe",
                                "params": [
                                    "logs",
                                    {
                                        "address": address_chunk,
                                        "topics": [[EVENT_TOPIC_STRATEGY_REPORTED_V2, EVENT_TOPIC_STRATEGY_REPORTED_V3]],
                                    },
                                ],
                            }
                        )
                    )
                    self._await_subscription_ack(ws, conn, contracts, subscription_id)
                    subscription_id += 1
                now = datetime.now(UTC)
                _upsert_harvest_sync_state(
                    conn,
                    chain_id=self.chain_id,
                    cursor=None,
                    observed_at=now,
                    payload={
                        "wss_connected": True,
                        "wss_connected_at": now.isoformat(),
                        "wss_heartbeat_at": now.isoformat(),
                        "wss_last_error": None,
                    },
                )
                while not self._stop_event.is_set():
                    if self._restart.is_set():
                        self._restart.clear()
                        raise RuntimeError("contract_set_changed")
                    readable, _, _ = select.select([ws.sock], [], [], HARVEST_WSS_HEARTBEAT_SEC)
                    if not readable:
                        heartbeat_at = datetime.now(UTC)
                        _upsert_harvest_sync_state(
                            conn,
                            chain_id=self.chain_id,
                            cursor=None,
                            observed_at=heartbeat_at,
                            payload={
                                "wss_connected": True,
                                "wss_heartbeat_at": heartbeat_at.isoformat(),
                            },
                        )
                        continue
                    raw_message = ws.recv()
                    if not raw_message:
                        raise RuntimeError("empty_wss_message")
                    self._handle_wss_message(conn, contracts, raw_message)
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def _await_subscription_ack(
        self,
        ws: websocket.WebSocket,
        conn: psycopg.Connection,
        contracts: dict[str, str],
        expected_id: int,
    ) -> None:
        while not self._stop_event.is_set():
            raw_message = ws.recv()
            if not raw_message:
                raise RuntimeError("empty_wss_message")
            message = json.loads(raw_message)
            if isinstance(message, dict) and message.get("id") == expected_id:
                if message.get("error"):
                    raise RuntimeError(f"harvest_wss_subscribe_error:{message['error']}")
                return
            self._handle_wss_payload(conn, contracts, message)

    def _handle_wss_message(
        self,
        conn: psycopg.Connection,
        contracts: dict[str, str],
        raw_message: object,
    ) -> None:
        if isinstance(raw_message, bytes):
            raw_message = raw_message.decode("utf-8")
        message = json.loads(raw_message)
        self._handle_wss_payload(conn, contracts, message)

    def _handle_wss_payload(
        self,
        conn: psycopg.Connection,
        contracts: dict[str, str],
        message: object,
    ) -> None:
        if not isinstance(message, dict):
            return
        params = message.get("params")
        if not isinstance(params, dict):
            return
        result = params.get("result")
        if not isinstance(result, dict):
            return
        vault_address = str(result.get("address", "")).lower()
        vault_version = contracts.get(vault_address)
        if not vault_version:
            return
        row = _parse_harvest_row(
            chain_id=self.chain_id,
            vault_address=vault_address,
            vault_version=vault_version,
            log=result,
        )
        if row is None:
            return
        inserted = _upsert_vault_harvests(conn, [row])
        block_time = row["block_time"]
        if inserted > 0 and isinstance(block_time, datetime):
            _refresh_vault_harvest_daily_chain_keys(
                conn,
                day_keys={(block_time.date(), self.chain_id)},
            )
            _notify_harvest_rows(conn, [row])
        seen_at = datetime.now(UTC)
        _upsert_harvest_sync_state(
            conn,
            chain_id=self.chain_id,
            cursor=None,
            observed_at=seen_at,
            payload={
                "wss_connected": True,
                "wss_heartbeat_at": seen_at.isoformat(),
                "wss_last_seen_block": row["block_number"],
                "wss_last_seen_at": seen_at.isoformat(),
            },
        )


class HarvestWssManager:
    def __init__(self) -> None:
        self._listeners: dict[int, HarvestWssListener] = {}

    def refresh(self, targets: dict[int, dict[str, str]]) -> None:
        if not HARVEST_WSS_ENABLED:
            return
        for chain_id, contracts in targets.items():
            if not _wss_url_for_chain(chain_id):
                continue
            listener = self._listeners.get(chain_id)
            if listener is None:
                listener = HarvestWssListener(chain_id, contracts)
                self._listeners[chain_id] = listener
                listener.start()
            else:
                listener.update_contracts(contracts)
        stale_chain_ids = sorted(set(self._listeners) - set(targets))
        for chain_id in stale_chain_ids:
            listener = self._listeners.pop(chain_id)
            listener.stop()


def _run_vault_harvests(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_VAULT_HARVESTS, started_at)
    inserted_total = 0
    recomputed_days = 0
    earliest_seen: datetime | None = None
    errors: list[str] = []
    try:
        targets = _select_harvest_contracts(conn)
        for chain_id, contracts in targets.items():
            try:
                if not _rpc_url_for_chain(chain_id):
                    errors.append(f"{chain_id}:missing_rpc")
                    continue
                now = datetime.now(UTC)
                latest_block = _eth_block_number_for_chain(chain_id)
                cursor, sync_payload, _ = _harvest_sync_state(conn, chain_id)
                notifications_primed = bool(sync_payload.get("notifications_primed")) if isinstance(sync_payload, dict) else False
                wss_url = _wss_url_for_chain(chain_id) if HARVEST_WSS_ENABLED else None
                wss_healthy = bool(wss_url) and _harvest_wss_is_healthy(sync_payload, now)
                should_reconcile = not bool(wss_url) or cursor is None or not wss_healthy or _harvest_wss_reconcile_due(sync_payload, now)
                if not should_reconcile:
                    _upsert_harvest_sync_state(
                        conn,
                        chain_id=chain_id,
                        cursor=cursor,
                        observed_at=now,
                        payload={
                            "status": "wss_live",
                            "contracts": len(contracts),
                            "last_http_skip_at": now.isoformat(),
                        },
                    )
                    continue
                start_block = _harvest_http_start_block(
                    chain_id=chain_id,
                    cursor=cursor,
                    latest_block=latest_block,
                    payload=sync_payload,
                )
                if start_block > latest_block:
                    _upsert_harvest_sync_state(
                        conn,
                        chain_id=chain_id,
                        cursor=latest_block,
                        observed_at=now,
                        payload={
                            "status": "up_to_date",
                            "contracts": len(contracts),
                            "last_http_reconcile_at": now.isoformat(),
                            "wss_connected": wss_healthy,
                            "notifications_primed": True if cursor is not None else notifications_primed,
                        },
                    )
                    continue
                logging.info(
                    "Vault harvest sync: chain=%s contracts=%s from_block=%s to_block=%s wss_healthy=%s",
                    chain_id,
                    len(contracts),
                    start_block,
                    latest_block,
                    wss_healthy,
                )
                chain_inserted = 0
                chain_first_seen: datetime | None = None
                block_span = _harvest_block_span_for_chain(chain_id)
                max_block_span = block_span
                current_block = start_block
                addresses = sorted(contracts)
                while current_block <= latest_block:
                    end_block = min(latest_block, current_block + block_span - 1)
                    try:
                        for address_chunk in _chunked(addresses, 100):
                            logs = _eth_get_logs_for_chain(
                                chain_id,
                                addresses=address_chunk,
                                from_block=current_block,
                                to_block=end_block,
                                topics=[[EVENT_TOPIC_STRATEGY_REPORTED_V2, EVENT_TOPIC_STRATEGY_REPORTED_V3]],
                            )
                            rows: list[dict[str, object]] = []
                            for log in logs:
                                vault_address = str(log.get("address", "")).lower()
                                vault_version = contracts.get(vault_address)
                                if not vault_version:
                                    continue
                                row = _parse_harvest_row(
                                    chain_id=chain_id,
                                    vault_address=vault_address,
                                    vault_version=vault_version,
                                    log=log,
                                )
                                if row is None:
                                    continue
                                block_time = row["block_time"]
                                if isinstance(block_time, datetime) and (
                                    chain_first_seen is None or block_time < chain_first_seen
                                ):
                                    chain_first_seen = block_time
                                rows.append(row)
                            chain_inserted += _upsert_vault_harvests(conn, rows)
                            if cursor is not None and notifications_primed and rows:
                                _notify_harvest_rows(conn, rows)
                    except Exception as window_exc:
                        if block_span <= 1:
                            raise
                        next_block_span = max(1, block_span // 2)
                        logging.warning(
                            "Vault harvest log window retry: chain=%s from_block=%s to_block=%s span=%s next_span=%s error=%s",
                            chain_id,
                            current_block,
                            end_block,
                            block_span,
                            next_block_span,
                            window_exc,
                        )
                        block_span = next_block_span
                        continue
                    current_block = end_block + 1
                    if block_span < max_block_span:
                        block_span = min(max_block_span, block_span + math.ceil((max_block_span - block_span) / 2))
                _upsert_harvest_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=latest_block,
                    observed_at=datetime.now(UTC),
                    payload={
                        "status": "success",
                        "contracts": len(contracts),
                        "from_block": start_block,
                        "to_block": latest_block,
                        "inserted": chain_inserted,
                        "last_http_reconcile_at": datetime.now(UTC).isoformat(),
                        "last_http_mode": "backfill" if cursor is None else ("catchup" if not wss_healthy else "reconcile"),
                        "wss_connected": wss_healthy,
                        "notifications_primed": True,
                        "last_http_error": None,
                    },
                )
                inserted_total += chain_inserted
                if chain_first_seen is not None and (earliest_seen is None or chain_first_seen < earliest_seen):
                    earliest_seen = chain_first_seen
            except Exception as chain_exc:
                errors.append(f"{chain_id}:{chain_exc}")
                _upsert_harvest_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=_harvest_cursor(conn, chain_id),
                    observed_at=datetime.now(UTC),
                    payload={
                        "status": "failed",
                        "contracts": len(contracts),
                        "last_http_error": str(chain_exc),
                        "last_http_error_at": datetime.now(UTC).isoformat(),
                    },
                )
                logging.exception("Vault harvest chain failed: chain=%s error=%s", chain_id, chain_exc)
                continue
        if earliest_seen is None:
            earliest_seen = datetime.now(UTC) - timedelta(days=1)
        recomputed_days = _recompute_vault_harvest_daily_chain(conn, from_day=earliest_seen)
        status = "partial_success" if errors else "success"
        _complete_run(
            conn,
            run_id,
            status,
            inserted_total,
            json.dumps({"inserted": inserted_total, "recomputed_days": recomputed_days, "errors": errors}),
        )
        logging.info(
            "Vault harvest sync complete: status=%s inserted=%s recomputed_days=%s errors=%s",
            status,
            inserted_total,
            recomputed_days,
            len(errors),
        )
        return inserted_total, recomputed_days
    except Exception as exc:
        _complete_run(conn, run_id, "failed", inserted_total, json.dumps({"error": str(exc), "errors": errors}))
        logging.exception("Vault harvest sync failed: %s", exc)
        return inserted_total, recomputed_days

