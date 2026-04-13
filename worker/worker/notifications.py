from __future__ import annotations

import logging
from datetime import UTC, datetime

import psycopg
import requests
from psycopg.types.json import Json

from .config import (
    ALERT_COOLDOWN_SECONDS,
    ALERT_DISCORD_WEBHOOK_URL,
    ALERT_NOTIFY_ON_RECOVERY,
    ALERT_STALE_SECONDS,
    ALERT_TELEGRAM_BOT_TOKEN,
    ALERT_TELEGRAM_CHAT_ID,
    DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC,
    DISCORD_NOTIFICATION_RETRY_LIMIT,
    HARVEST_DISCORD_DESTINATIONS,
    JOB_KONG_PPS,
    JOB_KONG_SNAPSHOT,
    JOB_PRODUCT_DAU,
    STYFI_ASSET_DECIMALS,
    STYFI_ASSET_SYMBOL,
    STYFI_CHAIN_ID,
    STYFI_DISCORD_DESTINATION,
    STYFI_INTERNAL_ACTIVITY_ACCOUNTS,
    STYFI_PRODUCT_SYMBOLS,
)
from .eth import (
    _chain_label,
    _explorer_address_url,
    _explorer_tx_url,
    _short_hex,
    _strategy_display_label,
    _to_int_or_none,
    _yearn_vault_url,
)


def _discord_timestamp(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    ts = int(dt.timestamp())
    return f"<t:{ts}:f> (<t:{ts}:R>)"


def _format_amount(
    raw_value: object,
    decimals: int | None,
    symbol: str | None,
    *,
    max_fraction_digits: int = 6,
    use_ellipsis: bool = True,
) -> str:
    if raw_value is None:
        return "n/a"
    digits = str(raw_value).strip()
    if not digits:
        return "n/a"
    normalized = digits.lstrip("0") or "0"
    scale = max(0, decimals or 0)
    padded = normalized.rjust(scale + 1, "0")
    whole = padded[:-scale] if scale > 0 else padded
    fraction = padded[-scale:] if scale > 0 else ""
    whole_with_commas = f"{int(whole):,}"
    if not fraction:
        return f"{whole_with_commas} {symbol}".strip()
    trimmed_fraction = fraction.rstrip("0")
    if not trimmed_fraction:
        return f"{whole_with_commas} {symbol}".strip()
    visible_fraction = trimmed_fraction[:max_fraction_digits]
    suffix = "…" if use_ellipsis and len(trimmed_fraction) > max_fraction_digits else ""
    return f"{whole_with_commas}.{visible_fraction}{suffix} {symbol}".strip()


def _harvest_destination(chain_id: int) -> dict[str, object] | None:
    destination = HARVEST_DISCORD_DESTINATIONS.get(chain_id)
    if not destination or not destination.get("webhook_url"):
        return None
    return destination


def _notification_webhook_url(destination_key: str) -> str | None:
    if destination_key == STYFI_DISCORD_DESTINATION["destination_key"]:
        webhook_url = STYFI_DISCORD_DESTINATION.get("webhook_url")
        return str(webhook_url) if webhook_url else None
    for destination in HARVEST_DISCORD_DESTINATIONS.values():
        if destination["destination_key"] == destination_key:
            webhook_url = destination.get("webhook_url")
            return str(webhook_url) if webhook_url else None
    return None


def _get_notification_delivery(
    conn: psycopg.Connection,
    *,
    source_type: str,
    chain_id: int,
    tx_hash: str,
    log_index: int,
    destination_key: str,
) -> dict[str, object] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, attempts, payload
            FROM notification_deliveries
            WHERE
                source_type = %s
                AND chain_id = %s
                AND tx_hash = %s
                AND log_index = %s
                AND destination_key = %s
            """,
            (source_type, chain_id, tx_hash, log_index, destination_key),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    return {"status": row[0], "attempts": int(row[1] or 0), "payload": row[2]}


def _upsert_notification_delivery(
    conn: psycopg.Connection,
    *,
    source_type: str,
    chain_id: int,
    tx_hash: str,
    log_index: int,
    destination_key: str,
    status: str,
    payload: dict[str, object],
    error: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notification_deliveries (
                source_type,
                chain_id,
                tx_hash,
                log_index,
                destination_key,
                status,
                attempts,
                last_attempted_at,
                delivered_at,
                last_error,
                payload
            ) VALUES (
                %(source_type)s,
                %(chain_id)s,
                %(tx_hash)s,
                %(log_index)s,
                %(destination_key)s,
                %(status)s,
                1,
                NOW(),
                CASE WHEN %(status)s = 'sent' THEN NOW() ELSE NULL END,
                %(error)s,
                %(payload)s
            )
            ON CONFLICT (source_type, chain_id, tx_hash, log_index, destination_key) DO UPDATE SET
                status = EXCLUDED.status,
                attempts = notification_deliveries.attempts + 1,
                last_attempted_at = NOW(),
                delivered_at = CASE
                    WHEN EXCLUDED.status = 'sent' THEN NOW()
                    ELSE notification_deliveries.delivered_at
                END,
                last_error = EXCLUDED.last_error,
                payload = EXCLUDED.payload
            """,
            {
                "source_type": source_type,
                "chain_id": chain_id,
                "tx_hash": tx_hash,
                "log_index": log_index,
                "destination_key": destination_key,
                "status": status,
                "error": error,
                "payload": Json(payload),
            },
        )
    conn.commit()


