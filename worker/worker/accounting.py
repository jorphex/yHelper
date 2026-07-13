from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import psycopg
import requests
from psycopg.types.json import Json

from .config import (
    DEFI_LLAMA_PARENT_TVL_URL,
    DEFI_LLAMA_PROTOCOLS_URL,
    JOB_PROTOCOL_TVL,
    KONG_TIMEOUT_SEC,
)
from .db_state import _complete_run, _insert_run

YEARN_PARENT_PROTOCOL = "parent#yearn"
REQUIRED_YEARN_COMPONENTS = frozenset({"yearn-finance", "yearn-curating"})


@dataclass(frozen=True)
class ProtocolTvlComponent:
    slug: str
    name: str
    tvl_usd: Decimal
    chain_tvls: dict[str, int | float | str]


@dataclass(frozen=True)
class ProtocolTvlSnapshot:
    observed_at: datetime
    parent_tvl_usd: Decimal
    components: tuple[ProtocolTvlComponent, ...]

    @property
    def components_tvl_usd(self) -> Decimal:
        return sum((component.tvl_usd for component in self.components), Decimal(0))

    @property
    def reconciliation_residual_usd(self) -> Decimal:
        return self.parent_tvl_usd - self.components_tvl_usd


def _parse_nonnegative_decimal(value: Any, *, field: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"{field} must be a non-negative finite number")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field} must be a non-negative finite number") from exc
    if not parsed.is_finite() or parsed < 0:
        raise ValueError(f"{field} must be a non-negative finite number")
    return parsed


def _parse_parent_tvl(payload: Any) -> Decimal:
    return _parse_nonnegative_decimal(payload, field="Yearn parent TVL")


def _parse_yearn_components(payload: Any) -> tuple[ProtocolTvlComponent, ...]:
    if not isinstance(payload, list):
        raise ValueError("DefiLlama protocols response is not a list")

    components: dict[str, ProtocolTvlComponent] = {}
    for record in payload:
        if not isinstance(record, dict) or record.get("parentProtocol") != YEARN_PARENT_PROTOCOL:
            continue
        slug = str(record.get("slug") or "").strip()
        name = str(record.get("name") or "").strip()
        if not slug or not name:
            raise ValueError("Yearn component is missing slug or name")
        if slug in components:
            raise ValueError(f"Duplicate Yearn component slug: {slug}")
        raw_chain_tvls = record.get("chainTvls")
        if not isinstance(raw_chain_tvls, dict):
            raise ValueError(f"Yearn component {slug} has invalid chainTvls")
        chain_tvls: dict[str, int | float | str] = {}
        for chain, value in raw_chain_tvls.items():
            chain_name = str(chain).strip()
            if not chain_name:
                raise ValueError(f"Yearn component {slug} has an empty chain name")
            _parse_nonnegative_decimal(value, field=f"{slug}.chainTvls.{chain_name}")
            chain_tvls[chain_name] = value
        components[slug] = ProtocolTvlComponent(
            slug=slug,
            name=name,
            tvl_usd=_parse_nonnegative_decimal(record.get("tvl"), field=f"{slug}.tvl"),
            chain_tvls=chain_tvls,
        )

    missing = REQUIRED_YEARN_COMPONENTS.difference(components)
    if missing:
        raise ValueError(f"DefiLlama protocols response is missing Yearn components: {', '.join(sorted(missing))}")
    return tuple(components[slug] for slug in sorted(components))


def _fetch_json(url: str) -> Any:
    response = requests.get(
        url,
        timeout=KONG_TIMEOUT_SEC,
        headers={"Accept": "application/json", "User-Agent": "yHelper/0.1"},
    )
    response.raise_for_status()
    return response.json()


def _fetch_protocol_tvl_snapshot() -> ProtocolTvlSnapshot:
    parent_tvl = _parse_parent_tvl(_fetch_json(DEFI_LLAMA_PARENT_TVL_URL))
    components = _parse_yearn_components(_fetch_json(DEFI_LLAMA_PROTOCOLS_URL))
    return ProtocolTvlSnapshot(
        observed_at=datetime.now(UTC),
        parent_tvl_usd=parent_tvl,
        components=components,
    )


def _store_protocol_tvl_snapshot(conn: psycopg.Connection, snapshot: ProtocolTvlSnapshot) -> int:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO protocol_tvl_snapshots (
                    observed_at,
                    parent_tvl_usd,
                    components_tvl_usd,
                    reconciliation_residual_usd,
                    parent_source_url,
                    components_source_url
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    snapshot.observed_at,
                    snapshot.parent_tvl_usd,
                    snapshot.components_tvl_usd,
                    snapshot.reconciliation_residual_usd,
                    DEFI_LLAMA_PARENT_TVL_URL,
                    DEFI_LLAMA_PROTOCOLS_URL,
                ),
            )
            snapshot_id = int(cur.fetchone()[0])
            cur.executemany(
                """
                INSERT INTO protocol_tvl_components (
                    snapshot_id,
                    slug,
                    name,
                    tvl_usd,
                    chain_tvls
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                [
                    (
                        snapshot_id,
                        component.slug,
                        component.name,
                        component.tvl_usd,
                        Json(component.chain_tvls),
                    )
                    for component in snapshot.components
                ],
            )
    return snapshot_id


def _run_protocol_tvl_ingestion(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_PROTOCOL_TVL, started_at)
    try:
        snapshot = _fetch_protocol_tvl_snapshot()
        _store_protocol_tvl_snapshot(conn, snapshot)
        records = 1 + len(snapshot.components)
        summary = {
            "parent_tvl_usd": str(snapshot.parent_tvl_usd),
            "components_tvl_usd": str(snapshot.components_tvl_usd),
            "reconciliation_residual_usd": str(snapshot.reconciliation_residual_usd),
            "component_slugs": [component.slug for component in snapshot.components],
        }
        _complete_run(conn, run_id, "success", records, json.dumps(summary))
        logging.info(
            "Yearn protocol TVL snapshot success: parent=%s components=%s residual=%s",
            snapshot.parent_tvl_usd,
            snapshot.components_tvl_usd,
            snapshot.reconciliation_residual_usd,
        )
        return run_id, records
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)}))
        logging.exception("Yearn protocol TVL snapshot failed: %s", exc)
        return run_id, 0
