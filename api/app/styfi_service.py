from __future__ import annotations

import psycopg

from app.common import _safe_int, _to_float_or_none
from app.config import (
    STYFI_CHAIN_ID,
    STYFI_INTERNAL_ACTIVITY_ACCOUNTS,
    STYFI_REWARD_TOKEN_DEFAULT,
    STYFI_SITE_REWARD_SCALE,
    STYFI_TOKEN_SCALE,
)


def _styfi_summary_snapshot(cur: psycopg.Cursor) -> dict[str, object]:
    cur.execute(
        """
        WITH latest AS (
            SELECT *
            FROM styfi_snapshots
            WHERE chain_id = %(chain_id)s
            ORDER BY observed_at DESC
            LIMIT 1
        ),
        flow_24h AS (
            SELECT
                styfi_total_assets_raw,
                styfix_total_assets_raw,
                liquid_lockers_staked_raw,
                migrated_yfi_raw
            FROM styfi_snapshots
            WHERE chain_id = %(chain_id)s
              AND observed_at <= (SELECT observed_at FROM latest) - INTERVAL '24 hours'
            ORDER BY observed_at DESC
            LIMIT 1
        ),
        flow_7d AS (
            SELECT
                styfi_total_assets_raw,
                styfix_total_assets_raw,
                liquid_lockers_staked_raw,
                migrated_yfi_raw
            FROM styfi_snapshots
            WHERE chain_id = %(chain_id)s
              AND observed_at <= (SELECT observed_at FROM latest) - INTERVAL '7 days'
            ORDER BY observed_at DESC
            LIMIT 1
        ),
        stats AS (
            SELECT
                COUNT(*) AS snapshots_count,
                MIN(observed_at) AS first_snapshot_at,
                MAX(observed_at) AS latest_snapshot_at
            FROM styfi_snapshots
            WHERE chain_id = %(chain_id)s
        )
        SELECT
            l.observed_at,
            l.reward_epoch,
            (l.yfi_total_supply_raw::numeric / %(scale)s)::double precision AS yfi_total_supply,
            (l.styfi_total_assets_raw::numeric / %(scale)s)::double precision AS styfi_staked,
            (l.styfi_total_supply_raw::numeric / %(scale)s)::double precision AS styfi_supply,
            (l.styfix_total_assets_raw::numeric / %(scale)s)::double precision AS styfix_staked,
            (l.styfix_total_supply_raw::numeric / %(scale)s)::double precision AS styfix_supply,
            (COALESCE(l.liquid_lockers_staked_raw, 0)::numeric / %(scale)s)::double precision AS liquid_lockers_staked,
            (COALESCE(l.migrated_yfi_raw, 0)::numeric / %(scale)s)::double precision AS migrated_yfi,
            (
                (
                    l.styfi_total_assets_raw
                    + l.styfix_total_assets_raw
                    + COALESCE(l.liquid_lockers_staked_raw, 0)
                    + COALESCE(l.migrated_yfi_raw, 0)
                )::numeric
                / %(scale)s
            )::double precision AS combined_staked,
            CASE
                WHEN l.yfi_total_supply_raw > 0
                THEN (
                    (
                        l.styfi_total_assets_raw
                        + l.styfix_total_assets_raw
                        + COALESCE(l.liquid_lockers_staked_raw, 0)
                        + COALESCE(l.migrated_yfi_raw, 0)
                    )::numeric / l.yfi_total_supply_raw::numeric
                )::double precision
                ELSE NULL
            END AS staked_share_supply,
            CASE
                WHEN
                    f24.styfi_total_assets_raw IS NOT NULL
                    AND f24.liquid_lockers_staked_raw IS NOT NULL
                    AND f24.migrated_yfi_raw IS NOT NULL
                THEN (
                    (
                        (
                            l.styfi_total_assets_raw
                            + l.styfix_total_assets_raw
                            + COALESCE(l.liquid_lockers_staked_raw, 0)
                            + COALESCE(l.migrated_yfi_raw, 0)
                        )
                        - (
                            f24.styfi_total_assets_raw
                            + f24.styfix_total_assets_raw
                            + COALESCE(f24.liquid_lockers_staked_raw, 0)
                            + COALESCE(f24.migrated_yfi_raw, 0)
                        )
                    )::numeric / %(scale)s
                )::double precision
                ELSE NULL
            END AS net_flow_24h,
            CASE
                WHEN
                    f7d.styfi_total_assets_raw IS NOT NULL
                    AND f7d.liquid_lockers_staked_raw IS NOT NULL
                    AND f7d.migrated_yfi_raw IS NOT NULL
                THEN (
                    (
                        (
                            l.styfi_total_assets_raw
                            + l.styfix_total_assets_raw
                            + COALESCE(l.liquid_lockers_staked_raw, 0)
                            + COALESCE(l.migrated_yfi_raw, 0)
                        )
                        - (
                            f7d.styfi_total_assets_raw
                            + f7d.styfix_total_assets_raw
                            + COALESCE(f7d.liquid_lockers_staked_raw, 0)
                            + COALESCE(f7d.migrated_yfi_raw, 0)
                        )
                    )::numeric / %(scale)s
                )::double precision
                ELSE NULL
            END AS net_flow_7d,
            s.snapshots_count,
            s.first_snapshot_at,
            s.latest_snapshot_at
        FROM latest l
        CROSS JOIN stats s
        LEFT JOIN flow_24h f24 ON TRUE
        LEFT JOIN flow_7d f7d ON TRUE
        """,
        {"chain_id": STYFI_CHAIN_ID, "scale": STYFI_TOKEN_SCALE},
    )
    row = cur.fetchone() or {}
    observed_at = row.get("observed_at")
    latest_snapshot_at = row.get("latest_snapshot_at")
    return {
        "observed_at": observed_at.isoformat() if observed_at else None,
        "reward_epoch": int(row.get("reward_epoch") or 0),
        "yfi_total_supply": _to_float_or_none(row.get("yfi_total_supply")),
        "styfi_staked": _to_float_or_none(row.get("styfi_staked")),
        "styfi_supply": _to_float_or_none(row.get("styfi_supply")),
        "styfix_staked": _to_float_or_none(row.get("styfix_staked")),
        "styfix_supply": _to_float_or_none(row.get("styfix_supply")),
        "liquid_lockers_staked": _to_float_or_none(row.get("liquid_lockers_staked")),
        "migrated_yfi": _to_float_or_none(row.get("migrated_yfi")),
        "combined_staked": _to_float_or_none(row.get("combined_staked")),
        "staked_share_supply": _to_float_or_none(row.get("staked_share_supply")),
        "net_flow_24h": _to_float_or_none(row.get("net_flow_24h")),
        "net_flow_7d": _to_float_or_none(row.get("net_flow_7d")),
        "snapshots_count": int(row.get("snapshots_count") or 0),
        "first_snapshot_at": row.get("first_snapshot_at").isoformat() if row.get("first_snapshot_at") else None,
        "latest_snapshot_at": latest_snapshot_at.isoformat() if latest_snapshot_at else None,
    }


