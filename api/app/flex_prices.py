from __future__ import annotations

import time

from fastapi import HTTPException

from app.flex_performance import Archive, CoverageError
from app.flex_service import CURVE_PEG_POOLS, _iso, _read_cursor


def flex_market_peg_response(market_address: str) -> dict[str, object] | None:
    with _read_cursor() as cur:
        cur.execute(
            """SELECT d.collateral_token_address, d.borrow_token_address, s.block_number, s.block_hash, s.block_time
               FROM flex_market_dim d
               LEFT JOIN LATERAL (
                   SELECT block_number, block_hash, block_time FROM flex_market_snapshots
                   WHERE chain_id = d.chain_id AND market_address = d.market_address
                   ORDER BY sampled_hour DESC LIMIT 1
               ) s ON TRUE
               WHERE d.chain_id = 1 AND d.market_address = %s""",
            (market_address,),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Flex market not found")
    pool = CURVE_PEG_POOLS.get((row["collateral_token_address"], row["borrow_token_address"]))
    if pool is None or row["block_number"] is None:
        return None

    asset, address, index = pool
    block = int(row["block_number"])
    try:
        archive = Archive()
        archive.deadline = time.monotonic() + 8
        archive.bind(block, row["block_hash"])
        # get_dy(int128,int128,uint256) on one 18-decimal token, quoted in six-decimal USDC.
        quote = archive.uint(address, block, "curve_get_dy", f"{index:064x}{1 - index:064x}{10**18:064x}")
        if quote <= 0:
            raise CoverageError("Pool quote is unavailable.")
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(503, "Curve quote is temporarily unavailable.") from exc
    return {
        "asset_symbol": asset,
        "usdc_per_token": quote / 10**6,
        "pool_address": address,
        "block_number": block,
        "block_time": _iso(row["block_time"]),
    }
