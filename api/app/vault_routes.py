from __future__ import annotations

import asyncio
import json
import logging
import math
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException, Path, Response
from psycopg.rows import dict_row

from app.common import _kong_source_freshness
from app.config import APY_MAX, APY_MIN, CHAIN_LABELS, KONG_GQL_URL, LOCKED_YVUSD_ADDRESS, YVUSD_ADDRESS
from app.db import connect
from app.models import VaultHistoryResponse
from app.transport import fetch

router = APIRouter()
LOGGER = logging.getLogger(__name__)
DAY = 86400
QUERY = """
query VaultHistory($chain: Int, $address: String, $start: BigInt, $parent: String, $includeParent: Boolean!) {
  pps: timeseries(label: "pps", component: "humanized", chainId: $chain,
    address: $address, timestamp: $start, period: "1 day", limit: 100) { time value }
  tvl: timeseries(label: "tvl-c", component: "tvl", chainId: $chain,
    address: $address, timestamp: $start, period: "1 day", limit: 100) { time value }
  parentPps: timeseries(label: "pps", component: "humanized", chainId: $chain,
    address: $parent, timestamp: $start, period: "1 day", limit: 100)
    @include(if: $includeParent) { time value }
}
"""
EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="vault-history")
LOCK = threading.Lock()
CACHE: OrderedDict[tuple[int, str], tuple[float, dict]] = OrderedDict()
JOBS: dict[tuple[int, str], Future] = {}


def _series(raw: object, start: int, end: int, *, positive: bool) -> dict[int, float]:
    if raw is None:
        return {}
    if not isinstance(raw, list) or len(raw) > 105:
        raise ValueError("Invalid vault history series")
    values = {}
    for point in raw:
        if not isinstance(point, dict):
            raise TypeError("Invalid vault history point")
        try:
            ts, value = int(point["time"]), float(point["value"])
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        if (
            start <= ts <= end
            and ts % DAY == 0
            and math.isfinite(value)
            and (value > 0 if positive else value >= 0)
        ):
            values[ts] = value
    return values


