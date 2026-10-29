from __future__ import annotations

import logging
import os
import threading
import time
from datetime import UTC, datetime

from .accounting import _run_protocol_tvl_ingestion
from .config import (
    DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC,
    FLEX_SYNC_ENABLED,
    HARVEST_WSS_ENABLED,
    KONG_REST_VAULTS_URL,
    STYFI_SYNC_ENABLED,
    YLOCKER_SYNC_ENABLED,
    _validate_data_policy_config,
    configure_logging,
)
from .db_state import _ensure_schema, _mark_boot_orphaned_runs, _mark_stale_running_runs
from .eth import _connect
from .flex import _run_flex_sync
from .harvests import HarvestWssManager, _run_vault_harvests, _select_harvest_contracts
from .kong import (
    _maybe_cleanup_old_data,
    _run_kong_ingestion,
    _run_kong_snapshot_ingestion,
)
from .notifications import _evaluate_alerts, _retry_failed_discord_notifications
from .product_activity import _backfill_styfi_activity_amounts, _run_product_activity
from .styfi import _run_styfi_snapshot
from .ylockers import _run_ylocker_rewards

HARVEST_WSS_MANAGER: HarvestWssManager | None = None
LOGGER = logging.getLogger(__name__)


def _run_job(conn, name, function):
    try:
        return function(conn)
    except Exception:
        conn.rollback()
        LOGGER.exception("%s failed; continuing worker cycle", name)
        return None


def run_once() -> None:
    LOGGER.info("Tick at %s", datetime.now(UTC).isoformat())
    LOGGER.info("Fetching Kong vault snapshot: %s", KONG_REST_VAULTS_URL)
    with _connect() as conn:
        abandoned = _mark_stale_running_runs(conn)
        if abandoned > 0:
            LOGGER.warning(
                "Marked %s stale running ingestion rows as abandoned", abandoned
            )
        snapshot = _run_job(conn, "Kong snapshot", _run_kong_snapshot_ingestion)
        stored = snapshot[1] if snapshot else 0
        _run_job(
            conn,
            "Protocol TVL",
            lambda connection: _run_protocol_tvl_ingestion(connection, if_due=True),
        )
        if stored > 0:
            _run_job(conn, "Kong PPS", _run_kong_ingestion)
        else:
            LOGGER.warning(
                "Skipping Kong PPS ingestion because Kong snapshot stored 0 records"
            )
        if STYFI_SYNC_ENABLED:
            _run_job(conn, "stYFI snapshot", _run_styfi_snapshot)
        else:
            LOGGER.info("Skipping stYFI snapshot because STYFI_SYNC_ENABLED=0")
        _run_job(conn, "Product activity", _run_product_activity)
        _run_job(conn, "stYFI activity backfill", _backfill_styfi_activity_amounts)
        targets = _run_job(conn, "Harvest targets", _select_harvest_contracts)
        if targets is not None and HARVEST_WSS_MANAGER is not None:
            _run_job(
                conn,
                "Harvest subscriptions",
                lambda connection: HARVEST_WSS_MANAGER.refresh(targets),
            )
        _run_job(
            conn,
            "Vault harvests",
            lambda connection: _run_vault_harvests(connection, targets=targets),
        )
        if YLOCKER_SYNC_ENABLED:
            _run_job(conn, "yLocker rewards", _run_ylocker_rewards)
        else:
            LOGGER.info("Skipping yLocker reward sync because YLOCKER_SYNC_ENABLED=0")
        if FLEX_SYNC_ENABLED:
            _run_job(conn, "Flex sync", _run_flex_sync)
        else:
            LOGGER.info("Skipping Flex market sync because FLEX_SYNC_ENABLED=0")
        _run_job(conn, "Cleanup", _maybe_cleanup_old_data)


def _maintenance(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            with _connect() as conn:
                _run_job(
                    conn, "Notification retries", _retry_failed_discord_notifications
                )
                _run_job(conn, "Alerts", _evaluate_alerts)
        except Exception:
            LOGGER.exception("Worker maintenance failed; retrying")
        stop.wait(min(60, DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC))


def main() -> None:
    global HARVEST_WSS_MANAGER
    configure_logging()
    _validate_data_policy_config()
    interval = int(os.getenv("WORKER_INTERVAL_SEC", "900"))
    if interval <= 0:
        raise ValueError("WORKER_INTERVAL_SEC must be positive")
    LOGGER.info("Worker booted with interval=%ss", interval)
    with _connect() as conn:
        _ensure_schema(conn)
        orphaned = _mark_boot_orphaned_runs(conn)
        if orphaned > 0:
            LOGGER.warning(
                "Marked %s orphaned running ingestion rows as abandoned on boot",
                orphaned,
            )
        if HARVEST_WSS_ENABLED:
            HARVEST_WSS_MANAGER = HarvestWssManager()
            HARVEST_WSS_MANAGER.refresh(_select_harvest_contracts(conn))
    stop = threading.Event()
    maintenance = threading.Thread(
        target=_maintenance, args=(stop,), name="worker-maintenance", daemon=True
    )
    maintenance.start()
    try:
        while True:
            next_tick = time.monotonic() + interval
            try:
                run_once()
            except Exception:
                LOGGER.exception("Worker cycle failed; retrying on the next tick")
            # Skip missed starts instead of overlapping or spinning after an overrun.
            delay = next_tick - time.monotonic()
            time.sleep(delay if delay > 0 else interval)
    finally:
        stop.set()
        maintenance.join(timeout=5)


if __name__ == "__main__":
    main()
