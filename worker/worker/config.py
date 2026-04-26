from __future__ import annotations

import logging
import os

from eth_utils import keccak
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://yhelper:change_me@yhelper-postgres:5432/yhelper")
KONG_GQL_URL = os.getenv("KONG_GQL_URL", "https://kong.yearn.fi/api/gql")
KONG_REST_VAULTS_URL = os.getenv(
    "KONG_REST_VAULTS_URL",
    "https://kong.yearn.fi/api/rest/list/vaults?origin=yearn",
)
KONG_MAX_VAULTS = int(os.getenv("KONG_MAX_VAULTS", "120"))
KONG_MIN_TVL_USD = float(os.getenv("KONG_MIN_TVL_USD", "100000"))
# Keep PPS series length fixed to reduce operator-side tuning overhead.
KONG_PPS_LIMIT = 120
KONG_PPS_LOOKBACK_DAYS = int(os.getenv("KONG_PPS_LOOKBACK_DAYS", str(max(KONG_PPS_LIMIT - 1, 1))))
# Keep request cadence stable to avoid needless operator tuning.
KONG_PPS_ANCHOR_SLACK_DAYS = 3
KONG_TIMEOUT_SEC = 12
KONG_SLEEP_BETWEEN_REQ_MS = 10
PPS_RETENTION_DAYS = int(os.getenv("PPS_RETENTION_DAYS", "180"))
INGESTION_RUN_RETENTION_DAYS = int(os.getenv("INGESTION_RUN_RETENTION_DAYS", "30"))
DB_CLEANUP_MIN_INTERVAL_SEC = int(os.getenv("DB_CLEANUP_MIN_INTERVAL_SEC", "21600"))
DB_CLEANUP_ENABLED = os.getenv("DB_CLEANUP_ENABLED", "1") == "1"
ETH_RPC_URL = os.getenv("ETH_RPC_URL", "").strip()
OPTIMISM_RPC_URL = os.getenv("OPTIMISM_RPC_URL", "").strip()
POLYGON_RPC_URL = os.getenv("POLYGON_RPC_URL", "").strip()
ARBITRUM_RPC_URL = os.getenv("ARBITRUM_RPC_URL", "").strip()
BASE_RPC_URL = os.getenv("BASE_RPC_URL", "").strip()
GNOSIS_RPC_URL = os.getenv("GNOSIS_RPC_URL", "").strip()
KATANA_RPC_URL = os.getenv("KATANA_RPC_URL", "").strip()
SONIC_RPC_URL = os.getenv("SONIC_RPC_URL", "").strip()
ETH_WSS_URL = os.getenv("ETH_WSS_URL", "").strip()
OPTIMISM_WSS_URL = os.getenv("OPTIMISM_WSS_URL", "").strip()
POLYGON_WSS_URL = os.getenv("POLYGON_WSS_URL", "").strip()
ARBITRUM_WSS_URL = os.getenv("ARBITRUM_WSS_URL", "").strip()
BASE_WSS_URL = os.getenv("BASE_WSS_URL", "").strip()
GNOSIS_WSS_URL = os.getenv("GNOSIS_WSS_URL", "").strip()
KATANA_WSS_URL = os.getenv("KATANA_WSS_URL", "").strip()
SONIC_WSS_URL = os.getenv("SONIC_WSS_URL", "").strip()
STYFI_SYNC_ENABLED = os.getenv("STYFI_SYNC_ENABLED", "0") == "1"
STYFI_CHAIN_ID = int(os.getenv("STYFI_CHAIN_ID", "1"))
STYFI_RETENTION_DAYS = int(os.getenv("STYFI_RETENTION_DAYS", str(PPS_RETENTION_DAYS)))
STYFI_SNAPSHOT_RETENTION_DAYS = int(os.getenv("STYFI_SNAPSHOT_RETENTION_DAYS", "30"))
STYFI_EPOCH_LOOKBACK = int(os.getenv("STYFI_EPOCH_LOOKBACK", "12"))
STYFI_SITE_GLOBAL_DATA_URL = os.getenv("STYFI_SITE_GLOBAL_DATA_URL", "https://styfi.yearn.fi/api/global-data").strip()
STYFI_REWARD_TOKEN_DEFAULT = {"address": None, "symbol": "yvUSDC-1", "decimals": 6}
STYFI_ASSET_SYMBOL = "YFI"
STYFI_ASSET_DECIMALS = 18
STYFI_PRODUCT_SYMBOLS = {"styfi": "stYFI", "styfix": "stYFIx"}
PRODUCT_ACTIVITY_RETENTION_DAYS = int(os.getenv("PRODUCT_ACTIVITY_RETENTION_DAYS", "180"))
PRODUCT_ACTIVITY_BACKFILL_DAYS = int(os.getenv("PRODUCT_ACTIVITY_BACKFILL_DAYS", "35"))
PRODUCT_ACTIVITY_BLOCK_SPAN = int(os.getenv("PRODUCT_ACTIVITY_BLOCK_SPAN", "50000"))
PRODUCT_ACTIVITY_BLOCK_SPAN_BY_CHAIN = {100: 10000, 747474: 10000, 146: 5000}
HARVEST_RETENTION_DAYS = int(os.getenv("HARVEST_RETENTION_DAYS", "0"))
HARVEST_BACKFILL_DAYS = int(os.getenv("HARVEST_BACKFILL_DAYS", "90"))
HARVEST_BLOCK_SPAN = int(os.getenv("HARVEST_BLOCK_SPAN", "50000"))
HARVEST_BLOCK_SPAN_BY_CHAIN = {100: 10000, 747474: 10000, 146: 5000}
HARVEST_WSS_ENABLED = os.getenv("HARVEST_WSS_ENABLED", "1") == "1"
HARVEST_WSS_RECONCILE_SEC = int(os.getenv("HARVEST_WSS_RECONCILE_SEC", "3600"))
HARVEST_WSS_REPLAY_BLOCKS = int(os.getenv("HARVEST_WSS_REPLAY_BLOCKS", "128"))
HARVEST_WSS_HEARTBEAT_SEC = int(os.getenv("HARVEST_WSS_HEARTBEAT_SEC", "30"))
HARVEST_WSS_CONNECT_TIMEOUT_SEC = int(os.getenv("HARVEST_WSS_CONNECT_TIMEOUT_SEC", "20"))
HARVEST_WSS_SUBSCRIPTION_CHUNK = int(os.getenv("HARVEST_WSS_SUBSCRIPTION_CHUNK", "100"))
JOB_KONG_SNAPSHOT = "kong_vault_snapshot"
JOB_KONG_PPS = "kong_pps_metrics"
JOB_STYFI = "styfi_snapshot"
JOB_PRODUCT_DAU = "product_dau"
JOB_VAULT_HARVESTS = "vault_harvests"
ALERT_STALE_SECONDS = int(os.getenv("ALERT_STALE_SECONDS", "86400"))
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "21600"))
ALERT_NOTIFY_ON_RECOVERY = os.getenv("ALERT_NOTIFY_ON_RECOVERY", "1") == "1"
ALERT_TELEGRAM_BOT_TOKEN = os.getenv("ALERT_TELEGRAM_BOT_TOKEN", "").strip()
ALERT_TELEGRAM_CHAT_ID = os.getenv("ALERT_TELEGRAM_CHAT_ID", "").strip()
ALERT_DISCORD_WEBHOOK_URL = os.getenv("ALERT_DISCORD_WEBHOOK_URL", "").strip()
PUBLIC_SITE_URL = os.getenv("PUBLIC_SITE_URL", "https://yhelper.app").strip().rstrip("/")
DISCORD_HARVEST_WEBHOOK_ETHEREUM = os.getenv("DISCORD_HARVEST_WEBHOOK_ETHEREUM", "").strip()
DISCORD_HARVEST_WEBHOOK_BASE = os.getenv("DISCORD_HARVEST_WEBHOOK_BASE", "").strip()
DISCORD_HARVEST_WEBHOOK_ARBITRUM = os.getenv("DISCORD_HARVEST_WEBHOOK_ARBITRUM", "").strip()
DISCORD_HARVEST_WEBHOOK_OPTIMISM = os.getenv("DISCORD_HARVEST_WEBHOOK_OPTIMISM", "").strip()
DISCORD_HARVEST_WEBHOOK_KATANA = os.getenv("DISCORD_HARVEST_WEBHOOK_KATANA", "").strip()
DISCORD_HARVEST_WEBHOOK_SONIC = os.getenv("DISCORD_HARVEST_WEBHOOK_SONIC", "").strip()
DISCORD_HARVEST_WEBHOOK_POLYGON = os.getenv("DISCORD_HARVEST_WEBHOOK_POLYGON", "").strip()
DISCORD_STYFI_WEBHOOK_URL = os.getenv("DISCORD_STYFI_WEBHOOK_URL", "").strip()
DISCORD_NOTIFICATION_RETRY_LIMIT = int(os.getenv("DISCORD_NOTIFICATION_RETRY_LIMIT", "5"))
DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC = int(os.getenv("DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC", "120"))
# Running jobs older than this are automatically marked stale failed.
RUNNING_STALE_SECONDS = 1800
SNAPSHOT_MIN_ACTIVE_RATIO = float(os.getenv("SNAPSHOT_MIN_ACTIVE_RATIO", "0.9"))
SNAPSHOT_MIN_DROP_COUNT = int(os.getenv("SNAPSHOT_MIN_DROP_COUNT", "25"))

