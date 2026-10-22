# Yearn Wrapped

A 2026 wallet recap: one landing poster, then a conditional slideshow with shareable images. `tools/recap.py` owns the version-1 payload, `tools/positions.py` owns the share ledger, and `service.py` adds HTTP, caching and concurrency limits. Keep the payload builder independent of transport. Design constraints live in [DESIGN.md](DESIGN.md).

## Run locally

Requires uv, Python 3.12 and Node.js 24/npm, matching the container build. From `yearn-wrapped/`:

```sh
uv sync --frozen
npm ci
npm run build
uv run uvicorn service:app --host 127.0.0.1 --port 8768
```

Open `http://127.0.0.1:8768/`. The service serves both `site/` and `/api/recap`; a static server alone cannot build real recaps. Port 8768 avoids the managed preview on 8767. No `.env` or private deployment record is needed for local development. Uvicorn does not load `.env` automatically; export service settings when needed.

`npm run build` generates the same-origin WalletConnect and Three.js bundles in `site/vendor/`. These files are ignored in Git, so build after pulling source or lockfile changes. Docker builds them independently. The browser only obtains recap data through this service; wallet discovery/connection and frontend ENS resolution use their own providers. Connecting supplies an address and requests no signature or transaction. The public WalletConnect project ID is in `site/main.js`; another deployment may need its own project/domain configuration.

For an offline visual sample, open `replay.html?src=assets/sample-recap.json`. To generate a real payload without HTTP:

```sh
uv run python tools/recap.py 0xdFDC17F784e16D7634AC270911D98755C68Ae220 --year 2026 --out data
```

`data/medians.json` is a versioned aggregate cohort snapshot. Other `data/` contents, dependencies, generated bundles, environment files, `AUDIT.md` and `NOTES.md` stay local. The sample under `site/assets/` and transfer fixture under `tests/fixtures/` are source fixtures, not current financial answers.

## Data contract

The payload carries `version`, `address`, `period`, `coverage` and `cards`; see `site/assets/sample-recap.json` for a complete example. Preserve field names, units, nulls and per-card `isComplete` flags. A year-to-date recap ends at build time; a completed year ends at its final second. First activity and tenure can precede the recap year.

| Source | Use |
| --- | --- |
| Yearn Envio GraphQL | Transfer events reconstruct shares. Deposit/Withdraw events supply flow counts and underlying amounts. |
| yearn.fi holdings portfolio (`timeframe=all`) | `balance.dataPoints` supplies daily USD portfolio values; `growth.vaults[].metadata` supplies token metadata. A history endpoint fallback supports responses without `balance`. Lifetime growth is not annual yield. |
| Kong daily PPS | Humanized vault price per share. |
| Kong TVL timeseries (`components=priceUsd`) | Historical underlying-asset USD prices. |
| CoinGecko ETH market chart | Wallet-independent market context; unavailable context is omitted. |

The configured indexer scope is Ethereum (1), Base (8453), Arbitrum (42161), Polygon (137) and Katana (747474). Optimism is excluded. V2 history and upstream pricing can have gaps. One address does not include a person's other wallets. These upstreams need no consumer API key in this implementation; availability and rate limits still apply.

### Ledger and money

