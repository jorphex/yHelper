"""Real loopback RPC checks for the shared Flex historical cache.

Failure modes: cached anchors hide reorgs; providers/chains/blocks mix; latest
reads leak across builds; concurrent misses duplicate RPC; failed/oversized
reads poison the cache; cancelled waiters outlive deadlines or strand owners.
Review cases cover pending capacity, retained failure frames, partial shared
errors and cold lookup capacity with a retained operation ceiling.
Financial accounting/transfer coverage is exercised by e2e_flex_performance.py.
Artifact: reports/rpc-optimization/archive-cache.json. No live RPC or DB writes.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports/rpc-optimization"
COUNTS = Counter()
BLOCK_HASH = "0x" + "a" * 64
CHAIN = "0x1"
FAIL = True
BAD_BATCH = True
PARTIAL_STARTED = threading.Event()
PARTIAL_RELEASE = threading.Event()
ADDRESS = "0x" + "1" * 40


class RPC(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        global BAD_BATCH
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))

        def reply(call):
            global FAIL
            method, params = call["method"], call["params"]
            key = (self.path, method, json.dumps(params, sort_keys=True))
            COUNTS[key] += 1
            row = {"jsonrpc": "2.0", "id": call["id"]}
            if method == "eth_chainId":
                row["result"] = CHAIN
            elif method == "eth_getLogs":
                row["result"] = []
            elif method == "eth_getBlockByNumber":
                row["result"] = {
                    "number": params[0],
                    "hash": BLOCK_HASH,
                    "timestamp": "0x640",
                }
                if params[0] == "0x65" and COUNTS[key] == 1:
                    row["result"]["timestamp"] = "invalid"
            elif method == "eth_call":
                data = params[0]["data"]
                if data.startswith("0xslow"):
                    time.sleep(0.25)
                if data == "0xpartial":
                    PARTIAL_STARTED.set()
                    assert PARTIAL_RELEASE.wait(2)
                    row["error"] = {"code": -32000, "message": "Unavailable"}
                elif data == "0xfail" and FAIL:
                    FAIL = False
                    row["error"] = {"code": -32000, "message": "Unavailable"}
                else:
                    row["result"] = "0x" + "1".rjust(64, "0")
                if data == "0xbadhex" and COUNTS[key] == 1:
                    row["result"] = "0x" + "g" * 64
            return row

        result = (
            [reply(call) for call in payload]
            if isinstance(payload, list)
            else reply(payload)
        )
        if (
            isinstance(payload, list)
            and payload[0]["params"][0].get("data") == "0xdup"
            and BAD_BATCH
        ):
            BAD_BATCH = False
            result[-1] = result[0]
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    global BLOCK_HASH, CHAIN
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), RPC)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    os.environ["FLEX_PERFORMANCE_RPC_URL"] = url + "/a"
    sys.path.insert(0, str(ROOT / "api"))
    from app import flex_performance as performance
    from app.flex_performance import Archive, CoverageError

    def archive(path="/a", end=1000):
        os.environ["FLEX_PERFORMANCE_RPC_URL"] = url + path
        result = Archive()
        result.bind(end, BLOCK_HASH)
        return result

    def read(target, data="0x01", block="0x64"):
        return target.rpc("eth_call", [{"to": ADDRESS, "data": data}, block])

    evidence = {}
    try:
        market = {"lender_address": ADDRESS, "deployment_block": 50000}
        first = archive(end=160000)
        assert first.transfers(market, ADDRESS, 60000, 160000) == []
        scanned = {
            (int(json.loads(params)[0]["fromBlock"], 16),
             int(json.loads(params)[0]["toBlock"], 16))
            for _, method, params in COUNTS if method == "eth_getLogs"
        }
        assert scanned == {(60001, 99999), (100000, 149999), (150000, 160000)}
        before = sum(count for (_, method, _), count in COUNTS.items() if method == "eth_getLogs")
        second = archive(end=160000)
        assert second.transfers(market, ADDRESS, 80000, 160000) == []
        after = sum(count for (_, method, _), count in COUNTS.items() if method == "eth_getLogs")
        assert after - before == 2 and second.cache_hits == 4, (
            "Only the clipped boundary should differ across selected periods"
        )
        evidence["transfer_windows"] = {
            "first_period": sorted(scanned),
            "second_period_new_queries": after - before,
            "second_period_shared_queries": second.cache_hits,
        }
        first = archive()
        read(first)
        before = sum(COUNTS.values())
        second = archive()
        read(second)
        assert sum(COUNTS.values()) - before == 2, (
            "Only fresh chain/anchor checks should run"
        )
        read(archive("/b"))
        key = (
            "/b",
            "eth_call",
            json.dumps([{"to": ADDRESS, "data": "0x01"}, "0x64"], sort_keys=True),
        )
        assert COUNTS[key] == 1, "Provider identities must not share results"
        before = sum(COUNTS.values())
        read(archive(), "0x01", "latest")
        read(archive(), "0x01", "latest")
        assert sum(COUNTS.values()) - before == 6
        previous_hash = BLOCK_HASH
        BLOCK_HASH = "0x" + "b" * 64
        before = sum(COUNTS.values())
        read(archive())
        assert sum(COUNTS.values()) - before == 3, (
            "New hash must invalidate shared reads"
        )
        wrong = Archive()
        try:
            wrong.bind(1000, previous_hash)
        except CoverageError:
            pass
        else:
            raise AssertionError("Changed indexed anchor accepted")
        CHAIN = "0x2"
        try:
            archive()
        except CoverageError:
            pass
        else:
            raise AssertionError("Wrong chain accepted")
        CHAIN = "0x1"
        left, right = archive(), archive()
        before = sum(COUNTS.values())
        with ThreadPoolExecutor(max_workers=2) as pool:
            a, b = pool.submit(read, left, "0xslow"), pool.submit(read, right, "0xslow")
            assert a.result() == b.result()
        assert sum(COUNTS.values()) - before == 1
        owner, waiter = archive(), archive()
        waiter.deadline = time.monotonic() + 0.08
        with ThreadPoolExecutor(max_workers=2) as pool:
            task = pool.submit(read, owner, "0xslow2")
            time.sleep(0.02)
            started = time.monotonic()
            try:
                read(waiter, "0xslow2")
            except CoverageError:
                pass
            else:
                raise AssertionError("Waiting viewer ignored its deadline")
            assert time.monotonic() - started < 0.15
            task.result()
        read(archive(), "0xslow2")
        try:
            read(archive(), "0xfail")
        except CoverageError:
            pass
        else:
            raise AssertionError("Failed result was accepted")
        assert read(archive(), "0xfail").startswith("0x")
        fail_key = (
            "/a",
            "eth_call",
            json.dumps([{"to": ADDRESS, "data": "0xfail"}, "0x64"], sort_keys=True),
        )
        assert COUNTS[fail_key] == 2, "Failed result must not be shared"
        assert read(archive(), "0xbadhex") == "0x" + "g" * 64
        assert read(archive(), "0xbadhex") != "0x" + "g" * 64, (
            "Malformed success must not poison shared state"
        )
        assert (
            archive().rpc("eth_getBlockByNumber", ["0x65", False])["timestamp"]
            == "invalid"
        )
        assert (
            archive().rpc("eth_getBlockByNumber", ["0x65", False])["timestamp"]
            == "0x640"
        ), "Malformed block must be retried"
        batch = [
            ("eth_call", [{"to": ADDRESS, "data": data}, "0x64"])
            for data in ("0xdup", "0xother")
        ]
        try:
            archive().warm(batch)
        except CoverageError:
            pass
        else:
            raise AssertionError("Duplicate response IDs were accepted")
        recovered = archive()
        recovered.deadline = time.monotonic() + 1
        recovered.warm(batch)
        assert read(recovered, "0xdup").startswith("0x"), (
            "Failed batch stranded a cache claim"
        )
        from app.archive_cache import HistoricalCache

        performance.SHARED = HistoricalCache(max_entries=2)
        for data in ("0x51", "0x52", "0x53"):
            read(archive(), data)
        before = sum(COUNTS.values())
        read(archive(), "0x51")
        assert sum(COUNTS.values()) - before == 3, (
            "Entry bound failed to evict oldest data"
        )
        performance.SHARED = HistoricalCache(max_bytes=1)
        before = sum(COUNTS.values())
        read(archive(), "0x54")
        read(archive(), "0x54")
        assert sum(COUNTS.values()) - before == 6, (
            "Oversized result bypassed byte bound"
        )
        performance.SHARED = HistoricalCache(ttl=0.02)
        read(archive(), "0x55")
        time.sleep(0.03)
        before = sum(COUNTS.values())
        read(archive(), "0x55")
        assert sum(COUNTS.values()) - before == 3, "Expired result was reused"

        def pending_capacity():
            shared = HistoricalCache(max_entries=2)
            performance.SHARED = shared
            peak = 0
            original = shared.acquire

            def measured(key):
                nonlocal peak
                result = original(key)
                peak = max(peak, len(shared.pending))
                return result

            shared.acquire = measured
            target = archive()
            batch = [
                ("eth_call", [{"to": ADDRESS, "data": hex(100 + i)}, "0x64"])
                for i in range(6)
            ]
            target.warm(batch)
            assert all(
                target.rpc(method, params).startswith("0x") for method, params in batch
            )
            assert peak <= 2, (
                f"Reserved {peak} pending reads despite a two-entry capacity"
            )
            assert not shared.pending

        def failed_build_memory():
            global CHAIN
            CHAIN = "0x2"
            key = (ADDRESS, 7)
            try:
                for attempt in range(2):
                    before = sum(COUNTS.values())
                    try:
                        asyncio.run(performance.performance_response(*key))
                    except performance.HTTPException as exc:
                        assert exc.status_code == 502
                    else:
                        raise AssertionError("Wrong chain produced performance")
                    if attempt:
                        assert sum(COUNTS.values()) == before
                    template = performance.CACHE[key][1]
                    assert (
                        template.__traceback__ is None and template.__cause__ is None
                    ), "Cached failure retains calculation frames"
            finally:
                CHAIN = "0x1"
                performance.CACHE.pop(key, None)

        def partial_waiter():
            performance.SHARED = HistoricalCache()
            owner, waiter = archive(), archive()
            batch = [
                ("eth_call", [{"to": ADDRESS, "data": data}, "0x64"])
                for data in ("0xpartial", "0xcovered")
            ]
            waiting = threading.Event()
            original = waiter._wait

            def observed(key, future):
                waiting.set()
                return original(key, future)

            waiter._wait = observed
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(owner.warm, batch)
                assert PARTIAL_STARTED.wait(1)
                second = pool.submit(waiter.warm, batch)
                try:
                    assert waiting.wait(1), "Second viewer did not coalesce"
                finally:
                    PARTIAL_RELEASE.set()
                first.result(timeout=2)
                second.result(timeout=2)
            assert read(waiter, "0xcovered") == read(owner, "0xcovered")
            assert waiter.failed == owner.failed
            key = ("/a", "eth_call", json.dumps(batch[0][1], sort_keys=True))
            assert COUNTS[key] == 1, "Coalesced error caused duplicate RPC work"

        def cold_lookup_budget():
            performance.SHARED = HistoricalCache()
            target = archive()
            batch = [
                ("eth_call", [{"to": ADDRESS, "data": hex(10000 + i)}, "0x64"])
                for i in range(1300)
            ]
            target.warm(batch)
            assert len(target.cache) >= 1300, "A normal cold 90D-sized lookup must fit"
            performance.SHARED = HistoricalCache()
            oversized = archive()
            try:
                oversized.warm(
                    [
                        ("eth_call", [{"to": ADDRESS, "data": hex(20000 + i)}, "0x64"])
                        for i in range(2000)
                    ]
                )
            except CoverageError:
                pass
            else:
                raise AssertionError("Oversized lookup bypassed the RPC budget")
            assert oversized.calls <= 1600 and not performance.SHARED.pending

        review_checks = {}
        for name, check in (
            ("pending_capacity", pending_capacity),
            ("failed_build_memory", failed_build_memory),
            ("partial_waiter", partial_waiter),
            ("cold_lookup_budget", cold_lookup_budget),
        ):
            try:
                check()
                review_checks[name] = {"passed": True}
            except (AssertionError, CoverageError) as exc:
                review_checks[name] = {"passed": False, "error": str(exc)}
        evidence["review_checks"] = review_checks
        evidence.update(
            passed=all(check["passed"] for check in review_checks.values()),
            fresh_anchors=True,
            chain_provider_hash_isolation=True,
            latest_not_shared=True,
            shared_success=True,
            failures_retryable=True,
            cancelled_waiter_isolated=True,
            memory_bounded=True,
        )
        (OUT / "archive-cache.json").write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence))
        assert all(check["passed"] for check in review_checks.values()), review_checks
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