CHAIN_LABELS = {
    1: "Ethereum",
    10: "Optimism",
    137: "Polygon",
    146: "Sonic",
    8453: "Base",
    42161: "Arbitrum",
    747474: "Katana",
}
EXPLORER_BASE_URLS = {
    1: "https://etherscan.io",
    10: "https://optimistic.etherscan.io",
    137: "https://polygonscan.com",
    146: "https://sonicscan.org",
    8453: "https://basescan.org",
    42161: "https://arbiscan.io",
    747474: "https://katanascan.com",
}
HARVEST_DISCORD_DESTINATIONS = {
    1: {
        "destination_key": "harvest:ethereum",
        "username": "Ethereum Reporter",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_ETHEREUM,
        "color": 0x627EEA,
    },
    10: {
        "destination_key": "harvest:optimism",
        "username": "Optimism Reporter",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_OPTIMISM,
        "color": 0xFF0420,
    },
    137: {
        "destination_key": "harvest:polygon",
        "username": "Polygon Reporter",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_POLYGON,
        "color": 0x8247E5,
    },
    146: {
        "destination_key": "harvest:sonic",
        "username": "Sonic Reporter",
        "avatar_url": "https://www.soniclabs.com/apple-icon.png?0afb6d97a9fd9393",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_SONIC,
        "color": 0x00E5FF,
    },
    8453: {
        "destination_key": "harvest:base",
        "username": "Base Reporter",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_BASE,
        "color": 0x0052FF,
    },
    42161: {
        "destination_key": "harvest:arbitrum",
        "username": "Arbitrum Reporter",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_ARBITRUM,
        "color": 0x28A0F0,
    },
    747474: {
        "destination_key": "harvest:katana",
        "username": "Katana Reporter",
        "avatar_url": "https://katanascan.com/assets/katana/images/og-preview.jpg",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_KATANA,
        "color": 0xE0B060,
    },
}
STYFI_DISCORD_DESTINATION = {
    "destination_key": "styfi",
    "username": "stYFI",
    "avatar_url": "https://images.weserv.nl/?url=raw.githubusercontent.com/yearn/governance-apps/1236da71420b931e0efe66bcf0438dd3cb4f99fb/public/stYFI-logo.svg&output=png",
    "webhook_url": DISCORD_STYFI_WEBHOOK_URL,
    "color": 0x0657E9,
}
ETH_CALL_TIMEOUT_SEC = 20
ETH_RPC_MAX_ATTEMPTS = 3
ETH_RPC_RETRY_SLEEP_SEC = 1.0
ETH_TX_BATCH_SIZE = 50
STYFI_DECIMALS = 10**18
STYFI_EPOCH_LENGTH_SEC = 14 * 24 * 60 * 60
STYFI_STREAM_STATE = "styfi_reward_epoch"
CHAIN_RPC_URLS = {
    1: ETH_RPC_URL,
    10: OPTIMISM_RPC_URL,
    137: POLYGON_RPC_URL,
    42161: ARBITRUM_RPC_URL,
    8453: BASE_RPC_URL,
    100: GNOSIS_RPC_URL,
    747474: KATANA_RPC_URL,
    146: SONIC_RPC_URL,
}
CHAIN_WSS_URLS = {
    1: ETH_WSS_URL,
    10: OPTIMISM_WSS_URL,
    137: POLYGON_WSS_URL,
    42161: ARBITRUM_WSS_URL,
    8453: BASE_WSS_URL,
    100: GNOSIS_WSS_URL,
    747474: KATANA_WSS_URL,
    146: SONIC_WSS_URL,
}

