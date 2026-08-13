from __future__ import annotations

import unittest

from app.main import app


class RouteContractTests(unittest.TestCase):
    def test_canonical_product_routes_are_registered(self) -> None:
        paths = {route.path for route in app.routes}
        self.assertTrue(
            {
                "/api/meta/status",
                "/api/reports",
                "/api/assets/{token_symbol:path}/vaults",
                "/api/discover",
                "/api/composition",
                "/api/changes",
            }.issubset(paths)
        )

    def test_retired_heuristic_routes_are_absent(self) -> None:
        paths = {route.path for route in app.routes}
        self.assertNotIn("/api/dau", paths)
        self.assertNotIn("/api/meta/movers", paths)
        self.assertNotIn("/api/regimes", paths)
        self.assertNotIn("/api/regimes/transitions", paths)
        self.assertNotIn("/api/regimes/transitions/daily", paths)
        self.assertNotIn("/api/chains/rollups", paths)

    def test_incompatible_legacy_aliases_are_removed(self) -> None:
        paths = {route.path for route in app.routes}
        self.assertNotIn("/api/overview", paths)
        self.assertNotIn("/api/harvests", paths)
        self.assertNotIn("/api/meta/social-preview", paths)
        self.assertNotIn("/api/assets/{token_symbol:path}/venues", paths)
        self.assertNotIn("/api/assets", paths)
        self.assertNotIn("/api/trends/daily", paths)

    def test_canonical_product_routes_publish_typed_responses(self) -> None:
        schema = app.openapi()
        expected_models = {
            "/health": "HealthResponse",
            "/api/overview-pulse": "OverviewPulseResponse",
            "/api/meta/freshness": "FreshnessResponse",
            "/api/meta/coverage": "CoverageResponse",
            "/api/meta/protocol-context": "ProtocolContextResponse",
            "/api/meta/status": "OperationalStatusResponse",
            "/api/discover": "DiscoverResponse",
            "/api/composition": "CompositionResponse",
            "/api/changes": "ChangesResponse",
            "/api/assets/{token_symbol}/vaults": "AssetVaultsResponse",
            "/api/reports": "ReportsResponse",
            "/api/ylockers/rewards": "YlockerRewardsResponse",
            "/api/ylockers/rewards/{product}/cycles/{native_week}": "YlockerRewardCycleResponse",
            "/api/styfi": "StyfiResponse",
        }
        for path, model_name in expected_models.items():
            response_schema = schema["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
            self.assertEqual(response_schema["$ref"], f"#/components/schemas/{model_name}")

    def test_asset_vault_compatibility_route_is_deprecated(self) -> None:
        operation = app.openapi()["paths"]["/api/assets/{token_symbol}/vaults"]["get"]
        self.assertTrue(operation["deprecated"])
        self.assertIn("/api/discover?token_symbol=", operation["description"])


if __name__ == "__main__":
    unittest.main()
