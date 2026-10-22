"""Seasonal medians for the recap's "and everyone else" lines.

Samples recently active deposit owners from the yearn indexer, computes four cheap
aggregates per wallet (distinct vaults, distinct chains, deposit events, median hold
days), and writes data/medians.json. One snapshot per season: recap.py reads the
file and treats a missing one as "no median lines", never as a live computation,
and the deck never recomputes it.

Usage: uv run tools/medians.py [--sample 160] [--window-days 45] [--out data]
"""

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import pathlib
import statistics
import sys
import time

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import recap  # noqa: E402  (fetch_events, post, CHAIN_NAMES, ENTITY_FIELDS, PAGE)

# Exclude a wallet if any stream reaches the batch pagination cap.
MAX_PAGES = 6


def sample_owners(client: httpx.Client, window_start: int, want: int) -> list[str]:
    """Distinct checksummed owners with a deposit in the window, newest first.

    Deterministic in the indexer's own ordering, so a rerun with the same head
    block yields the same sample and the same medians.
    """
    chains = ", ".join(str(c) for c in sorted(recap.CHAIN_NAMES))
    owners: list[str] = []
    offset = 0
    page_size = 500
    while len(owners) < want:
        q = {
            "query": (
                f"{{ page: Deposit(where: {{chainId: {{_in: [{chains}]}}, "
                f"blockTimestamp: {{_gte: {window_start}}}}}, "
                f"limit: {page_size}, offset: {offset}, "
                f"order_by: {{blockTimestamp: desc}}) {{ owner }} }}"
            )
        }
        page = recap.post(client, q)["page"]
        if not page:
            break
        for row in page:
            owner = row.get("owner")
            if owner and owner.lower() not in {o.lower() for o in owners}:
                owners.append(owner)
                if len(owners) >= want:
                    break
        offset += page_size
        if offset > 10_000:
            break
        time.sleep(0.15)
    return owners


def wallet_stats(client, address, now):
    year = dt.datetime.fromtimestamp(now, dt.timezone.utc).year
    start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    deposits = recap.fetch_events(
        client, "Deposit", "owner", address, max_pages=MAX_PAGES
    )
    incoming = recap.fetch_events(
        client, "Transfer", "receiver", address, max_pages=MAX_PAGES
    )
    outgoing = recap.fetch_events(
        client, "Transfer", "sender", address, max_pages=MAX_PAGES
    )
    _, timelines = recap.positions.timelines(incoming, outgoing, start, now)
    deposits = [d for d in deposits if start <= d["blockTimestamp"] <= now]
    vaults = set(timelines) | {recap.positions.key(d) for d in deposits}
    if not vaults:
        return None
    holding = recap.holding_spans(timelines, now)["medianHoldSeconds"]
    return {
        "vaults": len(vaults),
        "chains": len({v.split(":")[0] for v in vaults}),
        "deposits": len(deposits),
        "holdDays": holding / 86400 if holding is not None else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=160)
    ap.add_argument("--window-days", type=int, default=45)
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    now = int(time.time())
    window_start = now - args.window_days * 86_400
    with httpx.Client() as client:
        owners = sample_owners(client, window_start, args.sample)
        print(f"sampling {len(owners)} wallets", flush=True)
        rows, skipped, done = [], 0, 0

        def run(address):
            try:
                return wallet_stats(client, address, now)
            except recap.UpstreamError:
                return None

        with cf.ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(run, a): a for a in owners}
            for fut in cf.as_completed(futures):
                stats = fut.result()
                done += 1
                if stats:
                    rows.append(stats)
                else:
                    skipped += 1
                if done % 20 == 0:
                    print(f"{done}/{len(owners)}", flush=True)

    if not rows:
        raise SystemExit("no wallets sampled; nothing to write")
    med = lambda col: statistics.median([r[col] for r in rows if r[col] is not None])  # noqa: E731
    out = {
        "n": len(rows),
        "year": dt.datetime.fromtimestamp(now, dt.timezone.utc).year,
        "ledgerVersion": 2,
        "windowDays": args.window_days,
        "excludedWallets": skipped,
        "sampledAt": dt.datetime.fromtimestamp(now, dt.timezone.utc).date().isoformat(),
        "source": "yearn indexer; recent depositors, annual transfer ledger; capped wallets excluded",
        "vaults": round(med("vaults")),
        "chains": round(med("chains")),
        "deposits": round(med("deposits")),
        "holdDays": round(med("holdDays"))
        if any(r["holdDays"] is not None for r in rows)
        else None,
    }
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "medians.json"
    path.write_text(json.dumps(out, indent=1))
    print(f"saved {path} (n={out['n']}, skipped={skipped})")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
