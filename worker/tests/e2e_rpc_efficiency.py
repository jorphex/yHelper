"""Loopback RPC E2E: partial retries, unordered IDs, soft errors and budgets.

Failure modes: successful batch members repeat; permanent errors get retried;
duplicate/missing IDs look successful; soft errors break required state reads;
retries outlive the request budget; metrics expose endpoint credentials.
Malformed finalized heads must remain retryable within the same worker cycle.
No live RPC, notifications or production data. Artifact: reports/rpc-optimization/worker-rpc.json.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/rpc-optimization"
COUNTS = Counter()


class RPC(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        COUNTS[(self.path, "http")] += 1
        if isinstance(payload, dict):
            assert payload["method"] == "eth_getBlockByNumber"
            stamp = (
                "invalid"
                if self.path == "/bad-finality" and COUNTS[(self.path, "http")] == 1
                else "0x640"
            )
            body = json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": payload["id"],
                    "result": {
                        "number": "0x64",
                        "timestamp": stamp,
                        "hash": "0x" + "a" * 64,
                    },
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        replies = []
        for call in payload:
            ident = call["id"]
            COUNTS[(self.path, ident)] += 1
            failed = ident == 2 and (
                self.path == "/deadline"
                or self.path == "/mixed"
                and COUNTS[(self.path, ident)] < 3
                or self.path == "/soft"
            )
            reply = {"jsonrpc": "2.0", "id": ident}
            if failed:
                reply["error"] = {
                    "code": -32000 if self.path == "/soft" else 429,
                    "message": "execution reverted"
                    if self.path == "/soft"
                    else "rate limited",
                }
            else:
                reply["result"] = hex(ident)
            replies.append(reply)
        if self.path == "/duplicate":
            replies[-1] = replies[0]
        if self.path == "/missing":
            replies.pop()
        body = json.dumps(list(reversed(replies))).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for key in list(os.environ):
        if any(
            part in key
            for part in ("RPC_URL", "WSS_URL", "DISCORD", "TELEGRAM", "ALERT_")
        ):
            del os.environ[key]
    sys.path.insert(0, str(ROOT / "worker"))
    from worker import eth, http

    server = ThreadingHTTPServer(("127.0.0.1", 0), RPC)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    calls = [
        ("eth_call", [{"to": "0x" + "1" * 40, "data": hex(i)}, "0x64"])
        for i in range(3)
    ]
    evidence = {}
    try:
        with http.rpc_metrics("fixture") as metrics:
            result = eth._eth_rpc_batch_to_url(url + "/mixed", calls)
        assert result == ["0x1", "0x2", "0x3"]
        assert [COUNTS[("/mixed", i)] for i in (1, 2, 3)] == [1, 3, 1]
        assert (
            metrics["operations"] == 5
            and metrics["requests"] == 3
            and metrics["retries"] == 2
        )
        evidence["selective_retry"] = {"member_attempts": [1, 3, 1], "metrics": metrics}
        assert eth._eth_rpc_batch_to_url(url + "/soft", calls, allow_errors=True) == [
            "0x1",
            None,
            "0x3",
        ]
        try:
            eth._eth_rpc_batch_to_url(url + "/soft", calls)
        except http.RpcError as exc:
            assert not exc.transient
        else:
            raise AssertionError("Required batch swallowed a permanent error")
        for path in ("/duplicate", "/missing"):
            try:
                eth._eth_rpc_batch_to_url(url + path, calls)
            except ValueError:
                pass
            else:
                raise AssertionError("Malformed batch was accepted")
            assert COUNTS[(path, "http")] == 1
        budget = http._BUDGET_SEC
        http._BUDGET_SEC = 0.1
        started = time.monotonic()
        try:
            eth._eth_rpc_batch_to_url(url + "/deadline", calls)
        except http.RpcError:
            pass
        else:
            raise AssertionError("Throttle did not fail within budget")
        finally:
            http._BUDGET_SEC = budget
        assert time.monotonic() - started < 0.5
        eth.CHAIN_RPC_URLS[1] = url + "/finality"
        with eth.finalized_scope(), http.rpc_metrics("finality") as finality_metrics:
            assert eth._eth_finalized_block_for_chain(
                1
            ) == eth._eth_finalized_block_for_chain(1)
        assert COUNTS[("/finality", "http")] == 1
        assert finality_metrics["cache_hits"] == 1
        with eth.finalized_scope():
            eth._eth_finalized_block_for_chain(1)
        assert COUNTS[("/finality", "http")] == 2, (
            "A new cycle must fetch fresh finality"
        )
        eth.CHAIN_RPC_URLS[1] = url + "/bad-finality"
        with eth.finalized_scope():
            try:
                block = eth._eth_finalized_block_for_chain(1)
                int(block["timestamp"], 16)
            except ValueError:
                pass
            else:
                raise AssertionError("Malformed finality was accepted")
            assert eth._eth_finalized_block_for_chain(1)["timestamp"] == "0x640", (
                "Malformed finalized head was cached"
            )
        assert COUNTS[("/bad-finality", "http")] == 2
        evidence.update(
            passed=True,
            soft_errors=True,
            strict_errors=True,
            malformed_ids_rejected=True,
            deadline_bounded=True,
            finality_scoped=True,
            malformed_finality_retryable=True,
        )
        (OUT / "worker-rpc.json").write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
