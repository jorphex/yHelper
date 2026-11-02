"""Real Kong HTTP fixture -> API -> disposable PostgreSQL vault history checks.

Covers humanized PPS/TVL units, full rolling windows, gaps, extreme values,
validation before upstream calls, stored-data fallback, caching/coalescing and
bounded concurrency without starving health requests. No production writes.
Results: reports/vault-detail/api-results.json. Run with uv and both requirements.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import psycopg
from psycopg.conninfo import make_conninfo

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/vault-detail"
DAY = 86400
TODAY = int(datetime.now(UTC).timestamp()) // DAY * DAY
ADDRESSES = ["0x" + f"{n:040x}" for n in range(1, 11)]
COUNTS = Counter()
RELEASE = threading.Event()
WARM_FAILURE = threading.Event()


class Kong(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        address = request["variables"]["address"]
        COUNTS[address] += 1
        index = ADDRESSES.index(address)
        if index in (5, 6):
            RELEASE.wait(10)
        pps = [
            {"time": TODAY - (98 - i) * DAY, "value": 1.05 * 1.0001**i}
            for i in range(99)
        ]
        tvl = [
            {"time": row["time"], "value": 2_000_000 + i * 1000}
            for i, row in enumerate(pps)
        ]
        if index == 1:
            pps = [row for row in pps if row["time"] != TODAY - 7 * DAY]
            tvl = [row for row in tvl if row["time"] != TODAY - 5 * DAY]
        if index == 2:
            pps[-1]["value"] = 1e100
        if index == 4:
            tvl = None
        if index == 8 and WARM_FAILURE.is_set():
            tvl = None
        if index in (8, 9):
            pps = None
        if index == 4 and WARM_FAILURE.is_set():
            pps = None
        body = json.dumps({"data": {"pps": pps, "tvl": tvl}}).encode()
        self.send_response(502 if index == 3 else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "api-results.json").write_text('{"status":"RUNNING"}\n')
    spec = importlib.util.spec_from_file_location(
        "connection", ROOT / "api/tests/e2e_flex_performance.py"
    )
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    base = fixture.dsn()
    schema = "vault_history_" + uuid.uuid4().hex[:12]
    scoped = make_conninfo(base, options=f"-csearch_path={schema}")
    sys.path.insert(0, str(ROOT / "worker"))
    from worker.config import DDL

    server = ThreadingHTTPServer(("127.0.0.1", 0), Kong)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    env = dict(
        os.environ,
        DATABASE_URL=scoped,
        KONG_GQL_URL=f"http://127.0.0.1:{server.server_port}",
        PYTHONPATH=str(ROOT / "api"),
    )
    process = None
    checks = {}
    try:
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"CREATE SCHEMA {schema}")
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute(DDL)
            for index, address in enumerate(ADDRESSES):
                conn.execute(
                    """INSERT INTO vault_dim(chain_id,vault_address,symbol,name,token_symbol,token_decimals,est_apy,active,origin,raw)
                    VALUES(1,%s,'yvUSDC-1','USDC yVault','USDC',%s,.06,TRUE,'yearn','{}')""",
                    (address, 18 if index == 1 else 6),
                )
            for ts, value in [(TODAY - 7 * DAY, 1_090_000), (TODAY, 1_100_000)]:
                conn.execute(
                    "INSERT INTO pps_timeseries(chain_id,vault_address,ts,pps_raw) VALUES(1,%s,%s,%s)",
                    (ADDRESSES[3], ts, value),
                )
            for index, shift in ((8, 0), (9, 10)):
                for i in range(99):
                    conn.execute(
                        "INSERT INTO pps_timeseries(chain_id,vault_address,ts,pps_raw) VALUES(1,%s,%s,%s)",
                        (ADDRESSES[index], TODAY - (98 - i + shift) * DAY, round(1.05 * 1.0001**i * 1e6)),
                    )
        with (OUT / "api-e2e.log").open("w") as log:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            with httpx.Client(base_url=origin, timeout=25) as client:
                for _ in range(100):
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.HTTPError:
                        time.sleep(0.05)
                else:
                    raise AssertionError("API did not start")
                url = lambda address: f"/api/vaults/1/{address}/history"
                response = client.get(url(ADDRESSES[0]))
                assert response.status_code == 200, response.text
                payload = response.json()
                assert len(payload["points"]) == 91
                assert abs(payload["points"][-1]["apy_7d"] - (1.0001**365 - 1)) < 1e-10
                assert abs(payload["points"][-1]["pps"] - 1.05 * 1.0001**98) < 1e-10
                assert payload["points"][-1]["tvl_usd"] == 2_098_000
                assert payload["history_state"] == "ready"
                client.get(url(ADDRESSES[0]))
                assert COUNTS[ADDRESSES[0]] == 1
                checks["units_cache"] = (
                    "Humanized PPS, actual USD TVL, full 7d APY, 90d history and cached repeat"
                )
                count = sum(COUNTS.values())
                assert client.get(url("bad")).status_code == 422
                assert (
                    client.get(
                        "/api/vaults/999/" + ADDRESSES[0] + "/history"
                    ).status_code
                    == 404
                )
                assert client.get(url("0x" + "f" * 40)).status_code == 404
                assert sum(COUNTS.values()) == count
                checks["validation"] = "Invalid/unknown identities never reach Kong"
                gaps = client.get(url(ADDRESSES[1])).json()
                assert gaps["points"][-1]["apy_7d"] is None
                assert (
                    next(
                        row
                        for row in gaps["points"]
                        if row["timestamp"] == TODAY - 5 * DAY
                    )["tvl_usd"]
                    is None
                )
                assert gaps["points"][-1]["pps"] > 1
                assert (
                    client.get(url(ADDRESSES[2])).json()["points"][-1]["apy_7d"] is None
                )
                checks["coverage"] = (
                    "Missing days stay missing; no partial 7d window or overflow on extreme yield"
                )
                fallback = client.get(url(ADDRESSES[3])).json()
                assert (
                    fallback["history_state"] == "partial"
                    and fallback["pps_source"] == "stored"
                )
                assert (
                    fallback["points"][-1]["pps"] == 1.1
                    and fallback["points"][-1]["tvl_usd"] is None
                )
                partial = client.get(url(ADDRESSES[4])).json()
                assert (
                    partial["tvl_source"] == "unavailable"
                    and partial["pps_source"] == "kong"
                )
                checks["failure"] = (
                    "Stored PPS survives outage with correct decimals; absent TVL is not zero-filled"
                )
                mixed = client.get(url(ADDRESSES[8])).json()
                assert mixed["pps_source"] == "stored" and mixed["tvl_source"] == "kong"
                assert mixed["history_delayed"] is False
                assert 0 < mixed["retry_after_seconds"] <= 15
                with psycopg.connect(scoped, autocommit=True) as conn:
                    conn.execute(
                        "DELETE FROM pps_timeseries WHERE vault_address = %s AND ts < %s",
                        (ADDRESSES[8], TODAY - 90 * DAY),
                    )
                WARM_FAILURE.set()
                time.sleep(mixed["retry_after_seconds"] + 0.1)
                degraded = client.get(url(ADDRESSES[8])).json()
                assert degraded["history_state"] == "partial"
                assert degraded["tvl_source"] == "cached"
                assert [p["tvl_usd"] for p in degraded["points"]] == [p["tvl_usd"] for p in mixed["points"]]
                assert [p["apy_7d"] for p in degraded["points"]] == [p["apy_7d"] for p in mixed["points"]]
                cached_pps = client.get(url(ADDRESSES[4])).json()
                assert cached_pps["pps_source"] == "cached"
                assert cached_pps["points"] == partial["points"]
                WARM_FAILURE.clear()
                count = COUNTS[ADDRESSES[8]]
                immediate = client.get(url(ADDRESSES[8])).json()
                assert immediate["tvl_source"] == "cached" and COUNTS[ADDRESSES[8]] == count
                assert 0 < immediate["retry_after_seconds"] <= 15
                time.sleep(immediate["retry_after_seconds"] + 0.1)
                recovered = client.get(url(ADDRESSES[8])).json()
                assert recovered["tvl_source"] == "kong" and COUNTS[ADDRESSES[8]] == count + 1
                stale = client.get(url(ADDRESSES[9])).json()
                assert stale["history_state"] == "partial" and stale["history_delayed"] is True
                checks["recovery_freshness"] = "Warm TVL/APY retained with cached source, retry cooldown respected, recovery succeeds, and old stored PPS flagged independently of coverage"

            async def concurrency():
                async with httpx.AsyncClient(base_url=origin, timeout=20) as client:
                    duplicates = [
                        asyncio.create_task(client.get(url(ADDRESSES[5])))
                        for _ in range(20)
                    ]
                    second = asyncio.create_task(client.get(url(ADDRESSES[6])))
                    for _ in range(100):
                        if COUNTS[ADDRESSES[5]] and COUNTS[ADDRESSES[6]]:
                            break
                        await asyncio.sleep(0.02)
                    probe = await client.get("/health")
                    busy = await client.get(url(ADDRESSES[7]))
                    assert probe.status_code == 200 and busy.status_code == 503
                    assert COUNTS[ADDRESSES[5]] == COUNTS[ADDRESSES[6]] == 1
                    RELEASE.set()
                    responses = await asyncio.gather(*duplicates, second)
                    assert all(item.status_code == 200 for item in responses)

            asyncio.run(concurrency())
            checks["concurrency"] = (
                "20 duplicates share one upstream call; only two unique jobs run; health remains responsive"
            )
        (OUT / "api-results.json").write_text(
            json.dumps({"status": "PASS", "checks": checks}, indent=2) + "\n"
        )
        print(json.dumps(checks, indent=2))
    finally:
        RELEASE.set()
        if process:
            process.terminate()
            process.wait(timeout=5)
        server.shutdown()
        server.server_close()
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    main()
