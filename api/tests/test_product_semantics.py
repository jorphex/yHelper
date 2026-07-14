from __future__ import annotations

import unittest

from app.analytics_service import _fetch_change_movers
from app.common import _market_filter_sql, _market_group_sql, _user_visible_filter_sql
from app.meta_service import _social_preview_highest_vault
from app.models import ChangesResponse
from app.product_service import _recent_reports


class RecordingCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, sql: str, params: dict[str, object] | None = None) -> None:
        self.calls.append((sql, params or {}))

    def fetchall(self) -> list[dict]:
        return []

    def fetchone(self) -> dict:
        return {}


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

    def test_social_preview_uses_the_stored_normalized_snapshot(self) -> None:
        cursor = RecordingCursor()

        self.assertEqual(_social_preview_highest_vault(cursor), {})  # type: ignore[arg-type]

        sql, params = cursor.calls[0]
        self.assertEqual(params, {})
        self.assertIn("FROM vault_dim d", sql)
        self.assertIn("d.catalog_is_yearn = TRUE", sql)
        self.assertIn("'kong_rest_snapshot' AS source", sql)

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


if __name__ == "__main__":
    unittest.main()
