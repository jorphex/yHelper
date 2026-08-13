from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.models import YlockerRewardCycleResponse, YlockerRewardsResponse
from app.ylockers_service import ylocker_reward_cycle_response, ylocker_rewards_response

router = APIRouter()


@router.get(
    "/api/ylockers/rewards",
    response_model=YlockerRewardsResponse,
    summary="Read yLocker reward history.",
    description=(
        "Returns yCRV and yYB reward history, Thu-to-Thu totals, and transaction details. "
        "Values show the crvUSD value at each deposit. Current locker weeks are shown separately."
    ),
)
def ylocker_rewards(
    product: Literal["all", "ycrv", "yyb"] = Query(default="all"),
    limit: int = Query(default=12, ge=1, le=52),
    include_events: bool = Query(default=True),
) -> dict[str, object]:
    return ylocker_rewards_response(product=product, limit=limit, include_events=include_events)


@router.get(
    "/api/ylockers/rewards/{product}/cycles/{native_week}",
    response_model=YlockerRewardCycleResponse,
    summary="Read one finalized yLocker reward cycle.",
    description="Returns one immutable native yCRV or yYB cycle for rendering and notifications.",
)
def ylocker_reward_cycle(
    product: Literal["ycrv", "yyb"],
    native_week: int,
) -> dict[str, object]:
    if native_week < 0:
        raise HTTPException(status_code=404, detail="Cycle not found")
    status, response = ylocker_reward_cycle_response(product=product, native_week=native_week)
    if status == "pending":
        raise HTTPException(status_code=409, detail="Cycle is not finalized")
    if status == "unavailable":
        raise HTTPException(status_code=503, detail="Cycle data is unavailable")
    if response is None:
        raise HTTPException(status_code=404, detail="Finalized cycle not found")
    return response
