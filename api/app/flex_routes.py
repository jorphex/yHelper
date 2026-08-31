from __future__ import annotations

import re
from enum import IntEnum
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.flex_service import (
    flex_activity_response,
    flex_market_detail_response,
    flex_market_history_response,
    flex_markets_response,
    flex_protocol_response,
    flex_redemption_priority_response,
    flex_trove_health_response,
)
from app.models import (
    FlexActivityResponse,
    FlexMarketDetailResponse,
    FlexMarketHistoryResponse,
    FlexMarketsResponse,
    FlexProtocolResponse,
    FlexRedemptionPriorityResponse,
    FlexTroveHealthResponse,
)

router = APIRouter()
ADDRESS_PATTERN = re.compile(r"^0x[0-9a-fA-F]{40}$")


class HistoryDays(IntEnum):
    seven = 7
    thirty = 30
    ninety = 90


def _address(value: str) -> str:
    normalized = value.strip().lower()
    if not ADDRESS_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="Invalid Ethereum address")
    return normalized


@router.get(
    "/api/flex/protocol",
    response_model=FlexProtocolResponse,
    summary="Get Flex protocol overview",
    description=(
        "Returns Ethereum-wide Flex market counts and current aggregates. USD values are estimates; "
        "utilization and rate fields are decimal ratios. Freshness includes indexing and reconciliation state."
    ),
)
def flex_protocol() -> dict[str, object]:
    return flex_protocol_response()


@router.get(
    "/api/flex/markets",
    response_model=FlexMarketsResponse,
    summary="List Flex markets",
    description=(
        "Returns deployed Ethereum Flex markets with current metrics. Filter by status: all, active, "
        "deprecated, or unendorsed. USD values are estimates; utilization and rates are decimal ratios."
    ),
)
def flex_markets(
    status: Literal["all", "active", "deprecated", "unendorsed"] = "all",
) -> dict[str, object]:
    return flex_markets_response(status=status)


@router.get(
    "/api/flex/markets/{market_address}",
    response_model=FlexMarketDetailResponse,
    summary="Get Flex market detail",
    description=(
        "Returns the current Ethereum market state, lending metrics, risk parameters, and oracle values. "
        "USD values are estimates; rates and LTV values are decimal ratios."
    ),
)
def flex_market_detail(market_address: str) -> dict[str, object]:
    response = flex_market_detail_response(_address(market_address))
    if response is None:
        raise HTTPException(status_code=404, detail="Flex market not found")
    return response


@router.get(
    "/api/flex/markets/{market_address}/redemption-priority",
    response_model=FlexRedemptionPriorityResponse,
    summary="Get current Flex redemption priority",
    description=(
        "Returns the official current discrete rate curve for one Flex market. Each point reports accrued "
        "borrow-token debt at strictly lower chosen annual rates, together with idle liquidity from the same "
        "source block. Freshness is independent from archive history."
    ),
)
def flex_redemption_priority(market_address: str) -> dict[str, object]:
    response = flex_redemption_priority_response(_address(market_address))
    if response is None:
        raise HTTPException(status_code=404, detail="Flex market not found")
    return response


@router.get(
    "/api/flex/markets/{market_address}/trove-health",
    response_model=FlexTroveHealthResponse,
    summary="Get current aggregate Flex trove health",
    description=(
        "Returns privacy-preserving aggregate position metrics for one current Flex market. "
        "LTV and debt-share fields are decimal ratios; near-maximum debt is within one "
        "percentage point of the market maximum. No owner or trove identifiers are returned."
    ),
)
def flex_trove_health(market_address: str) -> dict[str, object]:
    response = flex_trove_health_response(_address(market_address))
    if response is None:
        raise HTTPException(status_code=404, detail="Flex market not found")
    return response


@router.get(
    "/api/flex/markets/{market_address}/history",
    response_model=FlexMarketHistoryResponse,
    summary="Get Flex market history",
    description=(
        "Returns 7, 30, or 90 days of sampled market metrics. Use hourly or daily intervals. Coverage "
        "reports the available span and point count; freshness reports the latest indexed state."
    ),
)
def flex_market_history(
    market_address: str,
    days: HistoryDays = HistoryDays.ninety,
    interval: Literal["hour", "day"] = "day",
) -> dict[str, object]:
    response = flex_market_history_response(
        _address(market_address),
        days=int(days),
        interval=interval,
    )
    if response is None:
        raise HTTPException(status_code=404, detail="Flex market not found")
    return response


@router.get(
    "/api/flex/activity",
    response_model=FlexActivityResponse,
    summary="List Flex activity",
    description=(
        "Returns recent Ethereum Flex events. Filter by market address or event name. Results are ordered "
        "newest first and paginated with a block-number and log-index cursor; limit is 1 to 200."
    ),
)
def flex_activity(
    market_address: str | None = Query(default=None),
    event: str | None = Query(default=None, min_length=1, max_length=64),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, pattern=r"^\d+:\d+$"),
) -> dict[str, object]:
    return flex_activity_response(
        market_address=_address(market_address) if market_address else None,
        event=event,
        limit=limit,
        cursor=cursor,
    )
