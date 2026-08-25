from __future__ import annotations

import logging
from datetime import UTC, datetime

import psycopg
import requests
from psycopg.types.json import Json

from .config import FLEX_API_URL, FLEX_CHAIN_ID

FLEX_API_MARKETS_URL = f"{FLEX_API_URL}/v1/ui/markets"
FLEX_API_PARAMS_URL = f"{FLEX_API_URL}/v1/ui/params"
FLEX_API_BORROW_URL = f"{FLEX_API_URL}/v1/ui/borrow"
FLEX_API_EXPLORER_URL = f"{FLEX_API_URL}/v1/ui/explorer"
FLEX_SOFT_ERRORS = (requests.RequestException, ValueError, RuntimeError, KeyError, TypeError)
LOGGER = logging.getLogger(__name__)
WAD = 10**18
FLEX_RATIO_SCALE = 10**6
NEAR_MAX_LTV_WAD = WAD // 100


def _api_payload(path: str, params: dict[str, object]) -> dict[str, object]:
    response = requests.get(path, params=params, timeout=20)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise TypeError(f"Flex API returned a non-object for {path}")
    return payload


def _live_api_metadata() -> dict[str, dict[str, object]]:
    try:
        markets = _api_payload(
            FLEX_API_MARKETS_URL,
            {"chain_id": FLEX_CHAIN_ID, "include_unendorsed": "true"},
        )
    except FLEX_SOFT_ERRORS as exc:
        LOGGER.warning("Flex market metadata unavailable: %s", exc)
        return {}
    rows = markets.get("rows")
    if not isinstance(rows, list):
        return {}
    return {
        str((row.get("addresses") or {}).get("trove_manager") or "").lower(): row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("addresses"), dict)
    }


def _raw_uint_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value or not value.isascii() or not value.isdigit():
        raise ValueError(f"Flex borrow response has invalid {field}")
    return value


def _validated_redemption_priority_payload(
    payload: dict[str, object],
    market_address: str,
) -> dict[str, object]:
    chain_id = payload.get("chain_id")
    if isinstance(chain_id, bool) or not isinstance(chain_id, int) or chain_id != FLEX_CHAIN_ID:
        raise ValueError("Flex borrow response has an unexpected chain_id")
    addresses = payload.get("addresses")
    if not isinstance(addresses, dict):
        raise ValueError("Flex borrow response is missing addresses")
    response_market = addresses.get("trove_manager")
    if not isinstance(response_market, str) or response_market.lower() != market_address.lower():
        raise ValueError("Flex borrow response has an unexpected trove_manager")
    block_number = payload.get("block_number")
    block_timestamp = payload.get("block_timestamp")
    if (
        isinstance(block_number, bool)
        or not isinstance(block_number, int)
        or block_number <= 0
        or isinstance(block_timestamp, bool)
        or not isinstance(block_timestamp, int)
        or block_timestamp <= 0
    ):
        raise ValueError("Flex borrow response has invalid block provenance")
    if block_timestamp > int(datetime.now(UTC).timestamp()) + 5 * 60:
        raise ValueError("Flex borrow response block timestamp is in the future")
    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        raise ValueError("Flex borrow response is missing metrics")
    total_debt_raw = _raw_uint_string(metrics.get("total_debt"), "total_debt")
    total_debt = int(total_debt_raw)
    raw_points = metrics.get("redeemable_before_you")
    if not isinstance(raw_points, list):
        raise ValueError("Flex borrow response is missing redeemable_before_you")
    points: list[dict[str, str]] = []
    previous_rate = -1
    previous_debt = -1
    for index, raw_point in enumerate(raw_points):
        if not isinstance(raw_point, dict):
            raise ValueError(f"Flex borrow response has invalid point {index}")
        rate_raw = _raw_uint_string(raw_point.get("rate"), f"point {index} rate")
        redeemable_before_raw = _raw_uint_string(
            raw_point.get("redeemable_before"),
            f"point {index} redeemable_before",
        )
        rate = int(rate_raw)
        redeemable_before = int(redeemable_before_raw)
        if rate <= previous_rate:
            raise ValueError("Flex borrow response rates are not strictly increasing")
        if redeemable_before < previous_debt:
            raise ValueError("Flex borrow response debt ahead is not monotonic")
        if redeemable_before > total_debt:
            raise ValueError("Flex borrow response debt ahead exceeds total debt")
        points.append({"rate": rate_raw, "redeemable_before": redeemable_before_raw})
        previous_rate = rate
        previous_debt = redeemable_before
    return {
        "source_block_number": block_number,
        "source_block_time": datetime.fromtimestamp(block_timestamp, UTC),
        "total_debt_raw": total_debt_raw,
        "points": points,
    }


