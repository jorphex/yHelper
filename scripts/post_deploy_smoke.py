#!/usr/bin/env python3
"""Post-deploy smoke checks for yHelper web + API surfaces."""

from __future__ import annotations

import argparse
import os
import sys
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


def run_checks(base_url: str, timeout: float) -> int:
    routes = ["/", "/discover", "/assets", "/composition", "/changes", "/regimes", "/chains"]
    apis = ["/api/overview", "/api/meta/freshness", "/api/discover?limit=1", "/api/changes?window=7d&limit=1"]

    failures = 0
    print(f"Base URL: {base_url}")
    print("Checking routes:")
    for path in routes:
        url = join_url(base_url, path)
        code, err = request_status(url, timeout)
        if code == 200:
            print(f"  PASS {path} -> {code}")
        else:
            failures += 1
            detail = err or str(code)
            print(f"  FAIL {path} -> {detail}")

    print("Checking API endpoints:")
    for path in apis:
        url = join_url(base_url, path)
        code, err = request_status(url, timeout)
        if code == 200:
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
    args = parser.parse_args()
    return run_checks(args.base_url, args.timeout)


if __name__ == "__main__":
    sys.exit(main())
