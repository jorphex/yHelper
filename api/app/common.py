from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal

from app.config import (
    CHAIN_LABELS,
    EXCLUDED_CHAIN_IDS,
    UNIVERSE_CORE_MAX_VAULTS,
    UNIVERSE_CORE_MIN_POINTS,
    UNIVERSE_CORE_MIN_TVL_USD,
    UNIVERSE_EXTENDED_MAX_VAULTS,
    UNIVERSE_EXTENDED_MIN_POINTS,
    UNIVERSE_EXTENDED_MIN_TVL_USD,
    UNIVERSE_RAW_MAX_VAULTS,
    UNIVERSE_RAW_MIN_POINTS,
    UNIVERSE_RAW_MIN_TVL_USD,
    USER_VISIBLE_KIND,
    USER_VISIBLE_VERSION_PREFIX,
)


MARKET_VALUES = ("all", "stablecoins", "eth", "bitcoin", "other")
STABLE_MARKET_SYMBOLS = (
    "usdc",
    "vbusdc",
    "usdt",
    "vbusdt",
    "dai",
    "yvajnadai",
    "sdai",
    "usds",
    "bold",
    "crvusd",
    "ausd",
    "usde",
    "susde",
    "mkusd",
    "usdaf",
    "usnd",
    "gho",
    "lusd",
    "dola",
    "frxusd",
)
ETH_MARKET_SYMBOLS = (
    "eth",
    "weth",
    "vbeth",
    "steth",
    "wsteth",
    "reth",
    "cbeth",
    "frxeth",
    "sfrxeth",
    "ezeth",
    "rseth",
    "weeth",
    "weeths",
    "rsweth",
    "pufeth",
    "unieth",
    "sweth",
    "ageth",
    "yvajnaweth",
)
BTC_MARKET_SYMBOLS = (
    "btc",
    "wbtc",
    "vbbtc",
    "tbtc",
    "cbbtc",
    "lbtc",
    "ebtc",
    "vbwbtc",
)


def _sql_text_list(values: tuple[str, ...]) -> str:
    return ", ".join("'" + value.replace("'", "''") + "'" for value in values)


def _market_group_sql(alias: str) -> str:
    """Return the explicit user-facing asset cohort for a Kong vault row.

    Kong's Stablecoin category is authoritative for stable assets. ETH and BTC
    cohorts are intentionally small, reviewed symbol registries; everything
    else remains Other rather than being guessed from substrings.
    """
    stable_symbols = _sql_text_list(STABLE_MARKET_SYMBOLS)
    eth_symbols = _sql_text_list(ETH_MARKET_SYMBOLS)
    btc_symbols = _sql_text_list(BTC_MARKET_SYMBOLS)
    return f"""
    CASE
        WHEN LOWER(COALESCE({alias}.category, '')) = 'stablecoin'
          OR LOWER(COALESCE({alias}.token_symbol, '')) IN ({stable_symbols}) THEN 'stablecoins'
        WHEN LOWER(COALESCE({alias}.token_symbol, '')) IN ({eth_symbols}) THEN 'eth'
        WHEN LOWER(COALESCE({alias}.token_symbol, '')) IN ({btc_symbols}) THEN 'bitcoin'
        ELSE 'other'
    END
    """


def _market_filter_sql(alias: str) -> str:
    market_sql = _market_group_sql(alias)
    return f"(%(market)s = 'all' OR ({market_sql}) = %(market)s)"


def _seconds_since(ts: datetime | None, now: datetime) -> int | None:
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return max(0, int((now - ts).total_seconds()))


def _chain_label(chain_id: int | None) -> str | None:
    if chain_id is None:
        return None
    return CHAIN_LABELS.get(chain_id, str(chain_id))


