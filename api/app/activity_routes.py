from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi import APIRouter, Query
from psycopg.rows import dict_row

from app.common import _chain_label
from app.config import (
    DATABASE_URL,
    STYFI_CHAIN_ID,
    STYFI_EPOCH_LOOKBACK,
    STYFI_RETENTION_DAYS,
    STYFI_SNAPSHOT_RETENTION_DAYS,
)
from app.product_service import (
    _dau_daily_series,
    _dau_last_run,
    _dau_trailing_24h,
    _harvest_chain_rollups,
    _harvest_daily_by_chain,
    _harvest_last_run,
    _harvest_recent,
    _harvest_trailing_24h,
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


@router.get("/api/dau")
async def dau(days: int = Query(default=30, ge=7, le=180)) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            trailing_24h = _dau_trailing_24h(cur)
            daily = _dau_daily_series(cur, days=days)
            last_run = _dau_last_run(cur)
    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "metric": {
            "name": "active_accounts",
            "headline_label": "Active Accounts (24h)",
            "history_label": "Daily Active Accounts",
            "history_window_label": f"Last {days}d",
            "series_label": "Daily Active Accounts",
        },
        "window": {
            "headline": "24h",
            "history_days": days,
            "history_granularity": "day_utc",
        },
        "scope": {
            "vaults": "supported-chain V3 vault Deposit/Withdraw events",
            "styfi": "stYFI/stYFIx Deposit/Withdraw, burn Transfer unstake, plus tx-deduped mapped staking Claim events",
            "attribution": "indexed account fields from product event logs",
        },
        "trailing_24h": trailing_24h,
        "daily": daily,
        "last_run": last_run,
    }


@router.get("/api/harvests")
async def harvests(
    days: int = Query(default=30, ge=7, le=365),
    chain_id: int | None = Query(default=None, ge=1),
    vault_address: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, object]:
    normalized_vault = vault_address.lower() if vault_address else None
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            trailing_24h = _harvest_trailing_24h(cur, chain_id=chain_id, vault_address=normalized_vault)
            chain_rollups = _harvest_chain_rollups(cur, days=days, chain_id=chain_id, vault_address=normalized_vault)
            daily_by_chain = _harvest_daily_by_chain(cur, days=days, chain_id=chain_id, vault_address=normalized_vault)
            recent = _harvest_recent(
                cur,
                days=days,
                chain_id=chain_id,
                vault_address=normalized_vault,
                limit=limit,
            )
            last_run = _harvest_last_run(cur)
    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "metric": {
            "name": "vault_harvests",
            "headline_label": "Vault Harvests (24h)",
            "history_label": "Daily Vault Harvests",
            "history_window_label": f"Last {days}d",
            "series_label": "Daily Vault Harvests",
        },
        "window": {
            "headline": "24h",
            "history_days": days,
            "history_granularity": "day_utc",
        },
        "scope": {
            "vaults": "supported-chain legacy/V3 vault StrategyReported events",
            "level": "vault",
            "attribution": "vault report logs only; strategy-level Reported events are excluded",
        },
        "filters": {
            "chain_id": chain_id,
            "chain_label": _chain_label(chain_id),
            "vault_address": normalized_vault,
            "limit": limit,
        },
        "trailing_24h": trailing_24h,
        "chain_rollups": chain_rollups,
        "daily_by_chain": daily_by_chain,
        "recent": recent,
        "last_run": last_run,
    }


@router.get("/api/styfi")
async def styfi(
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