- Identify positions by chain plus lowercase vault address; output rows retain both `chainId` and `vault`. Transfer events are the sole share-balance source, including mints/burns and received shares. Adding Deposit shares would double-count entries. Net simultaneous deltas before sampling so self-transfers do not invent exits.
- Seed opening balances from pre-year history. Positive positions count even without current-year activity. Closed holding spans end at the exit; open spans extend to the recap boundary. Deposit counts measure explicit Deposit events, not incoming transfers.
- Estimate annual vault yield by integrating held shares × daily PPS changes at contemporaneous underlying prices. This excludes pre-year gains and is estimated vault yield, not personal investment profit. Intraday flows, prices and execution can differ from daily observations.
- Use the latest PPS/price observation at or before a timestamp, rejecting observations older than two days. Missing coverage or decimals preserve unknowns and incomplete flags. Never infer asset prices from a wallet's growth ratio.
- Evaluate peak position values across balance, PPS and price changes, including immediately before exits. Rank multiple vaults only with complete comparable pricing. A single unpriced vault can be named without a monetary ranking. Received shares count toward this home-base selection.
- Withdrawal counterfactuals compare exited shares' PPS at exit and the recap boundary, valued at the boundary's underlying price. Aggregate `forgoneUsd` only when every included vault is priced; `isComplete` also requires every withdrawal to be covered. Native amounts remain per vault; aggregate `forgoneAssets` is null. This assumes the shares stayed deposited and is not personal P&L.
- Cross-asset `assetsDeposited`/`assetsWithdrawn` totals are null. Use `depositsBySymbol`/`withdrawalsBySymbol`; unknown decimals omit an amount and mark the ledger incomplete rather than inventing zero.
- `coverage.incomplete` records data gaps. Missing metadata, PPS or prices are not evidence of a vault incident. Portfolio value and its curve also require usable yearn.fi coverage; lifetime growth totals cannot repair missing annual data.

### Cards and exports

Card count depends on the data. Subjects include identity, first activity, market context, vaults, chains, home base, deposits/exits, withdrawal counterfactuals, portfolio value, annual yield, holding streaks, activity rhythm, year chapters, curves, verdict and summary. Unavailable monetary results become non-monetary states or are omitted. A failed real request never falls back to the sample.

Quips are `{text, tone}`; HTML/`face` is unsupported. The frontend validates payload structure and escapes displayed text. `?src=` accepts only `assets/sample-recap.json`, not arbitrary URLs. Copy should state facts and retain short material qualifiers, with definitions here rather than tutorial prose in the deck.

Slides and 1200×630 PNG exports share the vector logo, scene/semantic colors, final values, centered title/sticker rows, supporting stats, lists and monthly/hourly graphics. The ETH image deliberately keeps the headline, a larger labeled chart and two facts. `site/charts.js` shares chart scales and palette logic; disclose independent scales and square-root scaling where used. Capture final values/colors before asynchronous export, never an intermediate count-up. Preserve estimate, coverage and partial-year qualifiers.

Copy/save/post actions are disabled on the identity card, including a handler guard. Other exports omit the raw address, and captions link to the app base path without wallet parameters. This does not make financial details in other cards anonymous. The closing slide/image summarizes eligible estimated yield, otherwise longest hold or vault count, with actual supporting counts and date context.

## Startup and motion

The landing reveals the UI and selected background together. From the inline bootstrap, graphics have 2.5 seconds to download and render their first frame; fonts have a separate 900ms budget. A timeout chooses a permanent static background or system-font fallback, with no late background/font swap. HTML preloads the shared scene chunk and hero. WalletConnect warms after presentation; a click shares initialization and is the only action that requests accounts.

Only the symbol and its glint react to the cursor. The camera, full canvas, particles and aurora remain anchored while ambient animation continues. The landing field is deliberately subdued for text legibility. Reduced motion uses still graphics, immediate counters and no magnetic/tilt interaction.

The landing flight transitions through an opaque, subdued linear atmosphere shared by both documents. Navigation waits for its painted cover, with an 800ms fallback (260ms reduced motion). Replay consumes the one-shot session flag in its head, skips a second body entrance, and reveals after a 120ms cached-response grace period. Its independent 900ms release limit prevents a stuck cover. Cached data can reveal the completed deck directly.

Loader graphics download concurrently, but WebGL renderer preparation waits for the arrival fade to finish. A Yearn mark occupies the fixed 200px loader slot until the real 3D bounce is ready; graphics get an independent eight-second failure limit. No ring spinner, circular launch flare or opaque black loading panel. A visible loader keeps rendering through its fade, then disposes; completed data also cancels/disposes late graphics.

