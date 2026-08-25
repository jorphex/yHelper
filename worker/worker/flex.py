from __future__ import annotations

import argparse
import json
import logging
import math
from datetime import UTC, datetime, timedelta

import psycopg
from eth_utils import keccak
from psycopg.types.json import Json

from .config import (
    FLEX_BACKFILL_DAYS,
    FLEX_BLOCK_SPAN,
    FLEX_CHAIN_ID,
    FLEX_FACTORIES,
    FLEX_IMPLEMENTATIONS,
    FLEX_MAX_SNAPSHOT_HOURS_PER_RUN,
    FLEX_REGISTRY_ADDRESS,
    FLEX_REPLAY_BLOCKS,
    FLEX_SNAPSHOT_INTERVAL_SEC,
    FLEX_USDC_USD_FEED,
    JOB_FLEX_SYNC,
)
from .db_state import _complete_run, _ensure_schema, _insert_run
from .eth import (
    _connect,
    _eth_call_address,
    _eth_call_string,
    _eth_call_uint,
    _eth_decode_uint256,
    _eth_finalized_block_for_chain,
    _eth_get_block_for_chain,
    _eth_get_logs_for_chain,
    _eth_rpc_batch_to_url,
    _eth_rpc_to_url,
    _eth_selector,
    _find_block_at_or_after,
    _hex_to_int,
    _rpc_url_for_chain,
    _topic_address,
)
from .flex_api import (
    FLEX_API_MARKETS_URL,
    FLEX_API_PARAMS_URL,
    FLEX_SOFT_ERRORS,
    _api_payload,
    _live_api_metadata,
    _sync_redemption_priorities,
    _sync_trove_health,
)

WAD = 10**18
FLEX_SOURCE = "ethereum_archive_rpc"
LOGGER = logging.getLogger(__name__)


def _topic(signature: str) -> str:
    return f"0x{keccak(text=signature).hex()}"


EVENT_SPECS: dict[str, tuple[str, tuple[str, ...], tuple[str, ...]]] = {
    _topic("OpenTrove(uint256,address,uint256,uint256,uint256,uint256)"): (
        "open_trove",
        ("trove_id", "owner"),
        ("collateral_raw", "debt_raw", "upfront_fee_raw", "annual_interest_rate_raw"),
    ),
    _topic("AddCollateral(uint256,address,uint256)"): (
        "add_collateral",
        ("trove_id", "owner"),
        ("collateral_raw",),
    ),
    _topic("RemoveCollateral(uint256,address,uint256)"): (
        "remove_collateral",
        ("trove_id", "owner"),
        ("collateral_raw",),
    ),
    _topic("Borrow(uint256,address,uint256,uint256)"): (
        "borrow",
        ("trove_id", "owner"),
        ("debt_raw", "upfront_fee_raw"),
    ),
    _topic("Repay(uint256,address,uint256)"): (
        "repay",
        ("trove_id", "owner"),
        ("debt_raw",),
    ),
    _topic("AdjustInterestRate(uint256,address,uint256,uint256)"): (
        "adjust_interest_rate",
        ("trove_id", "owner"),
        ("annual_interest_rate_raw", "upfront_fee_raw"),
    ),
    _topic("CloseTrove(uint256,address,uint256,uint256)"): (
        "close_trove",
        ("trove_id", "owner"),
        ("collateral_raw", "debt_raw"),
    ),
    _topic("CloseZombieTrove(uint256,address,uint256,uint256)"): (
        "close_zombie_trove",
        ("trove_id", "owner"),
        ("collateral_raw", "debt_raw"),
    ),
    _topic("BadDebt(uint256,uint256,uint256)"): (
        "bad_debt",
        ("trove_id",),
        ("loss_raw", "loss_absorbed_by_fees_raw"),
    ),
    _topic("LiquidateTrove(uint256,address,address,uint256,uint256,bool)"): (
        "liquidation",
        ("trove_id", "owner", "liquidator"),
        ("collateral_raw", "debt_raw", "is_full_liquidation"),
    ),
    _topic("RedeemTrove(uint256,address,address,uint256,uint256)"): (
        "redeem_trove",
        ("trove_id", "owner", "redeemer"),
        ("collateral_raw", "debt_raw"),
    ),
    _topic("Redeem(address,uint256,uint256)"): (
        "redemption",
        ("redeemer",),
        ("collateral_raw", "debt_raw"),
    ),
    _topic("Deposit(address,address,uint256,uint256)"): (
        "lender_deposit",
        ("sender", "owner"),
        ("assets_raw", "shares_raw"),
    ),
    _topic("Withdraw(address,address,address,uint256,uint256)"): (
        "lender_withdrawal",
        ("sender", "receiver", "owner"),
        ("assets_raw", "shares_raw"),
    ),
    _topic("AuctionKick(uint256,uint256,bool)"): (
        "auction_kick",
        ("auction_id", "is_re_kick"),
        ("collateral_raw",),
    ),
    _topic("AuctionTake(uint256,uint256,uint256,uint256,address,address)"): (
        "auction_take",
        ("auction_id",),
        ("take_raw", "remaining_raw", "needed_raw", "taker", "receiver"),
    ),
}
FACTORY_DEPLOY_TOPIC = _topic("DeployNewMarket(address,address,address,address,address,address)")
ENDORSE_TOPIC = _topic("EndorseMarket(address)")
UNENDORSE_TOPIC = _topic("UnendorseMarket(address)")
LIFECYCLE_TOPICS = {FACTORY_DEPLOY_TOPIC, ENDORSE_TOPIC, UNENDORSE_TOPIC}
ALL_EVENT_TOPICS = [*EVENT_SPECS, *LIFECYCLE_TOPICS]


