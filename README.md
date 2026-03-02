# yHelper

yHelper is a public Yearn dashboard focused on protocol-level insight, not wallet tracking.

It helps users compare:
- where yield is rising or falling
- where TVL is concentrated
- how stable or volatile vault behavior has been
- how chains, tokens, and categories differ over time

## What It Includes
- `Overview`: protocol snapshot and guardrails
- `Discover`: vault scanner by APY, momentum, consistency, and regime
- `Assets`: venue comparison for the same underlying token
- `Composition`: concentration and crowding across chains/categories/tokens
- `Changes`: top risers, fallers, and freshness-aware deltas
- `Regimes`: behavior classes and transition trends
- `Chains`: chain-level weighted rollups

## Data Sources
- Yearn yDaemon metadata/snapshots
- Kong PPS history and derived yield metrics
- Optional DefiLlama context for protocol-level confluence

## Run Locally
1. Copy `.env.example` to `.env`
2. Start services:
```bash
docker compose up --build
```
3. Open:
- `http://localhost:3010`

## Verification
Run after deploy/restart:
```bash
npm --prefix web run lint
docker compose up -d --build yhelper-web
python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:3010
```

## Home Asset Rendering
Render the landing page Blender assets with deterministic names and sizes:
```bash
blender --background --python scripts/generate_yearn_blender_assets.py -- \
  --output-dir web/public/home-assets-yearn-blender \
  --scenes hero,purpose,divider
```

Useful flags:
- `--logo-png` override logo source directly (defaults to `web/public/yearn-symbol-white-rgb.png`).
- `--scenes` render a subset (for example `hero` or `hero,divider`).

## Scope
- Public dashboards only
- No wallet connect / EOA input flow
- No support/docs workflows
- No export features unless explicitly requested