STYFI_CONTRACTS = {
    "yfi": "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e",
    "styfi": "0x42b25284e8ae427d79da78b65dffc232aaecc016",
    "styfix": "0x9c42461aa8422926e3aef7b1c6e3743597149d79",
    "reward_distributor": "0xd31911a33a5577be233dc096f6f5a7e496ff5934",
    "styfi_reward_distributor": "0x95547ede56cf74b73dd78a37f547127dffda6113",
    "styfix_reward_distributor": "0x952b31960c97e76362ac340d07d183ada15e3d6e",
    "reward_claimer": "0xa82454009e01ae697012a73cb232d85e61b05e50",
    "veyfi_reward_distributor": "0x2548bf65916fdabb5a5673fc4225011ff29ee884",
    "liquid_locker_reward_distributor": "0x7efc3953bed2fc20b9f825ebffab1cc8b072a000",
}

EVENT_TOPIC_DEPOSIT = f"0x{keccak(text='Deposit(address,address,uint256,uint256)').hex()}"
EVENT_TOPIC_WITHDRAW = f"0x{keccak(text='Withdraw(address,address,address,uint256,uint256)').hex()}"
EVENT_TOPIC_TRANSFER = f"0x{keccak(text='Transfer(address,address,uint256)').hex()}"
EVENT_TOPIC_CLAIM = f"0x{keccak(text='Claim(address,uint256)').hex()}"
EVENT_TOPIC_STRATEGY_REPORTED_V2 = (
    f"0x{keccak(text='StrategyReported(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)').hex()}"
)
EVENT_TOPIC_STRATEGY_REPORTED_V3 = (
    f"0x{keccak(text='StrategyReported(address,uint256,uint256,uint256,uint256,uint256,uint256)').hex()}"
)
PRODUCT_ACTIVITY_TOPICS = {
    EVENT_TOPIC_DEPOSIT: "deposit",
    EVENT_TOPIC_WITHDRAW: "withdraw",
    EVENT_TOPIC_TRANSFER: "unstake",
    EVENT_TOPIC_CLAIM: "claim",
}

