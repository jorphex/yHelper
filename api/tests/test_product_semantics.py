from __future__ import annotations

import unittest

from app.analytics_service import _fetch_change_movers
from app.common import _market_filter_sql, _market_group_sql, _user_visible_filter_sql
from app.models import ChangesResponse
from app.meta_service import _freshness_snapshot
from app.product_service import _recent_reports
from app.styfi_service import _styfi_snapshot_series


class RecordingCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, sql: str, params: dict[str, object] | None = None) -> None:
        self.calls.append((sql, params or {}))

    def fetchall(self) -> list[dict]:
        return []

    def fetchone(self) -> dict:
        return {}

    def __enter__(self) -> RecordingCursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None


class RecordingConnection:
    def __init__(self) -> None:
        self.cursor_instance = RecordingCursor()

    def cursor(self, **_: object) -> RecordingCursor:
        return self.cursor_instance


class ProductSemanticsTests(unittest.TestCase):
    def test_mover_lists_are_directionally_disjoint(self) -> None:
        cursor = RecordingCursor()

        result = _fetch_change_movers(cursor, base_cte="WITH normalized AS (SELECT 1) ", params={}, limit=5)  # type: ignore[arg-type]

        self.assertEqual(result, {"risers": [], "fallers": []})
        self.assertEqual(len(cursor.calls), 2)
        self.assertIn("realized_apy_prev_window) > 0", cursor.calls[0][0])
        self.assertIn("realized_apy_prev_window) < 0", cursor.calls[1][0])
        self.assertIn("delta_apy DESC", cursor.calls[0][0])
        self.assertIn("delta_apy ASC", cursor.calls[1][0])

    def test_market_cohorts_use_reviewed_exact_values(self) -> None:
        grouping = _market_group_sql("d")
        market_filter = _market_filter_sql("d")

        self.assertIn("category, '')) = 'stablecoin'", grouping)
        self.assertIn("token_symbol, '')) IN ('usdc', 'vbusdc'", grouping)
        self.assertIn("token_symbol, '')) IN ('eth', 'weth'", grouping)
        self.assertIn("token_symbol, '')) IN ('btc', 'wbtc'", grouping)
        self.assertNotIn("LIKE", grouping.upper())
        self.assertIn("%(market)s = 'all'", market_filter)
        self.assertIn("= %(market)s", market_filter)

    def test_report_scope_filters_only_economic_results(self) -> None:
        cursor = RecordingCursor()

        rows = _recent_reports(  # type: ignore[arg-type]
            cursor,
            days=90,
            chain_id=None,
            vault_address=None,
            limit=50,
            meaningful_only=True,
        )

        self.assertEqual(rows, [])
        self.assertEqual(len(cursor.calls), 1)
        sql, params = cursor.calls[0]
        self.assertNotIn("meaningful_only", params)
        self.assertIn("COALESCE(h.gain, 0) <> 0", sql)
        self.assertIn("COALESCE(h.loss, 0) <> 0", sql)
        self.assertIn("COALESCE(h.fee_assets, 0) <> 0", sql)
        self.assertIn("COALESCE(h.refund_assets, 0) <> 0", sql)
        self.assertIn("h.log_index", sql)

    def test_visible_scope_uses_normalized_kong_inclusion_and_lifecycle(self) -> None:
        sql = _user_visible_filter_sql("d", include_retired=False)

        self.assertIn("d.catalog_is_yearn = TRUE", sql)
        self.assertIn("d.is_hidden = FALSE", sql)
        self.assertIn("d.is_retired = FALSE", sql)

    def test_changes_contract_rejects_unknown_fields(self) -> None:
        payload = {
            "window": {"name": "7d", "stale_after_seconds": 1_209_600},
            "realized_apy_policy": {"kind": "bounded", "min": -0.95, "max": 10.0},
            "summary": {
                "vaults_eligible": 1,
                "vaults_with_change": 1,
                "tracked_tvl_usd": 1.0,
                "riser_vaults": 1,
                "faller_vaults": 0,
                "flat_vaults": 0,
                "riser_tvl_usd": 1.0,
                "faller_tvl_usd": None,
                "tvl_weighted_delta": 0.01,
            },
            "freshness": {
                "newest_comparison_age_seconds": 60,
                "current_comparisons": 1,
                "tracked_comparisons": 1,
            },
            "movers": {"risers": [], "fallers": []},
        }
        self.assertEqual(ChangesResponse.model_validate(payload).window.name, "7d")
        with self.assertRaises(ValueError):
            ChangesResponse.model_validate({**payload, "undocumented": True})

    def test_styfi_history_selects_one_latest_snapshot_per_utc_day(self) -> None:
        cursor = RecordingCursor()

        rows = _styfi_snapshot_series(cursor, days=30)  # type: ignore[arg-type]

        self.assertEqual(rows, [])
        sql, params = cursor.calls[0]
        self.assertIn("DISTINCT ON ((observed_at AT TIME ZONE 'UTC')::date)", sql)
        self.assertIn("observed_at DESC", sql)
        self.assertEqual(params["days"], 30)

    def test_freshness_metrics_use_the_visible_vault_scope(self) -> None:
        connection = RecordingConnection()

        _freshness_snapshot(  # type: ignore[arg-type]
            connection,
            stale_threshold_seconds=86_400,
            min_tvl_usd=100_000,
        )

        metrics_sql, metrics_params = next(
            call for call in connection.cursor_instance.calls if "metrics_rows" in call[0]
        )
        self.assertIn("JOIN vault_dim d", metrics_sql)
        self.assertIn("d.catalog_is_yearn = TRUE", metrics_sql)
        self.assertIn("d.is_hidden = FALSE", metrics_sql)
        self.assertIn("d.is_retired = FALSE", metrics_sql)
        self.assertIn("COALESCE(d.tvl_usd, 0.0) >= %(min_tvl_usd)s", metrics_sql)
        self.assertEqual(metrics_params["min_tvl_usd"], 100_000)


if __name__ == "__main__":
    unittest.main()
