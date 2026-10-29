"""Real HTTP/TLS regression checks for total transfer deadlines.

Failure cases: trickling headers, fixed/chunked/gzip bodies or stalled peers
outlive the budget; oversized decoded bodies bypass limits; failed streams leak
sockets or P&L slots; fast compressed
JSON, response metadata, connection reuse or archive batching regress.
Only loopback services, a fake local CA and a disposable DB schema are used.
"""

from __future__ import annotations

import asyncio
import gzip
import importlib.util
import json
import os
import ssl
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
import requests
from psycopg.conninfo import make_conninfo

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/http-deadline-fix"
BUDGET = 0.25


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    key, cert = OUT / "fixture-key.pem", OUT / "fixture-ca.pem"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1",
            "-keyout",
            str(key),
            "-out",
            str(cert),
        ],
        capture_output=True,
        check=True,
    )
    os.environ["SSL_CERT_FILE"] = str(cert)
    os.environ["REQUESTS_CA_BUNDLE"] = str(cert)
    spec = importlib.util.spec_from_file_location(
        "fixture", ROOT / "api/tests/e2e_flex_performance.py"
    )
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    base = fixture.dsn()
    schema = "deadline_e2e_" + uuid.uuid4().hex[:12]
    os.environ["DATABASE_URL"] = make_conninfo(base, options=f"-csearch_path={schema}")
    for name in list(os.environ):
        if any(
            part in name
            for part in ("RPC_URL", "WSS_URL", "DISCORD", "TELEGRAM", "ALERT_")
        ):
            os.environ.pop(name)
    sys.path.insert(0, str(ROOT / "worker"))
    sys.path.insert(0, str(ROOT / "api"))
    from app import flex_performance as performance

    from worker import http

    active = set()
    peers = {}
    lock = threading.Lock()

    class Upstream(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def closed(self):
            self.connection.settimeout(0.005)
            try:
                if self.connection.recv(1) == b"":
                    self.close_connection = True
                    return True
            except TimeoutError:
                pass
            except OSError:
                self.close_connection = True
                return True
            finally:
                self.connection.settimeout(None)
            return False

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            mode = urlsplit(self.path).path[1:]
            with lock:
                active.add(self.path)
                peers.setdefault(self.path, []).append(self.client_address[1])

            def reply(call):
                return {
                    "jsonrpc": "2.0",
                    "id": call["id"],
                    "result": "x" * (5 * 1024 * 1024) if "large" in mode else "0x1",
                }

            body = json.dumps(
                [reply(call) for call in request]
                if isinstance(request, list)
                else reply(request)
            ).encode()
            compressed = "gzip" in mode
            if compressed:
                body = gzip.compress(body)
            try:
                headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Last-Refresh: fixture\r\n"
                headers += "Content-Encoding: gzip\r\n" if compressed else ""
                headers += (
                    "Transfer-Encoding: chunked\r\n\r\n"
                    if mode == "chunked"
                    else f"Content-Length: {len(body)}\r\n\r\n"
                )
                if mode == "headers":
                    for index in range(0, len(headers), 8):
                        self.wfile.write(headers[index : index + 8].encode())
                        self.wfile.flush()
                        if self.closed():
                            return
                        time.sleep(0.04)
                else:
                    self.wfile.write(headers.encode())
                    self.wfile.flush()
                if mode.startswith("fast"):
                    self.wfile.write(body)
                    self.wfile.flush()
                    return
                if mode == "stall":
                    self.wfile.write(body[:4])
                    self.wfile.flush()
                    for _ in range(30):
                        if self.closed():
                            return
                        time.sleep(0.04)
                    self.wfile.write(body[4:])
                    return
                for index in range(0, len(body), 4):
                    chunk = body[index : index + 4]
                    self.wfile.write(
                        f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n"
                        if mode == "chunked"
                        else chunk
                    )
                    self.wfile.flush()
                    if self.closed():
                        return
                    time.sleep(0.06)
                if mode == "chunked":
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
            except OSError:
                self.close_connection = True
            finally:
                with lock:
                    active.discard(self.path)

    servers = [ThreadingHTTPServer(("127.0.0.1", 0), Upstream) for _ in range(2)]
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    servers[1].socket = tls.wrap_socket(servers[1].socket, server_side=True)
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    origins = [
        f"{scheme}://127.0.0.1:{server.server_port}"
        for scheme, server in zip(("http", "https"), servers)
    ]
    evidence = {"slow": [], "fast": [], "capacity": {}, "size_limits": {}}
    http._BUDGET_SEC = BUDGET
    performance.ARCHIVE_TIMEOUT_SEC = BUDGET
    try:
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"CREATE SCHEMA {schema}")
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
            conn.execute(
                "CREATE TABLE flex_market_dim(chain_id int, market_status text, market_address text, raw_metadata jsonb, collateral_token_symbol text, borrow_token_symbol text)"
            )
        for origin in origins:
            for mode in ("fast", "fast-gzip"):
                url = origin + "/" + mode
                responses = [
                    http.request(
                        "POST",
                        url,
                        timeout=1,
                        rpc=True,
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "eth_chainId",
                            "params": [],
                        },
                    )
                    for _ in range(2)
                ]
                reused = peers["/" + mode][-2] == peers["/" + mode][-1]
                os.environ["FLEX_PERFORMANCE_RPC_URL"] = url
                archive = performance.Archive()
                value = None
                try:
                    value = archive.rpc("eth_chainId", [])
                    archive.warm([("eth_call", ["a"]), ("eth_call", ["b"])])
                except performance.CoverageError:
                    pass
                evidence["fast"].append(
                    {
                        "scheme": urlsplit(origin).scheme,
                        "mode": mode,
                        "metadata": all(
                            response.headers.get("X-Last-Refresh") == "fixture"
                            for response in responses
                        ),
                        "worker_json": all(
                            response.json()["result"] == "0x1" for response in responses
                        ),
                        "archive_json": value == "0x1",
                        "archive_batch": len(archive.cache) == 3,
                        "keepalive_reused": reused,
                    }
                )
            for mode in ("body", "headers", "chunked", "gzip", "stall"):
                for client in ("worker", "archive", "batch"):
                    url = origin + "/" + mode + "?" + client
                    os.environ["FLEX_PERFORMANCE_RPC_URL"] = url
                    timed_out = False
                    start = time.monotonic()
                    try:
                        if client == "worker":
                            http.request(
                                "POST",
                                url,
                                timeout=1,
                                rpc=True,
                                json={
                                    "jsonrpc": "2.0",
                                    "id": 1,
                                    "method": "eth_chainId",
                                    "params": [],
                                },
                            )
                        else:
                            archive = performance.Archive()
                            archive.deadline = time.monotonic() + BUDGET
                            archive.rpc(
                                "eth_chainId", []
                            ) if client == "archive" else archive.warm(
                                [("eth_chainId", [])]
                            )
                    except (requests.RequestException, performance.CoverageError):
                        timed_out = True
                    elapsed = time.monotonic() - start
                    deadline = time.monotonic() + 0.5
                    while (
                        urlsplit(url).path + "?" + client in active
                        and time.monotonic() < deadline
                    ):
                        time.sleep(0.01)
                    evidence["slow"].append(
                        {
                            "scheme": urlsplit(origin).scheme,
                            "mode": mode,
                            "client": client,
                            "seconds": round(elapsed, 3),
                            "timed_out": timed_out,
                            "bounded": elapsed < BUDGET + 0.2,
                            "connection_released": urlsplit(url).path + "?" + client
                            not in active,
                        }
                    )

        url = origins[0] + "/fast-large-gzip"
        http._MAX_RESPONSE_BYTES = 1024 * 1024
        try:
            http.request(
                "POST",
                url,
                timeout=1,
                rpc=True,
                json={"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []},
            )
        except ValueError as exc:
            evidence["size_limits"]["worker_rejected"] = "too large" in str(exc)
        finally:
            http._MAX_RESPONSE_BYTES = 64 * 1024 * 1024
        os.environ["FLEX_PERFORMANCE_RPC_URL"] = url
        try:
            performance.Archive().rpc("eth_chainId", [])
        except performance.CoverageError as exc:
            evidence["size_limits"]["archive_rejected"] = "too large" in str(
                exc.__cause__
            )

        async def capacity():
            os.environ["FLEX_PERFORMANCE_RPC_URL"] = origins[0] + "/body?capacity"
            start = time.monotonic()
            results = await asyncio.gather(
                performance.performance_response(None, 7),
                performance.performance_response(None, 30),
                return_exceptions=True,
            )
            elapsed = time.monotonic() - start
            empty = not performance.PENDING
            os.environ["FLEX_PERFORMANCE_RPC_URL"] = origins[0] + "/fast?recovered"
            try:
                await performance.performance_response(None, 90)
            except Exception:
                pass
            return {
                "seconds": round(elapsed, 3),
                "bounded": elapsed < BUDGET + 0.25,
                "requests_failed_honestly": all(
                    isinstance(result, performance.HTTPException) for result in results
                ),
                "slots_released": empty,
                "next_calculation_started": "/fast?recovered" in peers,
                "pending_empty": not performance.PENDING,
            }

        evidence["capacity"] = asyncio.run(capacity())
        evidence["passed"] = (
            all(
                all(
                    item[key] for key in ("timed_out", "bounded", "connection_released")
                )
                for item in evidence["slow"]
            )
            and all(
                all(
                    item[key]
                    for key in (
                        "metadata",
                        "worker_json",
                        "archive_json",
                        "archive_batch",
                        "keepalive_reused",
                    )
                )
                for item in evidence["fast"]
            )
            and all(
                value for key, value in evidence["capacity"].items() if key != "seconds"
            )
            and evidence["size_limits"]
            == {"worker_rejected": True, "archive_rejected": True}
        )
        (OUT / "results.json").write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence))
        assert evidence["passed"], "Deadline/resource regression; see results.json"
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


if __name__ == "__main__":
    main()