def _send_discord_payload(webhook_url: str, payload: dict[str, object]) -> None:
    response = requests.post(webhook_url, json=payload, timeout=10)
    response.raise_for_status()


def _deliver_discord_notification(
    conn: psycopg.Connection,
    *,
    source_type: str,
    chain_id: int,
    tx_hash: str,
    log_index: int,
    destination_key: str,
    payload: dict[str, object],
) -> bool:
    existing = _get_notification_delivery(
        conn,
        source_type=source_type,
        chain_id=chain_id,
        tx_hash=tx_hash,
        log_index=log_index,
        destination_key=destination_key,
    )
    if existing and existing.get("status") == "sent":
        return False
    webhook_url = _notification_webhook_url(destination_key)
    if not webhook_url:
        return False
    try:
        _send_discord_payload(webhook_url, payload)
        _upsert_notification_delivery(
            conn,
            source_type=source_type,
            chain_id=chain_id,
            tx_hash=tx_hash,
            log_index=log_index,
            destination_key=destination_key,
            status="sent",
            payload=payload,
            error=None,
        )
        return True
    except Exception as exc:
        _upsert_notification_delivery(
            conn,
            source_type=source_type,
            chain_id=chain_id,
            tx_hash=tx_hash,
            log_index=log_index,
            destination_key=destination_key,
            status="failed",
            payload=payload,
            error=str(exc),
        )
        logging.warning(
            "Discord delivery failed: source=%s chain=%s tx=%s log_index=%s destination=%s error=%s",
            source_type,
            chain_id,
            tx_hash,
            log_index,
            destination_key,
            exc,
        )
        return False


def _harvest_vault_meta(conn: psycopg.Connection, *, chain_id: int, vault_address: str) -> dict[str, object]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT name, symbol, token_symbol, token_decimals
            FROM vault_dim
            WHERE chain_id = %s AND vault_address = %s
            """,
            (chain_id, vault_address),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return {"name": None, "symbol": None, "token_symbol": None, "token_decimals": None}
    return {
        "name": row[0],
        "symbol": row[1],
        "token_symbol": row[2],
        "token_decimals": _to_int_or_none(row[3]),
    }


def _styfi_totals_summary(conn: psycopg.Connection) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                combined_staked_raw,
                styfi_total_assets_raw,
                styfix_total_assets_raw,
                liquid_lockers_staked_raw,
                migrated_yfi_raw
            FROM styfi_snapshots
            WHERE chain_id = %s
            ORDER BY observed_at DESC
            LIMIT 1
            """,
            (STYFI_CHAIN_ID,),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    combined_raw, styfi_raw, styfix_raw, liquid_lockers_raw, migrated_raw = row
    combined_text = _format_amount(
        combined_raw, STYFI_ASSET_DECIMALS, STYFI_ASSET_SYMBOL, max_fraction_digits=2, use_ellipsis=False
    )
    styfi_text = _format_amount(styfi_raw, STYFI_ASSET_DECIMALS, "stYFI", max_fraction_digits=2, use_ellipsis=False)
    styfix_text = _format_amount(
        styfix_raw, STYFI_ASSET_DECIMALS, "stYFIx", max_fraction_digits=2, use_ellipsis=False
    )
    liquid_lockers_text = _format_amount(
        liquid_lockers_raw, STYFI_ASSET_DECIMALS, "Liquid lockers", max_fraction_digits=2, use_ellipsis=False
    )
    migrated_text = _format_amount(
        migrated_raw, STYFI_ASSET_DECIMALS, "Migrated veYFI", max_fraction_digits=2, use_ellipsis=False
    )
    return f"{combined_text} | {styfi_text}, {styfix_text}, {liquid_lockers_text}, {migrated_text}"


