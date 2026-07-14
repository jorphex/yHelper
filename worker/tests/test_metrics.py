from __future__ import annotations

import unittest

from worker.kong import _compute_metrics


class MetricComputationTests(unittest.TestCase):
    def test_worker_only_computes_metrics_consumed_by_the_api(self) -> None:
        day = 86_400
        points = [(index * day, 1.0 + index * 0.001) for index in range(100)]

        metrics = _compute_metrics(1, "0xvault", points)

        self.assertIsNotNone(metrics)
        assert metrics is not None
        self.assertEqual(
            set(metrics),
            {
                "vault_address",
                "chain_id",
                "as_of",
                "points_count",
                "last_point_time",
                "apy_7d",
                "apy_30d",
                "apy_90d",
                "momentum_7d_30d",
            },
        )
        self.assertIsNotNone(metrics["apy_7d"])
        self.assertIsNotNone(metrics["apy_30d"])
