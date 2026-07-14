# yHelper

yHelper is a public Yearn analytics dashboard.

It is built to answer a few simple questions fast:
- where yield is moving
- where Yearn vault TVL is concentrated
- how vaults sharing an exact token symbol compare

## Navigation
- `Overview` is the landing page with Yearn website TVL, weekly realized-yield movers, market direction, and direct links into the main workflows.
- `Explore` is the scanning surface.
  - `Vaults` ranks the selected vault set with market, chain, and sort controls.
  - `Asset comparison` compares exact-symbol assets across tracked Yearn vaults without silently merging wrapped or aliased assets.
  - `Market structure` shows tracked TVL by chain, market cohort, and token.
- `Momentum` is the change-detection surface.
  - `Changes` compares realized APY over `24h`, `7d`, or `30d` with the immediately preceding equal-length window, then shows breadth, movers, and fixed 60-day context.
- `Reports` is the vault-accounting surface for recent `StrategyReported` gains, losses, fees, refunds, and debt updates.
- `stYFI` is the governance staking page with combined stake balances, supply share, snapshot freshness, reward split, and epoch history.

## Data
The app combines:
- Kong REST vault catalog snapshots
- Kong GraphQL PPS history and derived yield metrics
- DefiLlama parent and component snapshots used for Yearn website TVL parity

TVL is deliberately separated into three scopes: reported protocol TVL, Kong catalog product TVLs, and the existing analytics-page universe. Kong product TVLs can overlap, so their gross sums are exposed only as catalog or coverage context and are never substituted for protocol TVL.

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
