"""Exercise the real builder and HTTP service against local HTTP upstream fixtures.

Run: uv run --directory yearn-wrapped python tests/verify_http.py
Results, logs, and a fixture recap are saved in data/verification/http/.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
GOOD, EMPTY, FAIL, PARTIAL, PRICE_FAIL, SLOW, QUEUED, BUSY = [
    "0x" + c * 40 for c in "abcde123"
]
VAULT = "0x696d02Db93291651ED510704c9b286841d506987"
START = int(datetime(2026, 4, 1, tzinfo=UTC).timestamp())


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Upstream(BaseHTTPRequestHandler):
    counts = Counter()
    lock = threading.Lock()
    fail_graphql = True
    slow_started = threading.Event()
    release_slow = threading.Event()

    def log_message(self, *_):
        pass

    def reply(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    @classmethod
    def count(cls, address, kind):
        with cls.lock:
            cls.counts[(address, kind)] += 1

    def do_POST(self):
        query = json.loads(self.rfile.read(int(self.headers["Content-Length"])))[
            "query"
        ]
        assert (
            "_ilike" in query
            and "chainId: {_in: [1, 137, 8453, 42161, 747474]}" in query
        )
        address = re.search(r"0x[0-9a-fA-F]{40}", query)[0].lower()
        kind = re.search(r"page: (Deposit|Withdraw|Transfer)", query)[1]
        self.count(address, kind)
        if address == FAIL and self.fail_graphql:
            return self.reply(503, {"error": "fixture outage"})
        if address == SLOW:
            self.slow_started.set()
            assert self.release_slow.wait(10)
        if address == EMPTY:
            rows = []
        else:
            base = {
                "chainId": 1,
                "vaultAddress": VAULT,
                "owner": address,
                "sender": address,
                "receiver": address,
                "transactionHash": "0x" + "1" * 64,
            }
            if kind == "Deposit":
                rows = [
                    {
                        **base,
                        "blockTimestamp": START,
                        "shares": str(100 * 10**18),
                        "assets": "100000000",
                    }
                ]
            elif kind == "Withdraw":
                rows = [
                    {
                        **base,
                        "blockTimestamp": START + 180 * 86400,
                        "shares": str(10 * 10**18),
                        "assets": "10000000",
                    }
                ]
            else:
                incoming = "receiver: {_ilike:" in query
                rows = [
                    {
                        **base,
                        "blockTimestamp": START if incoming else START + 180 * 86400,
                        "value": str((100 if incoming else 10) * 10**18),
                    }
                ]
        self.reply(200, {"data": {"page": rows}})

    def do_GET(self):
        if "/timeseries/" in self.path:
            return self.reply(200, [])
        if "/market_chart" in self.path:
            return self.reply(200, {"prices": []})
        address = re.search(r"address=(0x[0-9a-fA-F]{40})", self.path)[1].lower()
        history = self.path.startswith("/api/holdings/history")
        self.count(address, "history" if history else "portfolio")
        if address == PRICE_FAIL and history:
            return self.reply(503, {"error": "fixture price outage"})
        if history:
            return self.reply(
                200,
                {
                    "dataPoints": [
                        {"date": "2026-04-01", "value": 100},
                        {"date": "2026-07-01", "value": 120},
                        {"date": "2026-10-19", "value": 110},
                    ]
                },
            )
        complete = address != PARTIAL
        self.reply(
            200,
            {
                "growth": {
                    "summary": {
                        "isComplete": complete,
                        "totalVaults": 1,
                        "completeVaults": int(complete),
                        "partialVaults": int(not complete),
                    },
                    "vaults": [
                        {
                            "vaultAddress": VAULT,
                            "chainId": 1,
                            "metadata": {"symbol": "USDC"},
                            "growthUsd": 20,
                            "growthPct": 20,
                            "annualizedProtocolReturnPct": 30,
                            "status": "ok" if complete else "partial",
                            "issues": [] if complete else ["missing price"],
                        }
                    ],
                }
            },
        )


def main():
    artifacts = ROOT / "data/verification/http"
    artifacts.mkdir(parents=True, exist_ok=True)
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    api_port = free_port()
    source = f"http://127.0.0.1:{upstream.server_port}"
    checks = []
    with tempfile.TemporaryDirectory(prefix="yearn-wrapped-http-") as cache:
        env = {
            **os.environ,
            "YEARN_WRAPPED_GRAPHQL_URL": source + "/graphql",
            "YEARN_WRAPPED_YEARNFI_URL": source,
            "YEARN_WRAPPED_KONG_URL": source,
            "YEARN_WRAPPED_MARKET_URL": source,
            "YEARN_WRAPPED_UPSTREAM_CACHE_DIR": cache,
            "YEARN_WRAPPED_TTL": "2",
            "YEARN_WRAPPED_EMPTY_TTL": "2",
            "YEARN_WRAPPED_CONCURRENT_BUILDS": "1",
            "YEARN_WRAPPED_MAX_PENDING": "2",
        }
        with (artifacts / "service.log").open("w") as log:
            process = subprocess.Popen(
                [
                    "uv",
                    "run",
                    "--directory",
                    str(ROOT),
                    "uvicorn",
                    "service:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(api_port),
                ],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                with httpx.Client(
                    base_url=f"http://127.0.0.1:{api_port}", timeout=40
                ) as client:
                    for _ in range(100):
                        if process.poll() is not None:
                            raise RuntimeError("Service exited during startup")
                        try:
                            if client.get("/health").status_code == 200:
                                break
                        except httpx.ConnectError:
                            pass
                        time.sleep(0.1)
                    else:
                        raise RuntimeError("Service did not start")

                    def get(address, **params):
                        return client.get(
                            "/api/recap", params={"address": address, **params}
                        )

                    for address in (
                        "bad",
                        "vitalik.eth",
                        GOOD + "x",
                        "0x" + "g" * 40,
                        "0x' OR 1=1",
                    ):
                        assert get(address).status_code == 400
                    assert client.get("/api/recap").status_code == 400
                    assert get(GOOD, year=2025).status_code == 422
                    assert get(GOOD, year="oops").status_code == 422
                    assert not Upstream.counts
                    checks.append(
                        "Malformed/missing addresses and unsupported years never reach upstreams"
                    )

                    first = get(GOOD)
                    assert (
                        first.status_code == 200
                        and first.headers["X-Recap-Cache"] == "MISS"
                    ), first.text
                    payload = first.json()
                    assert payload["version"] == 1 and payload["address"] == GOOD
                    assert payload["cards"]["valuation"]["isComplete"] is True
                    counts = Upstream.counts.copy()
                    second = get("0x" + "A" * 40)
                    assert (
                        second.headers["X-Recap-Cache"] == "HIT"
                        and second.json() == payload
                    )
                    assert Upstream.counts == counts
                    checks.append(
                        "Case-insensitive address cache hits avoid all upstream requests"
                    )

                    # Independent financial cases live in verify_accounting.py;
                    # comparing this API against its own builder would miss them.
                    assert payload["cards"]["vaultGrowth"]["totalGrowthUsd"] is None
                    assert not payload["cards"]["vaultGrowth"]["isComplete"]
                    checks.append(
                        "Missing period prices remain unknown, never a fabricated zero"
                    )

                    time.sleep(2.1)
                    counts = Upstream.counts.copy()
                    refreshed = get(GOOD)
                    assert refreshed.headers["X-Recap-Cache"] == "MISS"
                    assert (
                        Upstream.counts[(GOOD, "Deposit")]
                        == counts[(GOOD, "Deposit")] + 1
                    )
                    assert (
                        Upstream.counts[(GOOD, "history")] == counts[(GOOD, "history")]
                    )
                    checks.append(
                        "Expired payloads rebuild events while reusing the independent six-hour holdings cache"
                    )

                    assert get(EMPTY).status_code == 404
                    counts = Upstream.counts.copy()
                    assert (
                        get(EMPTY).headers["X-Recap-Cache"] == "HIT"
                        and Upstream.counts == counts
                    )
                    assert Upstream.counts[(EMPTY, "history")] == 0
                    checks.append(
                        "Zero supported-chain history is a cached 404, without extra price API requests"
                    )

                    partial = get(PARTIAL)
                    assert partial.status_code == 200
                    assert partial.json()["cards"]["vaultGrowth"]["isComplete"] is False
                    assert partial.json()["cards"]["vaultGrowth"]["vaults"][0][
                        "issues"
                    ] == ["missing_period_prices"]
                    checks.append(
                        "Valid incomplete upstream data preserves flags/issues and remains a 200"
                    )

                    assert get(FAIL).status_code == 502
                    assert Upstream.counts[(FAIL, "Deposit")] == 4
                    Upstream.fail_graphql = False
                    assert get(FAIL).status_code == 200
                    assert get(PRICE_FAIL).status_code == 502
                    assert Upstream.counts[(PRICE_FAIL, "history")] == 3
                    checks.append(
                        "GraphQL and holdings outages exhaust retries and return 502; failures do not poison the cache"
                    )

                    with ThreadPoolExecutor(max_workers=4) as pool:
                        slow = pool.submit(get, SLOW)
                        assert Upstream.slow_started.wait(5)
                        duplicate = pool.submit(get, SLOW)
                        queued = pool.submit(get, QUEUED)
                        time.sleep(0.25)
                        busy = get(BUSY)
                        assert (
                            busy.status_code == 503
                            and busy.headers["Retry-After"] == "5"
                        )
                        Upstream.release_slow.set()
                        results = [slow.result(), duplicate.result(), queued.result()]
                    assert all(r.status_code == 200 for r in results)
                    assert {r.headers["X-Recap-Cache"] for r in results[:2]} == {
                        "MISS",
                        "COALESCED",
                    }
                    assert results[0].json() == results[1].json()
                    assert Upstream.counts[(SLOW, "Deposit")] == 1
                    checks.append(
                        "Concurrent duplicate wallets share one build; distinct-wallet bursts are bounded with Retry-After"
                    )
                    assert client.get("/replay.html").status_code == 200
                    assert client.get("/assets/sample-recap.json").status_code == 200
                    for private in (
                        "/service.py",
                        "/tools/recap.py",
                        "/.env",
                        "/assets/.transfer-test.json",
                    ):
                        assert client.get(private).status_code == 404
                    checks.append(
                        "Static replay and API share an origin without route shadowing"
                    )
                result = {
                    "passed": True,
                    "checked_at": datetime.now(UTC).isoformat(),
                    "checks": checks,
                }
                (artifacts / "result.json").write_text(
                    json.dumps(result, indent=2) + "\n"
                )
                print(json.dumps(result, indent=2))
            finally:
                Upstream.release_slow.set()
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                upstream.shutdown()


if __name__ == "__main__":
    main()
