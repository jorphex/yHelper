# yHelper

yHelper is a public Yearn analytics dashboard for inspecting yield changes, vault coverage, accounting reports, yLocker rewards, and stYFI participation. It does not provide recommendations.

## Product

- **Home** (`/`): direct entries to staking, lending, and rewards, with current product context.
- **stYFI** (`/styfi`): rewards and participation, with explanations and visible component, activity, and epoch history.
- **Flex** (`/flex`): lending rates, borrowing capacity, position health, and borrower/lender performance.
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
- `GET /api/flex/performance` (7/30/90-day performance; optional Ethereum `address`)
- `GET /api/meta/status`, `GET /api/meta/freshness`, `GET /api/meta/coverage`, and `GET /api/meta/protocol-context`

For complete contracts, inspect `/openapi.json` on a directly exposed API instance.

## Flex performance

The Flex performance overview covers active markets. An optional read-only address lookup covers that address's troves and direct lender shares across indexed markets. Account lookups do not create stored portfolio records or connect a wallet. Figures use the common indexed block, with explicit dates and source freshness.

Borrower P&L is the change in collateral value minus accrued debt, adjusted for collateral funding, borrowing proceeds, repayments and closing withdrawals. It includes capitalized fees, debt interest, redemptions and liquidations. The UI labels it **Trove P&L · USD**: borrowing uses nominal principal and excludes auction funding premiums/shortfalls, which require separate settlement reconciliation. Lender P&L uses reported ERC-4626 value adjusted for deposits/withdrawals; address views also value incoming/outgoing shares as funding, including transfers between wallets. Pool totals include fee-recipient shares and are not a net return for one lender.

These are USD position returns. They exclude gas, swap execution costs, assets outside Flex and unreported lender interest. Received shares start at their period transfer value, not the sender's cost basis. Older borrower versions, missing/unreconciled history, invalid oracle prices and auction withdrawals whose proceeds are not represented by ERC-4626 events remain incomplete; their totals are unavailable, not a partial sum presented as complete.

Performance and Market detail have independent controls. The `pnl_days` URL parameter selects the P&L window; `days` selects market history. Both accept 7/30/90 days and default to 30. The P&L market filter only filters performance rows; the market tabs select the terms, health, capacity and history below them.

The API needs an archive Ethereum RPC: Compose uses `ETH_RPC_URL`, or `FLEX_PERFORMANCE_RPC_URL` as an override. RPC credentials remain server-side. Reads have a 60-second/1,200-call budget, batched archive requests, two concurrent builds and a bounded five-minute in-memory cache (one minute for incomplete results). Run one API worker to share these limits. No new worker ingestion or production schema migration is required. Contract accounting follows the [official trove manager](https://github.com/flexmeow/flex-contracts/blob/master/src/trove_manager.vy) and [lender](https://github.com/flexmeow/flex-contracts/blob/master/src/lender/Lender.sol).

Run the independent HTTP/PostgreSQL/archive-RPC scenarios before the browser checks:

```bash
uv run --no-project --python 3.12 --with-requirements api/requirements.txt --with httpx python api/tests/e2e_flex_performance.py
YHELPER_TEST_URL=http://127.0.0.1:3020 npm --prefix web run test:ui -- flex-performance.spec.ts --trace on
```

The API check uses `FLEX_TEST_DATABASE_URL` (or local `.env` connection settings), creates and removes an isolated schema, and writes cases/results under ignored `reports/flex-performance/`. It never changes production tables. Browser checks consume these generated cases and save desktop/mobile screenshots plus traces. The remaining UI suite can run independently of these generated fixtures.

Rate ingestion and display checks use the same isolated database approach:

```bash
uv run --no-project --python 3.12 --with-requirements api/requirements.txt --with-requirements worker/requirements.txt --with httpx python api/tests/e2e_rates.py
YHELPER_TEST_URL=http://127.0.0.1:3020 npm --prefix web run test:ui -- rates.spec.ts --trace on
```

These cover verified staking ranges and Vote Boost, unavailable sources, net vault estimates and locked-vault accounting. API evidence is written to ignored `reports/rate-fixes/api-results.json`; browser checks skip until it exists and produce screenshots and traces.

## Development and verification

Worker recovery and diagnostic privacy checks use real local HTTP/WebSocket services, an isolated PostgreSQL schema and a worker subprocess. Outbound notifications are disabled:

```bash
uv run --no-project --python 3.12 --with-requirements worker/requirements.txt --with-requirements api/requirements.txt --with httpx python worker/tests/e2e_resilience.py
```

Results and service logs are saved under ignored `reports/worker-resilience-fix/`. These checks cover repeated upstream failures, SQL timeout recovery, concurrent and stale heartbeats, reconnects after real closes, RPC/Telegram credential redaction and public responses containing legacy errors.

Networking recovery checks use the same dependencies:

```bash
uv run --no-project --python 3.12 --with-requirements worker/requirements.txt --with-requirements api/requirements.txt --with httpx python worker/tests/e2e_networking.py
```

Evidence is saved under `reports/network-resilience-fix/`. These checks cover contiguous harvest catchup, SQL failure recovery and deadlines, subscription acknowledgement deadlines, throttling and API responsiveness under duplicate slow archive requests. Browser cancellation/deadline checks are in `web/tests/network-resilience.spec.ts` and produce screenshots and traces.

Absolute transfer deadlines and archive-slot recovery have a separate HTTP/TLS check:

```bash
uv run --no-project --python 3.12 --with-requirements worker/requirements.txt --with-requirements api/requirements.txt python worker/tests/e2e_http_deadlines.py
```

It uses a fake local CA and disposable PostgreSQL schema; results are in `reports/http-deadline-fix/`. The transport cancels overdue header/body reads, closes the stream and reuses per-thread keepalive pools. Decoded responses are capped at 64 MiB in the worker and 4 MiB for archive reads. Notifications keep their existing transport and retry policy.

Application DB connections default to a 5-second connection timeout. API/worker statement budgets are 15/60 seconds, lock budgets 2/5 seconds, and idle transaction budgets 90/300 seconds. Compose exposes `DB_CONNECT_TIMEOUT_SEC` and separate `API_DB_*` / `WORKER_DB_*` settings for `STATEMENT_TIMEOUT_MS`, `LOCK_TIMEOUT_MS` and `IDLE_TRANSACTION_TIMEOUT_MS`. Direct application processes use the corresponding `DB_*` names. Values must be positive; existing DSN search-path options are preserved.

Read-only worker HTTP/RPC calls use at most three attempts within a 65-second retry budget, honor server retry delays up to that budget, and use jitter. Exhausted transport/throttling errors do not trigger smaller log-window retries or transaction fan-out. Notification delivery keeps its existing persisted retry policy. Harvest catchup resumes from its contiguous cursor with a bounded overlap and checkpoints completed windows; WebSocket observations never advance that cursor. Archive calculations use two dedicated threads with asynchronous shared-result waits. Browser data requests have a 25-second deadline (75 seconds for archive performance), and leaving a screen cancels inactive work.

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

- Wallet signing, transactions, or stored portfolio tracking
- Portfolio exports
- Investment advice or automated allocation
