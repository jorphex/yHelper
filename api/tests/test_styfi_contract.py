from __future__ import annotations

import unittest
from unittest.mock import patch

from app.activity_routes import styfi


class FakeCursor:
    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *args: object) -> None:
        return None


class FakeConnection:
    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return FakeCursor()


class StyfiContractTests(unittest.TestCase):
    @patch("app.activity_routes._styfi_recent_activity")
    @patch("app.activity_routes._styfi_latest_component_split")
    @patch("app.activity_routes._styfi_epoch_series")
    @patch("app.activity_routes._styfi_snapshot_series")
    @patch("app.activity_routes._styfi_last_run", return_value=None)
    @patch(
        "app.activity_routes._styfi_summary_snapshot",
        return_value={
            "latest_snapshot_at": None,
            "snapshots_count": 0,
            "first_snapshot_at": None,
            "reward_epoch": None,
        },
    )
    @patch("app.activity_routes._styfi_current_reward_state", return_value={})
    @patch("app.activity_routes._styfi_reward_token", return_value={"decimals": 18})
    @patch("app.activity_routes.psycopg.connect", return_value=FakeConnection())
    def test_summary_mode_skips_all_history_queries(
        self,
        _connect: object,
        _reward_token: object,
        _reward_state: object,
        _summary: object,
        _last_run: object,
        snapshot_series: object,
        epoch_series: object,
        component_split: object,
        recent_activity: object,
    ) -> None:
        response = styfi(days=30, epoch_limit=12, include_history=False)

        self.assertEqual(response["filters"]["include_history"], False)  # type: ignore[index]
        self.assertEqual(response["series"], {"snapshots": [], "epochs": []})
        self.assertEqual(response["component_split_latest_completed"], {"epoch": None, "rows": []})
        self.assertEqual(response["recent_activity"], [])
        for history_query in (snapshot_series, epoch_series, component_split, recent_activity):
            history_query.assert_not_called()  # type: ignore[attr-defined]


if __name__ == "__main__":
    unittest.main()