## HTTP and caching

`GET /api/recap?address=<0x + 40 hex>&year=2026`. Year defaults to 2026; other years return 422. ENS resolution is frontend-only. `GET /health` reports process health, not upstream availability.

| Status | Meaning |
| --- | --- |
| 200 | Version-1 payload with honest partial coverage where applicable |
| 400 | Missing/malformed address |
| 404 | No indexed history on supported chains, including pre-year history |
| 422 | Invalid/unsupported year |
| 502 | Required upstream failure, invalid result, pagination cap or expired build budget |
| 503 | Queue/capacity limit, with `Retry-After: 5` |

The in-memory payload cache uses lowercase address/year keys, 15-minute TTLs, 60-second empty-history TTLs and duplicate-request coalescing. Defaults: two concurrent builds, eight total active/queued keys, 30-second queue wait, 128 cached entries and 32 MiB of cached bodies. `X-Recap-Cache` reports MISS/HIT/COALESCED/BUSY on service results. Those responses use `Cache-Control: no-store`; validation errors and static responses need edge headers if the whole deployment must be uncached. Run one worker so these safeguards remain shared.

Each service build has a 180-second shared budget, including retries and optional work. Its slot stays occupied until the worker exits. Per-build vault series fetching uses at most four threads. Required requests retry up to three attempts with per-request timeouts up to 45 seconds; optional series/context degrade to incomplete data when possible. A consumed overall budget fails the build.

Yearn/Kong disk caches use six-hour TTLs; common market data uses a daily key and 24-hour TTL. Writes are atomic and corrupt records are misses. At most every five minutes, service builds prune generated upstream-cache files toward seven-day retention, 512 files and 128 MiB. This is periodic pruning, not a hard instantaneous disk quota. Verification evidence is separate.

Service settings use the `YEARN_WRAPPED_` prefix: `TTL`, `EMPTY_TTL`, `MAX_ENTRIES`, `MAX_BYTES`, `CONCURRENT_BUILDS`, `MAX_PENDING`, `QUEUE_TIMEOUT`, `BUILD_TIMEOUT`. Optional upstream overrides use that prefix plus `GRAPHQL_URL`, `YEARNFI_URL`, `KONG_URL`, `MARKET_URL` or `UPSTREAM_CACHE_DIR`. `ROOT_PATH` configures the proxy mount; it is not an access control.

## Verification

From this directory, with a local service on 8768 for browser checks:

```sh
uv run --with ruff ruff check --isolated --select E4,E7,E9,F service.py tools tests
uv run python tests/verify_http.py
uv run python tests/verify_accounting.py
uv run python tests/verify_deadline.py
npx playwright install chromium firefox
export YEARN_WRAPPED_TEST_URL=http://127.0.0.1:8768/
node tests/verify_fixes.cjs
node tests/a11y-check.cjs
node tests/verify_exports.cjs
node tests/verify_startup.cjs
node tests/verify_cold_startup.cjs
node tests/verify_handoff.cjs
node tests/verify_landing_motion.cjs
node tests/verify_image_actions.cjs
```

Ruff checks the explicit correctness rule set above; `--isolated` excludes personal/global settings. Broader style rules are not a clean baseline for the existing Python helpers. HTTP/accounting/deadline checks launch disposable local services and upstream fixtures. Run accounting first: it creates priced fixtures consumed by `verify_fixes.cjs` and `a11y-check.cjs`. Browser checks save repeatable JSON, screenshots and traces under ignored `data/verification/`. Playwright may require system libraries (`npx playwright install-deps` on a supported host). `tests/browser.cjs` supports `CHROMIUM_PATH` and `PLAYWRIGHT_MODULE_PATH` for existing installations.

