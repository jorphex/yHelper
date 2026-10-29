"""Real worker/HTTP/WebSocket/PostgreSQL/API regression checks.

Failure cases: RPC errors kill the scheduler or skip maintenance; repeated ticks
spin without delay; control frames cause idle reconnects or swallowed reports;
real closes fail to reconnect; exception chains/relative paths persist secrets;
legacy diagnostic rows leak through public API responses. All injected failures
use an isolated schema and loopback services; outbound notifications are disabled.

uv run --no-project --python 3.12 --with-requirements worker/requirements.txt \
  --with-requirements api/requirements.txt --with httpx python worker/tests/e2e_resilience.py
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
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx
import psycopg
from psycopg.types.json import Jsonb
from websockets.sync.server import serve

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/worker-resilience-fix"
VAULT, STRATEGY = "0x" + "1" * 40, "0x" + "2" * 40
TX = "0x" + "3" * 64
SECRET = "resilience-only-fake-secret"


class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, body, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        self.send(1 if self.path == "/tvl" else [])

    def do_POST(self):
        request = json.loads(
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
        )
        if isinstance(request, dict) and request.get("params") == ["finalized", False]:
            self.send(
                {
                    "jsonrpc": "2.0",
                    "id": request["id"],
                    "error": {
                        "code": -32000,
                        "message": f"RPC failed: /v2/{SECRET}; api_key={SECRET}; https://user:password@example.test/v3/{SECRET}",
                    },
                }
            )
            return
        self.send({"error": "temporarily unavailable"}, 503)


def listener_child():
    sys.path.insert(0, str(ROOT / "worker"))
    from worker.config import configure_logging
    from worker.harvests import HarvestWssListener

    configure_logging()
    listener = HarvestWssListener(1, {VAULT: "3.0.4"})
    listener.start()
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
                count = conn.execute("SELECT COUNT(*) FROM vault_harvests").fetchone()[
                    0
                ]
            if count == 2:
                return
            time.sleep(0.05)
        raise AssertionError(
            "Reports were not delivered across idle frames and a real close"
        )
    finally:
        listener.stop()
        listener.join(timeout=3)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location(
        "connection", ROOT / "api/tests/e2e_flex_performance.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base_dsn = module.dsn()
    schema = "worker_e2e_" + uuid.uuid4().hex[:12]
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
    sys.path.insert(0, str(ROOT / "worker"))
    from worker.config import DDL, EVENT_TOPIC_STRATEGY_REPORTED_V3

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{upstream.server_port}"
    env = {
        k: v
        for k, v in os.environ.items()
        if not any(
            s in k for s in ("RPC_URL", "WSS_URL", "DISCORD", "TELEGRAM", "ALERT_")
        )
    }
    env.update(
        DATABASE_URL=scoped,
        PYTHONPATH=str(ROOT / "worker"),
        WORKER_INTERVAL_SEC="1",
        ETH_RPC_URL=f"{origin}/v2/{SECRET}",
        KONG_REST_VAULTS_URL=origin + "/vaults",
        KONG_GQL_URL=origin + "/gql",
        DEFI_LLAMA_PARENT_TVL_URL=origin + "/tvl",
        DEFI_LLAMA_PROTOCOLS_URL=origin + "/protocols",
        FLEX_API_URL=origin,
        FLEX_SYNC_ENABLED="1",
        STYFI_SYNC_ENABLED="0",
        YLOCKER_SYNC_ENABLED="0",
        HARVEST_WSS_ENABLED="0",
        DB_CLEANUP_ENABLED="0",
    )
    processes = []
    ws_server = None
    evidence = {}
    try:
        with psycopg.connect(base_dsn, autocommit=True) as conn:
            conn.execute(f"CREATE SCHEMA {schema}")
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute(DDL)
        with (OUT / "scheduler.log").open("w") as log:
            worker = subprocess.Popen(
                [sys.executable, "-m", "worker.main"],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            processes.append(worker)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                assert worker.poll() is None, (
                    "The worker exited during an upstream failure"
                )
                with psycopg.connect(scoped, autocommit=True) as conn:
                    failures = conn.execute(
                        "SELECT COUNT(*) FROM ingestion_runs WHERE job_name='flex_market_sync' AND status='failed'"
                    ).fetchone()[0]
                    maintenance = conn.execute(
                        "SELECT COUNT(*) FROM alert_state"
                    ).fetchone()[0]
                if failures >= 2 and maintenance:
                    break
                time.sleep(0.1)
            assert failures >= 2 and maintenance, (
                "Later cycles or maintenance did not run"
            )
            worker.terminate()
            worker.wait(timeout=5)
        with psycopg.connect(scoped, autocommit=True) as conn:
            times = conn.execute(
                "SELECT started_at FROM ingestion_runs WHERE job_name='flex_market_sync' ORDER BY started_at"
            ).fetchall()
            summaries = conn.execute(
                "SELECT error_summary FROM ingestion_runs WHERE error_summary IS NOT NULL"
            ).fetchall()
            assert (times[1][0] - times[0][0]).total_seconds() >= 1
            assert SECRET not in json.dumps(summaries), (
                "A new run persisted the RPC credential"
            )
            for table in ("product_activity_sync_state", "vault_harvest_sync_state"):
                payloads = conn.execute(f"SELECT payload FROM {table}").fetchall()
                assert SECRET not in json.dumps(payloads), (
                    f"{table} persisted a credential"
                )
        assert SECRET not in (OUT / "scheduler.log").read_text(), (
            "Exception logging leaked the credential"
        )
        evidence["scheduler"] = {
            "failed_flex_runs": failures,
            "maintenance_rows": maintenance,
            "later_cycles": True,
            "bounded_interval": True,
            "logs_and_storage_redacted": True,
        }

        sessions = []

        def websocket_handler(connection):
            request = json.loads(connection.recv(timeout=3))
            number = len(sessions)
            sessions.append({"subscription_id": request["id"]})
            connection.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request["id"],
                        "result": "test-subscription",
                    }
                )
            )
            if number == 0:
                connection.ping(b"server-control")
                connection.pong(b"server-control")
                time.sleep(2.5)
            event = {
                "address": VAULT,
                "topics": [
                    EVENT_TOPIC_STRATEGY_REPORTED_V3,
                    "0x" + STRATEGY[2:].rjust(64, "0"),
                ],
                "data": "0x" + "".join(f"{v:064x}" for v in [123, 0, 1000, 0, 2, 0]),
                "blockNumber": hex(100 + number),
                "blockTimestamp": hex(int(time.time())),
                "transactionHash": TX,
                "logIndex": hex(number),
            }
            connection.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "eth_subscription",
                        "params": {
                            "subscription": "test-subscription",
                            "result": event,
                        },
                    }
                )
            )
            time.sleep(0.2 if number == 0 else 3)
            connection.close()

        ws_server = serve(websocket_handler, "127.0.0.1", 0, ping_interval=None)
        threading.Thread(target=ws_server.serve_forever, daemon=True).start()
        wss_env = {
            **env,
            "HARVEST_WSS_ENABLED": "1",
            "HARVEST_WSS_HEARTBEAT_SEC": "1",
            "HARVEST_WSS_CONNECT_TIMEOUT_SEC": "1",
            "ETH_WSS_URL": f"ws://127.0.0.1:{ws_server.socket.getsockname()[1]}/v2/{SECRET}",
        }
        with (OUT / "listener.log").open("w") as log:
            proc = subprocess.Popen(
                [sys.executable, __file__, "--listener"],
                env=wss_env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            processes.append(proc)
            assert proc.wait(timeout=25) == 0, (
                "Listener did not survive control traffic or reconnect after close"
            )
        assert len(sessions) == 2, "Quiet control frames caused premature reconnects"
        with psycopg.connect(scoped, autocommit=True) as conn:
            gains = conn.execute(
                "SELECT gain FROM vault_harvests ORDER BY log_index"
            ).fetchall()
            assert gains == [(123,), (123,)]
        assert SECRET not in (OUT / "listener.log").read_text()
        evidence["websocket"] = {
            "sessions": len(sessions),
            "reports": len(gains),
            "quiet_control_frames_survived": True,
            "real_close_reconnected": True,
        }

        legacy = f"HTTPSConnectionPool error url: /v2/{SECRET}; https://user:password@example.test/v3/{SECRET}?api_key={SECRET}"
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute(
                "INSERT INTO styfi_sync_state(stream_name,chain_id,payload) VALUES ('styfi_reward_epoch',1,%s)",
                (
                    Jsonb(
                        {
                            "reward_token": {
                                "address": VAULT,
                                "symbol": "TEST",
                                "decimals": 18,
                            }
                        }
                    ),
                ),
            )
            conn.execute(
                "INSERT INTO ingestion_runs(job_name,started_at,ended_at,status,error_summary) VALUES ('styfi_snapshot',NOW(),NOW(),'failed',%s)",
                (json.dumps({"error": legacy}),),
            )
            conn.execute(
                "UPDATE alert_state SET last_notify_result=%s",
                (
                    Jsonb(
                        {
                            "attempted": ["discord"],
                            "delivered": [],
                            "errors": [
                                f"https://discord.com/api/webhooks/123/{SECRET}"
                            ],
                        }
                    ),
                ),
            )
            market = {
                key: VAULT
                for key in (
                    "market_address",
                    "registry_address",
                    "factory_address",
                    "implementation_address",
                    "lender_address",
                    "collateral_token_address",
                    "borrow_token_address",
                    "sorted_troves_address",
                    "dutch_desk_address",
                    "auction_address",
                    "price_oracle_address",
                )
            }
            market.update(
                chain_id=1,
                contract_version="1.1.0",
                deployment_block=100,
                deployment_time=datetime.now(UTC),
                deployment_tx_hash=TX,
                endorsement_status="endorsed",
                market_status="active",
                collateral_token_symbol="TEST",
                collateral_token_decimals=18,
                borrow_token_symbol="USDC",
                borrow_token_decimals=6,
                one_pct_raw=10000,
            )
            conn.execute(
                f"INSERT INTO flex_market_dim ({','.join(market)}) VALUES ({','.join(['%s'] * len(market))})",
                tuple(market.values()),
            )
            for table in (
                "flex_redemption_priority_current",
                "flex_trove_health_current",
            ):
                conn.execute(
                    f"INSERT INTO {table}(chain_id,market_address,source_url,last_error) VALUES (1,%s,'fixture',%s)",
                    (VAULT, legacy),
                )
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
                env={**env, "PYTHONPATH": str(ROOT / "api")},
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            processes.append(proc)
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}", timeout=10
            ) as client:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    assert time.monotonic() < deadline, "API startup failed"
                    time.sleep(0.1)
                for path in (
                    "/api/styfi?include_history=false",
                    "/api/meta/freshness",
                    f"/api/flex/markets/{VAULT}/redemption-priority",
                    f"/api/flex/markets/{VAULT}/trove-health",
                ):
                    response = client.get(path)
                    assert response.status_code == 200, (
                        "Public diagnostic response failed"
                    )
                    assert (
                        SECRET not in response.text
                        and "user:password" not in response.text
                    ), "Legacy credentials escaped through public diagnostics"
                    body = response.json()
                    if "/styfi" in path:
                        assert body["ingestion"]["last_run"]["status"] == "failed"
                        assert (
                            body["ingestion"]["last_run"]["error_summary"]
                            == "Upstream request failed."
                        )
                    elif "/flex/" in path:
                        assert (
                            body["freshness"]["last_error"]
                            == "Upstream request failed."
                        )
                    else:
                        assert body["alerts"]
                        assert all(
                            a["last_notify_result"]["errors"]
                            == ["Upstream request failed."]
                            for a in body["alerts"].values()
                        )
        evidence["public_api"] = {
            "legacy_staking_error_protected": True,
            "legacy_alert_errors_protected": True,
            "legacy_flex_errors_protected": True,
        }
        evidence["passed"] = True
        (OUT / "results.json").write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence))
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
        if ws_server:
            ws_server.shutdown()
        upstream.shutdown()
        with psycopg.connect(base_dsn, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    listener_child() if "--listener" in sys.argv else main()
