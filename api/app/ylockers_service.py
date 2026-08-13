from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row

from app.config import DATABASE_URL, YLOCKER_PRODUCTS, YLOCKER_REWARD_TOKEN

WEEK_SECONDS = 7 * 24 * 60 * 60
FRESHNESS_SECONDS = 45 * 60
THURSDAY_ANCHOR = datetime(1970, 1, 1, tzinfo=UTC)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _state_rows(cur: psycopg.Cursor, products: list[str]) -> dict[str, dict[str, object]]:
    cur.execute(
        """
        SELECT product, chain_id, distributor_address, cursor, observed_at, payload, updated_at
        FROM ylocker_reward_sync_state
        WHERE product = ANY(%s)
        """,
        (products,),
    )
    return {str(row["product"]): row for row in cur.fetchall()}


def _event_rows(
    cur: psycopg.Cursor,
    *,
    products: list[str],
    earliest_cycle_start: datetime | None,
) -> list[dict[str, object]]:
    if earliest_cycle_start is None:
        return []
    cur.execute(
        """
        SELECT
            product, distributor_address, block_number, block_time, tx_hash, log_index,
            native_week, cycle_start, cycle_end, depositor_address, reward_shares_raw,
            pps_raw, reward_assets_raw
        FROM ylocker_reward_events
        WHERE product = ANY(%s)
          AND is_official = TRUE
          AND block_time >= %s
        ORDER BY block_time DESC, log_index DESC
        """,
        (products, earliest_cycle_start),
    )
    return list(cur.fetchall())


def _cycle_bounds(start_time: int, week: int) -> tuple[datetime, datetime]:
    start = datetime.fromtimestamp(start_time + week * WEEK_SECONDS, UTC)
    return start, start + timedelta(seconds=WEEK_SECONDS)


def _scaled(raw: int | Decimal, decimals: int) -> float:
    return float(Decimal(raw) / Decimal(10**decimals))


