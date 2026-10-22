# Generated data

Only this guide and `medians.json` are included in Git. Wallet outputs, upstream caches, private preview records and verification evidence stay local. `recap-*.json` files are dated snapshots, not current API truth; regenerate with `uv run python tools/recap.py ADDRESS --out data` when investigating behavior.

The served sample is `site/assets/sample-recap.json`; the transfer fixture lives under `tests/fixtures/`. `medians.json` is the versioned aggregate cohort snapshot. `cache/` contains reconstructable upstream data with periodic pruning. Checks create their own output under `verification/`; run `tests/verify_accounting.py` before browser checks that consume its generated fixtures. None of these local outputs are shipped by Docker.
