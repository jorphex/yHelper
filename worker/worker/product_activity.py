from __future__ import annotations

import json
import logging
import math
from datetime import UTC, datetime, timedelta

import psycopg
from psycopg.types.json import Json

from .config import (
    CHAIN_RPC_URLS,
    EVENT_TOPIC_CLAIM,
    EVENT_TOPIC_DEPOSIT,
    EVENT_TOPIC_TRANSFER,
    EVENT_TOPIC_WITHDRAW,
    JOB_PRODUCT_DAU,
    PRODUCT_ACTIVITY_BACKFILL_DAYS,
    PRODUCT_ACTIVITY_BLOCK_SPAN,
    PRODUCT_ACTIVITY_BLOCK_SPAN_BY_CHAIN,
    PRODUCT_ACTIVITY_TOPICS,
    STYFI_ASSET_DECIMALS,
    STYFI_ASSET_SYMBOL,
    STYFI_CHAIN_ID,
    STYFI_CLAIM_IGNORED_ACCOUNTS,
    STYFI_CLAIM_SOURCES,
    STYFI_CONTRACTS,
    STYFI_EVENT_CONTRACTS,
    STYFI_PRODUCT_SYMBOLS,
    STYFI_REWARD_TOKEN_DEFAULT,
)
from .db_state import _complete_run, _insert_run
from .eth import (
    _chunked,
    _decode_uint256_words,
    _eth_block_number_for_chain,
    _eth_get_block_for_chain,
    _eth_get_logs_for_chain,
    _eth_get_transaction_receipt_for_chain,
    _find_block_at_or_after,
    _hex_to_int,
    _normalize_optional_address,
    _rpc_url_for_chain,
    _to_int_or_none,
    _topic_address,
)
from .notifications import _notify_styfi_activity_rows


def _product_activity_block_span_for_chain(chain_id: int) -> int:
    return max(1, PRODUCT_ACTIVITY_BLOCK_SPAN_BY_CHAIN.get(chain_id, PRODUCT_ACTIVITY_BLOCK_SPAN))


def _product_activity_reward_token_meta(conn: psycopg.Connection) -> dict[str, object]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT payload
            FROM styfi_sync_state
            WHERE stream_name = 'styfi_reward_epoch'
            """,
        )
        row = cur.fetchone()
    conn.commit()
    payload = row[0] if row else {}
    reward_token = payload.get("reward_token") if isinstance(payload, dict) else {}
    if not isinstance(reward_token, dict):
        reward_token = {}
    symbol = str(reward_token.get("symbol") or STYFI_REWARD_TOKEN_DEFAULT["symbol"])
    decimals = _to_int_or_none(reward_token.get("decimals"))
    return {
        "address": _normalize_optional_address(reward_token.get("address") or STYFI_REWARD_TOKEN_DEFAULT["address"]),
        "symbol": symbol,
        "decimals": STYFI_REWARD_TOKEN_DEFAULT["decimals"] if decimals is None else decimals,
    }


def _product_activity_amount_payload(
    *,
    product_type: str,
    event_kind: str,
    data: object,
    reward_token_meta: dict[str, object],
) -> dict[str, object | None]:
    words = _decode_uint256_words(data)
    if event_kind in {"deposit", "withdraw"} and product_type in {"styfi", "styfix"}:
        amount_raw = words[0] if words else None
        return {
            "amount_raw": amount_raw,
            "amount_decimals": STYFI_ASSET_DECIMALS,
            "amount_symbol": STYFI_ASSET_SYMBOL,
        }
    if event_kind == "unstake" and product_type in {"styfi", "styfix"}:
        amount_raw = words[0] if words else None
        return {
            "amount_raw": amount_raw,
            "amount_decimals": STYFI_ASSET_DECIMALS,
            "amount_symbol": STYFI_PRODUCT_SYMBOLS.get(product_type),
        }
    if event_kind == "claim" and product_type in {"styfi", "styfix"}:
        amount_raw = words[0] if words else None
        return {
            "amount_raw": amount_raw,
            "amount_decimals": _to_int_or_none(reward_token_meta.get("decimals")),
            "amount_symbol": reward_token_meta.get("symbol"),
        }
    return {
        "amount_raw": None,
        "amount_decimals": None,
        "amount_symbol": None,
    }



def _select_product_activity_contracts(conn: psycopg.Connection) -> dict[int, dict[str, str]]:
    targets: dict[int, dict[str, str]] = {}
    supported_chain_ids = sorted(CHAIN_RPC_URLS)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address
            FROM vault_dim
            WHERE
                version LIKE '3.%%'
                AND
                (active = TRUE OR COALESCE(tvl_usd, 0) > 0)
                AND chain_id = ANY(%(supported_chain_ids)s)
            ORDER BY chain_id, vault_address
            """,
            {"supported_chain_ids": supported_chain_ids},
        )
        for chain_id, vault_address in cur.fetchall():
            chain_targets = targets.setdefault(int(chain_id), {})
            chain_targets[str(vault_address).lower()] = "vault"
    conn.commit()
    ethereum_targets = targets.setdefault(STYFI_CHAIN_ID, {})
    ethereum_targets[STYFI_CONTRACTS["styfi"]] = "styfi"
    ethereum_targets[STYFI_CONTRACTS["styfix"]] = "styfix"
    return {chain_id: mapping for chain_id, mapping in targets.items() if mapping}


