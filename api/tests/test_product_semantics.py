from __future__ import annotations

import unittest

from app.analytics_service import _fetch_change_movers
from app.common import _market_filter_sql, _market_group_sql
from app.product_service import _harvest_recent


class RecordingCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, sql: str, params: dict[str, object]) -> None:
        self.calls.append((sql, params))

    def fetchall(self) -> list[dict]:
        return []


class ProductSemanticsTests(unittest.TestCase):
    def test_mover_lists_are_directionally_disjoint(self) -> None:
        cursor = RecordingCursor()

        result = _fetch_change_movers(cursor, base_cte="WITH normalized AS (SELECT 1) ", params={}, limit=5)  # type: ignore[arg-type]

        self.assertEqual(result, {"risers": [], "fallers": [], "largest_abs_delta": []})
        self.assertEqual(len(cursor.calls), 3)
        self.assertIn("safe_apy_prev_window) > 0", cursor.calls[0][0])
        self.assertIn("safe_apy_prev_window) < 0", cursor.calls[1][0])
        self.assertIn("safe_apy_prev_window) <> 0", cursor.calls[2][0])
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

        rows = _harvest_recent(  # type: ignore[arg-type]
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


if __name__ == "__main__":
    unittest.main()
