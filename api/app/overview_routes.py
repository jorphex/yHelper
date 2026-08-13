from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi import APIRouter
from psycopg.rows import dict_row

from app.accounting_service import _protocol_context_snapshot
from app.config import DATABASE_URL, DEFAULT_MIN_POINTS, DEFAULT_MIN_TVL_USD, WORKER_INTERVAL_SEC
from app.meta_service import _coverage_snapshot, _freshness_snapshot, _tracked_scope_snapshot
from app.product_service import _overview_pulse_response
from app.models import OperationalStatusResponse, OverviewPulseResponse

router = APIRouter()


@router.get("/api/overview-pulse", response_model=OverviewPulseResponse)
def overview_pulse() -> dict[str, object]:
    return _overview_pulse_response()


def _operational_status() -> dict[str, object]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        freshness = _freshness_snapshot(
            conn,
            stale_threshold_seconds=24 * 3600,
            split_limit=8,
            min_tvl_usd=DEFAULT_MIN_TVL_USD,
        )
        coverage = _coverage_snapshot(
            conn,
            min_tvl_usd=DEFAULT_MIN_TVL_USD,
            min_points=DEFAULT_MIN_POINTS,
            split_limit=6,
        )
        with conn.cursor() as cur:
            protocol_context = _protocol_context_snapshot(cur)
            tracked_scope = _tracked_scope_snapshot(cur)
    return {
        "status": "ok",
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "data_policy": {"worker_interval_sec": WORKER_INTERVAL_SEC},
        "protocol_context": protocol_context,
        "tracked_scope": tracked_scope,
        "freshness": freshness,
        "coverage": coverage,
    }


@router.get("/api/meta/status", response_model=OperationalStatusResponse)
def operational_status() -> dict[str, object]:
    return _operational_status()
