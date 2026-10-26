"""HTTP + PostgreSQL + archive-RPC scenarios. Run with uv and api/requirements.txt.

Creates a disposable schema, never changes production tables. Results are written
under reports/flex-performance/. The RPC fixture uses known, independent amounts.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx
import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/flex-performance"
OUT.mkdir(parents=True, exist_ok=True)
END = int(datetime.now(UTC).timestamp())
START = END - 30 * 86400
MARKET, LENDER, ORACLE = ("0x" + c * 40 for c in ("1", "2", "3"))
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
FEED = "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
ETH_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419"
WETH_MARKET, WETH_LENDER, WETH_ORACLE = ("0x" + c * 40 for c in ("5", "6", "7"))
ZERO = "0x" + "0" * 40
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
OWNER = {
    name: "0x" + f"{n:040x}"
    for n, name in enumerate(
        (
            "simple",
            "borrow",
            "closed",
            "missing",
            "lender",
            "transfer",
            "empty",
            "interest",
            "liquidated",
            "auction",
            "weth",
        ),
        101,
    )
}
EVENTS, TRANSFERS = [], []
CALLS = 0
BAD_PRICE = False


def timestamp(block):
    return START + (block - 1000) * 30 * 86400 // 1000


def pps(block):
    return 1_000_000 + (block - 1100) * 200_000 // 900


def word(value):
    return f"{value:064x}"


def tx(n):
    return "0x" + word(n)


def event(name, owner, block, amounts, trove=None, number=None):
    number = number or len(EVENTS) + 1
    EVENTS.append(
        {
            "event_name": name,
            "actors": {"owner": owner},
            "amounts": {
                **{
                    k: str(v) if not isinstance(v, bool) else v
                    for k, v in amounts.items()
                },
                **({"trove_id": str(trove)} if trove else {}),
            },
            "block_number": block,
            "block_time": datetime.fromtimestamp(timestamp(block), UTC),
            "tx_hash": tx(number),
            "log_index": number,
        }
    )
    return number


def transfer(sender, receiver, shares, block, number, log_index=None):
    TRANSFERS.append(
        {
            "address": LENDER,
            "topics": [
                TRANSFER,
                "0x" + sender[2:].rjust(64, "0"),
                "0x" + receiver[2:].rjust(64, "0"),
            ],
            "data": "0x" + word(shares),
            "blockNumber": hex(block),
            "transactionHash": tx(number),
            "logIndex": hex(log_index or number),
            "removed": False,
        }
    )


U = 10**6
for label, trove, coll, debt, fee, rate in [
    ("simple", 1, 100, 60, 1, 0),
    ("borrow", 2, 1000, 500, 5, 0),
    ("closed", 3, 100, 60, 0, 0),
    ("interest", 8, 100, 60, 1, 100000),
    ("liquidated", 9, 100, 60, 0, 0),
]:
    event(
        "open_trove",
        OWNER[label],
        1100,
        {
            "collateral_raw": coll * U,
            "debt_raw": debt * U,
            "upfront_fee_raw": fee * U,
            "annual_interest_rate_raw": rate,
        },
        trove,
    )
event(
    "borrow", OWNER["borrow"], 1200, {"debt_raw": 707 * U, "upfront_fee_raw": 2 * U}, 2
)
event(
    "close_trove",
    OWNER["closed"],
    1550,
    {"collateral_raw": 100 * U, "debt_raw": 60 * U},
    3,
)
event("add_collateral", OWNER["missing"], 1300, {"collateral_raw": 100 * U}, 4)
event(
    "liquidation",
    OWNER["liquidated"],
    1550,
    {"collateral_raw": 70 * U, "debt_raw": 60 * U, "is_full_liquidation": True},
    9,
)
n = event(
    "lender_deposit",
    OWNER["lender"],
    1100,
    {"assets_raw": 100 * U, "shares_raw": 100 * U},
)
transfer(ZERO, OWNER["lender"], 100 * U, 1100, n)
transfer(OWNER["lender"], OWNER["lender"], 5 * U, 1300, 999)
transfer("0x" + "f" * 40, OWNER["transfer"], 10 * U, 1200, 800)
transfer(OWNER["transfer"], "0x" + "f" * 40, 5 * U, 1600, 801)
event(
    "lender_withdrawal",
    OWNER["auction"],
    1550,
    {"assets_raw": 10 * U, "shares_raw": 10 * U},
    number=900,
)
event(
    "redemption",
    OWNER["auction"],
    1550,
    {"collateral_raw": 10 * U, "debt_raw": 10 * U},
    number=900,
)
transfer(OWNER["auction"], ZERO, 10 * U, 1550, 900)


def trove_state(trove, block):
    if block < 1100:
        return (0, 0, 0, 0)
    if trove == 3 and block >= 1550 or trove == 9 and block >= 1550:
        return (0, 0, 0, 0)
    debt, coll = {
        1: (61, 100),
        2: (707 if block >= 1200 else 505, 1000),
        3: (60, 100),
        4: (0, 100),
        8: (61, 100),
        9: (60, 100),
    }.get(trove, (0, 0))
    rate = 100000 if trove == 8 else 0
    accrued = (
        debt
        * U
        * rate
        * max(0, timestamp(block) - timestamp(1100))
        // (365 * 86400 * U)
    )
    return (debt * U, coll * U, rate, accrued)


class RPC(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))

        def reply(call):
            global CALLS
            CALLS += 1
            method, params = call["method"], call.get("params", [])
            result = None
            if method == "eth_chainId":
                result = "0x1"
            elif method == "eth_getBlockByNumber":
                block = int(params[0], 16)
                result = {
                    "number": hex(block),
                    "timestamp": hex(timestamp(block)),
                    "hash": "0x" + "a" * 64,
                }
            elif method == "eth_getLogs":
                q = params[0]
                result = []
                for log in TRANSFERS:
                    if q.get("address", "").lower() != log["address"].lower():
                        continue
                    topics = q.get("topics", [])
                    if (
                        not int(q["fromBlock"], 16)
                        <= int(log["blockNumber"], 16)
                        <= int(q["toBlock"], 16)
                    ):
                        continue
                    if any(
                        t is not None and t != log["topics"][i]
                        for i, t in enumerate(topics)
                    ):
                        continue
                    result.append(log)
            elif method == "eth_call":
                req, tag = params
                block = int(tag, 16)
                data = req["data"]
                selector = data[:10]
                if req["to"].lower() in (FEED, ETH_FEED):
                    if selector == "0x313ce567":
                        result = "0x" + word(8)
                    else:
                        usd = (
                            10**8
                            if req["to"].lower() == FEED
                            else (2000 * 10**8 + (block - 1100) * 500 * 10**8 // 900)
                        )
                        result = "0x" + "".join(
                            word(v)
                            for v in (
                                1,
                                0 if BAD_PRICE else usd,
                                timestamp(block),
                                timestamp(block),
                                1,
                            )
                        )
                elif req["to"].lower() == ORACLE:
                    result = "0x" + word(pps(block) * 10**12)
                elif req["to"].lower() == WETH_ORACLE:
                    result = "0x" + word(3 * 10**18)
                elif selector == "0x01e1d114":
                    result = "0x" + word((100 if block <= 1000 else 300) * U)
                elif selector == "0x70a08231":
                    owner = "0x" + data[-40:]
                    balance = 0
                    if owner == OWNER["auction"] and req["to"].lower() == LENDER:
                        balance = 10 * U
                    for log in TRANSFERS if req["to"].lower() == LENDER else []:
                        if int(log["blockNumber"], 16) > block:
                            continue
                        if log["topics"][1][-40:] == owner[2:]:
                            balance -= int(log["data"], 16)
                        if log["topics"][2][-40:] == owner[2:]:
                            balance += int(log["data"], 16)
                    result = "0x" + word(balance)
                elif selector == "0x07a2d13a":
                    result = "0x" + word(int(data[10:], 16) * pps(block) // U)
                else:
                    trove = int(data[10:], 16)
                    debt, coll, rate, accrued = trove_state(trove, block)
                    if req["to"].lower() == WETH_MARKET:
                        debt = coll = 10**18 if block >= 1100 and trove == 11 else 0
                        rate = accrued = 0
                    result = "0x" + (
                        word(debt + accrued)
                        if selector == "0x0ff8afc1"
                        else "".join(
                            word(v)
                            for v in (
                                debt,
                                coll,
                                rate,
                                timestamp(1100),
                                timestamp(1100),
                                timestamp(1100),
                                int(
                                    OWNER.get(
                                        {
                                            1: "simple",
                                            2: "borrow",
                                            3: "closed",
                                            4: "missing",
                                            8: "interest",
                                            9: "liquidated",
                                        }.get(trove, "empty")
                                    ),
                                    16,
                                ),
                                1,
                            )
                        )
                    )
            return {"jsonrpc": "2.0", "id": call["id"], "result": result}

        result = (
            [reply(x) for x in payload] if isinstance(payload, list) else reply(payload)
        )
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def dsn():
    raw = os.getenv("FLEX_TEST_DATABASE_URL")
    if not raw:
        env = {}
        for line in (ROOT / ".env").read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip("\"'")
        raw = env.get("WORKER_DATABASE_URL") or env.get("DATABASE_URL")
    if not raw:
        raise RuntimeError(
            "Set FLEX_TEST_DATABASE_URL to a local disposable-test PostgreSQL connection"
        )
    parts = urlsplit(raw)
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc.replace("yhelper-postgres", "127.0.0.1"),
            parts.path,
            parts.query,
            parts.fragment,
        )
    )


def main():
    global BAD_PRICE
    schema = "flex_pnl_e2e_" + uuid.uuid4().hex[:12]
    base_dsn = dsn()
    parts = urlsplit(base_dsn)
    query = parse_qs(parts.query)
    query["options"] = [f"-csearch_path={schema}"]
    scoped = urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query, doseq=True),
            parts.fragment,
        )
    )
    rpc = ThreadingHTTPServer(("127.0.0.1", 0), RPC)
    threading.Thread(target=rpc.serve_forever, daemon=True).start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    proc = None
    try:
        with psycopg.connect(base_dsn, autocommit=True) as conn:
            conn.execute(f"CREATE SCHEMA {schema}")
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute(
                "CREATE TABLE flex_market_dim (chain_id int, market_address text, raw_metadata jsonb, market_status text, contract_version text, deployment_block bigint, deployment_time timestamptz, lender_address text, collateral_token_address text, collateral_token_symbol text, collateral_token_decimals int, borrow_token_address text, borrow_token_symbol text, borrow_token_decimals int, price_oracle_address text)"
            )
            conn.execute(
                "CREATE TABLE flex_market_snapshots (chain_id int, market_address text, block_number bigint, block_hash text, block_time timestamptz)"
            )
            conn.execute(
                "CREATE TABLE flex_events (chain_id int, market_address text, block_number bigint, block_time timestamptz, tx_hash text, log_index int, event_name text, actors jsonb, amounts jsonb)"
            )
            conn.execute(
                "CREATE TABLE flex_sync_state (stream_name text, chain_id int, cursor bigint)"
            )
            conn.execute("INSERT INTO flex_sync_state VALUES ('events',1,2000)")
            conn.execute(
                "INSERT INTO flex_market_dim VALUES (1,%s,%s,%s,%s,900,%s,%s,%s,%s,6,%s,%s,6,%s)",
                (
                    MARKET,
                    Jsonb({"label": "Fixture/USDC"}),
                    "active",
                    "1.1.0",
                    datetime.fromtimestamp(timestamp(900), UTC),
                    LENDER,
                    "0x" + "4" * 40,
                    "yvTEST",
                    USDC,
                    "USDC",
                    ORACLE,
                ),
            )
            conn.execute(
                "INSERT INTO flex_market_dim VALUES (1,%s,%s,%s,%s,900,%s,%s,%s,%s,18,%s,%s,18,%s)",
                (
                    WETH_MARKET,
                    Jsonb({"label": "Fixture/WETH"}),
                    "active",
                    "1.1.0",
                    datetime.fromtimestamp(timestamp(900), UTC),
                    WETH_LENDER,
                    "0x" + "8" * 40,
                    "yvWETH",
                    WETH,
                    "WETH",
                    WETH_ORACLE,
                ),
            )
            conn.execute(
                "INSERT INTO flex_market_snapshots VALUES (1,%s,2000,%s,%s)",
                (MARKET, "0x" + "a" * 64, datetime.fromtimestamp(END, UTC)),
            )
            conn.execute(
                "INSERT INTO flex_market_snapshots VALUES (1,%s,2000,%s,%s)",
                (WETH_MARKET, "0x" + "a" * 64, datetime.fromtimestamp(END, UTC)),
            )
            conn.execute(
                "INSERT INTO flex_events VALUES (1,%s,1100,%s,%s,950,%s,%s,%s)",
                (
                    WETH_MARKET,
                    datetime.fromtimestamp(timestamp(1100), UTC),
                    tx(950),
                    "open_trove",
                    Jsonb({"owner": OWNER["weth"]}),
                    Jsonb(
                        {
                            "trove_id": "11",
                            "collateral_raw": str(10**18),
                            "debt_raw": str(10**18),
                            "upfront_fee_raw": "0",
                            "annual_interest_rate_raw": "0",
                        }
                    ),
                ),
            )
            for e in EVENTS:
                conn.execute(
                    "INSERT INTO flex_events VALUES (1,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        MARKET,
                        e["block_number"],
                        e["block_time"],
                        e["tx_hash"],
                        e["log_index"],
                        e["event_name"],
                        Jsonb(e["actors"]),
                        Jsonb(e["amounts"]),
                    ),
                )
        env = {
            **os.environ,
            "DATABASE_URL": scoped,
            "FLEX_PERFORMANCE_RPC_URL": f"http://127.0.0.1:{rpc.server_port}",
            "PYTHONPATH": str(ROOT / "api"),
        }
        with (OUT / "api.log").open("w") as log:
            proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--lifespan",
                    "off",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}", timeout=90
            ) as client:
                for _ in range(100):
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    time.sleep(0.1)
                endpoint = "/api/flex/performance"
                invalid = client.get(endpoint, params={"address": "bad", "days": 30})
                assert invalid.status_code == 422, (
                    f"Expected validation, got {invalid.status_code}"
                )
                results = {}
                for name in (
                    "simple",
                    "borrow",
                    "closed",
                    "interest",
                    "liquidated",
                    "missing",
                    "lender",
                    "transfer",
                    "auction",
                    "empty",
                    "weth",
                ):
                    response = client.get(
                        endpoint, params={"address": OWNER[name], "days": 30}
                    )
                    assert response.status_code == 200, (
                        name,
                        response.status_code,
                        response.text,
                    )
                    results[name] = response.json()
                    assert response.headers.get("cache-control") == "no-store"

                def pnl(name, side):
                    return results[name][side]["pnl_usd"]

                assert abs(pnl("simple", "borrowers") - 19) < 0.01
                assert abs(pnl("borrow", "borrowers") - 193) < 0.01, (
                    "Borrow carries total debt, not additional proceeds"
                )
                assert abs(pnl("closed", "borrowers") - 10) < 0.01, (
                    "Closed positions remain in period totals"
                )
                assert pnl("interest", "borrowers") < 19, "Accrued interest reduces P&L"
                assert pnl("liquidated", "borrowers") is not None
                assert pnl("missing", "borrowers") is None, (
                    "Missing opening history must not invent P&L"
                )
                assert abs(pnl("lender", "lenders") - 20) < 0.01, (
                    "Mint + Deposit must count funding once"
                )
                assert 1.32 < pnl("transfer", "lenders") < 1.35, (
                    "Peer share transfers need fair-value funding"
                )
                assert pnl("auction", "lenders") is None, (
                    "Auction settlement must not masquerade as an ERC-4626 cash withdrawal"
                )
                assert pnl("empty", "borrowers") == 0 and pnl("empty", "lenders") == 0
                assert abs(pnl("weth", "borrowers") - 1000) < 0.01, (
                    "WETH USD prices and 18-decimal amounts cannot use USDC units"
                )
                before = CALLS
                assert (
                    client.get(
                        endpoint,
                        params={
                            "address": OWNER["simple"].upper().replace("0X", "0x"),
                            "days": 30,
                        },
                    ).status_code
                    == 200
                )
                assert CALLS == before, "Repeated addresses must use the bounded cache"
                overview = client.get(endpoint, params={"days": 30})
                assert overview.status_code == 200
                assert overview.json()["borrowers"]["pnl_usd"] is None, (
                    "Incomplete position must invalidate the combined total"
                )
                BAD_PRICE = True
                bad = client.get(
                    endpoint, params={"address": OWNER["simple"], "days": 7}
                )
                assert bad.status_code in (200, 502)
                if bad.status_code == 200:
                    assert bad.json()["borrowers"]["pnl_usd"] is None
                BAD_PRICE = False
                with psycopg.connect(scoped, autocommit=True) as conn:
                    conn.execute("UPDATE flex_sync_state SET cursor=1900")
                lag = client.get(
                    endpoint, params={"address": OWNER["empty"], "days": 90}
                )
                assert lag.status_code == 503, (
                    "Events behind the valuation block must not produce P&L"
                )
                (OUT / "api-results.json").write_text(
                    json.dumps(
                        {
                            "passed": True,
                            "cases": results,
                            "overview": overview.json(),
                            "rpc_calls": CALLS,
                        },
                        indent=2,
                    )
                    + "\n"
                )
                print(
                    "Flex performance HTTP/DB/RPC E2E passed: funding, cumulative debt, closed positions, interest, liquidation, share transfers, privacy/cache and incomplete coverage."
                )
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        rpc.shutdown()
        with psycopg.connect(base_dsn, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    main()
