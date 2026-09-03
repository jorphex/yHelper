from __future__ import annotations

import unittest

from worker.kong import _normalize_kong_snapshot


def _vault(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "address": "0x0000000000000000000000000000000000000001",
        "chainId": 1,
        "origin": "yearn",
        "isHidden": False,
        "isRetired": False,
        "inclusion": {"isYearn": True},
        "tvl": 123.45,
        "kind": "Multi Strategy",
        "apiVersion": "3.0.4",
        "performance": {"oracle": {"apy": 0.05}},
        "asset": {"address": "0xasset", "symbol": "USDC", "decimals": 6},
    }
    payload.update(overrides)
    return payload


class KongSnapshotValidationTests(unittest.TestCase):
    def test_rest_scalar_tvl_and_catalog_fields_are_normalized(self) -> None:
        row = _normalize_kong_snapshot([_vault()])[0]
        self.assertEqual(row["tvl_usd"], 123.45)
        self.assertEqual(row["est_apy"], 0.05)
        self.assertEqual(row["origin"], "yearn")
        self.assertIs(row["catalog_is_yearn"], True)
        self.assertIs(row["is_hidden"], False)
        self.assertIs(row["is_retired"], False)

    def test_ybold_family_uses_maximum_net_oracle_or_weekly_apy(self) -> None:
        row = _normalize_kong_snapshot(
            [
                _vault(
                    symbol="ysyBOLD",
                    performance={
                        "oracle": {"apy": 0.05, "netAPY": 0.04},
                        "historical": {"weeklyNet": 0.17},
                    },
                )
            ]
        )[0]
        self.assertEqual(row["est_apy"], 0.17)

    def test_ybold_family_falls_back_to_available_component(self) -> None:
        row = _normalize_kong_snapshot(
            [_vault(symbol="yBOLD", performance={"oracle": {"netAPY": 0.04}})]
        )[0]
        self.assertEqual(row["est_apy"], 0.04)

    def test_non_ybold_vault_retains_oracle_apy_semantics(self) -> None:
        row = _normalize_kong_snapshot(
            [
                _vault(
                    symbol="yvUSDC",
                    performance={
                        "oracle": {"apy": 0.05, "netAPY": 0.04},
                        "historical": {"weeklyNet": 0.17},
                    },
                )
            ]
        )[0]
        self.assertEqual(row["est_apy"], 0.05)

    def test_ybold_family_rejects_malformed_present_component(self) -> None:
        record = _vault(
            symbol="ysyBOLD",
            performance={
                "oracle": {"netAPY": 0.04},
                "historical": {"weeklyNet": "not-a-number"},
            },
        )
        with self.assertRaisesRegex(ValueError, "malformed numeric"):
            _normalize_kong_snapshot([record])

    def test_missing_identity_or_lifecycle_and_invalid_inclusion_fail_snapshot(self) -> None:
        invalid_records = [
            _vault(address=""),
            _vault(isHidden=None),
            _vault(inclusion={"isYearn": "yes"}),
            _vault(origin="other"),
        ]
        for record in invalid_records:
            with self.subTest(record=record), self.assertRaises(ValueError):
                _normalize_kong_snapshot([record])

    def test_absent_inclusion_decision_remains_explicitly_unknown(self) -> None:
        row = _normalize_kong_snapshot([_vault(inclusion={})])[0]
        self.assertIsNone(row["catalog_is_yearn"])

    def test_duplicate_identity_fails_snapshot(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate identity"):
            _normalize_kong_snapshot([_vault(), _vault(tvl=999)])

    def test_malformed_numeric_value_fails_snapshot(self) -> None:
        with self.assertRaisesRegex(ValueError, "malformed numeric"):
            _normalize_kong_snapshot([_vault(tvl="not-a-number")])


if __name__ == "__main__":
    unittest.main()
