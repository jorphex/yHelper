"""Independent accounting expectations through a real disposable HTTP service."""

import datetime as dt
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import httpx

ROOT = Path(__file__).resolve().parents[1]
START = int(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp())
NOW = int(time.time())
DAY = 86400
VA = "0x" + "4" * 40
VB = "0x" + "5" * 40
NAMES = [
    "quiet_opening",
    "single_hold",
    "full_exit",
    "self_transfer",
    "chain_collision",
    "unknown_decimals",
    "peak_value",
    "absent_days",
    "old_closed",
    "partial_prices",
    "mixed_assets",
]
CASES = {}


def transfer(ts, amount=100, vault=VA, chain=1):
    return {
        "chainId": chain,
        "vaultAddress": vault,
        "blockTimestamp": ts,
        "value": str(amount * 10**6),
        "transactionHash": "0x" + "1" * 64,
        "sender": "0x" + "0" * 40,
        "receiver": "0x" + "a" * 40,
    }


def event(ts, amount=100, vault=VA, chain=1):
    return {
        **transfer(ts, amount, vault, chain),
        "assets": str(amount * 10**6),
        "shares": str(amount * 10**6),
        "owner": "0x" + "a" * 40,
    }


for n, name in enumerate(NAMES, 1):
    addr = "0x" + format(n, "040x")
    ins = [transfer(START + DAY)]
    outs = []
    deps = [event(START + DAY)]
    withdrawals = []
    vaults = [(VA, 1)]
    if name == "quiet_opening":
        ins = [transfer(START - 30 * DAY)]
        deps = []
    if name == "full_exit":
        outs = [transfer(START + 11 * DAY)]
        withdrawals = [event(START + 11 * DAY)]
    if name == "self_transfer":
        ins = [transfer(START - 30 * DAY), transfer(START + 100 * DAY)]
        outs = [transfer(START + 100 * DAY)]
        deps = []
    if name == "chain_collision":
        ins += [transfer(START + 2 * DAY, chain=8453)]
        deps += [event(START + 2 * DAY, chain=8453)]
        vaults += [(VA, 8453)]
    if name == "peak_value":
        ins += [transfer(START + DAY, 150, VB)]
        deps += [event(START + DAY, 150, VB)]
        vaults += [(VB, 1)]
    if name == "absent_days":
        ins = [transfer(START - (20 - i) * DAY, 1) for i in range(20)] + [
            transfer(START + 10 * DAY, 1)
        ]
        deps = []
    if name == "old_closed":
        ins += [transfer(START - 60 * DAY, vault=VB)]
        outs += [transfer(START - 30 * DAY, vault=VB)]
        vaults += [(VB, 1)]
    if name == "partial_prices":
        extra = "0x" + "6" * 40
        ins += [transfer(START + DAY, vault=extra)]
        vaults += [(extra, 1)]
    if name == "mixed_assets":
        ins = [
            transfer(START + DAY, 1, "0x" + "7" * 40),
            transfer(START + DAY, 200, "0x" + "8" * 40),
        ]
        outs = [
            transfer(START + 10 * DAY, 1, "0x" + "7" * 40),
            transfer(START + 10 * DAY, 200, "0x" + "8" * 40),
        ]
        deps = [
            event(START + DAY, 1, "0x" + "7" * 40),
            event(START + DAY, 200, "0x" + "8" * 40),
        ]
        withdrawals = [
            event(START + 10 * DAY, 1, "0x" + "7" * 40),
            event(START + 10 * DAY, 200, "0x" + "8" * 40),
        ]
        vaults = [("0x" + "7" * 40, 1), ("0x" + "8" * 40, 1)]
    CASES[addr] = {
        "name": name,
        "in": ins,
        "out": outs,
        "Deposit": deps,
        "Withdraw": withdrawals,
        "vaults": vaults,
    }

for addr, case in CASES.items():
    for row in case["Deposit"] + case["Withdraw"]:
        row["owner"] = addr
    for row in case["in"]:
        row["receiver"] = addr
    for row in case["out"]:
        row["sender"] = addr
    if case["name"] == "self_transfer":
        case["in"][-1]["sender"] = addr
        case["out"][0]["receiver"] = addr


