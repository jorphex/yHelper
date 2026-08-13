from __future__ import annotations

import logging
import os
import time
from datetime import UTC, datetime

from .accounting import _run_protocol_tvl_ingestion
from .config import (
    HARVEST_WSS_ENABLED,
    KONG_REST_VAULTS_URL,
    STYFI_SYNC_ENABLED,
    YLOCKER_SYNC_ENABLED,
    _validate_data_policy_config,
    configure_logging,
)
from .db_state import _ensure_schema, _mark_boot_orphaned_runs, _mark_stale_running_runs
from .eth import _connect
from .harvests import HarvestWssManager, _run_vault_harvests, _select_harvest_contracts
from .kong import _maybe_cleanup_old_data, _run_kong_ingestion, _run_kong_snapshot_ingestion
from .notifications import _evaluate_alerts, _retry_failed_discord_notifications
from .product_activity import _backfill_styfi_activity_amounts, _run_product_activity
from .styfi import _run_styfi_snapshot
from .ylockers import _run_ylocker_rewards

HARVEST_WSS_MANAGER: HarvestWssManager | None = None


def run_once() -> None:
    global HARVEST_WSS_MANAGER
    logging.info("Tick at %s", datetime.now(UTC).isoformat())
    logging.info("Fetching Kong vault snapshot: %s", KONG_REST_VAULTS_URL)
    with _connect() as conn:
        _ensure_schema(conn)
        abandoned = _mark_stale_running_runs(conn)
        if abandoned > 0:
            logging.warning("Marked %s stale running ingestion rows as abandoned", abandoned)
        _, stored = _run_kong_snapshot_ingestion(conn)
        _run_protocol_tvl_ingestion(conn)
        if stored > 0:
            _run_kong_ingestion(conn)
        else:
            logging.warning("Skipping Kong PPS ingestion because Kong snapshot stored 0 records")
        if STYFI_SYNC_ENABLED:
            _run_styfi_snapshot(conn)
        else:
            logging.info("Skipping stYFI snapshot because STYFI_SYNC_ENABLED=0")
        _run_product_activity(conn)
        _backfill_styfi_activity_amounts(conn)
        if HARVEST_WSS_MANAGER is not None:
            HARVEST_WSS_MANAGER.refresh(_select_harvest_contracts(conn))
        _run_vault_harvests(conn)
        if YLOCKER_SYNC_ENABLED:
            _run_ylocker_rewards(conn)
        else:
            logging.info("Skipping yLocker reward sync because YLOCKER_SYNC_ENABLED=0")
        _retry_failed_discord_notifications(conn)
        _evaluate_alerts(conn)
        _maybe_cleanup_old_data(conn)


def main() -> None:
    global HARVEST_WSS_MANAGER
    configure_logging()
    _validate_data_policy_config()
    interval = int(os.getenv("WORKER_INTERVAL_SEC", "21600"))
    logging.info("Worker booted with interval=%ss", interval)
    with _connect() as conn:
        _ensure_schema(conn)
        orphaned = _mark_boot_orphaned_runs(conn)
        if orphaned > 0:
            logging.warning("Marked %s orphaned running ingestion rows as abandoned on boot", orphaned)
        if HARVEST_WSS_ENABLED:
            HARVEST_WSS_MANAGER = HarvestWssManager()
            HARVEST_WSS_MANAGER.refresh(_select_harvest_contracts(conn))
    while True:
        run_once()
        time.sleep(interval)


if __name__ == "__main__":
    main()
