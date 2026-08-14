from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.flex_service import (
    FLEX_STALE_AFTER_SECONDS,
    _coverage_start_bucket,
    _floor_bucket,
    _redemption_priority_response,
    _summary,
)
from app.models import FlexRedemptionPriorityResponse


def _redemption_row(now: datetime) -> dict[str, object]:
    return {
        "market_address": "0x" + "11" * 20,
        "borrow_token_address": "0x" + "22" * 20,
        "borrow_token_symbol": "USDC",
        "borrow_token_decimals": 6,
        "one_pct_raw": Decimal(10_000),
        "source_block_number": 25_754_070,
        "source_block_time": now - timedelta(minutes=5),
        "total_debt_raw": Decimal(1_968_818_629),
        "points": [
            {"rate": "20000", "redeemable_before": "0"},
            {"rate": "55000", "redeemable_before": "1964702059"},
        ],
        "source_url": "https://api.flexmeow.com/v1/ui/borrow?chain_id=1&trove_manager=0x11",
        "fetched_at": now - timedelta(minutes=2),
        "attempted_at": now - timedelta(minutes=2),
        "last_error": None,
    }


class FlexServiceSemanticsTests(unittest.TestCase):
    def test_hourly_coverage_starts_after_partial_deployment_hour(self) -> None:
        deployed = datetime(2026, 8, 12, 17, 4, 47, tzinfo=UTC)
        self.assertEqual(
            _coverage_start_bucket(deployed, "hour"),
            datetime(2026, 8, 12, 18, 0, 0, tzinfo=UTC),
        )

    def test_daily_coverage_includes_deployment_day(self) -> None:
        deployed = datetime(2026, 8, 12, 17, 4, 47, tzinfo=UTC)
        self.assertEqual(
            _coverage_start_bucket(deployed, "day"),
            datetime(2026, 8, 12, 0, 0, 0, tzinfo=UTC),
        )
        self.assertEqual(
            _floor_bucket(deployed, "day"),
            datetime(2026, 8, 12, 0, 0, 0, tzinfo=UTC),
        )

    def test_summary_weights_rates_by_their_economic_denominators(self) -> None:
        rows = [
            {
                "market_status": "active",
                "collateral_usd_e18": Decimal(300) * 10**18,
                "debt_usd_e18": Decimal(100) * 10**18,
                "deposits_usd_e18": Decimal(200) * 10**18,
                "idle_liquidity_usd_e18": Decimal(100) * 10**18,
                "lender_apr_wad": Decimal("0.02") * 10**18,
                "avg_borrow_rate_raw": 20_000,
                "one_pct_raw": 10_000,
            },
            {
                "market_status": "deprecated",
                "collateral_usd_e18": Decimal(200) * 10**18,
                "debt_usd_e18": Decimal(300) * 10**18,
                "deposits_usd_e18": Decimal(600) * 10**18,
                "idle_liquidity_usd_e18": Decimal(300) * 10**18,
                "lender_apr_wad": Decimal("0.04") * 10**18,
                "avg_borrow_rate_raw": 40_000,
                "one_pct_raw": 10_000,
            },
        ]
        summary = _summary(rows)
        self.assertAlmostEqual(summary["utilization"], 0.5)
        self.assertAlmostEqual(summary["weighted_lender_apr"], 0.035)
        self.assertAlmostEqual(summary["weighted_average_borrow_rate"], 0.035)

    def test_redemption_priority_scales_rates_and_borrow_debt(self) -> None:
        now = datetime(2026, 8, 14, 12, tzinfo=UTC)
        response = _redemption_priority_response(_redemption_row(now), now=now)
        validated = FlexRedemptionPriorityResponse.model_validate(response)

        self.assertEqual(validated.scope.source, "flex_ui_api")
        self.assertEqual(response["freshness"]["data_state"], "ready")  # type: ignore[index]
        self.assertEqual(response["rate_scale"]["one_pct_raw"], "10000")  # type: ignore[index]
        self.assertAlmostEqual(response["total_debt"], 1968.818629)  # type: ignore[arg-type]
        points = response["points"]
        assert isinstance(points, list)
        self.assertEqual(points[0]["annual_interest_rate_raw"], "20000")
        self.assertAlmostEqual(points[0]["annual_interest_rate"], 0.02)  # type: ignore[arg-type]
        self.assertEqual(points[1]["redeemable_before_raw"], "1964702059")
        self.assertAlmostEqual(points[1]["redeemable_before"], 1964.702059)  # type: ignore[arg-type]

    def test_redemption_priority_marks_failed_last_refresh_delayed(self) -> None:
        now = datetime(2026, 8, 14, 12, tzinfo=UTC)
        row = _redemption_row(now)
        row["attempted_at"] = now
        row["last_error"] = "upstream unavailable"

        response = _redemption_priority_response(row, now=now)

        freshness = response["freshness"]
        assert isinstance(freshness, dict)
        self.assertEqual(freshness["data_state"], "delayed")
        self.assertEqual(freshness["last_error"], "upstream unavailable")
        self.assertIsNotNone(response["total_debt_raw"])
        self.assertEqual(len(response["points"]), 2)  # type: ignore[arg-type]

    def test_redemption_priority_marks_stale_source_delayed(self) -> None:
        now = datetime(2026, 8, 14, 12, tzinfo=UTC)
        row = _redemption_row(now)
        row["source_block_time"] = now - timedelta(seconds=FLEX_STALE_AFTER_SECONDS + 1)

        response = _redemption_priority_response(row, now=now)

        self.assertEqual(response["freshness"]["data_state"], "delayed")  # type: ignore[index]

    def test_redemption_priority_without_success_is_unavailable(self) -> None:
        now = datetime(2026, 8, 14, 12, tzinfo=UTC)
        row = _redemption_row(now)
        row.update(
            {
                "source_block_number": None,
                "source_block_time": None,
                "total_debt_raw": None,
                "points": [],
                "fetched_at": None,
                "last_error": "not found upstream",
            }
        )

        response = _redemption_priority_response(row, now=now)

        self.assertEqual(response["freshness"]["data_state"], "unavailable")  # type: ignore[index]
        self.assertIsNone(response["total_debt_raw"])
        self.assertEqual(response["points"], [])


if __name__ == "__main__":
    unittest.main()
