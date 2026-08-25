from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal

import psycopg
from psycopg.rows import dict_row

from app.config import DATABASE_URL

WAD = Decimal(10**18)
FLEX_CHAIN_ID = 1
FLEX_STALE_AFTER_SECONDS = 2 * 60 * 60
RATE_SCALE_FALLBACK = Decimal(10**6)


@contextmanager
def _read_cursor() -> Iterator[psycopg.Cursor]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn, conn.cursor() as cur:
        yield cur


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _decimal(value: object | None) -> Decimal:
    return Decimal(value or 0)


def _scaled(value: object | None, decimals: int) -> float:
    return float(_decimal(value) / Decimal(10**decimals))


def _usd(value: object | None) -> float:
    return _scaled(value, 18)


def _scope() -> dict[str, object]:
    return {"chain_id": 1, "network": "ethereum", "source": "ethereum_archive_rpc"}


def _redemption_priority_scope() -> dict[str, object]:
    return {"chain_id": 1, "network": "ethereum", "source": "flex_ui_api"}


def _age_seconds(value: datetime | None, now: datetime) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return max(0, int((now - value).total_seconds()))


def _floor_bucket(value: datetime, interval: Literal["hour", "day"]) -> datetime:
    if interval == "day":
        return value.replace(hour=0, minute=0, second=0, microsecond=0)
    return value.replace(minute=0, second=0, microsecond=0)


def _coverage_start_bucket(value: datetime, interval: Literal["hour", "day"]) -> datetime:
    floored = _floor_bucket(value, interval)
    if interval == "day" or value == floored:
        return floored
    return floored + timedelta(hours=1)


def _freshness(cur: psycopg.Cursor, now: datetime) -> dict[str, object]:
    cur.execute(
        """
        WITH latest AS (
            SELECT DISTINCT ON (market_address)
                market_address, block_number, block_time
            FROM flex_market_snapshots
            WHERE chain_id = 1
            ORDER BY market_address, sampled_hour DESC
        )
        SELECT
            COUNT(*) AS snapshot_markets,
            (SELECT COUNT(*) FROM flex_market_dim WHERE chain_id = 1) AS discovered_markets,
            MIN(block_time) AS indexed_through,
            MIN(block_number) AS block_number
        FROM latest
        """
    )
    row = cur.fetchone() or {}
    indexed_through = row.get("indexed_through")
    age = max(0, int((now - indexed_through).total_seconds())) if isinstance(indexed_through, datetime) else None
    discovered = int(row.get("discovered_markets") or 0)
    covered = int(row.get("snapshot_markets") or 0)
    if discovered == 0 or covered == 0:
        state = "unavailable"
    elif covered < discovered or age is None or age > FLEX_STALE_AFTER_SECONDS:
        state = "delayed"
    else:
        state = "ready"
    cur.execute(
        """
        SELECT checked_at, verdict
        FROM flex_reconciliations
        ORDER BY checked_at DESC, id DESC
        LIMIT 1
        """
    )
    reconciliation = cur.fetchone() or {}
    return {
        "data_state": state,
        "indexed_through": _iso(indexed_through),
        "age_seconds": age,
        "stale_after_seconds": FLEX_STALE_AFTER_SECONDS,
        "block_number": int(row["block_number"]) if row.get("block_number") is not None else None,
        "reconciliation_verdict": reconciliation.get("verdict"),
        "reconciliation_checked_at": _iso(reconciliation.get("checked_at")),
    }


MARKET_SELECT = """
    SELECT
        d.*,
        COALESCE(d.raw_metadata->>'label', d.collateral_token_symbol || '/' || d.borrow_token_symbol) AS label,
        s.sampled_hour,
        s.block_number AS latest_block_number,
        s.block_time AS latest_block_time,
        s.collateral_raw,
        s.debt_raw,
        s.deposits_raw,
        s.idle_liquidity_raw,
        s.collateral_usd_e18,
        s.debt_usd_e18,
        s.deposits_usd_e18,
        s.idle_liquidity_usd_e18,
        s.utilization_wad,
        s.lender_apr_wad,
        s.avg_borrow_rate_raw,
        s.collateral_price_in_borrow_wad,
        s.borrow_usd_price_raw,
        s.borrow_usd_price_decimals
    FROM flex_market_dim d
    LEFT JOIN LATERAL (
        SELECT *
        FROM flex_market_snapshots snapshot
        WHERE snapshot.chain_id = d.chain_id
          AND snapshot.market_address = d.market_address
        ORDER BY snapshot.sampled_hour DESC
        LIMIT 1
    ) s ON TRUE
"""


