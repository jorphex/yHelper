from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.accounting_service import _protocol_context_snapshot
from app.config import DATABASE_URL, DEFAULT_MIN_POINTS, DEFAULT_MIN_TVL_USD
from app.meta_service import (
    _coverage_snapshot,
    _freshness_snapshot,
)
from app.models import CoverageResponse, FreshnessResponse, HealthResponse, ProtocolContextResponse

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Process liveness",
    description="Confirms that the API process can answer requests. It does not verify database or data freshness.",
)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/meta/freshness", response_model=FreshnessResponse)
def meta_freshness(
    threshold: Literal["24h", "7d", "30d"] = "24h",
    split_limit: int = Query(default=8, ge=1, le=25),
    min_tvl_usd: float = Query(default=DEFAULT_MIN_TVL_USD, ge=0.0),
) -> dict[str, object]:
    threshold_seconds = {"24h": 24 * 3600, "7d": 7 * 24 * 3600, "30d": 30 * 24 * 3600}[threshold]
    with psycopg.connect(DATABASE_URL) as conn:
        snapshot = _freshness_snapshot(
            conn,
            stale_threshold_seconds=threshold_seconds,
            split_limit=split_limit,
            min_tvl_usd=min_tvl_usd,
        )
    snapshot["threshold"] = threshold
    return snapshot


@router.get("/api/meta/coverage", response_model=CoverageResponse)
def meta_coverage(
    min_tvl_usd: float = Query(default=DEFAULT_MIN_TVL_USD, ge=0.0),
    min_points: int = Query(default=DEFAULT_MIN_POINTS, ge=0),
    split_limit: int = Query(default=8, ge=1, le=25),
) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL) as conn:
        return _coverage_snapshot(conn, min_tvl_usd=min_tvl_usd, min_points=min_points, split_limit=split_limit)


@router.get(
    "/api/meta/protocol-context",
    response_model=ProtocolContextResponse,
    summary="Get protocol, catalog, and analytics TVL contexts",
    description=(
        "Protocol TVL is the DefiLlama Yearn parent value. Catalog and analytics values are gross, "
        "non-additive Kong product TVL and must not be substituted for protocol TVL."
    ),
)
def meta_protocol_context() -> dict[str, object]:
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                return _protocol_context_snapshot(cur)
    except Exception:
        return {
            "schema_version": 3,
            "source": "defillama_yearn_parent",
            "status": "unavailable",
            "as_of_utc": datetime.now(UTC).isoformat(),
        }
