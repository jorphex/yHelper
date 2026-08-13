from __future__ import annotations

import unittest
from unittest.mock import patch

from app.assets_routes import _asset_vaults_response
from app.models import AssetVaultsResponse


class _Cursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.responses: list[object] = [
            {
                "vaults": 3,
                "chains": 2,
                "total_tvl_usd": 6_000.0,
                "best_realized_apy_30d": 0.04,
                "worst_realized_apy_30d": 0.02,
                "realized_spread_30d": 0.02,
                "weighted_realized_apy_30d": 0.03,
            },
            [
                {
                    "vault_address": "0x1",
                    "chain_id": 1,
                    "symbol": "yvUSDC",
                    "tvl_usd": 3_000.0,
                    "est_apy": 0.03,
                    "realized_apy_30d": 0.04,
                    "momentum_7d_30d": 0.01,
                }
            ],
        ]

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, sql: str, params: dict[str, object]) -> None:
        self.calls.append((sql, params))

    def fetchone(self) -> dict[str, object]:
        response = self.responses.pop(0)
        assert isinstance(response, dict)
        return response

    def fetchall(self) -> list[dict[str, object]]:
        response = self.responses.pop(0)
        assert isinstance(response, list)
        return response


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self.cursor_value = cursor

    def __enter__(self) -> _Connection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def cursor(self) -> _Cursor:
        return self.cursor_value


class AssetCompatibilityTests(unittest.TestCase):
    def test_summary_uses_full_cohort_before_row_limit(self) -> None:
        cursor = _Cursor()
        with patch("app.assets_routes.psycopg.connect", return_value=_Connection(cursor)):
            payload = _asset_vaults_response("usdc", "core", 0.0, 0, None, 1)

        self.assertEqual(payload["summary"]["vaults"], 3)  # type: ignore[index]
        self.assertEqual(payload["summary"]["total_tvl_usd"], 6_000.0)  # type: ignore[index]
        self.assertEqual(len(payload["rows"]), 1)  # type: ignore[arg-type]
        self.assertNotIn("LIMIT %(limit)s", cursor.calls[0][0])
        self.assertIn("LIMIT %(limit)s", cursor.calls[1][0])
        AssetVaultsResponse.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