def _styfi_reward_token(cur: psycopg.Cursor) -> dict[str, object]:
    cur.execute(
        """
        SELECT payload
        FROM styfi_sync_state
        WHERE stream_name = %(stream_name)s
          AND chain_id = %(chain_id)s
        LIMIT 1
        """,
        {"stream_name": "styfi_reward_epoch", "chain_id": STYFI_CHAIN_ID},
    )
    row = cur.fetchone() or {}
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    reward_token = payload.get("reward_token") if isinstance(payload, dict) else None
    if not isinstance(reward_token, dict):
        return dict(STYFI_REWARD_TOKEN_DEFAULT)
    decimals = reward_token.get("decimals")
    if isinstance(decimals, (int, float)):
        scale_decimals = int(decimals)
    elif isinstance(decimals, str) and decimals.isdigit():
        scale_decimals = int(decimals)
    else:
        scale_decimals = int(STYFI_REWARD_TOKEN_DEFAULT["decimals"])
    return {
        "address": reward_token.get("address") if isinstance(reward_token.get("address"), str) else STYFI_REWARD_TOKEN_DEFAULT["address"],
        "symbol": reward_token.get("symbol") if isinstance(reward_token.get("symbol"), str) and reward_token.get("symbol") else STYFI_REWARD_TOKEN_DEFAULT["symbol"],
        "decimals": scale_decimals,
    }


