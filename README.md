# yHelper

yHelper is a public Yearn analytics dashboard for inspecting yield changes, vault coverage, accounting reports, yLocker rewards, and stYFI participation. It does not provide recommendations.

## Product

- **Home** (`/`): direct entries to staking, lending, and rewards, with current product context.
- **stYFI** (`/styfi`): rewards and participation, with explanations and visible component, activity, and epoch history.
- **Flex** (`/flex`): lending rates, borrowing capacity, market terms, and position health.
- **Rewards & reports** (`/reports`): searchable vault accounting; `/reports?view=lockers` opens yCRV and yYB reward history.
- **Vault research** (`/markets`): searchable vault comparison, with deeper yield changes and composition views.

`/momentum` redirects to `/markets?view=changes`, and `/harvests` redirects to `/reports`. Legacy `/explore` and `/structure` entry points remain compatible.

## Data and scope

The worker refreshes a PostgreSQL store from:

- Yearn Kong REST catalog snapshots and GraphQL PPS history
- DefiLlama Yearn parent and component TVL snapshots
- configured chain RPC or WebSocket sources for activity, reports, yLocker reward history, and optional stYFI synchronization

yLocker history follows deposits from Yearn's designated distributors to yCRV and yYB. Values use the crvUSD value at the time of each deposit.

TVL has distinct meanings in the product. DefiLlama parent TVL is used for Yearn website parity; Kong vault TVL is product-catalog context and may overlap; filtered analytics TVL describes only the selected vault set. These figures are not interchangeable.

Vault analytics use a maintained Yearn-focused universe.

## Architecture

Docker Compose runs four services:

| Service | Responsibility |
| --- | --- |
| `yhelper-postgres` | Persistent application data |
| `yhelper-api` | FastAPI read API and health endpoint |
| `yhelper-worker` | Ingestion, derived metrics, retention, and optional notifications |
| `yhelper-web` | Next.js dashboard and same-origin API proxy |

The web service defaults to port `3010` and proxies `/api/*` and `/health` to the API when `NEXT_PUBLIC_API_BASE_URL=/api`. PostgreSQL and the API bind to loopback; the worker uses host networking for local chain endpoints.

Public ingress is managed outside this Compose project: a shared edge serves the web app, and Tailscale exposes the private API.

## Run locally

1. Create local configuration:

   ```bash
   cp .env.example .env
   ```

2. Review `.env` and add only the source or alert settings needed for your environment. Keep secrets in `.env`.

3. Build and start the stack:

   ```bash
   docker compose up --build
   ```

4. Open http://localhost:3010. The API health endpoint is http://127.0.0.1:8000/health.

stYFI synchronization is disabled in the example configuration.

## API

The web app consumes the API under `/api`. The key endpoints are:

- `GET /health`
- `GET /api/overview-pulse`
- `GET /api/changes`, `GET /api/discover`, and `GET /api/composition`
- `GET /api/reports`, `GET /api/ylockers/rewards`, and `GET /api/styfi`
- `GET /api/meta/status`, `GET /api/meta/freshness`, `GET /api/meta/coverage`, and `GET /api/meta/protocol-context`

For complete contracts, inspect `/openapi.json` on a directly exposed API instance.

## Development and verification

Frontend checks:

```bash
npm --prefix web run lint
npm --prefix web run build
```

Browser regression checks against a running preview (default `http://127.0.0.1:3020`):

```bash
YHELPER_TEST_URL=http://127.0.0.1:3020 npm --prefix web run test:ui
```

These cover product navigation during source failures, vault search across API pages, exact report accounting, visible sections, responsive layouts, and keyboard controls. Start a local frontend preview with `YHELPER_API_PROXY_TARGET=http://127.0.0.1:8000 npm --prefix web run dev -- --port 3020`.

Python tests, with service dependencies installed:

```bash
pytest api/tests worker/tests
```

Smoke-test a running web deployment:

```bash
python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:3010
```

Rebuild only the web service:

```bash
docker compose up -d --build yhelper-web
```

## Non-goals

- Wallet tracking or wallet connection
- Portfolio exports
- Investment advice or automated allocation