def _market_response(row: dict[str, object]) -> dict[str, object]:
    collateral_decimals = int(row["collateral_token_decimals"])
    borrow_decimals = int(row["borrow_token_decimals"])
    has_metrics = row.get("latest_block_number") is not None
    metrics = None
    if has_metrics:
        metrics = {
            "collateral_raw": str(row["collateral_raw"]),
            "collateral": _scaled(row["collateral_raw"], collateral_decimals),
            "collateral_usd": _usd(row["collateral_usd_e18"]),
            "debt_raw": str(row["debt_raw"]),
            "debt": _scaled(row["debt_raw"], borrow_decimals),
            "debt_usd": _usd(row["debt_usd_e18"]),
            "deposits_raw": str(row["deposits_raw"]),
            "deposits": _scaled(row["deposits_raw"], borrow_decimals),
            "deposits_usd": _usd(row["deposits_usd_e18"]),
            "idle_liquidity_raw": str(row["idle_liquidity_raw"]),
            "idle_liquidity": _scaled(row["idle_liquidity_raw"], borrow_decimals),
            "idle_liquidity_usd": _usd(row["idle_liquidity_usd_e18"]),
            "utilization": float(_decimal(row["utilization_wad"]) / WAD),
            "lender_apr": float(_decimal(row["lender_apr_wad"]) / WAD),
            "average_borrow_rate": float(
                _decimal(row["avg_borrow_rate_raw"])
                / (Decimal(row.get("one_pct_raw") or 10000) * Decimal(100))
            ),
        }
    return {
        "chain_id": 1,
        "label": str(row["label"]),
        "status": str(row["market_status"]),
        "endorsement_status": str(row["endorsement_status"]),
        "contract_version": str(row["contract_version"]),
        "deployment_block": int(row["deployment_block"]),
        "deployment_time": _iso(row["deployment_time"]),
        "collateral_token": {
            "address": str(row["collateral_token_address"]),
            "symbol": str(row["collateral_token_symbol"]),
            "decimals": collateral_decimals,
        },
        "borrow_token": {
            "address": str(row["borrow_token_address"]),
            "symbol": str(row["borrow_token_symbol"]),
            "decimals": borrow_decimals,
        },
        "addresses": {
            "market": str(row["market_address"]),
            "lender": str(row["lender_address"]),
            "collateral_token": str(row["collateral_token_address"]),
            "borrow_token": str(row["borrow_token_address"]),
            "price_oracle": str(row["price_oracle_address"]),
            "auction": str(row["auction_address"]),
        },
        "metrics": metrics,
        "latest_block_number": int(row["latest_block_number"]) if row.get("latest_block_number") else None,
        "latest_block_time": _iso(row.get("latest_block_time")),
    }


