"""Networking regression scenarios: real HTTP/WebSockets, PostgreSQL and API.

Failure cases: recovery skips unscanned reports; RPC throttling is misclassified;
subscription control traffic prevents timeout/stop; SQL waits outlive clients;
duplicate slow archive requests consume the API's shared synchronous threads.
No production writes, real credentials or notifications. Results are saved under
reports/network-resilience-fix/. Run with uv, worker/api requirements and httpx.
"""

import concurrent.futures
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import psycopg
import requests
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/network-resilience-fix"
OUT.mkdir(parents=True, exist_ok=True)
VAULT, STRATEGY = "0x" + "1" * 40, "0x" + "2" * 40
counts, scans, retry_times = Counter(), [], []
archive_started, release_archive, close_ws = (
    threading.Event(),
    threading.Event(),
    threading.Event(),
)
sessions = []


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, payload, status=200, headers=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        counts[self.path] += 1
        if self.path == "/rpc-error":
            self.reply(
                {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    **(
                        {"error": {"code": 429, "message": "rate limited"}}
                        if counts[self.path] < 3
                        else {"result": "0x1"}
                    ),
                }
            )
            return
        if self.path == "/retry-after":
            retry_times.append(time.monotonic())
            if counts[self.path] < 3:
                self.reply({}, 429, {"Retry-After": "2"})
                return
            result = "0x1"
        elif self.path == "/archive":
            archive_started.set()
            release_archive.wait(8)
            result = "0x1"
        elif request["method"] == "eth_blockNumber":
            result = hex(2000)
        elif request["method"] == "eth_getLogs":
            query = request["params"][0]
            low, high = int(query["fromBlock"], 16), int(query["toBlock"], 16)
            scans.append([low, high])
            if high - low + 1 > 1000:
                self.reply({"error": {"message": "block range too large"}}, 400)
                return
            result = [event] if low <= 500 <= high else []
        else:
            raise AssertionError(request["method"])
        self.reply({"jsonrpc": "2.0", "id": request["id"], "result": result})

    def do_GET(self):
        self.reply(
            [
                {
                    "address": VAULT,
                    "chainId": 1,
                    "origin": "yearn",
                    "isHidden": False,
                    "isRetired": False,
                    "inclusion": {"isYearn": True},
                    "tvl": 123,
                    "kind": "Multi Strategy",
                    "apiVersion": "3.0.4",
                    "performance": {"oracle": {"netAPY": 0.05}},
                }
            ]
        )


def websocket_handler(connection):
    connection.recv(timeout=2)
    sessions.append(time.monotonic())
    try:
        while not close_ws.wait(0.04):
            connection.ping(b"no-subscription-ack")
    except ConnectionClosed:
        pass


