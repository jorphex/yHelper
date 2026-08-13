from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

import psycopg
from psycopg.types.json import Json

from .config import (
    EVENT_TOPIC_REWARD_DEPOSITED,
    JOB_YLOCKER_REWARDS,
    YLOCKER_BACKFILL_DAYS,
    YLOCKER_BLOCK_SPAN,
    YLOCKER_CHAIN_ID,
    YLOCKER_PRODUCTS,
    YLOCKER_REPLAY_BLOCKS,
    YLOCKER_REWARD_TOKEN,
)
from .db_state import _complete_run, _insert_run
from .eth import (
    _eth_call_uint_for_chain,
    _eth_finalized_block_for_chain,
    _eth_get_block_for_chain,
    _eth_get_logs_for_chain,
    _find_block_at_or_after,
    _hex_to_int,
    _topic_address,
)

WEEK_SECONDS = 7 * 24 * 60 * 60


def _sync_state(conn: psycopg.Connection, product: str) -> tuple[int | None, dict[str, object]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT cursor, payload FROM ylocker_reward_sync_state WHERE product = %s",
            (product,),
        )
        row = cur.fetchone()
    if not row:
        return None, {}
    cursor, payload = row
    return (int(cursor) if cursor is not None else None), (payload if isinstance(payload, dict) else {})


