# yHelper

Public Yearn analytics scaffold (Phase 0).

## Scope
- No wallet connect / no EOA input.
- Public protocol-level dashboards.
- Isolated deployment model (do not modify Nextcloud stack/routes).

## Current status
- `web/`: Next.js shell with API status card.
- `api/`: FastAPI service with health and ingestion overview endpoint.
- `worker/`: yDaemon snapshot ingestion + Kong PPS ingestion + initial metrics + stale-ingestion alert checks.
- `docker-compose.yml`: isolated `yhelper-*` services and network.
- `infra/`: yHelper-only Caddy and Cloudflare Tunnel config examples.
- Optional external context: DefiLlama protocol TVL snapshot for high-level confluence checks.
- API guardrails: APY and momentum are bounded (`API_APY_MIN`/`API_APY_MAX`, `API_MOMENTUM_ABS_MAX`) to reduce outlier distortion.

## API endpoints (current)
- `GET /health`
- `GET /api/meta/freshness`
- `GET /api/meta/coverage`
- `GET /api/meta/protocol-context`
- `GET /api/meta/movers`
- `GET /api/overview`
- `GET /api/discover`
- `GET /api/assets`
- `GET /api/assets/{token_symbol}/venues`
- `GET /api/composition`
- `GET /api/changes`
- `GET /api/regimes`
- `GET /api/chains/rollups`

## Quick start
1. Copy `.env.example` to `.env` and set values.
2. Run:
   - `docker compose up --build`
3. Open:
   - `http://localhost:3010`
4. Verify API:
   - `http://localhost:3010/api/overview`

## Alerting (optional)
- Worker evaluates stale ingestion for `ydaemon_snapshot` and `kong_pps_metrics`.
- Alert state is persisted in Postgres (`alert_state`) and returned in `GET /api/meta/freshness` and `GET /api/overview`.
- Configure channels via env:
  - `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`
  - `ALERT_DISCORD_WEBHOOK_URL`
  - `ALERT_STALE_SECONDS` and `ALERT_COOLDOWN_SECONDS`
  - `RUNNING_STALE_SECONDS` (auto-mark old `running` rows as `abandoned` after restarts)

## Isolation safety
- Service names, network, and volume use `yhelper-*` naming.
- Keep `infra/Caddyfile.yhelper` as a separate include block.
- Do not edit existing Nextcloud compose files, volumes, or routes.