def _words(value: object) -> list[str]:
    raw = str(value or "")
    if not raw.startswith("0x"):
        return []
    payload = raw[2:]
    if len(payload) % 64:
        return []
    return [payload[index : index + 64] for index in range(0, len(payload), 64)]


def _word_address(word: str) -> str:
    return f"0x{word[-40:]}".lower()


def _topic_uint(topics: list[object], index: int) -> int | None:
    if index >= len(topics):
        return None
    try:
        return int(str(topics[index]), 16)
    except ValueError:
        return None


def _decode_indexed(name: str, topics: list[object], index: int) -> str | int | bool | None:
    if name in {"owner", "sender", "receiver", "liquidator", "redeemer"}:
        return _topic_address(topics, index)
    value = _topic_uint(topics, index)
    if name == "is_re_kick" and value is not None:
        return bool(value)
    return str(value) if value is not None else None


def _decode_data_value(name: str, word: str) -> str | bool:
    if name in {"taker", "receiver"}:
        return _word_address(word)
    if name == "is_full_liquidation":
        return bool(int(word, 16))
    return str(int(word, 16))


def _contract_creation_block(address: str, latest_block: int) -> int:
    rpc_url = _rpc_url_for_chain(FLEX_CHAIN_ID)
    if not rpc_url:
        raise ValueError("Ethereum RPC is not configured")
    low = 0
    high = latest_block
    candidate = latest_block
    while low <= high:
        middle = (low + high) // 2
        code = _eth_rpc_to_url(rpc_url, "eth_getCode", [address, hex(middle)])
        exists = isinstance(code, str) and code not in {"0x", "0x0"}
        if exists:
            candidate = middle
            high = middle - 1
        else:
            low = middle + 1
    return candidate


def _read_address(address: str, signature: str) -> str:
    return _eth_call_address(address, signature).lower()


def _safe_uint(address: str, signature: str) -> int | None:
    try:
        return _eth_call_uint(address, signature)
    except FLEX_SOFT_ERRORS:
        return None


def _safe_string(address: str, signature: str) -> str | None:
    try:
        return _eth_call_string(address, signature).strip()
    except FLEX_SOFT_ERRORS:
        return None


