"""Read-only, flow-adjusted Flex performance at indexed archive blocks.

Position P&L excludes gas, swap execution and assets held outside Flex. Lender
values are reported ERC-4626 assets, not a projection of unreported interest.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from collections import OrderedDict, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal, localcontext

import httpx
from fastapi import HTTPException

from app.archive_cache import HistoricalCache
from app.flex_service import _read_cursor
from app.transport import fetch

WAD = 10**18
YEAR = 365 * 86400
ZERO = "0x" + "0" * 40
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
FEEDS = {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6",
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
}
SELECTORS = {
    "oracle": "0x7015186c",
    "round": "0xfeaf968c",
    "decimals": "0x313ce567",
    "balance": "0x70a08231",
    "assets": "0x07a2d13a",
    "total": "0x01e1d114",
    "trove": "0x87553b7e",
    "debt": "0x0ff8afc1",
}
CACHE: OrderedDict[tuple, tuple[float, dict | HTTPException]] = OrderedDict()
PENDING = {}
LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="flex-performance")
ARCHIVE_TIMEOUT_SEC = 60
MAX_ARCHIVE_CALLS = 1600
SHARED = HistoricalCache()
LOGGER = logging.getLogger("uvicorn.error.flex_rpc")


class CoverageError(ValueError):
    """History cannot support an honest numeric result."""


class Archive:
    def __init__(self):
        self.url = os.getenv("FLEX_PERFORMANCE_RPC_URL") or os.getenv("ETH_RPC_URL")
        if not self.url:
            raise HTTPException(503, "Performance is temporarily unavailable.")
        self.deadline = time.monotonic() + ARCHIVE_TIMEOUT_SEC
        self.cache = {}
        self.failed = set()
        self.calls = 0
        self.requests = 0
        self.cache_hits = 0
        self.methods = defaultdict(int)
        self.anchor = None

    def bind(self, end, expected_hash):
        # Chain identity and the indexed anchor are always fresh for a build.
        if self.rpc("eth_chainId", []) != "0x1":
            raise CoverageError("Performance requires Ethereum history.")
        block = self.block(end)
        if str(block.get("hash", "")).lower() != expected_hash.lower():
            raise CoverageError("Indexed block does not match archive history.")
        self.anchor = (self.url, end, expected_hash.lower())
        return block

    def _shared_key(self, method, params):
        if self.anchor is None:
            return None
        try:
            if method == "eth_call":
                block = params[1]
                eligible = (
                    isinstance(block, str)
                    and block.startswith("0x")
                    and 0 <= int(block, 16) <= self.anchor[1]
                )
            elif method == "eth_getBlockByNumber":
                block = params[0]
                eligible = (
                    isinstance(block, str)
                    and block.startswith("0x")
                    and 0 <= int(block, 16) <= self.anchor[1]
                )
            elif method == "eth_getLogs":
                query = params[0]
                eligible = (
                    0
                    <= int(query["fromBlock"], 16)
                    <= int(query["toBlock"], 16)
                    <= self.anchor[1]
                )
            else:
                eligible = False
        except (KeyError, IndexError, TypeError, ValueError):
            eligible = False
        return (
            (*self.anchor, json.dumps([method, params], sort_keys=True))
            if eligible
            else None
        )

    def _cached(self, method, params, key):
        shared = self._shared_key(method, params)
        if shared is None:
            return None, None
        raw, future, owner = SHARED.acquire(shared)
        if raw is not None:
            self.cache[key] = json.loads(raw)
            self.cache_hits += 1
            return None, None
        if owner:
            return (shared, future), None
        return None, future

    def _wait(self, key, future):
        try:
            raw = future.result(timeout=max(0, self.deadline - time.monotonic()))
            self.cache[key] = json.loads(raw)
            self.cache_hits += 1
        except (TimeoutError, ValueError) as exc:
            self.failed.add(key)
            raise CoverageError("Historical RPC data is unavailable.") from exc

    def _store(self, key, result, claim):
        # Only JSON-RPC successes enter the shared cache. Readers independently
        # retain ABI, price age, transfer and reconciliation validation.
        if result is None:
            raise CoverageError("Historical RPC data is unavailable.")
        if claim is not None:
            method, params = json.loads(key)
            valid = False
            if method == "eth_call":
                valid = (
                    isinstance(result, str)
                    and result.startswith("0x")
                    and len(result) > 2
                    and (len(result) - 2) % 64 == 0
                )
            elif method == "eth_getBlockByNumber":
                valid = (
                    isinstance(result, dict)
                    and result.get("number") == params[0]
                    and isinstance(result.get("hash"), str)
                    and len(result["hash"]) == 66
                )
            elif method == "eth_getLogs":
                valid = isinstance(result, list) and all(
                    isinstance(log, dict) and not log.get("removed") for log in result
                )
            if valid:
                try:
                    if method == "eth_call":
                        bytes.fromhex(result[2:])
                    elif method == "eth_getBlockByNumber":
                        bytes.fromhex(result["hash"][2:])
                        valid = (
                            result["hash"].startswith("0x")
                            and int(result["timestamp"], 16) >= 0
                        )
                    else:
                        query = params[0]
                        for log in result:
                            valid &= (
                                log["address"].lower() == query["address"].lower()
                                and int(query["fromBlock"], 16)
                                <= int(log["blockNumber"], 16)
                                <= int(query["toBlock"], 16)
                                and len(log["topics"]) == 3
                                and log["topics"][0].lower() == TRANSFER
                                and len(log["transactionHash"]) == 66
                                and int(log["logIndex"], 16) >= 0
                            )
                            bytes.fromhex(log["data"][2:])
                            bytes.fromhex(log["transactionHash"][2:])
                            for topic in log["topics"]:
                                bytes.fromhex(topic[2:])
                except (KeyError, ValueError, TypeError, AttributeError):
                    valid = False
            if valid:
                SHARED.resolve(*claim, result=result)
            else:
                SHARED.resolve(
                    *claim, error=CoverageError("Historical RPC data is malformed.")
                )
        self.cache[key] = result

    def rpc(self, method, params):
        key = json.dumps([method, params], sort_keys=True)
        if key in self.failed:
            raise CoverageError("Historical RPC data is unavailable.")
        if key in self.cache:
            return self.cache[key]
        claim, waiting = self._cached(method, params, key)
        if waiting is not None:
            self._wait(key, waiting)
        if key in self.cache:
            return self.cache[key]
        remaining = self.deadline - time.monotonic()
        try:
            if remaining <= 0 or self.calls >= MAX_ARCHIVE_CALLS:
                raise CoverageError("Historical lookup limit reached.")
            self.calls += 1
            self.methods[method] += 1
            data = self._request(
                {"jsonrpc": "2.0", "id": self.calls, "method": method, "params": params}
            )
            if (
                not isinstance(data, dict)
                or data.get("id") != self.calls
                or data.get("error")
                or data.get("result") is None
            ):
                raise CoverageError("Historical RPC data is unavailable.")
            self._store(key, data["result"], claim)
            return data["result"]
        except (httpx.HTTPError, TimeoutError, OSError, ValueError) as exc:
            self.failed.add(key)
            if claim is not None:
                SHARED.resolve(
                    *claim, error=CoverageError("Historical RPC data is unavailable.")
                )
            raise CoverageError("Historical RPC data is unavailable.") from exc

    def warm(self, calls):
        """Batch independent archive reads; shared prices are fetched only once."""
        pending, claims, waiting = {}, {}, {}
        for method, params in calls:
            key = json.dumps([method, params], sort_keys=True)
            if key not in self.cache and key not in self.failed:
                pending[key] = (method, params)
        for key, (method, params) in list(pending.items()):
            claim, future = self._cached(method, params, key)
            if claim is not None:
                claims[key] = claim
            if future is not None:
                waiting[key] = future
            if future is not None or key in self.cache:
                del pending[key]
        items = list(pending.items())
        try:
            self._warm(items, claims)
            for key, future in waiting.items():
                try:
                    self._wait(key, future)
                except CoverageError:
                    # Match a direct batch's per-item failure semantics. An
                    # unavailable read must not discard other covered rows.
                    if time.monotonic() >= self.deadline:
                        raise
        finally:
            # Release even unsent claims after timeouts/malformed responses.
            for key, claim in claims.items():
                if key not in self.cache:
                    SHARED.resolve(
                        *claim,
                        error=CoverageError("Historical RPC data is unavailable."),
                    )

    def _warm(self, items, claims):
        for offset in range(0, len(items), 40):
            chunk = items[offset : offset + 40]
            remaining = self.deadline - time.monotonic()
            if remaining <= 0 or self.calls + len(chunk) > MAX_ARCHIVE_CALLS:
                raise CoverageError("Historical lookup limit reached.")
            payload = []
            ids = {}
            for key, (method, params) in chunk:
                self.calls += 1
                self.methods[method] += 1
                ids[self.calls] = key
                payload.append(
                    {
                        "jsonrpc": "2.0",
                        "id": self.calls,
                        "method": method,
                        "params": params,
                    }
                )
            try:
                results = self._request(payload)
                if not isinstance(results, list):
                    raise CoverageError("Historical RPC batch is unavailable.")
                response_ids = [
                    result.get("id") for result in results if isinstance(result, dict)
                ]
                if (
                    len(response_ids) != len(results)
                    or len(set(response_ids)) != len(results)
                    or set(response_ids) - ids.keys()
                ):
                    raise CoverageError("Historical RPC batch is malformed.")
                seen = set()
                for result in results:
                    if not isinstance(result, dict):
                        raise CoverageError("Historical RPC batch is malformed.")
                    key = ids.get(result.get("id"))
                    if key is None or key in seen:
                        raise CoverageError("Historical RPC batch is malformed.")
                    seen.add(key)
                    if result.get("error") or result.get("result") is None:
                        self.failed.add(key)
                    else:
                        self._store(key, result["result"], claims.get(key))
                self.failed.update(set(ids.values()) - seen)
            except (httpx.HTTPError, TimeoutError, OSError, ValueError) as exc:
                raise CoverageError("Historical RPC data is unavailable.") from exc

    def _request(self, payload):
        self.requests += 1
        reply = fetch(
            "POST",
            self.url,
            json=payload,
            deadline=self.deadline,
            timeout=12,
            max_bytes=4 * 1024 * 1024,
        )
        if reply.status >= 400:
            raise CoverageError("Historical RPC data is unavailable.")
        return json.loads(reply.body)

    def block(self, block):
        result = self.rpc("eth_getBlockByNumber", [hex(block), False])
        if not isinstance(result, dict) or int(result.get("number", "-1"), 16) != block:
            raise CoverageError("Historical block is unavailable.")
        return result

    def at(self, target, block, selector, argument=""):
        result = self.rpc(
            "eth_call",
            [{"to": target, "data": SELECTORS[selector] + argument}, hex(block)],
        )
        if (
            not isinstance(result, str)
            or not result.startswith("0x")
            or len(result[2:]) % 64
        ):
            raise CoverageError("Historical contract value is unavailable.")
        return [int(result[i : i + 64], 16) for i in range(2, len(result), 64)]

    def uint(self, target, block, selector, argument=""):
        words = self.at(target, block, selector, argument)
        if len(words) != 1:
            raise CoverageError("Historical contract value is malformed.")
        return words[0]

    def before(self, target_time, end, bounds):
        low, high = (
            int(bounds.get("lower") or 0),
            min(end, int(bounds.get("upper") or end)),
        )
        while low < high:
            mid = (low + high + 1) // 2
            if int(self.block(mid)["timestamp"], 16) <= target_time:
                low = mid
            else:
                high = mid - 1
        return low

    def price(self, market, block, collateral=False):
        feed = FEEDS.get(market["borrow_token_address"].lower())
        if not feed:
            raise CoverageError("Borrow asset has no supported USD feed.")
        words = self.at(feed, block, "round")
        decimals = self.uint(feed, block, "decimals")
        stamp = int(self.block(block)["timestamp"], 16)
        if (
            len(words) != 5
            or decimals > 18
            or not 0 < words[1] < 2**255
            or not 0 < words[3] <= stamp
            or stamp - words[3] > 2 * 86400
            or words[4] < words[0]
        ):
            raise CoverageError("Historical USD price is unavailable.")
        usd = Decimal(words[1]) / 10**decimals
        if collateral:
            oracle = self.uint(
                market["price_oracle_address"], block, "oracle", "0" * 64
            )
            if oracle <= 0:
                raise CoverageError("Historical collateral price is unavailable.")
            usd *= Decimal(oracle) / WAD
        return usd

    def value(self, market, block, raw, collateral=False):
        if not raw:
            return Decimal(0)
        decimals = market[
            "collateral_token_decimals" if collateral else "borrow_token_decimals"
        ]
        return (
            Decimal(raw) / 10 ** int(decimals) * self.price(market, block, collateral)
        )

    def transfers(self, market, owner, start, end):
        topic = "0x" + owner[2:].rjust(64, "0")
        logs = {}
        minimum = max(start + 1, int(market["deployment_block"]))
        # Clip the initial window; complete fixed windows still share across ranges.
        lower = minimum
        windows = (
            [lower, *range((lower // 50000 + 1) * 50000, end + 1, 50000)]
            if minimum <= end
            else []
        )
        queries = [
            {
                "address": market["lender_address"],
                "fromBlock": hex(lower),
                "toBlock": hex(min(end, (lower // 50000 + 1) * 50000 - 1)),
                "topics": topics,
            }
            for lower in windows
            for topics in ([TRANSFER, topic], [TRANSFER, None, topic])
        ]
        self.warm([("eth_getLogs", [query]) for query in queries])
        for query in queries:
            result = self.rpc("eth_getLogs", [query])
            if not isinstance(result, list):
                raise CoverageError("Share transfer history is invalid.")
            for log in result:
                if (
                    not isinstance(log, dict)
                    or log.get("removed")
                    or log.get("address", "").lower()
                    != market["lender_address"].lower()
                ):
                    raise CoverageError("Share transfer history is invalid.")
                block = int(log["blockNumber"], 16)
                if (
                    not int(query["fromBlock"], 16)
                    <= block
                    <= int(query["toBlock"], 16)
                ):
                    raise CoverageError("Share transfer history is outside its query.")
                if not start < block <= end:
                    continue
                logs[(log["transactionHash"].lower(), int(log["logIndex"], 16))] = log
            # Limit the period's events; the transport also bounds response size.
            if len(logs) > 2500:
                raise CoverageError("Share transfer history is too large.")
        return sorted(
            logs.values(),
            key=lambda log: (int(log["blockNumber"], 16), int(log["logIndex"], 16)),
        )


def money(value):
    return round(float(value), 2)


def blank(market, kind, position=None):
    return {
        "market_address": market["market_address"],
        "market_label": market["label"],
        "kind": kind,
        "position_id": position,
        "start_value_usd": None,
        "end_value_usd": None,
        "net_funding_usd": None,
        "pnl_usd": None,
        "is_complete": False,
        "issue": None,
    }


def finish(row, opening, closing, funding):
    row.update(
        start_value_usd=money(opening),
        end_value_usd=money(closing),
        net_funding_usd=money(funding),
        pnl_usd=money(closing - opening - funding),
        is_complete=True,
    )
    return row


def debt_at(book, stamp, precision):
    return (
        book["debt"]
        + book["debt"]
        * book["rate"]
        * max(0, stamp - book["last"])
        // YEAR
        // precision
    )


def borrower(archive, market, events, start, end, start_time, end_time):
    ident = events[0]["amounts"]["trove_id"]
    row = blank(market, "trove", ident)
    book = {"debt": 0, "collateral": 0, "rate": 0, "last": 0}
    funding = Decimal(0)
    opening = None
    seen = False
    terminal = False
    pending_bad_debt = None
    active_period = False
    precision = 10 ** int(market["borrow_token_decimals"])
    if market["contract_version"] != "1.1.0":
        row["issue"] = "Older trove accounting is not supported."
        return row
    try:
        for event in events:
            block, name, a = (
                int(event["block_number"]),
                event["event_name"],
                event["amounts"],
            )
            stamp = int(event["block_time"].timestamp())
            if terminal or stamp < book["last"]:
                raise CoverageError("Position history is out of order.")
            if block > start and opening is None:
                opening = dict(book)
            in_period = block > start
            active_period |= in_period
            if pending_bad_debt and name != "liquidation":
                raise CoverageError("Bad debt does not match a full liquidation.")
            if name == "open_trove":
                if seen:
                    raise CoverageError("Opening history is inconsistent.")
                seen = True
                book.update(
                    collateral=int(a["collateral_raw"]),
                    debt=int(a["debt_raw"]) + int(a["upfront_fee_raw"]),
                    rate=int(a["annual_interest_rate_raw"]),
                    last=stamp,
                )
                if in_period:
                    funding += archive.value(
                        market, block, book["collateral"], True
                    ) - archive.value(market, block, int(a["debt_raw"]))
                continue
            if not seen:
                raise CoverageError("Opening history is missing.")
            if name == "bad_debt":
                loss = int(a["loss_raw"])
                absorbed = int(a["loss_absorbed_by_fees_raw"])
                if loss <= 0 or not 0 <= absorbed <= loss:
                    raise CoverageError("Bad-debt history cannot be reconciled.")
                pending_bad_debt = event
                continue
            owed = debt_at(book, stamp, precision)
            coll = int(a.get("collateral_raw", 0))
            amount = int(a.get("debt_raw", 0))
            if coll < 0 or amount < 0:
                raise CoverageError("Position history cannot be reconciled.")
            if name in ("add_collateral", "remove_collateral"):
                sign = 1 if name == "add_collateral" else -1
                book["collateral"] += sign * coll
                if in_period:
                    funding += sign * archive.value(market, block, coll, True)
            elif name == "borrow":
                principal = amount - owed - int(a["upfront_fee_raw"])
                if principal < 0:
                    raise CoverageError("Borrow history cannot be reconciled.")
                book.update(debt=amount, last=stamp)
                if in_period:
                    funding -= archive.value(market, block, principal)
            elif name == "repay":
                book.update(debt=owed - amount, last=stamp)
                if in_period:
                    funding += archive.value(market, block, amount)
            elif name == "adjust_interest_rate":
                book.update(
                    debt=owed + int(a["upfront_fee_raw"]),
                    rate=int(a["annual_interest_rate_raw"]),
                    last=stamp,
                )
            elif name == "redeem_trove":
                book.update(
                    debt=owed - amount, collateral=book["collateral"] - coll, last=stamp
                )
            elif name in ("close_trove", "close_zombie_trove"):
                if amount != owed or coll != book["collateral"]:
                    raise CoverageError("Closeout history cannot be reconciled.")
                if in_period:
                    funding += archive.value(market, block, amount) - archive.value(
                        market, block, coll, True
                    )
                book.update(debt=0, collateral=0, rate=0, last=stamp)
                terminal = True
            elif name == "liquidation":
                loss = 0
                if pending_bad_debt:
                    if (
                        not a["is_full_liquidation"]
                        or pending_bad_debt["tx_hash"] != event["tx_hash"]
                        or int(pending_bad_debt["block_number"]) != block
                        or int(pending_bad_debt["log_index"]) >= int(event["log_index"])
                    ):
                        raise CoverageError(
                            "Bad debt does not match a full liquidation."
                        )
                    loss = int(pending_bad_debt["amounts"]["loss_raw"])
                    pending_bad_debt = None
                if coll > book["collateral"]:
                    raise CoverageError("Liquidation history cannot be reconciled.")
                if a["is_full_liquidation"]:
                    if amount + loss != owed:
                        raise CoverageError("Liquidation debt cannot be reconciled.")
                    if in_period:
                        funding -= archive.value(
                            market, block, book["collateral"] - coll, True
                        )
                    book.update(debt=0, collateral=0, rate=0, last=stamp)
                    terminal = True
                else:
                    book.update(
                        debt=owed - amount,
                        collateral=book["collateral"] - coll,
                        last=stamp,
                    )
            else:
                raise CoverageError("Unsupported trove event.")
            if book["debt"] < 0 or book["collateral"] < 0:
                raise CoverageError("Position history cannot be reconciled.")
        if pending_bad_debt:
            raise CoverageError("Bad debt does not match a full liquidation.")
        opening = opening if opening is not None else dict(book)
        if not active_period and not opening["debt"] and not opening["collateral"]:
            return None

        def equity(state, block, stamp):
            if block < int(market["deployment_block"]):
                return Decimal(0)
            actual = archive.at(
                market["market_address"], block, "trove", f"{int(ident):064x}"
            )
            debt = archive.uint(
                market["market_address"], block, "debt", f"{int(ident):064x}"
            )
            if (
                len(actual) < 2
                or actual[1] != state["collateral"]
                or debt != debt_at(state, stamp, precision)
            ):
                raise CoverageError("Position history does not match the chain.")
            return archive.value(market, block, actual[1], True) - archive.value(
                market, block, debt
            )

        return finish(
            row,
            equity(opening, start, start_time),
            equity(book, end, end_time),
            funding,
        )
    except (CoverageError, KeyError, ValueError, TypeError, IndexError) as exc:
        row["issue"] = (
            str(exc)
            if isinstance(exc, CoverageError)
            else "Position history is incomplete."
        )
        return row


def lender(archive, market, events, owner, start, end):
    row = blank(market, "lender_position" if owner else "lender_pool")
    relevant = [e for e in events if int(e["block_number"]) > start]
    flows = [
        e
        for e in relevant
        if e["event_name"] in ("lender_deposit", "lender_withdrawal")
        and (not owner or str(e["actors"].get("owner", "")).lower() == owner)
    ]
    try:
        if owner:
            arg = owner[2:].rjust(64, "0")
            before = (
                0
                if start < int(market["deployment_block"])
                else archive.uint(market["lender_address"], start, "balance", arg)
            )
            after = archive.uint(market["lender_address"], end, "balance", arg)
            logs = archive.transfers(market, owner, start, end)
            if not before and not after and not flows and not logs:
                return None
        else:
            before = (
                0
                if start < int(market["deployment_block"])
                else archive.uint(market["lender_address"], start, "total")
            )
            after = archive.uint(market["lender_address"], end, "total")
            logs = []
        # Auction proceeds may bypass the ERC-4626 asset transfer/event. Do not
        # pretend that event assets alone represent the lender's cash outflow.
        auction_txs = {
            e["tx_hash"] for e in relevant if e["event_name"] == "redemption"
        }
        if any(
            e["event_name"] == "lender_withdrawal" and e["tx_hash"] in auction_txs
            for e in flows
        ):
            raise CoverageError(
                "Auction withdrawal proceeds need additional settlement history."
            )
        funding = Decimal(0)
        for e in flows:
            sign = 1 if e["event_name"] == "lender_deposit" else -1
            funding += sign * archive.value(
                market, int(e["block_number"]), int(e["amounts"]["assets_raw"])
            )
        paired = defaultdict(list)
        for e in flows:
            key = (
                e["tx_hash"].lower(),
                e["event_name"] == "lender_deposit",
                int(e["amounts"]["shares_raw"]),
            )
            paired[key].append(e)
        balance = before
        for log in logs:
            topics = log.get("topics", [])
            if len(topics) != 3 or topics[0].lower() != TRANSFER:
                raise CoverageError("Share transfer history is malformed.")
            sender, receiver = (
                "0x" + topics[1][-40:].lower(),
                "0x" + topics[2][-40:].lower(),
            )
            amount = int(log["data"], 16)
            if sender == receiver:
                continue
            incoming = receiver == owner
            if sender != owner and not incoming:
                raise CoverageError("Unexpected share transfer.")
            balance += amount if incoming else -amount
            key = (log["transactionHash"].lower(), incoming, amount)
            is_mint_or_burn = sender == ZERO or receiver == ZERO
            if is_mint_or_burn and paired[key]:
                paired[key].pop()
                continue
            assets = archive.uint(
                market["lender_address"],
                int(log["blockNumber"], 16),
                "assets",
                f"{amount:064x}",
            )
            funding += (1 if incoming else -1) * archive.value(
                market, int(log["blockNumber"], 16), assets
            )
        if owner and (balance != after or any(paired.values())):
            raise CoverageError("Share and cash-flow histories do not match.")

        def value(amount, block):
            assets = (
                archive.uint(
                    market["lender_address"], block, "assets", f"{amount:064x}"
                )
                if owner and amount
                else amount
            )
            return archive.value(market, block, assets)

        return finish(row, value(before, start), value(after, end), funding)
    except (CoverageError, KeyError, ValueError, TypeError, IndexError) as exc:
        row["issue"] = (
            str(exc)
            if isinstance(exc, CoverageError)
            else "Lender history is incomplete."
        )
        return row


def summary(rows):
    rows = [row for row in rows if row is not None]
    complete = all(row["is_complete"] for row in rows)
    return {
        "pnl_usd": money(sum(Decimal(str(row["pnl_usd"])) for row in rows))
        if complete
        else None,
        "end_value_usd": money(sum(Decimal(str(row["end_value_usd"])) for row in rows))
        if complete
        else None,
        "positions": len(rows),
        "covered_positions": sum(row["is_complete"] for row in rows),
        "rows": rows,
    }


def position_groups(events, address, start):
    grouped = defaultdict(list)
    for event in events:
        if "trove_id" in event["amounts"]:
            grouped[str(event["amounts"]["trove_id"])].append(event)
    if len(grouped) > 500:
        raise CoverageError("Too many positions for this lookup.")
    selected = []
    for group in grouped.values():
        last = group[-1]
        closed = last["event_name"] in ("close_trove", "close_zombie_trove") or (
            last["event_name"] == "liquidation"
            and last["amounts"].get("is_full_liquidation")
        )
        if int(last["block_number"]) <= start and closed:
            continue
        if address and not any(
            str(event["actors"].get("owner", "")).lower() == address for event in group
        ):
            continue
        selected.append(group)
    return selected


def build_performance(address, days):
    archive = Archive()
    try:
        return _build_performance(archive, address, days)
    finally:
        LOGGER.info(
            "Flex RPC usage days=%s %s",
            days,
            json.dumps(
                {
                    "operations": archive.calls,
                    "requests": archive.requests,
                    "cache_hits": archive.cache_hits,
                    "methods": archive.methods,
                },
                sort_keys=True,
            ),
        )


def _build_performance(archive, address, days):
    if archive.rpc("eth_chainId", []) != "0x1":
        raise CoverageError("Performance requires Ethereum history.")
    with _read_cursor() as cur:
        cur.execute(
            "SELECT *, COALESCE(raw_metadata->>'label',collateral_token_symbol||'/'||borrow_token_symbol) AS label FROM flex_market_dim WHERE chain_id=1 AND (%s OR market_status='active') ORDER BY market_address",
            (address is not None,),
        )
        markets = cur.fetchall()
        if not markets:
            raise HTTPException(503, "Performance is temporarily unavailable.")
        cur.execute(
            "SELECT MIN(latest) AS end_block, COUNT(*) AS covered FROM (SELECT market_address,MAX(block_number) AS latest FROM flex_market_snapshots WHERE chain_id=1 AND market_address=ANY(%s) GROUP BY market_address) latest",
            ([market["market_address"] for market in markets],),
        )
        source = cur.fetchone() or {}
        end = int(source.get("end_block") or 0)
        if not end or source.get("covered") != len(markets):
            raise HTTPException(503, "Performance is temporarily unavailable.")
        cur.execute(
            "SELECT cursor FROM flex_sync_state WHERE chain_id=1 AND stream_name='events'"
        )
        indexed = (cur.fetchone() or {}).get("cursor")
        if indexed is None or int(indexed) < end:
            raise HTTPException(503, "Performance is temporarily unavailable.")
        cur.execute(
            "SELECT block_hash FROM flex_market_snapshots WHERE chain_id=1 AND block_number=%s LIMIT 1",
            (end,),
        )
        expected_hash = cur.fetchone()["block_hash"]
        target = datetime.fromtimestamp(
            int(archive.block(end)["timestamp"], 16) - days * 86400, UTC
        )
        cur.execute(
            "SELECT MAX(block_number) FILTER (WHERE block_time<=%s) AS lower, MIN(block_number) FILTER (WHERE block_time>%s) AS upper FROM flex_market_snapshots WHERE chain_id=1",
            (target, target),
        )
        bounds = cur.fetchone() or {}
        cur.execute(
            "SELECT * FROM flex_events WHERE chain_id=1 AND block_number<=%s ORDER BY block_number,log_index LIMIT 10001",
            (end,),
        )
        events = cur.fetchall()
        if len(events) > 10000:
            raise CoverageError("Indexed history is too large for this lookup.")
    anchor = archive.block(end)
    archive.bind(end, expected_hash)
    end_time = int(anchor["timestamp"], 16)
    start = archive.before(end_time - days * 86400, end, bounds)
    start_time = int(archive.block(start)["timestamp"], 16)
    calls = []

    def call(target, block, selector, argument=""):
        calls.append(
            (
                "eth_call",
                [{"to": target, "data": SELECTORS[selector] + argument}, hex(block)],
            )
        )

    contexts = []
    for market in markets:
        if int(market["deployment_block"]) > end:
            continue
        market_events = [
            e for e in events if e["market_address"] == market["market_address"]
        ]
        groups = position_groups(market_events, address, start)
        contexts.append((market, market_events, groups))
        for block in (start, end):
            if block < int(market["deployment_block"]):
                continue
            call(
                market["lender_address"],
                block,
                "balance" if address else "total",
                address[2:].rjust(64, "0") if address else "",
            )
        if market["contract_version"] == "1.1.0":
            for group in groups:
                ident = group[0]["amounts"]["trove_id"]
                for block in (start, end):
                    if block >= int(market["deployment_block"]):
                        for selector in ("trove", "debt"):
                            call(
                                market["market_address"],
                                block,
                                selector,
                                f"{int(ident):064x}",
                            )
    archive.warm(calls)
    calls = []

    def price(market, block, collateral=False):
        calls.append(("eth_getBlockByNumber", [hex(block), False]))
        feed = FEEDS.get(market["borrow_token_address"].lower())
        if feed:
            call(feed, block, "round")
            call(feed, block, "decimals")
        if collateral:
            call(market["price_oracle_address"], block, "oracle", "0" * 64)

    def positive(value):
        try:
            return int(value) > 0
        except (TypeError, ValueError):
            return False

    for market, market_events, groups in contexts:
        for block in (start, end):
            if block < int(market["deployment_block"]):
                continue
            try:
                amount = archive.uint(
                    market["lender_address"],
                    block,
                    "balance" if address else "total",
                    address[2:].rjust(64, "0") if address else "",
                )
                if amount:
                    price(market, block)
                if market["contract_version"] == "1.1.0":
                    for group in groups:
                        ident = f"{int(group[0]['amounts']['trove_id']):064x}"
                        state = archive.at(
                            market["market_address"], block, "trove", ident
                        )
                        debt = archive.uint(
                            market["market_address"], block, "debt", ident
                        )
                        if len(state) > 1 and state[1]:
                            price(market, block, True)
                        elif debt:
                            price(market, block)
            except (CoverageError, KeyError, ValueError, TypeError, IndexError):
                # The calculation reports the original incomplete row; failed
                # endpoint state must not trigger speculative price requests.
                continue
        for event in market_events:
            if (
                int(event["block_number"]) > start
                and event["event_name"] in ("lender_deposit", "lender_withdrawal")
                and (
                    not address
                    or str(event["actors"].get("owner", "")).lower() == address
                )
                and positive(event["amounts"].get("assets_raw"))
            ):
                price(market, int(event["block_number"]))
        if market["contract_version"] == "1.1.0":
            for group in groups:
                for event in group:
                    block, name, amounts = (
                        int(event["block_number"]),
                        event["event_name"],
                        event["amounts"],
                    )
                    if block <= start:
                        continue
                    if (
                        name
                        in (
                            "open_trove",
                            "add_collateral",
                            "remove_collateral",
                            "close_trove",
                            "close_zombie_trove",
                        )
                        and positive(amounts.get("collateral_raw"))
                        or name == "liquidation"
                        and amounts.get("is_full_liquidation")
                    ):
                        price(market, block, True)
                    elif name in (
                        "open_trove",
                        "borrow",
                        "repay",
                        "close_trove",
                        "close_zombie_trove",
                    ) and positive(amounts.get("debt_raw")):
                        price(market, block)
    archive.warm(calls)
    borrower_rows, lender_rows = [], []
    for market, market_events, groups in contexts:
        for group in groups:
            borrower_rows.append(
                borrower(archive, market, group, start, end, start_time, end_time)
            )
        lender_rows.append(lender(archive, market, market_events, address, start, end))
    return {
        "scope": {
            "chain_id": 1,
            "source": "ethereum_archive_rpc",
            "address": address,
            "market_status": "all" if address else "active",
        },
        "period": {
            "days": days,
            "start_at": datetime.fromtimestamp(start_time, UTC).isoformat(),
            "end_at": datetime.fromtimestamp(end_time, UTC).isoformat(),
            "start_block": start,
            "end_block": end,
        },
        "freshness": {
            "data_state": "delayed" if time.time() - end_time > 7200 else "ready"
        },
        "borrowers": summary(borrower_rows),
        "lenders": summary(lender_rows),
    }


async def performance_response(address, days):
    key = (address, days)
    with LOCK:
        cached = CACHE.get(key)
        if cached and cached[0] > time.monotonic():
            CACHE.move_to_end(key)
            if isinstance(cached[1], HTTPException):
                raise HTTPException(
                    cached[1].status_code, cached[1].detail, headers=cached[1].headers
                )
            return cached[1]
        future = PENDING.get(key)
        if future is None:
            if len(PENDING) >= 2:
                raise HTTPException(
                    503,
                    "Performance is temporarily unavailable.",
                    headers={"Retry-After": "5"},
                )
            future = EXECUTOR.submit(_calculate_performance, key, address, days)
            PENDING[key] = future
    try:
        # Waiters use the event loop, leaving ordinary API request threads free.
        # Cancelling one viewer must not cancel a calculation shared by others.
        return await asyncio.wait_for(
            asyncio.shield(asyncio.wrap_future(future)), timeout=65
        )
    except TimeoutError as exc:
        raise HTTPException(503, "Performance is temporarily unavailable.") from exc


def _calculate_performance(key, address, days):
    try:
        with localcontext() as context:
            context.prec = 90
            payload = build_performance(address, days)
        if len(json.dumps(payload)) > 512 * 1024:
            raise CoverageError("Performance response is too large.")
        ttl = (
            300
            if payload["borrowers"]["pnl_usd"] is not None
            and payload["lenders"]["pnl_usd"] is not None
            else 60
        )
        with LOCK:
            CACHE[key] = (time.monotonic() + ttl, payload)
            while len(CACHE) > 64:
                CACHE.popitem(last=False)
        return payload
    except (CoverageError, ValueError, KeyError, TypeError, IndexError) as exc:
        error = HTTPException(502, "Performance history is temporarily unavailable.")
        with LOCK:
            CACHE[key] = (
                time.monotonic() + 5,
                HTTPException(error.status_code, error.detail, headers=error.headers),
            )
            while len(CACHE) > 64:
                CACHE.popitem(last=False)
        raise error from exc
    finally:
        with LOCK:
            PENDING.pop(key, None)