def _resolve_universe_gate(
    universe: Literal["core", "extended", "raw"],
    *,
    min_tvl_usd: float | None,
    min_points: int | None,
    max_vaults: int | None,
) -> dict[str, float | int | str | None]:
    defaults = {
        "core": {
            "min_tvl_usd": UNIVERSE_CORE_MIN_TVL_USD,
            "min_points": UNIVERSE_CORE_MIN_POINTS,
            "max_vaults": UNIVERSE_CORE_MAX_VAULTS,
        },
        "extended": {
            "min_tvl_usd": UNIVERSE_EXTENDED_MIN_TVL_USD,
            "min_points": UNIVERSE_EXTENDED_MIN_POINTS,
            "max_vaults": UNIVERSE_EXTENDED_MAX_VAULTS,
        },
        "raw": {
            "min_tvl_usd": UNIVERSE_RAW_MIN_TVL_USD,
            "min_points": UNIVERSE_RAW_MIN_POINTS,
            "max_vaults": UNIVERSE_RAW_MAX_VAULTS,
        },
    }
    fallback = defaults[universe]
    resolved_min_tvl_usd = float(fallback["min_tvl_usd"] if min_tvl_usd is None else min_tvl_usd)
    resolved_min_points = int(fallback["min_points"] if min_points is None else min_points)
    resolved_max_vaults = int(fallback["max_vaults"] if max_vaults is None else max_vaults)
    if resolved_max_vaults <= 0:
        resolved_max_vaults = None
    return {
        "universe": universe,
        "min_tvl_usd": resolved_min_tvl_usd,
        "min_points": resolved_min_points,
        "max_vaults": resolved_max_vaults,
        "defaults": fallback,
    }


def _rank_gate_filter_sql(alias: str, *, max_vaults: int | None) -> str:
    if max_vaults is None or max_vaults <= 0:
        return ""
    return """
    ({alias}.chain_id, {alias}.vault_address) IN (
        SELECT r.chain_id, r.vault_address
        FROM vault_dim r
        WHERE {scope_sql}
        ORDER BY r.tvl_usd DESC NULLS LAST, r.chain_id, r.vault_address
        LIMIT %(max_vaults)s
    )
    """.format(alias=alias, scope_sql=_user_visible_filter_sql("r", include_retired=False))


def _user_visible_filter_sql(alias: str, *, include_retired: bool = False) -> str:
    excluded_ids_sql = ", ".join(str(chain_id) for chain_id in EXCLUDED_CHAIN_IDS)
    clauses = [
        f"{alias}.active = TRUE",
        f"{alias}.catalog_is_yearn = TRUE",
        f"COALESCE({alias}.kind, '') = '{USER_VISIBLE_KIND}'",
        f"COALESCE({alias}.version, '') LIKE '{USER_VISIBLE_VERSION_PREFIX}%%'",
        f"COALESCE({alias}.chain_id, -1) NOT IN ({excluded_ids_sql})",
        f"{alias}.is_hidden = FALSE",
    ]
    if not include_retired:
        clauses.append(f"{alias}.is_retired = FALSE")
    return " AND ".join(clauses)


def _to_float_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: object) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _kong_source_freshness(cur) -> dict[str, object]:
    cur.execute("""
        SELECT error_summary, ended_at FROM ingestion_runs
        WHERE job_name = 'kong_vault_snapshot' AND status = 'success'
        ORDER BY ended_at DESC LIMIT 1
    """)
    row = cur.fetchone() or {}
    try:
        metadata = json.loads(row.get("error_summary") or "{}").get("source_freshness") or {}
    except (ValueError, AttributeError, TypeError):
        metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    now = datetime.now(UTC)

    def timestamp(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed if parsed.tzinfo and parsed <= now else None
        except (ValueError, TypeError):
            return None

    refreshed = timestamp(metadata.get("refreshed_at"))
    fetched = timestamp(metadata.get("fetched_at"))
    age = int((now - refreshed).total_seconds()) if refreshed else None
    fetch_age = int((now - fetched).total_seconds()) if fetched else None
    state = "unknown" if age is None or fetch_age is None else "delayed" if max(age, fetch_age) > 7200 else "ready"
    return {
        "state": state,
        "refreshed_at": refreshed.isoformat() if refreshed else None,
        "fetched_at": fetched.isoformat() if fetched else None,
        "age_seconds": age,
        "stale_after_seconds": 7200,
    }