def _discover_markets(conn: psycopg.Connection, finalized_block: int) -> list[dict[str, object]]:
    api_metadata = _live_api_metadata()
    registry_creation = _contract_creation_block(FLEX_REGISTRY_ADDRESS, finalized_block)
    registry_logs = _eth_get_logs_for_chain(
        FLEX_CHAIN_ID,
        addresses=[FLEX_REGISTRY_ADDRESS],
        from_block=registry_creation,
        to_block=finalized_block,
        topics=[[ENDORSE_TOPIC, UNENDORSE_TOPIC]],
    )
    endorsement: dict[str, str] = {}
    for log in registry_logs:
        topics = log.get("topics") if isinstance(log.get("topics"), list) else []
        market = _topic_address(topics, 1)
        if market:
            endorsement[market] = "endorsed" if str(topics[0]).lower() == ENDORSE_TOPIC else "unendorsed"

    discovered: list[dict[str, object]] = []
    for factory, version in FLEX_FACTORIES.items():
        creation_block = _contract_creation_block(factory, finalized_block)
        logs = _eth_get_logs_for_chain(
            FLEX_CHAIN_ID,
            addresses=[factory],
            from_block=creation_block,
            to_block=finalized_block,
            topics=[FACTORY_DEPLOY_TOPIC],
        )
        for log in logs:
            topics = log.get("topics") if isinstance(log.get("topics"), list) else []
            market = _topic_address(topics, 2)
            block_number = _hex_to_int(str(log.get("blockNumber") or ""))
            data_words = _words(log.get("data"))
            if not market or block_number is None or len(data_words) < 4:
                continue
            block = _eth_get_block_for_chain(FLEX_CHAIN_ID, block_number)
            block_ts = _hex_to_int(str(block.get("timestamp") or ""))
            if block_ts is None:
                continue
            sorted_troves, dutch_desk, auction, lender = [_word_address(word) for word in data_words[:4]]
            collateral = _read_address(market, "collateral_token()")
            borrow = _read_address(market, "borrow_token()")
            oracle = _read_address(market, "price_oracle()")
            collateral_decimals = int(_eth_call_uint(collateral, "decimals()"))
            borrow_decimals = int(_eth_call_uint(borrow, "decimals()"))
            collateral_symbol = _safe_string(collateral, "symbol()") or collateral[:10]
            borrow_symbol = _safe_string(borrow, "symbol()") or borrow[:10]
            meta = api_metadata.get(market, {})
            display = meta.get("display") if isinstance(meta.get("display"), dict) else {}
            label = str(display.get("label") or f"{collateral_symbol}/{borrow_symbol}")
            params: dict[str, object] = {}
            try:
                params = _api_payload(
                    FLEX_API_PARAMS_URL,
                    {"chain_id": FLEX_CHAIN_ID, "trove_manager": market},
                )
            except FLEX_SOFT_ERRORS as exc:
                LOGGER.debug("Flex market parameters unavailable for %s: %s", market, exc)
            oracle_meta = params.get("oracle") if isinstance(params.get("oracle"), dict) else {}
            status = endorsement.get(market, "unendorsed")
            market_status = "unendorsed" if status == "unendorsed" else ("deprecated" if version == "1.0.0" else "active")
            row = {
                "chain_id": FLEX_CHAIN_ID,
                "market_address": market,
                "registry_address": FLEX_REGISTRY_ADDRESS,
                "factory_address": factory,
                "contract_version": version,
                "implementation_address": FLEX_IMPLEMENTATIONS[version],
                "deployment_block": block_number,
                "deployment_time": datetime.fromtimestamp(block_ts, UTC),
                "deployment_tx_hash": str(log.get("transactionHash") or "").lower(),
                "endorsement_status": status,
                "market_status": market_status,
                "lender_address": lender,
                "collateral_token_address": collateral,
                "collateral_token_symbol": str(display.get("collateral_token_symbol") or collateral_symbol),
                "collateral_token_decimals": collateral_decimals,
                "borrow_token_address": borrow,
                "borrow_token_symbol": str(display.get("borrow_token_symbol") or borrow_symbol),
                "borrow_token_decimals": borrow_decimals,
                "sorted_troves_address": sorted_troves,
                "dutch_desk_address": dutch_desk,
                "auction_address": auction,
                "price_oracle_address": oracle,
                "one_pct_raw": int(_eth_call_uint(market, "one_pct()")),
                "min_debt_raw": _safe_uint(market, "min_debt()"),
                "safe_collateral_ratio_raw": _safe_uint(market, "safe_collateral_ratio()"),
                "minimum_collateral_ratio_raw": _safe_uint(market, "minimum_collateral_ratio()"),
                "max_penalty_collateral_ratio_raw": _safe_uint(market, "max_penalty_collateral_ratio()"),
                "min_liquidation_fee_raw": _safe_uint(market, "min_liquidation_fee()"),
                "max_liquidation_fee_raw": _safe_uint(market, "max_liquidation_fee()"),
                "min_annual_interest_rate_raw": _safe_uint(market, "min_annual_interest_rate()"),
                "max_annual_interest_rate_raw": _safe_uint(market, "max_annual_interest_rate()"),
                "oracle_description": str(oracle_meta.get("description") or "") or None,
                "raw_metadata": Json({"label": label, "flex_api": meta, "params": params}),
            }
            discovered.append(row)

    with conn.cursor() as cur:
        for row in discovered:
            cur.execute(
                """
                INSERT INTO flex_market_dim (
                    chain_id, market_address, registry_address, factory_address, contract_version,
                    implementation_address,
                    deployment_block, deployment_time, deployment_tx_hash, endorsement_status,
                    market_status, lender_address, collateral_token_address, collateral_token_symbol,
                    collateral_token_decimals, borrow_token_address, borrow_token_symbol,
                    borrow_token_decimals, sorted_troves_address, dutch_desk_address, auction_address,
                    price_oracle_address, one_pct_raw, min_debt_raw, safe_collateral_ratio_raw,
                    minimum_collateral_ratio_raw, max_penalty_collateral_ratio_raw,
                    min_liquidation_fee_raw, max_liquidation_fee_raw,
                    min_annual_interest_rate_raw, max_annual_interest_rate_raw,
                    oracle_description, raw_metadata
                ) VALUES (
                    %(chain_id)s, %(market_address)s, %(registry_address)s, %(factory_address)s,
                    %(contract_version)s, %(implementation_address)s, %(deployment_block)s, %(deployment_time)s,
                    %(deployment_tx_hash)s, %(endorsement_status)s, %(market_status)s,
                    %(lender_address)s, %(collateral_token_address)s, %(collateral_token_symbol)s,
                    %(collateral_token_decimals)s, %(borrow_token_address)s, %(borrow_token_symbol)s,
                    %(borrow_token_decimals)s, %(sorted_troves_address)s, %(dutch_desk_address)s,
                    %(auction_address)s, %(price_oracle_address)s, %(one_pct_raw)s, %(min_debt_raw)s,
                    %(safe_collateral_ratio_raw)s, %(minimum_collateral_ratio_raw)s,
                    %(max_penalty_collateral_ratio_raw)s, %(min_liquidation_fee_raw)s,
                    %(max_liquidation_fee_raw)s, %(min_annual_interest_rate_raw)s,
                    %(max_annual_interest_rate_raw)s, %(oracle_description)s, %(raw_metadata)s
                )
                ON CONFLICT (chain_id, market_address) DO UPDATE SET
                    endorsement_status = EXCLUDED.endorsement_status,
                    market_status = EXCLUDED.market_status,
                    contract_version = EXCLUDED.contract_version,
                    implementation_address = EXCLUDED.implementation_address,
                    lender_address = EXCLUDED.lender_address,
                    collateral_token_address = EXCLUDED.collateral_token_address,
                    collateral_token_symbol = EXCLUDED.collateral_token_symbol,
                    collateral_token_decimals = EXCLUDED.collateral_token_decimals,
                    borrow_token_address = EXCLUDED.borrow_token_address,
                    borrow_token_symbol = EXCLUDED.borrow_token_symbol,
                    borrow_token_decimals = EXCLUDED.borrow_token_decimals,
                    sorted_troves_address = EXCLUDED.sorted_troves_address,
                    dutch_desk_address = EXCLUDED.dutch_desk_address,
                    auction_address = EXCLUDED.auction_address,
                    price_oracle_address = EXCLUDED.price_oracle_address,
                    one_pct_raw = EXCLUDED.one_pct_raw,
                    min_debt_raw = EXCLUDED.min_debt_raw,
                    safe_collateral_ratio_raw = EXCLUDED.safe_collateral_ratio_raw,
                    minimum_collateral_ratio_raw = EXCLUDED.minimum_collateral_ratio_raw,
                    max_penalty_collateral_ratio_raw = EXCLUDED.max_penalty_collateral_ratio_raw,
                    min_liquidation_fee_raw = EXCLUDED.min_liquidation_fee_raw,
                    max_liquidation_fee_raw = EXCLUDED.max_liquidation_fee_raw,
                    min_annual_interest_rate_raw = EXCLUDED.min_annual_interest_rate_raw,
                    max_annual_interest_rate_raw = EXCLUDED.max_annual_interest_rate_raw,
                    oracle_description = EXCLUDED.oracle_description,
                    raw_metadata = EXCLUDED.raw_metadata,
                    updated_at = NOW()
                """,
                row,
            )
    conn.commit()
    return discovered