spec = importlib.util.spec_from_file_location(
    "fixture", ROOT / "api/tests/e2e_flex_performance.py"
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
base = fixture.dsn()
schema = "network_review_" + uuid.uuid4().hex[:12]
scoped = make_conninfo(base, options=f"-csearch_path={schema}")
for key in list(os.environ):
    if any(
        part in key for part in ("RPC_URL", "WSS_URL", "DISCORD", "TELEGRAM", "ALERT_")
    ):
        os.environ.pop(key)
http = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
ws = serve(websocket_handler, "127.0.0.1", 0, ping_interval=None)
origin = f"http://127.0.0.1:{http.server_port}"
os.environ.update(
    DATABASE_URL=scoped,
    ETH_RPC_URL=origin + "/history",
    ETH_WSS_URL=f"ws://127.0.0.1:{ws.socket.getsockname()[1]}",
    HARVEST_WSS_ENABLED="0",
    KONG_REST_VAULTS_URL=origin + "/snapshot",
    DB_LOCK_TIMEOUT_MS="100",
    DB_STATEMENT_TIMEOUT_MS="2000",
)
sys.path.insert(0, str(ROOT / "worker"))
from worker.config import (  # noqa: E402
    DDL,
    EVENT_TOPIC_STRATEGY_REPORTED_V3,
    configure_logging,
)

from worker import eth, harvests, kong  # noqa: E402

configure_logging()
event = {
    "address": VAULT,
    "topics": [EVENT_TOPIC_STRATEGY_REPORTED_V3, "0x" + STRATEGY[2:].rjust(64, "0")],
    "data": "0x" + "".join(f"{v:064x}" for v in [123, 0, 1000, 0, 0, 0]),
    "blockNumber": hex(500),
    "blockTimestamp": hex(int(time.time())),
    "transactionHash": "0x" + "3" * 64,
    "logIndex": "0x0",
}
threading.Thread(target=http.serve_forever, daemon=True).start()
threading.Thread(target=ws.serve_forever, daemon=True).start()
api, listener = None, None
evidence = {}
try:
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(f"CREATE SCHEMA {schema}")
    with psycopg.connect(scoped, autocommit=True) as conn:
        conn.execute(DDL)
        conn.execute(
            "INSERT INTO vault_dim(chain_id,vault_address,version,raw) VALUES (1,%s,'3.0.4','{}')",
            (VAULT,),
        )
        conn.execute(
            "INSERT INTO vault_harvest_sync_state(chain_id,cursor,observed_at,payload) VALUES (1,100,NOW(),%s)",
            (
                Jsonb(
                    {
                        "wss_connected": False,
                        "wss_last_seen_block": 2000,
                        "notifications_primed": False,
                    }
                ),
            ),
        )
    with psycopg.connect(scoped) as conn:
        harvests._run_vault_harvests(conn)
        harvests._run_vault_harvests(conn)
        cursor = conn.execute(
            "SELECT cursor FROM vault_harvest_sync_state WHERE chain_id=1"
        ).fetchone()[0]
        reports = conn.execute(
            "SELECT COUNT(*) FROM vault_harvests WHERE block_number=500"
        ).fetchone()[0]
        states = conn.execute(
            "SELECT status FROM ingestion_runs WHERE job_name='vault_harvests'"
        ).fetchall()
    evidence["catchup"] = {
        "last_full_cursor": 100,
        "head": 2000,
        "missed_report_block": 500,
        "requested_ranges": scans,
        "cursor_after_two_runs": cursor,
        "report_found": bool(reports),
        "job_statuses": [row[0] for row in states],
    }

    rpc_result = None
    rpc_error = None
    try:
        rpc_result = eth._eth_rpc_to_url(origin + "/rpc-error", "eth_chainId", [])
    except Exception as exc:
        rpc_error = type(exc).__name__
    eth._eth_rpc_to_url(origin + "/retry-after", "eth_chainId", [])
    evidence["rpc_retry"] = {
        "jsonrpc_429_attempts": counts["/rpc-error"],
        "jsonrpc_result": rpc_result,
        "jsonrpc_429_exception": rpc_error,
        "http_429_retry_after_seconds": 2,
        "http_429_attempt_intervals": [
            round(b - a, 3) for a, b in zip(retry_times, retry_times[1:])
        ],
    }

    harvests.HARVEST_WSS_CONNECT_TIMEOUT_SEC = 0.15
    listener = harvests.HarvestWssListener(1, {VAULT: "3.0.4"})
    listener.start()
    deadline = time.monotonic() + 2
    while not sessions and time.monotonic() < deadline:
        time.sleep(0.01)
    assert sessions, "WebSocket fixture did not receive a subscription"
    time.sleep(0.75)
    listener.stop()
    listener.join(timeout=0.2)
    frame = sys._current_frames().get(listener.ident)
    stack = []
    while frame:
        stack.append(frame.f_code.co_name)
        frame = frame.f_back
    evidence["subscription_ack"] = {
        "socket_timeout_seconds": 0.15,
        "time_without_ack_seconds": round(time.monotonic() - sessions[0], 3),
        "sessions": len(sessions),
        "still_blocked_after_stop": listener.is_alive(),
        "waiting_for_ack": "_await_subscription_ack" in stack,
    }
    close_ws.set()
    listener.join(timeout=3)
    assert not listener.is_alive(), "Listener failed to clean up"

    with psycopg.connect(scoped) as lock, psycopg.connect(scoped) as conn:
        lock.execute("LOCK vault_dim IN ACCESS EXCLUSIVE MODE")
        conn.execute("SET lock_timeout='100ms'")
        conn.commit()
        escaped = None
        try:
            kong._run_kong_snapshot_ingestion(conn)
        except Exception as exc:
            escaped = type(exc).__name__
            conn.rollback()
        row = conn.execute(
            "SELECT status,ended_at,error_summary FROM ingestion_runs WHERE job_name='kong_vault_snapshot' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        lock.rollback()
        retry = kong._run_kong_snapshot_ingestion(conn)
    evidence["sql_recovery"] = {
        "escaped": escaped,
        "status": row[0],
        "ended": row[1] is not None,
        "original_error_recorded": "lock timeout" in (row[2] or ""),
        "retry_succeeded": retry[1] == 1,
    }

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    api_env = {
        **os.environ,
        "DATABASE_URL": make_conninfo(scoped, application_name="network-review-api"),
        "FLEX_PERFORMANCE_RPC_URL": origin + "/archive",
        "PYTHONPATH": str(ROOT / "api"),
    }
    with (OUT / "api.log").open("w") as log:
        api = subprocess.Popen(
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
            env=api_env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    api_url = f"http://127.0.0.1:{port}"
    with httpx.Client(base_url=api_url, timeout=2, trust_env=False) as client:
        deadline = time.monotonic() + 5
        while True:
            try:
                if client.get("/health").status_code == 200:
                    break
            except httpx.TransportError:
                pass
            assert time.monotonic() < deadline, "API did not start"
            time.sleep(0.05)
        baseline = client.get("/api/flex/markets")
        assert baseline.status_code == 200, baseline.text
        with psycopg.connect(scoped) as lock:
            lock.execute("LOCK flex_market_dim IN ACCESS EXCLUSIVE MODE")
            response = None
            try:
                response = client.get("/api/flex/markets", timeout=0.5)
                timed_out = False
            except httpx.ReadTimeout:
                timed_out = True
            with psycopg.connect(base, autocommit=True) as conn:
                waits = conn.execute(
                    "SELECT COUNT(*) FROM pg_stat_activity WHERE application_name='network-review-api' AND wait_event_type='Lock'"
                ).fetchone()[0]
            health = client.get("/health").status_code
            lock.rollback()
        with eth._connect() as conn:
            settings = {
                name: conn.execute(f"SHOW {name}").fetchone()[0]
                for name in ("statement_timeout", "lock_timeout")
            }
        evidence["database_waits"] = {
            "worker_settings": settings,
            "client_timed_out": timed_out,
            "response_status": response.status_code if response is not None else None,
            "queries_still_waiting_after_disconnect": waits,
            "liveness_status": health,
        }

        with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:

            def fetch_performance():
                return requests.get(
                    api_url + "/api/flex/performance?days=30", timeout=10
                ).status_code

            futures = [pool.submit(fetch_performance) for _ in range(40)]
            assert archive_started.wait(3), "Archive fixture not reached"
            time.sleep(0.8)
            pending = sum(not f.done() for f in futures)
            start = time.monotonic()
            try:
                client.get("/api/flex/markets", timeout=0.7)
            except httpx.ReadTimeout:
                normal_request_blocked = True
            else:
                normal_request_blocked = False
            health = client.get("/health").status_code
            release_archive.set()
            statuses = [f.result(timeout=5) for f in futures]
        recovered = client.get("/api/flex/markets").status_code
        evidence["api_thread_starvation"] = {
            "duplicate_performance_requests": 40,
            "pending_when_checked": pending,
            "archive_requests": counts["/archive"],
            "unrelated_data_request_timed_out": normal_request_blocked,
            "unrelated_probe_seconds": round(time.monotonic() - start, 3),
            "liveness_status": health,
            "data_status_after_release": recovered,
            "performance_response_statuses": dict(Counter(statuses)),
        }
    checks = {
        "contiguous_catchup": evidence["catchup"]["report_found"] and cursor == 2000,
        "rpc_429_recovered": rpc_result == "0x1" and counts["/rpc-error"] == 3,
        "retry_after_honored": all(
            value >= 2 for value in evidence["rpc_retry"]["http_429_attempt_intervals"]
        ),
        "subscription_setup_bounded": not evidence["subscription_ack"][
            "still_blocked_after_stop"
        ]
        and not evidence["subscription_ack"]["waiting_for_ack"],
        "sql_failure_contained": evidence["sql_recovery"]
        == {
            "escaped": None,
            "status": "failed",
            "ended": True,
            "original_error_recorded": True,
            "retry_succeeded": True,
        },
        "database_waits_bounded": evidence["database_waits"]["response_status"] == 503
        and waits == 0
        and all(value != "0" for value in settings.values()),
        "general_api_not_starved": not normal_request_blocked and recovered == 200,
    }
    evidence["checks"] = checks
    evidence["passed"] = all(checks.values())
    (OUT / "results.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence), flush=True)
    assert evidence["passed"], json.dumps(checks)
finally:
    release_archive.set()
    close_ws.set()
    if listener:
        listener.stop()
        listener.join(timeout=3)
    if api and api.poll() is None:
        api.terminate()
        api.wait(timeout=5)
    ws.shutdown()
    http.shutdown()
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
