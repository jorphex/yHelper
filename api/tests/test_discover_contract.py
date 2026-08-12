from __future__ import annotations

import unittest
from unittest.mock import patch

from app.explore_routes import discover
from app.models import DiscoverResponse


class _Cursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.responses = [
            {"visible_vaults": 2, "with_realized_apy": 2, "without_realized_apy": 0},
            [{"chain_id": 1, "vaults": 2}],
            {
                "vaults": 2,
                "total_tvl_usd": 3_000.0,
                "best_realized_apy_30d": 0.04,
                "worst_realized_apy_30d": 0.02,
                "realized_spread_30d": 0.02,
                "tvl_weighted_realized_apy_30d": 0.03,
            },
            [
                {
                    "vault_address": "0x1",
                    "chain_id": 1,
                    "symbol": "USDC",
                    "token_symbol": "USDC",
                    "market": "stablecoins",
                    "tvl_usd": 3_000.0,
                    "est_apy": 0.03,
                    "realized_apy_30d": 0.03,
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


class DiscoverContractTests(unittest.TestCase):
    def test_exact_token_filter_is_case_insensitive_and_summary_precedes_pagination(self) -> None:
        cursor = _Cursor()
        with patch("app.explore_routes.psycopg.connect", return_value=_Connection(cursor)):
            payload = discover(
                token_symbol=" usdc ",
                limit=1,
                offset=0,
                chain_id=None,
                min_tvl_usd=0.0,
                min_points=0,
                max_vaults=None,
            )

        self.assertEqual(payload["filters"]["token_symbol"], "USDC")  # type: ignore[index]
        self.assertEqual(payload["summary"]["vaults"], 2)  # type: ignore[index]
        self.assertEqual(payload["summary"]["total_tvl_usd"], 3_000.0)  # type: ignore[index]
        self.assertEqual(payload["summary"]["realized_spread_30d"], 0.02)  # type: ignore[index]
        self.assertTrue(all("LOWER(COALESCE(d.token_symbol" in sql for sql, _ in cursor.calls))
        self.assertTrue(all(params["token_symbol"] == "USDC" for _, params in cursor.calls))
        DiscoverResponse.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
