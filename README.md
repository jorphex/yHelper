# yHelper

yHelper is a public Yearn analytics dashboard.

It is built to answer a few simple questions fast:
- where yield is moving
- how vault concentration and crowding are changing
- how chains, tokens, and categories compare

## Navigation
- `Overview` is the landing page with the current protocol snapshot, PPS freshness, latest shift, highest-yield vault, and direct links into the main workflows.
- `Explore` is the scanning surface.
  - `Vaults` ranks the current vault universe with filters for universe, TVL, points, chain, category, and sort mode, plus APY/momentum visuals.
  - `Venues` compares token venues across vaults, with token selection, token list scope (`featured`, `canonical`, `all`), and venue spread views.
- `Structure` is the concentration surface.
  - `Overview` shows concentration KPIs, the TVL treemap, and category/token breakdown tables.
  - `Chains` compares chain-level rollups including active vaults, metrics coverage, TVL, APY, momentum, and consistency.
  - `Crowding` ranks the most and least crowded vaults and plots crowding against APY/TVL.
- `Momentum` is the change-detection surface.
  - `Changes` tracks APY deltas by window (`24h`, `7d`, `30d`), freshness/coverage, movers, stale series, and grouped momentum trends.
  - `Regimes` tracks rising/stable/falling/choppy cohorts, current regime movers, and transition analysis over configurable windows.
- `stYFI` is the governance staking page with combined stake balances, supply share, snapshot freshness, reward split, and epoch history.

## Data
The app combines:
- Yearn yDaemon metadata and snapshots
- Kong PPS history and derived yield metrics

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
