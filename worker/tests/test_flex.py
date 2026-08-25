from __future__ import annotations

from copy import deepcopy
import unittest
from datetime import UTC, datetime

from worker.flex import (
    WAD,
    _decode_event,
    _snapshot_row,
    _topic,
    _usd_e18,
)
from worker.flex_api import (
    _record_redemption_priority_failure,
    _validated_redemption_priority_payload,
    _validated_trove_health_payload,
)


def _hex_word(value: int) -> str:
    return f"{value:064x}"


MARKET_ADDRESS = "0x" + "11" * 20


def _redemption_payload() -> dict[str, object]:
    return {
        "chain_id": 1,
        "block_number": 25_754_070,
        "block_timestamp": 1_786_720_079,
        "addresses": {"trove_manager": MARKET_ADDRESS.upper().replace("0X", "0x")},
        "metrics": {
            "total_debt": "1968818629",
            "redeemable_before_you": [
                {"rate": "20000", "redeemable_before": "0"},
                {"rate": "55000", "redeemable_before": "1964702059"},
            ],
        },
    }


def _explorer_payload() -> dict[str, object]:
    return {
        "chain_id": 1,
        "block_number": 25_754_070,
        "block_timestamp": 1_786_720_079,
        "markets": {
            f"1:{MARKET_ADDRESS}": {
                "collateral_token_price_in_borrow_token": str(10**18),
                "max_ltv": "909090",
            }
        },
        "rows": [
            {
                "market_id": f"1:{MARKET_ADDRESS}",
                "trove_id": str(index),
                "collateral": str(collateral),
                "debt": str(debt),
                "annual_interest_rate": "20000",
                "status": 1,
            }
            for index, (collateral, debt) in enumerate(
                ((100_000_000, 90_000_000), (200_000_000, 180_000_000), (100_000_000, 80_000_000)),
                start=1,
            )
        ],
    }


def _active_market() -> dict[str, object]:
    return {
        "market_address": MARKET_ADDRESS,
        "market_status": "active",
        "collateral_token_decimals": 6,
        "borrow_token_decimals": 6,
    }


class RecordingCursor:
    def __init__(self, commands: list[tuple[str, tuple[object, ...]]]) -> None:
        self.commands = commands

    def __enter__(self) -> RecordingCursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.commands.append((query, params))


class RecordingConnection:
    def __init__(self) -> None:
        self.commands: list[tuple[str, tuple[object, ...]]] = []

    def cursor(self) -> RecordingCursor:
        return RecordingCursor(self.commands)


