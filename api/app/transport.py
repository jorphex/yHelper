"""Cancellable HTTP I/O for synchronous callers, with per-thread keepalive pools.

Packaged identically in API and worker because their images build independently.
"""

from __future__ import annotations

import asyncio
import threading
import time
import weakref
from dataclasses import dataclass

import httpx

_LOCAL = threading.local()


class ResponseTooLarge(ValueError):
    pass


@dataclass(frozen=True)
class Reply:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str
    reason: str


def _close(runner, client):
    try:
        if not runner.get_loop().is_running():
            try:
                runner.run(client.aclose())
            finally:
                runner.close()
    except (RuntimeError, OSError):
        # Interpreter shutdown may already have closed the event loop.
        pass


class _Transport:
    def __init__(self):
        self.runner = asyncio.Runner()
        self.client = httpx.AsyncClient(follow_redirects=True, max_redirects=10)
        weakref.finalize(self, _close, self.runner, self.client)


async def _fetch(client, method, url, deadline, timeout, max_bytes, kwargs):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Upstream request deadline exceeded")
    async with asyncio.timeout(remaining):
        async with client.stream(
            method, url, timeout=min(timeout, remaining), **kwargs
        ) as response:
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > max_bytes:
                    raise ResponseTooLarge("Upstream response is too large")
                body.extend(chunk)
            if time.monotonic() >= deadline:
                raise TimeoutError("Upstream request deadline exceeded")
            return Reply(
                response.status_code,
                dict(response.headers),
                bytes(body),
                str(response.url),
                response.reason_phrase,
            )


def fetch(
    method: str, url: str, *, deadline: float, timeout: float, max_bytes: int, **kwargs
) -> Reply:
    if not hasattr(_LOCAL, "transport"):
        _LOCAL.transport = _Transport()
    transport = _LOCAL.transport
    return transport.runner.run(
        _fetch(transport.client, method, url, deadline, timeout, max_bytes, kwargs)
    )
