from __future__ import annotations

from datetime import UTC, datetime

import psycopg
from fastapi import APIRouter
from psycopg.rows import dict_row

from app.config import (
    DATABASE_URL,
    DB_CLEANUP_MIN_INTERVAL_SEC,
    DEFAULT_MIN_POINTS,
    DEFAULT_MIN_TVL_USD,
    INGESTION_RUN_RETENTION_DAYS,
    KONG_GQL_URL,
    KONG_PPS_LOOKBACK_DAYS,
    KONG_REST_VAULTS_URL,
    PPS_RETENTION_DAYS,
    STYFI_EPOCH_LOOKBACK,
    STYFI_RETENTION_DAYS,
    STYFI_SNAPSHOT_RETENTION_DAYS,
    WORKER_INTERVAL_SEC,
)
from app.meta_service import (
    _coverage_snapshot,
    _deduped_yearn_scope_snapshot,
    _freshness_snapshot,
    _protocol_context_snapshot,
    _tracked_scope_snapshot,
)
from app.product_service import _dau_trailing_24h, _overview_note_response

router = APIRouter()


@router.get("/api/overview-note")
async def overview_note():
    return _overview_note_response()


@router.get("/api/overview")
async def overview() -> dict[str, object]:
    active_vaults = None
    total_vaults = None
    pps_points = None
    metrics_count = None
    freshness: dict[str, object] | None = None
    coverage: dict[str, object] | None = None
    protocol_context: dict[str, object] | None = None
    tracked_scope: dict[str, object] | None = None
    lifecycle: dict[str, object] | None = None
    last_runs: dict[str, dict[str, object] | None] = {
        "kong_vault_snapshot": None,
        "kong_pps_metrics": None,
        "styfi_snapshot": None,
        "product_dau": None,
    }
    dau_summary: dict[str, object] | None = None
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE active) AS active_vaults,
                        COUNT(*) AS total_vaults
                    FROM vault_dim
                    """
                )
                row = cur.fetchone()
                active_vaults, total_vaults = row["active_vaults"], row["total_vaults"]
                cur.execute("SELECT COUNT(*) FROM pps_timeseries")
                pps_points = cur.fetchone()["count"]
                cur.execute("SELECT COUNT(*) FROM vault_metrics_latest")
                metrics_count = cur.fetchone()["count"]
                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE active) AS active_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE((vault_dim.raw->'meta'->>'isRetired')::boolean, (vault_dim.raw->>'isRetired')::boolean, (vault_dim.raw->'info'->>'isRetired')::boolean, FALSE)) AS retired_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE((vault_dim.raw->'meta'->>'isHighlighted')::boolean, (vault_dim.raw->>'isHighlighted')::boolean, (vault_dim.raw->'info'->>'isHighlighted')::boolean, FALSE)) AS highlighted_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE((vault_dim.raw->'meta'->'migration'->>'available')::boolean, (vault_dim.raw->'migration'->>'available')::boolean, FALSE)) AS migration_ready_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(NULLIF(vault_dim.raw->'risk'->>'riskLevel', ''), NULLIF(vault_dim.raw->>'riskLevel', ''), NULLIF(vault_dim.raw->'info'->>'riskLevel', ''), 'unknown') = '-1') AS risk_unrated_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(NULLIF(vault_dim.raw->'risk'->>'riskLevel', ''), NULLIF(vault_dim.raw->>'riskLevel', ''), NULLIF(vault_dim.raw->'info'->>'riskLevel', ''), 'unknown') = '0') AS risk_0_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(NULLIF(vault_dim.raw->'risk'->>'riskLevel', ''), NULLIF(vault_dim.raw->>'riskLevel', ''), NULLIF(vault_dim.raw->'info'->>'riskLevel', ''), 'unknown') = '1') AS risk_1_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(NULLIF(vault_dim.raw->'risk'->>'riskLevel', ''), NULLIF(vault_dim.raw->>'riskLevel', ''), NULLIF(vault_dim.raw->'info'->>'riskLevel', ''), 'unknown') = '2') AS risk_2_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(NULLIF(vault_dim.raw->'risk'->>'riskLevel', ''), NULLIF(vault_dim.raw->>'riskLevel', ''), NULLIF(vault_dim.raw->'info'->>'riskLevel', ''), 'unknown') = '3') AS risk_3_vaults,
                        COUNT(*) FILTER (WHERE active AND COALESCE(NULLIF(vault_dim.raw->'risk'->>'riskLevel', ''), NULLIF(vault_dim.raw->>'riskLevel', ''), NULLIF(vault_dim.raw->'info'->>'riskLevel', ''), 'unknown') = '4') AS risk_4_vaults
                    FROM vault_dim
                    """
                )
                lifecycle = cur.fetchone()
                for job_name in last_runs:
                    cur.execute(
                        """
                        SELECT status, started_at, ended_at, records, error_summary
                        FROM ingestion_runs
                        WHERE job_name = %s
                        ORDER BY id DESC
                        LIMIT 1
                        """,
                        (job_name,),
                    )
                    row = cur.fetchone()
                    if row:
                        last_runs[job_name] = {
                            "status": row["status"],
                            "started_at": row["started_at"].isoformat() if row["started_at"] else None,
                            "ended_at": row["ended_at"].isoformat() if row["ended_at"] else None,
                            "records": row["records"],
                            "error_summary": row["error_summary"],
                        }
                tracked_scope = _tracked_scope_snapshot(cur)
                dau_summary = _dau_trailing_24h(cur)
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
                current_yearn = _deduped_yearn_scope_snapshot(
                    cur,
                    include_hidden=False,
                    include_retired=False,
                    include_fantom=False,
                )
                total_yearn = _deduped_yearn_scope_snapshot(
                    cur,
                    include_hidden=True,
                    include_retired=True,
                    include_fantom=True,
                )
            protocol_context = _protocol_context_snapshot(current_yearn=current_yearn, total_yearn=total_yearn)
    except Exception:
        pass

    return {
        "project": "yHelper",
        "status": "Phase 6 Hardening (Freshness Calibration In Progress)",
        "server_time_utc": datetime.now(UTC).isoformat(),
        "sources": {
            "kong_rest": KONG_REST_VAULTS_URL,
            "kong_gql": KONG_GQL_URL,
        },
        "data_policy": {
            "worker_interval_sec": WORKER_INTERVAL_SEC,
            "pps_retention_days": PPS_RETENTION_DAYS,
            "ingestion_run_retention_days": INGESTION_RUN_RETENTION_DAYS,
            "db_cleanup_min_interval_sec": DB_CLEANUP_MIN_INTERVAL_SEC,
            "kong_pps_lookback_days": KONG_PPS_LOOKBACK_DAYS,
            "styfi_retention_days": STYFI_RETENTION_DAYS,
            "styfi_snapshot_retention_days": STYFI_SNAPSHOT_RETENTION_DAYS,
            "styfi_epoch_lookback": STYFI_EPOCH_LOOKBACK,
        },
        "ingestion": {
            "active_vaults": active_vaults,
            "total_vaults": total_vaults,
            "pps_points": pps_points,
            "metrics_count": metrics_count,
            "last_runs": last_runs,
        },
        "freshness": freshness,
        "coverage": coverage,
        "protocol_context": protocol_context,
        "tracked_scope": tracked_scope,
        "dau": dau_summary,
        "active_accounts_24h": dau_summary,
        "lifecycle": lifecycle,
        "message": "Phase 6 hardening is in progress: freshness calibration, trust diagnostics, UX consistency, and data-quality safeguards are actively being refined.",
    }