def _build_harvest_discord_payload(
    conn: psycopg.Connection,
    *,
    row: dict[str, object],
) -> tuple[str, dict[str, object]] | None:
    chain_id = int(row["chain_id"])
    destination = _harvest_destination(chain_id)
    if not destination:
        return None
    vault_address = str(row["vault_address"]).lower()
    strategy_address = str(row["strategy_address"]).lower()
    tx_hash = str(row["tx_hash"]).lower()
    block_time = row["block_time"]
    if not isinstance(block_time, datetime):
        return None
    meta = _harvest_vault_meta(conn, chain_id=chain_id, vault_address=vault_address)
    vault_symbol = str(meta.get("symbol") or _short_hex(vault_address))
    token_symbol = str(meta.get("token_symbol") or "")
    token_decimals = _to_int_or_none(meta.get("token_decimals"))
    gain_text = _format_amount(row.get("gain"), token_decimals, token_symbol)
    fee_text = _format_amount(row.get("fee_assets"), token_decimals, token_symbol)
    tx_url = _explorer_tx_url(chain_id, tx_hash)
    vault_address_url = _explorer_address_url(chain_id, vault_address)
    strategy_url = _explorer_address_url(chain_id, strategy_address)
    vault_url = _yearn_vault_url(chain_id, vault_address)
    strategy_label = _strategy_display_label(chain_id, strategy_address)
    details_lines = [
        f"🏦 [{vault_symbol}]({vault_url}) ({f'[{_short_hex(vault_address)}]({vault_address_url})' if vault_address_url else _short_hex(vault_address)})",
        f"🧠 {strategy_label} ({f'[{_short_hex(strategy_address)}]({strategy_url})' if strategy_url else _short_hex(strategy_address)})",
        f"📅 {_discord_timestamp(block_time)}",
        f"💰 Gain: {gain_text}",
        f"💸 Fees: {fee_text}",
    ]
    embed = {
        "title": f"{_chain_label(chain_id)} Harvest",
        "color": int(destination["color"]),
        "fields": [
            {"name": "\u200b", "value": "\n".join(details_lines), "inline": False},
            {"name": "\u200b", "value": f"🔗 [View on Explorer]({tx_url})" if tx_url else "Explorer unavailable", "inline": False},
        ],
    }
    payload = {
        "username": destination["username"],
        "embeds": [embed],
    }
    avatar_url = str(destination.get("avatar_url") or "").strip()
    if avatar_url:
        payload["avatar_url"] = avatar_url
    return str(destination["destination_key"]), payload


def _product_label(product_type: str) -> str:
    return STYFI_PRODUCT_SYMBOLS.get(product_type, product_type)


def _action_label(event_kind: str) -> str:
    return {
        "deposit": "Stake",
        "unstake": "Unstake",
        "withdraw": "Withdraw",
        "claim": "Claim",
    }.get(event_kind, event_kind.title())


def _styfi_action_color(event_kind: str) -> int:
    return {
        "claim": 0x0657E9,
        "withdraw": 0x5A544E,
        "unstake": 0x9A5B23,
        "deposit": 0x0657E9,
    }.get(event_kind, int(STYFI_DISCORD_DESTINATION["color"]))


