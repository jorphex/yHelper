from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from app.models import YlockerRewardsResponse
from app.ylockers_service import ylocker_rewards_response

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