def _product_activity_accounts(
    *,
    product_type: str,
    event_kind: str,
    topics: list[object],
) -> tuple[str | None, str | None, str | None]:
    if event_kind == "deposit":
        sender = _topic_address(topics, 1)
        owner = _topic_address(topics, 2)
        return sender, owner, "event_owner"
    if event_kind == "withdraw":
        sender = _topic_address(topics, 1)
        owner = _topic_address(topics, 3)
        return sender, owner, "event_owner"
    if event_kind == "unstake" and product_type in {"styfi", "styfix"}:
        from_account = _topic_address(topics, 1)
        to_account = _topic_address(topics, 2)
        if from_account and to_account == "0x0000000000000000000000000000000000000000":
            return from_account, from_account, "event_burn_from"
    if event_kind == "claim" and product_type in {"styfi", "styfix"}:
        account = _topic_address(topics, 1)
        if account and account not in STYFI_CLAIM_IGNORED_ACCOUNTS:
            return account, account, "event_claim_account"
    return None, None, None


def _product_activity_claim_rows(
    *,
    claim_logs: list[dict[str, object]],
    chain_id: int,
    reward_token_meta: dict[str, object],
) -> list[dict[str, object]]:
    if not claim_logs:
        return []
    candidates_by_tx: dict[str, list[dict[str, object]]] = {}
    for log in claim_logs:
        topics = log.get("topics")
        if not isinstance(topics, list) or not topics:
            continue
        product_contract = str(log.get("address", "")).lower()
        source_kind = STYFI_CLAIM_SOURCES.get(product_contract)
        if not source_kind:
            continue
        account = _topic_address(topics, 1)
        if not account or account in STYFI_CLAIM_IGNORED_ACCOUNTS:
            continue
        tx_hash = str(log.get("transactionHash", "")).lower()
        if not tx_hash:
            continue
        block_number = _hex_to_int(log.get("blockNumber"))
        log_index = _hex_to_int(log.get("logIndex"))
        block_timestamp = _hex_to_int(log.get("blockTimestamp"))
        if block_number is None or log_index is None:
            continue
        if block_timestamp is None:
            block = _eth_get_block_for_chain(chain_id, block_number)
            block_timestamp = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
        if block_timestamp is None:
            continue
        block_time = datetime.fromtimestamp(block_timestamp, tz=UTC)
        candidates_by_tx.setdefault(tx_hash, []).append(
            {
                "chain_id": chain_id,
                "block_number": block_number,
                "block_time": block_time,
                "tx_hash": tx_hash,
                "log_index": log_index,
                "source_kind": source_kind,
                "product_contract": product_contract,
                "event_topic0": EVENT_TOPIC_CLAIM,
                "account": account,
                "data": log.get("data"),
            }
        )
    rows: list[dict[str, object]] = []
    for tx_hash, candidates in candidates_by_tx.items():
        by_account: dict[str, list[dict[str, object]]] = {}
        for candidate in candidates:
            by_account.setdefault(str(candidate["account"]), []).append(candidate)
        for account, account_candidates in by_account.items():
            specific = [c for c in account_candidates if c["source_kind"] in {"styfi", "styfix"}]
            if not specific:
                continue
            kept_by_product: dict[str, dict[str, object]] = {}
            for candidate in specific:
                product_type = str(candidate["source_kind"])
                current = kept_by_product.get(product_type)
                if current is None or int(candidate["log_index"]) < int(current["log_index"]):
                    kept_by_product[product_type] = candidate
            for product_type, candidate in kept_by_product.items():
                rows.append(
                    {
                        "chain_id": int(candidate["chain_id"]),
                        "block_number": int(candidate["block_number"]),
                        "block_time": candidate["block_time"],
                        "tx_hash": tx_hash,
                        "log_index": int(candidate["log_index"]),
                        "product_type": product_type,
                        "product_contract": str(candidate["product_contract"]),
                        "event_kind": "claim",
                        "event_topic0": str(candidate["event_topic0"]),
                        "tx_from": account,
                        "user_account": account,
                        "attribution_kind": "event_claim_tx_account",
                        **_product_activity_amount_payload(
                            product_type=product_type,
                            event_kind="claim",
                            data=candidate.get("data"),
                            reward_token_meta=reward_token_meta,
                        ),
                    }
                )
    return rows