def _summary(rows: list[dict[str, object]]) -> dict[str, object]:
    counts = {"total": len(rows), "active": 0, "deprecated": 0, "unendorsed": 0}
    for row in rows:
        status = str(row["market_status"])
        if status in counts:
            counts[status] += 1
    collateral = sum((_decimal(row.get("collateral_usd_e18")) for row in rows), Decimal(0))
    debt = sum((_decimal(row.get("debt_usd_e18")) for row in rows), Decimal(0))
    deposits = sum((_decimal(row.get("deposits_usd_e18")) for row in rows), Decimal(0))
    idle = sum((_decimal(row.get("idle_liquidity_usd_e18")) for row in rows), Decimal(0))
    weighted_lender = sum(
        (_decimal(row.get("lender_apr_wad")) * _decimal(row.get("deposits_usd_e18")) for row in rows),
        Decimal(0),
    )
    weighted_borrow = sum(
        (
            _decimal(row.get("avg_borrow_rate_raw"))
            / (Decimal(row.get("one_pct_raw") or 10000) * Decimal(100))
            * _decimal(row.get("debt_usd_e18"))
            for row in rows
        ),
        Decimal(0),
    )
    return {
        "markets": counts,
        "collateral_usd": float(collateral / WAD),
        "debt_usd": float(debt / WAD),
        "deposits_usd": float(deposits / WAD),
        "idle_liquidity_usd": float(idle / WAD),
        "utilization": float(debt / deposits) if deposits else None,
        "weighted_lender_apr": float(weighted_lender / deposits / WAD) if deposits else None,
        "weighted_average_borrow_rate": float(weighted_borrow / debt) if debt else None,
    }


def flex_markets_response(
    *, status: Literal["all", "active", "deprecated", "unendorsed"] = "all"
) -> dict[str, object]:
    now = datetime.now(UTC)
    with _read_cursor() as cur:
            conditions = ["d.chain_id = 1"]
            params: dict[str, object] = {}
            if status != "all":
                conditions.append("d.market_status = %(status)s")
                params["status"] = status
            cur.execute(
                MARKET_SELECT
                + " WHERE "
                + " AND ".join(conditions)
                + " ORDER BY CASE d.market_status WHEN 'active' THEN 0 WHEN 'deprecated' THEN 1 ELSE 2 END, "
                "COALESCE(s.deposits_usd_e18, 0) DESC, d.deployment_block DESC",
                params,
            )
            rows = list(cur.fetchall())
            freshness = _freshness(cur, now)
    return {
        "scope": _scope(),
        "filters": {"status": status},
        "freshness": freshness,
        "summary": _summary(rows),
        "rows": [_market_response(row) for row in rows],
    }


def flex_protocol_response() -> dict[str, object]:
    response = flex_markets_response(status="all")
    return {"scope": response["scope"], "freshness": response["freshness"], "summary": response["summary"]}


def flex_market_detail_response(market_address: str) -> dict[str, object] | None:
    now = datetime.now(UTC)
    with _read_cursor() as cur:
            cur.execute(
                MARKET_SELECT + " WHERE d.chain_id = 1 AND d.market_address = %(market_address)s",
                {"market_address": market_address},
            )
            row = cur.fetchone()
            if not row:
                return None
            freshness = _freshness(cur, now)
    one_pct = _decimal(row.get("one_pct_raw")) or Decimal(10000)
    hundred_pct = one_pct * Decimal(100)
    minimum_cr = _decimal(row.get("minimum_collateral_ratio_raw"))
    safe_cr = _decimal(row.get("safe_collateral_ratio_raw"))
    max_penalty_cr = _decimal(row.get("max_penalty_collateral_ratio_raw"))
    borrow_decimals = int(row["borrow_token_decimals"])
    oracle_price = (
        float(_decimal(row["collateral_price_in_borrow_wad"]) / WAD)
        if row.get("collateral_price_in_borrow_wad") is not None
        else None
    )
    borrow_price = (
        _scaled(row["borrow_usd_price_raw"], int(row["borrow_usd_price_decimals"]))
        if row.get("borrow_usd_price_raw") is not None
        else None
    )
    return {
        "scope": _scope(),
        "freshness": freshness,
        "market": _market_response(row),
        "risk": {
            "minimum_debt_raw": str(row["min_debt_raw"]) if row.get("min_debt_raw") is not None else None,
            "minimum_debt": _scaled(row["min_debt_raw"], borrow_decimals) if row.get("min_debt_raw") else None,
            "safe_ltv": float(hundred_pct / safe_cr) if safe_cr else None,
            "maximum_ltv": float(hundred_pct / minimum_cr) if minimum_cr else None,
            "maximum_penalty_ltv": float(hundred_pct / max_penalty_cr) if max_penalty_cr else None,
            "minimum_liquidation_fee": float(_decimal(row.get("min_liquidation_fee_raw")) / hundred_pct),
            "maximum_liquidation_fee": float(_decimal(row.get("max_liquidation_fee_raw")) / hundred_pct),
            "minimum_annual_interest_rate": float(
                _decimal(row.get("min_annual_interest_rate_raw")) / hundred_pct
            ),
            "maximum_annual_interest_rate": float(
                _decimal(row.get("max_annual_interest_rate_raw")) / hundred_pct
            ),
        },
        "oracle": {
            "address": str(row["price_oracle_address"]),
            "description": row.get("oracle_description"),
            "collateral_price_in_borrow_token": oracle_price,
            "borrow_token_usd_price": borrow_price,
        },
    }


