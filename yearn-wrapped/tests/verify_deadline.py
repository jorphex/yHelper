"""Real HTTP deadline check against a locally stalled/slowly streamed response."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
stop = threading.Event()


class Slow(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        self.send_response(200)
        self.end_headers()
        try:
            for byte in b'{"data":{"page":[]}}':
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
                if stop.wait(0.2):
                    break
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
threading.Thread(target=server.serve_forever, daemon=True).start()
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
out = ROOT / "data/verification/fixes"
out.mkdir(parents=True, exist_ok=True)
with (
    tempfile.TemporaryDirectory() as cache,
    (out / "deadline-service.log").open("w") as log,
):
    env = {
        **os.environ,
        "YEARN_WRAPPED_BUILD_TIMEOUT": "1",
        "YEARN_WRAPPED_GRAPHQL_URL": f"http://127.0.0.1:{server.server_port}",
        "YEARN_WRAPPED_UPSTREAM_CACHE_DIR": cache,
    }
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
            str(port),
        ],
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=3) as client:
            for _ in range(100):
                try:
                    if client.get("/health").is_success:
                        break
                except httpx.ConnectError:
                    time.sleep(0.05)
            started = time.monotonic()
            response = client.get("/api/recap", params={"address": "0x" + "a" * 40})
            elapsed = time.monotonic() - started
            assert response.status_code == 502, response.text
            assert elapsed < 1.5, elapsed
            result = {
                "passed": True,
                "budget_seconds": 1,
                "elapsed_seconds": round(elapsed, 3),
                "scenario": "Slow streaming body cancels by the shared build deadline",
            }
            (out / "stream-deadline.json").write_text(
                json.dumps(result, indent=2) + "\n"
            )
            print(json.dumps(result, indent=2))
    finally:
        stop.set()
        process.terminate()
        process.wait(timeout=10)
        server.shutdown()