class Upstream(BaseHTTPRequestHandler):
    market_calls = 0

    def log_message(self, *args):
        pass

    def reply(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["query"]
        if "_ilike" not in q:
            self.reply(
                {
                    "data": {
                        "page": [
                            {"owner": "0x" + format(3, "040x")},
                            {"owner": "0x" + "f" * 40},
                        ]
                    }
                }
            )
            return
        addr = re.search(r"0x[0-9a-fA-F]{40}", q)[0].lower()
        if addr == "0x" + "f" * 40:
            self.reply({"data": {"page": [event(START + DAY)] * 100}})
            return
        case = CASES[addr]
        entity = re.search(r"page: (Deposit|Withdraw|Transfer)", q)[1]
        rows = (
            case["in" if "receiver: {_ilike:" in q else "out"]
            if entity == "Transfer"
            else case[entity]
        )
        self.reply({"data": {"page": rows}})

    def do_GET(self):
        if "/timeseries/tvl/" in self.path:
            if "0x" + "6" * 40 in self.path:
                self.reply([])
                return
            self.reply(
                [
                    {
                        "time": START - DAY + i * DAY,
                        "value": 3000 if "0x" + "7" * 40 in self.path else 1,
                    }
                    for i in range((NOW - START) // DAY + 3)
                ]
            )
            return
        if "/timeseries/pps/" in self.path:
            vault = self.path.rsplit("/", 1)[-1].lower()
            if vault in ("0x" + "7" * 40, "0x" + "8" * 40):
                self.reply(
                    [
                        {
                            "time": START - DAY + i * DAY,
                            "value": 1
                            + max(
                                0,
                                (START - DAY + i * DAY - START - 10 * DAY)
                                / (NOW - START - 10 * DAY),
                            )
                            * (1 if vault == "0x" + "7" * 40 else -0.5),
                        }
                        for i in range((NOW - START) // DAY + 2)
                    ]
                    + [{"time": NOW, "value": 2 if vault == "0x" + "7" * 40 else 0.5}]
                )
                return
            self.reply(
                [
                    {
                        "time": START - DAY + i * DAY,
                        "value": 1
                        + max(0, (START - DAY + i * DAY - START) / (NOW - START))
                        * (1 if vault == VA else 0.01),
                    }
                    for i in range((NOW - START) // DAY + 2)
                ]
                + [{"time": NOW, "value": 2 if vault == VA else 1.01}]
            )
            return
        if "/coins/ethereum/market_chart" in self.path:
            Upstream.market_calls += 1
            self.reply({"prices": []})
            return
        addr = re.search(r"address=(0x[0-9a-fA-F]{40})", self.path)[1].lower()
        case = CASES[addr]
        if "/holdings/history" in self.path:
            self.reply(
                {
                    "dataPoints": [
                        {"date": "2026-01-01", "value": 100},
                        {
                            "date": dt.datetime.fromtimestamp(NOW, dt.timezone.utc)
                            .date()
                            .isoformat(),
                            "value": 100,
                        },
                    ]
                }
            )
            return
        rows = []
        for vault, chain in case["vaults"]:
            metadata = {"symbol": "USDC", "decimals": 6, "assetDecimals": 6}
            if case["name"] == "unknown_decimals":
                metadata.pop("assetDecimals")
            rows.append(
                {
                    "vaultAddress": vault,
                    "chainId": chain,
                    "metadata": metadata,
                    "growthUsd": 20,
                    "growthUnderlying": 20,
                    "growthPct": 20,
                    "annualizedProtocolReturnPct": 20,
                    "status": "ok",
                    "issues": [],
                }
            )
        self.reply(
            {
                "growth": {
                    "summary": {
                        "totalVaults": len(rows),
                        "completeVaults": len(rows),
                        "partialVaults": 0,
                        "isComplete": True,
                    },
                    "vaults": rows,
                }
            }
        )


(ROOT / "data/verification/accounting").mkdir(parents=True, exist_ok=True)
server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
threading.Thread(target=server.serve_forever, daemon=True).start()
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
source = f"http://127.0.0.1:{server.server_port}"
with tempfile.TemporaryDirectory(prefix="wrapped-audit-") as cache:
    env = {
        **os.environ,
        "YEARN_WRAPPED_GRAPHQL_URL": source + "/graphql",
        "YEARN_WRAPPED_YEARNFI_URL": source,
        "YEARN_WRAPPED_KONG_URL": source,
        "YEARN_WRAPPED_MARKET_URL": source,
        "YEARN_WRAPPED_UPSTREAM_CACHE_DIR": cache,
    }
    with (ROOT / "data/verification/accounting/probe-service.log").open("w") as log:
        proc = subprocess.Popen(
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
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}", timeout=30
            ) as client:
                for _ in range(100):
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(0.05)
                outcomes = []
                for addr, case in CASES.items():
                    r = client.get("/api/recap", params={"address": addr})
                    r.raise_for_status()
                    p = r.json()
                    c = p["cards"]
                    name = case["name"]
                    if name == "quiet_opening":
                        actual = {
                            "vaults": c["vaultsExplored"]["count"],
                            "stillHolding": c["vaultsExplored"]["stillHolding"],
                            "streak": c["longestHoldingStreak"]["days"],
                        }
                        expected = {
                            "vaults": 1,
                            "stillHolding": 1,
                            "streak": int((NOW - START) / DAY),
                        }
                    elif name == "single_hold":
                        actual = c["longestHoldingStreak"]["days"]
                        expected = int((NOW - START - DAY) / DAY)
                    elif name == "full_exit":
                        actual = c["longestHoldingStreak"]["days"]
                        expected = 10
                    elif name == "self_transfer":
                        actual = c["behaviour"]["holdings"]["roundTrips"]
                        expected = 0
                    elif name == "chain_collision":
                        actual = c["vaultsExplored"]["count"]
                        expected = 2
                    elif name == "unknown_decimals":
                        actual = {
                            "rows": c["depositsWithdrawn"]["depositsBySymbol"],
                            "complete": c["depositsWithdrawn"]["isComplete"],
                        }
                        expected = {"rows": [], "complete": False}
                    elif name == "peak_value":
                        actual = c["favouriteVault"]["vault"]
                        expected = VA
                    elif name == "mixed_assets":
                        actual = {
                            "usd": c["whatIfHeld"]["forgoneUsd"],
                            "complete": c["whatIfHeld"]["isComplete"],
                            "nativeTotal": c["whatIfHeld"]["forgoneAssets"],
                        }
                        expected = {"usd": 2900, "complete": True, "nativeTotal": None}
                    elif name == "old_closed":
                        actual = any(
                            v["vault"] == VB for v in c["vaultGrowth"]["vaults"]
                        )
                        expected = False
                    elif name == "partial_prices":
                        actual = {
                            "yield": c["vaultGrowth"]["totalGrowthUsd"],
                            "complete": c["vaultGrowth"]["isComplete"],
                            "favourite": c["favouriteVault"]["vault"],
                        }
                        expected = {"yield": None, "complete": False, "favourite": None}
                    else:
                        actual = c["longestHoldingStreak"]["absentDays"]
                        expected = max(0, int((NOW - START) / DAY) - 1)
                    assert actual == expected, f"{name}: {actual!r} != {expected!r}"
                    if name == "single_hold":
                        g = c["vaultGrowth"]
                        assert g["isComplete"]
                        assert (
                            abs(
                                g["totalGrowthUsd"]
                                - round(100 * (1 - DAY / (NOW - START)), 2)
                            )
                            < 0.02
                        )
                        assert g["totalGrowthUsd"] != 20, (
                            "Must calculate annual yield, not copy lifetime growth"
                        )
                    outcomes.append(
                        {
                            "case": name,
                            "status": r.status_code,
                            "actual": actual,
                            "expected": expected,
                            "payload": p,
                        }
                    )
                cohort_dir = ROOT / "data/verification/accounting/cohort"
                subprocess.run(
                    [
                        "uv",
                        "run",
                        "--directory",
                        str(ROOT),
                        "python",
                        "tools/medians.py",
                        "--sample",
                        "2",
                        "--out",
                        str(cohort_dir),
                    ],
                    env=env,
                    check=True,
                    capture_output=True,
                )
                cohort = json.loads((cohort_dir / "medians.json").read_text())
                assert (
                    cohort["holdDays"] == 10
                    and cohort["deposits"] == 1
                    and cohort["n"] == 1
                    and cohort["excludedWallets"] == 1
                ), cohort
                assert cohort["year"] == 2026 and cohort["ledgerVersion"] == 2
                assert Upstream.market_calls == 1, (
                    f"Shared market cache missed: {Upstream.market_calls}"
                )
                (ROOT / "data/verification/accounting/results.json").write_text(
                    json.dumps(outcomes, indent=2) + "\n"
                )
                print(
                    json.dumps(
                        [
                            {k: v for k, v in x.items() if k != "payload"}
                            for x in outcomes
                        ],
                        indent=2,
                    )
                )
        finally:
            proc.terminate()
            proc.wait(timeout=15)
            server.shutdown()
