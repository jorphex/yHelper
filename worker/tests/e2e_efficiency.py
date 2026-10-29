"""Real HTTP/RPC -> worker -> isolated PostgreSQL efficiency regressions.

Scenarios exercise unchanged/corrected data, cold and warm history, deployment boundaries,
partial gap repair, discovery restart/replay, epoch corrections, safe cleanup,
and notification delivery while the ingestion HTTP request is blocked.
Artifacts: reports/worker-efficiency-e2e/results.json and scheduler.log.
Run using uv with worker/requirements.txt and api/requirements.txt.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from eth_utils import keccak
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/worker-efficiency-e2e"
HOUR = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
BASE = int(HOUR.timestamp()) - 4 * 3600
MIDNIGHT = int(HOUR.replace(hour=0).timestamp())
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
FEED = "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6"
MARKETS = ["0x" + digit * 40 for digit in ("1", "4", "5")]
LENDER, ORACLE = ("0x" + digit * 40 for digit in ("2", "3"))
DEPLOYMENTS = [151, 751, 1251]
HEAD, EPOCH, LATEST_CORRECTION, OLD_CORRECTION = 1200, 19, 0, 0
RISK, UNENDORSE, FAIL_HISTORY, BAD_DEPLOYMENT = 100, False, False, False
COUNTS, SCANS = Counter(), []
ENTERED, RELEASE = threading.Event(), threading.Event()
SLOW = False
VAULTS = []
SIGNATURES = {
    keccak(text=s)[:4].hex(): s
    for s in (
        "collateral_token()",
        "borrow_token()",
        "price_oracle()",
        "decimals()",
        "symbol()",
        "one_pct()",
        "min_debt()",
        "safe_collateral_ratio()",
        "minimum_collateral_ratio()",
        "max_penalty_collateral_ratio()",
        "min_liquidation_fee()",
        "max_liquidation_fee()",
        "min_annual_interest_rate()",
        "max_annual_interest_rate()",
        "collateral_balance()",
        "total_debt()",
        "total_weighted_debt()",
        "last_debt_update_time()",
        "totalAssets()",
        "balanceOf(address)",
        "get_price(bool)",
        "latestRoundData()",
        "token()",
        "epoch()",
        "genesis()",
        "totalSupply()",
        "epoch_rewards(uint256)",
        "rewards(address,uint256)",
    )
}


def word(value):
    return f"{value:064x}"


def vault(address):
    return {
        "address": address,
        "chainId": 1,
        "origin": "yearn",
        "isHidden": False,
        "isRetired": False,
        "inclusion": {"isYearn": True},
        "tvl": 1_000_000,
        "kind": "Multi Strategy",
        "apiVersion": "3.0.4",
        "symbol": "yvUSDC",
        "performance": {"oracle": {"netAPY": 0.06}},
    }


def series():
    return [
        (
            MIDNIGHT - (119 - i) * 86400,
            1_000_000
            + i * 100
            + (LATEST_CORRECTION if i == 119 else OLD_CORRECTION if i == 69 else 0),
        )
        for i in range(120)
    ]


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        COUNTS[path] += 1
        if path == "/vaults":
            if SLOW:
                ENTERED.set()
                RELEASE.wait(20)
            return self.send(VAULTS)
        if path.endswith("/params"):
            return self.send({"oracle": {"description": "fixture"}})
        if path.endswith("/markets"):
            return self.send({"rows": []})
        if path == "/tvl":
            return self.send(200)
        if path == "/protocols":
            return self.send(
                [
                    {
                        "slug": s,
                        "name": s,
                        "parentProtocol": "parent#yearn",
                        "tvl": 100,
                        "chainTvls": {"Ethereum": 100},
                    }
                    for s in ("yearn-finance", "yearn-curating")
                ]
            )
        return self.send({})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/hook":
            COUNTS["deliveries"] += 1
            time.sleep(0.1)
            return self.send({})
        if self.path == "/gql":
            variables = payload["variables"]
            COUNTS[
                "gql_full"
                if variables["timestamp"] is None
                or variables["timestamp"] < MIDNIGHT - 2 * 86400
                else "gql_tail"
            ] += 1
            if FAIL_HISTORY:
                return self.send({"errors": [{"message": "fixture unavailable"}]})
            points = [
                (t, v)
                for t, v in series()
                if variables["timestamp"] is None or t >= variables["timestamp"]
            ]
            if variables["limit"] is not None:
                points = points[: variables["limit"]]
            return self.send(
                {"data": {"timeseries": [{"time": t, "value": v} for t, v in points]}}
            )
        results = (
            [self.rpc(row) for row in payload]
            if isinstance(payload, list)
            else self.rpc(payload)
        )
        self.send(results)

    def rpc(self, request):
        method, params = request["method"], request["params"]
        COUNTS[method] += 1
        if method == "eth_blockNumber":
            result = hex(HEAD)
        elif method == "eth_getBlockByNumber":
            number = (
                HEAD if params[0] in ("latest", "finalized") else int(params[0], 16)
            )
            result = {
                "number": hex(number),
                "timestamp": hex(BASE + number * 12),
                "hash": "0x" + word(number),
            }
        elif method == "eth_getCode":
            result = "0x01" if int(params[1], 16) >= 100 else "0x"
        elif method == "eth_getLogs":
            query = params[0]
            low, high = int(query["fromBlock"], 16), int(query["toBlock"], 16)
            addresses = (
                query["address"]
                if isinstance(query["address"], list)
                else [query["address"]]
            )
            SCANS.append((low, high))
            from worker.config import FLEX_FACTORIES, FLEX_REGISTRY_ADDRESS
            from worker.flex import ENDORSE_TOPIC, FACTORY_DEPLOY_TOPIC, UNENDORSE_TOPIC

            result = []
            for market, number in zip(MARKETS, DEPLOYMENTS):
                if next(iter(FLEX_FACTORIES)) in addresses and low <= number <= high:
                    result.append(
                        {
                            "address": next(iter(FLEX_FACTORIES)),
                            "blockNumber": hex(number),
                            "topics": [
                                FACTORY_DEPLOY_TOPIC,
                                "0x" + word(0),
                                "0x" + market[2:].rjust(64, "0"),
                            ],
                            "data": "0x"
                            + "".join(
                                a[2:].rjust(64, "0")
                                for a in [LENDER, ORACLE, ORACLE, LENDER]
                            ),
                            "transactionHash": "0x" + word(number),
                            "logIndex": "0x0",
                        }
                    )
                if FLEX_REGISTRY_ADDRESS in addresses and low <= number + 1 <= high:
                    result.append(
                        {
                            "blockNumber": hex(number + 1),
                            "logIndex": "0x0",
                            "topics": [ENDORSE_TOPIC, "0x" + market[2:].rjust(64, "0")],
                        }
                    )
            if BAD_DEPLOYMENT == "factory":
                for row in result:
                    if row.get("blockNumber") == hex(DEPLOYMENTS[-1]):
                        row["data"] = "0x"
            if BAD_DEPLOYMENT == "registry":
                for row in result:
                    if row.get("blockNumber") == hex(DEPLOYMENTS[-1] + 1):
                        row["topics"] = row["topics"][:1]
            if UNENDORSE and FLEX_REGISTRY_ADDRESS in addresses and low <= 1199 <= high:
                result.append(
                    {
                        "blockNumber": hex(1199),
                        "logIndex": "0x1",
                        "topics": [
                            UNENDORSE_TOPIC,
                            "0x" + MARKETS[0][2:].rjust(64, "0"),
                        ],
                    }
                )
        elif method == "eth_call":
            call = params[0]
            signature = SIGNATURES[call["data"][2:10]]
            COUNTS[signature] += 1
            timestamp = (
                BASE + (HEAD if params[1] == "latest" else int(params[1], 16)) * 12
            )
            if signature == "symbol()":
                return {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    "result": "0x" + word(32) + word(4) + b"USDC".hex().ljust(64, "0"),
                }
            values = {
                "collateral_token()": [int(USDC, 16)],
                "borrow_token()": [int(USDC, 16)],
                "price_oracle()": [int(ORACLE, 16)],
                "decimals()": [8 if call["to"].lower() == FEED else 6],
                "token()": [int(USDC, 16)],
                "epoch()": [EPOCH],
                "min_debt()": [RISK],
                "genesis()": [MIDNIGHT - 19 * 14 * 86400],
                "one_pct()": [10000],
                "collateral_balance()": [2_000_000],
                "total_debt()": [1_000_000],
                "total_weighted_debt()": [0],
                "last_debt_update_time()": [timestamp],
                "totalAssets()": [3_000_000],
                "balanceOf(address)": [1_000_000],
                "get_price(bool)": [10**18],
                "latestRoundData()": [1, 10**8, timestamp, timestamp, 1],
                "epoch_rewards(uint256)": [1000],
                "rewards(address,uint256)": [200],
            }.get(signature, [10**18])
            result = "0x" + "".join(word(value) for value in values)
        else:
            raise AssertionError(method)
        return {"jsonrpc": "2.0", "id": request["id"], "result": result}


def main():
    global HEAD, RISK, UNENDORSE, BAD_DEPLOYMENT
    global LATEST_CORRECTION, OLD_CORRECTION, FAIL_HISTORY, EPOCH, SLOW
    sys.path.insert(0, str(ROOT / "worker"))
    if sys.argv[1:] == ["--resume-discovery"]:
        from worker.flex import _discover_markets

        with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
            assert len(_discover_markets(conn, 1500)) == 3
        return
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps({"status": "RUNNING"}) + "\n")
    spec = importlib.util.spec_from_file_location(
        "fixture", ROOT / "api/tests/e2e_flex_performance.py"
    )
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    base = fixture.dsn()
    schema = "efficiency_" + uuid.uuid4().hex[:12]
    scoped = make_conninfo(base, options=f"-csearch_path={schema}")
    for key in list(os.environ):
        if any(
            part in key
            for part in ("RPC_URL", "WSS_URL", "DISCORD", "TELEGRAM", "ALERT_")
        ):
            os.environ.pop(key)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    os.environ.update(
        DATABASE_URL=scoped,
        ETH_RPC_URL=origin + "/rpc",
        KONG_GQL_URL=origin + "/gql",
        KONG_REST_VAULTS_URL=origin + "/vaults",
        STYFI_SITE_GLOBAL_DATA_URL=origin + "/styfi",
        FLEX_API_URL=origin,
        DEFI_LLAMA_PARENT_TVL_URL=origin + "/tvl",
        DEFI_LLAMA_PROTOCOLS_URL=origin + "/protocols",
        HARVEST_WSS_ENABLED="0",
        STYFI_SYNC_ENABLED="0",
        YLOCKER_SYNC_ENABLED="0",
        FLEX_SYNC_ENABLED="0",
        DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC="1",
        DISCORD_STYFI_WEBHOOK_URL=origin + "/hook",
    )
    from worker.config import DDL

    from worker import accounting, flex, kong, notifications, styfi

    evidence = {}
    process = None
    try:
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"CREATE SCHEMA {schema}")
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute(DDL)
            VAULTS[:] = [vault(MARKETS[0])]
            kong._run_kong_snapshot_ingestion(conn)
            original = conn.execute("SELECT xmin::text FROM vault_dim").fetchone()[0]
            kong._run_kong_snapshot_ingestion(conn)
            assert (
                conn.execute("SELECT xmin::text FROM vault_dim").fetchone()[0]
                == original
            )
            conn.execute("UPDATE vault_dim SET est_apy = 0.01")
            kong._run_kong_snapshot_ingestion(conn)
            assert (
                float(conn.execute("SELECT est_apy FROM vault_dim").fetchone()[0])
                == 0.06
            )
            VAULTS[:] = [vault(MARKETS[1])]
            kong._run_kong_snapshot_ingestion(conn)
            assert (
                conn.execute(
                    "SELECT active FROM vault_dim WHERE vault_address=%s", (MARKETS[0],)
                ).fetchone()[0]
                is False
            )
            VAULTS.append(vault(MARKETS[0]))
            kong._run_kong_snapshot_ingestion(conn)
            assert (
                conn.execute("SELECT COUNT(*) FROM vault_dim WHERE active").fetchone()[
                    0
                ]
                == 2
            )
            evidence["catalog"] = (
                "identical rows untouched; normalization corrected; removed/reappearing vaults handled"
            )

            kong._run_kong_ingestion(conn)
            assert (
                conn.execute("SELECT COUNT(*) FROM pps_timeseries").fetchone()[0] == 240
            )
            before = conn.execute(
                "SELECT SUM(xmin::text::bigint) FROM pps_timeseries"
            ).fetchone()[0]
            COUNTS.clear()
            kong._run_kong_ingestion(conn)
            assert COUNTS["gql_tail"] == 2 and COUNTS["gql_full"] == 0
            assert (
                conn.execute(
                    "SELECT SUM(xmin::text::bigint) FROM pps_timeseries"
                ).fetchone()[0]
                == before
            )
            LATEST_CORRECTION = 500
            kong._run_kong_ingestion(conn)
            expected = (series()[-1][1] / series()[-91][1]) ** (365 / 90) - 1
            actual = conn.execute(
                "SELECT apy_90d FROM vault_metrics_latest LIMIT 1"
            ).fetchone()[0]
            assert abs(float(actual) - expected) < 1e-10
            OLD_CORRECTION = 900
            kong.PPS_REPAIRS = {
                key: (day - timedelta(days=1), count)
                for key, (day, count) in kong.PPS_REPAIRS.items()
            }
            previous_repairs = dict(kong.PPS_REPAIRS)
            FAIL_HISTORY = True
            kong._run_kong_ingestion(conn)
            assert kong.PPS_REPAIRS == previous_repairs, (
                "failed repair was marked complete"
            )
            FAIL_HISTORY = False
            kong._run_kong_ingestion(conn)
            assert (
                int(
                    conn.execute(
                        "SELECT pps_raw FROM pps_timeseries WHERE ts=%s LIMIT 1",
                        (series()[69][0],),
                    ).fetchone()[0]
                )
                == series()[69][1]
            )
            evidence["pps"] = (
                "240 points preserved; warm tick uses two 3-point requests and zero row updates; current/old corrections and 90d APY verified; failed repair retries"
            )
            VAULTS.append(vault(MARKETS[2]))
            kong._run_kong_snapshot_ingestion(conn)
            COUNTS.clear()
            kong._run_kong_ingestion(conn)
            assert COUNTS["gql_full"] == 1 and COUNTS["gql_tail"] == 2
            assert (
                conn.execute("SELECT COUNT(*) FROM pps_timeseries").fetchone()[0] == 360
            )
            evidence["onboarding"] = (
                "new vault receives full history while existing vaults use recent tails"
            )

            COUNTS.clear()
            markets = flex._discover_markets(conn, HEAD)
            assert len(markets) == 2 and COUNTS["eth_getCode"] > 0
            COUNTS.clear()
            SCANS.clear()
            RISK, UNENDORSE = 123, True
            markets = flex._discover_markets(conn, HEAD)
            assert (
                COUNTS["eth_getCode"] == COUNTS["decimals()"] == COUNTS["symbol()"] == 0
            )
            assert all(high - low < 150 for low, high in SCANS)
            assert (
                markets[0]["min_debt_raw"] == 123
                and markets[0]["market_status"] == "unendorsed"
            )
            assert flex._sync_snapshots(conn, markets, HEAD, HOUR, 48) == 6
            before = conn.execute(
                "SELECT SUM(xmin::text::bigint) FROM flex_market_snapshots"
            ).fetchone()[0]
            COUNTS.clear()
            assert flex._sync_snapshots(conn, markets, HEAD, HOUR, 48) == 0
            assert COUNTS["eth_call"] == 0
            assert (
                conn.execute(
                    "SELECT SUM(xmin::text::bigint) FROM flex_market_snapshots"
                ).fetchone()[0]
                == before
            )
            conn.execute(
                "DELETE FROM flex_market_snapshots WHERE market_address=%s AND sampled_hour=%s",
                (MARKETS[1], HOUR),
            )
            stable = conn.execute(
                "SELECT xmin::text FROM flex_market_snapshots WHERE market_address=%s AND sampled_hour=%s",
                (MARKETS[0], HOUR),
            ).fetchone()[0]
            assert flex._sync_snapshots(conn, markets, HEAD, HOUR, 48) == 1
            assert (
                conn.execute(
                    "SELECT xmin::text FROM flex_market_snapshots WHERE market_address=%s AND sampled_hour=%s",
                    (MARKETS[0], HOUR),
                ).fetchone()[0]
                == stable
            )
            HEAD = 1500
            for failure in ("factory", "registry"):
                BAD_DEPLOYMENT = failure
                try:
                    flex._discover_markets(conn, HEAD)
                except ValueError:
                    conn.rollback()
                else:
                    raise AssertionError("partial discovery was accepted")
                assert flex._sync_cursor(conn, "discovery") == 1200
            BAD_DEPLOYMENT = False
            markets = flex._discover_markets(conn, HEAD)
            assert len(markets) == 3
            COUNTS.clear()
            SCANS.clear()
            subprocess.run(
                [sys.executable, __file__, "--resume-discovery"],
                env=os.environ,
                check=True,
                timeout=20,
            )
            assert COUNTS["eth_getCode"] == 0 and all(
                high - low < 150 for low, high in SCANS
            )
            evidence["flex"] = (
                "warm/restarted discovery avoids creation/token reads; incremental lifecycle catches new markets, unendorsement and risk updates; six valid hourly samples, zero warm RPCs, one-row gap repair"
            )

            styfi._run_styfi_snapshot(conn)
            assert (
                conn.execute("SELECT COUNT(*) FROM styfi_epoch_stats").fetchone()[0]
                == 12
            )
            COUNTS.clear()
            styfi._run_styfi_snapshot(conn)
            assert (
                COUNTS["epoch_rewards(uint256)"] == 2
                and COUNTS["rewards(address,uint256)"] == 8
            )
            conn.execute(
                "UPDATE styfi_epoch_stats SET fetched_at=NOW()-INTERVAL '2 days',reward_total_raw=1 WHERE epoch=8"
            )
            styfi._run_styfi_snapshot(conn)
            assert (
                int(
                    conn.execute(
                        "SELECT reward_total_raw FROM styfi_epoch_stats WHERE epoch=8"
                    ).fetchone()[0]
                )
                == 1000
            )
            EPOCH += 1
            styfi._run_styfi_snapshot(conn)
            assert (
                conn.execute("SELECT MAX(epoch) FROM styfi_epoch_stats").fetchone()[0]
                == EPOCH
            )
            evidence["styfi"] = (
                "warm history reads fall from 60 to 10 reward calls; daily correction and epoch rollover verified"
            )

            accounting._run_protocol_tvl_ingestion(conn)
            COUNTS.clear()
            accounting._run_protocol_tvl_ingestion(conn, if_due=True)
            assert COUNTS["/protocols"] == 0
            conn.execute(
                "UPDATE protocol_tvl_snapshots SET observed_at=NOW()-INTERVAL '2 hours'"
            )
            accounting._run_protocol_tvl_ingestion(conn, if_due=True)
            assert COUNTS["/protocols"] == 1
            for age in (50, 40):
                conn.execute(
                    "INSERT INTO flex_reconciliations(checked_at,rpc_block_number,verdict,source_url) VALUES(NOW()-(%s*INTERVAL '1 day'),1,'ok','fixture')",
                    (age,),
                )
            for status, index in [("sent", 1), ("failed", 2)]:
                conn.execute(
                    """INSERT INTO notification_deliveries(source_type,chain_id,tx_hash,log_index,destination_key,status,
                    attempts,last_attempted_at,delivered_at,payload) VALUES('fixture',1,'tx',%s,'styfi',%s,1,NOW()-INTERVAL '40 days',
                    CASE WHEN %s='sent' THEN NOW()-INTERVAL '40 days' END,%s)""",
                    (index, status, status, Jsonb({"content": "fixture"})),
                )
            kong._cleanup_old_data(conn)
            assert (
                conn.execute("SELECT COUNT(*) FROM styfi_epoch_stats").fetchone()[0]
                == 13
            )
            assert (
                conn.execute("SELECT COUNT(*) FROM flex_reconciliations").fetchone()[0]
                == 1
            )
            rows = conn.execute(
                "SELECT status,payload FROM notification_deliveries ORDER BY log_index"
            ).fetchall()
            assert rows == [("sent", {}), ("failed", {"content": "fixture"})]
            assert not notifications._deliver_discord_notification(
                conn,
                source_type="fixture",
                chain_id=1,
                tx_hash="tx",
                log_index=1,
                destination_key="styfi",
                payload={"content": "duplicate"},
            )
            evidence["maintenance"] = (
                "hourly TVL refresh; cleanup keeps epoch lookback, latest diagnostic, failed payload and sent dedupe key"
            )

            barrier = threading.Barrier(2)

            def competing_delivery():
                with psycopg.connect(scoped) as connection:
                    barrier.wait(timeout=5)
                    return notifications._deliver_discord_notification(
                        connection,
                        source_type="fixture",
                        chain_id=1,
                        tx_hash="race",
                        log_index=3,
                        destination_key="styfi",
                        payload={"content": "concurrent fixture"},
                    )

            before = COUNTS["deliveries"]
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: competing_delivery(), range(2)))
            assert (
                sorted(results) == [False, True] and COUNTS["deliveries"] == before + 1
            )
            evidence["delivery_race"] = (
                "two competing connections deliver the same notification exactly once"
            )

            SLOW = True
            env = dict(
                os.environ,
                WORKER_INTERVAL_SEC="2",
                PYTHONPATH=str(ROOT / "worker"),
                DB_CLEANUP_ENABLED="0",
            )
            with (OUT / "scheduler.log").open("w") as log:
                worker_started = datetime.now(UTC)
                process = subprocess.Popen(
                    [sys.executable, "-m", "worker.main"],
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
                assert ENTERED.wait(10), "ingestion did not reach blocked HTTP request"
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    status = conn.execute(
                        "SELECT status FROM notification_deliveries WHERE tx_hash='tx' AND log_index=2"
                    ).fetchone()[0]
                    if status == "sent":
                        break
                    time.sleep(0.05)
                assert (
                    status == "sent"
                    and COUNTS["deliveries"] == before + 2
                    and not RELEASE.is_set()
                ), "retry waited for slow ingestion"
                RELEASE.set()
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if conn.execute(
                        "SELECT COUNT(*) FROM ingestion_runs WHERE job_name='kong_vault_snapshot' AND status='success' AND started_at > %s",
                        (worker_started,),
                    ).fetchone()[0]:
                        break
                    time.sleep(0.05)
                process.terminate()
                process.wait(timeout=5)
                process = None
            evidence["independent_retry"] = (
                "persisted failure delivered through loopback webhook while catalog HTTP request remained blocked"
            )
        (OUT / "results.json").write_text(
            json.dumps({"status": "PASS", "checks": evidence}, indent=2) + "\n"
        )
        print(json.dumps(evidence, indent=2))
    finally:
        RELEASE.set()
        if process is not None:
            process.terminate()
            process.wait(timeout=5)
        server.shutdown()
        server.server_close()
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    main()
