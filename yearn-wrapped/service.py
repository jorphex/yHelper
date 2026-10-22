"""Local HTTP transport for the recap builder; payloads are returned unchanged."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.staticfiles import StaticFiles

from tools import recap

ROOT = Path(__file__).resolve().parent
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
LOGGER = logging.getLogger("uvicorn.error.recap")


@dataclass(frozen=True)
class Settings:
    ttl: float = 900
    empty_ttl: float = 60
    max_entries: int = 128
    max_bytes: int = 32 * 1024 * 1024
    concurrent_builds: int = 2
    max_pending: int = 8
    queue_timeout: float = 30
    build_timeout: float = 180

    @classmethod
    def from_env(cls) -> Settings:
        values = {}
        for name, field in cls.__dataclass_fields__.items():
            raw = os.getenv(f"YEARN_WRAPPED_{name.upper()}")
            if raw is not None:
                values[name] = type(field.default)(raw)
        settings = cls(**values)
        if any(
            not math.isfinite(getattr(settings, name)) or getattr(settings, name) <= 0
            for name in settings.__dataclass_fields__
        ):
            raise ValueError("Recap cache and concurrency settings must be positive")
        if settings.max_pending < settings.concurrent_builds:
            raise ValueError("max_pending must cover concurrent_builds")
        return settings


@dataclass(frozen=True)
class Result:
    body: bytes
    status: int
    ttl: float


def error(status: int, detail: str, ttl: float = 0) -> Result:
    return Result(json.dumps({"detail": detail}).encode(), status, ttl)


class BuildClient:
    """Let the synchronous builder share async I/O with a cancellable wall deadline."""

    def __init__(self, client, loop, timeout):
        self.client = client
        self.loop = loop
        self.recap_deadline = time.monotonic() + timeout

    async def request(self, method, url, kwargs):
        remaining = self.recap_deadline - time.monotonic()
        if remaining <= 0:
            raise httpx.TimeoutException("Recap build deadline exceeded")
        try:
            async with asyncio.timeout(remaining):
                return await self.client.request(method, url, **kwargs)
        except TimeoutError as exc:
            raise httpx.TimeoutException("Recap build deadline exceeded") from exc

    def send(self, method, url, **kwargs):
        recap.check_deadline(self)
        task = asyncio.run_coroutine_threadsafe(
            self.request(method, url, kwargs), self.loop
        )
        return task.result()

    def get(self, url, **kwargs):
        return self.send("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.send("POST", url, **kwargs)


class RecapService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cache: OrderedDict[tuple[str, int], tuple[float, Result]] = OrderedDict()
        self.cache_bytes = 0
        self.inflight: dict[tuple[str, int], asyncio.Task] = {}
        self.slots = asyncio.Semaphore(settings.concurrent_builds)
        self.last_disk_prune = 0.0
        self.http = httpx.AsyncClient(timeout=45, follow_redirects=True)

    def prune(self):
        now = time.monotonic()
        for key, (expires, result) in list(self.cache.items()):
            if expires <= now:
                self.cache_bytes -= len(result.body)
                del self.cache[key]

    def remember(self, key: tuple[str, int], result: Result):
        self.prune()
        if result.ttl <= 0 or len(result.body) > self.settings.max_bytes:
            return
        self.cache[key] = (time.monotonic() + result.ttl, result)
        self.cache_bytes += len(result.body)
        while (
            len(self.cache) > self.settings.max_entries
            or self.cache_bytes > self.settings.max_bytes
        ):
            _, (_, removed) = self.cache.popitem(last=False)
            self.cache_bytes -= len(removed.body)

    def build(self, address: str, year: int, client: BuildClient) -> Result:
        try:
            if time.monotonic() - self.last_disk_prune > 300:
                self.last_disk_prune = time.monotonic()
                recap.prune_cache()
            payload = recap.build_payload(address, year, client)
            recap.check_deadline(client)
            # Keep the builder's version, fields, integers, and completeness flags intact.
            body = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode()
            return Result(body, 200, self.settings.ttl)
        except recap.NoHistoryError:
            return error(
                404, "No Yearn history found for this address.", self.settings.empty_ttl
            )
        except (
            recap.UpstreamError,
            httpx.HTTPError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            IndexError,
            OverflowError,
        ) as exc:
            LOGGER.warning("recap upstream failure: %s", type(exc).__name__)
            return error(
                502, "Recap data is temporarily unavailable. Please try again."
            )

    async def generate(self, key: tuple[str, int]) -> Result:
        acquired = False
        started = time.monotonic()
        try:
            try:
                await asyncio.wait_for(
                    self.slots.acquire(), self.settings.queue_timeout
                )
                acquired = True
            except TimeoutError:
                return error(503, "Recap service is busy. Please try again shortly.")
            client = BuildClient(
                self.http, asyncio.get_running_loop(), self.settings.build_timeout
            )
            result = await asyncio.to_thread(self.build, *key, client)
            self.remember(key, result)
            LOGGER.info(
                "recap build wallet=%s…%s year=%s status=%s seconds=%.2f",
                key[0][:6],
                key[0][-4:],
                key[1],
                result.status,
                time.monotonic() - started,
            )
            return result
        finally:
            if acquired:
                self.slots.release()
            self.inflight.pop(key, None)

    async def get(self, key: tuple[str, int]) -> tuple[Result, str]:
        self.prune()
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key][1], "HIT"
        if key in self.inflight:
            return await asyncio.shield(self.inflight[key]), "COALESCED"
        if len(self.inflight) >= self.settings.max_pending:
            return error(
                503, "Recap service is busy. Please try again shortly."
            ), "BUSY"
        task = asyncio.create_task(self.generate(key))
        self.inflight[key] = task
        return await asyncio.shield(task), "MISS"

    async def close(self):
        # Do not abandon worker threads or duplicate in-flight work during shutdown.
        if self.inflight:
            await asyncio.gather(*list(self.inflight.values()), return_exceptions=True)
        await self.http.aclose()


def create_app(settings: Settings | None = None) -> FastAPI:
    service = RecapService(settings or Settings.from_env())

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await service.close()

    app = FastAPI(
        title="Yearn Wrapped",
        lifespan=lifespan,
        root_path=os.getenv("YEARN_WRAPPED_ROOT_PATH", ""),
    )
    app.state.recap_service = service

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/recap")
    async def get_recap(
        address: str | None = None,
        year: int = Query(
            2026,
            ge=2026,
            le=2026,
            description="Only the 2026 recap is currently supported",
        ),
    ):
        if address is None or ADDRESS.fullmatch(address) is None:
            raise HTTPException(
                status_code=400,
                detail="Use a 0x address followed by 40 hexadecimal characters.",
            )
        result, cache_state = await service.get((address.lower(), year))
        LOGGER.info("recap request cache=%s status=%s", cache_state, result.status)
        headers = {"Cache-Control": "no-store", "X-Recap-Cache": cache_state}
        if result.status == 503:
            headers["Retry-After"] = "5"
        return Response(
            result.body,
            status_code=result.status,
            media_type="application/json",
            headers=headers,
        )

    app.mount("/", StaticFiles(directory=ROOT / "site", html=True), name="site")
    return app


app = create_app()
