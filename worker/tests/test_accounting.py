from __future__ import annotations

import unittest
from datetime import UTC, datetime
from decimal import Decimal

from worker.accounting import (
    ProtocolTvlSnapshot,
    _parse_nonnegative_decimal,
    _parse_parent_tvl,
    _parse_yearn_components,
)


class ProtocolAccountingParserTests(unittest.TestCase):
    def test_parent_tvl_accepts_nonnegative_finite_numbers(self) -> None:
        self.assertEqual(_parse_parent_tvl(208_586_862.25), Decimal("208586862.25"))
        self.assertEqual(_parse_parent_tvl("0"), Decimal(0))

    def test_numeric_parser_rejects_bool_missing_negative_and_nonfinite(self) -> None:
        for value in (True, None, -1, "NaN", "Infinity", "not-a-number"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _parse_nonnegative_decimal(value, field="value")

    def test_components_are_dynamic_and_deterministically_ordered(self) -> None:
        payload = [
            {
                "parentProtocol": "parent#yearn",
                "slug": "yearn-finance",
                "name": "Yearn Finance",
                "tvl": 140,
                "chainTvls": {"Ethereum": 100, "Base": 40},
            },
            {
                "parentProtocol": "parent#other",
                "slug": "not-yearn",
                "name": "Other",
                "tvl": 999,
                "chainTvls": {},
            },
            {
                "parentProtocol": "parent#yearn",
                "slug": "yearn-ether",
                "name": "Yearn Ether",
                "tvl": 3,
                "chainTvls": {"Ethereum": 3},
            },
            {
                "parentProtocol": "parent#yearn",
                "slug": "yearn-curating",
                "name": "Yearn Curating",
                "tvl": 60,
                "chainTvls": {"Ethereum": 60},
            },
        ]
        components = _parse_yearn_components(payload)
        self.assertEqual([item.slug for item in components], ["yearn-curating", "yearn-ether", "yearn-finance"])
        self.assertEqual(sum((item.tvl_usd for item in components), Decimal(0)), Decimal(203))

    def test_required_components_cannot_silently_disappear(self) -> None:
        payload = [
            {
                "parentProtocol": "parent#yearn",
                "slug": "yearn-finance",
                "name": "Yearn Finance",
                "tvl": 140,
                "chainTvls": {"Ethereum": 140},
            }
        ]
        with self.assertRaisesRegex(ValueError, "yearn-curating"):
            _parse_yearn_components(payload)

    def test_parent_component_cache_skew_is_recorded_not_hidden(self) -> None:
        components = _parse_yearn_components(
            [
                {
                    "parentProtocol": "parent#yearn",
                    "slug": "yearn-finance",
                    "name": "Yearn Finance",
                    "tvl": 140,
                    "chainTvls": {"Ethereum": 140},
                },
                {
                    "parentProtocol": "parent#yearn",
                    "slug": "yearn-curating",
                    "name": "Yearn Curating",
                    "tvl": 60,
                    "chainTvls": {"Ethereum": 60},
                },
            ]
        )
        snapshot = ProtocolTvlSnapshot(
            observed_at=datetime(2026, 1, 1, tzinfo=UTC),
            parent_tvl_usd=Decimal(205),
            components=components,
        )
        self.assertEqual(snapshot.components_tvl_usd, Decimal(200))
        self.assertEqual(snapshot.reconciliation_residual_usd, Decimal(5))

    def test_duplicate_components_and_bad_chain_values_fail_snapshot(self) -> None:
        base = {
            "parentProtocol": "parent#yearn",
            "slug": "yearn-finance",
            "name": "Yearn Finance",
            "tvl": 140,
            "chainTvls": {"Ethereum": 140},
        }
        curating = {
            "parentProtocol": "parent#yearn",
            "slug": "yearn-curating",
            "name": "Yearn Curating",
            "tvl": 60,
            "chainTvls": {"Ethereum": 60},
        }
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            _parse_yearn_components([base, base, curating])
        invalid = {**curating, "chainTvls": {"Ethereum": -1}}
        with self.assertRaisesRegex(ValueError, "chainTvls"):
            _parse_yearn_components([base, invalid])


if __name__ == "__main__":
    unittest.main()
