"""Repeatable worker -> PostgreSQL -> HTTP API checks, using isolated fixture services.

Run from the repository with Python 3.12, api/worker requirements installed:
  PYTHONPATH=api:worker python scripts/verify_yearn_alignment.py --output reports/yearn-alignment/backend.json
Requires Docker. Creates and removes only its own temporary PostgreSQL container.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psycopg
import requests
import uvicorn
from eth_utils import keccak
from psycopg import sql

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
HOUR = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
TS = int(HOUR.timestamp())
NOW = int(datetime.now(UTC).timestamp())


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def selector(signature):
    return "0x" + keccak(text=signature).hex()[:8]


def encoded(*values):
    return "0x" + "".join(f"{value:064x}" for value in values)


class Fixture(BaseHTTPRequestHandler):
    refresh = (datetime.now(UTC) - timedelta(hours=4)).isoformat()
    price_age = 12000
    source_age = 0
    price_invalid = False
    markets = []
    feeds = {}

    def log_message(self, *_args):
        pass

    def send(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if self.refresh is not None:
            self.send_header("X-Last-Refresh", self.refresh)
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        if self.path.startswith("/vaults"):
            self.send(
                [
                    {
                        "address": "0x" + "9" * 40,
                        "chainId": 1,
                        "origin": "yearn",
                        "isHidden": False,
                        "isRetired": False,
                        "inclusion": {"isYearn": True},
                        "tvl": 1000000,
                        "kind": "Multi Strategy",
                        "apiVersion": "3.0.4",
                        "symbol": "Fixture",
                        "performance": {"oracle": {"apy": 0.05}},
                        "asset": {"address": USDC, "symbol": "USDC", "decimals": 6},
                    }
                ]
            )
        elif self.path.startswith("/global"):
            self.send(
                {
                    "meta": {"timestamp": NOW - self.source_age, "epoch": 17},
                    "global": {
                        "yfi": {
                            "priceStatus": "stale" if self.price_age > 10800 else "ok",
                            "priceStale": self.price_age > 10800,
                            "priceUpdatedAt": NOW - self.price_age,
                            "priceMaxAgeSeconds": 10800,
                        },
                        "rewards": {},
                    },
                    "styfi": {"current": {"aprBps": 1200}},
                }
            )
        elif self.path.startswith("/v1/ui/explorer"):
            self.send(
                {
                    "chain_id": 1,
                    "block_number": 1000,
                    "block_timestamp": TS,
                    "markets": {
                        "1:" + m["market_address"]: {
                            "collateral_token_price_in_borrow_token": str(10**18),
                            "max_ltv": str(9 * 10 ** m["borrow_token_decimals"] // 10),
                        }
                        for m in self.markets
                    },
                    "rows": [
                        {
                            "market_id": "1:" + m["market_address"],
                            "status": 1,
                            "trove_id": "1",
                            "collateral": str(10**18),
                            "debt": str(88 * 10 ** m["borrow_token_decimals"] // 100),
                            "annual_interest_rate": "0",
                        }
                        for m in self.markets
                    ],
                }
            )
        else:
            self.send(
                {
                    "block_number": 1000,
                    "block_timestamp": TS,
                    "rows": [
                        {
                            "addresses": {"trove_manager": m["market_address"]},
                            "metrics": {
                                "total_collateral": str(10**18),
                                "total_debt": str(5 * 10 ** m["borrow_token_decimals"]),
                                "total_deposits": str(
                                    10 * 10 ** m["borrow_token_decimals"]
                                ),
                                "expected_lend_apr": "0",
                                "total_deposits_in_usd": str(
                                    10
                                    * (2700 if m["borrow_token_address"] == WETH else 1)
                                    * 10 ** m["borrow_token_decimals"]
                                ),
                            },
                        }
                        for m in self.markets
                    ],
                }
            )

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))

        def result(call):
            method, params = call["method"], call.get("params", [])
            if method == "eth_blockNumber":
                return hex(1000)
            if method == "eth_getBlockByNumber":
                number = int(params[0], 16)
                return {
                    "number": hex(number),
                    "timestamp": hex(TS + (number - 1000) * 12),
                    "hash": "0x" + "f" * 64,
                }
            address, data = params[0]["to"], params[0]["data"][:10]
            if address in self.feeds:
                if data == selector("decimals()"):
                    return encoded(8)
                return encoded(
                    1,
                    0
                    if self.price_invalid
                    else (
                        2600
                        if self.feeds[address] == 2700 and int(params[1], 16) < 1000
                        else self.feeds[address]
                    )
                    * 10**8,
                    TS,
                    TS,
                    1,
                )
            market = next(
                (
                    m
                    for m in self.markets
                    if address in (m["market_address"], m["lender_address"])
                ),
                self.markets[0],
            )
            values = {
                "collateral_balance()": 10**18,
                "total_debt()": 5 * 10 ** market["borrow_token_decimals"],
                "total_weighted_debt()": 0,
                "last_debt_update_time()": TS,
                "totalAssets()": 10 * 10 ** market["borrow_token_decimals"],
                "balanceOf(address)": 5 * 10 ** (18 if address == WETH else 6),
                "get_price(bool)": 10**18,
            }
            return encoded(
                next(
                    value
                    for signature, value in values.items()
                    if data == selector(signature)
                )
            )

        calls = body if isinstance(body, list) else [body]
        replies = [
            {"jsonrpc": "2.0", "id": call["id"], "result": result(call)}
            for call in calls
        ]
        self.send(list(reversed(replies)) if isinstance(body, list) else replies[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    name = "yhelper-alignment-" + uuid.uuid4().hex[:8]
    db_port, api_port = port(), port()
    fixture = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    source = f"http://127.0.0.1:{fixture.server_port}"
    database = f"postgresql://alignment:alignment@127.0.0.1:{db_port}/alignment"
    os.environ.update(
        DATABASE_URL=database,
        ETH_RPC_URL=source,
        FLEX_API_URL=source,
        KONG_REST_VAULTS_URL=source + "/vaults",
        STYFI_SITE_GLOBAL_DATA_URL=source + "/global",
    )
    server = None
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            name,
            "-p",
            f"127.0.0.1:{db_port}:5432",
            "-e",
            "POSTGRES_USER=alignment",
            "-e",
            "POSTGRES_PASSWORD=alignment",
            "postgres:16",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    checks = []
    repair_dir = args.output.parent / name
    repair_dir.mkdir(parents=True, exist_ok=True)
    try:
        for _ in range(100):
            try:
                conn = psycopg.connect(database)
                break
            except psycopg.OperationalError:
                time.sleep(0.2)
        else:
            raise RuntimeError("Fixture PostgreSQL did not start")
        from worker.config import FLEX_BORROW_USD_FEEDS
        from worker.db_state import _ensure_schema
        from worker.flex import _batch_state, _reconcile, _sync_snapshots
        from worker.flex_api import _sync_trove_health
        from worker.flex_reprice import repair
        from worker.kong import _run_kong_snapshot_ingestion
        from worker.styfi import (
            _fetch_styfi_site_reward_state,
            _upsert_styfi_sync_state,
        )
        from app.main import app

        _ensure_schema(conn)
        Fixture.feeds = {
            FLEX_BORROW_USD_FEEDS[USDC]: 1,
            FLEX_BORROW_USD_FEEDS[WETH]: 2700,
        }
        for index, (token, decimals, symbol) in enumerate(
            ((USDC, 6, "USDC"), (WETH, 18, "WETH")), 1
        ):
            market = {
                "chain_id": 1,
                "market_address": "0x" + str(index) * 40,
                "registry_address": "0x" + "3" * 40,
                "factory_address": "0x" + "4" * 40,
                "contract_version": "1.1.0",
                "implementation_address": "0x" + "5" * 40,
                "deployment_block": 1,
                "deployment_time": HOUR - timedelta(hours=1),
                "deployment_tx_hash": "0x" + "6" * 64,
                "endorsement_status": "endorsed",
                "market_status": "active",
                "lender_address": "0x" + str(index + 6) * 40,
                "collateral_token_address": "0x" + "a" * 40,
                "collateral_token_symbol": "TEST",
                "collateral_token_decimals": 18,
                "borrow_token_address": token,
                "borrow_token_symbol": symbol,
                "borrow_token_decimals": decimals,
                "sorted_troves_address": "0x" + "b" * 40,
                "dutch_desk_address": "0x" + "c" * 40,
                "auction_address": "0x" + "d" * 40,
                "price_oracle_address": "0x" + "e" * 40,
                "one_pct_raw": 10 ** (decimals - 2),
            }
            Fixture.markets.append(market)
            with conn.cursor() as cur:
                cur.execute(
                    sql.SQL("INSERT INTO flex_market_dim ({}) VALUES ({})").format(
                        sql.SQL(",").join(map(sql.Identifier, market)),
                        sql.SQL(",").join(sql.Placeholder() for _ in market),
                    ),
                    list(market.values()),
                )
        conn.commit()
        assert _sync_snapshots(conn, Fixture.markets, 1000, HOUR, 2) == 4
        config = uvicorn.Config(app, host="127.0.0.1", port=api_port, log_level="error")
        server = uvicorn.Server(config)
        threading.Thread(target=server.run, daemon=True).start()
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.1)

        def get(path):
            response = requests.get(
                f"http://127.0.0.1:{api_port}/api/{path}", timeout=10
            )
            response.raise_for_status()
            return response.json()

        assert _sync_snapshots(conn, Fixture.markets, 1000, HOUR, 1) == 2
        markets = get("flex/markets?status=active")
        assert markets["summary"]["deposits_usd"] == 27010, markets
        checks.append(
            "Mixed USDC/WETH snapshots and active API totals use separate feeds; reversed RPC responses stay aligned"
        )
        assert _reconcile(conn, 1000) == "ok"
        assert _sync_trove_health(conn, Fixture.markets) == {"ready": 2, "failed": 0}
        for market in Fixture.markets:
            health = get(f"flex/markets/{market['market_address']}/trove-health")[
                "metrics"
            ]
            assert health["minimum_buffer_to_max_ltv"] == 0.02, health
            assert health["debt_near_max_share"] == 0, health
        checks.append(
            "USDC and WETH health buffers use the market ratio precision through source ingestion and HTTP"
        )
        weth_market = Fixture.markets[1]["market_address"]
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE flex_market_snapshots SET deposits_usd_e18=10*10^18, borrow_usd_feed_address=NULL WHERE market_address=%s",
                (weth_market,),
            )
            cur.execute(
                "SELECT collateral_raw, debt_raw, deposits_raw, idle_liquidity_raw FROM flex_market_snapshots WHERE market_address=%s",
                (weth_market,),
            )
            balances = cur.fetchall()
        conn.commit()
        assert _reconcile(conn, 1000) == "mismatch"
        assert repair(conn, repair_dir / "fixture-repair.json", apply=True)["rows"] == 2
        assert (
            repair(conn, repair_dir / "fixture-repair-repeat.json", apply=True)["rows"]
            == 0
        )
        with conn.cursor() as cur:
            cur.execute(
                "SELECT collateral_raw, debt_raw, deposits_raw, idle_liquidity_raw FROM flex_market_snapshots WHERE market_address=%s",
                (weth_market,),
            )
            assert cur.fetchall() == balances
        assert get("flex/markets?status=active")["summary"]["deposits_usd"] == 27010
        history = get(f"flex/markets/{weth_market}/history?days=7&interval=hour")
        assert [point["deposits_usd"] for point in history["points"]] == [26000, 27000]
        checks.append(
            "USD reconciliation catches wrong prices; historical repair restores API totals, preserves raw balances, and is idempotent"
        )
        for invalid in (False, True):
            Fixture.price_invalid = invalid
            try:
                _batch_state(
                    [{**Fixture.markets[0], "borrow_token_address": "0xunknown"}]
                    if not invalid
                    else Fixture.markets,
                    1000,
                )
            except ValueError:
                pass
            else:
                raise AssertionError(
                    "Unsupported assets and invalid oracle rounds must fail closed"
                )
        Fixture.price_invalid = False
        checks.append("Unsupported borrow assets and invalid oracle rounds fail closed")
        for refresh, state in (
            (Fixture.refresh, "delayed"),
            (None, "unknown"),
            (datetime.now(UTC).isoformat(), "ready"),
        ):
            Fixture.refresh = refresh
            assert _run_kong_snapshot_ingestion(conn)[1] == 1
            for route in (
                "discover?min_points=0",
                "composition?min_points=0",
                "changes",
                "meta/freshness",
            ):
                data = get(route)
                assert (
                    data[
                        "kong_source"
                        if route == "meta/freshness"
                        else "source_freshness"
                    ]["state"]
                    == state
                ), data
        checks.append(
            "Kong refresh headers survive ingestion, API models, and all research/freshness endpoints: delayed, unknown, ready"
        )
        for source_age, price_age, source_state, price_state in (
            (0, 12000, "ready", "delayed"),
            (7200, 60, "delayed", "ready"),
            (0, 60, "ready", "ready"),
        ):
            Fixture.source_age, Fixture.price_age = source_age, price_age
            _upsert_styfi_sync_state(
                conn,
                {
                    "stream_name": "styfi_reward_epoch",
                    "chain_id": 1,
                    "cursor": 17,
                    "observed_at": datetime.now(UTC),
                    "payload": {
                        "reward_token": {
                            "address": USDC,
                            "symbol": "USDC",
                            "decimals": 6,
                        },
                        "current_reward_state": _fetch_styfi_site_reward_state(),
                    },
                },
            )
            state = get("styfi?include_history=false")["current_reward_state"]
            assert (state["source_state"], state["yfi_price_state"]) == (
                source_state,
                price_state,
            ), state
        checks.append(
            "stYFI source age and YFI price age remain independent through worker storage and HTTP API"
        )
        args.output.write_text(
            json.dumps(
                {
                    "passed": True,
                    "checked_at": datetime.now(UTC).isoformat(),
                    "checks": checks,
                },
                indent=2,
            )
            + "\n"
        )
        print(
            json.dumps(
                {"passed": True, "checks": len(checks), "artifact": str(args.output)}
            )
        )
        conn.close()
    finally:
        if server:
            server.should_exit = True
        fixture.shutdown()
        subprocess.run(["docker", "stop", name], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
