"""Repair Flex USD history from each snapshot's historical borrow-asset feed.

Run with --output PATH to review and save original rows. Add --apply to commit.
Only derived USD fields and price provenance change; token balances stay intact.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .config import FLEX_BORROW_USD_FEEDS, FLEX_USDC_USD_FEED
from .eth import _connect
from .flex import WAD, _borrow_prices, _usd_e18


def repair(conn: psycopg.Connection, output: Path, *, apply: bool = False) -> dict:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            SELECT s.*, d.borrow_token_address, d.borrow_token_decimals, d.collateral_token_decimals
            FROM flex_market_snapshots s JOIN flex_market_dim d USING (chain_id, market_address)
            WHERE s.chain_id = 1
            ORDER BY s.block_number, s.market_address
        """)
        rows = [
            row
            for row in cur.fetchall()
            if FLEX_BORROW_USD_FEEDS.get(row["borrow_token_address"])
            != FLEX_USDC_USD_FEED
            and (
                row["borrow_token_address"] not in FLEX_BORROW_USD_FEEDS
                or row["borrow_usd_feed_address"]
                != FLEX_BORROW_USD_FEEDS[row["borrow_token_address"]]
            )
        ]
    report = {"applied": False, "rows": len(rows), "before": rows, "after": []}
    output.parent.mkdir(parents=True, exist_ok=True)
    # Persist the original values before network calls or writes. Never overwrite an existing backup.
    backup = output.with_suffix(".before.json")
    if rows:
        with backup.open("x") as handle:
            json.dump(rows, handle, default=str, indent=2)
    grouped = defaultdict(list)
    for row in rows:
        if row["borrow_token_address"] not in FLEX_BORROW_USD_FEEDS:
            raise ValueError(
                f"No USD feed configured for {row['borrow_token_address']}"
            )
        grouped[int(row["block_number"])].append(row)
    updates = []

    def fetch_prices(item):
        block, snapshots = item
        return block, _borrow_prices(snapshots, block)

    with ThreadPoolExecutor(max_workers=4) as pool:
        prices_by_block = dict(pool.map(fetch_prices, grouped.items()))
    for block, snapshots in grouped.items():
        prices = prices_by_block[block]
        for row in snapshots:
            token = row["borrow_token_address"]
            price, precision = prices[token]
            decimals = int(row["borrow_token_decimals"])
            collateral_in_borrow = (
                int(row["collateral_raw"])
                * int(row["collateral_price_in_borrow_wad"])
                * 10**decimals
                // (10 ** int(row["collateral_token_decimals"]) * WAD)
            )
            update = {
                "chain_id": row["chain_id"],
                "market_address": row["market_address"],
                "sampled_hour": row["sampled_hour"],
                "price": price,
                "precision": precision,
                "feed": FLEX_BORROW_USD_FEEDS[token],
                "old_feed": row["borrow_usd_feed_address"],
                "old_block_number": row["block_number"],
                "old_collateral_raw": row["collateral_raw"],
                "old_debt_raw": row["debt_raw"],
                "old_deposits_raw": row["deposits_raw"],
                "old_idle_raw": row["idle_liquidity_raw"],
                "old_oracle_price": row["collateral_price_in_borrow_wad"],
            }
            for name, raw in (
                ("collateral", collateral_in_borrow),
                ("debt", row["debt_raw"]),
                ("deposits", row["deposits_raw"]),
                ("idle_liquidity", row["idle_liquidity_raw"]),
            ):
                update[f"{name}_usd_e18"] = _usd_e18(
                    int(raw), decimals, price, precision
                )
            updates.append(update)
    report["after"] = updates
    output.write_text(json.dumps(report, default=str, indent=2) + "\n")
    if apply:
        with conn.cursor() as cur:
            for update in updates:
                cur.execute(
                    """
                    UPDATE flex_market_snapshots SET
                        borrow_usd_price_raw = %(price)s, borrow_usd_price_decimals = %(precision)s,
                        borrow_usd_feed_address = %(feed)s, collateral_usd_e18 = %(collateral_usd_e18)s,
                        debt_usd_e18 = %(debt_usd_e18)s, deposits_usd_e18 = %(deposits_usd_e18)s,
                        idle_liquidity_usd_e18 = %(idle_liquidity_usd_e18)s
                    WHERE chain_id = %(chain_id)s AND market_address = %(market_address)s
                      AND sampled_hour = %(sampled_hour)s
                      AND borrow_usd_feed_address IS NOT DISTINCT FROM %(old_feed)s
                      AND block_number = %(old_block_number)s
                      AND collateral_raw = %(old_collateral_raw)s AND debt_raw = %(old_debt_raw)s
                      AND deposits_raw = %(old_deposits_raw)s AND idle_liquidity_raw = %(old_idle_raw)s
                      AND collateral_price_in_borrow_wad = %(old_oracle_price)s
                """,
                    update,
                )
                if cur.rowcount != 1:
                    raise RuntimeError(
                        "Snapshot changed during repair; roll back and rerun"
                    )
        conn.commit()
        report["applied"] = True
        output.write_text(json.dumps(report, default=str, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with _connect() as conn:
        result = repair(conn, args.output, apply=args.apply)
    print(json.dumps({"rows": result["rows"], "applied": result["applied"]}))


if __name__ == "__main__":
    main()
