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
    _social_preview_highest_vault,
    _tracked_scope_snapshot,
)

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/meta/freshness")
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


@router.get("/api/meta/coverage")
def meta_coverage(
    min_tvl_usd: float = Query(default=DEFAULT_MIN_TVL_USD, ge=0.0),
    min_points: int = Query(default=DEFAULT_MIN_POINTS, ge=0),
    split_limit: int = Query(default=8, ge=1, le=25),
) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL) as conn:
        return _coverage_snapshot(conn, min_tvl_usd=min_tvl_usd, min_points=min_points, split_limit=split_limit)


@router.get("/api/meta/protocol-context")
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


@router.get("/api/meta/social-preview")
def meta_social_preview() -> dict[str, object]:
    tracked_scope: dict[str, object] = {}
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            tracked_scope = _tracked_scope_snapshot(cur)
            highest_est_row = _social_preview_highest_vault(cur)
    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "summary": {
            "active_vaults": tracked_scope.get("active_vaults"),
            "tracked_tvl_active_usd": tracked_scope.get("tracked_tvl_active_usd"),
        },
        "highest_est_apy_vault": highest_est_row or None,
    }
