"""Bounded retries for read-only upstream requests; never use for notifications."""

from __future__ import annotations

import json
import logging
import random
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx
import requests

from .config import ETH_RPC_MAX_ATTEMPTS, ETH_RPC_RETRY_SLEEP_SEC
from .transport import fetch

_BUDGET_SEC = 65
_MAX_DELAY_SEC = 30
_MAX_RESPONSE_BYTES = 64 * 1024 * 1024
_METRICS = ContextVar("rpc_metrics", default=None)


@contextmanager
def rpc_metrics(job):
    stats = {
        "operations": 0,
        "requests": 0,
        "retries": 0,
        "cache_hits": 0,
        "methods": {},
    }
    token = _METRICS.set(stats)
    try:
        yield stats
    finally:
        _METRICS.reset(token)
        if stats["operations"] or stats["cache_hits"]:
            logging.getLogger(__name__).info(
                "RPC usage job=%s %s", job, json.dumps(stats, sort_keys=True)
            )


def rpc_cache_hit():
    stats = _METRICS.get()
    if stats is not None:
        stats["cache_hits"] += 1


class RpcError(ValueError):
    def __init__(self, error):
        super().__init__(f"Ethereum RPC error: {error}")
        self.code = error.get("code") if isinstance(error, dict) else None
        message = (
            str(error.get("message", "")) if isinstance(error, dict) else str(error)
        )
        self.transient = str(self.code) == "429" or (
            str(self.code)
            in {"-32000", "-32001", "-32002", "-32005", "-32016", "-32603"}
            and any(
                text in message.lower()
                for text in (
                    "rate limit",
                    "too many requests",
                    "temporarily unavailable",
                    "server busy",
                    "overloaded",
                    "request timed out",
                )
            )
        )


def is_transient(exc: Exception) -> bool:
    if isinstance(exc, RpcError):
        return exc.transient
    return isinstance(exc, requests.RequestException) and (
        exc.response is None
        or exc.response.status_code == 429
        or exc.response.status_code >= 500
    )


def is_log_range_error(exc: Exception) -> bool:
    if is_transient(exc):
        return False
    if (
        isinstance(exc, requests.HTTPError)
        and exc.response is not None
        and exc.response.status_code == 413
    ):
        return True
    message = str(exc)
    if (
        isinstance(exc, requests.HTTPError)
        and exc.response is not None
        and exc.response.status_code == 400
    ):
        try:
            message += str(exc.response.json())
        except ValueError:
            pass
    return any(
        text in message.lower()
        for text in (
            "block range",
            "blocks range",
            "query too large",
            "response size",
            "too many results",
            "too many logs",
            "query returned more than",
            "log response size",
            "limit the query",
        )
    )


def _retry_after(response) -> float | None:
    if response is None or not response.headers.get("Retry-After"):
        return None
    raw = response.headers["Retry-After"]
    try:
        return max(0.0, float(raw))
    except ValueError:
        try:
            stamp = parsedate_to_datetime(raw)
            return max(
                0.0,
                (
                    stamp.replace(tzinfo=stamp.tzinfo or UTC) - datetime.now(UTC)
                ).total_seconds(),
            )
        except (TypeError, ValueError, OverflowError):
            return None


def request(
    method: str,
    url: str,
    *,
    timeout: float,
    rpc: bool = False,
    allow_rpc_errors: bool = False,
    **kwargs,
):
    deadline = time.monotonic() + _BUDGET_SEC
    original = kwargs.get("json") if rpc else None
    batch = original if isinstance(original, list) else None
    completed = {}
    for attempt in range(ETH_RPC_MAX_ATTEMPTS):
        response = None
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise requests.Timeout("Upstream request deadline exceeded")
            stats = _METRICS.get() if rpc else None
            if stats is not None:
                sent = kwargs.get("json")
                calls = sent if isinstance(sent, list) else [sent]
                stats["requests"] += 1
                stats["operations"] += len(calls)
                stats["retries"] += int(attempt > 0)
                for call in calls:
                    name = call["method"]
                    stats["methods"][name] = stats["methods"].get(name, 0) + 1
            try:
                reply = fetch(
                    method,
                    url,
                    deadline=deadline,
                    timeout=timeout,
                    max_bytes=_MAX_RESPONSE_BYTES,
                    **kwargs,
                )
            except (TimeoutError, httpx.TimeoutException) as exc:
                raise requests.Timeout("Upstream request timed out") from exc
            except httpx.HTTPError as exc:
                raise requests.ConnectionError("Upstream connection failed") from exc
            # Preserve the Requests response/error contract used by worker jobs.
            response = requests.Response()
            response.status_code = reply.status
            response.headers = requests.structures.CaseInsensitiveDict(reply.headers)
            response._content = reply.body
            response._content_consumed = True
            response.url = reply.url
            response.reason = reply.reason
            response.request = requests.Request(method, reply.url).prepare()
            response.raise_for_status()
            if rpc:
                payload = response.json()
                if batch is not None:
                    pending = kwargs["json"]
                    expected = {call["id"] for call in pending}
                    if (
                        not isinstance(payload, list)
                        or len(payload) != len(expected)
                        or any(not isinstance(row, dict) for row in payload)
                    ):
                        raise ValueError("Incomplete Ethereum RPC batch response")
                    rows = {row.get("id"): row for row in payload}
                    if len(rows) != len(payload) or set(rows) != expected:
                        raise ValueError("Invalid Ethereum RPC batch response IDs")
                    retry_ids = set()
                    for ident, row in rows.items():
                        error = RpcError(row["error"]) if row.get("error") else None
                        if (
                            error is not None
                            and not error.transient
                            and not allow_rpc_errors
                        ):
                            raise error
                        if error is not None and error.transient:
                            retry_ids.add(ident)
                        else:
                            completed[ident] = row
                    if retry_ids and attempt + 1 < ETH_RPC_MAX_ATTEMPTS:
                        kwargs = {
                            **kwargs,
                            "json": [
                                call for call in pending if call["id"] in retry_ids
                            ],
                        }
                        raise RpcError(rows[next(iter(retry_ids))]["error"])
                    completed.update(rows)
                    payload = [completed[call["id"]] for call in batch]
                    response._content = json.dumps(payload).encode()
                    if len(response._content) > _MAX_RESPONSE_BYTES:
                        raise ValueError("Ethereum RPC batch response is too large")
                    response.headers["Content-Length"] = str(len(response._content))
                for row in payload if isinstance(payload, list) else [payload]:
                    if (
                        isinstance(row, dict)
                        and row.get("error")
                        and not (batch is not None and allow_rpc_errors)
                    ):
                        raise RpcError(row["error"])
            return response
        except (requests.RequestException, RpcError) as exc:
            if attempt + 1 >= ETH_RPC_MAX_ATTEMPTS or not is_transient(exc):
                raise
            server_delay = _retry_after(response)
            delay = max(server_delay or 0, ETH_RPC_RETRY_SLEEP_SEC * 2**attempt)
            delay += random.uniform(0, min(0.25, delay / 4))
            # A long Retry-After fails safely instead of retrying before allowed.
            if delay > _MAX_DELAY_SEC or delay >= deadline - time.monotonic():
                raise
            if response is not None:
                response.close()
            time.sleep(delay)
