from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg

from app.common import _seconds_since, _to_float_or_none, _user_visible_filter_sql
from app.config import EXCLUDED_CHAIN_IDS, USER_VISIBLE_KIND, USER_VISIBLE_VERSION_PREFIX, WORKER_INTERVAL_SEC


def _scope_row(row: dict[str, Any] | None, *, criteria: dict[str, Any]) -> dict[str, Any]:
    source = row or {}
    return {
        "vaults": int(source.get("vaults") or 0),
        "tvl_known_vaults": int(source.get("tvl_known_vaults") or 0),
        "tvl_unknown_vaults": int(source.get("tvl_unknown_vaults") or 0),
        "gross_tvl_usd": _to_float_or_none(source.get("gross_tvl_usd")),
        "criteria": criteria,
    }


def _catalog_accounting_snapshot(cur: psycopg.Cursor) -> dict[str, Any]:
    cur.execute(
        """
        SELECT
            COUNT(*) AS vaults,
            COUNT(*) FILTER (WHERE tvl_usd IS NOT NULL) AS tvl_known_vaults,
            COUNT(*) FILTER (WHERE tvl_usd IS NULL) AS tvl_unknown_vaults,
            SUM(tvl_usd) AS gross_tvl_usd
        FROM vault_dim
        WHERE active = TRUE
          AND origin = 'yearn'
        """
    )
    all_products = _scope_row(
        cur.fetchone(),
        criteria={
            "active_snapshot_record": True,
            "origin": "yearn",
            "tvl_method": "gross_non_additive_product_sum",
        },
    )
    cur.execute(
        """
        SELECT
            COUNT(*) AS vaults,
            COUNT(*) FILTER (WHERE tvl_usd IS NOT NULL) AS tvl_known_vaults,
            COUNT(*) FILTER (WHERE tvl_usd IS NULL) AS tvl_unknown_vaults,
            SUM(tvl_usd) AS gross_tvl_usd
        FROM vault_dim
        WHERE active = TRUE
          AND origin = 'yearn'
          AND catalog_is_yearn = TRUE
          AND is_hidden = FALSE
          AND is_retired = FALSE
        """
    )
    active_yearn = _scope_row(
        cur.fetchone(),
        criteria={
            "active_snapshot_record": True,
            "origin": "yearn",
            "inclusion_is_yearn": True,
            "exclude_hidden": True,
            "exclude_retired": True,
            "tvl_method": "gross_non_additive_product_sum",
        },
    )
    cur.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE catalog_is_yearn = FALSE) AS excluded_by_inclusion,
            COUNT(*) FILTER (WHERE catalog_is_yearn IS NULL) AS unknown_inclusion,
            COUNT(*) FILTER (WHERE is_hidden = TRUE) AS hidden,
            COUNT(*) FILTER (WHERE is_retired = TRUE) AS retired
        FROM vault_dim
        WHERE active = TRUE
          AND origin = 'yearn'
        """
    )
    lifecycle = cur.fetchone() or {}
    return {
        "source": "kong_rest",
        "all_products": all_products,
        "active_yearn": active_yearn,
        "flag_counts": {
            "excluded_by_inclusion": int(lifecycle.get("excluded_by_inclusion") or 0),
            "unknown_inclusion": int(lifecycle.get("unknown_inclusion") or 0),
            "hidden": int(lifecycle.get("hidden") or 0),
            "retired": int(lifecycle.get("retired") or 0),
            "note": "Flags overlap; these counts are not a partition of all products.",
        },
        "warning": "Product TVLs overlap and are not protocol TVL.",
    }


def _analytics_accounting_snapshot(cur: psycopg.Cursor) -> dict[str, Any]:
    cur.execute(
        f"""
        SELECT
            COUNT(*) AS vaults,
            COUNT(*) FILTER (WHERE tvl_usd IS NOT NULL) AS tvl_known_vaults,
            COUNT(*) FILTER (WHERE tvl_usd IS NULL) AS tvl_unknown_vaults,
            SUM(tvl_usd) AS gross_tvl_usd
        FROM vault_dim d
        WHERE {_user_visible_filter_sql('d', include_retired=False)}
        """
    )
    return {
        "source": "kong_rest",
        "user_visible": _scope_row(
            cur.fetchone(),
            criteria={
                "existing_page_universe": True,
                "kind": USER_VISIBLE_KIND,
                "version_prefix": USER_VISIBLE_VERSION_PREFIX,
                "exclude_hidden": True,
                "exclude_retired": True,
                "excluded_chain_ids": list(EXCLUDED_CHAIN_IDS),
                "tvl_method": "gross_non_additive_product_sum",
            },
        ),
        "warning": "Analytics TVL is coverage context, not protocol TVL.",
    }


def _latest_protocol_tvl_snapshot(
    cur: psycopg.Cursor,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT
            id,
            observed_at,
            parent_tvl_usd,
            components_tvl_usd,
            reconciliation_residual_usd,
            parent_source_url,
            components_source_url
        FROM protocol_tvl_snapshots
        ORDER BY observed_at DESC, id DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        return None
    cur.execute(
        """
        SELECT slug, name, tvl_usd, chain_tvls
        FROM protocol_tvl_components
        WHERE snapshot_id = %s
        ORDER BY slug
        """,
        (row["id"],),
    )
    components = [
        {
            "slug": component["slug"],
            "name": component["name"],
            "tvl_usd": _to_float_or_none(component["tvl_usd"]),
            "chain_tvls": component["chain_tvls"],
        }
        for component in cur.fetchall()
    ]
    observed_at = row["observed_at"]
    age_seconds = _seconds_since(observed_at, now or datetime.now(UTC))
    stale_after_seconds = WORKER_INTERVAL_SEC * 2
    return {
        "tvl_usd": _to_float_or_none(row["parent_tvl_usd"]),
        "observed_at": observed_at.isoformat(),
        "age_seconds": age_seconds,
        "freshness_status": "stale" if age_seconds is None or age_seconds > stale_after_seconds else "fresh",
        "stale_after_seconds": stale_after_seconds,
        "components_tvl_usd": _to_float_or_none(row["components_tvl_usd"]),
        "reconciliation_residual_usd": _to_float_or_none(row["reconciliation_residual_usd"]),
        "components": components,
        "sources": {
            "parent": row["parent_source_url"],
            "components": row["components_source_url"],
        },
        "method": "yearn_reported_parent_tvl",
        "reconciliation_note": "Parent and component endpoints refresh independently; residual records cache skew.",
    }


def _build_protocol_context(
    *,
    protocol: dict[str, Any] | None,
    catalog: dict[str, Any],
    analytics: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, Any]:
    generated_at = now or datetime.now(UTC)
    active_catalog = catalog.get("active_yearn") or {}
    all_products = catalog.get("all_products") or {}
    current_yearn = {
        "vaults": active_catalog.get("vaults", 0),
        "tvl_usd": protocol.get("tvl_usd") if protocol else None,
        "criteria": {
            "deprecated_alias": True,
            "vault_count_scope": "catalog.active_yearn",
            "tvl_scope": "protocol",
        },
    }
    total_yearn = {
        "vaults": all_products.get("vaults", 0),
        "tvl_usd": None,
        "criteria": {
            "deprecated_alias": True,
            "scope": "catalog.all_products",
            "tvl_removed": "Overlapping product TVLs cannot represent a total Yearn TVL.",
        },
    }
    status = "unavailable"
    if protocol:
        status = "stale" if protocol.get("freshness_status") == "stale" else "ok"
    return {
        "schema_version": 2,
        "source": "yearn_reported_defillama",
        "status": status,
        "as_of_utc": generated_at.isoformat(),
        "protocol": protocol,
        "catalog": catalog,
        "analytics": analytics,
        "current_yearn": current_yearn,
        "total_yearn": total_yearn,
    }


def _protocol_context_snapshot(cur: psycopg.Cursor) -> dict[str, Any]:
    now = datetime.now(UTC)
    return _build_protocol_context(
        protocol=_latest_protocol_tvl_snapshot(cur, now=now),
        catalog=_catalog_accounting_snapshot(cur),
        analytics=_analytics_accounting_snapshot(cur),
        now=now,
    )
