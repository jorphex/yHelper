from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.config import YLOCKER_PRODUCTS, YLOCKER_REWARD_TOKEN
from app.models import YlockerRewardsResponse
from app.ylockers_service import WEEK_SECONDS, _build_response


NOW = datetime(2026, 8, 13, 12, tzinfo=UTC)
YCRV_START = datetime(2026, 7, 30, tzinfo=UTC)
YYB_START = datetime(2026, 7, 30, 11, tzinfo=UTC)


class FakeCursor:
    def __init__(self, states: list[dict[str, object]], events: list[dict[str, object]]) -> None:
        self.states = states
        self.events = events
        self.query = ""
        self.params: object = None

    def execute(self, query: str, params: object = None) -> None:
        self.query = query
        self.params = params

    def fetchall(self) -> list[dict[str, object]]:
        if "ylocker_reward_sync_state" in self.query:
            return self.states
        if "ylocker_reward_events" in self.query:
            products = set(self.params[0]) if isinstance(self.params, tuple) else set()
            return [row for row in self.events if row["product"] in products]
        raise AssertionError(f"unexpected query: {self.query}")


def _state(product: str, start: datetime, *, observed: datetime = NOW, cursor: int = 123) -> dict[str, object]:
    return {
        "product": product,
        "chain_id": 1,
        "distributor_address": YLOCKER_PRODUCTS[product]["distributor"],
        "cursor": cursor,
        "observed_at": observed,
        "payload": {"start_time": int(start.timestamp()), "status": "success"},
        "updated_at": observed,
    }


