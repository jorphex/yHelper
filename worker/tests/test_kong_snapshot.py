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