def _store_redemption_priority_success(
    conn: psycopg.Connection,
    *,
    market_address: str,
    source_url: str,
    payload: dict[str, object],
    validated: dict[str, object],
    attempted_at: datetime,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO flex_redemption_priority_current (
                chain_id, market_address, source_block_number, source_block_time,
                total_debt_raw, points, raw_payload, source_url, fetched_at,
                attempted_at, last_error
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
            ON CONFLICT (chain_id, market_address) DO UPDATE SET
                source_block_number = EXCLUDED.source_block_number,
                source_block_time = EXCLUDED.source_block_time,
                total_debt_raw = EXCLUDED.total_debt_raw,
                points = EXCLUDED.points,
                raw_payload = EXCLUDED.raw_payload,
                source_url = EXCLUDED.source_url,
                fetched_at = EXCLUDED.fetched_at,
                attempted_at = EXCLUDED.attempted_at,
                last_error = NULL
            """,
            (
                FLEX_CHAIN_ID,
                market_address,
                validated["source_block_number"],
                validated["source_block_time"],
                validated["total_debt_raw"],
                Json(validated["points"]),
                Json(payload),
                source_url,
                attempted_at,
                attempted_at,
            ),
        )


def _record_redemption_priority_failure(
    conn: psycopg.Connection,
    *,
    market_address: str,
    source_url: str,
    attempted_at: datetime,
    error: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO flex_redemption_priority_current (
                chain_id, market_address, source_url, attempted_at, last_error
            ) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (chain_id, market_address) DO UPDATE SET
                source_url = EXCLUDED.source_url,
                attempted_at = EXCLUDED.attempted_at,
                last_error = EXCLUDED.last_error
            """,
            (FLEX_CHAIN_ID, market_address, source_url, attempted_at, error[:500]),
        )


def _sync_redemption_priorities(
    conn: psycopg.Connection,
    markets: list[dict[str, object]],
) -> dict[str, int]:
    ready = 0
    failed = 0
    for market in markets:
        market_address = str(market["market_address"]).lower()
        attempted_at = datetime.now(UTC)
        source_url = (
            f"{FLEX_API_BORROW_URL}?chain_id={FLEX_CHAIN_ID}"
            f"&trove_manager={market_address}"
        )
        try:
            payload = _api_payload(
                FLEX_API_BORROW_URL,
                {"chain_id": FLEX_CHAIN_ID, "trove_manager": market_address},
            )
            validated = _validated_redemption_priority_payload(payload, market_address)
            _store_redemption_priority_success(
                conn,
                market_address=market_address,
                source_url=source_url,
                payload=payload,
                validated=validated,
                attempted_at=attempted_at,
            )
            ready += 1
        except FLEX_SOFT_ERRORS as exc:
            _record_redemption_priority_failure(
                conn,
                market_address=market_address,
                source_url=source_url,
                attempted_at=attempted_at,
                error=str(exc),
            )
            failed += 1
            LOGGER.warning("Flex redemption priority unavailable for %s: %s", market_address, exc)
        conn.commit()
    return {"ready": ready, "failed": failed}


def _validated_trove_health_payload(
    payload: dict[str, object],
    markets: list[dict[str, object]],
) -> list[dict[str, object]]:
    chain_id = payload.get("chain_id")
    if isinstance(chain_id, bool) or not isinstance(chain_id, int) or chain_id != FLEX_CHAIN_ID:
        raise ValueError("Flex explorer response has an unexpected chain_id")
    block_number = payload.get("block_number")
    block_timestamp = payload.get("block_timestamp")
    if (
        isinstance(block_number, bool)
        or not isinstance(block_number, int)
        or block_number <= 0
        or isinstance(block_timestamp, bool)
        or not isinstance(block_timestamp, int)
        or block_timestamp <= 0
    ):
        raise ValueError("Flex explorer response has invalid block provenance")
    if block_timestamp > int(datetime.now(UTC).timestamp()) + 5 * 60:
        raise ValueError("Flex explorer response block timestamp is in the future")
    api_markets = payload.get("markets")
    rows = payload.get("rows")
    if not isinstance(api_markets, dict) or not isinstance(rows, list):
        raise ValueError("Flex explorer response is missing markets or rows")

    market_by_address = {str(market["market_address"]).lower(): market for market in markets}
    api_market_by_address = {
        str(key).rsplit(":", 1)[-1].lower(): value
        for key, value in api_markets.items()
        if isinstance(key, str) and isinstance(value, dict)
    }
    missing = sorted(set(market_by_address) - set(api_market_by_address))
    if missing:
        raise ValueError(f"Flex explorer response is missing active market {missing[0]}")

    positions: dict[str, list[dict[str, int]]] = {address: [] for address in market_by_address}
    seen_troves: set[tuple[str, str]] = set()
    for index, raw_row in enumerate(rows):
        if not isinstance(raw_row, dict):
            raise ValueError(f"Flex explorer response has invalid row {index}")
        market_id = raw_row.get("market_id")
        if not isinstance(market_id, str) or ":" not in market_id:
            raise ValueError(f"Flex explorer response has invalid market_id at row {index}")
        market_address = market_id.rsplit(":", 1)[-1].lower()
        if market_address not in market_by_address:
            continue
        status = raw_row.get("status")
        if isinstance(status, bool) or not isinstance(status, int):
            raise ValueError(f"Flex explorer response has invalid status at row {index}")
        if status != 1:
            continue
        trove_id = _raw_uint_string(raw_row.get("trove_id"), f"row {index} trove_id")
        identity = (market_address, trove_id)
        if identity in seen_troves:
            raise ValueError(f"Flex explorer response repeats trove at row {index}")
        seen_troves.add(identity)
        collateral = int(_raw_uint_string(raw_row.get("collateral"), f"row {index} collateral"))
        debt = int(_raw_uint_string(raw_row.get("debt"), f"row {index} debt"))
        _raw_uint_string(raw_row.get("annual_interest_rate"), f"row {index} annual_interest_rate")
        if collateral <= 0 or debt <= 0:
            raise ValueError(f"Flex explorer response has non-positive position at row {index}")

        market = market_by_address[market_address]
        api_market = api_market_by_address[market_address]
        collateral_decimals = int(market["collateral_token_decimals"])
        borrow_decimals = int(market["borrow_token_decimals"])
        price = int(
            _raw_uint_string(
                api_market.get("collateral_token_price_in_borrow_token"),
                f"market {market_address} collateral price",
            )
        )
        max_ltv = int(_raw_uint_string(api_market.get("max_ltv"), f"market {market_address} max_ltv"))
        if price <= 0 or max_ltv <= 0:
            raise ValueError(f"Flex explorer response has invalid market values for {market_address}")
        ltv_wad = (
            debt * 10**collateral_decimals * WAD * WAD
            // (collateral * price * 10**borrow_decimals)
        )
        max_ltv_wad = max_ltv * WAD // FLEX_RATIO_SCALE
        positions[market_address].append(
            {
                "collateral": collateral,
                "debt": debt,
                "ltv_wad": ltv_wad,
                "max_ltv_wad": max_ltv_wad,
            }
        )

    source_time = datetime.fromtimestamp(block_timestamp, UTC)
    aggregates: list[dict[str, object]] = []
    for market_address, market_positions in positions.items():
        total_collateral = sum(position["collateral"] for position in market_positions)
        total_debt = sum(position["debt"] for position in market_positions)
        ltv_values = sorted(position["ltv_wad"] for position in market_positions)
        if ltv_values:
            midpoint = len(ltv_values) // 2
            median_ltv = (
                ltv_values[midpoint]
                if len(ltv_values) % 2
                else (ltv_values[midpoint - 1] + ltv_values[midpoint]) // 2
            )
            maximum_position_ltv = ltv_values[-1]
            protocol_max_ltv = market_positions[0]["max_ltv_wad"]
            minimum_buffer = max(0, protocol_max_ltv - maximum_position_ltv)
            near_max = [
                position
                for position in market_positions
                if protocol_max_ltv - position["ltv_wad"] <= NEAR_MAX_LTV_WAD
            ]
            debt_near_max = sum(position["debt"] for position in near_max)
            largest_debt_share = max(position["debt"] for position in market_positions) * WAD // total_debt
        else:
            median_ltv = None
            maximum_position_ltv = None
            minimum_buffer = None
            near_max = []
            debt_near_max = 0
            largest_debt_share = None
        aggregates.append(
            {
                "market_address": market_address,
                "source_block_number": block_number,
                "source_block_time": source_time,
                "active_troves": len(market_positions),
                "total_collateral_raw": str(total_collateral),
                "total_debt_raw": str(total_debt),
                "median_ltv_wad": str(median_ltv) if median_ltv is not None else None,
                "maximum_position_ltv_wad": (
                    str(maximum_position_ltv) if maximum_position_ltv is not None else None
                ),
                "minimum_buffer_wad": str(minimum_buffer) if minimum_buffer is not None else None,
                "near_max_troves": len(near_max),
                "debt_near_max_raw": str(debt_near_max),
                "largest_debt_share_wad": (
                    str(largest_debt_share) if largest_debt_share is not None else None
                ),
            }
        )
    return aggregates


def _store_trove_health_success(
    conn: psycopg.Connection,
    *,
    aggregates: list[dict[str, object]],
    source_url: str,
    attempted_at: datetime,
) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO flex_trove_health_current (
                chain_id, market_address, source_block_number, source_block_time,
                active_troves, total_collateral_raw, total_debt_raw, median_ltv_wad,
                maximum_position_ltv_wad, minimum_buffer_wad, near_max_troves,
                debt_near_max_raw, largest_debt_share_wad, source_url, fetched_at,
                attempted_at, last_error
            ) VALUES (
                %(chain_id)s, %(market_address)s, %(source_block_number)s,
                %(source_block_time)s, %(active_troves)s, %(total_collateral_raw)s,
                %(total_debt_raw)s, %(median_ltv_wad)s, %(maximum_position_ltv_wad)s,
                %(minimum_buffer_wad)s, %(near_max_troves)s, %(debt_near_max_raw)s,
                %(largest_debt_share_wad)s, %(source_url)s, %(fetched_at)s,
                %(attempted_at)s, NULL
            )
            ON CONFLICT (chain_id, market_address) DO UPDATE SET
                source_block_number = EXCLUDED.source_block_number,
                source_block_time = EXCLUDED.source_block_time,
                active_troves = EXCLUDED.active_troves,
                total_collateral_raw = EXCLUDED.total_collateral_raw,
                total_debt_raw = EXCLUDED.total_debt_raw,
                median_ltv_wad = EXCLUDED.median_ltv_wad,
                maximum_position_ltv_wad = EXCLUDED.maximum_position_ltv_wad,
                minimum_buffer_wad = EXCLUDED.minimum_buffer_wad,
                near_max_troves = EXCLUDED.near_max_troves,
                debt_near_max_raw = EXCLUDED.debt_near_max_raw,
                largest_debt_share_wad = EXCLUDED.largest_debt_share_wad,
                source_url = EXCLUDED.source_url,
                fetched_at = EXCLUDED.fetched_at,
                attempted_at = EXCLUDED.attempted_at,
                last_error = NULL
            """,
            [
                {
                    **aggregate,
                    "chain_id": FLEX_CHAIN_ID,
                    "source_url": source_url,
                    "fetched_at": attempted_at,
                    "attempted_at": attempted_at,
                }
                for aggregate in aggregates
            ],
        )


def _record_trove_health_failure(
    conn: psycopg.Connection,
    *,
    markets: list[dict[str, object]],
    source_url: str,
    attempted_at: datetime,
    error: str,
) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO flex_trove_health_current (
                chain_id, market_address, source_url, attempted_at, last_error
            ) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (chain_id, market_address) DO UPDATE SET
                source_url = EXCLUDED.source_url,
                attempted_at = EXCLUDED.attempted_at,
                last_error = EXCLUDED.last_error
            """,
            [
                (
                    FLEX_CHAIN_ID,
                    str(market["market_address"]).lower(),
                    source_url,
                    attempted_at,
                    error[:500],
                )
                for market in markets
            ],
        )


def _sync_trove_health(
    conn: psycopg.Connection,
    markets: list[dict[str, object]],
) -> dict[str, int]:
    active_markets = [market for market in markets if market.get("market_status") == "active"]
    if not active_markets:
        return {"ready": 0, "failed": 0}
    attempted_at = datetime.now(UTC)
    source_url = f"{FLEX_API_EXPLORER_URL}?chain_id={FLEX_CHAIN_ID}"
    try:
        payload = _api_payload(FLEX_API_EXPLORER_URL, {"chain_id": FLEX_CHAIN_ID})
        aggregates = _validated_trove_health_payload(payload, active_markets)
        _store_trove_health_success(
            conn,
            aggregates=aggregates,
            source_url=source_url,
            attempted_at=attempted_at,
        )
        conn.commit()
        return {"ready": len(aggregates), "failed": 0}
    except FLEX_SOFT_ERRORS as exc:
        _record_trove_health_failure(
            conn,
            markets=active_markets,
            source_url=source_url,
            attempted_at=attempted_at,
            error=str(exc),
        )
        conn.commit()
        LOGGER.warning("Flex trove health unavailable: %s", exc)
        return {"ready": 0, "failed": len(active_markets)}