def _build_styfi_discord_payload(
    conn: psycopg.Connection,
    row: dict[str, object],
) -> tuple[str, dict[str, object]] | None:
    webhook_url = STYFI_DISCORD_DESTINATION.get("webhook_url")
    if not webhook_url:
        return None
    chain_id = int(row["chain_id"])
    tx_hash = str(row["tx_hash"]).lower()
    account = str(row["user_account"]).lower()
    event_kind = str(row["event_kind"])
    product_type = str(row["product_type"])
    block_time = row["block_time"]
    if not isinstance(block_time, datetime):
        return None
    tx_url = _explorer_tx_url(chain_id, tx_hash)
    account_url = _explorer_address_url(chain_id, account)
    amount_text = _format_amount(row.get("amount_raw"), _to_int_or_none(row.get("amount_decimals")), row.get("amount_symbol"))
    details_lines = [
        f"👤 {f'[{_short_hex(account)}]({account_url})' if account_url else _short_hex(account)}",
        f"📅 {_discord_timestamp(block_time)}",
        f"💰 {amount_text}",
    ]
    embed = {
        "title": f"{_product_label(product_type)} {_action_label(event_kind)}",
        "color": _styfi_action_color(event_kind),
        "fields": [
            {"name": "\u200b", "value": "\n".join(details_lines), "inline": False},
            {"name": "\u200b", "value": f"🔗 [View on Explorer]({tx_url})" if tx_url else "Explorer unavailable", "inline": False},
        ],
    }
    totals_summary = _styfi_totals_summary(conn)
    if totals_summary:
        embed["description"] = totals_summary
    payload = {
        "username": STYFI_DISCORD_DESTINATION["username"],
        "embeds": [embed],
    }
    avatar_url = str(STYFI_DISCORD_DESTINATION.get("avatar_url") or "").strip()
    if avatar_url:
        payload["avatar_url"] = avatar_url
    return str(STYFI_DISCORD_DESTINATION["destination_key"]), payload


