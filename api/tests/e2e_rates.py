"""HTTP sources -> worker -> disposable PostgreSQL -> real API rate regression.

Run with uv, api/requirements.txt, worker/requirements.txt and --with httpx.
Failure modes: gross/net precedence, valid zero/negative estimates, wrong-kind
locker visibility, double-counted TVL, base-only APR mislabeled as total,
missing/stale price, unfinalized rewards, missing boost reads and empty proposals.
"""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx
import psycopg
from eth_utils import keccak
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/rate-fixes"
OUT.mkdir(parents=True, exist_ok=True)
NOW = int(time.time())
WAD, YEAR, EPOCH = 10**18, 365 * 86400, 14 * 86400
BASE = 160 * 100 * EPOCH * WAD // YEAR
STAKING = "0x95547ede56cf74b73dd78a37f547127dffda6113"
BOOST = "0xa139250bcb3880a97c75fd4287d5bf2a6caf98a3"
REWARD = "0xbe53a351b2ee341bdb0c8e2c61508e96b7b36204"
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
UNLOCKED = "0x696d02db93291651ed510704c9b286841d506987"
LOCKED = "0xaaafea48472f77563961cdb53291dedfb46f9040"
CRV = "0xbf319ddc2edc1eb6fdf9910e39b37be221c8805f"
MODE = "valid"
SOURCES = {
    "meta": {"timestamp": NOW, "epoch": 18, "blockNumber": 100},
    "global": {
        "yfi": {
            "priceCts": "200000",
            "priceStatus": "fresh",
            "priceStale": False,
            "priceSource": "chainlink:yfi-usd",
            "priceFeed": "0xA027702dbb89fbd58938e4324ac03B58d812b0E1",
            "priceUpdatedAt": NOW,
            "priceMaxAgeSeconds": 86400,
        },
        "rewards": {"pps": str(WAD)},
    },
    "styfi": {"current": {"aprBps": "800"}, "projected": {"aprBps": "1100"}},
    "styfix": {"current": {"aprBps": "800"}, "projected": {"aprBps": "1100"}},
}
VAULTS = [
    {
        "address": address,
        "chainId": 1,
        "symbol": symbol,
        "apiVersion": "3.0.4",
        "kind": kind,
        "origin": "yearn",
        "inclusion": {"isYearn": True},
        "isHidden": False,
        "isRetired": False,
        "tvl": tvl,
        "asset": {"address": USDC, "symbol": "USDC", "decimals": 6},
        "performance": performance,
    }
    for address, symbol, kind, tvl, performance in [
        (
            UNLOCKED,
            "yvUSD",
            "Multi Strategy",
            1000,
            {"estimated": {"apy": 0.0602}, "oracle": {"apy": 0.0611, "netAPY": 0.0611}},
        ),
        (
            LOCKED,
            "Locked yvUSD",
            "None",
            400,
            {"estimated": {"apy": 0.0773}, "oracle": {"apy": 0.0156, "netAPY": 0.0156}},
        ),
        (
            CRV,
            "yvcrvUSD-2",
            "Multi Strategy",
            500,
            {"oracle": {"apy": 0.0696, "netAPY": 0.0625}},
        ),
    ]
]
SIGNATURES = {
    keccak(text=s)[:4].hex(): s
    for s in [
        "epoch()",
        "last_epoch()",
        "token()",
        "decimals()",
        "asset()",
        "convertToAssets(uint256)",
        "total_weight_cursor()",
        "total_weight_entries(uint256)",
        "components(address)",
        "rewards(address,uint256)",
        "packed_total_weights(uint256)",
        "num_proposals(uint256)",
        "weight(uint256,address)",
        "balanceOf(address)",
        "totalSupply()",
        "num_votes(uint256,address)",
    ]
}


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        data = json.loads(json.dumps(SOURCES))
        if MODE == "stale_price":
            data["global"]["yfi"]["priceUpdatedAt"] = NOW - 90000
        self.send(VAULTS if self.path == "/vaults" else data)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method, params = request["method"], request["params"]
        if method == "eth_chainId":
            result = "0x1"
        elif method == "eth_getBlockByNumber":
            result = {"number": "0x64", "timestamp": hex(NOW), "hash": "0x" + "a" * 64}
        else:
            assert method == "eth_call" and params[1] == "0x64"
            call = params[0]
            signature = SIGNATURES[call["data"][2:10]]
            arg = call["data"][10:]
            boost = BOOST[2:] in arg.lower()
            values = {
                "epoch()": [18],
                "last_epoch()": [17 if MODE == "unfinalized" else 18],
                "token()": [int(REWARD, 16)],
                "decimals()": [6 if call["to"].lower() == USDC else 18],
                "asset()": [int(USDC, 16)],
                "convertToAssets(uint256)": [10**6],
                "total_weight_cursor()": [1, 0],
                "total_weight_entries(uint256)": [17, 100 * WAD],
                "components(address)": [1, 18, 6 if boost else 4, 1],
                "rewards(address,uint256)": [BASE * 3 // 2 if boost else BASE],
                "packed_total_weights(uint256)": [
                    (600 * WAD // 10**10) << (50 * (17 % 5))
                ],
                "num_proposals(uint256)": [0 if MODE == "no_proposals" else 6],
                "num_votes(uint256,address)": [6],
                "weight(uint256,address)": [60 * WAD],
                "balanceOf(address)": [10 * WAD],
                "totalSupply()": [10 * WAD],
            }[signature]
            if MODE == "missing_boost" and boost:
                return self.send(
                    {
                        "jsonrpc": "2.0",
                        "id": request["id"],
                        "error": {"code": -32000, "message": "Unavailable"},
                    }
                )
            result = "0x" + "".join(f"{v:064x}" for v in values)
        self.send({"jsonrpc": "2.0", "id": request["id"], "result": result})


def main():
    global MODE
    spec = importlib.util.spec_from_file_location(
        "connection", ROOT / "api/tests/e2e_flex_performance.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base_dsn = module.dsn()
    schema = "rates_e2e_" + uuid.uuid4().hex[:12]
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
    server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    upstream = f"http://127.0.0.1:{server.server_port}"
    os.environ.update(
        DATABASE_URL=scoped,
        ETH_RPC_URL=upstream,
        STYFI_SITE_GLOBAL_DATA_URL=upstream + "/global-data",
        KONG_REST_VAULTS_URL=upstream + "/vaults",
    )
    sys.path.insert(0, str(ROOT / "worker"))
    from worker.config import DDL, UPSERT_SQL
    from worker.kong import _fetch_kong_snapshot, _normalize_kong_snapshot
    from worker.styfi import _fetch_styfi_site_reward_state

    proc = None
    try:
        with psycopg.connect(base_dsn, autocommit=True) as connection:
            connection.execute(f"CREATE SCHEMA {schema}")
        with psycopg.connect(scoped, autocommit=True) as connection:
            connection.execute(DDL)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        with (OUT / "api.log").open("w") as log:
            proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--lifespan",
                    "off",
                    "--port",
                    str(port),
                ],
                env={**os.environ, "PYTHONPATH": str(ROOT / "api")},
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}", timeout=20
            ) as client:
                for _ in range(100):
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    time.sleep(0.1)
                results = {}
                for mode in (
                    "valid",
                    "stale_price",
                    "unfinalized",
                    "missing_boost",
                    "no_proposals",
                ):
                    MODE = mode
                    state = _fetch_styfi_site_reward_state()
                    with psycopg.connect(scoped, autocommit=True) as connection:
                        connection.execute(
                            "INSERT INTO styfi_sync_state(stream_name,chain_id,payload) VALUES ('styfi_reward_epoch',1,%s) ON CONFLICT(stream_name) DO UPDATE SET payload=excluded.payload",
                            (
                                Jsonb(
                                    {
                                        "current_reward_state": state,
                                        "reward_token": {
                                            "address": REWARD,
                                            "symbol": "yvUSDC-1",
                                            "decimals": 18,
                                        },
                                    }
                                ),
                            ),
                        )
                    response = client.get(
                        "/api/styfi", params={"include_history": "false"}
                    )
                    assert response.status_code == 200, response.text
                    result = response.json()["current_reward_state"]
                    results[mode] = result
                    if mode == "valid":
                        assert abs(result["styfi_base_apr"] - 0.08) < 1e-7
                        assert abs(result["styfi_estimated_max_apr"] - 0.20) < 1e-7
                        assert abs(result["styfix_current_apr"] - 0.20) < 1e-7
                    elif mode == "no_proposals":
                        assert (
                            abs(result["styfi_max_apr"] - result["styfi_base_apr"])
                            < 1e-7
                        )
                    else:
                        assert (
                            result["styfi_estimated_max_apr"] is None
                            and result["styfix_current_apr"] is None
                        ), mode
                rows = _normalize_kong_snapshot(_fetch_kong_snapshot()[0])
                for row, expected in zip(rows, [0.0602, 0.0773, 0.0625], strict=True):
                    assert row["est_apy"] == expected
                for value in (0, -0.01):
                    sample = {
                        **VAULTS[0],
                        "performance": {
                            "estimated": {"apy": value},
                            "oracle": {"netAPY": 0.05},
                        },
                    }
                    assert _normalize_kong_snapshot([sample])[0]["est_apy"] == value
                with (
                    psycopg.connect(scoped, autocommit=True) as connection,
                    connection.cursor() as cursor,
                ):
                    cursor.executemany(UPSERT_SQL, rows)
                    cursor.executemany(
                        "INSERT INTO vault_metrics_latest(chain_id,vault_address,as_of,points_count,apy_30d,apy_7d) VALUES (1,%s,NOW(),120,0.02,0.03)",
                        [(r["vault_address"],) for r in rows],
                    )
                response = client.get(
                    "/api/discover",
                    params={"universe": "raw", "min_tvl_usd": 0, "min_points": 0},
                )
                assert response.status_code == 200, response.text
                discover = response.json()
                assert len(discover["rows"]) == 3
                locked = next(r for r in discover["rows"] if r["symbol"] == "Locked yvUSD")
                assert locked["realized_apy_30d"] is None, "Locker-only PPS must not be shown as combined realized APY"
                assert locked["momentum_7d_30d"] is None
                assert discover["summary"]["total_tvl_usd"] == 1500, (
                    "A wrapper must not count its underlying TVL twice"
                )
                (OUT / "api-results.json").write_text(
                    json.dumps(
                        {"passed": True, "staking": results, "discover": discover},
                        indent=2,
                    )
                    + "\n"
                )
                print("Rate HTTP/worker/PostgreSQL/API E2E passed")
    finally:
        if proc:
            proc.terminate()
            proc.wait(timeout=10)
        server.shutdown()
        with psycopg.connect(base_dsn, autocommit=True) as connection:
            connection.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    main()