STYFI_EVENT_CONTRACTS = {STYFI_CONTRACTS["styfi"], STYFI_CONTRACTS["styfix"]}
STYFI_CLAIM_SOURCES = {
    STYFI_CONTRACTS["styfi_reward_distributor"]: "styfi",
    STYFI_CONTRACTS["styfix_reward_distributor"]: "styfix",
    STYFI_CONTRACTS["liquid_locker_reward_distributor"]: "liquid_locker",
    STYFI_CONTRACTS["reward_claimer"]: "generic",
}
STYFI_CLAIM_IGNORED_ACCOUNTS = {
    *STYFI_EVENT_CONTRACTS,
    *STYFI_CLAIM_SOURCES.keys(),
    STYFI_CONTRACTS["reward_distributor"],
}
STYFI_INTERNAL_ACTIVITY_ACCOUNTS = {
    *STYFI_EVENT_CONTRACTS,
    STYFI_CONTRACTS["styfi_reward_distributor"],
    STYFI_CONTRACTS["styfix_reward_distributor"],
    STYFI_CONTRACTS["reward_claimer"],
    STYFI_CONTRACTS["reward_distributor"],
    STYFI_CONTRACTS["veyfi_reward_distributor"],
    STYFI_CONTRACTS["liquid_locker_reward_distributor"],
}

