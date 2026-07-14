from __future__ import annotations

import unittest
from datetime import UTC, datetime

from app.accounting_service import _build_protocol_context


class ProtocolContextContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = {
            "active_yearn": {"vaults": 450, "gross_tvl_usd": 178_000_000},
            "all_products": {"vaults": 943, "gross_tvl_usd": 330_000_000},
        }
        self.analytics = {"user_visible": {"vaults": 120, "gross_tvl_usd": 160_000_000}}
        self.now = datetime(2026, 7, 13, tzinfo=UTC)

    def test_protocol_tvl_never_uses_catalog_gross_sum(self) -> None:
        protocol = {
            "tvl_usd": 208_000_000,
            "observed_at": self.now.isoformat(),
            "freshness_status": "fresh",
        }
        result = _build_protocol_context(
            protocol=protocol,
            catalog=self.catalog,
            analytics=self.analytics,
            now=self.now,
        )
        self.assertEqual(result["schema_version"], 3)
        self.assertEqual(result["source"], "defillama_yearn_parent")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["protocol"]["tvl_usd"], 208_000_000)
        self.assertEqual(result["current_yearn"]["tvl_usd"], 208_000_000)
        self.assertEqual(result["current_yearn"]["vaults"], 450)
        self.assertIsNone(result["total_yearn"]["tvl_usd"])

    def test_missing_protocol_source_does_not_fallback_to_kong(self) -> None:
        result = _build_protocol_context(
            protocol=None,
            catalog=self.catalog,
            analytics=self.analytics,
            now=self.now,
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["protocol"])
        self.assertIsNone(result["current_yearn"]["tvl_usd"])
        self.assertEqual(result["catalog"]["active_yearn"]["gross_tvl_usd"], 178_000_000)

    def test_stale_protocol_source_is_explicit(self) -> None:
        result = _build_protocol_context(
            protocol={"tvl_usd": 208_000_000, "freshness_status": "stale"},
            catalog=self.catalog,
            analytics=self.analytics,
            now=self.now,
        )
        self.assertEqual(result["status"], "stale")
        self.assertEqual(result["current_yearn"]["tvl_usd"], 208_000_000)


if __name__ == "__main__":
    unittest.main()
