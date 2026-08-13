from __future__ import annotations

import unittest
from datetime import UTC, datetime

from worker.config import YLOCKER_PRODUCTS
from worker.ylockers import WEEK_SECONDS, _decode_reward_event


def _topic(value: int) -> str:
    return f"0x{value:064x}"


def _address_topic(address: str) -> str:
    return f"0x{address.removeprefix('0x').lower():0>64}"


def _log(*, week: int = 10, depositor: str, shares_raw: int = 2_000_000_000_000_000_001) -> dict[str, object]:
    return {
        "topics": ["0x" + "11" * 32, _topic(week), _address_topic(depositor)],
        "blockNumber": "0x100",
        "logIndex": "0x2",
        "transactionHash": "0x" + "22" * 32,
        "blockHash": "0x" + "33" * 32,
        "data": f"0x{shares_raw:064x}",
    }


class YlockerEventTests(unittest.TestCase):
    def test_decode_uses_native_cycle_bounds_and_event_block_integer_pps(self) -> None:
        start_time = int(datetime(2026, 8, 6, tzinfo=UTC).timestamp())
        depositor = next(iter(YLOCKER_PRODUCTS["ycrv"]["official_depositors"]))
        row = _decode_reward_event(
            product="ycrv",
            distributor=YLOCKER_PRODUCTS["ycrv"]["distributor"],
            official_depositors={depositor},
            start_time=start_time,
            log=_log(depositor=depositor),
            block={"timestamp": hex(start_time + WEEK_SECONDS * 10 + 123)},
            # Deliberately fractional PPS: integer arithmetic must truncate only
            # the final raw-asset result, never convert through a float.
            pps_raw=1_500_000_000_000_000_001,
        )

        assert row is not None
        self.assertEqual(row["native_week"], 10)
        self.assertEqual(row["cycle_start"], datetime(2026, 10, 15, tzinfo=UTC))
        self.assertEqual(row["cycle_end"], datetime(2026, 10, 22, tzinfo=UTC))
        self.assertEqual(row["block_time"], datetime.fromtimestamp(start_time + WEEK_SECONDS * 10 + 123, UTC))
        self.assertEqual(row["reward_shares_raw"], 2_000_000_000_000_000_001)
        self.assertEqual(row["pps_raw"], 1_500_000_000_000_000_001)
        self.assertEqual(row["reward_assets_raw"], 3_000_000_000_000_000_003)

    def test_decode_classifies_only_allowlisted_depositors_as_official(self) -> None:
        official = next(iter(YLOCKER_PRODUCTS["yyb"]["official_depositors"]))
        outsider = "0x" + "ab" * 20
        kwargs = {
            "product": "yyb",
            "distributor": YLOCKER_PRODUCTS["yyb"]["distributor"],
            "start_time": 0,
            "block": {"timestamp": "0x1"},
            "pps_raw": 10**18,
        }
        official_row = _decode_reward_event(
            official_depositors={official}, log=_log(depositor=official), **kwargs
        )
        outsider_row = _decode_reward_event(
            official_depositors={official}, log=_log(depositor=outsider), **kwargs
        )
        assert official_row is not None
        assert outsider_row is not None
        self.assertIs(official_row["is_official"], True)
        self.assertIs(outsider_row["is_official"], False)

    def test_malformed_event_is_ignored(self) -> None:
        row = _decode_reward_event(
            product="ycrv",
            distributor=YLOCKER_PRODUCTS["ycrv"]["distributor"],
            official_depositors=set(),
            start_time=0,
            log={"topics": []},
            block={"timestamp": "0x1"},
            pps_raw=10**18,
        )
        self.assertIsNone(row)


if __name__ == "__main__":
    unittest.main()