KONG_PPS_QUERY = """
query Query($label: String!, $chainId: Int, $address: String, $component: String, $limit: Int, $timestamp: BigInt) {
  timeseries(label: $label, chainId: $chainId, address: $address, component: $component, limit: $limit, timestamp: $timestamp) {
    time
    value
  }
}
"""

KONG_VAULTS_SNAPSHOT_QUERY = """
query SnapshotVaults($origin: String!) {
  vaults(origin: $origin) {
    address
    chainId
    name
    symbol
    apiVersion
    category
    v3
    yearn
    origin
    erc4626
    decimals
    asset {
      chainId
      address
      symbol
      name
      decimals
    }
    meta {
      kind
      category
      isHidden
      isRetired
      isHighlighted
      migration {
        available
        target
      }
      token {
        symbol
        decimals
        displayName
        displaySymbol
        description
        category
      }
    }
    performance {
      oracle {
        apr
        apy
        netAPR
      }
      historical {
        net
        weeklyNet
        monthlyNet
        inceptionNet
      }
    }
    risk {
      riskLevel
    }
    tvl {
      close
    }
    strategies
    debts {
      strategy
      currentDebtUsd
      totalDebtUsd
    }
  }
}
"""

DDL = """
CREATE TABLE IF NOT EXISTS vault_dim (
    chain_id INTEGER NOT NULL,
    vault_address TEXT NOT NULL,
    name TEXT,
    symbol TEXT,
    category TEXT,
    kind TEXT,
    version TEXT,
    token_address TEXT,
    token_symbol TEXT,
    token_name TEXT,
    token_decimals INTEGER,
    tvl_usd DOUBLE PRECISION,
    est_apy DOUBLE PRECISION,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw JSONB NOT NULL,
    PRIMARY KEY (chain_id, vault_address)
);
CREATE INDEX IF NOT EXISTS idx_vault_dim_active_tvl
    ON vault_dim(tvl_usd DESC NULLS LAST, chain_id, vault_address)
    WHERE active = TRUE;

ALTER TABLE vault_dim
    ADD COLUMN IF NOT EXISTS token_decimals INTEGER;

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id BIGSERIAL PRIMARY KEY,
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    records INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT
);

CREATE TABLE IF NOT EXISTS pps_timeseries (
    chain_id INTEGER NOT NULL,
    vault_address TEXT NOT NULL,
    ts BIGINT NOT NULL,
    pps_raw DOUBLE PRECISION NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, vault_address, ts)
);

CREATE INDEX IF NOT EXISTS idx_pps_chain_ts ON pps_timeseries(chain_id, ts DESC);

CREATE TABLE IF NOT EXISTS vault_metrics_latest (
    chain_id INTEGER NOT NULL,
    vault_address TEXT NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    points_count INTEGER NOT NULL DEFAULT 0,
    last_point_time TIMESTAMPTZ,
    apy_7d DOUBLE PRECISION,
    apy_30d DOUBLE PRECISION,
    apy_90d DOUBLE PRECISION,
    vol_30d DOUBLE PRECISION,
    momentum_7d_30d DOUBLE PRECISION,
    consistency_score DOUBLE PRECISION,
    PRIMARY KEY (chain_id, vault_address)
);
CREATE INDEX IF NOT EXISTS idx_vault_metrics_points ON vault_metrics_latest(points_count DESC, chain_id, vault_address);

CREATE TABLE IF NOT EXISTS alert_state (
    alert_key TEXT PRIMARY KEY,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    threshold_seconds INTEGER NOT NULL,
    current_age_seconds INTEGER,
    last_success_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_fired_at TIMESTAMPTZ,
    last_recovered_at TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ,
    notify_channels TEXT[] NOT NULL DEFAULT '{}',
    last_notify_result JSONB
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    source_type TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    destination_key TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempted_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (source_type, chain_id, tx_hash, log_index, destination_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
    ON notification_deliveries(status, last_attempted_at DESC);

CREATE TABLE IF NOT EXISTS styfi_snapshots (
    chain_id INTEGER NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    reward_epoch INTEGER NOT NULL,
    yfi_total_supply_raw NUMERIC(78, 0) NOT NULL,
    styfi_total_assets_raw NUMERIC(78, 0) NOT NULL,
    styfi_total_supply_raw NUMERIC(78, 0) NOT NULL,
    styfix_total_assets_raw NUMERIC(78, 0) NOT NULL,
    styfix_total_supply_raw NUMERIC(78, 0) NOT NULL,
    liquid_lockers_staked_raw NUMERIC(78, 0) NOT NULL,
    migrated_yfi_raw NUMERIC(78, 0) NOT NULL,
    combined_staked_raw NUMERIC(78, 0) NOT NULL,
    PRIMARY KEY (chain_id, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_styfi_snapshots_chain_observed
    ON styfi_snapshots(chain_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS styfi_epoch_stats (
    chain_id INTEGER NOT NULL,
    epoch INTEGER NOT NULL,
    epoch_start TIMESTAMPTZ NOT NULL,
    reward_total_raw NUMERIC(78, 0) NOT NULL,
    reward_styfi_raw NUMERIC(78, 0) NOT NULL,
    reward_styfix_raw NUMERIC(78, 0) NOT NULL,
    reward_veyfi_raw NUMERIC(78, 0) NOT NULL,
    reward_liquid_lockers_raw NUMERIC(78, 0) NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, epoch)
);
CREATE INDEX IF NOT EXISTS idx_styfi_epoch_stats_chain_start
    ON styfi_epoch_stats(chain_id, epoch_start DESC);

CREATE TABLE IF NOT EXISTS styfi_sync_state (
    stream_name TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    cursor BIGINT,
    observed_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_activity_sync_state (
    chain_id INTEGER PRIMARY KEY,
    cursor BIGINT,
    observed_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_interactions (
    chain_id INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    product_type TEXT NOT NULL,
    product_contract TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    event_topic0 TEXT NOT NULL,
    tx_from TEXT NOT NULL,
    user_account TEXT NOT NULL,
    attribution_kind TEXT NOT NULL,
    amount_raw NUMERIC(78, 0),
    amount_decimals INTEGER,
    amount_symbol TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_product_interactions_time
    ON product_interactions(block_time DESC, chain_id, product_type);
CREATE INDEX IF NOT EXISTS idx_product_interactions_user
    ON product_interactions(user_account, block_time DESC);

CREATE TABLE IF NOT EXISTS product_dau_daily (
    day_utc DATE PRIMARY KEY,
    dau_total INTEGER NOT NULL,
    dau_vaults INTEGER NOT NULL,
    dau_styfi INTEGER NOT NULL,
    dau_styfix INTEGER NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_harvest_sync_state (
    chain_id INTEGER PRIMARY KEY,
    cursor BIGINT,
    observed_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_harvests (
    chain_id INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    vault_address TEXT NOT NULL,
    vault_version TEXT NOT NULL,
    strategy_address TEXT NOT NULL,
    gain NUMERIC NOT NULL,
    loss NUMERIC NOT NULL,
    debt_after NUMERIC,
    fee_assets NUMERIC,
    refund_assets NUMERIC,
    event_topic0 TEXT NOT NULL,
    raw_event JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_vault_harvests_time
    ON vault_harvests(block_time DESC, chain_id);
CREATE INDEX IF NOT EXISTS idx_vault_harvests_vault
    ON vault_harvests(vault_address, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_vault_harvests_strategy
    ON vault_harvests(strategy_address, block_time DESC);

CREATE TABLE IF NOT EXISTS vault_harvest_daily_chain (
    day_utc DATE NOT NULL,
    chain_id INTEGER NOT NULL,
    harvest_count INTEGER NOT NULL,
    vault_count INTEGER NOT NULL,
    strategy_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (day_utc, chain_id)
);
"""


