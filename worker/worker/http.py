"""Bounded retries for read-only upstream requests; never use for notifications."""

from __future__ import annotations

import random
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx
import requests

from .config import ETH_RPC_MAX_ATTEMPTS, ETH_RPC_RETRY_SLEEP_SEC
from .transport import fetch

_BUDGET_SEC = 65
_MAX_DELAY_SEC = 30
_MAX_RESPONSE_BYTES = 64 * 1024 * 1024


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


def request(method: str, url: str, *, timeout: float, rpc: bool = False, **kwargs):
    deadline = time.monotonic() + _BUDGET_SEC
    for attempt in range(ETH_RPC_MAX_ATTEMPTS):
        response = None
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise requests.Timeout("Upstream request deadline exceeded")
            try:
                reply = fetch(method, url, deadline=deadline, timeout=timeout, max_bytes=_MAX_RESPONSE_BYTES, **kwargs)
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
                for row in payload if isinstance(payload, list) else [payload]:
                    if isinstance(row, dict) and row.get("error"):
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