def _build_response(
    cur: psycopg.Cursor,
    *,
    product_filter: str,
    limit: int,
    include_events: bool,
    now: datetime,
) -> dict[str, object]:
    products = list(YLOCKER_PRODUCTS) if product_filter == "all" else [product_filter]
    states = _state_rows(cur, products)
    state_meta: dict[str, dict[str, object]] = {}
    earliest_start: datetime | None = None
    completed_weeks: dict[str, list[int]] = {}
    current_cycles: list[dict[str, object]] = []

    for product in products:
        state = states.get(product)
        payload = state.get("payload") if state else None
        payload = payload if isinstance(payload, dict) else {}
        start_time_raw = payload.get("start_time")
        observed_at = state.get("observed_at") if state else None
        start_time = int(start_time_raw) if isinstance(start_time_raw, int) else None
        if start_time is None or not isinstance(observed_at, datetime):
            completed_weeks[product] = []
            state_meta[product] = {"start_time": start_time, "observed_at": observed_at}
            continue
        current_week = max(0, int((observed_at.timestamp() - start_time) // WEEK_SECONDS))
        weeks = list(range(max(-1, current_week - 1), max(-1, current_week - limit - 1), -1))
        completed_weeks[product] = weeks
        current_start, current_end = _cycle_bounds(start_time, current_week)
        if weeks:
            cycle_start, _ = _cycle_bounds(start_time, weeks[-1])
            earliest_start = cycle_start if earliest_start is None else min(earliest_start, cycle_start)
        state_meta[product] = {
            "start_time": start_time,
            "observed_at": observed_at,
            "current_week": current_week,
        }

    calendar_earliest = THURSDAY_ANCHOR + timedelta(
        seconds=(int(now.timestamp()) // WEEK_SECONDS - limit - 1) * WEEK_SECONDS
    )
    query_start = calendar_earliest if earliest_start is None else min(calendar_earliest, earliest_start)
    events = _event_rows(cur, products=products, earliest_cycle_start=query_start)

    cycle_events: dict[tuple[str, int], list[dict[str, object]]] = {}
    calendar_events: dict[int, list[dict[str, object]]] = {}
    for event in events:
        product = str(event["product"])
        native_week = int(event["native_week"])
        cycle_events.setdefault((product, native_week), []).append(event)
        calendar_week = int(event["block_time"].timestamp()) // WEEK_SECONDS
        calendar_events.setdefault(calendar_week, []).append(event)

    for product in products:
        meta = state_meta.get(product, {})
        current_week = meta.get("current_week")
        start_time = meta.get("start_time")
        if not isinstance(current_week, int) or not isinstance(start_time, int):
            continue
        current_start, current_end = _cycle_bounds(start_time, current_week)
        rows = cycle_events.get((product, current_week), [])
        shares_raw = sum((Decimal(row["reward_shares_raw"]) for row in rows), Decimal(0))
        assets_raw = sum((Decimal(row["reward_assets_raw"]) for row in rows), Decimal(0))
        current_cycles.append(
            {
                "product": product,
                "product_label": YLOCKER_PRODUCTS[product]["label"],
                "native_week": current_week,
                "cycle_start": _iso(current_start),
                "cycle_end": _iso(current_end),
                "status": "current",
                "event_count": len(rows),
                "reward_shares_raw": str(shares_raw),
                "reward_shares": _scaled(shares_raw, int(YLOCKER_REWARD_TOKEN["decimals"])),
                "value_crvusd_raw": str(assets_raw),
                "value_crvusd_at_deposit": _scaled(
                    assets_raw, int(YLOCKER_REWARD_TOKEN["asset_decimals"])
                ),
            }
        )

    cycles: list[dict[str, object]] = []
    for product in products:
        for week in completed_weeks.get(product, []):
            meta = state_meta[product]
            cycle_start, cycle_end = _cycle_bounds(int(meta["start_time"]), week)
            if cycle_end > now:
                continue
            rows = cycle_events.get((product, week), [])
            shares_raw = sum((Decimal(row["reward_shares_raw"]) for row in rows), Decimal(0))
            assets_raw = sum((Decimal(row["reward_assets_raw"]) for row in rows), Decimal(0))
            cycles.append(
                {
                    "product": product,
                    "product_label": YLOCKER_PRODUCTS[product]["label"],
                    "native_week": week,
                    "cycle_start": _iso(cycle_start),
                    "cycle_end": _iso(cycle_end),
                    "status": "finalized",
                    "event_count": len(rows),
                    "reward_shares_raw": str(shares_raw),
                    "reward_shares": _scaled(shares_raw, int(YLOCKER_REWARD_TOKEN["decimals"])),
                    "value_crvusd_raw": str(assets_raw),
                    "value_crvusd_at_deposit": _scaled(
                        assets_raw, int(YLOCKER_REWARD_TOKEN["asset_decimals"])
                    ),
                    "events": [
                        {
                            "block_number": int(row["block_number"]),
                            "block_time": _iso(row["block_time"]),
                            "tx_hash": row["tx_hash"],
                            "log_index": int(row["log_index"]),
                            "depositor_address": row["depositor_address"],
                            "reward_shares_raw": str(row["reward_shares_raw"]),
                            "reward_shares": _scaled(
                                row["reward_shares_raw"], int(YLOCKER_REWARD_TOKEN["decimals"])
                            ),
                            "pps_raw": str(row["pps_raw"]),
                            "pps_at_deposit": _scaled(row["pps_raw"], int(YLOCKER_REWARD_TOKEN["decimals"])),
                            "value_crvusd_raw": str(row["reward_assets_raw"]),
                            "value_crvusd_at_deposit": _scaled(
                                row["reward_assets_raw"], int(YLOCKER_REWARD_TOKEN["asset_decimals"])
                            ),
                        }
                        for row in rows
                    ]
                    if include_events
                    else [],
                }
            )
    cycles.sort(key=lambda row: (str(row["cycle_end"]), str(row["product"])), reverse=True)

    observed_values = [
        state_meta[product].get("observed_at")
        for product in products
        if isinstance(state_meta.get(product, {}).get("observed_at"), datetime)
    ]
    indexed_through = min(observed_values) if len(observed_values) == len(products) else None
    latest_calendar_week = int(indexed_through.timestamp()) // WEEK_SECONDS - 1 if indexed_through else None
    reporting_weeks: list[dict[str, object]] = []
    if latest_calendar_week is not None:
        for week in range(latest_calendar_week, latest_calendar_week - limit, -1):
            start = THURSDAY_ANCHOR + timedelta(seconds=week * WEEK_SECONDS)
            end = start + timedelta(seconds=WEEK_SECONDS)
            rows = calendar_events.get(week, [])
            values = {product: Decimal(0) for product in products}
            counts = {product: 0 for product in products}
            for row in rows:
                event_product = str(row["product"])
                values[event_product] += Decimal(row["reward_assets_raw"])
                counts[event_product] += 1
            digest_ready_at = end
            finalized = indexed_through is not None and indexed_through >= end
            products_healthy = all(
                str((states.get(product, {}).get("payload") or {}).get("status")) in {"success", "up_to_date"}
                for product in products
            )
            ready_for_digest = (
                finalized
                and products_healthy
                and (now - indexed_through).total_seconds() <= FRESHNESS_SECONDS
            )
            reporting_weeks.append(
                {
                    "calendar_week": week,
                    "week_start": _iso(start),
                    "week_end": _iso(end),
                    "status": "finalized" if finalized else "awaiting_product_cycles",
                    "digest_ready_at": _iso(digest_ready_at),
                    "ready_for_digest": ready_for_digest,
                    "total_crvusd_at_deposit": _scaled(
                        sum(values.values(), Decimal(0)), int(YLOCKER_REWARD_TOKEN["asset_decimals"])
                    ),
                    "products": [
                        {
                            "product": product,
                            "product_label": YLOCKER_PRODUCTS[product]["label"],
                            "event_count": counts[product],
                            "value_crvusd_at_deposit": _scaled(
                                values[product], int(YLOCKER_REWARD_TOKEN["asset_decimals"])
                            ),
                        }
                        for product in products
                    ],
                }
            )

    freshness_rows: list[dict[str, object]] = []
    for product in products:
        state = states.get(product)
        observed_at = state.get("observed_at") if state else None
        payload = state.get("payload") if state else None
        payload = payload if isinstance(payload, dict) else {}
        age_seconds = max(0, int((now - observed_at).total_seconds())) if isinstance(observed_at, datetime) else None
        freshness_rows.append(
            {
                "product": product,
                "product_label": YLOCKER_PRODUCTS[product]["label"],
                "indexed_through_block": int(state["cursor"]) if state and state.get("cursor") is not None else None,
                "indexed_through": _iso(observed_at if isinstance(observed_at, datetime) else None),
                "age_seconds": age_seconds,
                "status": str(payload.get("status") or "unavailable"),
            }
        )
    stale_after = FRESHNESS_SECONDS
    indexed_age = max(0, int((now - indexed_through).total_seconds())) if indexed_through else None
    products_healthy = all(row["status"] in {"success", "up_to_date"} for row in freshness_rows)
    status = (
        "unavailable"
        if indexed_age is None
        else ("fresh" if indexed_age <= stale_after and products_healthy else "delayed")
    )
    return {
        "filters": {"product": product_filter, "limit": limit, "include_events": include_events},
        "scope": {
            "chain_id": 1,
            "products": products,
            "official_deposits_only": True,
            "reward_token": YLOCKER_REWARD_TOKEN,
            "reporting_week": {"anchor": "thursday_00_utc", "seconds": WEEK_SECONDS},
        },
        "freshness": {
            "status": status,
            "indexed_through": _iso(indexed_through),
            "age_seconds": indexed_age,
            "stale_after_seconds": stale_after,
            "products": freshness_rows,
        },
        "current_cycles": current_cycles,
        "cycles": cycles,
        "reporting_weeks": reporting_weeks,
    }


def ylocker_rewards_response(
    *,
    product: str,
    limit: int,
    include_events: bool,
    now: datetime | None = None,
) -> dict[str, object]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            return _build_response(
                cur,
                product_filter=product,
                limit=limit,
                include_events=include_events,
                now=now or datetime.now(UTC),
            )


def ylocker_reward_cycle_response(*, product: str, native_week: int) -> tuple[str, dict[str, object] | None]:
    response = ylocker_rewards_response(
        product=product,
        limit=52,
        include_events=True,
    )
    product_freshness = next(
        row for row in response["freshness"]["products"] if row["product"] == product
    )
    if product_freshness["indexed_through_block"] is None:
        return "unavailable", None
    cycle = next(
        (row for row in response["cycles"] if int(row["native_week"]) == native_week),
        None,
    )
    if cycle is None:
        pending = any(
            int(row["native_week"]) == native_week for row in response["current_cycles"]
        )
        return ("pending" if pending else "missing"), None
    return "finalized", {
        "reward_token": response["scope"]["reward_token"],
        "freshness": product_freshness,
        "cycle": cycle,
    }