def _validate_data_policy_config() -> None:
    if PPS_RETENTION_DAYS > 0 and KONG_PPS_LOOKBACK_DAYS > 0 and PPS_RETENTION_DAYS < KONG_PPS_LOOKBACK_DAYS:
        raise ValueError(
            "Invalid retention policy: PPS_RETENTION_DAYS must be >= KONG_PPS_LOOKBACK_DAYS "
            f"(got retention={PPS_RETENTION_DAYS}, lookback={KONG_PPS_LOOKBACK_DAYS})"
        )
    if STYFI_SYNC_ENABLED and not ETH_RPC_URL:
        raise ValueError("Invalid stYFI config: ETH_RPC_URL is required when STYFI_SYNC_ENABLED=1")
    if STYFI_CHAIN_ID <= 0:
        raise ValueError(f"Invalid stYFI config: STYFI_CHAIN_ID must be > 0 (got {STYFI_CHAIN_ID})")
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
    if PRODUCT_ACTIVITY_RETENTION_DAYS < 0:
        raise ValueError(
            "Invalid DAU retention: PRODUCT_ACTIVITY_RETENTION_DAYS must be >= 0 "
            f"(got {PRODUCT_ACTIVITY_RETENTION_DAYS})"
        )
    if PRODUCT_ACTIVITY_BACKFILL_DAYS <= 0:
        raise ValueError(
            "Invalid DAU backfill: PRODUCT_ACTIVITY_BACKFILL_DAYS must be > 0 "
            f"(got {PRODUCT_ACTIVITY_BACKFILL_DAYS})"
        )
    if PRODUCT_ACTIVITY_BLOCK_SPAN <= 0:
        raise ValueError(
            "Invalid DAU block span: PRODUCT_ACTIVITY_BLOCK_SPAN must be > 0 "
            f"(got {PRODUCT_ACTIVITY_BLOCK_SPAN})"
        )
    if HARVEST_RETENTION_DAYS < 0:
        raise ValueError(
            "Invalid harvest retention: HARVEST_RETENTION_DAYS must be >= 0 "
            f"(got {HARVEST_RETENTION_DAYS})"
        )
    if HARVEST_BACKFILL_DAYS <= 0:
        raise ValueError(
            "Invalid harvest backfill: HARVEST_BACKFILL_DAYS must be > 0 "
            f"(got {HARVEST_BACKFILL_DAYS})"
        )
    if HARVEST_BLOCK_SPAN <= 0:
        raise ValueError(
            "Invalid harvest block span: HARVEST_BLOCK_SPAN must be > 0 "
            f"(got {HARVEST_BLOCK_SPAN})"
        )
    if HARVEST_WSS_RECONCILE_SEC <= 0:
        raise ValueError(
            "Invalid harvest WSS reconciliation interval: HARVEST_WSS_RECONCILE_SEC must be > 0 "
            f"(got {HARVEST_WSS_RECONCILE_SEC})"
        )
    if HARVEST_WSS_REPLAY_BLOCKS <= 0:
        raise ValueError(
            "Invalid harvest WSS replay blocks: HARVEST_WSS_REPLAY_BLOCKS must be > 0 "
            f"(got {HARVEST_WSS_REPLAY_BLOCKS})"
        )
    if HARVEST_WSS_HEARTBEAT_SEC <= 0:
        raise ValueError(
            "Invalid harvest WSS heartbeat: HARVEST_WSS_HEARTBEAT_SEC must be > 0 "
            f"(got {HARVEST_WSS_HEARTBEAT_SEC})"
        )
    if HARVEST_WSS_CONNECT_TIMEOUT_SEC <= 0:
        raise ValueError(
            "Invalid harvest WSS connect timeout: HARVEST_WSS_CONNECT_TIMEOUT_SEC must be > 0 "
            f"(got {HARVEST_WSS_CONNECT_TIMEOUT_SEC})"
        )
    if HARVEST_WSS_SUBSCRIPTION_CHUNK <= 0:
        raise ValueError(
            "Invalid harvest WSS subscription chunk: HARVEST_WSS_SUBSCRIPTION_CHUNK must be > 0 "
            f"(got {HARVEST_WSS_SUBSCRIPTION_CHUNK})"
        )
    if DISCORD_NOTIFICATION_RETRY_LIMIT <= 0:
        raise ValueError(
            "Invalid Discord retry config: DISCORD_NOTIFICATION_RETRY_LIMIT must be > 0 "
            f"(got {DISCORD_NOTIFICATION_RETRY_LIMIT})"
        )
    if DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC <= 0:
        raise ValueError(
            "Invalid Discord retry config: DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC must be > 0 "
            f"(got {DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC})"
        )
    if not 0 < SNAPSHOT_MIN_ACTIVE_RATIO <= 1:
        raise ValueError(
            "Invalid snapshot guard: SNAPSHOT_MIN_ACTIVE_RATIO must be in (0, 1] "
            f"(got {SNAPSHOT_MIN_ACTIVE_RATIO})"
        )
    if SNAPSHOT_MIN_DROP_COUNT < 0:
        raise ValueError(
            "Invalid snapshot guard: SNAPSHOT_MIN_DROP_COUNT must be >= 0 "
            f"(got {SNAPSHOT_MIN_DROP_COUNT})"
        )

