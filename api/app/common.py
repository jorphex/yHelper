from __future__ import annotations

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


def _raw_hidden_sql(alias: str) -> str:
    return (
        f"COALESCE(({alias}.raw->'meta'->>'isHidden')::boolean, "
        f"({alias}.raw->>'isHidden')::boolean, "
        f"({alias}.raw->'info'->>'isHidden')::boolean, FALSE)"
    )


def _raw_retired_sql(alias: str) -> str:
    return (
        f"COALESCE(({alias}.raw->'meta'->>'isRetired')::boolean, "
        f"({alias}.raw->>'isRetired')::boolean, "
        f"({alias}.raw->'info'->>'isRetired')::boolean, FALSE)"
    )


def _raw_highlighted_sql(alias: str) -> str:
    return (
        f"COALESCE(({alias}.raw->'meta'->>'isHighlighted')::boolean, "
        f"({alias}.raw->>'isHighlighted')::boolean, "
        f"({alias}.raw->'info'->>'isHighlighted')::boolean, FALSE)"
    )


def _raw_migration_available_sql(alias: str) -> str:
    return (
        f"COALESCE(({alias}.raw->'meta'->'migration'->>'available')::boolean, "
        f"({alias}.raw->'migration'->>'available')::boolean, FALSE)"
    )


def _raw_risk_level_sql(alias: str) -> str:
    return (
        f"COALESCE(NULLIF({alias}.raw->'risk'->>'riskLevel', ''), "
        f"NULLIF({alias}.raw->>'riskLevel', ''), "
        f"NULLIF({alias}.raw->'info'->>'riskLevel', ''), 'unknown')"
    )


def _raw_strategies_count_sql(alias: str) -> str:
    return f"""
    COALESCE(
        NULLIF({alias}.raw->>'strategiesCount', '')::INT,
        CASE WHEN jsonb_typeof({alias}.raw->'strategies') = 'array' THEN jsonb_array_length({alias}.raw->'strategies') END,
        CASE WHEN jsonb_typeof({alias}.raw->'debts') = 'array' THEN jsonb_array_length({alias}.raw->'debts') END,
        0
    )
    """


def _raw_current_debt_usd_sum_sql(alias: str) -> str:
    return f"""
    SELECT
        {alias}.chain_id,
        LOWER({alias}.vault_address) AS vault_address,
        SUM(
            COALESCE(
                NULLIF(d->>'currentDebtUsd', '')::numeric,
                NULLIF(d->>'totalDebtUsd', '')::numeric,
                0
            )
        ) AS debt_usd
    FROM vault_dim {alias}
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE({alias}.raw->'debts', '[]'::jsonb)) d
    """


def _user_visible_filter_sql(alias: str, *, include_retired: bool = False) -> str:
    excluded_ids_sql = ", ".join(str(chain_id) for chain_id in EXCLUDED_CHAIN_IDS)
    clauses = [
        f"{alias}.active = TRUE",
        f"COALESCE({alias}.kind, '') = '{USER_VISIBLE_KIND}'",
        f"COALESCE({alias}.version, '') LIKE '{USER_VISIBLE_VERSION_PREFIX}%%'",
        f"COALESCE({alias}.chain_id, -1) NOT IN ({excluded_ids_sql})",
        f"{_raw_hidden_sql(alias)} = FALSE",
    ]
    if not include_retired:
        clauses.append(f"{_raw_retired_sql(alias)} = FALSE")
    return " AND ".join(clauses)


def _to_float_or_none(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_compact_usd(value: float | None) -> str | None:
    if value is None:
        return None
    amount = abs(value)
    if amount >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    if amount >= 1_000:
        return f"${value / 1_000:.0f}k"
    return f"${value:.0f}"


def _yearn_vault_url(chain_id: int | None, vault_address: str | None) -> str | None:
    if chain_id is None or not vault_address:
        return None
    return f"https://yearn.fi/vaults/{chain_id}/{vault_address}"


def _safe_int(value: object) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _delta_or_none(left: object, right: object) -> float | None:
    left_value = _to_float_or_none(left)
    right_value = _to_float_or_none(right)
    if left_value is None or right_value is None:
        return None
    return left_value - right_value


def _apply_aliases(row: dict[str, object], alias_map: dict[str, str]) -> dict[str, object]:
    for alias_key, source_key in alias_map.items():
        if alias_key not in row and source_key in row:
            row[alias_key] = row.get(source_key)
    return row


def _apply_aliases_many(rows: list[dict[str, object]], alias_map: dict[str, str]) -> list[dict[str, object]]:
    for row in rows:
        _apply_aliases(row, alias_map)
    return rows


def _alias_realized_apy_fields(row: dict[str, object]) -> dict[str, object]:
    return _apply_aliases(
        row,
        {
            "realized_apy_30d": "safe_apy_30d",
            "avg_realized_apy_30d": "avg_safe_apy_30d",
            "median_realized_apy_30d": "median_safe_apy_30d",
            "weighted_realized_apy_30d": "weighted_safe_apy_30d",
            "tvl_weighted_realized_apy_30d": "tvl_weighted_safe_apy_30d",
            "best_realized_apy_30d": "best_safe_apy_30d",
            "worst_realized_apy_30d": "worst_safe_apy_30d",
            "median_best_realized_apy_30d": "median_best_safe_apy_30d",
            "realized_spread_30d": "spread_safe_apy_30d",
            "median_realized_spread_30d": "median_spread_safe_apy_30d",
            "realized_apy_window": "safe_apy_window",
            "realized_apy_prev_window": "safe_apy_prev_window",
            "avg_realized_apy_window": "avg_safe_apy_window",
            "avg_realized_apy_prev_window": "avg_safe_apy_prev_window",
        },
    )


def _alias_realized_apy_many(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    return _apply_aliases_many(
        rows,
        {
            "realized_apy_30d": "safe_apy_30d",
            "realized_apy_window": "safe_apy_window",
            "realized_apy_prev_window": "safe_apy_prev_window",
        },
    )


def _alias_realized_coverage_fields(row: dict[str, object]) -> dict[str, object]:
    return _apply_aliases(
        row,
        {
            "with_realized_apy": "with_metrics",
            "with_realized_apy_tvl_usd": "with_metrics_tvl_usd",
        },
    )
