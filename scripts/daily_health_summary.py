#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


def _get_json(url: str, timeout: float) -> dict[str, Any]:
    with urlopen(url, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


def _to_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="yHelper daily health summary")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="yhelper API base URL")
    parser.add_argument("--timeout", type=float, default=8.0, help="HTTP timeout seconds")
    parser.add_argument(
        "--max-pps-stale-ratio",
        type=float,
        default=0.20,
        help="Fail if PPS stale ratio exceeds this value",
    )
    parser.add_argument(
        "--grace-seconds",
        type=int,
        default=7200,
        help="Extra seconds allowed over worker interval for last-success checks",
    )
    args = parser.parse_args()

    overview_url = args.base_url.rstrip("/") + "/api/overview"
    freshness_url = args.base_url.rstrip("/") + "/api/meta/freshness?threshold=24h"

    try:
        overview = _get_json(overview_url, args.timeout)
        freshness = _get_json(freshness_url, args.timeout)
    except (TimeoutError, URLError, json.JSONDecodeError) as exc:
        print(f"FAIL api_unreachable error={exc}")
        return 1

    worker_interval = _to_int((overview.get("data_policy") or {}).get("worker_interval_sec")) or 0
    allowed_success_age = max(worker_interval + args.grace_seconds, args.grace_seconds)

    alerts = freshness.get("alerts") or {}
    firing_alerts = [name for name, alert in alerts.items() if isinstance(alert, dict) and alert.get("is_firing")]

    jobs = freshness.get("ingestion_jobs") or {}
    snapshot_age = _to_int((jobs.get("kong_vault_snapshot") or {}).get("last_success_age_seconds"))
    kong_age = _to_int((jobs.get("kong_pps_metrics") or {}).get("last_success_age_seconds"))

    stale_ratio = freshness.get("pps_stale_ratio")
    stale_ratio_value = float(stale_ratio) if isinstance(stale_ratio, (int, float)) else None

    checks: list[tuple[str, bool, str]] = [
        ("firing_alerts", len(firing_alerts) == 0, f"count={len(firing_alerts)} names={firing_alerts}"),
        (
            "kong_snapshot_last_success_age",
            snapshot_age is not None and snapshot_age <= allowed_success_age,
            f"value={snapshot_age} allowed={allowed_success_age}",
        ),
        (
            "kong_last_success_age",
            kong_age is not None and kong_age <= allowed_success_age,
            f"value={kong_age} allowed={allowed_success_age}",
        ),
        (
            "pps_stale_ratio",
            stale_ratio_value is not None and stale_ratio_value <= args.max_pps_stale_ratio,
            f"value={stale_ratio_value} allowed={args.max_pps_stale_ratio}",
        ),
    ]

    failed = [name for name, ok, _ in checks if not ok]
    status = "PASS" if not failed else "FAIL"

    report = {
        "status": status,
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "base_url": args.base_url,
        "worker_interval_sec": worker_interval,
        "allowed_success_age_sec": allowed_success_age,
        "checks": [{"name": name, "ok": ok, "detail": detail} for name, ok, detail in checks],
    }
    print(json.dumps(report, separators=(",", ":")))

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