Export checks save slide/PNG pairs; `RECAP_FIXTURE`, `EXPORT_OUTPUT` and `YEARN_WRAPPED_BROWSER=firefox` select fixtures, output and browser. Handoff checks record constrained network/CPU, delayed graphics, data timing, failures, direct entry and reduced motion. Use `HANDOFF_OUTPUT`/`HANDOFF_VARIANTS` to select output/cases; `HANDOFF_OBSERVE=1` records without assertions. The motion check freezes animation time to compare field pixels and symbol movement across cursor positions. Cold-start checks cover cold/refresh desktop and constrained mobile loads.

Optional network checks: `node tests/verify_browser.cjs` walks a real-address deck and its share actions; `node tests/verify_landing.cjs` exercises the real WalletConnect modal; `uv run python tests/verify_live.py` checks real recap transport/cache behavior using the shipped sample's wallet, not fixed yields. `node tests/verify_preview.cjs` requires `YEARN_WRAPPED_TEST_URL` set to a deployed preview with trailing slash, noindex headers and prefix routing; its live demo also depends on upstream coverage. It writes private deployment evidence under `data/preview/`. These checks need working external services.

### Regenerate brand/cohort assets

The shipped logo and contour are ready to use; rebuilding is optional. With the [official lockup SVG](https://presskit.yearn.fi/index/logo_black_background.svg) saved locally:

```sh
uv run --with fonttools --with uharfbuzz python tools/build_brand.py path/to/logo_black_background.svg
uv run --with numpy --with pillow --with scipy --with shapely --with scikit-image python tools/trace_symbol.py
uv run --with shapely --with numpy --with pillow python tools/verify_symbol_contour.py
```

The lockup builder uses the committed Aeonik Bold TTF; contour tools use the committed official symbol PNG. The contour check enforces silhouette overlap and ring density.

`uv run python tools/medians.py --sample 160` refreshes `data/medians.json` from recent depositors (45-day default window) using annual transfer-ledger metrics. It records sample size/date/window and exclusions; capped wallets are excluded. Values are active-wallet medians, not population percentiles. The builder accepts only a matching recap year and ledger version 2. Review the regenerated snapshot before including it in Git.

## Preview deployment

Sharing source in Git does not publish a route. Keep the preview unlisted until release; anyone with its URL can access it. Route and environment changes are deployment configuration, not part of the source checkout.

The multistage Docker build compiles pinned wallet/scene packages and includes runtime Python, `data/medians.json` and `site/`. Local dependency directories, tests, helper tools, caches and evidence are excluded by `.dockerignore`. Compose binds `127.0.0.1:8767`, joins the external `yhelper-net` network, and requires an existing cache directory writable by container UID 1000. On the current host, the deploying user owns that UID.

For a new deployment, create `data/cache/`, ensure the external network exists, and put `YEARN_WRAPPED_ROOT_PATH=/your-preview-prefix` in a local `.env` (no trailing slash). Then use `docker compose up -d --build`. The existing preview's local configuration stays unchanged; no deployment is needed for documentation/ignore edits.

The trusted reverse proxy must redirect `/your-preview-prefix` to its trailing-slash form, strip the prefix before forwarding to port 8767, and add `X-Robots-Tag: noindex, nofollow` plus `Cache-Control: no-store` to all preview responses. Compose assumes the shared edge; it does not install a route or those headers. Uvicorn trusts forwarded headers, so keep the service behind that trusted edge. Verify `/health`, malformed-address handling, a real recap, asset loading and return/share links through the public prefix. Noindex and an unlisted path provide no authentication.

## Source references

- [Yearn Envio](https://github.com/yearn/yearn-envio): indexed event model.
- [Yearn holdings](https://github.com/yearn/yearn.fi/tree/main/apps/yearn/src/server/lib/holdings): portfolio balances and metadata.
- [Kong timeseries](https://github.com/yearn/kong/tree/main/packages/web/app/api/rest/timeseries): PPS and historical price endpoints.
