"""Additional real-service scenarios, invoked by e2e_resilience.py.

Failure cases: relative Telegram routes leak tokens through logs or persistence;
concurrent heartbeats trigger HTTP catchup; stale heartbeats stop triggering it;
SQL errors leave jobs running, hide the original error or prevent a later sync.
Uses fake credentials, loopback HTTP/WebSockets and a disposable PostgreSQL schema.
"""

from __future__ import annotations

import io
import json
import logging
import os
import socket
import sys
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import psycopg
import requests
from psycopg.conninfo import make_conninfo
from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

ROOT = Path(__file__).resolve().parents[2]
VAULT = "0x" + "1" * 40
TOKEN = "123456789:resilience-only-fake-telegram-secret"


def main():
    out = Path(sys.argv[1])
    base = os.environ["DATABASE_URL"]
    schema = "worker_edges_" + uuid.uuid4().hex[:12]
    scoped = make_conninfo(base, options=f"-csearch_path={schema}")
    ping_requested = threading.Event()
    heartbeat_seen = threading.Event()

    class Upstream(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, body):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def do_GET(self):
            self.reply({"rows": []})

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            method = request["method"]
            if method == "eth_blockNumber":
                if not ping_requested.is_set():
                    with psycopg.connect(scoped, autocommit=True) as conn:
                        before = conn.execute(
                            "SELECT payload->>'wss_heartbeat_at' FROM vault_harvest_sync_state WHERE chain_id=1"
                        ).fetchone()[0]
                    ping_requested.set()
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        with psycopg.connect(scoped, autocommit=True) as conn:
                            after = conn.execute(
                                "SELECT payload->>'wss_heartbeat_at' FROM vault_harvest_sync_state WHERE chain_id=1"
                            ).fetchone()[0]
                        if after != before:
                            heartbeat_seen.set()
                            break
                        time.sleep(0.01)
                result = "0x65"
            elif method == "eth_getBlockByNumber":
                result = {"number": "0x1", "timestamp": hex(int(time.time()))}
            elif method == "eth_getCode":
                result = "0x"
            elif method == "eth_getLogs":
                result = []
            else:
                raise AssertionError(f"Unexpected local RPC method: {method}")
            self.reply({"jsonrpc": "2.0", "id": request["id"], "result": result})

    def websocket_handler(connection):
        request = json.loads(connection.recv(timeout=3))
        connection.send(
            json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": "local"})
        )
        if ping_requested.wait(5):
            connection.ping(b"concurrent-heartbeat")
        try:
            connection.recv(timeout=5)
        except (ConnectionClosed, TimeoutError):
            pass

    http = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    ws = serve(websocket_handler, "127.0.0.1", 0, ping_interval=None)
    origin = f"http://127.0.0.1:{http.server_port}"
    os.environ.update(
        DATABASE_URL=scoped,
        ETH_RPC_URL=origin,
        ETH_WSS_URL=f"ws://127.0.0.1:{ws.socket.getsockname()[1]}",
        FLEX_API_URL=origin,
        HARVEST_WSS_ENABLED="1",
        HARVEST_WSS_HEARTBEAT_SEC="1",
    )
    sys.path.insert(0, str(ROOT / "worker"))
    from worker.config import DDL, configure_logging
    from worker.flex import _run_flex_sync
    from worker.harvests import HarvestWssListener, _run_vault_harvests
    from worker.notifications import _upsert_alert_state
    from worker.redaction import RedactingFormatter

    configure_logging()
    threading.Thread(target=http.serve_forever, daemon=True).start()
    threading.Thread(target=ws.serve_forever, daemon=True).start()
    listener = None
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

        captured = io.StringIO()
        handler = logging.StreamHandler(captured)
        handler.setFormatter(RedactingFormatter())
        logger = logging.getLogger("telegram-privacy-e2e")
        logger.addHandler(handler)
        with socket.socket() as unavailable, requests.Session() as session:
            unavailable.bind(("127.0.0.1", 0))
            session.trust_env = False
            try:
                session.post(
                    f"http://127.0.0.1:{unavailable.getsockname()[1]}/bot{TOKEN}/sendMessage",
                    json={},
                    timeout=1,
                )
            except requests.RequestException as exc:
                notification_error = f"telegram:{exc}"
                logger.exception("Local Telegram failure")
            else:
                raise AssertionError("Expected local connection refusal")
        logger.removeHandler(handler)
        handler.close()
        with psycopg.connect(scoped) as conn:
            _upsert_alert_state(
                conn,
                alert_key="telegram_e2e",
                job_name="fixture",
                status="firing",
                threshold_seconds=1,
                current_age_seconds=2,
                last_success_at=None,
                last_fired_at=None,
                last_recovered_at=None,
                last_notified_at=None,
                notify_channels=["telegram"],
                notify_result={
                    "attempted": ["telegram"],
                    "delivered": [],
                    "errors": [notification_error],
                },
            )
            stored = conn.execute(
                "SELECT last_notify_result FROM alert_state WHERE alert_key='telegram_e2e'"
            ).fetchone()[0]
        evidence["telegram"] = {
            "relative_path_exercised": f"/bot{TOKEN}/sendMessage" in notification_error,
            "formatted_exception_redacted": TOKEN not in captured.getvalue(),
            "stored_error_redacted": TOKEN not in json.dumps(stored),
            "delivery_state_preserved": stored["attempted"] == ["telegram"]
            and not stored["delivered"]
            and bool(stored["errors"]),
        }

        listener = HarvestWssListener(1, {VAULT: "3.0.4"})
        listener.start()
        deadline = time.monotonic() + 3
        while True:
            with psycopg.connect(scoped, autocommit=True) as conn:
                row = conn.execute(
                    "SELECT payload->>'wss_connected' FROM vault_harvest_sync_state WHERE chain_id=1"
                ).fetchone()
            if row and row[0] == "true":
                break
            assert time.monotonic() < deadline, "Listener did not connect"
            time.sleep(0.01)
        with psycopg.connect(scoped) as conn:
            conn.execute(
                "UPDATE vault_harvest_sync_state SET cursor=100,payload=payload || jsonb_build_object('last_http_reconcile_at', %s::text)",
                (datetime.now(UTC).isoformat(),),
            )
            conn.commit()
            _run_vault_harvests(conn)
            cursor, payload = conn.execute(
                "SELECT cursor,payload FROM vault_harvest_sync_state WHERE chain_id=1"
            ).fetchone()
        evidence["heartbeat"] = {
            "ping_persisted_during_rpc": heartbeat_seen.is_set(),
            "live_scan_skipped": cursor == 100
            and payload.get("status") == "wss_live"
            and payload.get("wss_connected") is True,
        }
        listener.stop()
        listener.join(timeout=3)
        assert not listener.is_alive(), "Listener did not stop"
        with psycopg.connect(scoped) as conn:
            conn.execute(
                "UPDATE vault_harvest_sync_state SET payload=payload || %s",
                (
                    Jsonb(
                        {
                            "wss_connected": True,
                            "wss_heartbeat_at": (
                                datetime.now(UTC) - timedelta(seconds=10)
                            ).isoformat(),
                        }
                    ),
                ),
            )
            conn.commit()
            _run_vault_harvests(conn)
            cursor, payload = conn.execute(
                "SELECT cursor,payload FROM vault_harvest_sync_state WHERE chain_id=1"
            ).fetchone()
        evidence["heartbeat"]["stale_scan_preserved"] = (
            cursor == 101 and payload.get("last_http_mode") == "catchup"
        )

        with psycopg.connect(scoped) as lock, psycopg.connect(scoped) as conn:
            lock.execute("LOCK flex_reconciliations IN ACCESS EXCLUSIVE MODE")
            conn.execute("SET lock_timeout = '100ms'")
            conn.commit()
            try:
                _run_flex_sync(conn)
            except Exception as exc:
                original_preserved = isinstance(exc, psycopg.errors.LockNotAvailable)
                connection_recovered = (
                    conn.info.transaction_status == TransactionStatus.IDLE
                )
                conn.rollback()
            else:
                raise AssertionError("Expected a SQL lock timeout")
            status, ended_at, summary = conn.execute(
                "SELECT status,ended_at,error_summary FROM ingestion_runs WHERE job_name='flex_market_sync' ORDER BY id DESC LIMIT 1"
            ).fetchone()
            lock.rollback()
            _run_flex_sync(conn)
            latest = conn.execute(
                "SELECT status FROM ingestion_runs WHERE job_name='flex_market_sync' ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
        evidence["sql_failure"] = {
            "original_exception_preserved": original_preserved,
            "failed_run_completed": status == "failed" and ended_at is not None,
            "original_error_recorded": "lock timeout" in (summary or ""),
            "connection_recovered": connection_recovered,
            "next_sync_succeeded": latest == "success",
        }
        evidence["passed"] = all(all(checks.values()) for checks in evidence.values())
        (out / "edges.json").write_text(json.dumps(evidence, indent=2) + "\n")
        assert evidence["passed"], json.dumps(evidence)
        print(json.dumps(evidence))
    finally:
        if listener:
            listener.stop()
            listener.join(timeout=3)
        ws.shutdown()
        http.shutdown()
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    main()
