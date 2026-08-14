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
FLEX_SOFT_ERRORS = (requests.RequestException, ValueError, RuntimeError, KeyError, TypeError)
LOGGER = logging.getLogger(__name__)


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
