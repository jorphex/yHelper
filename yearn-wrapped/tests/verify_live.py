"""Verify real wallets against the running local service; save repeatable artifacts."""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = json.loads((ROOT / "site/assets/sample-recap.json").read_text())["address"]
VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
EMPTY = "0x6ee158c4234b9b01b4cf0f673ff601c9b692845d"


def differences(before, after, path=""):
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        if set(before) != set(after):
            result.append(
                {
                    "path": path,
                    "sample_keys": sorted(before),
                    "live_keys": sorted(after),
                }
            )
        for key in sorted(set(before) & set(after)):
            result.extend(differences(before[key], after[key], f"{path}.{key}"))
        return result
    if before == after:
        return []
    if isinstance(before, list) or isinstance(after, list):
        return [{"path": path, "sample_items": len(before), "live_items": len(after)}]
    return [{"path": path, "sample": before, "live": after}]


def main():
    output = ROOT / "data/verification/live"
    output.mkdir(parents=True, exist_ok=True)
    base = os.getenv("YEARN_WRAPPED_TEST_URL", "http://127.0.0.1:8767")
    with httpx.Client(base_url=base, timeout=240) as client:
        started = time.monotonic()
        sample = client.get("api/recap", params={"address": SAMPLE})
        elapsed = time.monotonic() - started
        assert sample.status_code == 200, sample.text
        payload = sample.json()
        assert payload["address"].lower() == SAMPLE.lower() and payload["version"] == 1
        original = json.loads((ROOT / "site/assets/sample-recap.json").read_text())
        assert set(original) == set(payload)
        assert set(original["cards"]) == set(payload["cards"])
        comparison = differences(original, payload)
        # Current-year counts/values may advance after the original sample was captured.
        (output / "sample-response.json").write_bytes(sample.content)
        (output / "sample-comparison.json").write_text(
            json.dumps(comparison, indent=2) + "\n"
        )
        started = time.monotonic()
        repeat = client.get(
            "api/recap", params={"address": SAMPLE.lower(), "year": 2026}
        )
        repeat_elapsed = time.monotonic() - started
        assert repeat.status_code == 200 and repeat.content == sample.content
        assert repeat.headers["X-Recap-Cache"] == "HIT"
        invalid = client.get("api/recap", params={"address": "vitalik.eth"})
        assert invalid.status_code == 400
        empty = client.get("api/recap", params={"address": EMPTY})
        assert empty.status_code == 404, empty.text
        vitalik = client.get("api/recap", params={"address": VITALIK})
        assert vitalik.status_code in (200, 404), vitalik.text
        if vitalik.status_code == 200:
            assert vitalik.json()["cards"]["firstActivity"]["firstTs"] is not None
        (output / "vitalik-response.json").write_bytes(vitalik.content)
        result = {
            "passed": True,
            "checked_at": datetime.now(UTC).isoformat(),
            "base_url": base,
            "sample_status": sample.status_code,
            "sample_cache": sample.headers["X-Recap-Cache"],
            "sample_seconds": elapsed,
            "repeat_cache": repeat.headers["X-Recap-Cache"],
            "repeat_seconds": repeat_elapsed,
            "invalid_address_status": invalid.status_code,
            "empty_wallet_status": empty.status_code,
            "vitalik_status": vitalik.status_code,
            "sample_comparison": comparison,
        }
        (output / "api-result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
