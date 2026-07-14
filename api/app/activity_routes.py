from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.config import (
    DATABASE_URL,
    STYFI_CHAIN_ID,
    STYFI_EPOCH_LOOKBACK,
    STYFI_RETENTION_DAYS,
    STYFI_SNAPSHOT_RETENTION_DAYS,
)
from app.models import ReportsResponse
from app.product_service import (
    _recent_reports,
    _report_chain_facets,
    _report_trailing_24h,
)
from app.styfi_service import (
    _styfi_current_reward_state,
    _styfi_epoch_series,
    _styfi_last_run,
    _styfi_latest_component_split,
    _styfi_recent_activity,
    _styfi_reward_token,
    _styfi_snapshot_series,
    _styfi_summary_snapshot,
)

router = APIRouter()


def _reports_response(
    days: int,
    chain_id: int | None,
    vault_address: str | None,
    limit: int,
    meaningful_only: bool,
) -> dict[str, object]:
    normalized_vault = vault_address.lower() if vault_address else None
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            trailing_24h = _report_trailing_24h(
                cur, chain_id=chain_id, vault_address=normalized_vault, meaningful_only=meaningful_only
            )
            available_chains = _report_chain_facets(
                cur, days=days, meaningful_only=meaningful_only
            )
            recent = _recent_reports(
                cur,
                days=days,
                chain_id=chain_id,
                vault_address=normalized_vault,
                limit=limit,
                meaningful_only=meaningful_only,
            )
    chain_facets = [
        {"chain_id": row["chain_id"], "chain_label": row.get("chain_label")}
        for row in available_chains
    ]
    return {
        "event": {"name": "StrategyReported", "level": "vault"},
        "trailing_24h": trailing_24h,
        "available_chains": chain_facets,
        "recent": recent,
    }


@router.get("/api/reports", response_model=ReportsResponse)
def reports(
    days: int = Query(default=30, ge=7, le=365),
    chain_id: int | None = Query(default=None, ge=1),
    vault_address: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    meaningful_only: bool = Query(default=False),
) -> dict[str, object]:
    return _reports_response(days, chain_id, vault_address, limit, meaningful_only)


@router.get("/api/styfi")
def styfi(
    days: int = Query(default=30, ge=7, le=STYFI_RETENTION_DAYS if STYFI_RETENTION_DAYS > 0 else 365),
    epoch_limit: int = Query(default=STYFI_EPOCH_LOOKBACK, ge=3, le=max(STYFI_EPOCH_LOOKBACK, 24)),
) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            reward_token = _styfi_reward_token(cur)
            reward_scale = float(10 ** int(reward_token.get("decimals") or 0))
            current_reward_state = _styfi_current_reward_state(cur)
            summary = _styfi_summary_snapshot(cur)
            series = _styfi_snapshot_series(cur, days=days)
            epochs = _styfi_epoch_series(cur, epoch_limit=epoch_limit, reward_scale=reward_scale)
            component_split = _styfi_latest_component_split(
                cur,
                current_epoch=summary.get("reward_epoch"),
                reward_scale=reward_scale,
            )
            last_run = _styfi_last_run(cur)
            recent_activity = _styfi_recent_activity(cur)

    latest_snapshot_at = summary.get("latest_snapshot_at")
    latest_snapshot_dt = datetime.fromisoformat(latest_snapshot_at) if isinstance(latest_snapshot_at, str) else None
    latest_snapshot_age_seconds = None
    if latest_snapshot_dt is not None:
        if latest_snapshot_dt.tzinfo is None:
            latest_snapshot_dt = latest_snapshot_dt.replace(tzinfo=UTC)
        latest_snapshot_age_seconds = max(0, int((datetime.now(UTC) - latest_snapshot_dt).total_seconds()))
    return {
        "filters": {
            "days": days,
            "epoch_limit": epoch_limit,
            "chain_id": STYFI_CHAIN_ID,
        },
        "summary": summary,
        "reward_token": reward_token,
        "current_reward_state": current_reward_state,
        "series": {
            "snapshots": series,
            "epochs": epochs,
        },
        "component_split_latest_completed": component_split,
        "recent_activity": recent_activity,
        "freshness": {
            "latest_snapshot_at": latest_snapshot_at,
            "latest_snapshot_age_seconds": latest_snapshot_age_seconds,
            "snapshots_count": summary.get("snapshots_count"),
            "first_snapshot_at": summary.get("first_snapshot_at"),
        },
        "data_policy": {
            "retention_days": STYFI_RETENTION_DAYS,
            "snapshot_retention_days": STYFI_SNAPSHOT_RETENTION_DAYS,
            "epoch_lookback": STYFI_EPOCH_LOOKBACK,
        },
        "ingestion": {
            "last_run": last_run,
        },
    }