def _redemption_priority_response(
    row: dict[str, object],
    *,
    now: datetime,
) -> dict[str, object]:
    decimals = int(row["borrow_token_decimals"])
    one_pct_raw = _decimal(row.get("one_pct_raw")) or Decimal(10000)
    annual_rate_scale = one_pct_raw * Decimal(100)
    source_block_time = row.get("source_block_time")
    fetched_at = row.get("fetched_at")
    attempted_at = row.get("attempted_at")
    source_age = _age_seconds(source_block_time if isinstance(source_block_time, datetime) else None, now)
    fetched_age = _age_seconds(fetched_at if isinstance(fetched_at, datetime) else None, now)
    last_error = str(row["last_error"]) if row.get("last_error") else None
    has_sample = (
        row.get("source_block_number") is not None
        and isinstance(source_block_time, datetime)
        and row.get("total_debt_raw") is not None
        and isinstance(fetched_at, datetime)
    )
    if not has_sample:
        data_state = "unavailable"
    elif (
        last_error is not None
        or source_age is None
        or source_age > FLEX_STALE_AFTER_SECONDS
        or fetched_age is None
        or fetched_age > FLEX_STALE_AFTER_SECONDS
    ):
        data_state = "delayed"
    else:
        data_state = "ready"
    raw_points = row.get("points")
    points: list[dict[str, object]] = []
    if has_sample and isinstance(raw_points, list):
        for point in raw_points:
            if not isinstance(point, dict):
                continue
            rate_raw = str(point.get("rate") or "")
            redeemable_before_raw = str(point.get("redeemable_before") or "")
            if not rate_raw.isascii() or not rate_raw.isdigit():
                continue
            if not redeemable_before_raw.isascii() or not redeemable_before_raw.isdigit():
                continue
            points.append(
                {
                    "annual_interest_rate_raw": rate_raw,
                    "annual_interest_rate": float(Decimal(rate_raw) / annual_rate_scale),
                    "redeemable_before_raw": redeemable_before_raw,
                    "redeemable_before": _scaled(redeemable_before_raw, decimals),
                }
            )
    total_debt_raw = str(row["total_debt_raw"]) if has_sample else None
    return {
        "scope": _redemption_priority_scope(),
        "market_address": str(row["market_address"]),
        "borrow_token": {
            "address": str(row["borrow_token_address"]),
            "symbol": str(row["borrow_token_symbol"]),
            "decimals": decimals,
        },
        "rate_scale": {
            "one_pct_raw": str(row.get("one_pct_raw") or 10000),
            "unit": "annual_decimal_ratio",
        },
        "total_debt_raw": total_debt_raw,
        "total_debt": _scaled(total_debt_raw, decimals) if total_debt_raw is not None else None,
        "points": points,
        "source_url": str(row["source_url"]) if row.get("source_url") else None,
        "freshness": {
            "data_state": data_state,
            "source_block_number": (
                int(row["source_block_number"]) if row.get("source_block_number") is not None else None
            ),
            "source_block_time": _iso(source_block_time if isinstance(source_block_time, datetime) else None),
            "source_age_seconds": source_age,
            "fetched_at": _iso(fetched_at if isinstance(fetched_at, datetime) else None),
            "fetched_age_seconds": fetched_age,
            "stale_after_seconds": FLEX_STALE_AFTER_SECONDS,
            "last_attempted_at": _iso(attempted_at if isinstance(attempted_at, datetime) else None),
            "last_error": last_error,
        },
    }