def _styfi_current_reward_state(cur: psycopg.Cursor) -> dict[str, object] | None:
    cur.execute(
        """
        SELECT payload
        FROM styfi_sync_state
        WHERE stream_name = %(stream_name)s
          AND chain_id = %(chain_id)s
        LIMIT 1
        """,
        {"stream_name": "styfi_reward_epoch", "chain_id": STYFI_CHAIN_ID},
    )
    row = cur.fetchone() or {}
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    state = payload.get("current_reward_state") if isinstance(payload, dict) else None
    if not isinstance(state, dict):
        return None

    def reward(value: object) -> float | None:
        return _to_float_or_none((int(value) / STYFI_SITE_REWARD_SCALE) if value is not None else None)

    def bps(value: object) -> float | None:
        if value is None:
            return None
        try:
            return int(value) / 10000
        except (TypeError, ValueError):
            return None

    meta = state.get("meta") if isinstance(state.get("meta"), dict) else {}
    global_rewards = state.get("global_rewards") if isinstance(state.get("global_rewards"), dict) else {}
    styfi = state.get("styfi") if isinstance(state.get("styfi"), dict) else {}
    styfix = state.get("styfix") if isinstance(state.get("styfix"), dict) else {}
    migrations = state.get("migrations") if isinstance(state.get("migrations"), dict) else {}
    liquid_lockers = state.get("liquid_lockers") if isinstance(state.get("liquid_lockers"), dict) else {}
    return {
        "source": state.get("source") if isinstance(state.get("source"), str) else None,
        "epoch": _safe_int(meta.get("epoch")),
        "timestamp": _safe_int(meta.get("timestamp")),
        "block_number": _safe_int(meta.get("block_number")),
        "reward_pps": reward(global_rewards.get("pps_raw")),
        "global_apr": bps(global_rewards.get("apy_bps")),
        "styfi_current_reward": reward(styfi.get("current_rewards_raw")),
        "styfi_current_apr": bps(styfi.get("current_apr_bps")),
        "styfi_projected_reward": reward(styfi.get("projected_rewards_raw")),
        "styfi_projected_apr": bps(styfi.get("projected_apr_bps")),
        "styfix_current_reward": reward(styfix.get("current_rewards_raw")),
        "styfix_current_apr": bps(styfix.get("current_apr_bps")),
        "styfix_projected_reward": reward(styfix.get("projected_rewards_raw")),
        "styfix_projected_apr": bps(styfix.get("projected_apr_bps")),
        "liquid_lockers_staked": _to_float_or_none(
            (int(liquid_lockers.get("staked_raw")) / STYFI_SITE_REWARD_SCALE)
            if liquid_lockers.get("staked_raw") is not None
            else None
        ),
        "migrated_yfi": _to_float_or_none(
            (int(migrations.get("migrated_yfi_raw")) / STYFI_SITE_REWARD_SCALE)
            if migrations.get("migrated_yfi_raw") is not None
            else None
        ),
    }