def _build(chain_id: int, address: str, previous: dict | None = None) -> dict:
    deadline = time.monotonic() + 18
    today = int(datetime.now(UTC).timestamp()) // DAY * DAY
    start = today - 98 * DAY
    locked = chain_id == 1 and address == LOCKED_YVUSD_ADDRESS
    parent_stored, parent_decimals = [], None
    with connect(row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT chain_id, vault_address, symbol, name, token_symbol, token_decimals, est_apy
               FROM vault_dim WHERE chain_id = %s AND vault_address = %s
                 AND active AND origin = 'yearn'""",
            (chain_id, address),
        )
        vault = cur.fetchone()
        if vault is None:
            raise HTTPException(status_code=404, detail="Vault not found.")
        freshness = _kong_source_freshness(cur)
        cur.execute(
            """SELECT ts, pps_raw FROM pps_timeseries
               WHERE chain_id = %s AND vault_address = %s AND ts >= %s
               ORDER BY ts DESC LIMIT 100""",
            (chain_id, address, start),
        )
        stored = cur.fetchall()
        pps_asset_symbol = vault["token_symbol"]
        if locked:
            cur.execute("SELECT token_symbol, token_decimals FROM vault_dim WHERE chain_id=1 AND vault_address=%s", (YVUSD_ADDRESS,))
            parent = cur.fetchone()
            pps_asset_symbol = parent["token_symbol"] if parent else None
            parent_decimals = parent["token_decimals"] if parent else None
            cur.execute("SELECT ts, pps_raw FROM pps_timeseries WHERE chain_id=1 AND vault_address=%s AND ts >= %s ORDER BY ts DESC LIMIT 100", (YVUSD_ADDRESS, start))
            parent_stored = cur.fetchall()
    decimals = vault.pop("token_decimals")
    pps, tvl = {}, {}
    parent_pps = {}
    pps_source = "unavailable"
    tvl_source = "unavailable"
    try:
        reply = fetch(
            "POST",
            KONG_GQL_URL,
            deadline=deadline,
            timeout=12,
            max_bytes=1024 * 1024,
            json={
                "query": QUERY,
                "variables": {"chain": chain_id, "address": address, "start": start, "parent": YVUSD_ADDRESS if locked else None, "includeParent": locked},
            },
        )
        if reply.status != 200:
            raise ValueError("Vault history upstream unavailable")
        payload = json.loads(reply.body)
        if not isinstance(payload, dict):
            raise TypeError("Invalid vault history response")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise TypeError("Vault history upstream returned no data")
        if locked:
            try:
                parent_pps = _series(data.get("parentPps"), start, today, positive=True)
            except (ValueError, TypeError):
                LOGGER.warning("Invalid parent vault history series")
        for label, positive in (("pps", True), ("tvl", False)):
            try:
                values = _series(data.get(label), start, today, positive=positive)
            except (ValueError, TypeError):
                LOGGER.warning("Invalid vault history %s series", label)
                continue
            if label == "pps":
                pps = values
                if pps:
                    pps_source = "kong"
            else:
                tvl = values
                if tvl:
                    tvl_source = "kong"
    except (httpx.HTTPError, TimeoutError, OSError, ValueError, TypeError) as exc:
        LOGGER.warning("Vault history upstream unavailable (%s)", type(exc).__name__)
    if not pps and isinstance(decimals, int) and 0 <= decimals <= 36:
        pps = _series(
            [
                {"time": row["ts"], "value": float(row["pps_raw"]) / 10**decimals}
                for row in stored
            ],
            start,
            today,
            positive=True,
        )
        if pps:
            pps_source = "stored"
    if locked:
        parent_source = "kong" if parent_pps else "stored"
        if not parent_pps and isinstance(parent_decimals, int) and 0 <= parent_decimals <= 36:
            parent_pps = _series(
                [{"time": row["ts"], "value": float(row["pps_raw"]) / 10**parent_decimals} for row in parent_stored],
                start, today, positive=True,
            )
        pps = {ts: value * parent_pps[ts] for ts, value in pps.items() if ts in parent_pps and pps_asset_symbol}
        if not pps:
            pps_source = "unavailable"
        elif parent_source != "kong" or pps_source != "kong":
            pps_source = "stored"
    prior = {
        point["timestamp"]: point
        for point in (previous or {}).get("points", [])
        if today - 90 * DAY <= point["timestamp"] <= today
    }
    if pps_source != "kong":
        cached_pps = {ts: point["pps"] for ts, point in prior.items() if point["pps"] is not None}
        if cached_pps.keys() - pps.keys():
            pps = {**cached_pps, **pps}
            pps_source = "cached"
    if not tvl:
        tvl = {ts: point["tvl_usd"] for ts, point in prior.items() if point["tvl_usd"] is not None}
        if tvl:
            tvl_source = "cached"
    points = []
    for ts in sorted(set(pps) | set(tvl)):
        if ts < today - 90 * DAY:
            continue
        value, base = pps.get(ts), pps.get(ts - 7 * DAY)
        apy = None
        if value is not None and base is not None:
            exponent = (math.log(value) - math.log(base)) * (365 / 7)
            if math.log1p(APY_MIN) <= exponent <= math.log1p(APY_MAX):
                apy = math.expm1(exponent)
        elif value is not None and pps_source != "kong" and ts in prior and prior[ts]["pps"] == value:
            # Preserve a known full window when its warmup is outside the cached response.
            apy = prior[ts]["apy_7d"]
            if apy is not None:
                pps_source = "cached"
        points.append(
            {"timestamp": ts, "pps": value, "apy_7d": apy, "tvl_usd": tvl.get(ts)}
        )
    now = datetime.now(UTC)
    latest = [max(series) for series in (pps, tvl) if series]
    delayed = bool(latest and now.timestamp() - min(latest) > 2 * DAY)
    state = "ready"
    if not pps and not tvl:
        state = "unavailable"
    elif pps_source != "kong" or tvl_source != "kong":
        state = "partial"
    elif delayed:
        state = "delayed"
    return {
        "vault": vault,
        "pps_asset_symbol": pps_asset_symbol,
        "points": points,
        "source_freshness": freshness,
        "history_state": state,
        "history_delayed": delayed,
        "pps_source": pps_source,
        "tvl_source": tvl_source,
        "fetched_at": now.isoformat(),
    }


def _finish(key: tuple[int, str], future: Future) -> None:
    with LOCK:
        JOBS.pop(key, None)
        if future.cancelled() or future.exception() is not None:
            return
        result = future.result()
        ttl = 300 if result["history_state"] == "ready" else 15
        CACHE[key] = (time.monotonic() + ttl, result)
        CACHE.move_to_end(key)
        while len(CACHE) > 64:
            CACHE.popitem(last=False)


def _response(result: dict, remaining: float = 15) -> dict:
    return {
        **result,
        "retry_after_seconds": 0 if result["history_state"] == "ready" else max(0, math.ceil(remaining)),
    }


@router.get(
    "/api/vaults/{chain_id}/{vault_address}/history",
    response_model=VaultHistoryResponse,
)
async def vault_history(
    response: Response,
    chain_id: int = Path(ge=1, le=2**31 - 1),
    vault_address: str = Path(pattern=r"^0x[0-9a-fA-F]{40}$"),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    if chain_id not in CHAIN_LABELS:
        raise HTTPException(status_code=404, detail="Chain not supported.")
    key = (chain_id, vault_address.lower())
    created = False
    with LOCK:
        cached = CACHE.get(key)
        if cached and cached[0] > time.monotonic():
            CACHE.move_to_end(key)
            return _response(cached[1], cached[0] - time.monotonic())
        future = JOBS.get(key)
        if future is None:
            if len(JOBS) >= 2:
                raise HTTPException(
                    status_code=503,
                    detail="Vault history is busy. Try again shortly.",
                    headers={"Retry-After": "2"},
                )
            future = EXECUTOR.submit(_build, *key, cached[1] if cached else None)
            JOBS[key] = future
            created = True
    if created:
        future.add_done_callback(lambda done: _finish(key, done))
    try:
        result = await asyncio.wait_for(
            asyncio.shield(asyncio.wrap_future(future)), timeout=22
        )
        return _response(result)
    except TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="Vault history is taking too long. Try again shortly.",
        ) from exc