def _sync_cursor(conn: psycopg.Connection, stream: str) -> int | None:
    with conn.cursor() as cur:
        cur.execute("SELECT cursor FROM flex_sync_state WHERE stream_name = %s", (stream,))
        row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _set_sync_cursor(
    conn: psycopg.Connection,
    stream: str,
    cursor: int,
    observed_at: datetime,
    payload: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO flex_sync_state (stream_name, chain_id, cursor, observed_at, payload, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (stream_name) DO UPDATE SET
                cursor = EXCLUDED.cursor,
                observed_at = EXCLUDED.observed_at,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            """,
            (stream, FLEX_CHAIN_ID, cursor, observed_at, Json(payload)),
        )


def _event_market(log: dict[str, object], address_map: dict[str, str]) -> str | None:
    address = str(log.get("address") or "").lower()
    topics = log.get("topics") if isinstance(log.get("topics"), list) else []
    topic0 = str(topics[0]).lower() if topics else ""
    if topic0 == FACTORY_DEPLOY_TOPIC:
        return _topic_address(topics, 2)
    if topic0 in {ENDORSE_TOPIC, UNENDORSE_TOPIC}:
        return _topic_address(topics, 1)
    return address_map.get(address)


def _decode_event(log: dict[str, object], market: dict[str, object], block: dict[str, object]) -> dict[str, object] | None:
    topics = log.get("topics") if isinstance(log.get("topics"), list) else []
    if not topics:
        return None
    topic0 = str(topics[0]).lower()
    block_number = _hex_to_int(str(log.get("blockNumber") or ""))
    log_index = _hex_to_int(str(log.get("logIndex") or ""))
    block_ts = _hex_to_int(str(block.get("timestamp") or ""))
    if block_number is None or log_index is None or block_ts is None:
        return None
    actors: dict[str, object] = {}
    amounts: dict[str, object] = {}
    if topic0 in LIFECYCLE_TOPICS:
        event_name = {
            FACTORY_DEPLOY_TOPIC: "market_deployed",
            ENDORSE_TOPIC: "market_endorsed",
            UNENDORSE_TOPIC: "market_unendorsed",
        }[topic0]
    else:
        spec = EVENT_SPECS.get(topic0)
        if spec is None:
            return None
        event_name, indexed_names, data_names = spec
        for index, name in enumerate(indexed_names, start=1):
            value = _decode_indexed(name, topics, index)
            if value is not None:
                (actors if name in {"owner", "sender", "receiver", "liquidator", "redeemer"} else amounts)[name] = value
        data_words = _words(log.get("data"))
        for name, word in zip(data_names, data_words):
            value = _decode_data_value(name, word)
            (actors if name in {"taker", "receiver"} else amounts)[name] = value
    return {
        "chain_id": FLEX_CHAIN_ID,
        "market_address": str(market["market_address"]),
        "contract_version": str(market["contract_version"]),
        "contract_address": str(log.get("address") or "").lower(),
        "block_number": block_number,
        "block_hash": str(log.get("blockHash") or "").lower(),
        "block_time": datetime.fromtimestamp(block_ts, UTC),
        "tx_hash": str(log.get("transactionHash") or "").lower(),
        "log_index": log_index,
        "event_name": event_name,
        "event_topic0": topic0,
        "actors": Json(actors),
        "amounts": Json(amounts),
        "raw_event": Json(log),
        "source": FLEX_SOURCE,
    }


def _sync_events(
    conn: psycopg.Connection,
    markets: list[dict[str, object]],
    finalized_block: int,
    finalized_at: datetime,
) -> int:
    if not markets:
        return 0
    cursor = _sync_cursor(conn, "events")
    earliest = min(int(market["deployment_block"]) for market in markets)
    from_block = earliest if cursor is None else max(earliest, cursor - FLEX_REPLAY_BLOCKS + 1)
    address_map: dict[str, str] = {}
    market_map = {str(row["market_address"]): row for row in markets}
    addresses = {FLEX_REGISTRY_ADDRESS, *FLEX_FACTORIES.keys()}
    for market in markets:
        market_address = str(market["market_address"])
        for key in ("market_address", "lender_address", "auction_address"):
            address = str(market[key]).lower()
            addresses.add(address)
            address_map[address] = market_address
    inserted = 0
    block_cache: dict[int, dict[str, object]] = {}
    current = from_block
    while current <= finalized_block:
        end = min(finalized_block, current + FLEX_BLOCK_SPAN - 1)
        logs = _eth_get_logs_for_chain(
            FLEX_CHAIN_ID,
            addresses=sorted(addresses),
            from_block=current,
            to_block=end,
            topics=[ALL_EVENT_TOPICS],
        )
        rows: list[dict[str, object]] = []
        for log in logs:
            market_address = _event_market(log, address_map)
            market = market_map.get(str(market_address or "").lower())
            block_number = _hex_to_int(str(log.get("blockNumber") or ""))
            if market is None or block_number is None:
                continue
            block = block_cache.get(block_number)
            if block is None:
                block = _eth_get_block_for_chain(FLEX_CHAIN_ID, block_number)
                block_cache[block_number] = block
            row = _decode_event(log, market, block)
            if row:
                rows.append(row)
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM flex_events WHERE chain_id = %s AND block_number BETWEEN %s AND %s",
                (FLEX_CHAIN_ID, current, end),
            )
            if rows:
                cur.executemany(
                    """
                    INSERT INTO flex_events (
                        chain_id, market_address, contract_version, contract_address, block_number,
                        block_hash, block_time, tx_hash, log_index, event_name, event_topic0,
                        actors, amounts, raw_event, source
                    ) VALUES (
                        %(chain_id)s, %(market_address)s, %(contract_version)s, %(contract_address)s,
                        %(block_number)s, %(block_hash)s, %(block_time)s, %(tx_hash)s, %(log_index)s,
                        %(event_name)s, %(event_topic0)s, %(actors)s, %(amounts)s, %(raw_event)s, %(source)s
                    )
                    ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
                        block_number = EXCLUDED.block_number,
                        block_hash = EXCLUDED.block_hash,
                        block_time = EXCLUDED.block_time,
                        event_name = EXCLUDED.event_name,
                        actors = EXCLUDED.actors,
                        amounts = EXCLUDED.amounts,
                        raw_event = EXCLUDED.raw_event,
                        ingested_at = NOW()
                    """,
                    rows,
                )
        _set_sync_cursor(conn, "events", end, finalized_at, {"status": "syncing", "from_block": current, "to_block": end})
        conn.commit()
        inserted += len(rows)
        current = end + 1
    _set_sync_cursor(
        conn,
        "events",
        finalized_block,
        finalized_at,
        {"status": "complete", "from_block": from_block, "to_block": finalized_block, "events": inserted},
    )
    return inserted


def _call_data(signature: str) -> str:
    return f"0x{_eth_selector(signature)}"


def _batch_state(markets: list[dict[str, object]], block_number: int) -> dict[str, dict[str, int]]:
    rpc_url = _rpc_url_for_chain(FLEX_CHAIN_ID)
    if not rpc_url:
        raise ValueError("Ethereum RPC is not configured")
    calls: list[tuple[str, list[object]]] = []
    keys: list[tuple[str, str]] = []
    for market in markets:
        market_address = str(market["market_address"])
        state_calls = {
            "collateral": (market_address, "collateral_balance()"),
            "stored_debt": (market_address, "total_debt()"),
            "weighted_debt": (market_address, "total_weighted_debt()"),
            "last_debt_update_time": (market_address, "last_debt_update_time()"),
            "deposits": (str(market["lender_address"]), "totalAssets()"),
            "idle": (str(market["borrow_token_address"]), "balanceOf(address)"),
            "oracle_price": (str(market["price_oracle_address"]), "get_price(bool)"),
        }
        for name, (address, signature) in state_calls.items():
            data = _call_data(signature)
            if name == "idle":
                data += str(market["lender_address"]).lower().replace("0x", "").rjust(64, "0")
            elif name == "oracle_price":
                data += "0" * 64
            calls.append(("eth_call", [{"to": address, "data": data}, hex(block_number)]))
            keys.append((market_address, name))
    feed_calls = [
        ("eth_call", [{"to": FLEX_USDC_USD_FEED, "data": _call_data("latestRoundData()")}, hex(block_number)]),
        ("eth_call", [{"to": FLEX_USDC_USD_FEED, "data": _call_data("decimals()")}, hex(block_number)]),
    ]
    results = _eth_rpc_batch_to_url(rpc_url, [*calls, *feed_calls])
    state: dict[str, dict[str, int]] = {str(market["market_address"]): {} for market in markets}
    for (market_address, name), result in zip(keys, results[: len(keys)]):
        if not isinstance(result, str):
            raise TypeError(f"Missing historical state result for {market_address} {name}")
        state[market_address][name] = _eth_decode_uint256(result)
    round_data = results[-2]
    feed_decimals_result = results[-1]
    if not isinstance(round_data, str) or not isinstance(feed_decimals_result, str):
        raise TypeError("Missing historical USDC oracle result")
    round_words = _words(round_data)
    if len(round_words) < 2:
        raise ValueError("Malformed historical USDC oracle result")
    answer = int(round_words[1], 16)
    if answer >= 2**255:
        answer -= 2**256
    if answer <= 0:
        raise ValueError(f"Invalid historical USDC oracle answer: {answer}")
    feed_decimals = _eth_decode_uint256(feed_decimals_result)
    for market_state in state.values():
        market_state["borrow_usd_price"] = answer
        market_state["borrow_usd_price_decimals"] = feed_decimals
    return state


def _usd_e18(amount_raw: int, token_decimals: int, price_raw: int, price_decimals: int) -> int:
    return amount_raw * price_raw * WAD // (10**token_decimals * 10**price_decimals)


def _snapshot_row(
    market: dict[str, object],
    state: dict[str, int],
    sampled_hour: datetime,
    block: dict[str, object],
) -> dict[str, object]:
    block_number = _hex_to_int(str(block.get("number") or ""))
    block_ts = _hex_to_int(str(block.get("timestamp") or ""))
    if block_number is None or block_ts is None:
        raise ValueError("Historical block is missing number or timestamp")
    collateral_decimals = int(market["collateral_token_decimals"])
    borrow_decimals = int(market["borrow_token_decimals"])
    collateral_in_borrow = (
        state["collateral"]
        * state["oracle_price"]
        * 10**borrow_decimals
        // (10**collateral_decimals * WAD)
    )
    deposits = state["deposits"]
    elapsed = max(0, block_ts - state["last_debt_update_time"])
    precision = 10**borrow_decimals
    interest_numerator = state["weighted_debt"] * elapsed
    interest_denominator = 365 * 24 * 60 * 60 * precision
    pending_interest = (interest_numerator + interest_denominator - 1) // interest_denominator
    debt = state["stored_debt"] + pending_interest
    utilization = min(WAD, debt * WAD // deposits) if deposits else 0
    avg_borrow_rate = state["weighted_debt"] // debt if debt else 0
    lender_apr = state["weighted_debt"] * WAD // (deposits * 10**borrow_decimals) if deposits else 0
    price = state["borrow_usd_price"]
    price_decimals = state["borrow_usd_price_decimals"]
    return {
        "chain_id": FLEX_CHAIN_ID,
        "market_address": str(market["market_address"]),
        "sampled_hour": sampled_hour,
        "block_number": block_number,
        "block_hash": str(block.get("hash") or "").lower(),
        "block_time": datetime.fromtimestamp(block_ts, UTC),
        "contract_version": str(market["contract_version"]),
        "collateral_raw": state["collateral"],
        "debt_raw": debt,
        "weighted_debt_raw": state["weighted_debt"],
        "deposits_raw": deposits,
        "idle_liquidity_raw": state["idle"],
        "collateral_price_in_borrow_wad": state["oracle_price"],
        "borrow_usd_price_raw": price,
        "borrow_usd_price_decimals": price_decimals,
        "collateral_usd_e18": _usd_e18(collateral_in_borrow, borrow_decimals, price, price_decimals),
        "debt_usd_e18": _usd_e18(debt, borrow_decimals, price, price_decimals),
        "deposits_usd_e18": _usd_e18(deposits, borrow_decimals, price, price_decimals),
        "idle_liquidity_usd_e18": _usd_e18(state["idle"], borrow_decimals, price, price_decimals),
        "utilization_wad": utilization,
        "lender_apr_wad": lender_apr,
        "avg_borrow_rate_raw": avg_borrow_rate,
        "source": FLEX_SOURCE,
    }


def _nearest_block(target: datetime, previous: dict[str, object] | None, finalized_block: int) -> dict[str, object]:
    target_ts = int(target.timestamp())
    if previous is None:
        candidate = min(finalized_block, _find_block_at_or_after(FLEX_CHAIN_ID, target_ts))
    else:
        previous_number = int(_hex_to_int(str(previous.get("number") or "")) or 0)
        previous_ts = int(_hex_to_int(str(previous.get("timestamp") or "")) or target_ts)
        candidate = min(finalized_block, max(previous_number + 1, previous_number + (target_ts - previous_ts) // 12))
    block = _eth_get_block_for_chain(FLEX_CHAIN_ID, candidate)
    for _ in range(4):
        block_ts = int(_hex_to_int(str(block.get("timestamp") or "")) or target_ts)
        delta = target_ts - block_ts
        if abs(delta) <= 24:
            break
        adjustment = math.floor(delta / 12) if delta > 0 else math.ceil(delta / 12)
        candidate = min(finalized_block, max(1, candidate + adjustment))
        block = _eth_get_block_for_chain(FLEX_CHAIN_ID, candidate)
    return block


def _missing_hours(
    conn: psycopg.Connection,
    markets: list[dict[str, object]],
    finalized_at: datetime,
    limit: int,
) -> list[datetime]:
    start = (finalized_at - timedelta(days=FLEX_BACKFILL_DAYS)).replace(minute=0, second=0, microsecond=0)
    current = finalized_at.replace(minute=0, second=0, microsecond=0)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT sampled_hour, market_address FROM flex_market_snapshots WHERE sampled_hour BETWEEN %s AND %s",
            (start, current),
        )
        existing = {(row[0], str(row[1])) for row in cur.fetchall()}
    missing: list[datetime] = []
    hour = start
    while hour <= current:
        eligible = [market for market in markets if market["deployment_time"] <= hour + timedelta(hours=1)]
        if eligible and any((hour, str(market["market_address"])) not in existing for market in eligible):
            missing.append(hour)
        hour += timedelta(seconds=FLEX_SNAPSHOT_INTERVAL_SEC)
    missing = [hour for hour in missing if hour != current]
    prioritized = [current, *missing]
    return prioritized[:limit] if limit > 0 else prioritized


def _sync_snapshots(
    conn: psycopg.Connection,
    markets: list[dict[str, object]],
    finalized_block: int,
    finalized_at: datetime,
    max_hours: int,
) -> int:
    hours = _missing_hours(conn, markets, finalized_at, max_hours)
    previous: dict[str, object] | None = None
    inserted = 0
    for hour in hours:
        block = _nearest_block(hour, previous, finalized_block)
        previous = block
        block_number = int(_hex_to_int(str(block.get("number") or "")) or 0)
        eligible = [market for market in markets if int(market["deployment_block"]) <= block_number]
        if not eligible:
            continue
        state = _batch_state(eligible, block_number)
        rows = [_snapshot_row(market, state[str(market["market_address"])], hour, block) for market in eligible]
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO flex_market_snapshots (
                    chain_id, market_address, sampled_hour, block_number, block_hash, block_time,
                    contract_version, collateral_raw, debt_raw, weighted_debt_raw, deposits_raw,
                    idle_liquidity_raw, collateral_price_in_borrow_wad, borrow_usd_price_raw,
                    borrow_usd_price_decimals, collateral_usd_e18, debt_usd_e18, deposits_usd_e18,
                    idle_liquidity_usd_e18, utilization_wad, lender_apr_wad,
                    avg_borrow_rate_raw, source
                ) VALUES (
                    %(chain_id)s, %(market_address)s, %(sampled_hour)s, %(block_number)s,
                    %(block_hash)s, %(block_time)s, %(contract_version)s, %(collateral_raw)s,
                    %(debt_raw)s, %(weighted_debt_raw)s, %(deposits_raw)s, %(idle_liquidity_raw)s,
                    %(collateral_price_in_borrow_wad)s, %(borrow_usd_price_raw)s,
                    %(borrow_usd_price_decimals)s, %(collateral_usd_e18)s, %(debt_usd_e18)s,
                    %(deposits_usd_e18)s, %(idle_liquidity_usd_e18)s, %(utilization_wad)s,
                    %(lender_apr_wad)s, %(avg_borrow_rate_raw)s, %(source)s
                )
                ON CONFLICT (chain_id, market_address, sampled_hour) DO UPDATE SET
                    block_number = EXCLUDED.block_number,
                    block_hash = EXCLUDED.block_hash,
                    block_time = EXCLUDED.block_time,
                    collateral_raw = EXCLUDED.collateral_raw,
                    debt_raw = EXCLUDED.debt_raw,
                    weighted_debt_raw = EXCLUDED.weighted_debt_raw,
                    deposits_raw = EXCLUDED.deposits_raw,
                    idle_liquidity_raw = EXCLUDED.idle_liquidity_raw,
                    collateral_price_in_borrow_wad = EXCLUDED.collateral_price_in_borrow_wad,
                    borrow_usd_price_raw = EXCLUDED.borrow_usd_price_raw,
                    collateral_usd_e18 = EXCLUDED.collateral_usd_e18,
                    debt_usd_e18 = EXCLUDED.debt_usd_e18,
                    deposits_usd_e18 = EXCLUDED.deposits_usd_e18,
                    idle_liquidity_usd_e18 = EXCLUDED.idle_liquidity_usd_e18,
                    utilization_wad = EXCLUDED.utilization_wad,
                    lender_apr_wad = EXCLUDED.lender_apr_wad,
                    avg_borrow_rate_raw = EXCLUDED.avg_borrow_rate_raw,
                    collected_at = NOW()
                """,
                rows,
            )
        conn.commit()
        inserted += len(rows)
        _set_sync_cursor(
            conn,
            "snapshots",
            block_number,
            datetime.fromtimestamp(int(str(block["timestamp"]), 16), UTC),
            {"sampled_hour": hour.isoformat(), "markets": len(rows)},
        )
    return inserted


def _reconcile(conn: psycopg.Connection, finalized_block: int) -> str:
    checked_at = datetime.now(UTC)
    results: list[dict[str, object]] = []
    verdict = "unavailable"
    api_block: int | None = None
    api_time: datetime | None = None
    try:
        payload = _api_payload(
            FLEX_API_MARKETS_URL,
            {"chain_id": FLEX_CHAIN_ID, "include_unendorsed": "true"},
        )
        api_block = int(payload.get("block_number") or 0) or None
        api_ts = int(payload.get("block_timestamp") or 0)
        api_time = datetime.fromtimestamp(api_ts, UTC) if api_ts else None
        api_rows = {
            str((row.get("addresses") or {}).get("trove_manager") or "").lower(): row
            for row in payload.get("rows", [])
            if isinstance(row, dict) and isinstance(row.get("addresses"), dict)
        }
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (market_address)
                    market_address, collateral_raw, debt_raw, deposits_raw, lender_apr_wad, block_number
                FROM flex_market_snapshots
                ORDER BY market_address, sampled_hour DESC
                """
            )
            snapshots = cur.fetchall()
        mismatch = False
        for market, collateral, debt, deposits, lender_apr, block_number in snapshots:
            api_row = api_rows.get(str(market))
            if api_row is None:
                results.append({"market_address": str(market), "status": "not_in_flex_api"})
                continue
            metrics = api_row.get("metrics") if isinstance(api_row.get("metrics"), dict) else {}
            comparisons: dict[str, object] = {}
            for name, rpc_value, api_key, tolerance in (
                ("collateral_raw", int(collateral), "total_collateral", 0.001),
                ("debt_raw", int(debt), "total_debt", 0.003),
                ("deposits_raw", int(deposits), "total_deposits", 0.001),
                ("lender_apr_wad", int(lender_apr), "expected_lend_apr", 0.01),
            ):
                api_value = int(str(metrics.get(api_key) or "0"))
                denominator = max(abs(api_value), 1)
                relative_error = abs(rpc_value - api_value) / denominator
                comparisons[name] = {
                    "rpc": str(rpc_value),
                    "api": str(api_value),
                    "relative_error": relative_error,
                    "within_tolerance": relative_error <= tolerance,
                }
                mismatch = mismatch or relative_error > tolerance
            results.append(
                {
                    "market_address": str(market),
                    "status": "mismatch" if any(not item["within_tolerance"] for item in comparisons.values()) else "ok",
                    "snapshot_block": int(block_number),
                    "comparisons": comparisons,
                }
            )
        verdict = "mismatch" if mismatch else "ok"
    except FLEX_SOFT_ERRORS as exc:
        results.append({"status": "unavailable", "error": str(exc)[:500]})
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO flex_reconciliations (
                checked_at, api_block_number, api_block_time, rpc_block_number,
                verdict, market_results, source_url
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (checked_at, api_block, api_time, finalized_block, verdict, Json(results), FLEX_API_MARKETS_URL),
        )
    conn.commit()
    return verdict


def _run_flex_sync(conn: psycopg.Connection, *, max_snapshot_hours: int | None = None) -> dict[str, object]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_FLEX_SYNC, started_at)
    try:
        finalized = _eth_finalized_block_for_chain(FLEX_CHAIN_ID)
        finalized_block = int(str(finalized["number"]), 16)
        finalized_ts = int(str(finalized["timestamp"]), 16)
        finalized_at = datetime.fromtimestamp(finalized_ts, UTC)
        markets = _discover_markets(conn, finalized_block)
        events = _sync_events(conn, markets, finalized_block, finalized_at)
        snapshots = _sync_snapshots(
            conn,
            markets,
            finalized_block,
            finalized_at,
            FLEX_MAX_SNAPSHOT_HOURS_PER_RUN if max_snapshot_hours is None else max_snapshot_hours,
        )
        redemption_priority = _sync_redemption_priorities(conn, markets)
        trove_health = _sync_trove_health(conn, markets)
        reconciliation = _reconcile(conn, finalized_block)
        records = (
            len(markets)
            + events
            + snapshots
            + redemption_priority["ready"]
            + trove_health["ready"]
        )
        result = {
            "markets": len(markets),
            "events": events,
            "snapshots": snapshots,
            "redemption_priority": redemption_priority,
            "trove_health": trove_health,
            "finalized_block": finalized_block,
            "finalized_at": finalized_at.isoformat(),
            "reconciliation": reconciliation,
        }
        _complete_run(conn, run_id, "success", records, json.dumps(result, sort_keys=True))
        return result
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)[:1000]}))
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-snapshot-hours", type=int, default=0)
    args = parser.parse_args()
    with _connect() as conn:
        _ensure_schema(conn)
        result = _run_flex_sync(conn, max_snapshot_hours=args.max_snapshot_hours)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
