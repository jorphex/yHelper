#!/usr/bin/env python3
"""Post-deploy smoke checks for yHelper web + API surfaces."""

from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def request_status(url: str, timeout: float) -> tuple[int | None, str | None]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:  # nosec B310 - internal health check utility
            return response.status, None
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception as exc:  # pragma: no cover - network failures vary by environment
        return None, str(exc)


def join_url(base: str, path: str) -> str:
    return urllib.parse.urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def check_with_retries(url: str, timeout: float, retries: int, retry_delay: float) -> tuple[int | None, str | None]:
    last_code: int | None = None
    last_err: str | None = None
    for attempt in range(retries + 1):
        code, err = request_status(url, timeout)
        if code is not None:
            last_code = code
        if err is not None:
            last_err = err
        if code is not None and code < 500:
            return code, None
        if attempt < retries:
            time.sleep(retry_delay)
    return last_code, last_err


def run_checks(base_url: str, timeout: float, retries: int, retry_delay: float, allow_status: set[int]) -> int:
    routes = ["/", "/styfi", "/discover", "/assets", "/composition", "/changes", "/regimes", "/chains"]
    apis = [
        "/api/overview",
        "/api/meta/freshness?threshold=24h",
        "/api/meta/coverage?min_tvl_usd=100000&min_points=30&split_limit=8",
        "/api/meta/protocol-context",
        "/api/meta/movers?window=7d&limit=5&min_tvl_usd=100000&min_points=30",
        "/api/meta/social-preview",
        "/api/styfi",
        "/api/discover?limit=1",
        "/api/regimes?limit=5",
        "/api/regimes/transitions?limit=4",
        "/api/regimes/transitions/daily?days=30&group_by=none",
        "/api/chains/rollups",
        "/api/trends/daily?days=30&group_by=none",
        "/api/assets?limit=5",
        "/api/assets/USDC/venues?limit=5",
        "/api/composition?top_n=6&crowding_limit=10",
        "/api/changes?window=7d&limit=5",
    ]

    failures = 0
    print(f"Base URL: {base_url}")
    print("Checking routes:")
    for path in routes:
        url = join_url(base_url, path)
        code, err = check_with_retries(url, timeout, retries, retry_delay)
        if code in allow_status:
            print(f"  PASS {path} -> {code}")
        else:
            failures += 1
            detail = err or str(code)
            print(f"  FAIL {path} -> {detail}")

    print("Checking API endpoints:")
    for path in apis:
        url = join_url(base_url, path)
        code, err = check_with_retries(url, timeout, retries, retry_delay)
        if code in allow_status:
            print(f"  PASS {path} -> {code}")
        else:
            failures += 1
            detail = err or str(code)
            print(f"  FAIL {path} -> {detail}")

    if failures:
        print(f"Smoke check failed: {failures} check(s) failed.")
        return 1

    print("Smoke check passed: all checks returned HTTP 200.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="yHelper post-deploy smoke check")
    default_base = os.environ.get("YHELPER_BASE_URL", f"http://127.0.0.1:{os.environ.get('WEB_PORT', '3010')}")
    parser.add_argument("--base-url", default=default_base, help="Base URL to probe")
    parser.add_argument("--timeout", type=float, default=8.0, help="Per-request timeout in seconds")
    parser.add_argument("--retries", type=int, default=2, help="Retries per check on 5xx/network failures")
    parser.add_argument("--retry-delay", type=float, default=1.0, help="Delay between retries in seconds")
    parser.add_argument(
        "--allow-status",
        default="200",
        help="Comma-separated acceptable HTTP status codes (example: 200,301)",
    )
    args = parser.parse_args()
    allow_status = {int(token) for token in args.allow_status.split(",") if token.strip()}
    return run_checks(args.base_url, args.timeout, args.retries, args.retry_delay, allow_status)


if __name__ == "__main__":
    sys.exit(main())
