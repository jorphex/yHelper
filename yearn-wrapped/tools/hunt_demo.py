"""Hunt for a demo wallet that actually exercises the deck.

The first demo wallet was too clean to review against: one vault, one chain, no
exits, so several cards rendered almost empty. This scores candidates on how much of
the deck they light up, then, only for the best few, on size.

Two passes on purpose. The indexer is cheap and answers vault count, chain count,
event counts and the all-time first event. yearn.fi holdings history is slow enough
that paying for it on every candidate would make the hunt take an hour, so it runs
only on the shortlist.

Run: uv run python tools/hunt_demo.py [candidates] [shortlist]
"""

import sys

import httpx

from recap import CHAIN_NAMES, fetch_yearnfi, post

# The demo is hunted for the shipped period, so the window is stated here rather
# than imported (recap computes it from --year inside build_payload).
YEAR_START = 1_767_225_600  # 2026-01-01T00:00:00Z

CHAIN_LIST = "[" + ", ".join(str(c) for c in sorted(CHAIN_NAMES)) + "]"

# Earliest and latest events per entity: one request gives both tenure (the first
# event ever, not just this year's) and the vault/chain spread the deck needs. The
# indexer needs the chain guard, an under-cap limit and _ilike on its checksummed
# columns, all of which recap.fetch_events already knows.
EVENTS = """
{ da: Deposit(where: {%(where)s}, limit: 500, order_by: {blockTimestamp: asc, id: asc})
    { chainId vaultAddress blockTimestamp }
  dd: Deposit(where: {%(where)s}, limit: 500, order_by: {blockTimestamp: desc, id: desc})
    { chainId vaultAddress blockTimestamp }
  wa: Withdraw(where: {%(where)s}, limit: 500, order_by: {blockTimestamp: asc, id: asc})
    { chainId vaultAddress blockTimestamp }
  wd: Withdraw(where: {%(where)s}, limit: 500, order_by: {blockTimestamp: desc, id: desc})
    { chainId vaultAddress blockTimestamp } }
"""


def profile_events(client, addr):
    """Deck coverage from the indexer alone."""
    where = f'owner: {{_ilike: "{addr}"}}, chainId: {{_in: {CHAIN_LIST}}}'
    data = post(client, {"query": EVENTS % {"where": where}})
    # The asc and desc windows overlap for any wallet under 500 events per entity.
    seen, events = set(), []
    for key in ("da", "dd", "wa", "wd"):
        for e in data.get(key) or []:
            row = (key[0], e["chainId"], e["vaultAddress"].lower(), e["blockTimestamp"])
            if row in seen:
                continue
            seen.add(row)
            events.append({**e, "kind": "deposit" if key[0] == "d" else "withdraw"})
    if not events:
        return None
    first_ts = min(e["blockTimestamp"] for e in events)
    in_period = sum(1 for e in events if e["blockTimestamp"] >= YEAR_START)
    return {
        "address": addr,
        "vaults": len({(e["chainId"], e["vaultAddress"].lower()) for e in events}),
        "chains": len({e["chainId"] for e in events}),
        "deposits": sum(1 for e in events if e["kind"] == "deposit"),
        "withdrawals": sum(1 for e in events if e["kind"] == "withdraw"),
        "inPeriod": in_period,
        # Both windows full: the counts below are floors, not totals.
        "capped": len(events) >= 998,
        "veteran": first_ts < YEAR_START,
        "firstTs": first_ts,
        "peakUsd": None,
    }


def peak_usd(client, addr):
    """Biggest 2026 position in USD, from yearn.fi's own valuation. Slow, so it runs
    only on the shortlist; a wallet it cannot price is a bad flagship demo even when
    its activity is interesting."""
    hist = fetch_yearnfi(client, f"/api/holdings/history?address={addr}"
                                 f"&denomination=usd&timeframe=all", addr)
    vals = [p["value"] for p in (hist or {}).get("dataPoints", [])
            if p["date"] >= "2026-01-01"]
    return round(max(vals), 2) if vals else 0.0


def score(row):
    # Deck coverage first. A huge wallet parked in one vault makes a boring demo, and
    # an unpriced one loses every dollar card.
    return (min(row["vaults"], 8) * 4 + min(row["chains"], 4) * 5
            + min(row["inPeriod"], 60) + (10 if row["veteran"] else 0)
            + (12 if (row["peakUsd"] or 0) > 25_000
               else 6 if (row["peakUsd"] or 0) > 2_000 else 0))


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    shortlist = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    # Recent depositors on every indexed chain: multi-chain wallets are the ones that
    # exercise the deck.
    data = post(httpx.Client(), {"query": """
      { deposits: Deposit(limit: 900, order_by: {blockTimestamp: desc})
        { owner chainId } }
    """})
    owners, seen = [], set()
    for row in data["deposits"]:
        if row["owner"].lower() not in seen:
            seen.add(row["owner"].lower())
            owners.append(row["owner"])
    print(f"{len(owners)} distinct owners in the last 900 deposits", flush=True)

    rows = []
    with httpx.Client() as client:
        for addr in owners[:limit]:
            try:
                p = profile_events(client, addr)
            except Exception as exc:  # one bad wallet must not end the hunt
                print(f"  {addr[:10]} .. {type(exc).__name__}", flush=True)
                continue
            if not p or p["vaults"] < 3 or p["inPeriod"] < 6:
                continue
            rows.append(p)
            print(f"  {p['address']} vaults={p['vaults']} chains={p['chains']} "
                  f"in={p['inPeriod']}{'+' if p['capped'] else ''} "
                  f"veteran={p['veteran']}", flush=True)
        rows.sort(key=lambda r: -score(r))
        print(f"\n{len(rows)} candidates; pricing the top {shortlist}", flush=True)
        for r in rows[:shortlist]:
            try:
                r["peakUsd"] = peak_usd(client, r["address"])
            except Exception as exc:
                print(f"  {r['address'][:10]} .. price {type(exc).__name__}", flush=True)
            print(f"  {r['address']} vaults={r['vaults']} chains={r['chains']} "
                  f"in={r['inPeriod']} peak=${r['peakUsd']:,.0f} "
                  f"veteran={r['veteran']} score={score(r)}", flush=True)

    rows.sort(key=lambda r: -score(r))
    print("\nTOP:")
    for r in rows[:8]:
        peak = r["peakUsd"]
        print(f"  {score(r):>4}  {r['address']}  vaults={r['vaults']} "
              f"chains={r['chains']} in={r['inPeriod']} "
              f"peak={'?' if peak is None else f'${peak:,.0f}'} "
              f"veteran={r['veteran']}")


if __name__ == "__main__":
    main()