def _event(
    product: str,
    *,
    start: datetime,
    week: int,
    block_time: datetime,
    shares_raw: int,
    pps_raw: int,
    block_number: int,
    log_index: int = 0,
) -> dict[str, object]:
    cycle_start = start + timedelta(seconds=week * WEEK_SECONDS)
    return {
        "product": product,
        "distributor_address": YLOCKER_PRODUCTS[product]["distributor"],
        "block_number": block_number,
        "block_time": block_time,
        "tx_hash": "0x" + f"{block_number:064x}",
        "log_index": log_index,
        "native_week": week,
        "cycle_start": cycle_start,
        "cycle_end": cycle_start + timedelta(seconds=WEEK_SECONDS),
        "depositor_address": "0x" + "aa" * 20,
        "reward_shares_raw": Decimal(shares_raw),
        "pps_raw": Decimal(pps_raw),
        "reward_assets_raw": Decimal(shares_raw * pps_raw // 10**18),
    }


class YlockerServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.states = [_state("ycrv", YCRV_START), _state("yyb", YYB_START)]
        self.events = [
            _event(
                "ycrv",
                start=YCRV_START,
                week=1,
                block_time=datetime(2026, 8, 6, 0, 30, tzinfo=UTC),
                shares_raw=2 * 10**18,
                pps_raw=1_500_000_000_000_000_001,
                block_number=10,
            ),
            _event(
                "yyb",
                start=YYB_START,
                week=1,
                block_time=datetime(2026, 8, 6, 11, 30, tzinfo=UTC),
                shares_raw=10**18,
                pps_raw=2 * 10**18,
                block_number=11,
            ),
            _event(
                "ycrv",
                start=YCRV_START,
                week=0,
                block_time=datetime(2026, 7, 30, 0, 30, tzinfo=UTC),
                shares_raw=10**18,
                pps_raw=10**18,
                block_number=9,
            ),
        ]

    def _response(self, *, product: str = "all", limit: int = 2, include_events: bool = True) -> dict[str, object]:
        return _build_response(
            FakeCursor(self.states, self.events),
            product_filter=product,
            limit=limit,
            include_events=include_events,
            now=NOW,
        )

    def test_builds_current_and_completed_native_cycles(self) -> None:
        result = self._response()
        self.assertEqual(
            [(row["product"], row["native_week"], row["status"]) for row in result["current_cycles"]],
            [("ycrv", 2, "current"), ("yyb", 2, "current")],
        )
        self.assertEqual(len(result["cycles"]), 4)
        first = next(row for row in result["cycles"] if row["product"] == "ycrv" and row["native_week"] == 1)
        self.assertEqual(first["cycle_start"], "2026-08-06T00:00:00+00:00")
        self.assertEqual(first["cycle_end"], "2026-08-13T00:00:00+00:00")
        self.assertEqual(first["event_count"], 1)
        self.assertEqual(first["value_crvusd_at_deposit"], 3.0)

    def test_zero_event_cycles_are_kept_and_product_filter_is_narrow(self) -> None:
        all_result = self._response()
        empty = next(row for row in all_result["cycles"] if row["product"] == "yyb" and row["native_week"] == 0)
        self.assertEqual(empty["event_count"], 0)
        self.assertEqual(empty["value_crvusd_at_deposit"], 0.0)
        self.assertEqual(empty["events"], [])

        filtered = self._response(product="ycrv", include_events=False)
        self.assertEqual(filtered["scope"]["products"], ["ycrv"])
        self.assertTrue(all(row["product"] == "ycrv" for row in filtered["cycles"]))
        self.assertTrue(all(not row["events"] for row in filtered["cycles"]))

    def test_reporting_rollup_closes_at_the_thursday_calendar_boundary(self) -> None:
        result = self._response()
        week = next(row for row in result["reporting_weeks"] if row["week_start"] == "2026-08-06T00:00:00+00:00")
        self.assertEqual(week["week_end"], "2026-08-13T00:00:00+00:00")
        self.assertEqual(week["total_crvusd_at_deposit"], 5.0)
        self.assertEqual(
            [(row["product"], row["value_crvusd_at_deposit"]) for row in week["products"]],
            [("ycrv", 3.0), ("yyb", 2.0)],
        )
        self.assertEqual(week["digest_ready_at"], "2026-08-13T00:00:00+00:00")
        self.assertEqual(week["status"], "finalized")
        self.assertTrue(week["ready_for_digest"])

    def test_reporting_week_does_not_wait_for_a_later_native_cycle_boundary(self) -> None:
        late_yyb_start = datetime(2026, 7, 30, 15, tzinfo=UTC)
        states = [self.states[0], _state("yyb", late_yyb_start)]
        events = [
            self.events[0],
            _event(
                "yyb",
                start=late_yyb_start,
                week=1,
                block_time=datetime(2026, 8, 6, 15, 30, tzinfo=UTC),
                shares_raw=10**18,
                pps_raw=2 * 10**18,
                block_number=12,
            ),
        ]

        result = _build_response(
            FakeCursor(states, events),
            product_filter="all",
            limit=2,
            include_events=True,
            now=NOW,
        )

        week = next(row for row in result["reporting_weeks"] if row["week_start"] == "2026-08-06T00:00:00+00:00")
        self.assertEqual(week["status"], "finalized")
        self.assertEqual(week["digest_ready_at"], "2026-08-13T00:00:00+00:00")
        self.assertTrue(week["ready_for_digest"])
        self.assertEqual(week["total_crvusd_at_deposit"], 5.0)
        yyb_current = next(row for row in result["current_cycles"] if row["product"] == "yyb")
        self.assertEqual(yyb_current["cycle_end"], "2026-08-13T15:00:00+00:00")
        self.assertEqual(yyb_current["event_count"], 1)

    def test_freshness_is_delayed_when_one_product_lags(self) -> None:
        self.states[1]["observed_at"] = NOW - timedelta(seconds=3600)
        result = self._response()
        self.assertEqual(result["freshness"]["status"], "delayed")
        self.assertEqual(result["freshness"]["indexed_through"], "2026-08-13T11:00:00+00:00")
        week = next(row for row in result["reporting_weeks"] if row["week_start"] == "2026-08-06T00:00:00+00:00")
        self.assertEqual(week["status"], "finalized")
        self.assertFalse(week["ready_for_digest"])

    def test_freshness_and_digest_are_delayed_after_a_sync_failure(self) -> None:
        self.states[1]["payload"] = {
            "start_time": int(YYB_START.timestamp()),
            "status": "failed",
        }
        result = self._response()
        self.assertEqual(result["freshness"]["status"], "delayed")
        week = next(row for row in result["reporting_weeks"] if row["week_start"] == "2026-08-06T00:00:00+00:00")
        self.assertEqual(week["status"], "finalized")
        self.assertFalse(week["ready_for_digest"])

    def test_response_matches_typed_openapi_model(self) -> None:
        result = self._response()
        parsed = YlockerRewardsResponse.model_validate(result)
        self.assertEqual(parsed.scope.chain_id, 1)
        self.assertEqual(parsed.scope.reward_token.symbol, YLOCKER_REWARD_TOKEN["symbol"])
        self.assertEqual(parsed.filters.product, "all")


if __name__ == "__main__":
    unittest.main()