def _upsert_sync_state(
    conn: psycopg.Connection,
    *,
    product: str,
    distributor: str,
    cursor: int | None,
    observed_at: datetime | None,
    payload: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ylocker_reward_sync_state (
                product, chain_id, distributor_address, cursor, observed_at, payload, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (product) DO UPDATE SET
                chain_id = EXCLUDED.chain_id,
                distributor_address = EXCLUDED.distributor_address,
                cursor = COALESCE(EXCLUDED.cursor, ylocker_reward_sync_state.cursor),
                observed_at = COALESCE(EXCLUDED.observed_at, ylocker_reward_sync_state.observed_at),
                payload = ylocker_reward_sync_state.payload || EXCLUDED.payload,
                updated_at = NOW()
            """,
            (
                product,
                YLOCKER_CHAIN_ID,
                distributor,
                cursor,
                observed_at,
                Json(payload),
            ),
        )


def _decode_reward_event(
    *,
    product: str,
    distributor: str,
    official_depositors: set[str],
    start_time: int,
    log: dict[str, object],
    block: dict[str, object],
    pps_raw: int,
) -> dict[str, object] | None:
    topics_raw = log.get("topics")
    topics = topics_raw if isinstance(topics_raw, list) else []
    if len(topics) < 3:
        return None
    native_week = _hex_to_int(str(topics[1]))
    depositor = _topic_address(topics, 2)
    block_number = _hex_to_int(str(log.get("blockNumber") or ""))
    log_index = _hex_to_int(str(log.get("logIndex") or ""))
    block_ts = _hex_to_int(str(block.get("timestamp") or ""))
    tx_hash = str(log.get("transactionHash") or "").lower()
    block_hash = str(log.get("blockHash") or "").lower()
    data = str(log.get("data") or "")
    if (
        native_week is None
        or depositor is None
        or block_number is None
        or log_index is None
        or block_ts is None
        or not tx_hash.startswith("0x")
        or not block_hash.startswith("0x")
        or not data.startswith("0x")
    ):
        return None
    reward_shares_raw = int(data, 16)
    reward_scale = 10 ** int(YLOCKER_REWARD_TOKEN["decimals"])
    reward_assets_raw = reward_shares_raw * pps_raw // reward_scale
    cycle_start = datetime.fromtimestamp(start_time + native_week * WEEK_SECONDS, UTC)
    return {
        "chain_id": YLOCKER_CHAIN_ID,
        "product": product,
        "distributor_address": distributor,
        "block_number": block_number,
        "block_hash": block_hash,
        "block_time": datetime.fromtimestamp(block_ts, UTC),
        "tx_hash": tx_hash,
        "log_index": log_index,
        "native_week": native_week,
        "cycle_start": cycle_start,
        "cycle_end": cycle_start + timedelta(seconds=WEEK_SECONDS),
        "depositor_address": depositor,
        "is_official": depositor in official_depositors,
        "reward_shares_raw": reward_shares_raw,
        "pps_raw": pps_raw,
        "reward_assets_raw": reward_assets_raw,
        "raw_event": Json(log),
    }


def _replace_window(
    conn: psycopg.Connection,
    *,
    product: str,
    from_block: int,
    to_block: int,
    rows: list[dict[str, object]],
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM ylocker_reward_events
            WHERE product = %s AND chain_id = %s AND block_number BETWEEN %s AND %s
            """,
            (product, YLOCKER_CHAIN_ID, from_block, to_block),
        )
        if rows:
            cur.executemany(
                """
                INSERT INTO ylocker_reward_events (
                    chain_id, product, distributor_address, block_number, block_hash, block_time,
                    tx_hash, log_index, native_week, cycle_start, cycle_end, depositor_address,
                    is_official, reward_shares_raw, pps_raw, reward_assets_raw, raw_event
                ) VALUES (
                    %(chain_id)s, %(product)s, %(distributor_address)s, %(block_number)s,
                    %(block_hash)s, %(block_time)s, %(tx_hash)s, %(log_index)s, %(native_week)s,
                    %(cycle_start)s, %(cycle_end)s, %(depositor_address)s, %(is_official)s,
                    %(reward_shares_raw)s, %(pps_raw)s, %(reward_assets_raw)s, %(raw_event)s
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
                    product = EXCLUDED.product,
                    distributor_address = EXCLUDED.distributor_address,
                    block_number = EXCLUDED.block_number,
                    block_hash = EXCLUDED.block_hash,
                    block_time = EXCLUDED.block_time,
                    native_week = EXCLUDED.native_week,
                    cycle_start = EXCLUDED.cycle_start,
                    cycle_end = EXCLUDED.cycle_end,
                    depositor_address = EXCLUDED.depositor_address,
                    is_official = EXCLUDED.is_official,
                    reward_shares_raw = EXCLUDED.reward_shares_raw,
                    pps_raw = EXCLUDED.pps_raw,
                    reward_assets_raw = EXCLUDED.reward_assets_raw,
                    raw_event = EXCLUDED.raw_event,
                    ingested_at = NOW()
                """,
                rows,
            )
    return len(rows)


def _sync_product(
    conn: psycopg.Connection,
    *,
    product: str,
    config: dict[str, object],
    finalized_block: int,
    finalized_at: datetime,
) -> int:
    distributor = str(config["distributor"]).lower()
    official_depositors = {str(value).lower() for value in config["official_depositors"]}
    cursor, _ = _sync_state(conn, product)
    if cursor is None:
        backfill_start = int((datetime.now(UTC) - timedelta(days=YLOCKER_BACKFILL_DAYS)).timestamp())
        from_block = _find_block_at_or_after(YLOCKER_CHAIN_ID, backfill_start)
    else:
        from_block = max(0, cursor - YLOCKER_REPLAY_BLOCKS + 1)
    if from_block > finalized_block:
        _upsert_sync_state(
            conn,
            product=product,
            distributor=distributor,
            cursor=finalized_block,
            observed_at=finalized_at,
            payload={"status": "up_to_date", "to_block": finalized_block},
        )
        conn.commit()
        return 0

    start_time = _eth_call_uint_for_chain(YLOCKER_CHAIN_ID, distributor, "START_TIME()")
    inserted = 0
    block_cache: dict[int, dict[str, object]] = {}
    pps_cache: dict[int, int] = {}
    current = from_block
    while current <= finalized_block:
        end = min(finalized_block, current + YLOCKER_BLOCK_SPAN - 1)
        logs = _eth_get_logs_for_chain(
            YLOCKER_CHAIN_ID,
            addresses=[distributor],
            from_block=current,
            to_block=end,
            topics=[EVENT_TOPIC_REWARD_DEPOSITED],
        )
        rows: list[dict[str, object]] = []
        for log in logs:
            block_number = _hex_to_int(str(log.get("blockNumber") or ""))
            if block_number is None:
                continue
            block = block_cache.get(block_number)
            if block is None:
                block = _eth_get_block_for_chain(YLOCKER_CHAIN_ID, block_number)
                block_cache[block_number] = block
            pps_raw = pps_cache.get(block_number)
            if pps_raw is None:
                pps_raw = _eth_call_uint_for_chain(
                    YLOCKER_CHAIN_ID,
                    str(YLOCKER_REWARD_TOKEN["address"]),
                    "pricePerShare()",
                    block_number=block_number,
                )
                pps_cache[block_number] = pps_raw
            row = _decode_reward_event(
                product=product,
                distributor=distributor,
                official_depositors=official_depositors,
                start_time=start_time,
                log=log,
                block=block,
                pps_raw=pps_raw,
            )
            if row is not None:
                rows.append(row)
        inserted += _replace_window(
            conn,
            product=product,
            from_block=current,
            to_block=end,
            rows=rows,
        )
        conn.commit()
        current = end + 1

    _upsert_sync_state(
        conn,
        product=product,
        distributor=distributor,
        cursor=finalized_block,
        observed_at=finalized_at,
        payload={
            "status": "success",
            "from_block": from_block,
            "to_block": finalized_block,
            "events_seen": inserted,
            "start_time": start_time,
        },
    )
    conn.commit()
    return inserted


def _run_ylocker_rewards(conn: psycopg.Connection) -> int:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_YLOCKER_REWARDS, started_at)
    events_seen = 0
    errors: list[str] = []
    try:
        finalized = _eth_finalized_block_for_chain(YLOCKER_CHAIN_ID)
        finalized_block = _hex_to_int(str(finalized.get("number") or ""))
        finalized_ts = _hex_to_int(str(finalized.get("timestamp") or ""))
        if finalized_block is None or finalized_ts is None:
            raise ValueError("Finalized Ethereum block is missing its number or timestamp")
        finalized_at = datetime.fromtimestamp(finalized_ts, UTC)
        for product, config in YLOCKER_PRODUCTS.items():
            try:
                events_seen += _sync_product(
                    conn,
                    product=product,
                    config=config,
                    finalized_block=finalized_block,
                    finalized_at=finalized_at,
                )
            except Exception as exc:
                conn.rollback()
                errors.append(f"{product}:{exc}")
                _upsert_sync_state(
                    conn,
                    product=product,
                    distributor=str(config["distributor"]).lower(),
                    cursor=_sync_state(conn, product)[0],
                    observed_at=None,
                    payload={
                        "status": "failed",
                        "last_error": str(exc),
                        "last_error_at": datetime.now(UTC).isoformat(),
                    },
                )
                conn.commit()
                logging.exception("yLocker sync failed for %s", product)
        status = "partial_success" if errors else "success"
        _complete_run(conn, run_id, status, events_seen, json.dumps({"events_seen": events_seen, "errors": errors}))
        return events_seen
    except Exception as exc:
        conn.rollback()
        _complete_run(conn, run_id, "failed", events_seen, json.dumps({"error": str(exc), "errors": errors}))
        logging.exception("yLocker reward sync failed")
        return events_seen
