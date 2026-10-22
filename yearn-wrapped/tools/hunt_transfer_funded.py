"""Find a transfer-funded wallet: received vault shares, never called deposit()."""

import httpx

from recap import ENTITY_FIELDS, PAGE, fetch_events, post

RECENT_MS = 1_760_000_000  # ~Oct 2025


def recent_transfers(client):
    where = '{chainId: {_in: [1]}, blockTimestamp: {_gte: %d}}' % RECENT_MS
    rows, offset = [], 0
    while offset < 3 * PAGE:
        q = {"query": (f'{{ page: Transfer(where: {where}, limit: {PAGE}, offset: {offset}, '
                       f'order_by: {{blockTimestamp: desc, id: desc}}) '
                       f'{{ {ENTITY_FIELDS["Transfer"]} }} }}')}
        page = post(client, q)["page"]
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def main():
    seen, tried = {}, 0
    with httpx.Client() as client:
        for t in recent_transfers(client):
            if t["sender"] == "0x0000000000000000000000000000000000000000":
                continue  # mint, not a peer transfer
            recv = t["receiver"]
            if recv in seen or int(t["value"]) <= 0:
                continue
            seen[recv] = t
            if tried >= 12:
                break
            tried += 1
            deposits = fetch_events(client, "Deposit", "owner", recv)
            ins = fetch_events(client, "Transfer", "receiver", recv)
            outs = fetch_events(client, "Transfer", "sender", recv)
            peers = [x for x in ins
                     if x["sender"] != "0x0000000000000000000000000000000000000000"]
            balance = sum(int(x["value"]) for x in ins) - sum(int(x["value"]) for x in outs)
            print(f"{recv[:14]}… deposits={len(deposits)} peer_in={len(peers)} "
                  f"out={len(outs)} net_shares={balance/1e18:.4f} vaults="
                  f"{len({x['vaultAddress'] for x in ins})}")
            if not deposits and peers and balance > 0:
                print("  ^ TRANSFER-FUNDED CANDIDATE")


if __name__ == "__main__":
    main()