def _notify_harvest_rows(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    delivered = 0
    for row in rows:
        built = _build_harvest_discord_payload(conn, row=row)
        if not built:
            continue
        destination_key, payload = built
        if _deliver_discord_notification(
            conn,
            source_type="vault_harvest",
            chain_id=int(row["chain_id"]),
            tx_hash=str(row["tx_hash"]).lower(),
            log_index=int(row["log_index"]),
            destination_key=destination_key,
            payload=payload,
        ):
            delivered += 1
    return delivered


def _notify_styfi_activity_rows(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    delivered = 0
    for row in rows:
        account = str(row.get("user_account") or "").lower()
        if account in STYFI_INTERNAL_ACTIVITY_ACCOUNTS:
            continue
        built = _build_styfi_discord_payload(conn, row)
        if not built:
            continue
        destination_key, payload = built
        if _deliver_discord_notification(
            conn,
            source_type="styfi_activity",
            chain_id=int(row["chain_id"]),
            tx_hash=str(row["tx_hash"]).lower(),
            log_index=int(row["log_index"]),
            destination_key=destination_key,
            payload=payload,
        ):
            delivered += 1
    return delivered


def _retry_failed_discord_notifications(conn: psycopg.Connection, *, limit: int = 50) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_type, chain_id, tx_hash, log_index, destination_key, payload
            FROM notification_deliveries
            WHERE
                status = 'failed'
                AND attempts < %(retry_limit)s
                AND (
                    last_attempted_at IS NULL
                    OR last_attempted_at <= NOW() - (%(cooldown)s * INTERVAL '1 second')
                )
            ORDER BY last_attempted_at NULLS FIRST
            LIMIT %(limit)s
            """,
            {
                "retry_limit": DISCORD_NOTIFICATION_RETRY_LIMIT,
                "cooldown": DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC,
                "limit": limit,
            },
        )
        rows = cur.fetchall()
    conn.commit()
    delivered = 0
    for source_type, chain_id, tx_hash, log_index, destination_key, payload in rows:
        if not isinstance(payload, dict):
            continue
        if _deliver_discord_notification(
            conn,
            source_type=str(source_type),
            chain_id=int(chain_id),
            tx_hash=str(tx_hash),
            log_index=int(log_index),
            destination_key=str(destination_key),
            payload=payload,
        ):
            delivered += 1
    if delivered > 0:
        logging.info("Retried Discord notifications delivered=%s", delivered)
    return delivered


def _send_telegram(message: str) -> bool:
    if not ALERT_TELEGRAM_BOT_TOKEN or not ALERT_TELEGRAM_CHAT_ID:
        return False
    response = requests.post(
        f"https://api.telegram.org/bot{ALERT_TELEGRAM_BOT_TOKEN}/sendMessage",
        json={"chat_id": ALERT_TELEGRAM_CHAT_ID, "text": message, "disable_web_page_preview": True},
        timeout=10,
    )
    response.raise_for_status()
    return True


def _send_discord(message: str) -> bool:
    if not ALERT_DISCORD_WEBHOOK_URL:
        return False
    _send_discord_payload(ALERT_DISCORD_WEBHOOK_URL, {"content": message})
    return True


def _send_notifications(message: str) -> dict[str, object]:
    attempted: list[str] = []
    delivered: list[str] = []
    errors: list[str] = []

    if ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID:
        attempted.append("telegram")
        try:
            if _send_telegram(message):
                delivered.append("telegram")
        except Exception as exc:
            errors.append(f"telegram:{exc}")

    if ALERT_DISCORD_WEBHOOK_URL:
        attempted.append("discord")
        try:
            if _send_discord(message):
                delivered.append("discord")
        except Exception as exc:
            errors.append(f"discord:{exc}")

    return {"attempted": attempted, "delivered": delivered, "errors": errors}


def _get_job_status(conn: psycopg.Connection, job_name: str) -> tuple[datetime | None, int | None]:
    now = datetime.now(UTC)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(ended_at) FILTER (WHERE status = 'success') AS last_success_at
            FROM ingestion_runs
            WHERE job_name = %s
            """,
            (job_name,),
        )
        row = cur.fetchone()
    if not row:
        return None, None
    last_success_at = row[0]
    if not isinstance(last_success_at, datetime):
        return None, None
    if last_success_at.tzinfo is None:
        last_success_at = last_success_at.replace(tzinfo=UTC)
    age_seconds = max(0, int((now - last_success_at).total_seconds()))
    return last_success_at, age_seconds


def _get_alert_state(conn: psycopg.Connection, alert_key: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                status,
                last_notified_at,
                last_fired_at,
                last_recovered_at
            FROM alert_state
            WHERE alert_key = %s
            """,
            (alert_key,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "status": row[0],
        "last_notified_at": row[1],
        "last_fired_at": row[2],
        "last_recovered_at": row[3],
    }


def _upsert_alert_state(
    conn: psycopg.Connection,
    *,
    alert_key: str,
    job_name: str,
    status: str,
    threshold_seconds: int,
    current_age_seconds: int | None,
    last_success_at: datetime | None,
    last_fired_at: datetime | None,
    last_recovered_at: datetime | None,
    last_notified_at: datetime | None,
    notify_channels: list[str],
    notify_result: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO alert_state (
                alert_key,
                job_name,
                status,
                threshold_seconds,
                current_age_seconds,
                last_success_at,
                last_checked_at,
                last_fired_at,
                last_recovered_at,
                last_notified_at,
                notify_channels,
                last_notify_result
            ) VALUES (
                %(alert_key)s,
                %(job_name)s,
                %(status)s,
                %(threshold_seconds)s,
                %(current_age_seconds)s,
                %(last_success_at)s,
                NOW(),
                %(last_fired_at)s,
                %(last_recovered_at)s,
                %(last_notified_at)s,
                %(notify_channels)s,
                %(last_notify_result)s
            )
            ON CONFLICT (alert_key) DO UPDATE SET
                job_name = EXCLUDED.job_name,
                status = EXCLUDED.status,
                threshold_seconds = EXCLUDED.threshold_seconds,
                current_age_seconds = EXCLUDED.current_age_seconds,
                last_success_at = EXCLUDED.last_success_at,
                last_checked_at = NOW(),
                last_fired_at = EXCLUDED.last_fired_at,
                last_recovered_at = EXCLUDED.last_recovered_at,
                last_notified_at = EXCLUDED.last_notified_at,
                notify_channels = EXCLUDED.notify_channels,
                last_notify_result = EXCLUDED.last_notify_result
            """,
            {
                "alert_key": alert_key,
                "job_name": job_name,
                "status": status,
                "threshold_seconds": threshold_seconds,
                "current_age_seconds": current_age_seconds,
                "last_success_at": last_success_at,
                "last_fired_at": last_fired_at,
                "last_recovered_at": last_recovered_at,
                "last_notified_at": last_notified_at,
                "notify_channels": notify_channels,
                "last_notify_result": Json(notify_result),
            },
        )
    conn.commit()


def _evaluate_job_stale_alert(conn: psycopg.Connection, *, job_name: str) -> None:
    alert_key = f"ingestion_stale:{job_name}"
    now = datetime.now(UTC)
    last_success_at, age_seconds = _get_job_status(conn, job_name)
    previous = _get_alert_state(conn, alert_key)
    previous_status = (previous or {}).get("status")
    previous_notified = (previous or {}).get("last_notified_at")

    status = "ok"
    message: str | None = None
    notify_result: dict[str, object] = {"attempted": [], "delivered": [], "errors": []}
    last_fired_at = (previous or {}).get("last_fired_at")
    last_recovered_at = (previous or {}).get("last_recovered_at")
    last_notified_at = previous_notified

    if age_seconds is None:
        status = "unknown"
    elif age_seconds > ALERT_STALE_SECONDS:
        status = "firing"
        should_notify = previous_status != "firing"
        if not should_notify and isinstance(previous_notified, datetime):
            if previous_notified.tzinfo is None:
                previous_notified = previous_notified.replace(tzinfo=UTC)
            elapsed = max(0, int((now - previous_notified).total_seconds()))
            should_notify = elapsed >= ALERT_COOLDOWN_SECONDS
        if should_notify:
            age_hours = round(age_seconds / 3600, 2)
            threshold_hours = round(ALERT_STALE_SECONDS / 3600, 2)
            message = (
                f"[yHelper] stale ingestion alert\n"
                f"job={job_name}\n"
                f"age_hours={age_hours}\n"
                f"threshold_hours={threshold_hours}\n"
                f"last_success_at={last_success_at.isoformat() if last_success_at else 'n/a'}"
            )
            notify_result = _send_notifications(message)
            if notify_result.get("delivered"):
                last_notified_at = now
            last_fired_at = now
    else:
        if previous_status == "firing" and ALERT_NOTIFY_ON_RECOVERY:
            age_hours = round(age_seconds / 3600, 2)
            threshold_hours = round(ALERT_STALE_SECONDS / 3600, 2)
            message = (
                f"[yHelper] ingestion recovered\n"
                f"job={job_name}\n"
                f"age_hours={age_hours}\n"
                f"threshold_hours={threshold_hours}\n"
                f"last_success_at={last_success_at.isoformat() if last_success_at else 'n/a'}"
            )
            notify_result = _send_notifications(message)
            if notify_result.get("delivered"):
                last_notified_at = now
            last_recovered_at = now

    configured_channels: list[str] = []
    if ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID:
        configured_channels.append("telegram")
    if ALERT_DISCORD_WEBHOOK_URL:
        configured_channels.append("discord")

    _upsert_alert_state(
        conn,
        alert_key=alert_key,
        job_name=job_name,
        status=status,
        threshold_seconds=ALERT_STALE_SECONDS,
        current_age_seconds=age_seconds,
        last_success_at=last_success_at,
        last_fired_at=last_fired_at,
        last_recovered_at=last_recovered_at,
        last_notified_at=last_notified_at,
        notify_channels=configured_channels,
        notify_result=notify_result,
    )

    if message:
        logging.info(
            "Alert notify attempted for %s: delivered=%s errors=%s",
            alert_key,
            len(notify_result.get("delivered", [])),
            len(notify_result.get("errors", [])),
        )


def _prune_obsolete_alert_state(conn: psycopg.Connection, *, active_job_names: tuple[str, ...]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM alert_state
            WHERE alert_key LIKE 'ingestion_stale:%%'
              AND NOT (job_name = ANY(%s))
            """,
            (list(active_job_names),),
        )
        deleted = cur.rowcount or 0
    if deleted:
        conn.commit()
    return int(deleted)


def _evaluate_alerts(conn: psycopg.Connection) -> None:
    active_job_names = (JOB_KONG_SNAPSHOT, JOB_KONG_PPS, JOB_PRODUCT_DAU)
    _evaluate_job_stale_alert(conn, job_name=JOB_KONG_SNAPSHOT)
    _evaluate_job_stale_alert(conn, job_name=JOB_KONG_PPS)
    _evaluate_job_stale_alert(conn, job_name=JOB_PRODUCT_DAU)
    deleted = _prune_obsolete_alert_state(conn, active_job_names=active_job_names)
    if deleted:
        logging.info("Pruned %s obsolete alert_state rows", deleted)