UPSERT_SQL = """
INSERT INTO vault_dim (
    vault_address,
    chain_id,
    name,
    symbol,
    category,
    kind,
    version,
    token_address,
    token_symbol,
    token_name,
    token_decimals,
    tvl_usd,
    est_apy,
    active,
    last_seen_at,
    raw
) VALUES (
    %(vault_address)s,
    %(chain_id)s,
    %(name)s,
    %(symbol)s,
    %(category)s,
    %(kind)s,
    %(version)s,
    %(token_address)s,
    %(token_symbol)s,
    %(token_name)s,
    %(token_decimals)s,
    %(tvl_usd)s,
    %(est_apy)s,
    TRUE,
    NOW(),
    %(raw)s
)
ON CONFLICT (chain_id, vault_address) DO UPDATE SET
    name = EXCLUDED.name,
    symbol = EXCLUDED.symbol,
    category = EXCLUDED.category,
    kind = EXCLUDED.kind,
    version = EXCLUDED.version,
    token_address = EXCLUDED.token_address,
    token_symbol = EXCLUDED.token_symbol,
    token_name = EXCLUDED.token_name,
    token_decimals = EXCLUDED.token_decimals,
    tvl_usd = EXCLUDED.tvl_usd,
    est_apy = EXCLUDED.est_apy,
    active = TRUE,
    last_seen_at = NOW(),
    raw = EXCLUDED.raw
"""


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [yhelper-worker] %(message)s",
    )