def _product_activity_cursor(conn: psycopg.Connection, chain_id: int) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cursor
            FROM product_activity_sync_state
            WHERE chain_id = %s
            """,
            (chain_id,),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    value = row[0]
    return int(value) if value is not None else None


def _upsert_product_activity_sync_state(
    conn: psycopg.Connection,
    *,
    chain_id: int,
    cursor: int,
    observed_at: datetime,
    payload: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO product_activity_sync_state (
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
                cursor = EXCLUDED.cursor,
                observed_at = EXCLUDED.observed_at,
                payload = EXCLUDED.payload,
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


def _upsert_product_interactions(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO product_interactions (
                chain_id,
                block_number,
                block_time,
                tx_hash,
                log_index,
                product_type,
                product_contract,
                event_kind,
                event_topic0,
                tx_from,
                user_account,
                attribution_kind,
                amount_raw,
                amount_decimals,
                amount_symbol
            ) VALUES (
                %(chain_id)s,
                %(block_number)s,
                %(block_time)s,
                %(tx_hash)s,
                %(log_index)s,
                %(product_type)s,
                %(product_contract)s,
                %(event_kind)s,
                %(event_topic0)s,
                %(tx_from)s,
                %(user_account)s,
                %(attribution_kind)s,
                %(amount_raw)s,
                %(amount_decimals)s,
                %(amount_symbol)s
            )
            ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
                amount_raw = COALESCE(product_interactions.amount_raw, EXCLUDED.amount_raw),
                amount_decimals = COALESCE(product_interactions.amount_decimals, EXCLUDED.amount_decimals),
                amount_symbol = COALESCE(product_interactions.amount_symbol, EXCLUDED.amount_symbol)
            """,
            rows,
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _recompute_product_dau_daily(conn: psycopg.Connection, *, from_day: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM product_dau_daily
            WHERE day_utc >= %s::date
            """,
            (from_day.date(),),
        )
        cur.execute(
            """
            INSERT INTO product_dau_daily (
                day_utc,
                dau_total,
                dau_vaults,
                dau_styfi,
                dau_styfix,
                computed_at
            )
            SELECT
                (block_time AT TIME ZONE 'UTC')::date AS day_utc,
                COUNT(DISTINCT user_account) AS dau_total,
                COUNT(DISTINCT CASE WHEN product_type = 'vault' THEN user_account END) AS dau_vaults,
                COUNT(DISTINCT CASE WHEN product_type = 'styfi' THEN user_account END) AS dau_styfi,
                COUNT(DISTINCT CASE WHEN product_type = 'styfix' THEN user_account END) AS dau_styfix,
                NOW()
            FROM product_interactions
            WHERE block_time >= %s::date
            GROUP BY 1
            ORDER BY 1
            """,
            (from_day.date(),),
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _run_product_dau(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_PRODUCT_DAU, started_at)
    inserted_total = 0
    recomputed_days = 0
    earliest_seen: datetime | None = None
    errors: list[str] = []
    try:
        targets = _select_product_activity_contracts(conn)
        reward_token_meta = _product_activity_reward_token_meta(conn)
        for chain_id, contracts in targets.items():
            try:
                rpc_url = _rpc_url_for_chain(chain_id)
                if not rpc_url:
                    errors.append(f"{chain_id}:missing_rpc")
                    continue
                latest_block = _eth_block_number_for_chain(chain_id)
                cursor = _product_activity_cursor(conn, chain_id)
                if cursor is None:
                    backfill_start = int((datetime.now(UTC) - timedelta(days=PRODUCT_ACTIVITY_BACKFILL_DAYS)).timestamp())
                    start_block = _find_block_at_or_after(chain_id, backfill_start)
                else:
                    start_block = cursor + 1
                if start_block > latest_block:
                    _upsert_product_activity_sync_state(
                        conn,
                        chain_id=chain_id,
                        cursor=latest_block,
                        observed_at=datetime.now(UTC),
                        payload={"status": "up_to_date", "contracts": len(contracts)},
                    )
                    continue
                logging.info(
                    "Product DAU sync: chain=%s contracts=%s from_block=%s to_block=%s",
                    chain_id,
                    len(contracts),
                    start_block,
                    latest_block,
                )
                chain_inserted = 0
                chain_first_seen: datetime | None = None
                vault_addresses = sorted(address for address, product_type in contracts.items() if product_type == "vault")
                styfi_addresses = sorted(address for address in contracts if address in STYFI_EVENT_CONTRACTS)
                styfi_claim_addresses = sorted(STYFI_CLAIM_SOURCES) if chain_id == STYFI_CHAIN_ID else []
                max_block_span = _product_activity_block_span_for_chain(chain_id)
                block_span = max_block_span
                current_block = start_block
                while current_block <= latest_block:
                    end_block = min(latest_block, current_block + block_span - 1)
                    try:
                        query_groups: list[tuple[list[str], list[list[str]]]] = []
                        if vault_addresses:
                            query_groups.append(
                                (
                                    vault_addresses,
                                    [[EVENT_TOPIC_DEPOSIT, EVENT_TOPIC_WITHDRAW]],
                                )
                            )
                        if styfi_addresses:
                            query_groups.append(
                                (
                                    styfi_addresses,
                                    [[EVENT_TOPIC_DEPOSIT, EVENT_TOPIC_WITHDRAW, EVENT_TOPIC_TRANSFER]],
                                )
                            )
                        if styfi_claim_addresses:
                            query_groups.append(
                                (
                                    styfi_claim_addresses,
                                    [[EVENT_TOPIC_CLAIM]],
                                )
                            )
                        for addresses, topics_filter in query_groups:
                            for address_chunk in _chunked(addresses, 100):
                                logs = _eth_get_logs_for_chain(
                                    chain_id,
                                    addresses=address_chunk,
                                    from_block=current_block,
                                    to_block=end_block,
                                    topics=topics_filter,
                                )
                                rows: list[dict[str, object]] = []
                                for log in logs:
                                    topics = log.get("topics")
                                    if not isinstance(topics, list) or not topics:
                                        continue
                                    topic0 = str(topics[0]).lower()
                                    event_kind = PRODUCT_ACTIVITY_TOPICS.get(topic0)
                                    if not event_kind:
                                        continue
                                    if event_kind == "claim":
                                        continue
                                    product_contract = str(log.get("address", "")).lower()
                                    product_type = contracts.get(product_contract)
                                    if not product_type:
                                        continue
                                    event_sender, user_account, attribution_kind = _product_activity_accounts(
                                        product_type=product_type,
                                        event_kind=event_kind,
                                        topics=topics,
                                    )
                                    if not event_sender or not user_account or not attribution_kind:
                                        continue
                                    tx_hash = str(log.get("transactionHash", "")).lower()
                                    if not tx_hash:
                                        continue
                                    block_number = _hex_to_int(log.get("blockNumber"))
                                    log_index = _hex_to_int(log.get("logIndex"))
                                    block_timestamp = _hex_to_int(log.get("blockTimestamp"))
                                    if block_number is None or log_index is None:
                                        continue
                                    if block_timestamp is None:
                                        block = _eth_get_block_for_chain(chain_id, block_number)
                                        block_timestamp = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
                                    if block_timestamp is None:
                                        continue
                                    block_time = datetime.fromtimestamp(block_timestamp, tz=UTC)
                                    if chain_first_seen is None or block_time < chain_first_seen:
                                        chain_first_seen = block_time
                                    rows.append(
                                        {
                                            "chain_id": chain_id,
                                            "block_number": block_number,
                                            "block_time": block_time,
                                            "tx_hash": tx_hash,
                                            "log_index": log_index,
                                            "product_type": product_type,
                                            "product_contract": product_contract,
                                            "event_kind": event_kind,
                                            "event_topic0": topic0,
                                            "tx_from": event_sender,
                                            "user_account": user_account,
                                            "attribution_kind": attribution_kind,
                                            **_product_activity_amount_payload(
                                                product_type=product_type,
                                                event_kind=event_kind,
                                                data=log.get("data"),
                                                reward_token_meta=reward_token_meta,
                                            ),
                                        }
                                    )
                                chain_inserted += _upsert_product_interactions(conn, rows)
                                if chain_id == STYFI_CHAIN_ID and cursor is not None and rows:
                                    styfi_rows = [row for row in rows if str(row.get("product_type")) in {"styfi", "styfix"}]
                                    if styfi_rows:
                                        _notify_styfi_activity_rows(conn, styfi_rows)
                                if topics_filter == [[EVENT_TOPIC_CLAIM]]:
                                    claim_rows = _product_activity_claim_rows(
                                        claim_logs=logs,
                                        chain_id=chain_id,
                                        reward_token_meta=reward_token_meta,
                                    )
                                    if claim_rows:
                                        chain_inserted += _upsert_product_interactions(conn, claim_rows)
                                        if chain_id == STYFI_CHAIN_ID and cursor is not None:
                                            _notify_styfi_activity_rows(conn, claim_rows)
                    except Exception as window_exc:
                        if block_span <= 1:
                            raise
                        next_block_span = max(1, block_span // 2)
                        logging.warning(
                            "Product DAU log window retry: chain=%s from_block=%s to_block=%s span=%s next_span=%s error=%s",
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
                _upsert_product_activity_sync_state(
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
                    },
                )
                logging.info(
                    "Product DAU chain complete: chain=%s inserted=%s",
                    chain_id,
                    chain_inserted,
                )
                inserted_total += chain_inserted
                if chain_first_seen is not None and (earliest_seen is None or chain_first_seen < earliest_seen):
                    earliest_seen = chain_first_seen
            except Exception as chain_exc:
                errors.append(f"{chain_id}:{chain_exc}")
                _upsert_product_activity_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=_product_activity_cursor(conn, chain_id),
                    observed_at=datetime.now(UTC),
                    payload={"status": "failed", "contracts": len(contracts), "error": str(chain_exc)},
                )
                logging.exception("Product DAU chain failed: chain=%s error=%s", chain_id, chain_exc)
                continue
        if earliest_seen is None:
            earliest_seen = datetime.now(UTC) - timedelta(days=1)
        recomputed_days = _recompute_product_dau_daily(conn, from_day=earliest_seen)
        status = "partial_success" if errors else "success"
        _complete_run(
            conn,
            run_id,
            status,
            inserted_total,
            json.dumps({"inserted": inserted_total, "recomputed_days": recomputed_days, "errors": errors}),
        )
        logging.info(
            "Product DAU sync complete: status=%s inserted=%s recomputed_days=%s errors=%s",
            status,
            inserted_total,
            recomputed_days,
            len(errors),
        )
        return run_id, inserted_total
    except Exception as exc:
        _complete_run(
            conn,
            run_id,
            "failed",
            inserted_total,
            json.dumps({"error": str(exc), "inserted": inserted_total, "recomputed_days": recomputed_days, "errors": errors}),
        )
        logging.exception("Product DAU sync failed: %s", exc)
        return run_id, inserted_total


def _backfill_styfi_activity_amounts(conn: psycopg.Connection, *, limit: int = 500) -> int:
    reward_token_meta = _product_activity_reward_token_meta(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                chain_id,
                tx_hash,
                log_index,
                product_type,
                event_kind,
                product_contract
            FROM product_interactions
            WHERE
                chain_id = %(chain_id)s
                AND product_type IN ('styfi', 'styfix')
                AND (amount_raw IS NULL OR amount_decimals IS NULL OR COALESCE(amount_symbol, '') = '')
            ORDER BY block_time DESC, tx_hash DESC, log_index DESC
            LIMIT %(limit)s
            """,
            {"chain_id": STYFI_CHAIN_ID, "limit": limit},
        )
        pending = cur.fetchall()
    conn.commit()
    if not pending:
        return 0
    by_tx: dict[str, list[dict[str, object]]] = {}
    for chain_id, tx_hash, log_index, product_type, event_kind, product_contract in pending:
        by_tx.setdefault(str(tx_hash), []).append(
            {
                "chain_id": int(chain_id),
                "tx_hash": str(tx_hash),
                "log_index": int(log_index),
                "product_type": str(product_type),
                "event_kind": str(event_kind),
                "product_contract": str(product_contract).lower(),
            }
        )
    updates: list[dict[str, object]] = []
    for tx_hash, rows in by_tx.items():
        chain_id = int(rows[0]["chain_id"])
        try:
            receipt = _eth_get_transaction_receipt_for_chain(chain_id, tx_hash)
        except Exception as exc:
            logging.warning("stYFI amount backfill receipt fetch failed: tx=%s error=%s", tx_hash, exc)
            continue
        logs = receipt.get("logs")
        if not isinstance(logs, list):
            continue
        logs_by_index = {
            _hex_to_int(log.get("logIndex")): log
            for log in logs
            if isinstance(log, dict) and _hex_to_int(log.get("logIndex")) is not None
        }
        for row in rows:
            log = logs_by_index.get(int(row["log_index"]))
            if not isinstance(log, dict):
                continue
            payload = _product_activity_amount_payload(
                product_type=str(row["product_type"]),
                event_kind=str(row["event_kind"]),
                data=log.get("data"),
                reward_token_meta=reward_token_meta,
            )
            if payload["amount_raw"] is None and payload["amount_decimals"] is None and payload["amount_symbol"] is None:
                continue
            updates.append(
                {
                    "chain_id": chain_id,
                    "tx_hash": tx_hash,
                    "log_index": int(row["log_index"]),
                    "amount_raw": payload["amount_raw"],
                    "amount_decimals": payload["amount_decimals"],
                    "amount_symbol": payload["amount_symbol"],
                }
            )
    if not updates:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            UPDATE product_interactions
            SET
                amount_raw = COALESCE(amount_raw, %(amount_raw)s),
                amount_decimals = COALESCE(amount_decimals, %(amount_decimals)s),
                amount_symbol = COALESCE(amount_symbol, %(amount_symbol)s)
            WHERE
                chain_id = %(chain_id)s
                AND tx_hash = %(tx_hash)s
                AND log_index = %(log_index)s
            """,
            updates,
        )
        updated = cur.rowcount
    conn.commit()
    if updated > 0:
        logging.info("stYFI activity amount backfill updated=%s pending=%s", updated, len(pending))
    return updated
