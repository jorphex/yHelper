from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import psycopg
import requests
from psycopg.types.json import Json

from .config import (
    ETH_CALL_TIMEOUT_SEC,
    JOB_STYFI,
    STYFI_CHAIN_ID,
    STYFI_CONTRACTS,
    STYFI_EPOCH_LENGTH_SEC,
    STYFI_EPOCH_LOOKBACK,
    STYFI_SITE_GLOBAL_DATA_URL,
    STYFI_STREAM_STATE,
)
from .db_state import _complete_run, _insert_run
from .eth import _eth_call_address, _eth_call_string, _eth_call_uint


def _safe_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _sum_raw_values(items: object, key: str) -> int:
    if not isinstance(items, list):
        return 0
    total = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        parsed = _safe_int(item.get(key))
        if parsed is not None:
            total += parsed
    return total


def _styfi_epoch_start(genesis: int, epoch: int) -> datetime:
    return datetime.fromtimestamp(genesis + epoch * STYFI_EPOCH_LENGTH_SEC, tz=UTC)


def _styfi_component_reward(epoch: int, component_address: str) -> int:
    return _eth_call_uint(
        STYFI_CONTRACTS["reward_distributor"],
        "rewards(address,uint256)",
        ("address", component_address),
        ("uint256", epoch),
    )