def _styfi_snapshot_series(cur: psycopg.Cursor, *, days: int) -> list[dict[str, object]]:
    cur.execute(
        """
        SELECT
            observed_at,
            reward_epoch,
            (styfi_total_assets_raw::numeric / %(scale)s)::double precision AS styfi_staked,
            (styfix_total_assets_raw::numeric / %(scale)s)::double precision AS styfix_staked,
            (COALESCE(liquid_lockers_staked_raw, 0)::numeric / %(scale)s)::double precision AS liquid_lockers_staked,
            (COALESCE(migrated_yfi_raw, 0)::numeric / %(scale)s)::double precision AS migrated_yfi,
            (
                (
                    styfi_total_assets_raw
                    + styfix_total_assets_raw
                    + COALESCE(liquid_lockers_staked_raw, 0)
                    + COALESCE(migrated_yfi_raw, 0)
                )::numeric
                / %(scale)s
            )::double precision AS combined_staked,
            CASE
                WHEN yfi_total_supply_raw > 0
                THEN (
                    (
                        styfi_total_assets_raw
                        + styfix_total_assets_raw
                        + COALESCE(liquid_lockers_staked_raw, 0)
                        + COALESCE(migrated_yfi_raw, 0)
                    )::numeric / yfi_total_supply_raw::numeric
                )::double precision
                ELSE NULL
            END AS staked_share_supply
        FROM styfi_snapshots
        WHERE chain_id = %(chain_id)s
          AND observed_at >= NOW() - (%(days)s * INTERVAL '1 day')
        ORDER BY observed_at
        """,
        {"chain_id": STYFI_CHAIN_ID, "days": days, "scale": STYFI_TOKEN_SCALE},
    )
    rows = cur.fetchall()
    return [
        {
            "observed_at": row["observed_at"].isoformat() if row.get("observed_at") else None,
            "reward_epoch": int(row.get("reward_epoch") or 0),
            "styfi_staked": _to_float_or_none(row.get("styfi_staked")),
            "styfix_staked": _to_float_or_none(row.get("styfix_staked")),
            "liquid_lockers_staked": _to_float_or_none(row.get("liquid_lockers_staked")),
            "migrated_yfi": _to_float_or_none(row.get("migrated_yfi")),
            "combined_staked": _to_float_or_none(row.get("combined_staked")),
            "staked_share_supply": _to_float_or_none(row.get("staked_share_supply")),
        }
        for row in rows
    ]


def _styfi_epoch_series(cur: psycopg.Cursor, *, epoch_limit: int, reward_scale: float) -> list[dict[str, object]]:
    cur.execute(
        """
        SELECT
            epoch,
            epoch_start,
            (reward_total_raw::numeric / %(scale)s)::double precision AS reward_total,
            (reward_styfi_raw::numeric / %(scale)s)::double precision AS reward_styfi,
            (reward_styfix_raw::numeric / %(scale)s)::double precision AS reward_styfix,
            (reward_veyfi_raw::numeric / %(scale)s)::double precision AS reward_veyfi,
            (reward_liquid_lockers_raw::numeric / %(scale)s)::double precision AS reward_liquid_lockers
        FROM styfi_epoch_stats
        WHERE chain_id = %(chain_id)s
        ORDER BY epoch DESC
        LIMIT %(epoch_limit)s
        """,
        {"chain_id": STYFI_CHAIN_ID, "epoch_limit": epoch_limit, "scale": reward_scale},
    )
    rows = list(reversed(cur.fetchall()))
    return [
        {
            "epoch": int(row.get("epoch") or 0),
            "epoch_start": row["epoch_start"].isoformat() if row.get("epoch_start") else None,
            "reward_total": _to_float_or_none(row.get("reward_total")),
            "reward_styfi": _to_float_or_none(row.get("reward_styfi")),
            "reward_styfix": _to_float_or_none(row.get("reward_styfix")),
            "reward_veyfi": _to_float_or_none(row.get("reward_veyfi")),
            "reward_liquid_lockers": _to_float_or_none(row.get("reward_liquid_lockers")),
        }
        for row in rows
    ]