def flex_redemption_priority_response(market_address: str) -> dict[str, object] | None:
    with _read_cursor() as cur:
        cur.execute(
            """
            SELECT
                d.market_address,
                d.borrow_token_address,
                d.borrow_token_symbol,
                d.borrow_token_decimals,
                d.one_pct_raw,
                priority.source_block_number,
                priority.source_block_time,
                priority.total_debt_raw,
                priority.points,
                priority.source_url,
                priority.fetched_at,
                priority.attempted_at,
                priority.last_error
            FROM flex_market_dim d
            LEFT JOIN flex_redemption_priority_current priority
                ON priority.chain_id = d.chain_id
               AND priority.market_address = d.market_address
            WHERE d.chain_id = 1
              AND d.market_address = %s
            """,
            (market_address,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _redemption_priority_response(row, now=datetime.now(UTC))


def _trove_health_response(
    row: dict[str, object],
    *,
    now: datetime,
) -> dict[str, object]:
    source_block_time = row.get("source_block_time")
    fetched_at = row.get("fetched_at")
    attempted_at = row.get("attempted_at")
    source_age = _age_seconds(
        source_block_time if isinstance(source_block_time, datetime) else None,
        now,
    )
    fetched_age = _age_seconds(fetched_at if isinstance(fetched_at, datetime) else None, now)
    last_error = str(row["last_error"]) if row.get("last_error") else None
    has_sample = (
        row.get("source_block_number") is not None
        and isinstance(source_block_time, datetime)
        and row.get("active_troves") is not None
        and isinstance(fetched_at, datetime)
    )
    if not has_sample:
        data_state = "unavailable"
    elif (
        last_error is not None
        or source_age is None
        or source_age > FLEX_STALE_AFTER_SECONDS
        or fetched_age is None
        or fetched_age > FLEX_STALE_AFTER_SECONDS
    ):
        data_state = "delayed"
    else:
        data_state = "ready"

    collateral_decimals = int(row["collateral_token_decimals"])
    borrow_decimals = int(row["borrow_token_decimals"])
    metrics = None
    if has_sample:
        total_collateral_raw = str(row.get("total_collateral_raw") or "0")
        total_debt_raw = str(row.get("total_debt_raw") or "0")
        debt_near_max_raw = str(row.get("debt_near_max_raw") or "0")
        total_debt = _decimal(total_debt_raw)
        debt_near_max = _decimal(debt_near_max_raw)

        def _ratio(field: str) -> float | None:
            value = row.get(field)
            return float(_decimal(value) / WAD) if value is not None else None

        metrics = {
            "active_troves": int(row.get("active_troves") or 0),
            "total_collateral_raw": total_collateral_raw,
            "total_collateral": _scaled(total_collateral_raw, collateral_decimals),
            "total_debt_raw": total_debt_raw,
            "total_debt": _scaled(total_debt_raw, borrow_decimals),
            "median_ltv": _ratio("median_ltv_wad"),
            "maximum_position_ltv": _ratio("maximum_position_ltv_wad"),
            "minimum_buffer_to_max_ltv": _ratio("minimum_buffer_wad"),
            "near_max_threshold": 0.01,
            "near_max_troves": int(row.get("near_max_troves") or 0),
            "debt_near_max_raw": debt_near_max_raw,
            "debt_near_max": _scaled(debt_near_max_raw, borrow_decimals),
            "debt_near_max_share": float(debt_near_max / total_debt) if total_debt else None,
            "largest_debt_share": _ratio("largest_debt_share_wad"),
        }
    return {
        "scope": _redemption_priority_scope(),
        "market_address": str(row["market_address"]),
        "collateral_token": {
            "address": str(row["collateral_token_address"]),
            "symbol": str(row["collateral_token_symbol"]),
            "decimals": collateral_decimals,
        },
        "borrow_token": {
            "address": str(row["borrow_token_address"]),
            "symbol": str(row["borrow_token_symbol"]),
            "decimals": borrow_decimals,
        },
        "metrics": metrics,
        "freshness": {
            "data_state": data_state,
            "source_block_number": (
                int(row["source_block_number"]) if row.get("source_block_number") is not None else None
            ),
            "source_block_time": _iso(
                source_block_time if isinstance(source_block_time, datetime) else None
            ),
            "source_age_seconds": source_age,
            "fetched_at": _iso(fetched_at if isinstance(fetched_at, datetime) else None),
            "fetched_age_seconds": fetched_age,
            "stale_after_seconds": FLEX_STALE_AFTER_SECONDS,
            "last_attempted_at": _iso(
                attempted_at if isinstance(attempted_at, datetime) else None
            ),
            "last_error": last_error,
        },
    }


def flex_trove_health_response(market_address: str) -> dict[str, object] | None:
    with _read_cursor() as cur:
        cur.execute(
            """
            SELECT
                d.market_address,
                d.collateral_token_address,
                d.collateral_token_symbol,
                d.collateral_token_decimals,
                d.borrow_token_address,
                d.borrow_token_symbol,
                d.borrow_token_decimals,
                health.source_block_number,
                health.source_block_time,
                health.active_troves,
                health.total_collateral_raw,
                health.total_debt_raw,
                health.median_ltv_wad,
                health.maximum_position_ltv_wad,
                health.minimum_buffer_wad,
                health.near_max_troves,
                health.debt_near_max_raw,
                health.largest_debt_share_wad,
                health.fetched_at,
                health.attempted_at,
                health.last_error
            FROM flex_market_dim d
            LEFT JOIN flex_trove_health_current health
                ON health.chain_id = d.chain_id
               AND health.market_address = d.market_address
            WHERE d.chain_id = 1
              AND d.market_address = %s
            """,
            (market_address,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _trove_health_response(row, now=datetime.now(UTC))


def flex_market_history_response(
    market_address: str,
    *,
    days: Literal[7, 30, 90],
    interval: Literal["hour", "day"],
) -> dict[str, object] | None:
    now = datetime.now(UTC)
    requested_start = now - timedelta(days=days)
    with _read_cursor() as cur:
            cur.execute(
                "SELECT deployment_time FROM flex_market_dim WHERE chain_id = 1 AND market_address = %s",
                (market_address,),
            )
            market = cur.fetchone()
            if not market:
                return None
            bucket = "hour" if interval == "hour" else "day"
            cur.execute(
                f"""
                WITH ranked AS (
                    SELECT
                        date_trunc('{bucket}', sampled_hour) AS sampled_at,
                        block_number, block_time, collateral_usd_e18, debt_usd_e18,
                        deposits_usd_e18, idle_liquidity_usd_e18, utilization_wad,
                        lender_apr_wad, avg_borrow_rate_raw,
                        ROW_NUMBER() OVER (
                            PARTITION BY date_trunc('{bucket}', sampled_hour)
                            ORDER BY sampled_hour DESC
                        ) AS rank
                    FROM flex_market_snapshots
                    WHERE chain_id = 1
                      AND market_address = %s
                      AND sampled_hour >= %s
                )
                SELECT * FROM ranked WHERE rank = 1 ORDER BY sampled_at
                """,
                (market_address, requested_start),
            )
            rows = list(cur.fetchall())
            cur.execute("SELECT one_pct_raw FROM flex_market_dim WHERE chain_id = 1 AND market_address = %s", (market_address,))
            scale_row = cur.fetchone() or {}
            freshness = _freshness(cur, now)
    rate_scale = _decimal(scale_row.get("one_pct_raw")) * Decimal(100) or RATE_SCALE_FALLBACK
    points = [
        {
            "sampled_at": _iso(row["sampled_at"]),
            "block_number": int(row["block_number"]),
            "block_time": _iso(row["block_time"]),
            "collateral_usd": _usd(row["collateral_usd_e18"]),
            "debt_usd": _usd(row["debt_usd_e18"]),
            "deposits_usd": _usd(row["deposits_usd_e18"]),
            "idle_liquidity_usd": _usd(row["idle_liquidity_usd_e18"]),
            "utilization": float(_decimal(row["utilization_wad"]) / WAD),
            "lender_apr": float(_decimal(row["lender_apr_wad"]) / WAD),
            "average_borrow_rate": float(_decimal(row["avg_borrow_rate_raw"]) / rate_scale),
        }
        for row in rows
    ]
    coverage_start = _coverage_start_bucket(max(requested_start, market["deployment_time"]), interval)
    indexed_through = freshness.get("indexed_through")
    coverage_end_raw = datetime.fromisoformat(str(indexed_through)) if indexed_through else now
    coverage_end = _floor_bucket(min(now, coverage_end_raw), interval)
    interval_seconds = 3600 if interval == "hour" else 86400
    expected = max(0, int((coverage_end - coverage_start).total_seconds() // interval_seconds) + 1)
    return {
        "scope": _scope(),
        "market_address": market_address,
        "filters": {"days": days, "interval": interval},
        "freshness": freshness,
        "coverage": {
            "requested_start": _iso(requested_start),
            "first_point_at": points[0]["sampled_at"] if points else None,
            "latest_point_at": points[-1]["sampled_at"] if points else None,
            "points": len(points),
            "expected_points": expected,
            "coverage_ratio": min(1.0, len(points) / expected) if expected else 0.0,
        },
        "points": points,
    }


def _cursor(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    try:
        block, log_index = value.split(":", 1)
        parsed = int(block), int(log_index)
    except (ValueError, AttributeError):
        return None
    return parsed if parsed[0] >= 0 and parsed[1] >= 0 else None


def flex_activity_response(
    *,
    market_address: str | None,
    event: str | None,
    limit: int,
    cursor: str | None,
) -> dict[str, object]:
    now = datetime.now(UTC)
    conditions = ["e.chain_id = 1"]
    params: dict[str, object] = {"limit": limit + 1}
    if market_address:
        conditions.append("e.market_address = %(market_address)s")
        params["market_address"] = market_address
    if event:
        conditions.append("e.event_name = %(event)s")
        params["event"] = event
    parsed_cursor = _cursor(cursor)
    if parsed_cursor:
        conditions.append("(e.block_number, e.log_index) < (%(before_block)s, %(before_log)s)")
        params["before_block"], params["before_log"] = parsed_cursor
    with _read_cursor() as cur:
            cur.execute(
                """
                SELECT
                    e.*, COALESCE(d.raw_metadata->>'label', d.collateral_token_symbol || '/' || d.borrow_token_symbol)
                        AS market_label
                FROM flex_events e
                JOIN flex_market_dim d USING (chain_id, market_address)
                WHERE
                """
                + " AND ".join(conditions)
                + " ORDER BY e.block_number DESC, e.log_index DESC LIMIT %(limit)s",
                params,
            )
            rows = list(cur.fetchall())
            freshness = _freshness(cur, now)
    has_more = len(rows) > limit
    visible = rows[:limit]
    next_cursor = None
    if has_more and visible:
        next_cursor = f"{visible[-1]['block_number']}:{visible[-1]['log_index']}"
    return {
        "scope": _scope(),
        "filters": {"market_address": market_address, "event": event},
        "freshness": freshness,
        "pagination": {"limit": limit, "next_cursor": next_cursor},
        "rows": [
            {
                "chain_id": 1,
                "market_address": str(row["market_address"]),
                "market_label": str(row["market_label"]),
                "contract_version": str(row["contract_version"]),
                "block_number": int(row["block_number"]),
                "block_time": _iso(row["block_time"]),
                "tx_hash": str(row["tx_hash"]),
                "log_index": int(row["log_index"]),
                "event": str(row["event_name"]),
                "actors": row["actors"] if isinstance(row["actors"], dict) else {},
                "amounts": row["amounts"] if isinstance(row["amounts"], dict) else {},
            }
            for row in visible
        ],
    }