def _fetch_styfi_site_reward_state() -> dict[str, object] | None:
    if not STYFI_SITE_GLOBAL_DATA_URL:
        return None
    response = requests.get(
        STYFI_SITE_GLOBAL_DATA_URL,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        timeout=ETH_CALL_TIMEOUT_SEC,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected stYFI global-data payload: {payload!r}")
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    global_rewards = payload.get("global", {}).get("rewards") if isinstance(payload.get("global"), dict) else {}
    styfi = payload.get("styfi") if isinstance(payload.get("styfi"), dict) else {}
    styfix = payload.get("styfix") if isinstance(payload.get("styfix"), dict) else {}
    global_state = payload.get("global") if isinstance(payload.get("global"), dict) else {}
    veyfi = global_state.get("veyfi") if isinstance(global_state.get("veyfi"), dict) else {}
    llyfi = payload.get("llyfi") if isinstance(payload.get("llyfi"), list) else []
    styfi_current = styfi.get("current") if isinstance(styfi.get("current"), dict) else {}
    styfi_projected = styfi.get("projected") if isinstance(styfi.get("projected"), dict) else {}
    styfix_current = styfix.get("current") if isinstance(styfix.get("current"), dict) else {}
    styfix_projected = styfix.get("projected") if isinstance(styfix.get("projected"), dict) else {}
    return {
        "source": STYFI_SITE_GLOBAL_DATA_URL,
        "meta": {
            "timestamp": _safe_int(meta.get("timestamp")),
            "epoch": _safe_int(meta.get("epoch")),
            "block_number": _safe_int(meta.get("blockNumber")),
        },
        "global_rewards": {
            "current_raw": _safe_int(global_rewards.get("current")),
            "projected_raw": _safe_int(global_rewards.get("projected")),
            "pps_raw": _safe_int(global_rewards.get("pps")),
            "apy_bps": _safe_int(global_rewards.get("apyBps")),
        },
        "styfi": {
            "staked_raw": _safe_int(styfi.get("staked")),
            "unstaking_raw": _safe_int(styfi.get("unstaking")),
            "current_rewards_raw": _safe_int(styfi_current.get("rewards")),
            "current_apr_bps": _safe_int(styfi_current.get("aprBps")),
            "projected_rewards_raw": _safe_int(styfi_projected.get("rewards")),
            "projected_apr_bps": _safe_int(styfi_projected.get("aprBps")),
        },
        "styfix": {
            "staked_raw": _safe_int(styfix.get("staked")),
            "unstaking_raw": _safe_int(styfix.get("unstaking")),
            "current_rewards_raw": _safe_int(styfix_current.get("rewards")),
            "current_apr_bps": _safe_int(styfix_current.get("aprBps")),
            "projected_rewards_raw": _safe_int(styfix_projected.get("rewards")),
            "projected_apr_bps": _safe_int(styfix_projected.get("aprBps")),
        },
        "migrations": {
            "migrated_yfi_raw": _safe_int(veyfi.get("migratedYfi")),
        },
        "liquid_lockers": {
            "staked_raw": _sum_raw_values(llyfi, "staked"),
            "symbols": [
                str(item.get("symbol"))
                for item in llyfi
                if isinstance(item, dict) and isinstance(item.get("symbol"), str) and item.get("symbol")
            ],
        },
    }


def _fetch_styfi_snapshot_data() -> tuple[dict[str, object], list[dict[str, object]], dict[str, object]]:
    observed_at = datetime.now(UTC)
    reward_token_address = _eth_call_address(STYFI_CONTRACTS["reward_distributor"], "token()")
    reward_token_decimals = _eth_call_uint(reward_token_address, "decimals()")
    reward_token_symbol = _eth_call_string(reward_token_address, "symbol()")
    current_epoch = _eth_call_uint(STYFI_CONTRACTS["reward_distributor"], "epoch()")
    genesis = _eth_call_uint(STYFI_CONTRACTS["reward_distributor"], "genesis()")
    yfi_total_supply = _eth_call_uint(STYFI_CONTRACTS["yfi"], "totalSupply()")
    styfi_total_assets = _eth_call_uint(STYFI_CONTRACTS["styfi"], "totalAssets()")
    styfi_total_supply = _eth_call_uint(STYFI_CONTRACTS["styfi"], "totalSupply()")
    styfix_total_assets = _eth_call_uint(STYFI_CONTRACTS["styfix"], "totalAssets()")
    styfix_total_supply = _eth_call_uint(STYFI_CONTRACTS["styfix"], "totalSupply()")
    reward_state = _fetch_styfi_site_reward_state()
    liquid_lockers_state = reward_state.get("liquid_lockers") if isinstance(reward_state, dict) else {}
    migrations_state = reward_state.get("migrations") if isinstance(reward_state, dict) else {}
    liquid_lockers_staked = _safe_int(
        liquid_lockers_state.get("staked_raw") if isinstance(liquid_lockers_state, dict) else None
    ) or 0
    migrated_yfi = _safe_int(
        migrations_state.get("migrated_yfi_raw") if isinstance(migrations_state, dict) else None
    ) or 0
    combined_staked = styfi_total_assets + styfix_total_assets + liquid_lockers_staked + migrated_yfi

    snapshot = {
        "chain_id": STYFI_CHAIN_ID,
        "observed_at": observed_at,
        "reward_epoch": current_epoch,
        "yfi_total_supply_raw": yfi_total_supply,
        "styfi_total_assets_raw": styfi_total_assets,
        "styfi_total_supply_raw": styfi_total_supply,
        "styfix_total_assets_raw": styfix_total_assets,
        "styfix_total_supply_raw": styfix_total_supply,
        "liquid_lockers_staked_raw": liquid_lockers_staked,
        "migrated_yfi_raw": migrated_yfi,
        "combined_staked_raw": combined_staked,
    }

    start_epoch = max(0, current_epoch - STYFI_EPOCH_LOOKBACK + 1)
    epochs: list[dict[str, object]] = []
    for epoch in range(start_epoch, current_epoch + 1):
        reward_total = _eth_call_uint(STYFI_CONTRACTS["reward_distributor"], "epoch_rewards(uint256)", ("uint256", epoch))
        epochs.append(
            {
                "chain_id": STYFI_CHAIN_ID,
                "epoch": epoch,
                "epoch_start": _styfi_epoch_start(genesis, epoch),
                "reward_total_raw": reward_total,
                "reward_styfi_raw": _styfi_component_reward(epoch, STYFI_CONTRACTS["styfi_reward_distributor"]),
                "reward_styfix_raw": _styfi_component_reward(epoch, STYFI_CONTRACTS["styfix_reward_distributor"]),
                "reward_veyfi_raw": _styfi_component_reward(epoch, STYFI_CONTRACTS["veyfi_reward_distributor"]),
                "reward_liquid_lockers_raw": _styfi_component_reward(
                    epoch, STYFI_CONTRACTS["liquid_locker_reward_distributor"]
                ),
            }
        )

    sync_state = {
        "stream_name": STYFI_STREAM_STATE,
        "chain_id": STYFI_CHAIN_ID,
        "cursor": current_epoch,
        "observed_at": observed_at,
        "payload": {
            "genesis": genesis,
            "epoch_lookback": STYFI_EPOCH_LOOKBACK,
            "contracts": STYFI_CONTRACTS,
            "reward_token": {
                "address": reward_token_address,
                "decimals": reward_token_decimals,
                "symbol": reward_token_symbol,
            },
            "current_reward_state": reward_state,
        },
    }
    return snapshot, epochs, sync_state


def _upsert_styfi_snapshot(conn: psycopg.Connection, snapshot: dict[str, object]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO styfi_snapshots (
                chain_id,
                observed_at,
                reward_epoch,
                yfi_total_supply_raw,
                styfi_total_assets_raw,
                styfi_total_supply_raw,
                styfix_total_assets_raw,
                styfix_total_supply_raw,
                liquid_lockers_staked_raw,
                migrated_yfi_raw,
                combined_staked_raw
            ) VALUES (
                %(chain_id)s,
                %(observed_at)s,
                %(reward_epoch)s,
                %(yfi_total_supply_raw)s,
                %(styfi_total_assets_raw)s,
                %(styfi_total_supply_raw)s,
                %(styfix_total_assets_raw)s,
                %(styfix_total_supply_raw)s,
                %(liquid_lockers_staked_raw)s,
                %(migrated_yfi_raw)s,
                %(combined_staked_raw)s
            )
            ON CONFLICT (chain_id, observed_at) DO UPDATE SET
                reward_epoch = EXCLUDED.reward_epoch,
                yfi_total_supply_raw = EXCLUDED.yfi_total_supply_raw,
                styfi_total_assets_raw = EXCLUDED.styfi_total_assets_raw,
                styfi_total_supply_raw = EXCLUDED.styfi_total_supply_raw,
                styfix_total_assets_raw = EXCLUDED.styfix_total_assets_raw,
                styfix_total_supply_raw = EXCLUDED.styfix_total_supply_raw,
                liquid_lockers_staked_raw = EXCLUDED.liquid_lockers_staked_raw,
                migrated_yfi_raw = EXCLUDED.migrated_yfi_raw,
                combined_staked_raw = EXCLUDED.combined_staked_raw
            """,
            snapshot,
        )
    conn.commit()


def _upsert_styfi_epoch_stats(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO styfi_epoch_stats (
                chain_id,
                epoch,
                epoch_start,
                reward_total_raw,
                reward_styfi_raw,
                reward_styfix_raw,
                reward_veyfi_raw,
                reward_liquid_lockers_raw
            ) VALUES (
                %(chain_id)s,
                %(epoch)s,
                %(epoch_start)s,
                %(reward_total_raw)s,
                %(reward_styfi_raw)s,
                %(reward_styfix_raw)s,
                %(reward_veyfi_raw)s,
                %(reward_liquid_lockers_raw)s
            )
            ON CONFLICT (chain_id, epoch) DO UPDATE SET
                epoch_start = EXCLUDED.epoch_start,
                reward_total_raw = EXCLUDED.reward_total_raw,
                reward_styfi_raw = EXCLUDED.reward_styfi_raw,
                reward_styfix_raw = EXCLUDED.reward_styfix_raw,
                reward_veyfi_raw = EXCLUDED.reward_veyfi_raw,
                reward_liquid_lockers_raw = EXCLUDED.reward_liquid_lockers_raw,
                fetched_at = NOW()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def _upsert_styfi_sync_state(conn: psycopg.Connection, state: dict[str, object]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO styfi_sync_state (
                stream_name,
                chain_id,
                cursor,
                observed_at,
                payload,
                updated_at
            ) VALUES (
                %(stream_name)s,
                %(chain_id)s,
                %(cursor)s,
                %(observed_at)s,
                %(payload)s,
                NOW()
            )
            ON CONFLICT (stream_name) DO UPDATE SET
                chain_id = EXCLUDED.chain_id,
                cursor = EXCLUDED.cursor,
                observed_at = EXCLUDED.observed_at,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            """,
            {**state, "payload": Json(state["payload"])},
        )
    conn.commit()



def _run_styfi_snapshot(conn: psycopg.Connection) -> tuple[int, int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_STYFI, started_at)
    try:
        snapshot, epochs, sync_state = _fetch_styfi_snapshot_data()
        _upsert_styfi_snapshot(conn, snapshot)
        epoch_rows = _upsert_styfi_epoch_stats(conn, epochs)
        _upsert_styfi_sync_state(conn, sync_state)
        summary = {
            "observed_at": snapshot["observed_at"].isoformat(),
            "reward_epoch": snapshot["reward_epoch"],
            "epoch_rows": epoch_rows,
            "combined_staked_raw": str(snapshot["combined_staked_raw"]),
        }
        _complete_run(conn, run_id, "success", epoch_rows + 1, json.dumps(summary))
        logging.info(
            "stYFI snapshot success: reward_epoch=%s combined_staked_raw=%s epoch_rows=%s",
            snapshot["reward_epoch"],
            snapshot["combined_staked_raw"],
            epoch_rows,
        )
        return run_id, 1, epoch_rows
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)}))
        logging.exception("stYFI snapshot failed: %s", exc)
        return run_id, 0, 0