def _styfi_latest_component_split(cur: psycopg.Cursor, *, current_epoch: int | None, reward_scale: float) -> dict[str, object]:
    if current_epoch is None or current_epoch <= 0:
        return {"epoch": None, "rows": []}
    cur.execute(
        """
        SELECT
            epoch,
            (reward_styfi_raw::numeric / %(scale)s)::double precision AS reward_styfi,
            (reward_styfix_raw::numeric / %(scale)s)::double precision AS reward_styfix,
            (reward_veyfi_raw::numeric / %(scale)s)::double precision AS reward_veyfi,
            (reward_liquid_lockers_raw::numeric / %(scale)s)::double precision AS reward_liquid_lockers
        FROM styfi_epoch_stats
        WHERE chain_id = %(chain_id)s
          AND epoch < %(current_epoch)s
        ORDER BY epoch DESC
        LIMIT 1
        """,
        {"chain_id": STYFI_CHAIN_ID, "current_epoch": current_epoch, "scale": reward_scale},
    )
    row = cur.fetchone()
    if not row:
        return {"epoch": None, "rows": []}
    return {
        "epoch": int(row.get("epoch") or 0),
        "rows": [
            {"component": "stYFI", "reward": _to_float_or_none(row.get("reward_styfi"))},
            {"component": "stYFIx", "reward": _to_float_or_none(row.get("reward_styfix"))},
            {"component": "Migrated veYFI", "reward": _to_float_or_none(row.get("reward_veyfi"))},
            {"component": "Liquid lockers", "reward": _to_float_or_none(row.get("reward_liquid_lockers"))},
        ],
    }


def _styfi_last_run(cur: psycopg.Cursor) -> dict[str, object] | None:
    cur.execute(
        """
        SELECT status, started_at, ended_at, records, error_summary
        FROM ingestion_runs
        WHERE job_name = 'styfi_snapshot'
        ORDER BY id DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "status": row["status"],
        "started_at": row["started_at"].isoformat() if row.get("started_at") else None,
        "ended_at": row["ended_at"].isoformat() if row.get("ended_at") else None,
        "records": int(row.get("records") or 0),
        "error_summary": row.get("error_summary"),
    }


def _styfi_recent_activity(cur: psycopg.Cursor, *, limit: int = 10) -> list[dict[str, object]]:
    cur.execute(
        """
        SELECT
            chain_id,
            block_time,
            tx_hash,
            user_account,
            product_type,
            event_kind,
            product_contract,
            amount_raw,
            amount_decimals,
            amount_symbol
        FROM product_interactions
        WHERE
            chain_id = %(chain_id)s
            AND product_type IN ('styfi', 'styfix')
            AND event_kind IN ('deposit', 'unstake', 'withdraw', 'claim')
            AND NOT (LOWER(user_account) = ANY(%(ignored_accounts)s))
        ORDER BY block_time DESC, tx_hash DESC, log_index DESC
        LIMIT %(limit)s
        """,
        {"chain_id": STYFI_CHAIN_ID, "limit": limit, "ignored_accounts": sorted(STYFI_INTERNAL_ACTIVITY_ACCOUNTS)},
    )
    rows = cur.fetchall()
    action_labels = {
        "deposit": "Stake",
        "unstake": "Unstake",
        "withdraw": "Withdraw",
        "claim": "Claim",
    }
    product_labels = {
        "styfi": "stYFI",
        "styfix": "stYFIx",
    }
    return [
        {
            "chain_id": int(row.get("chain_id") or STYFI_CHAIN_ID),
            "block_time": row["block_time"].isoformat() if row.get("block_time") else None,
            "tx_hash": row.get("tx_hash"),
            "user_account": row.get("user_account"),
            "product_type": row.get("product_type"),
            "product_label": product_labels.get(str(row.get("product_type") or ""), str(row.get("product_type") or "").upper()),
            "event_kind": row.get("event_kind"),
            "action_label": action_labels.get(str(row.get("event_kind") or ""), str(row.get("event_kind") or "").title()),
            "product_contract": row.get("product_contract"),
            "amount_raw": str(row["amount_raw"]) if row.get("amount_raw") is not None else None,
            "amount_decimals": int(row["amount_decimals"]) if row.get("amount_decimals") is not None else None,
            "amount_symbol": row.get("amount_symbol"),
        }
        for row in rows
    ]
