from __future__ import annotations

import unittest

from app.product_service import _build_overview_pulse


def _snapshot(**overrides: object) -> dict[str, object]:
    snapshot: dict[str, object] = {
        "vaults_eligible": 10,
        "vaults_with_change": 8,
        "total_tvl_usd": 1_000.0,
        "comparable_tvl_usd": 800.0,
        "improving_tvl_usd": 100.0,
        "softening_tvl_usd": 600.0,
        "steady_tvl_usd": 100.0,
        "fresh_comparable_tvl_usd": 760.0,
        "tvl_weighted_realized_apy_window": 0.02,
        "tvl_weighted_realized_apy_prev_window": 0.025,
        "fresh_comparable_vaults": 7,
        "latest_data_epoch": 1_750_000_000,
        "oldest_data_epoch": 1_749_900_000,
    }
    snapshot.update(overrides)
    return snapshot


class BuildOverviewPulseTests(unittest.TestCase):
    def test_ready_softening_pulse_uses_directional_tvl_breadth(self) -> None:
        pulse = _build_overview_pulse(_snapshot())["pulse"]

        self.assertIsNotNone(pulse)
        assert isinstance(pulse, dict)
        self.assertEqual(pulse["trend"], "softening")
        self.assertEqual(pulse["data_state"], "ready")
        self.assertAlmostEqual(pulse["change_7d"], -0.005)
        self.assertAlmostEqual(pulse["directional_tvl_ratio"], 0.75)
        self.assertAlmostEqual(pulse["coverage_ratio"], 0.8)
        self.assertAlmostEqual(pulse["fresh_tvl_ratio"], 0.95)
        self.assertEqual(pulse["latest_data_at"], "2025-06-15T15:06:40+00:00")

    def test_improving_and_steady_pulses_select_matching_breadth(self) -> None:
        improving = _build_overview_pulse(
            _snapshot(
                tvl_weighted_realized_apy_window=0.03,
                tvl_weighted_realized_apy_prev_window=0.025,
                improving_tvl_usd=520.0,
            )
        )["pulse"]
        steady = _build_overview_pulse(
            _snapshot(
                tvl_weighted_realized_apy_window=0.0255,
                tvl_weighted_realized_apy_prev_window=0.025,
                steady_tvl_usd=440.0,
            )
        )["pulse"]

        assert isinstance(improving, dict)
        assert isinstance(steady, dict)
        self.assertEqual(improving["trend"], "improving")
        self.assertAlmostEqual(improving["directional_tvl_ratio"], 0.65)
        self.assertEqual(steady["trend"], "steady")
        self.assertAlmostEqual(steady["directional_tvl_ratio"], 0.55)

    def test_limited_coverage_takes_priority_over_freshness(self) -> None:
        pulse = _build_overview_pulse(
            _snapshot(comparable_tvl_usd=400.0, fresh_comparable_tvl_usd=100.0)
        )["pulse"]

        assert isinstance(pulse, dict)
        self.assertEqual(pulse["data_state"], "limited")
        self.assertAlmostEqual(pulse["coverage_ratio"], 0.4)

    def test_delayed_state_reflects_tvl_freshness(self) -> None:
        pulse = _build_overview_pulse(
            _snapshot(fresh_comparable_tvl_usd=560.0)
        )["pulse"]

        assert isinstance(pulse, dict)
        self.assertEqual(pulse["data_state"], "delayed")
        self.assertAlmostEqual(pulse["fresh_tvl_ratio"], 0.7)

    def test_missing_comparison_data_hides_pulse(self) -> None:
        cases = (
            _snapshot(vaults_with_change=0),
            _snapshot(tvl_weighted_realized_apy_window=None),
            _snapshot(tvl_weighted_realized_apy_prev_window=None),
        )

        for snapshot in cases:
            with self.subTest(snapshot=snapshot):
                self.assertIsNone(_build_overview_pulse(snapshot)["pulse"])


if __name__ == "__main__":
    unittest.main()
