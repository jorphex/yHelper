# yHelper

yHelper is a public Yearn analytics dashboard.

It is built to answer a few simple questions fast:
- where yield is moving
- which vaults or assets are crowded
- how chains and categories compare
- whether the data is fresh enough to trust

## Pages
- `Overview` for the high-level snapshot
- `Discover` for vault scanning and ranking
- `Assets` for token and venue comparison
- `Composition` for concentration and crowding
- `Changes` for recent movers and stale data checks
- `Regimes` for behavior classes and transitions
- `Chains` for chain-level rollups

## Data
The app combines:
- Yearn yDaemon metadata and snapshots
- Kong PPS history and derived yield metrics
- optional DefiLlama context for protocol-level TVL comparisons

## Stack
- `web` is the Next.js frontend
- `api` serves dashboard endpoints
- `worker` ingests and refreshes data
- `postgres` stores snapshots, PPS history, and derived metrics

## Run locally
1. Copy `.env.example` to `.env`
2. Start the stack:

```bash
docker compose up --build
```

3. Open `http://localhost:3010`

## Useful commands
Lint the frontend:

```bash
npm --prefix web run lint
```

Rebuild the web app only:

```bash
docker compose up -d --build yhelper-web
```

Run the smoke check:

```bash
python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:3010
```

Render the landing-page Blender assets:

```bash
blender --background --python scripts/generate_yearn_blender_assets.py -- \
  --output-dir web/public/home-assets-yearn-blender \
  --scenes hero,purpose,divider
```

## Scope
- public dashboard only
- no wallet tracking
- no connect flow
- no exports unless explicitly added