class FlexWorkerTests(unittest.TestCase):
    def test_usd_value_retains_eighteen_decimal_scale(self) -> None:
        self.assertEqual(_usd_e18(1_500_000, 6, 100_000_000, 8), 3 * 10**18 // 2)

    def test_snapshot_accrues_debt_with_ceiling_division(self) -> None:
        sampled_at = datetime(2026, 8, 1, tzinfo=UTC)
        block_timestamp = int(sampled_at.timestamp())
        market = {
            "market_address": "0x" + "11" * 20,
            "contract_version": "1.1.0",
            "collateral_token_decimals": 18,
            "borrow_token_decimals": 6,
        }
        state = {
            "collateral": 2 * 10**18,
            "stored_debt": 1_000_000,
            "weighted_debt": 1,
            "last_debt_update_time": block_timestamp - 1,
            "deposits": 2_000_000,
            "idle": 1_000_000,
            "oracle_price": WAD,
            "borrow_usd_price": 100_000_000,
            "borrow_usd_price_decimals": 8,
        }
        row = _snapshot_row(
            market,
            state,
            sampled_at,
            {"number": "0x10", "timestamp": hex(block_timestamp), "hash": "0xabc"},
        )
        self.assertEqual(row["debt_raw"], 1_000_001)
        self.assertEqual(row["debt_usd_e18"], 1_000_001 * 10**12)

    def test_indexed_uint_identifiers_are_json_safe_strings(self) -> None:
        topic = _topic("OpenTrove(uint256,address,uint256,uint256,uint256,uint256)")
        large_id = 2**200 + 7
        log = {
            "topics": [topic, "0x" + _hex_word(large_id), "0x" + "00" * 12 + "22" * 20],
            "data": "0x" + "".join(_hex_word(value) for value in (1, 2, 3, 4)),
            "address": "0x" + "11" * 20,
            "blockNumber": "0x10",
            "blockHash": "0xabc",
            "transactionHash": "0xdef",
            "logIndex": "0x1",
        }
        decoded = _decode_event(
            log,
            {"market_address": "0x" + "11" * 20, "contract_version": "1.1.0"},
            {"timestamp": hex(int(datetime(2026, 8, 1, tzinfo=UTC).timestamp()))},
        )
        self.assertIsNotNone(decoded)
        self.assertEqual(decoded["event_name"], "open_trove")
        self.assertEqual(decoded["amounts"].obj["trove_id"], str(large_id))
        self.assertEqual(decoded["amounts"].obj["debt_raw"], "2")

    def test_redemption_priority_validation_preserves_raw_points_and_provenance(self) -> None:
        validated = _validated_redemption_priority_payload(_redemption_payload(), MARKET_ADDRESS)

        self.assertEqual(validated["source_block_number"], 25_754_070)
        self.assertEqual(
            validated["source_block_time"],
            datetime.fromtimestamp(1_786_720_079, UTC),
        )
        self.assertEqual(validated["total_debt_raw"], "1968818629")
        self.assertEqual(
            validated["points"],
            [
                {"rate": "20000", "redeemable_before": "0"},
                {"rate": "55000", "redeemable_before": "1964702059"},
            ],
        )

    def test_redemption_priority_validation_rejects_wrong_chain_or_market(self) -> None:
        wrong_chain = _redemption_payload()
        wrong_chain["chain_id"] = 10
        with self.assertRaisesRegex(ValueError, "chain_id"):
            _validated_redemption_priority_payload(wrong_chain, MARKET_ADDRESS)

        wrong_market = _redemption_payload()
        wrong_market["addresses"] = {"trove_manager": "0x" + "22" * 20}
        with self.assertRaisesRegex(ValueError, "trove_manager"):
            _validated_redemption_priority_payload(wrong_market, MARKET_ADDRESS)

    def test_redemption_priority_validation_requires_raw_strings(self) -> None:
        payload = _redemption_payload()
        metrics = payload["metrics"]
        assert isinstance(metrics, dict)
        metrics["total_debt"] = 1_968_818_629
        with self.assertRaisesRegex(ValueError, "total_debt"):
            _validated_redemption_priority_payload(payload, MARKET_ADDRESS)

        payload = _redemption_payload()
        metrics = payload["metrics"]
        assert isinstance(metrics, dict)
        points = metrics["redeemable_before_you"]
        assert isinstance(points, list)
        points[0] = {"rate": "2.0", "redeemable_before": "0"}
        with self.assertRaisesRegex(ValueError, "point 0 rate"):
            _validated_redemption_priority_payload(payload, MARKET_ADDRESS)

    def test_redemption_priority_validation_rejects_future_block_time(self) -> None:
        payload = _redemption_payload()
        payload["block_timestamp"] = int(datetime.now(UTC).timestamp()) + 301
        with self.assertRaisesRegex(ValueError, "in the future"):
            _validated_redemption_priority_payload(payload, MARKET_ADDRESS)

    def test_redemption_priority_validation_rejects_invalid_curve(self) -> None:
        payload = _redemption_payload()
        metrics = payload["metrics"]
        assert isinstance(metrics, dict)
        points = metrics["redeemable_before_you"]
        assert isinstance(points, list)
        points.reverse()
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            _validated_redemption_priority_payload(payload, MARKET_ADDRESS)

        payload = deepcopy(_redemption_payload())
        metrics = payload["metrics"]
        assert isinstance(metrics, dict)
        points = metrics["redeemable_before_you"]
        assert isinstance(points, list)
        points[1] = {"rate": "55000", "redeemable_before": "1968818630"}
        with self.assertRaisesRegex(ValueError, "exceeds total debt"):
            _validated_redemption_priority_payload(payload, MARKET_ADDRESS)

    def test_failed_refresh_updates_only_attempt_metadata(self) -> None:
        conn = RecordingConnection()
        attempted_at = datetime(2026, 8, 14, tzinfo=UTC)

        _record_redemption_priority_failure(
            conn,  # type: ignore[arg-type]
            market_address=MARKET_ADDRESS,
            source_url="https://api.flexmeow.com/v1/ui/borrow?chain_id=1",
            attempted_at=attempted_at,
            error="upstream unavailable",
        )

        self.assertEqual(len(conn.commands), 1)
        query, params = conn.commands[0]
        update_clause = query.split("DO UPDATE SET", 1)[1]
        self.assertNotIn("points", update_clause)
        self.assertNotIn("total_debt_raw", update_clause)
        self.assertNotIn("fetched_at", update_clause)
        self.assertIn("attempted_at = EXCLUDED.attempted_at", update_clause)
        self.assertEqual(params[-1], "upstream unavailable")

    def test_trove_health_validation_aggregates_without_position_identity(self) -> None:
        aggregates = _validated_trove_health_payload(_explorer_payload(), [_active_market()])

        self.assertEqual(len(aggregates), 1)
        aggregate = aggregates[0]
        self.assertEqual(aggregate["active_troves"], 3)
        self.assertEqual(aggregate["total_collateral_raw"], "400000000")
        self.assertEqual(aggregate["total_debt_raw"], "350000000")
        self.assertEqual(aggregate["median_ltv_wad"], "900000000000000000")
        self.assertEqual(aggregate["maximum_position_ltv_wad"], "900000000000000000")
        self.assertEqual(aggregate["minimum_buffer_wad"], "9090000000000000")
        self.assertEqual(aggregate["near_max_troves"], 2)
        self.assertEqual(aggregate["debt_near_max_raw"], "270000000")
        self.assertEqual(aggregate["largest_debt_share_wad"], "514285714285714285")
        self.assertNotIn("owner", aggregate)
        self.assertNotIn("trove_id", aggregate)

    def test_trove_health_validation_requires_every_active_market(self) -> None:
        payload = _explorer_payload()
        payload["markets"] = {}

        with self.assertRaisesRegex(ValueError, "missing active market"):
            _validated_trove_health_payload(payload, [_active_market()])

    def test_trove_health_validation_rejects_duplicate_troves(self) -> None:
        payload = _explorer_payload()
        rows = payload["rows"]
        assert isinstance(rows, list)
        rows.append(deepcopy(rows[0]))

        with self.assertRaisesRegex(ValueError, "repeats trove"):
            _validated_trove_health_payload(payload, [_active_market()])


if __name__ == "__main__":
    unittest.main()
