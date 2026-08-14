from __future__ import annotations

import os

import psycopg


def _parse_origins(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://yhelper:change_me@yhelper-postgres:5432/yhelper")
# Permanent bounds to keep analytics behavior stable across deploys.
APY_MIN = -0.95
APY_MAX = 3.0
MOMENTUM_ABS_MAX = 1.0
USER_VISIBLE_KIND = "Multi Strategy"
USER_VISIBLE_VERSION_PREFIX = "3."
EXCLUDED_CHAIN_IDS = (250,)  # Fantom deprecated
CHAIN_LABELS = {
    1: "Ethereum",
    10: "Optimism",
    100: "Gnosis",
    137: "Polygon",
    146: "Sonic",
    8453: "Base",
    42161: "Arbitrum",
    747474: "Katana",
}
DEFAULT_MIN_TVL_USD = 100000.0
DEFAULT_MIN_POINTS = 30
UNIVERSE_CORE_MIN_TVL_USD = 1000000.0
UNIVERSE_EXTENDED_MIN_TVL_USD = 250000.0
UNIVERSE_RAW_MIN_TVL_USD = 0.0
UNIVERSE_CORE_MIN_POINTS = 45
UNIVERSE_EXTENDED_MIN_POINTS = 20
UNIVERSE_RAW_MIN_POINTS = 0
UNIVERSE_CORE_MAX_VAULTS = 250
UNIVERSE_EXTENDED_MAX_VAULTS = 700
UNIVERSE_RAW_MAX_VAULTS = 0
WORKER_INTERVAL_SEC = int(os.getenv("WORKER_INTERVAL_SEC", "21600"))
PPS_RETENTION_DAYS = int(os.getenv("PPS_RETENTION_DAYS", "180"))
INGESTION_RUN_RETENTION_DAYS = int(os.getenv("INGESTION_RUN_RETENTION_DAYS", "30"))
DB_CLEANUP_MIN_INTERVAL_SEC = int(os.getenv("DB_CLEANUP_MIN_INTERVAL_SEC", "21600"))
KONG_PPS_LOOKBACK_DAYS = int(os.getenv("KONG_PPS_LOOKBACK_DAYS", "119"))
KONG_GQL_URL = os.getenv("KONG_GQL_URL", "https://kong.yearn.fi/api/gql")
DEFI_LLAMA_PARENT_TVL_URL = os.getenv(
    "DEFI_LLAMA_PARENT_TVL_URL",
    "https://api.llama.fi/tvl/yearn",
).strip()
DEFI_LLAMA_PROTOCOLS_URL = os.getenv(
    "DEFI_LLAMA_PROTOCOLS_URL",
    "https://api.llama.fi/protocols",
).strip()
STYFI_RETENTION_DAYS = int(os.getenv("STYFI_RETENTION_DAYS", str(PPS_RETENTION_DAYS)))
STYFI_SNAPSHOT_RETENTION_DAYS = int(os.getenv("STYFI_SNAPSHOT_RETENTION_DAYS", "30"))
STYFI_EPOCH_LOOKBACK = int(os.getenv("STYFI_EPOCH_LOOKBACK", "12"))
STYFI_CHAIN_ID = int(os.getenv("STYFI_CHAIN_ID", "1"))
STYFI_TOKEN_SCALE = float(10**18)
STYFI_SITE_REWARD_SCALE = float(10**18)
STYFI_REWARD_TOKEN_DEFAULT = {"address": None, "symbol": "yvUSDC-1", "decimals": 6}
YLOCKER_PRODUCTS = {
    "ycrv": {"label": "yCRV", "distributor": "0xb226c52eb411326cdb54824a88abafdaaff16d3d"},
    "yyb": {"label": "yYB", "distributor": "0x1d02f6a86ed5650f93e40fcd62fa5727c32ad746"},
}
YLOCKER_REWARD_TOKEN = {
    "address": "0xbf319ddc2edc1eb6fdf9910e39b37be221c8805f",
    "symbol": "yvcrvUSD-2",
    "decimals": 18,
    "asset_symbol": "crvUSD",
    "asset_decimals": 18,
}
STYFI_INTERNAL_ACTIVITY_ACCOUNTS = {
    "0x42b25284e8ae427d79da78b65dffc232aaecc016",
    "0x9c42461aa8422926e3aef7b1c6e3743597149d79",
    "0x95547ede56cf74b73dd78a37f547127dffda6113",
    "0x952b31960c97e76362ac340d07d183ada15e3d6e",
    "0xa82454009e01ae697012a73cb232d85e61b05e50",
    "0xd31911a33a5577be233dc096f6f5a7e496ff5934",
    "0x2548bf65916fdabb5a5673fc4225011ff29ee884",
    "0x7efc3953bed2fc20b9f825ebffab1cc8b072a000",
}
cors_origins = _parse_origins(os.getenv("CORS_ORIGINS", "http://localhost:3010"))


def _validate_data_policy_config() -> None:
    if PPS_RETENTION_DAYS > 0 and KONG_PPS_LOOKBACK_DAYS > 0 and PPS_RETENTION_DAYS < KONG_PPS_LOOKBACK_DAYS:
        raise ValueError(
            "Invalid retention policy: PPS_RETENTION_DAYS must be >= KONG_PPS_LOOKBACK_DAYS "
            f"(got retention={PPS_RETENTION_DAYS}, lookback={KONG_PPS_LOOKBACK_DAYS})"
        )
    if STYFI_RETENTION_DAYS < 0:
        raise ValueError(
            "Invalid stYFI retention: STYFI_RETENTION_DAYS must be >= 0 "
            f"(got {STYFI_RETENTION_DAYS})"
        )
    if STYFI_SNAPSHOT_RETENTION_DAYS < 0:
        raise ValueError(
            "Invalid stYFI retention: STYFI_SNAPSHOT_RETENTION_DAYS must be >= 0 "
            f"(got {STYFI_SNAPSHOT_RETENTION_DAYS})"
        )
    if STYFI_RETENTION_DAYS > 0 and STYFI_SNAPSHOT_RETENTION_DAYS > STYFI_RETENTION_DAYS:
        raise ValueError(
            "Invalid stYFI retention: STYFI_SNAPSHOT_RETENTION_DAYS must be <= STYFI_RETENTION_DAYS "
            f"(got snapshot={STYFI_SNAPSHOT_RETENTION_DAYS}, retention={STYFI_RETENTION_DAYS})"
        )
    if STYFI_EPOCH_LOOKBACK <= 0:
        raise ValueError(
            "Invalid stYFI config: STYFI_EPOCH_LOOKBACK must be > 0 "
            f"(got {STYFI_EPOCH_LOOKBACK})"
        )
    if STYFI_CHAIN_ID <= 0:
        raise ValueError(
            "Invalid stYFI config: STYFI_CHAIN_ID must be > 0 "
            f"(got {STYFI_CHAIN_ID})"
        )


_validate_data_policy_config()


def _ensure_schema_columns() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE vault_dim ADD COLUMN IF NOT EXISTS token_decimals INTEGER")
            cur.execute("ALTER TABLE vault_dim ADD COLUMN IF NOT EXISTS origin TEXT")
            cur.execute("ALTER TABLE vault_dim ADD COLUMN IF NOT EXISTS inclusion JSONB NOT NULL DEFAULT '{}'::jsonb")
            cur.execute("ALTER TABLE vault_dim ADD COLUMN IF NOT EXISTS catalog_is_yearn BOOLEAN")
            cur.execute("ALTER TABLE vault_dim ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN")
            cur.execute("ALTER TABLE vault_dim ADD COLUMN IF NOT EXISTS is_retired BOOLEAN")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_vault_dim_catalog_scope
                    ON vault_dim(catalog_is_yearn, is_hidden, is_retired, chain_id);
                CREATE TABLE IF NOT EXISTS protocol_tvl_snapshots (
                    id BIGSERIAL PRIMARY KEY,
                    observed_at TIMESTAMPTZ NOT NULL,
                    parent_tvl_usd NUMERIC(38, 12) NOT NULL CHECK (parent_tvl_usd >= 0),
                    components_tvl_usd NUMERIC(38, 12) NOT NULL CHECK (components_tvl_usd >= 0),
                    reconciliation_residual_usd NUMERIC(38, 12) NOT NULL,
                    parent_source_url TEXT NOT NULL,
                    components_source_url TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_protocol_tvl_snapshots_observed
                    ON protocol_tvl_snapshots(observed_at DESC, id DESC);
                CREATE TABLE IF NOT EXISTS protocol_tvl_components (
                    snapshot_id BIGINT NOT NULL REFERENCES protocol_tvl_snapshots(id) ON DELETE CASCADE,
                    slug TEXT NOT NULL,
                    name TEXT NOT NULL,
                    tvl_usd NUMERIC(38, 12) NOT NULL CHECK (tvl_usd >= 0),
                    chain_tvls JSONB NOT NULL DEFAULT '{}'::jsonb,
                    PRIMARY KEY (snapshot_id, slug)
                );
                CREATE TABLE IF NOT EXISTS ylocker_reward_events (
                    chain_id INTEGER NOT NULL,
                    product TEXT NOT NULL,
                    distributor_address TEXT NOT NULL,
                    block_number BIGINT NOT NULL,
                    block_hash TEXT NOT NULL,
                    block_time TIMESTAMPTZ NOT NULL,
                    tx_hash TEXT NOT NULL,
                    log_index INTEGER NOT NULL,
                    native_week BIGINT NOT NULL,
                    cycle_start TIMESTAMPTZ NOT NULL,
                    cycle_end TIMESTAMPTZ NOT NULL,
                    depositor_address TEXT NOT NULL,
                    is_official BOOLEAN NOT NULL,
                    reward_shares_raw NUMERIC(78, 0) NOT NULL,
                    pps_raw NUMERIC(78, 0) NOT NULL,
                    reward_assets_raw NUMERIC(78, 0) NOT NULL,
                    raw_event JSONB NOT NULL DEFAULT '{}'::jsonb,
                    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (chain_id, tx_hash, log_index)
                );
                CREATE INDEX IF NOT EXISTS idx_ylocker_reward_events_cycle
                    ON ylocker_reward_events(product, native_week DESC, block_time DESC);
                CREATE INDEX IF NOT EXISTS idx_ylocker_reward_events_time
                    ON ylocker_reward_events(block_time DESC, product);
                CREATE TABLE IF NOT EXISTS ylocker_reward_sync_state (
                    product TEXT PRIMARY KEY,
                    chain_id INTEGER NOT NULL,
                    distributor_address TEXT NOT NULL,
                    cursor BIGINT,
                    observed_at TIMESTAMPTZ,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS flex_market_dim (
                    chain_id INTEGER NOT NULL,
                    market_address TEXT NOT NULL,
                    registry_address TEXT NOT NULL,
                    factory_address TEXT NOT NULL,
                    contract_version TEXT NOT NULL,
                    implementation_address TEXT NOT NULL,
                    deployment_block BIGINT NOT NULL,
                    deployment_time TIMESTAMPTZ NOT NULL,
                    deployment_tx_hash TEXT NOT NULL,
                    endorsement_status TEXT NOT NULL,
                    market_status TEXT NOT NULL,
                    lender_address TEXT NOT NULL,
                    collateral_token_address TEXT NOT NULL,
                    collateral_token_symbol TEXT NOT NULL,
                    collateral_token_decimals INTEGER NOT NULL,
                    borrow_token_address TEXT NOT NULL,
                    borrow_token_symbol TEXT NOT NULL,
                    borrow_token_decimals INTEGER NOT NULL,
                    sorted_troves_address TEXT NOT NULL,
                    dutch_desk_address TEXT NOT NULL,
                    auction_address TEXT NOT NULL,
                    price_oracle_address TEXT NOT NULL,
                    one_pct_raw NUMERIC(78, 0) NOT NULL,
                    min_debt_raw NUMERIC(78, 0),
                    safe_collateral_ratio_raw NUMERIC(78, 0),
                    minimum_collateral_ratio_raw NUMERIC(78, 0),
                    max_penalty_collateral_ratio_raw NUMERIC(78, 0),
                    min_liquidation_fee_raw NUMERIC(78, 0),
                    max_liquidation_fee_raw NUMERIC(78, 0),
                    min_annual_interest_rate_raw NUMERIC(78, 0),
                    max_annual_interest_rate_raw NUMERIC(78, 0),
                    oracle_description TEXT,
                    raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (chain_id, market_address)
                );
                ALTER TABLE flex_market_dim ADD COLUMN IF NOT EXISTS one_pct_raw NUMERIC(78, 0);
                CREATE INDEX IF NOT EXISTS idx_flex_market_status
                    ON flex_market_dim(market_status, deployment_block DESC);
                CREATE TABLE IF NOT EXISTS flex_market_snapshots (
                    chain_id INTEGER NOT NULL,
                    market_address TEXT NOT NULL,
                    sampled_hour TIMESTAMPTZ NOT NULL,
                    block_number BIGINT NOT NULL,
                    block_hash TEXT NOT NULL,
                    block_time TIMESTAMPTZ NOT NULL,
                    contract_version TEXT NOT NULL,
                    collateral_raw NUMERIC(78, 0) NOT NULL,
                    debt_raw NUMERIC(78, 0) NOT NULL,
                    weighted_debt_raw NUMERIC(78, 0) NOT NULL,
                    deposits_raw NUMERIC(78, 0) NOT NULL,
                    idle_liquidity_raw NUMERIC(78, 0) NOT NULL,
                    collateral_price_in_borrow_wad NUMERIC(78, 0) NOT NULL,
                    borrow_usd_price_raw NUMERIC(78, 0) NOT NULL,
                    borrow_usd_price_decimals INTEGER NOT NULL,
                    collateral_usd_e18 NUMERIC(78, 0) NOT NULL,
                    debt_usd_e18 NUMERIC(78, 0) NOT NULL,
                    deposits_usd_e18 NUMERIC(78, 0) NOT NULL,
                    idle_liquidity_usd_e18 NUMERIC(78, 0) NOT NULL,
                    utilization_wad NUMERIC(78, 0) NOT NULL,
                    lender_apr_wad NUMERIC(78, 0) NOT NULL,
                    avg_borrow_rate_raw NUMERIC(78, 0) NOT NULL,
                    source TEXT NOT NULL,
                    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (chain_id, market_address, sampled_hour),
                    FOREIGN KEY (chain_id, market_address)
                        REFERENCES flex_market_dim(chain_id, market_address) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_flex_snapshots_time
                    ON flex_market_snapshots(sampled_hour DESC, market_address);
                CREATE TABLE IF NOT EXISTS flex_events (
                    chain_id INTEGER NOT NULL,
                    market_address TEXT NOT NULL,
                    contract_version TEXT NOT NULL,
                    contract_address TEXT NOT NULL,
                    block_number BIGINT NOT NULL,
                    block_hash TEXT NOT NULL,
                    block_time TIMESTAMPTZ NOT NULL,
                    tx_hash TEXT NOT NULL,
                    log_index INTEGER NOT NULL,
                    event_name TEXT NOT NULL,
                    event_topic0 TEXT NOT NULL,
                    actors JSONB NOT NULL DEFAULT '{}'::jsonb,
                    amounts JSONB NOT NULL DEFAULT '{}'::jsonb,
                    raw_event JSONB NOT NULL DEFAULT '{}'::jsonb,
                    source TEXT NOT NULL,
                    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (chain_id, tx_hash, log_index),
                    FOREIGN KEY (chain_id, market_address)
                        REFERENCES flex_market_dim(chain_id, market_address) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_flex_events_time
                    ON flex_events(block_time DESC, market_address, event_name);
                CREATE TABLE IF NOT EXISTS flex_sync_state (
                    stream_name TEXT PRIMARY KEY,
                    chain_id INTEGER NOT NULL,
                    cursor BIGINT,
                    observed_at TIMESTAMPTZ,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS flex_reconciliations (
                    id BIGSERIAL PRIMARY KEY,
                    checked_at TIMESTAMPTZ NOT NULL,
                    api_block_number BIGINT,
                    api_block_time TIMESTAMPTZ,
                    rpc_block_number BIGINT NOT NULL,
                    verdict TEXT NOT NULL,
                    market_results JSONB NOT NULL DEFAULT '[]'::jsonb,
                    source_url TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_flex_reconciliations_checked
                    ON flex_reconciliations(checked_at DESC);
                CREATE TABLE IF NOT EXISTS flex_redemption_priority_current (
                    chain_id INTEGER NOT NULL,
                    market_address TEXT NOT NULL,
                    source_block_number BIGINT,
                    source_block_time TIMESTAMPTZ,
                    total_debt_raw NUMERIC(78, 0),
                    points JSONB NOT NULL DEFAULT '[]'::jsonb,
                    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    source_url TEXT NOT NULL,
                    fetched_at TIMESTAMPTZ,
                    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_error TEXT,
                    PRIMARY KEY (chain_id, market_address),
                    FOREIGN KEY (chain_id, market_address)
                        REFERENCES flex_market_dim(chain_id, market_address) ON DELETE CASCADE
                );
                """
            )
            cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_raw NUMERIC(78, 0)")
            cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_decimals INTEGER")
            cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_symbol TEXT")
        conn.commit()
