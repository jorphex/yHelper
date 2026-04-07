from __future__ import annotations

import json
import logging
import math
import os
import select
import statistics
import threading
import time
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from urllib.parse import urlparse

import psycopg
import requests
import websocket
from eth_utils import keccak
from psycopg.types.json import Json

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
LAST_CLEANUP_AT: datetime | None = None

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
        "username": "Ethereum Harvest",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_ETHEREUM,
        "color": 0x627EEA,
    },
    10: {
        "destination_key": "harvest:optimism",
        "username": "Optimism Harvest",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_OPTIMISM,
        "color": 0xFF0420,
    },
    137: {
        "destination_key": "harvest:polygon",
        "username": "Polygon Harvest",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_POLYGON,
        "color": 0x8247E5,
    },
    146: {
        "destination_key": "harvest:sonic",
        "username": "Sonic Harvest",
        "avatar_url": "https://www.soniclabs.com/apple-icon.png?0afb6d97a9fd9393",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_SONIC,
        "color": 0x00E5FF,
    },
    8453: {
        "destination_key": "harvest:base",
        "username": "Base Harvest",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_BASE,
        "color": 0x0052FF,
    },
    42161: {
        "destination_key": "harvest:arbitrum",
        "username": "Arbitrum Harvest",
        "avatar_url": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
        "webhook_url": DISCORD_HARVEST_WEBHOOK_ARBITRUM,
        "color": 0x28A0F0,
    },
    747474: {
        "destination_key": "harvest:katana",
        "username": "Katana Harvest",
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
HARVEST_WSS_MANAGER: HarvestWssManager | None = None

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


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.lower() in {"n/a", "na", "none", "null", "nan", "-", "--"}:
            return None
        cleaned = cleaned.replace(",", "")
        try:
            numeric = float(cleaned)
        except ValueError:
            return None
        return numeric if math.isfinite(numeric) else None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _first_present(mapping: dict[str, object], keys: tuple[str, ...]) -> object:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def _has_raw_numeric_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return False
        return cleaned.lower() not in {"n/a", "na", "none", "null", "nan", "-", "--"}
    return True


def _parse_chain_id(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        value = cleaned
    try:
        chain_id = int(value)
    except (TypeError, ValueError):
        return None
    return chain_id if chain_id > 0 else None


def _to_int_or_none(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        value = cleaned
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _normalize_optional_address(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.lower() if text.startswith("0x") else text


def _normalize_vault(vault: dict, *, vault_address: str, chain_id: int) -> tuple[dict, list[str]]:
    asset = vault.get("asset")
    asset_obj = asset if isinstance(asset, dict) else {}
    token = vault.get("token")
    token_obj = token if isinstance(token, dict) else {}
    meta = vault.get("meta")
    meta_obj = meta if isinstance(meta, dict) else {}
    meta_token = meta_obj.get("token")
    meta_token_obj = meta_token if isinstance(meta_token, dict) else {}
    tvl = vault.get("tvl")
    tvl_obj = tvl if isinstance(tvl, dict) else {}
    performance = vault.get("performance")
    performance_obj = performance if isinstance(performance, dict) else {}
    oracle = performance_obj.get("oracle")
    oracle_obj = oracle if isinstance(oracle, dict) else {}
    raw_tvl = _first_present(tvl_obj, ("close", "tvl", "tvlUsd", "usd", "totalValueLockedUSD"))
    raw_apr = _first_present(oracle_obj, ("apy", "netAPY", "netApy"))
    tvl_usd = _to_float(raw_tvl)
    est_apy = _to_float(raw_apr)
    numeric_parse_failures: list[str] = []
    if tvl_usd is None and _has_raw_numeric_value(raw_tvl):
        numeric_parse_failures.append("tvl_usd")
    if est_apy is None and _has_raw_numeric_value(raw_apr):
        numeric_parse_failures.append("est_apy")
    row = {
        "vault_address": vault_address,
        "chain_id": chain_id,
        "name": vault.get("name"),
        "symbol": vault.get("symbol"),
        "category": _first_present(meta_obj, ("category",)) or vault.get("category"),
        "kind": _first_present(meta_obj, ("kind",)) or vault.get("kind"),
        "version": _first_present(vault, ("apiVersion", "version")),
        "token_address": _normalize_optional_address(
            _first_present(asset_obj, ("address", "tokenAddress"))
            or _first_present(token_obj, ("address", "tokenAddress"))
        ),
        "token_symbol": _first_present(asset_obj, ("symbol", "tokenSymbol")) or _first_present(token_obj, ("symbol",)),
        "token_name": _first_present(asset_obj, ("name", "tokenName")) or _first_present(token_obj, ("name",)),
        "token_decimals": _to_int_or_none(
            _first_present(asset_obj, ("decimals", "tokenDecimals"))
            or _first_present(meta_token_obj, ("decimals",))
            or _first_present(token_obj, ("decimals",))
            or _first_present(vault, ("decimals",))
        ),
        "tvl_usd": tvl_usd,
        "est_apy": est_apy,
        "raw": Json(vault),
    }
    return row, numeric_parse_failures


def _connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def _post_kong_gql_json(query: str, variables: dict[str, object] | None = None) -> dict[str, object]:
    response = requests.post(
        KONG_GQL_URL,
        json={"query": query, "variables": variables or {}},
        timeout=30,
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Kong GraphQL response is not an object")
    if payload.get("errors"):
        raise ValueError(f"Kong GraphQL returned errors: {payload['errors']}")
    return payload


def _rpc_url_for_chain(chain_id: int) -> str | None:
    url = CHAIN_RPC_URLS.get(chain_id)
    if url and url.strip():
        return url.strip()
    return None


def _derive_wss_url(rpc_url: str | None) -> str | None:
    if not rpc_url:
        return None
    candidate = rpc_url.strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme in {"ws", "wss"}:
        return candidate
    if parsed.scheme == "https":
        return f"wss://{parsed.netloc}{parsed.path}"
    if parsed.scheme == "http":
        return f"ws://{parsed.netloc}{parsed.path}"
    return None


def _wss_url_for_chain(chain_id: int) -> str | None:
    explicit = CHAIN_WSS_URLS.get(chain_id)
    if explicit and explicit.strip():
        return explicit.strip()
    return _derive_wss_url(_rpc_url_for_chain(chain_id))


def _eth_rpc_to_url(rpc_url: str, method: str, params: list[object]) -> object:
    last_error: Exception | None = None
    for attempt in range(1, ETH_RPC_MAX_ATTEMPTS + 1):
        try:
            response = requests.post(
                rpc_url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=ETH_CALL_TIMEOUT_SEC,
            )
            if response.status_code >= 500 or response.status_code == 429:
                response.raise_for_status()
            if response.status_code >= 400:
                response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise ValueError(f"Ethereum RPC error: {payload['error']}")
            return payload.get("result")
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            is_retryable = isinstance(exc, requests.RequestException) and (
                getattr(exc.response, "status_code", None) in {429}
                or getattr(exc.response, "status_code", 0) >= 500
                or exc.response is None
            )
            if attempt >= ETH_RPC_MAX_ATTEMPTS or not is_retryable:
                raise
            time.sleep(ETH_RPC_RETRY_SLEEP_SEC * attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Ethereum RPC call failed without error for method {method}")


def _eth_rpc(method: str, params: list[object]) -> object:
    return _eth_rpc_to_url(ETH_RPC_URL, method, params)


def _eth_selector(signature: str) -> str:
    return keccak(text=signature)[:4].hex()


def _eth_encode_address(value: str) -> str:
    normalized = value.lower().replace("0x", "")
    if len(normalized) != 40:
        raise ValueError(f"Invalid address length: {value}")
    return normalized.rjust(64, "0")


def _eth_encode_uint256(value: int) -> str:
    if value < 0:
        raise ValueError(f"uint256 cannot be negative: {value}")
    return f"{value:064x}"


def _eth_decode_address(result: str) -> str:
    if len(result) < 66:
        raise ValueError(f"Unexpected address result length: {result!r}")
    return f"0x{result[-40:]}".lower()


def _eth_call(address: str, signature: str, encoded_args: str = "", block_tag: str = "latest") -> str:
    data = f"0x{_eth_selector(signature)}{encoded_args}"
    result = _eth_rpc("eth_call", [{"to": address, "data": data}, block_tag])
    if not isinstance(result, str) or not result.startswith("0x"):
        raise ValueError(f"Unexpected eth_call result for {signature}: {result!r}")
    return result


def _eth_decode_uint256(result: str) -> int:
    if len(result) < 66:
        raise ValueError(f"Unexpected uint256 result length: {result!r}")
    return int(result[2:66], 16)


def _eth_decode_string(result: str) -> str:
    payload = result[2:] if result.startswith("0x") else result
    if len(payload) < 128:
        raise ValueError(f"Unexpected string result length: {result!r}")
    offset = int(payload[:64], 16) * 2
    if len(payload) < offset + 64:
        raise ValueError(f"Unexpected string offset: {result!r}")
    length = int(payload[offset : offset + 64], 16)
    start = offset + 64
    end = start + length * 2
    if len(payload) < end:
        raise ValueError(f"Unexpected string payload length: {result!r}")
    return bytes.fromhex(payload[start:end]).decode("utf-8")


def _eth_call_uint(address: str, signature: str, *args: tuple[str, str] | tuple[str, int]) -> int:
    encoded = ""
    for arg_type, value in args:
        if arg_type == "address":
            encoded += _eth_encode_address(str(value))
        elif arg_type == "uint256":
            encoded += _eth_encode_uint256(int(value))
        else:
            raise ValueError(f"Unsupported abi arg type: {arg_type}")
    return _eth_decode_uint256(_eth_call(address, signature, encoded))


def _eth_call_address(address: str, signature: str, *args: tuple[str, str] | tuple[str, int]) -> str:
    encoded = ""
    for arg_type, value in args:
        if arg_type == "address":
            encoded += _eth_encode_address(str(value))
        elif arg_type == "uint256":
            encoded += _eth_encode_uint256(int(value))
        else:
            raise ValueError(f"Unsupported abi arg type: {arg_type}")
    return _eth_decode_address(_eth_call(address, signature, encoded))


def _eth_call_string(address: str, signature: str, *args: tuple[str, str] | tuple[str, int]) -> str:
    encoded = ""
    for arg_type, value in args:
        if arg_type == "address":
            encoded += _eth_encode_address(str(value))
        elif arg_type == "uint256":
            encoded += _eth_encode_uint256(int(value))
        else:
            raise ValueError(f"Unsupported abi arg type: {arg_type}")
    return _eth_decode_string(_eth_call(address, signature, encoded))


def _eth_call_string_for_chain(chain_id: int, address: str, signature: str) -> str:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    data = f"0x{_eth_selector(signature)}"
    result = _eth_rpc_to_url(rpc_url, "eth_call", [{"to": address, "data": data}, "latest"])
    if not isinstance(result, str) or not result.startswith("0x"):
        raise ValueError(f"Unexpected eth_call result for {signature} on chain {chain_id}: {result!r}")
    return _eth_decode_string(result)


@lru_cache(maxsize=2048)
def _strategy_display_label(chain_id: int, strategy_address: str) -> str:
    normalized = strategy_address.lower()
    for signature in ("symbol()", "name()"):
        try:
            label = _eth_call_string_for_chain(chain_id, normalized, signature).strip()
        except Exception:
            continue
        if label:
            return label
    return _short_hex(normalized)


def _hex_to_int(value: str | None) -> int | None:
    if not value or not isinstance(value, str):
        return None
    return int(value, 16)


def _eth_block_number_for_chain(chain_id: int) -> int:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    block_number = _eth_rpc_to_url(rpc_url, "eth_blockNumber", [])
    if not isinstance(block_number, str):
        raise ValueError(f"Unexpected eth_blockNumber result for chain {chain_id}: {block_number!r}")
    return int(block_number, 16)


def _eth_get_block_for_chain(chain_id: int, block_number: int) -> dict[str, object]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(rpc_url, "eth_getBlockByNumber", [hex(block_number), False])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getBlockByNumber result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transaction_for_chain(chain_id: int, tx_hash: str) -> dict[str, object]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(rpc_url, "eth_getTransactionByHash", [tx_hash])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getTransactionByHash result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transaction_receipt_for_chain(chain_id: int, tx_hash: str) -> dict[str, object]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(rpc_url, "eth_getTransactionReceipt", [tx_hash])
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected eth_getTransactionReceipt result for chain {chain_id}: {payload!r}")
    return payload


def _eth_get_transactions_for_chain(chain_id: int, tx_hashes: list[str]) -> dict[str, dict[str, object]]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    if not tx_hashes:
        return {}
    transactions: dict[str, dict[str, object]] = {}
    for start in range(0, len(tx_hashes), ETH_TX_BATCH_SIZE):
        batch_tx_hashes = tx_hashes[start : start + ETH_TX_BATCH_SIZE]
        batch_payload = [
            {"jsonrpc": "2.0", "id": idx, "method": "eth_getTransactionByHash", "params": [tx_hash]}
            for idx, tx_hash in enumerate(batch_tx_hashes, start=1)
        ]
        last_error: Exception | None = None
        payload: object | None = None
        try:
            for attempt in range(1, ETH_RPC_MAX_ATTEMPTS + 1):
                try:
                    response = requests.post(rpc_url, json=batch_payload, timeout=ETH_CALL_TIMEOUT_SEC)
                    if response.status_code >= 500 or response.status_code == 429:
                        response.raise_for_status()
                    if response.status_code >= 400:
                        response.raise_for_status()
                    payload = response.json()
                    break
                except requests.RequestException as exc:
                    last_error = exc
                    is_retryable = (
                        getattr(exc.response, "status_code", None) in {429}
                        or getattr(exc.response, "status_code", 0) >= 500
                        or exc.response is None
                    )
                    if attempt >= ETH_RPC_MAX_ATTEMPTS or not is_retryable:
                        raise
                    time.sleep(ETH_RPC_RETRY_SLEEP_SEC * attempt)
            if payload is None:
                if last_error is not None:
                    raise last_error
                raise RuntimeError(f"Missing batched eth_getTransactionByHash payload for chain {chain_id}")
            if not isinstance(payload, list):
                raise ValueError(f"Unexpected batched eth_getTransactionByHash result for chain {chain_id}: {payload!r}")
            by_id = {idx: tx_hash for idx, tx_hash in enumerate(batch_tx_hashes, start=1)}
            for row in payload:
                if not isinstance(row, dict):
                    continue
                if row.get("error"):
                    raise ValueError(f"Ethereum RPC batch error on chain {chain_id}: {row['error']}")
                tx_hash = by_id.get(int(row.get("id") or 0))
                result = row.get("result")
                if tx_hash and isinstance(result, dict):
                    transactions[tx_hash] = result
        except (requests.RequestException, ValueError):
            for tx_hash in batch_tx_hashes:
                result = _eth_get_transaction_for_chain(chain_id, tx_hash)
                if isinstance(result, dict):
                    transactions[tx_hash] = result
    return transactions


def _eth_get_logs_for_chain(
    chain_id: int,
    *,
    addresses: list[str],
    from_block: int,
    to_block: int,
    topics: list[list[str] | str | None],
) -> list[dict[str, object]]:
    rpc_url = _rpc_url_for_chain(chain_id)
    if not rpc_url:
        raise ValueError(f"No RPC URL configured for chain {chain_id}")
    payload = _eth_rpc_to_url(
        rpc_url,
        "eth_getLogs",
        [
            {
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "address": addresses,
                "topics": topics,
            }
        ],
    )
    if not isinstance(payload, list):
        raise ValueError(f"Unexpected eth_getLogs result for chain {chain_id}: {payload!r}")
    return [row for row in payload if isinstance(row, dict)]


def _find_block_at_or_after(chain_id: int, target_ts: int) -> int:
    latest = _eth_block_number_for_chain(chain_id)
    low = 0
    high = latest
    candidate = latest
    while low <= high:
        mid = (low + high) // 2
        block = _eth_get_block_for_chain(chain_id, mid)
        block_ts = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
        if block_ts is None:
            raise ValueError(f"Missing timestamp for chain {chain_id} block {mid}")
        if block_ts >= target_ts:
            candidate = mid
            high = mid - 1
        else:
            low = mid + 1
    return candidate


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[idx : idx + size] for idx in range(0, len(items), size)]


def _product_activity_block_span_for_chain(chain_id: int) -> int:
    return max(1, PRODUCT_ACTIVITY_BLOCK_SPAN_BY_CHAIN.get(chain_id, PRODUCT_ACTIVITY_BLOCK_SPAN))


def _harvest_block_span_for_chain(chain_id: int) -> int:
    return max(1, HARVEST_BLOCK_SPAN_BY_CHAIN.get(chain_id, HARVEST_BLOCK_SPAN))


def _decode_uint256_words(data: object) -> list[int]:
    if not isinstance(data, str) or not data.startswith("0x"):
        return []
    payload = data[2:]
    if not payload:
        return []
    if len(payload) % 64 != 0:
        return []
    return [int(payload[idx : idx + 64], 16) for idx in range(0, len(payload), 64)]


def _product_activity_reward_token_meta(conn: psycopg.Connection) -> dict[str, object]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT payload
            FROM styfi_sync_state
            WHERE stream_name = 'styfi_reward_epoch'
            """,
        )
        row = cur.fetchone()
    conn.commit()
    payload = row[0] if row else {}
    reward_token = payload.get("reward_token") if isinstance(payload, dict) else {}
    if not isinstance(reward_token, dict):
        reward_token = {}
    symbol = str(reward_token.get("symbol") or STYFI_REWARD_TOKEN_DEFAULT["symbol"])
    decimals = _to_int_or_none(reward_token.get("decimals"))
    return {
        "address": _normalize_optional_address(reward_token.get("address") or STYFI_REWARD_TOKEN_DEFAULT["address"]),
        "symbol": symbol,
        "decimals": STYFI_REWARD_TOKEN_DEFAULT["decimals"] if decimals is None else decimals,
    }


def _product_activity_amount_payload(
    *,
    product_type: str,
    event_kind: str,
    data: object,
    reward_token_meta: dict[str, object],
) -> dict[str, object | None]:
    words = _decode_uint256_words(data)
    if event_kind in {"deposit", "withdraw"} and product_type in {"styfi", "styfix"}:
        amount_raw = words[0] if words else None
        return {
            "amount_raw": amount_raw,
            "amount_decimals": STYFI_ASSET_DECIMALS,
            "amount_symbol": STYFI_ASSET_SYMBOL,
        }
    if event_kind == "unstake" and product_type in {"styfi", "styfix"}:
        amount_raw = words[0] if words else None
        return {
            "amount_raw": amount_raw,
            "amount_decimals": STYFI_ASSET_DECIMALS,
            "amount_symbol": STYFI_PRODUCT_SYMBOLS.get(product_type),
        }
    if event_kind == "claim" and product_type in {"styfi", "styfix"}:
        amount_raw = words[0] if words else None
        return {
            "amount_raw": amount_raw,
            "amount_decimals": _to_int_or_none(reward_token_meta.get("decimals")),
            "amount_symbol": reward_token_meta.get("symbol"),
        }
    return {
        "amount_raw": None,
        "amount_decimals": None,
        "amount_symbol": None,
    }


def _select_harvest_contracts(conn: psycopg.Connection) -> dict[int, dict[str, str]]:
    targets: dict[int, dict[str, str]] = {}
    supported_chain_ids = sorted(CHAIN_RPC_URLS)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address, version
            FROM vault_dim
            WHERE
                COALESCE(TRIM(version), '') <> ''
                AND chain_id = ANY(%(supported_chain_ids)s)
            ORDER BY chain_id, vault_address
            """,
            {"supported_chain_ids": supported_chain_ids},
        )
        for chain_id, vault_address, version in cur.fetchall():
            if not vault_address or not version:
                continue
            chain_targets = targets.setdefault(int(chain_id), {})
            chain_targets[str(vault_address).lower()] = str(version)
    conn.commit()
    return {chain_id: mapping for chain_id, mapping in targets.items() if mapping}


def _harvest_sync_state(conn: psycopg.Connection, chain_id: int) -> tuple[int | None, dict[str, object], datetime | None]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cursor, payload, observed_at
            FROM vault_harvest_sync_state
            WHERE chain_id = %s
            """,
            (chain_id,),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None, {}, None
    cursor_value, payload_value, observed_at = row
    payload = payload_value if isinstance(payload_value, dict) else {}
    cursor = int(cursor_value) if cursor_value is not None else None
    return cursor, payload, observed_at


def _harvest_cursor(conn: psycopg.Connection, chain_id: int) -> int | None:
    cursor, _, _ = _harvest_sync_state(conn, chain_id)
    return cursor


def _upsert_harvest_sync_state(
    conn: psycopg.Connection,
    *,
    chain_id: int,
    cursor: int | None,
    observed_at: datetime,
    payload: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO vault_harvest_sync_state (
                chain_id,
                cursor,
                observed_at,
                payload,
                updated_at
            ) VALUES (
                %(chain_id)s,
                %(cursor)s,
                %(observed_at)s,
                %(payload)s,
                NOW()
            )
            ON CONFLICT (chain_id) DO UPDATE SET
                cursor = COALESCE(EXCLUDED.cursor, vault_harvest_sync_state.cursor),
                observed_at = EXCLUDED.observed_at,
                payload = COALESCE(vault_harvest_sync_state.payload, '{}'::jsonb) || EXCLUDED.payload,
                updated_at = NOW()
            """,
            {
                "chain_id": chain_id,
                "cursor": cursor,
                "observed_at": observed_at,
                "payload": Json(payload),
            },
        )
    conn.commit()


def _parse_harvest_row(
    *,
    chain_id: int,
    vault_address: str,
    vault_version: str,
    log: dict[str, object],
) -> dict[str, object] | None:
    topics = log.get("topics")
    if not isinstance(topics, list) or not topics:
        return None
    topic0 = str(topics[0] or "").lower()
    strategy_address = _topic_address(topics, 1)
    if not strategy_address:
        return None
    values = _decode_uint256_words(log.get("data"))
    if topic0 == EVENT_TOPIC_STRATEGY_REPORTED_V3:
        if len(values) != 6:
            return None
        gain, loss, current_debt, _protocol_fees, total_fees, total_refunds = values
        debt_after = current_debt
        fee_assets = total_fees
        refund_assets = total_refunds
    elif topic0 == EVENT_TOPIC_STRATEGY_REPORTED_V2:
        if len(values) != 8:
            return None
        gain, loss, _debt_paid, _total_gain, _total_loss, total_debt, _debt_added, _debt_ratio = values
        debt_after = total_debt
        fee_assets = None
        refund_assets = None
    else:
        return None
    tx_hash = str(log.get("transactionHash", "")).lower()
    if not tx_hash:
        return None
    block_number = _hex_to_int(log.get("blockNumber"))
    log_index = _hex_to_int(log.get("logIndex"))
    block_timestamp = _hex_to_int(log.get("blockTimestamp"))
    if block_number is None or log_index is None:
        return None
    if block_timestamp is None:
        block = _eth_get_block_for_chain(chain_id, block_number)
        block_timestamp = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
    if block_timestamp is None:
        return None
    return {
        "chain_id": chain_id,
        "block_number": block_number,
        "block_time": datetime.fromtimestamp(block_timestamp, tz=UTC),
        "tx_hash": tx_hash,
        "log_index": log_index,
        "vault_address": vault_address,
        "vault_version": vault_version,
        "strategy_address": strategy_address,
        "gain": gain,
        "loss": loss,
        "debt_after": debt_after,
        "fee_assets": fee_assets,
        "refund_assets": refund_assets,
        "event_topic0": topic0,
        "raw_event": Json(log),
    }


def _upsert_vault_harvests(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO vault_harvests (
                chain_id,
                block_number,
                block_time,
                tx_hash,
                log_index,
                vault_address,
                vault_version,
                strategy_address,
                gain,
                loss,
                debt_after,
                fee_assets,
                refund_assets,
                event_topic0,
                raw_event
            ) VALUES (
                %(chain_id)s,
                %(block_number)s,
                %(block_time)s,
                %(tx_hash)s,
                %(log_index)s,
                %(vault_address)s,
                %(vault_version)s,
                %(strategy_address)s,
                %(gain)s,
                %(loss)s,
                %(debt_after)s,
                %(fee_assets)s,
                %(refund_assets)s,
                %(event_topic0)s,
                %(raw_event)s
            )
            ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
            """,
            rows,
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _recompute_vault_harvest_daily_chain(conn: psycopg.Connection, *, from_day: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM vault_harvest_daily_chain
            WHERE day_utc >= %s::date
            """,
            (from_day.date(),),
        )
        cur.execute(
            """
            INSERT INTO vault_harvest_daily_chain (
                day_utc,
                chain_id,
                harvest_count,
                vault_count,
                strategy_count,
                computed_at
            )
            SELECT
                (block_time AT TIME ZONE 'UTC')::date AS day_utc,
                chain_id,
                COUNT(*) AS harvest_count,
                COUNT(DISTINCT vault_address) AS vault_count,
                COUNT(DISTINCT strategy_address) AS strategy_count,
                NOW()
            FROM vault_harvests
            WHERE block_time >= %s::date
            GROUP BY 1, 2
            ORDER BY 1, 2
            """,
            (from_day.date(),),
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _refresh_vault_harvest_daily_chain_keys(
    conn: psycopg.Connection,
    *,
    day_keys: set[tuple[datetime.date, int]],
) -> int:
    if not day_keys:
        return 0
    inserted = 0
    with conn.cursor() as cur:
        for day_utc, chain_id in sorted(day_keys):
            cur.execute(
                """
                DELETE FROM vault_harvest_daily_chain
                WHERE day_utc = %s AND chain_id = %s
                """,
                (day_utc, chain_id),
            )
            cur.execute(
                """
                INSERT INTO vault_harvest_daily_chain (
                    day_utc,
                    chain_id,
                    harvest_count,
                    vault_count,
                    strategy_count,
                    computed_at
                )
                SELECT
                    %s::date AS day_utc,
                    chain_id,
                    COUNT(*) AS harvest_count,
                    COUNT(DISTINCT vault_address) AS vault_count,
                    COUNT(DISTINCT strategy_address) AS strategy_count,
                    NOW()
                FROM vault_harvests
                WHERE
                    chain_id = %s
                    AND block_time >= %s::date
                    AND block_time < (%s::date + INTERVAL '1 day')
                GROUP BY chain_id
                """,
                (day_utc, chain_id, day_utc, day_utc),
            )
            inserted += cur.rowcount
    conn.commit()
    return inserted


def _harvest_wss_is_healthy(payload: dict[str, object], _now: datetime) -> bool:
    if not HARVEST_WSS_ENABLED:
        return False
    if payload.get("wss_connected") is not True:
        return False
    connected_raw = payload.get("wss_connected_at")
    error_raw = payload.get("wss_last_error_at")
    if not isinstance(error_raw, str):
        return True
    if not isinstance(connected_raw, str):
        return True
    try:
        connected_at = datetime.fromisoformat(connected_raw)
        error_at = datetime.fromisoformat(error_raw)
    except ValueError:
        return True
    if connected_at.tzinfo is None:
        connected_at = connected_at.replace(tzinfo=UTC)
    if error_at.tzinfo is None:
        error_at = error_at.replace(tzinfo=UTC)
    return connected_at >= error_at


def _harvest_wss_reconcile_due(payload: dict[str, object], now: datetime) -> bool:
    last_reconcile_raw = payload.get("last_http_reconcile_at")
    if not isinstance(last_reconcile_raw, str):
        return True
    try:
        last_reconcile = datetime.fromisoformat(last_reconcile_raw)
    except ValueError:
        return True
    if last_reconcile.tzinfo is None:
        last_reconcile = last_reconcile.replace(tzinfo=UTC)
    return (now - last_reconcile) >= timedelta(seconds=HARVEST_WSS_RECONCILE_SEC)


def _harvest_http_start_block(
    *,
    chain_id: int,
    cursor: int | None,
    latest_block: int,
    payload: dict[str, object],
) -> int:
    if cursor is None:
        backfill_start = int((datetime.now(UTC) - timedelta(days=HARVEST_BACKFILL_DAYS)).timestamp())
        return _find_block_at_or_after(chain_id, backfill_start)
    default_start = cursor + 1
    last_seen_value = payload.get("wss_last_seen_block")
    last_seen_block = int(last_seen_value) if isinstance(last_seen_value, int) else None
    if last_seen_block is None and isinstance(last_seen_value, str) and last_seen_value.isdigit():
        last_seen_block = int(last_seen_value)
    replay_anchor = last_seen_block if last_seen_block is not None else latest_block
    replay_start = max(0, replay_anchor - HARVEST_WSS_REPLAY_BLOCKS)
    return max(default_start, replay_start)


class HarvestWssListener(threading.Thread):
    def __init__(self, chain_id: int, contracts: dict[str, str]):
        super().__init__(name=f"harvest-wss-{chain_id}", daemon=True)
        self.chain_id = chain_id
        self._lock = threading.Lock()
        self._contracts = dict(contracts)
        self._restart = threading.Event()
        self._stop_event = threading.Event()

    def update_contracts(self, contracts: dict[str, str]) -> None:
        with self._lock:
            if contracts == self._contracts:
                return
            self._contracts = dict(contracts)
        self._restart.set()

    def stop(self) -> None:
        self._stop_event.set()
        self._restart.set()

    def run(self) -> None:
        backoff = 1.0
        while not self._stop_event.is_set():
            wss_url = _wss_url_for_chain(self.chain_id)
            with self._lock:
                contracts = dict(self._contracts)
            if not wss_url or not contracts:
                time.sleep(1)
                continue
            try:
                self._run_session(wss_url=wss_url, contracts=contracts)
                backoff = 1.0
            except Exception as exc:
                if self._stop_event.is_set():
                    return
                if str(exc) == "contract_set_changed":
                    backoff = 1.0
                    continue
                logging.warning("Harvest WSS listener reconnect: chain=%s error=%s", self.chain_id, exc)
                with _connect() as conn:
                    _upsert_harvest_sync_state(
                        conn,
                        chain_id=self.chain_id,
                        cursor=None,
                        observed_at=datetime.now(UTC),
                        payload={
                            "wss_connected": False,
                            "wss_last_error": str(exc),
                            "wss_last_error_at": datetime.now(UTC).isoformat(),
                        },
                    )
                time.sleep(min(backoff, 30.0))
                backoff = min(backoff * 2, 30.0)

    def _run_session(self, *, wss_url: str, contracts: dict[str, str]) -> None:
        ws = websocket.create_connection(wss_url, timeout=HARVEST_WSS_CONNECT_TIMEOUT_SEC)
        try:
            with _connect() as conn:
                subscription_id = 1
                for address_chunk in _chunked(sorted(contracts), HARVEST_WSS_SUBSCRIPTION_CHUNK):
                    ws.send(
                        json.dumps(
                            {
                                "jsonrpc": "2.0",
                                "id": subscription_id,
                                "method": "eth_subscribe",
                                "params": [
                                    "logs",
                                    {
                                        "address": address_chunk,
                                        "topics": [[EVENT_TOPIC_STRATEGY_REPORTED_V2, EVENT_TOPIC_STRATEGY_REPORTED_V3]],
                                    },
                                ],
                            }
                        )
                    )
                    self._await_subscription_ack(ws, conn, contracts, subscription_id)
                    subscription_id += 1
                now = datetime.now(UTC)
                _upsert_harvest_sync_state(
                    conn,
                    chain_id=self.chain_id,
                    cursor=None,
                    observed_at=now,
                    payload={
                        "wss_connected": True,
                        "wss_connected_at": now.isoformat(),
                        "wss_heartbeat_at": now.isoformat(),
                        "wss_last_error": None,
                    },
                )
                while not self._stop_event.is_set():
                    if self._restart.is_set():
                        self._restart.clear()
                        raise RuntimeError("contract_set_changed")
                    readable, _, _ = select.select([ws.sock], [], [], HARVEST_WSS_HEARTBEAT_SEC)
                    if not readable:
                        heartbeat_at = datetime.now(UTC)
                        _upsert_harvest_sync_state(
                            conn,
                            chain_id=self.chain_id,
                            cursor=None,
                            observed_at=heartbeat_at,
                            payload={
                                "wss_connected": True,
                                "wss_heartbeat_at": heartbeat_at.isoformat(),
                            },
                        )
                        continue
                    raw_message = ws.recv()
                    if not raw_message:
                        raise RuntimeError("empty_wss_message")
                    self._handle_wss_message(conn, contracts, raw_message)
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def _await_subscription_ack(
        self,
        ws: websocket.WebSocket,
        conn: psycopg.Connection,
        contracts: dict[str, str],
        expected_id: int,
    ) -> None:
        while not self._stop_event.is_set():
            raw_message = ws.recv()
            if not raw_message:
                raise RuntimeError("empty_wss_message")
            message = json.loads(raw_message)
            if isinstance(message, dict) and message.get("id") == expected_id:
                if message.get("error"):
                    raise RuntimeError(f"harvest_wss_subscribe_error:{message['error']}")
                return
            self._handle_wss_payload(conn, contracts, message)

    def _handle_wss_message(
        self,
        conn: psycopg.Connection,
        contracts: dict[str, str],
        raw_message: object,
    ) -> None:
        if isinstance(raw_message, bytes):
            raw_message = raw_message.decode("utf-8")
        message = json.loads(raw_message)
        self._handle_wss_payload(conn, contracts, message)

    def _handle_wss_payload(
        self,
        conn: psycopg.Connection,
        contracts: dict[str, str],
        message: object,
    ) -> None:
        if not isinstance(message, dict):
            return
        params = message.get("params")
        if not isinstance(params, dict):
            return
        result = params.get("result")
        if not isinstance(result, dict):
            return
        vault_address = str(result.get("address", "")).lower()
        vault_version = contracts.get(vault_address)
        if not vault_version:
            return
        row = _parse_harvest_row(
            chain_id=self.chain_id,
            vault_address=vault_address,
            vault_version=vault_version,
            log=result,
        )
        if row is None:
            return
        inserted = _upsert_vault_harvests(conn, [row])
        block_time = row["block_time"]
        if inserted > 0 and isinstance(block_time, datetime):
            _refresh_vault_harvest_daily_chain_keys(
                conn,
                day_keys={(block_time.date(), self.chain_id)},
            )
            _notify_harvest_rows(conn, [row])
        seen_at = datetime.now(UTC)
        _upsert_harvest_sync_state(
            conn,
            chain_id=self.chain_id,
            cursor=None,
            observed_at=seen_at,
            payload={
                "wss_connected": True,
                "wss_heartbeat_at": seen_at.isoformat(),
                "wss_last_seen_block": row["block_number"],
                "wss_last_seen_at": seen_at.isoformat(),
            },
        )


class HarvestWssManager:
    def __init__(self) -> None:
        self._listeners: dict[int, HarvestWssListener] = {}

    def refresh(self, targets: dict[int, dict[str, str]]) -> None:
        if not HARVEST_WSS_ENABLED:
            return
        for chain_id, contracts in targets.items():
            if not _wss_url_for_chain(chain_id):
                continue
            listener = self._listeners.get(chain_id)
            if listener is None:
                listener = HarvestWssListener(chain_id, contracts)
                self._listeners[chain_id] = listener
                listener.start()
            else:
                listener.update_contracts(contracts)
        stale_chain_ids = sorted(set(self._listeners) - set(targets))
        for chain_id in stale_chain_ids:
            listener = self._listeners.pop(chain_id)
            listener.stop()


def _run_vault_harvests(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_VAULT_HARVESTS, started_at)
    inserted_total = 0
    recomputed_days = 0
    earliest_seen: datetime | None = None
    errors: list[str] = []
    try:
        targets = _select_harvest_contracts(conn)
        for chain_id, contracts in targets.items():
            try:
                if not _rpc_url_for_chain(chain_id):
                    errors.append(f"{chain_id}:missing_rpc")
                    continue
                now = datetime.now(UTC)
                latest_block = _eth_block_number_for_chain(chain_id)
                cursor, sync_payload, _ = _harvest_sync_state(conn, chain_id)
                notifications_primed = bool(sync_payload.get("notifications_primed")) if isinstance(sync_payload, dict) else False
                wss_url = _wss_url_for_chain(chain_id) if HARVEST_WSS_ENABLED else None
                wss_healthy = bool(wss_url) and _harvest_wss_is_healthy(sync_payload, now)
                should_reconcile = not bool(wss_url) or cursor is None or not wss_healthy or _harvest_wss_reconcile_due(sync_payload, now)
                if not should_reconcile:
                    _upsert_harvest_sync_state(
                        conn,
                        chain_id=chain_id,
                        cursor=cursor,
                        observed_at=now,
                        payload={
                            "status": "wss_live",
                            "contracts": len(contracts),
                            "last_http_skip_at": now.isoformat(),
                        },
                    )
                    continue
                start_block = _harvest_http_start_block(
                    chain_id=chain_id,
                    cursor=cursor,
                    latest_block=latest_block,
                    payload=sync_payload,
                )
                if start_block > latest_block:
                    _upsert_harvest_sync_state(
                        conn,
                        chain_id=chain_id,
                        cursor=latest_block,
                        observed_at=now,
                        payload={
                            "status": "up_to_date",
                            "contracts": len(contracts),
                            "last_http_reconcile_at": now.isoformat(),
                            "wss_connected": wss_healthy,
                            "notifications_primed": True if cursor is not None else notifications_primed,
                        },
                    )
                    continue
                logging.info(
                    "Vault harvest sync: chain=%s contracts=%s from_block=%s to_block=%s wss_healthy=%s",
                    chain_id,
                    len(contracts),
                    start_block,
                    latest_block,
                    wss_healthy,
                )
                chain_inserted = 0
                chain_first_seen: datetime | None = None
                block_span = _harvest_block_span_for_chain(chain_id)
                max_block_span = block_span
                current_block = start_block
                addresses = sorted(contracts)
                while current_block <= latest_block:
                    end_block = min(latest_block, current_block + block_span - 1)
                    try:
                        for address_chunk in _chunked(addresses, 100):
                            logs = _eth_get_logs_for_chain(
                                chain_id,
                                addresses=address_chunk,
                                from_block=current_block,
                                to_block=end_block,
                                topics=[[EVENT_TOPIC_STRATEGY_REPORTED_V2, EVENT_TOPIC_STRATEGY_REPORTED_V3]],
                            )
                            rows: list[dict[str, object]] = []
                            for log in logs:
                                vault_address = str(log.get("address", "")).lower()
                                vault_version = contracts.get(vault_address)
                                if not vault_version:
                                    continue
                                row = _parse_harvest_row(
                                    chain_id=chain_id,
                                    vault_address=vault_address,
                                    vault_version=vault_version,
                                    log=log,
                                )
                                if row is None:
                                    continue
                                block_time = row["block_time"]
                                if isinstance(block_time, datetime) and (
                                    chain_first_seen is None or block_time < chain_first_seen
                                ):
                                    chain_first_seen = block_time
                                rows.append(row)
                            chain_inserted += _upsert_vault_harvests(conn, rows)
                            if cursor is not None and notifications_primed and rows:
                                _notify_harvest_rows(conn, rows)
                    except Exception as window_exc:
                        if block_span <= 1:
                            raise
                        next_block_span = max(1, block_span // 2)
                        logging.warning(
                            "Vault harvest log window retry: chain=%s from_block=%s to_block=%s span=%s next_span=%s error=%s",
                            chain_id,
                            current_block,
                            end_block,
                            block_span,
                            next_block_span,
                            window_exc,
                        )
                        block_span = next_block_span
                        continue
                    current_block = end_block + 1
                    if block_span < max_block_span:
                        block_span = min(max_block_span, block_span + math.ceil((max_block_span - block_span) / 2))
                _upsert_harvest_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=latest_block,
                    observed_at=datetime.now(UTC),
                    payload={
                        "status": "success",
                        "contracts": len(contracts),
                        "from_block": start_block,
                        "to_block": latest_block,
                        "inserted": chain_inserted,
                        "last_http_reconcile_at": datetime.now(UTC).isoformat(),
                        "last_http_mode": "backfill" if cursor is None else ("catchup" if not wss_healthy else "reconcile"),
                        "wss_connected": wss_healthy,
                        "notifications_primed": True,
                        "last_http_error": None,
                    },
                )
                inserted_total += chain_inserted
                if chain_first_seen is not None and (earliest_seen is None or chain_first_seen < earliest_seen):
                    earliest_seen = chain_first_seen
            except Exception as chain_exc:
                errors.append(f"{chain_id}:{chain_exc}")
                _upsert_harvest_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=_harvest_cursor(conn, chain_id),
                    observed_at=datetime.now(UTC),
                    payload={
                        "status": "failed",
                        "contracts": len(contracts),
                        "last_http_error": str(chain_exc),
                        "last_http_error_at": datetime.now(UTC).isoformat(),
                    },
                )
                logging.exception("Vault harvest chain failed: chain=%s error=%s", chain_id, chain_exc)
                continue
        if earliest_seen is None:
            earliest_seen = datetime.now(UTC) - timedelta(days=1)
        recomputed_days = _recompute_vault_harvest_daily_chain(conn, from_day=earliest_seen)
        status = "partial_success" if errors else "success"
        _complete_run(
            conn,
            run_id,
            status,
            inserted_total,
            json.dumps({"inserted": inserted_total, "recomputed_days": recomputed_days, "errors": errors}),
        )
        logging.info(
            "Vault harvest sync complete: status=%s inserted=%s recomputed_days=%s errors=%s",
            status,
            inserted_total,
            recomputed_days,
            len(errors),
        )
        return inserted_total, recomputed_days
    except Exception as exc:
        _complete_run(conn, run_id, "failed", inserted_total, json.dumps({"error": str(exc), "errors": errors}))
        logging.exception("Vault harvest sync failed: %s", exc)
        return inserted_total, recomputed_days


def _safe_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _styfi_epoch_start(genesis: int, epoch: int) -> datetime:
    return datetime.fromtimestamp(genesis + epoch * STYFI_EPOCH_LENGTH_SEC, tz=UTC)


def _styfi_component_reward(epoch: int, component_address: str) -> int:
    return _eth_call_uint(
        STYFI_CONTRACTS["reward_distributor"],
        "rewards(address,uint256)",
        ("address", component_address),
        ("uint256", epoch),
    )


def _fetch_styfi_site_reward_state() -> dict[str, object] | None:
    if not STYFI_SITE_GLOBAL_DATA_URL:
        return None
    response = requests.get(
        STYFI_SITE_GLOBAL_DATA_URL,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        timeout=ETH_CALL_TIMEOUT_SEC,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected stYFI global-data payload: {payload!r}")
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    global_rewards = payload.get("global", {}).get("rewards") if isinstance(payload.get("global"), dict) else {}
    styfi = payload.get("styfi") if isinstance(payload.get("styfi"), dict) else {}
    styfix = payload.get("styfix") if isinstance(payload.get("styfix"), dict) else {}
    styfi_current = styfi.get("current") if isinstance(styfi.get("current"), dict) else {}
    styfi_projected = styfi.get("projected") if isinstance(styfi.get("projected"), dict) else {}
    styfix_current = styfix.get("current") if isinstance(styfix.get("current"), dict) else {}
    styfix_projected = styfix.get("projected") if isinstance(styfix.get("projected"), dict) else {}
    return {
        "source": STYFI_SITE_GLOBAL_DATA_URL,
        "meta": {
            "timestamp": _safe_int(meta.get("timestamp")),
            "epoch": _safe_int(meta.get("epoch")),
            "block_number": _safe_int(meta.get("blockNumber")),
        },
        "global_rewards": {
            "current_raw": _safe_int(global_rewards.get("current")),
            "projected_raw": _safe_int(global_rewards.get("projected")),
            "pps_raw": _safe_int(global_rewards.get("pps")),
            "apy_bps": _safe_int(global_rewards.get("apyBps")),
        },
        "styfi": {
            "current_rewards_raw": _safe_int(styfi_current.get("rewards")),
            "current_apr_bps": _safe_int(styfi_current.get("aprBps")),
            "projected_rewards_raw": _safe_int(styfi_projected.get("rewards")),
            "projected_apr_bps": _safe_int(styfi_projected.get("aprBps")),
        },
        "styfix": {
            "current_rewards_raw": _safe_int(styfix_current.get("rewards")),
            "current_apr_bps": _safe_int(styfix_current.get("aprBps")),
            "projected_rewards_raw": _safe_int(styfix_projected.get("rewards")),
            "projected_apr_bps": _safe_int(styfix_projected.get("aprBps")),
        },
    }


def _fetch_styfi_snapshot_data() -> tuple[dict[str, object], list[dict[str, object]], dict[str, object]]:
    observed_at = datetime.now(UTC)
    reward_token_address = _eth_call_address(STYFI_CONTRACTS["reward_distributor"], "token()")
    reward_token_decimals = _eth_call_uint(reward_token_address, "decimals()")
    reward_token_symbol = _eth_call_string(reward_token_address, "symbol()")
    current_epoch = _eth_call_uint(STYFI_CONTRACTS["reward_distributor"], "epoch()")
    genesis = _eth_call_uint(STYFI_CONTRACTS["reward_distributor"], "genesis()")
    yfi_total_supply = _eth_call_uint(STYFI_CONTRACTS["yfi"], "totalSupply()")
    styfi_total_assets = _eth_call_uint(STYFI_CONTRACTS["styfi"], "totalAssets()")
    styfi_total_supply = _eth_call_uint(STYFI_CONTRACTS["styfi"], "totalSupply()")
    styfix_total_assets = _eth_call_uint(STYFI_CONTRACTS["styfix"], "totalAssets()")
    styfix_total_supply = _eth_call_uint(STYFI_CONTRACTS["styfix"], "totalSupply()")
    combined_staked = styfi_total_assets + styfix_total_assets
    reward_state = None
    try:
        reward_state = _fetch_styfi_site_reward_state()
    except Exception as exc:
        logging.warning("stYFI global-data fetch failed: %s", exc)

    snapshot = {
        "chain_id": STYFI_CHAIN_ID,
        "observed_at": observed_at,
        "reward_epoch": current_epoch,
        "yfi_total_supply_raw": yfi_total_supply,
        "styfi_total_assets_raw": styfi_total_assets,
        "styfi_total_supply_raw": styfi_total_supply,
        "styfix_total_assets_raw": styfix_total_assets,
        "styfix_total_supply_raw": styfix_total_supply,
        "combined_staked_raw": combined_staked,
    }

    start_epoch = max(0, current_epoch - STYFI_EPOCH_LOOKBACK + 1)
    epochs: list[dict[str, object]] = []
    for epoch in range(start_epoch, current_epoch + 1):
        reward_total = _eth_call_uint(STYFI_CONTRACTS["reward_distributor"], "epoch_rewards(uint256)", ("uint256", epoch))
        epochs.append(
            {
                "chain_id": STYFI_CHAIN_ID,
                "epoch": epoch,
                "epoch_start": _styfi_epoch_start(genesis, epoch),
                "reward_total_raw": reward_total,
                "reward_styfi_raw": _styfi_component_reward(epoch, STYFI_CONTRACTS["styfi_reward_distributor"]),
                "reward_styfix_raw": _styfi_component_reward(epoch, STYFI_CONTRACTS["styfix_reward_distributor"]),
                "reward_veyfi_raw": _styfi_component_reward(epoch, STYFI_CONTRACTS["veyfi_reward_distributor"]),
                "reward_liquid_lockers_raw": _styfi_component_reward(
                    epoch, STYFI_CONTRACTS["liquid_locker_reward_distributor"]
                ),
            }
        )

    sync_state = {
        "stream_name": STYFI_STREAM_STATE,
        "chain_id": STYFI_CHAIN_ID,
        "cursor": current_epoch,
        "observed_at": observed_at,
        "payload": {
            "genesis": genesis,
            "epoch_lookback": STYFI_EPOCH_LOOKBACK,
            "contracts": STYFI_CONTRACTS,
            "reward_token": {
                "address": reward_token_address,
                "decimals": reward_token_decimals,
                "symbol": reward_token_symbol,
            },
            "current_reward_state": reward_state,
        },
    }
    return snapshot, epochs, sync_state


def _upsert_styfi_snapshot(conn: psycopg.Connection, snapshot: dict[str, object]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO styfi_snapshots (
                chain_id,
                observed_at,
                reward_epoch,
                yfi_total_supply_raw,
                styfi_total_assets_raw,
                styfi_total_supply_raw,
                styfix_total_assets_raw,
                styfix_total_supply_raw,
                combined_staked_raw
            ) VALUES (
                %(chain_id)s,
                %(observed_at)s,
                %(reward_epoch)s,
                %(yfi_total_supply_raw)s,
                %(styfi_total_assets_raw)s,
                %(styfi_total_supply_raw)s,
                %(styfix_total_assets_raw)s,
                %(styfix_total_supply_raw)s,
                %(combined_staked_raw)s
            )
            ON CONFLICT (chain_id, observed_at) DO UPDATE SET
                reward_epoch = EXCLUDED.reward_epoch,
                yfi_total_supply_raw = EXCLUDED.yfi_total_supply_raw,
                styfi_total_assets_raw = EXCLUDED.styfi_total_assets_raw,
                styfi_total_supply_raw = EXCLUDED.styfi_total_supply_raw,
                styfix_total_assets_raw = EXCLUDED.styfix_total_assets_raw,
                styfix_total_supply_raw = EXCLUDED.styfix_total_supply_raw,
                combined_staked_raw = EXCLUDED.combined_staked_raw
            """,
            snapshot,
        )
    conn.commit()


def _upsert_styfi_epoch_stats(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO styfi_epoch_stats (
                chain_id,
                epoch,
                epoch_start,
                reward_total_raw,
                reward_styfi_raw,
                reward_styfix_raw,
                reward_veyfi_raw,
                reward_liquid_lockers_raw
            ) VALUES (
                %(chain_id)s,
                %(epoch)s,
                %(epoch_start)s,
                %(reward_total_raw)s,
                %(reward_styfi_raw)s,
                %(reward_styfix_raw)s,
                %(reward_veyfi_raw)s,
                %(reward_liquid_lockers_raw)s
            )
            ON CONFLICT (chain_id, epoch) DO UPDATE SET
                epoch_start = EXCLUDED.epoch_start,
                reward_total_raw = EXCLUDED.reward_total_raw,
                reward_styfi_raw = EXCLUDED.reward_styfi_raw,
                reward_styfix_raw = EXCLUDED.reward_styfix_raw,
                reward_veyfi_raw = EXCLUDED.reward_veyfi_raw,
                reward_liquid_lockers_raw = EXCLUDED.reward_liquid_lockers_raw,
                fetched_at = NOW()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def _upsert_styfi_sync_state(conn: psycopg.Connection, state: dict[str, object]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO styfi_sync_state (
                stream_name,
                chain_id,
                cursor,
                observed_at,
                payload,
                updated_at
            ) VALUES (
                %(stream_name)s,
                %(chain_id)s,
                %(cursor)s,
                %(observed_at)s,
                %(payload)s,
                NOW()
            )
            ON CONFLICT (stream_name) DO UPDATE SET
                chain_id = EXCLUDED.chain_id,
                cursor = EXCLUDED.cursor,
                observed_at = EXCLUDED.observed_at,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            """,
            {**state, "payload": Json(state["payload"])},
        )
    conn.commit()


def _select_product_activity_contracts(conn: psycopg.Connection) -> dict[int, dict[str, str]]:
    targets: dict[int, dict[str, str]] = {}
    supported_chain_ids = sorted(CHAIN_RPC_URLS)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address
            FROM vault_dim
            WHERE
                version LIKE '3.%%'
                AND
                (active = TRUE OR COALESCE(tvl_usd, 0) > 0)
                AND chain_id = ANY(%(supported_chain_ids)s)
            ORDER BY chain_id, vault_address
            """,
            {"supported_chain_ids": supported_chain_ids},
        )
        for chain_id, vault_address in cur.fetchall():
            chain_targets = targets.setdefault(int(chain_id), {})
            chain_targets[str(vault_address).lower()] = "vault"
    conn.commit()
    ethereum_targets = targets.setdefault(STYFI_CHAIN_ID, {})
    ethereum_targets[STYFI_CONTRACTS["styfi"]] = "styfi"
    ethereum_targets[STYFI_CONTRACTS["styfix"]] = "styfix"
    return {chain_id: mapping for chain_id, mapping in targets.items() if mapping}


def _topic_address(topics: list[object], index: int) -> str | None:
    if index >= len(topics):
        return None
    topic = str(topics[index] or "").lower()
    if not topic.startswith("0x") or len(topic) < 42:
        return None
    return f"0x{topic[-40:]}"


def _product_activity_accounts(
    *,
    product_type: str,
    event_kind: str,
    topics: list[object],
) -> tuple[str | None, str | None, str | None]:
    if event_kind == "deposit":
        sender = _topic_address(topics, 1)
        owner = _topic_address(topics, 2)
        return sender, owner, "event_owner"
    if event_kind == "withdraw":
        sender = _topic_address(topics, 1)
        owner = _topic_address(topics, 3)
        return sender, owner, "event_owner"
    if event_kind == "unstake" and product_type in {"styfi", "styfix"}:
        from_account = _topic_address(topics, 1)
        to_account = _topic_address(topics, 2)
        if from_account and to_account == "0x0000000000000000000000000000000000000000":
            return from_account, from_account, "event_burn_from"
    if event_kind == "claim" and product_type in {"styfi", "styfix"}:
        account = _topic_address(topics, 1)
        if account and account not in STYFI_CLAIM_IGNORED_ACCOUNTS:
            return account, account, "event_claim_account"
    return None, None, None


def _product_activity_claim_rows(
    *,
    claim_logs: list[dict[str, object]],
    chain_id: int,
    reward_token_meta: dict[str, object],
) -> list[dict[str, object]]:
    if not claim_logs:
        return []
    candidates_by_tx: dict[str, list[dict[str, object]]] = {}
    for log in claim_logs:
        topics = log.get("topics")
        if not isinstance(topics, list) or not topics:
            continue
        product_contract = str(log.get("address", "")).lower()
        source_kind = STYFI_CLAIM_SOURCES.get(product_contract)
        if not source_kind:
            continue
        account = _topic_address(topics, 1)
        if not account or account in STYFI_CLAIM_IGNORED_ACCOUNTS:
            continue
        tx_hash = str(log.get("transactionHash", "")).lower()
        if not tx_hash:
            continue
        block_number = _hex_to_int(log.get("blockNumber"))
        log_index = _hex_to_int(log.get("logIndex"))
        block_timestamp = _hex_to_int(log.get("blockTimestamp"))
        if block_number is None or log_index is None:
            continue
        if block_timestamp is None:
            block = _eth_get_block_for_chain(chain_id, block_number)
            block_timestamp = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
        if block_timestamp is None:
            continue
        block_time = datetime.fromtimestamp(block_timestamp, tz=UTC)
        candidates_by_tx.setdefault(tx_hash, []).append(
            {
                "chain_id": chain_id,
                "block_number": block_number,
                "block_time": block_time,
                "tx_hash": tx_hash,
                "log_index": log_index,
                "source_kind": source_kind,
                "product_contract": product_contract,
                "event_topic0": EVENT_TOPIC_CLAIM,
                "account": account,
                "data": log.get("data"),
            }
        )
    rows: list[dict[str, object]] = []
    for tx_hash, candidates in candidates_by_tx.items():
        by_account: dict[str, list[dict[str, object]]] = {}
        for candidate in candidates:
            by_account.setdefault(str(candidate["account"]), []).append(candidate)
        for account, account_candidates in by_account.items():
            specific = [c for c in account_candidates if c["source_kind"] in {"styfi", "styfix"}]
            if not specific:
                continue
            kept_by_product: dict[str, dict[str, object]] = {}
            for candidate in specific:
                product_type = str(candidate["source_kind"])
                current = kept_by_product.get(product_type)
                if current is None or int(candidate["log_index"]) < int(current["log_index"]):
                    kept_by_product[product_type] = candidate
            for product_type, candidate in kept_by_product.items():
                rows.append(
                    {
                        "chain_id": int(candidate["chain_id"]),
                        "block_number": int(candidate["block_number"]),
                        "block_time": candidate["block_time"],
                        "tx_hash": tx_hash,
                        "log_index": int(candidate["log_index"]),
                        "product_type": product_type,
                        "product_contract": str(candidate["product_contract"]),
                        "event_kind": "claim",
                        "event_topic0": str(candidate["event_topic0"]),
                        "tx_from": account,
                        "user_account": account,
                        "attribution_kind": "event_claim_tx_account",
                        **_product_activity_amount_payload(
                            product_type=product_type,
                            event_kind="claim",
                            data=candidate.get("data"),
                            reward_token_meta=reward_token_meta,
                        ),
                    }
                )
    return rows


def _product_activity_cursor(conn: psycopg.Connection, chain_id: int) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cursor
            FROM product_activity_sync_state
            WHERE chain_id = %s
            """,
            (chain_id,),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    value = row[0]
    return int(value) if value is not None else None


def _upsert_product_activity_sync_state(
    conn: psycopg.Connection,
    *,
    chain_id: int,
    cursor: int,
    observed_at: datetime,
    payload: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO product_activity_sync_state (
                chain_id,
                cursor,
                observed_at,
                payload,
                updated_at
            ) VALUES (
                %(chain_id)s,
                %(cursor)s,
                %(observed_at)s,
                %(payload)s,
                NOW()
            )
            ON CONFLICT (chain_id) DO UPDATE SET
                cursor = EXCLUDED.cursor,
                observed_at = EXCLUDED.observed_at,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            """,
            {
                "chain_id": chain_id,
                "cursor": cursor,
                "observed_at": observed_at,
                "payload": Json(payload),
            },
        )
    conn.commit()


def _upsert_product_interactions(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO product_interactions (
                chain_id,
                block_number,
                block_time,
                tx_hash,
                log_index,
                product_type,
                product_contract,
                event_kind,
                event_topic0,
                tx_from,
                user_account,
                attribution_kind,
                amount_raw,
                amount_decimals,
                amount_symbol
            ) VALUES (
                %(chain_id)s,
                %(block_number)s,
                %(block_time)s,
                %(tx_hash)s,
                %(log_index)s,
                %(product_type)s,
                %(product_contract)s,
                %(event_kind)s,
                %(event_topic0)s,
                %(tx_from)s,
                %(user_account)s,
                %(attribution_kind)s,
                %(amount_raw)s,
                %(amount_decimals)s,
                %(amount_symbol)s
            )
            ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
                amount_raw = COALESCE(product_interactions.amount_raw, EXCLUDED.amount_raw),
                amount_decimals = COALESCE(product_interactions.amount_decimals, EXCLUDED.amount_decimals),
                amount_symbol = COALESCE(product_interactions.amount_symbol, EXCLUDED.amount_symbol)
            """,
            rows,
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _recompute_product_dau_daily(conn: psycopg.Connection, *, from_day: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM product_dau_daily
            WHERE day_utc >= %s::date
            """,
            (from_day.date(),),
        )
        cur.execute(
            """
            INSERT INTO product_dau_daily (
                day_utc,
                dau_total,
                dau_vaults,
                dau_styfi,
                dau_styfix,
                computed_at
            )
            SELECT
                (block_time AT TIME ZONE 'UTC')::date AS day_utc,
                COUNT(DISTINCT user_account) AS dau_total,
                COUNT(DISTINCT CASE WHEN product_type = 'vault' THEN user_account END) AS dau_vaults,
                COUNT(DISTINCT CASE WHEN product_type = 'styfi' THEN user_account END) AS dau_styfi,
                COUNT(DISTINCT CASE WHEN product_type = 'styfix' THEN user_account END) AS dau_styfix,
                NOW()
            FROM product_interactions
            WHERE block_time >= %s::date
            GROUP BY 1
            ORDER BY 1
            """,
            (from_day.date(),),
        )
        inserted = cur.rowcount
    conn.commit()
    return inserted


def _run_product_dau(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_PRODUCT_DAU, started_at)
    inserted_total = 0
    recomputed_days = 0
    earliest_seen: datetime | None = None
    errors: list[str] = []
    try:
        targets = _select_product_activity_contracts(conn)
        reward_token_meta = _product_activity_reward_token_meta(conn)
        for chain_id, contracts in targets.items():
            try:
                rpc_url = _rpc_url_for_chain(chain_id)
                if not rpc_url:
                    errors.append(f"{chain_id}:missing_rpc")
                    continue
                latest_block = _eth_block_number_for_chain(chain_id)
                cursor = _product_activity_cursor(conn, chain_id)
                if cursor is None:
                    backfill_start = int((datetime.now(UTC) - timedelta(days=PRODUCT_ACTIVITY_BACKFILL_DAYS)).timestamp())
                    start_block = _find_block_at_or_after(chain_id, backfill_start)
                else:
                    start_block = cursor + 1
                if start_block > latest_block:
                    _upsert_product_activity_sync_state(
                        conn,
                        chain_id=chain_id,
                        cursor=latest_block,
                        observed_at=datetime.now(UTC),
                        payload={"status": "up_to_date", "contracts": len(contracts)},
                    )
                    continue
                logging.info(
                    "Product DAU sync: chain=%s contracts=%s from_block=%s to_block=%s",
                    chain_id,
                    len(contracts),
                    start_block,
                    latest_block,
                )
                chain_inserted = 0
                chain_first_seen: datetime | None = None
                vault_addresses = sorted(address for address, product_type in contracts.items() if product_type == "vault")
                styfi_addresses = sorted(address for address in contracts if address in STYFI_EVENT_CONTRACTS)
                styfi_claim_addresses = sorted(STYFI_CLAIM_SOURCES) if chain_id == STYFI_CHAIN_ID else []
                max_block_span = _product_activity_block_span_for_chain(chain_id)
                block_span = max_block_span
                current_block = start_block
                while current_block <= latest_block:
                    end_block = min(latest_block, current_block + block_span - 1)
                    try:
                        query_groups: list[tuple[list[str], list[list[str]]]] = []
                        if vault_addresses:
                            query_groups.append(
                                (
                                    vault_addresses,
                                    [[EVENT_TOPIC_DEPOSIT, EVENT_TOPIC_WITHDRAW]],
                                )
                            )
                        if styfi_addresses:
                            query_groups.append(
                                (
                                    styfi_addresses,
                                    [[EVENT_TOPIC_DEPOSIT, EVENT_TOPIC_WITHDRAW, EVENT_TOPIC_TRANSFER]],
                                )
                            )
                        if styfi_claim_addresses:
                            query_groups.append(
                                (
                                    styfi_claim_addresses,
                                    [[EVENT_TOPIC_CLAIM]],
                                )
                            )
                        for addresses, topics_filter in query_groups:
                            for address_chunk in _chunked(addresses, 100):
                                logs = _eth_get_logs_for_chain(
                                    chain_id,
                                    addresses=address_chunk,
                                    from_block=current_block,
                                    to_block=end_block,
                                    topics=topics_filter,
                                )
                                rows: list[dict[str, object]] = []
                                for log in logs:
                                    topics = log.get("topics")
                                    if not isinstance(topics, list) or not topics:
                                        continue
                                    topic0 = str(topics[0]).lower()
                                    event_kind = PRODUCT_ACTIVITY_TOPICS.get(topic0)
                                    if not event_kind:
                                        continue
                                    if event_kind == "claim":
                                        continue
                                    product_contract = str(log.get("address", "")).lower()
                                    product_type = contracts.get(product_contract)
                                    if not product_type:
                                        continue
                                    event_sender, user_account, attribution_kind = _product_activity_accounts(
                                        product_type=product_type,
                                        event_kind=event_kind,
                                        topics=topics,
                                    )
                                    if not event_sender or not user_account or not attribution_kind:
                                        continue
                                    tx_hash = str(log.get("transactionHash", "")).lower()
                                    if not tx_hash:
                                        continue
                                    block_number = _hex_to_int(log.get("blockNumber"))
                                    log_index = _hex_to_int(log.get("logIndex"))
                                    block_timestamp = _hex_to_int(log.get("blockTimestamp"))
                                    if block_number is None or log_index is None:
                                        continue
                                    if block_timestamp is None:
                                        block = _eth_get_block_for_chain(chain_id, block_number)
                                        block_timestamp = _hex_to_int(block.get("timestamp")) if isinstance(block, dict) else None
                                    if block_timestamp is None:
                                        continue
                                    block_time = datetime.fromtimestamp(block_timestamp, tz=UTC)
                                    if chain_first_seen is None or block_time < chain_first_seen:
                                        chain_first_seen = block_time
                                    rows.append(
                                        {
                                            "chain_id": chain_id,
                                            "block_number": block_number,
                                            "block_time": block_time,
                                            "tx_hash": tx_hash,
                                            "log_index": log_index,
                                            "product_type": product_type,
                                            "product_contract": product_contract,
                                            "event_kind": event_kind,
                                            "event_topic0": topic0,
                                            "tx_from": event_sender,
                                            "user_account": user_account,
                                            "attribution_kind": attribution_kind,
                                            **_product_activity_amount_payload(
                                                product_type=product_type,
                                                event_kind=event_kind,
                                                data=log.get("data"),
                                                reward_token_meta=reward_token_meta,
                                            ),
                                        }
                                    )
                                chain_inserted += _upsert_product_interactions(conn, rows)
                                if chain_id == STYFI_CHAIN_ID and cursor is not None and rows:
                                    styfi_rows = [row for row in rows if str(row.get("product_type")) in {"styfi", "styfix"}]
                                    if styfi_rows:
                                        _notify_styfi_activity_rows(conn, styfi_rows)
                                if topics_filter == [[EVENT_TOPIC_CLAIM]]:
                                    claim_rows = _product_activity_claim_rows(
                                        claim_logs=logs,
                                        chain_id=chain_id,
                                        reward_token_meta=reward_token_meta,
                                    )
                                    if claim_rows:
                                        chain_inserted += _upsert_product_interactions(conn, claim_rows)
                                        if chain_id == STYFI_CHAIN_ID and cursor is not None:
                                            _notify_styfi_activity_rows(conn, claim_rows)
                    except Exception as window_exc:
                        if block_span <= 1:
                            raise
                        next_block_span = max(1, block_span // 2)
                        logging.warning(
                            "Product DAU log window retry: chain=%s from_block=%s to_block=%s span=%s next_span=%s error=%s",
                            chain_id,
                            current_block,
                            end_block,
                            block_span,
                            next_block_span,
                            window_exc,
                        )
                        block_span = next_block_span
                        continue
                    current_block = end_block + 1
                    if block_span < max_block_span:
                        block_span = min(max_block_span, block_span + math.ceil((max_block_span - block_span) / 2))
                _upsert_product_activity_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=latest_block,
                    observed_at=datetime.now(UTC),
                    payload={
                        "status": "success",
                        "contracts": len(contracts),
                        "from_block": start_block,
                        "to_block": latest_block,
                        "inserted": chain_inserted,
                    },
                )
                logging.info(
                    "Product DAU chain complete: chain=%s inserted=%s",
                    chain_id,
                    chain_inserted,
                )
                inserted_total += chain_inserted
                if chain_first_seen is not None and (earliest_seen is None or chain_first_seen < earliest_seen):
                    earliest_seen = chain_first_seen
            except Exception as chain_exc:
                errors.append(f"{chain_id}:{chain_exc}")
                _upsert_product_activity_sync_state(
                    conn,
                    chain_id=chain_id,
                    cursor=_product_activity_cursor(conn, chain_id),
                    observed_at=datetime.now(UTC),
                    payload={"status": "failed", "contracts": len(contracts), "error": str(chain_exc)},
                )
                logging.exception("Product DAU chain failed: chain=%s error=%s", chain_id, chain_exc)
                continue
        if earliest_seen is None:
            earliest_seen = datetime.now(UTC) - timedelta(days=1)
        recomputed_days = _recompute_product_dau_daily(conn, from_day=earliest_seen)
        status = "partial_success" if errors else "success"
        _complete_run(
            conn,
            run_id,
            status,
            inserted_total,
            json.dumps({"inserted": inserted_total, "recomputed_days": recomputed_days, "errors": errors}),
        )
        logging.info(
            "Product DAU sync complete: status=%s inserted=%s recomputed_days=%s errors=%s",
            status,
            inserted_total,
            recomputed_days,
            len(errors),
        )
        return run_id, inserted_total
    except Exception as exc:
        _complete_run(
            conn,
            run_id,
            "failed",
            inserted_total,
            json.dumps({"error": str(exc), "inserted": inserted_total, "recomputed_days": recomputed_days, "errors": errors}),
        )
        logging.exception("Product DAU sync failed: %s", exc)
        return run_id, inserted_total


def _backfill_styfi_activity_amounts(conn: psycopg.Connection, *, limit: int = 500) -> int:
    reward_token_meta = _product_activity_reward_token_meta(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                chain_id,
                tx_hash,
                log_index,
                product_type,
                event_kind,
                product_contract
            FROM product_interactions
            WHERE
                chain_id = %(chain_id)s
                AND product_type IN ('styfi', 'styfix')
                AND (amount_raw IS NULL OR amount_decimals IS NULL OR COALESCE(amount_symbol, '') = '')
            ORDER BY block_time DESC, tx_hash DESC, log_index DESC
            LIMIT %(limit)s
            """,
            {"chain_id": STYFI_CHAIN_ID, "limit": limit},
        )
        pending = cur.fetchall()
    conn.commit()
    if not pending:
        return 0
    by_tx: dict[str, list[dict[str, object]]] = {}
    for chain_id, tx_hash, log_index, product_type, event_kind, product_contract in pending:
        by_tx.setdefault(str(tx_hash), []).append(
            {
                "chain_id": int(chain_id),
                "tx_hash": str(tx_hash),
                "log_index": int(log_index),
                "product_type": str(product_type),
                "event_kind": str(event_kind),
                "product_contract": str(product_contract).lower(),
            }
        )
    updates: list[dict[str, object]] = []
    for tx_hash, rows in by_tx.items():
        chain_id = int(rows[0]["chain_id"])
        try:
            receipt = _eth_get_transaction_receipt_for_chain(chain_id, tx_hash)
        except Exception as exc:
            logging.warning("stYFI amount backfill receipt fetch failed: tx=%s error=%s", tx_hash, exc)
            continue
        logs = receipt.get("logs")
        if not isinstance(logs, list):
            continue
        logs_by_index = {
            _hex_to_int(log.get("logIndex")): log
            for log in logs
            if isinstance(log, dict) and _hex_to_int(log.get("logIndex")) is not None
        }
        for row in rows:
            log = logs_by_index.get(int(row["log_index"]))
            if not isinstance(log, dict):
                continue
            payload = _product_activity_amount_payload(
                product_type=str(row["product_type"]),
                event_kind=str(row["event_kind"]),
                data=log.get("data"),
                reward_token_meta=reward_token_meta,
            )
            if payload["amount_raw"] is None and payload["amount_decimals"] is None and payload["amount_symbol"] is None:
                continue
            updates.append(
                {
                    "chain_id": chain_id,
                    "tx_hash": tx_hash,
                    "log_index": int(row["log_index"]),
                    "amount_raw": payload["amount_raw"],
                    "amount_decimals": payload["amount_decimals"],
                    "amount_symbol": payload["amount_symbol"],
                }
            )
    if not updates:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            UPDATE product_interactions
            SET
                amount_raw = COALESCE(amount_raw, %(amount_raw)s),
                amount_decimals = COALESCE(amount_decimals, %(amount_decimals)s),
                amount_symbol = COALESCE(amount_symbol, %(amount_symbol)s)
            WHERE
                chain_id = %(chain_id)s
                AND tx_hash = %(tx_hash)s
                AND log_index = %(log_index)s
            """,
            updates,
        )
        updated = cur.rowcount
    conn.commit()
    if updated > 0:
        logging.info("stYFI activity amount backfill updated=%s pending=%s", updated, len(pending))
    return updated

def _ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(DDL)
        cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_raw NUMERIC(78, 0)")
        cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_decimals INTEGER")
        cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_symbol TEXT")
        cur.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'vault_dim'
                      AND column_name = 'feature_score'
                ) THEN
                    ALTER TABLE vault_dim DROP COLUMN feature_score;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'vault_dim_pkey'
                      AND conrelid = 'vault_dim'::regclass
                      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (chain_id, vault_address)'
                ) THEN
                    ALTER TABLE vault_dim DROP CONSTRAINT vault_dim_pkey;
                    ALTER TABLE vault_dim ADD CONSTRAINT vault_dim_pkey PRIMARY KEY (chain_id, vault_address);
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'vault_dim'
                      AND column_name = 'apr_net'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'vault_dim'
                      AND column_name = 'est_apy'
                ) THEN
                    ALTER TABLE vault_dim RENAME COLUMN apr_net TO est_apy;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'pps_timeseries_pkey'
                      AND conrelid = 'pps_timeseries'::regclass
                      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (chain_id, vault_address, ts)'
                ) THEN
                    ALTER TABLE pps_timeseries DROP CONSTRAINT pps_timeseries_pkey;
                    ALTER TABLE pps_timeseries ADD CONSTRAINT pps_timeseries_pkey PRIMARY KEY (chain_id, vault_address, ts);
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'vault_metrics_latest_pkey'
                      AND conrelid = 'vault_metrics_latest'::regclass
                      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (chain_id, vault_address)'
                ) THEN
                    ALTER TABLE vault_metrics_latest DROP CONSTRAINT vault_metrics_latest_pkey;
                    ALTER TABLE vault_metrics_latest ADD CONSTRAINT vault_metrics_latest_pkey PRIMARY KEY (chain_id, vault_address);
                END IF;
            END
            $$;
            """
        )
        cur.execute(
            """
            DO $$
            DECLARE
                idx_def TEXT;
            BEGIN
                EXECUTE 'DROP INDEX IF EXISTS idx_vault_dim_active_rank';

                SELECT indexdef
                INTO idx_def
                FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'idx_vault_dim_active_tvl';
                IF idx_def IS NOT NULL
                   AND idx_def <> 'CREATE INDEX idx_vault_dim_active_tvl ON public.vault_dim USING btree (tvl_usd DESC NULLS LAST, chain_id, vault_address) WHERE (active = true)'
                THEN
                    EXECUTE 'DROP INDEX IF EXISTS idx_vault_dim_active_tvl';
                END IF;

                SELECT indexdef
                INTO idx_def
                FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'idx_vault_metrics_points';
                IF idx_def IS NOT NULL
                   AND idx_def <> 'CREATE INDEX idx_vault_metrics_points ON public.vault_metrics_latest USING btree (points_count DESC, chain_id, vault_address)'
                THEN
                    EXECUTE 'DROP INDEX IF EXISTS idx_vault_metrics_points';
                END IF;
            END
            $$;
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_vault_dim_active_tvl
                ON vault_dim(tvl_usd DESC NULLS LAST, chain_id, vault_address)
                WHERE active = TRUE;
            CREATE INDEX IF NOT EXISTS idx_vault_metrics_points
                ON vault_metrics_latest(points_count DESC, chain_id, vault_address);
            """
        )
    conn.commit()


def _active_vault_count(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM vault_dim WHERE active = TRUE")
        row = cur.fetchone()
    return int(row[0] if row else 0)


def _has_successful_run(conn: psycopg.Connection, job_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM ingestion_runs
            WHERE job_name = %s AND status = 'success'
            LIMIT 1
            """,
            (job_name,),
        )
        return cur.fetchone() is not None


def _assert_snapshot_size_guard(
    conn: psycopg.Connection,
    *,
    normalized_count: int,
    payload_count: int,
    skipped_missing_identity: int,
) -> None:
    previous_active = _active_vault_count(conn)
    if previous_active <= 0 or normalized_count >= previous_active:
        return
    if not _has_successful_run(conn, JOB_KONG_SNAPSHOT):
        logging.warning(
            "Skipping snapshot size guard for initial Kong snapshot migration "
            "(previous_active=%s normalized=%s payload=%s skipped_missing_identity=%s)",
            previous_active,
            normalized_count,
            payload_count,
            skipped_missing_identity,
        )
        return
    drop_count = previous_active - normalized_count
    min_allowed_rows = max(1, math.ceil(previous_active * SNAPSHOT_MIN_ACTIVE_RATIO))
    if normalized_count < min_allowed_rows and drop_count >= SNAPSHOT_MIN_DROP_COUNT:
        raise ValueError(
            "Snapshot guard triggered: normalized rows dropped below safety threshold "
            f"(previous_active={previous_active}, normalized={normalized_count}, min_allowed={min_allowed_rows}, "
            f"drop_count={drop_count}, payload={payload_count}, skipped_missing_identity={skipped_missing_identity})"
        )


def _insert_run(conn: psycopg.Connection, job_name: str, started_at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ingestion_runs (job_name, started_at, status)
            VALUES (%s, %s, 'running')
            RETURNING id
            """,
            (job_name, started_at),
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def _mark_stale_running_runs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET
                status = 'abandoned',
                ended_at = NOW(),
                error_summary = COALESCE(
                    error_summary,
                    json_build_object(
                        'error',
                        'marked abandoned by worker due to stale running status',
                        'stale_threshold_seconds',
                        %s
                    )::text
                )
            WHERE status = 'running'
              AND started_at < NOW() - (%s * INTERVAL '1 second')
            """,
            (RUNNING_STALE_SECONDS, RUNNING_STALE_SECONDS),
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def _mark_boot_orphaned_runs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET
                status = 'abandoned',
                ended_at = NOW(),
                error_summary = COALESCE(
                    error_summary,
                    json_build_object(
                        'error',
                        'marked abandoned on worker boot due to orphan running status'
                    )::text
                )
            WHERE status = 'running'
            """
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def _complete_run(conn: psycopg.Connection, run_id: int, status: str, records: int, error_summary: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET ended_at = %s, status = %s, records = %s, error_summary = %s
            WHERE id = %s
            """,
            (datetime.now(UTC), status, records, error_summary, run_id),
        )
    conn.commit()


def _chain_label(chain_id: int) -> str:
    return CHAIN_LABELS.get(chain_id, str(chain_id))


def _explorer_base_url(chain_id: int) -> str | None:
    return EXPLORER_BASE_URLS.get(chain_id)


def _explorer_tx_url(chain_id: int, tx_hash: str) -> str | None:
    base = _explorer_base_url(chain_id)
    if not base:
        return None
    return f"{base}/tx/{tx_hash}"


def _explorer_address_url(chain_id: int, address: str) -> str | None:
    base = _explorer_base_url(chain_id)
    if not base:
        return None
    return f"{base}/address/{address}"


def _yearn_vault_url(chain_id: int, vault_address: str) -> str:
    return f"https://yearn.fi/vaults/{chain_id}/{vault_address}"


def _short_hex(value: str, *, left: int = 6, right: int = 4) -> str:
    if len(value) <= left + right + 2:
        return value
    return f"{value[: left + 2]}…{value[-right:]}"


def _discord_timestamp(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    ts = int(dt.timestamp())
    return f"<t:{ts}:f> (<t:{ts}:R>)"


def _format_amount(raw_value: object, decimals: int | None, symbol: str | None) -> str:
    if raw_value is None:
        return "n/a"
    digits = str(raw_value).strip()
    if not digits:
        return "n/a"
    normalized = digits.lstrip("0") or "0"
    scale = max(0, decimals or 0)
    padded = normalized.rjust(scale + 1, "0")
    whole = padded[:-scale] if scale > 0 else padded
    fraction = padded[-scale:] if scale > 0 else ""
    whole_with_commas = f"{int(whole):,}"
    if not fraction:
        return f"{whole_with_commas} {symbol}".strip()
    trimmed_fraction = fraction.rstrip("0")
    if not trimmed_fraction:
        return f"{whole_with_commas} {symbol}".strip()
    visible_fraction = trimmed_fraction[:6]
    suffix = "…" if len(trimmed_fraction) > 6 else ""
    return f"{whole_with_commas}.{visible_fraction}{suffix} {symbol}".strip()


def _harvest_destination(chain_id: int) -> dict[str, object] | None:
    destination = HARVEST_DISCORD_DESTINATIONS.get(chain_id)
    if not destination or not destination.get("webhook_url"):
        return None
    return destination


def _notification_webhook_url(destination_key: str) -> str | None:
    if destination_key == STYFI_DISCORD_DESTINATION["destination_key"]:
        webhook_url = STYFI_DISCORD_DESTINATION.get("webhook_url")
        return str(webhook_url) if webhook_url else None
    for destination in HARVEST_DISCORD_DESTINATIONS.values():
        if destination["destination_key"] == destination_key:
            webhook_url = destination.get("webhook_url")
            return str(webhook_url) if webhook_url else None
    return None


def _get_notification_delivery(
    conn: psycopg.Connection,
    *,
    source_type: str,
    chain_id: int,
    tx_hash: str,
    log_index: int,
    destination_key: str,
) -> dict[str, object] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, attempts, payload
            FROM notification_deliveries
            WHERE
                source_type = %s
                AND chain_id = %s
                AND tx_hash = %s
                AND log_index = %s
                AND destination_key = %s
            """,
            (source_type, chain_id, tx_hash, log_index, destination_key),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    return {"status": row[0], "attempts": int(row[1] or 0), "payload": row[2]}


def _upsert_notification_delivery(
    conn: psycopg.Connection,
    *,
    source_type: str,
    chain_id: int,
    tx_hash: str,
    log_index: int,
    destination_key: str,
    status: str,
    payload: dict[str, object],
    error: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notification_deliveries (
                source_type,
                chain_id,
                tx_hash,
                log_index,
                destination_key,
                status,
                attempts,
                last_attempted_at,
                delivered_at,
                last_error,
                payload
            ) VALUES (
                %(source_type)s,
                %(chain_id)s,
                %(tx_hash)s,
                %(log_index)s,
                %(destination_key)s,
                %(status)s,
                1,
                NOW(),
                CASE WHEN %(status)s = 'sent' THEN NOW() ELSE NULL END,
                %(error)s,
                %(payload)s
            )
            ON CONFLICT (source_type, chain_id, tx_hash, log_index, destination_key) DO UPDATE SET
                status = EXCLUDED.status,
                attempts = notification_deliveries.attempts + 1,
                last_attempted_at = NOW(),
                delivered_at = CASE
                    WHEN EXCLUDED.status = 'sent' THEN NOW()
                    ELSE notification_deliveries.delivered_at
                END,
                last_error = EXCLUDED.last_error,
                payload = EXCLUDED.payload
            """,
            {
                "source_type": source_type,
                "chain_id": chain_id,
                "tx_hash": tx_hash,
                "log_index": log_index,
                "destination_key": destination_key,
                "status": status,
                "error": error,
                "payload": Json(payload),
            },
        )
    conn.commit()


def _send_discord_payload(webhook_url: str, payload: dict[str, object]) -> None:
    response = requests.post(webhook_url, json=payload, timeout=10)
    response.raise_for_status()


def _deliver_discord_notification(
    conn: psycopg.Connection,
    *,
    source_type: str,
    chain_id: int,
    tx_hash: str,
    log_index: int,
    destination_key: str,
    payload: dict[str, object],
) -> bool:
    existing = _get_notification_delivery(
        conn,
        source_type=source_type,
        chain_id=chain_id,
        tx_hash=tx_hash,
        log_index=log_index,
        destination_key=destination_key,
    )
    if existing and existing.get("status") == "sent":
        return False
    webhook_url = _notification_webhook_url(destination_key)
    if not webhook_url:
        return False
    try:
        _send_discord_payload(webhook_url, payload)
        _upsert_notification_delivery(
            conn,
            source_type=source_type,
            chain_id=chain_id,
            tx_hash=tx_hash,
            log_index=log_index,
            destination_key=destination_key,
            status="sent",
            payload=payload,
            error=None,
        )
        return True
    except Exception as exc:
        _upsert_notification_delivery(
            conn,
            source_type=source_type,
            chain_id=chain_id,
            tx_hash=tx_hash,
            log_index=log_index,
            destination_key=destination_key,
            status="failed",
            payload=payload,
            error=str(exc),
        )
        logging.warning(
            "Discord delivery failed: source=%s chain=%s tx=%s log_index=%s destination=%s error=%s",
            source_type,
            chain_id,
            tx_hash,
            log_index,
            destination_key,
            exc,
        )
        return False


def _harvest_vault_meta(conn: psycopg.Connection, *, chain_id: int, vault_address: str) -> dict[str, object]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT name, symbol, token_symbol, token_decimals
            FROM vault_dim
            WHERE chain_id = %s AND vault_address = %s
            """,
            (chain_id, vault_address),
        )
        row = cur.fetchone()
    conn.commit()
    if not row:
        return {"name": None, "symbol": None, "token_symbol": None, "token_decimals": None}
    return {
        "name": row[0],
        "symbol": row[1],
        "token_symbol": row[2],
        "token_decimals": _to_int_or_none(row[3]),
    }


def _build_harvest_discord_payload(
    conn: psycopg.Connection,
    *,
    row: dict[str, object],
) -> tuple[str, dict[str, object]] | None:
    chain_id = int(row["chain_id"])
    destination = _harvest_destination(chain_id)
    if not destination:
        return None
    vault_address = str(row["vault_address"]).lower()
    strategy_address = str(row["strategy_address"]).lower()
    tx_hash = str(row["tx_hash"]).lower()
    block_time = row["block_time"]
    if not isinstance(block_time, datetime):
        return None
    meta = _harvest_vault_meta(conn, chain_id=chain_id, vault_address=vault_address)
    vault_symbol = str(meta.get("symbol") or _short_hex(vault_address))
    token_symbol = str(meta.get("token_symbol") or "")
    token_decimals = _to_int_or_none(meta.get("token_decimals"))
    gain_text = _format_amount(row.get("gain"), token_decimals, token_symbol)
    fee_text = _format_amount(row.get("fee_assets"), token_decimals, token_symbol)
    tx_url = _explorer_tx_url(chain_id, tx_hash)
    vault_address_url = _explorer_address_url(chain_id, vault_address)
    strategy_url = _explorer_address_url(chain_id, strategy_address)
    vault_url = _yearn_vault_url(chain_id, vault_address)
    strategy_label = _strategy_display_label(chain_id, strategy_address)
    details_lines = [
        f"🏦 [{vault_symbol}]({vault_url}) ({f'[{_short_hex(vault_address)}]({vault_address_url})' if vault_address_url else _short_hex(vault_address)})",
        f"🧠 {strategy_label} ({f'[{_short_hex(strategy_address)}]({strategy_url})' if strategy_url else _short_hex(strategy_address)})",
        f"📅 {_discord_timestamp(block_time)}",
        f"💰 Gain: {gain_text}",
        f"💸 Fees: {fee_text}",
    ]
    embed = {
        "title": f"{_chain_label(chain_id)} Harvest",
        "color": int(destination["color"]),
        "fields": [
            {"name": "\u200b", "value": "\n".join(details_lines), "inline": False},
            {"name": "\u200b", "value": f"🔗 [View on Explorer]({tx_url})" if tx_url else "Explorer unavailable", "inline": False},
        ],
    }
    payload = {
        "username": destination["username"],
        "embeds": [embed],
    }
    avatar_url = str(destination.get("avatar_url") or "").strip()
    if avatar_url:
        payload["avatar_url"] = avatar_url
    return str(destination["destination_key"]), payload


def _product_label(product_type: str) -> str:
    return STYFI_PRODUCT_SYMBOLS.get(product_type, product_type)


def _action_label(event_kind: str) -> str:
    return {
        "deposit": "Stake",
        "unstake": "Unstake",
        "withdraw": "Withdraw",
        "claim": "Claim",
    }.get(event_kind, event_kind.title())


def _styfi_action_color(event_kind: str) -> int:
    return {
        "claim": 0x0657E9,
        "withdraw": 0x5A544E,
        "unstake": 0x9A5B23,
        "deposit": 0x0657E9,
    }.get(event_kind, int(STYFI_DISCORD_DESTINATION["color"]))


def _build_styfi_discord_payload(row: dict[str, object]) -> tuple[str, dict[str, object]] | None:
    webhook_url = STYFI_DISCORD_DESTINATION.get("webhook_url")
    if not webhook_url:
        return None
    chain_id = int(row["chain_id"])
    tx_hash = str(row["tx_hash"]).lower()
    account = str(row["user_account"]).lower()
    event_kind = str(row["event_kind"])
    product_type = str(row["product_type"])
    block_time = row["block_time"]
    if not isinstance(block_time, datetime):
        return None
    tx_url = _explorer_tx_url(chain_id, tx_hash)
    account_url = _explorer_address_url(chain_id, account)
    amount_text = _format_amount(row.get("amount_raw"), _to_int_or_none(row.get("amount_decimals")), row.get("amount_symbol"))
    details_lines = [
        f"👤 {f'[{_short_hex(account)}]({account_url})' if account_url else _short_hex(account)}",
        f"📅 {_discord_timestamp(block_time)}",
        f"💰 {amount_text}",
    ]
    embed = {
        "title": f"{_product_label(product_type)} {_action_label(event_kind)}",
        "color": _styfi_action_color(event_kind),
        "fields": [
            {"name": "\u200b", "value": "\n".join(details_lines), "inline": False},
            {"name": "\u200b", "value": f"🔗 [View on Explorer]({tx_url})" if tx_url else "Explorer unavailable", "inline": False},
        ],
    }
    payload = {
        "username": STYFI_DISCORD_DESTINATION["username"],
        "embeds": [embed],
    }
    avatar_url = str(STYFI_DISCORD_DESTINATION.get("avatar_url") or "").strip()
    if avatar_url:
        payload["avatar_url"] = avatar_url
    return str(STYFI_DISCORD_DESTINATION["destination_key"]), payload


def _notify_harvest_rows(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    delivered = 0
    for row in rows:
        built = _build_harvest_discord_payload(conn, row=row)
        if not built:
            continue
        destination_key, payload = built
        if _deliver_discord_notification(
            conn,
            source_type="vault_harvest",
            chain_id=int(row["chain_id"]),
            tx_hash=str(row["tx_hash"]).lower(),
            log_index=int(row["log_index"]),
            destination_key=destination_key,
            payload=payload,
        ):
            delivered += 1
    return delivered


def _notify_styfi_activity_rows(conn: psycopg.Connection, rows: list[dict[str, object]]) -> int:
    delivered = 0
    for row in rows:
        built = _build_styfi_discord_payload(row)
        if not built:
            continue
        destination_key, payload = built
        if _deliver_discord_notification(
            conn,
            source_type="styfi_activity",
            chain_id=int(row["chain_id"]),
            tx_hash=str(row["tx_hash"]).lower(),
            log_index=int(row["log_index"]),
            destination_key=destination_key,
            payload=payload,
        ):
            delivered += 1
    return delivered


def _retry_failed_discord_notifications(conn: psycopg.Connection, *, limit: int = 50) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_type, chain_id, tx_hash, log_index, destination_key, payload
            FROM notification_deliveries
            WHERE
                status = 'failed'
                AND attempts < %(retry_limit)s
                AND (
                    last_attempted_at IS NULL
                    OR last_attempted_at <= NOW() - (%(cooldown)s * INTERVAL '1 second')
                )
            ORDER BY last_attempted_at NULLS FIRST
            LIMIT %(limit)s
            """,
            {
                "retry_limit": DISCORD_NOTIFICATION_RETRY_LIMIT,
                "cooldown": DISCORD_NOTIFICATION_RETRY_COOLDOWN_SEC,
                "limit": limit,
            },
        )
        rows = cur.fetchall()
    conn.commit()
    delivered = 0
    for source_type, chain_id, tx_hash, log_index, destination_key, payload in rows:
        if not isinstance(payload, dict):
            continue
        if _deliver_discord_notification(
            conn,
            source_type=str(source_type),
            chain_id=int(chain_id),
            tx_hash=str(tx_hash),
            log_index=int(log_index),
            destination_key=str(destination_key),
            payload=payload,
        ):
            delivered += 1
    if delivered > 0:
        logging.info("Retried Discord notifications delivered=%s", delivered)
    return delivered


def _send_telegram(message: str) -> bool:
    if not ALERT_TELEGRAM_BOT_TOKEN or not ALERT_TELEGRAM_CHAT_ID:
        return False
    response = requests.post(
        f"https://api.telegram.org/bot{ALERT_TELEGRAM_BOT_TOKEN}/sendMessage",
        json={"chat_id": ALERT_TELEGRAM_CHAT_ID, "text": message, "disable_web_page_preview": True},
        timeout=10,
    )
    response.raise_for_status()
    return True


def _send_discord(message: str) -> bool:
    if not ALERT_DISCORD_WEBHOOK_URL:
        return False
    _send_discord_payload(ALERT_DISCORD_WEBHOOK_URL, {"content": message})
    return True


def _send_notifications(message: str) -> dict[str, object]:
    attempted: list[str] = []
    delivered: list[str] = []
    errors: list[str] = []

    if ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID:
        attempted.append("telegram")
        try:
            if _send_telegram(message):
                delivered.append("telegram")
        except Exception as exc:
            errors.append(f"telegram:{exc}")

    if ALERT_DISCORD_WEBHOOK_URL:
        attempted.append("discord")
        try:
            if _send_discord(message):
                delivered.append("discord")
        except Exception as exc:
            errors.append(f"discord:{exc}")

    return {"attempted": attempted, "delivered": delivered, "errors": errors}


def _get_job_status(conn: psycopg.Connection, job_name: str) -> tuple[datetime | None, int | None]:
    now = datetime.now(UTC)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(ended_at) FILTER (WHERE status = 'success') AS last_success_at
            FROM ingestion_runs
            WHERE job_name = %s
            """,
            (job_name,),
        )
        row = cur.fetchone()
    if not row:
        return None, None
    last_success_at = row[0]
    if not isinstance(last_success_at, datetime):
        return None, None
    if last_success_at.tzinfo is None:
        last_success_at = last_success_at.replace(tzinfo=UTC)
    age_seconds = max(0, int((now - last_success_at).total_seconds()))
    return last_success_at, age_seconds


def _get_alert_state(conn: psycopg.Connection, alert_key: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                status,
                last_notified_at,
                last_fired_at,
                last_recovered_at
            FROM alert_state
            WHERE alert_key = %s
            """,
            (alert_key,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "status": row[0],
        "last_notified_at": row[1],
        "last_fired_at": row[2],
        "last_recovered_at": row[3],
    }


def _upsert_alert_state(
    conn: psycopg.Connection,
    *,
    alert_key: str,
    job_name: str,
    status: str,
    threshold_seconds: int,
    current_age_seconds: int | None,
    last_success_at: datetime | None,
    last_fired_at: datetime | None,
    last_recovered_at: datetime | None,
    last_notified_at: datetime | None,
    notify_channels: list[str],
    notify_result: dict[str, object],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO alert_state (
                alert_key,
                job_name,
                status,
                threshold_seconds,
                current_age_seconds,
                last_success_at,
                last_checked_at,
                last_fired_at,
                last_recovered_at,
                last_notified_at,
                notify_channels,
                last_notify_result
            ) VALUES (
                %(alert_key)s,
                %(job_name)s,
                %(status)s,
                %(threshold_seconds)s,
                %(current_age_seconds)s,
                %(last_success_at)s,
                NOW(),
                %(last_fired_at)s,
                %(last_recovered_at)s,
                %(last_notified_at)s,
                %(notify_channels)s,
                %(last_notify_result)s
            )
            ON CONFLICT (alert_key) DO UPDATE SET
                job_name = EXCLUDED.job_name,
                status = EXCLUDED.status,
                threshold_seconds = EXCLUDED.threshold_seconds,
                current_age_seconds = EXCLUDED.current_age_seconds,
                last_success_at = EXCLUDED.last_success_at,
                last_checked_at = NOW(),
                last_fired_at = EXCLUDED.last_fired_at,
                last_recovered_at = EXCLUDED.last_recovered_at,
                last_notified_at = EXCLUDED.last_notified_at,
                notify_channels = EXCLUDED.notify_channels,
                last_notify_result = EXCLUDED.last_notify_result
            """,
            {
                "alert_key": alert_key,
                "job_name": job_name,
                "status": status,
                "threshold_seconds": threshold_seconds,
                "current_age_seconds": current_age_seconds,
                "last_success_at": last_success_at,
                "last_fired_at": last_fired_at,
                "last_recovered_at": last_recovered_at,
                "last_notified_at": last_notified_at,
                "notify_channels": notify_channels,
                "last_notify_result": Json(notify_result),
            },
        )
    conn.commit()


def _evaluate_job_stale_alert(conn: psycopg.Connection, *, job_name: str) -> None:
    alert_key = f"ingestion_stale:{job_name}"
    now = datetime.now(UTC)
    last_success_at, age_seconds = _get_job_status(conn, job_name)
    previous = _get_alert_state(conn, alert_key)
    previous_status = (previous or {}).get("status")
    previous_notified = (previous or {}).get("last_notified_at")

    status = "ok"
    message: str | None = None
    notify_result: dict[str, object] = {"attempted": [], "delivered": [], "errors": []}
    last_fired_at = (previous or {}).get("last_fired_at")
    last_recovered_at = (previous or {}).get("last_recovered_at")
    last_notified_at = previous_notified

    if age_seconds is None:
        status = "unknown"
    elif age_seconds > ALERT_STALE_SECONDS:
        status = "firing"
        should_notify = previous_status != "firing"
        if not should_notify and isinstance(previous_notified, datetime):
            if previous_notified.tzinfo is None:
                previous_notified = previous_notified.replace(tzinfo=UTC)
            elapsed = max(0, int((now - previous_notified).total_seconds()))
            should_notify = elapsed >= ALERT_COOLDOWN_SECONDS
        if should_notify:
            age_hours = round(age_seconds / 3600, 2)
            threshold_hours = round(ALERT_STALE_SECONDS / 3600, 2)
            message = (
                f"[yHelper] stale ingestion alert\n"
                f"job={job_name}\n"
                f"age_hours={age_hours}\n"
                f"threshold_hours={threshold_hours}\n"
                f"last_success_at={last_success_at.isoformat() if last_success_at else 'n/a'}"
            )
            notify_result = _send_notifications(message)
            if notify_result.get("delivered"):
                last_notified_at = now
            last_fired_at = now
    else:
        if previous_status == "firing" and ALERT_NOTIFY_ON_RECOVERY:
            age_hours = round(age_seconds / 3600, 2)
            threshold_hours = round(ALERT_STALE_SECONDS / 3600, 2)
            message = (
                f"[yHelper] ingestion recovered\n"
                f"job={job_name}\n"
                f"age_hours={age_hours}\n"
                f"threshold_hours={threshold_hours}\n"
                f"last_success_at={last_success_at.isoformat() if last_success_at else 'n/a'}"
            )
            notify_result = _send_notifications(message)
            if notify_result.get("delivered"):
                last_notified_at = now
            last_recovered_at = now

    configured_channels: list[str] = []
    if ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID:
        configured_channels.append("telegram")
    if ALERT_DISCORD_WEBHOOK_URL:
        configured_channels.append("discord")

    _upsert_alert_state(
        conn,
        alert_key=alert_key,
        job_name=job_name,
        status=status,
        threshold_seconds=ALERT_STALE_SECONDS,
        current_age_seconds=age_seconds,
        last_success_at=last_success_at,
        last_fired_at=last_fired_at,
        last_recovered_at=last_recovered_at,
        last_notified_at=last_notified_at,
        notify_channels=configured_channels,
        notify_result=notify_result,
    )

    if message:
        logging.info(
            "Alert notify attempted for %s: delivered=%s errors=%s",
            alert_key,
            len(notify_result.get("delivered", [])),
            len(notify_result.get("errors", [])),
        )


def _prune_obsolete_alert_state(conn: psycopg.Connection, *, active_job_names: tuple[str, ...]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM alert_state
            WHERE alert_key LIKE 'ingestion_stale:%%'
              AND NOT (job_name = ANY(%s))
            """,
            (list(active_job_names),),
        )
        deleted = cur.rowcount or 0
    if deleted:
        conn.commit()
    return int(deleted)


def _evaluate_alerts(conn: psycopg.Connection) -> None:
    active_job_names = (JOB_KONG_SNAPSHOT, JOB_KONG_PPS, JOB_PRODUCT_DAU)
    _evaluate_job_stale_alert(conn, job_name=JOB_KONG_SNAPSHOT)
    _evaluate_job_stale_alert(conn, job_name=JOB_KONG_PPS)
    _evaluate_job_stale_alert(conn, job_name=JOB_PRODUCT_DAU)
    deleted = _prune_obsolete_alert_state(conn, active_job_names=active_job_names)
    if deleted:
        logging.info("Pruned %s obsolete alert_state rows", deleted)


def _fetch_kong_snapshot() -> list[dict]:
    payload = _post_kong_gql_json(KONG_VAULTS_SNAPSHOT_QUERY, {"origin": "yearn"})
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Kong snapshot GraphQL response missing data")
    vaults = data.get("vaults")
    if not isinstance(vaults, list):
        raise ValueError("Kong snapshot GraphQL response missing vault list")
    return [vault for vault in vaults if isinstance(vault, dict)]


def _store_snapshot(conn: psycopg.Connection, vaults: list[dict]) -> int:
    rows_by_identity: dict[tuple[int, str], dict] = {}
    numeric_failures = {"tvl_usd": 0, "est_apy": 0}
    skipped_missing_identity = 0
    duplicate_identities = 0
    for vault in vaults:
        raw_address = _first_present(vault, ("address", "vaultAddress", "vault_address"))
        vault_address = str(raw_address or "").strip().lower()
        raw_chain_id = _first_present(vault, ("chainID", "chainId", "chain_id"))
        chain_id = _parse_chain_id(raw_chain_id)
        if not vault_address or chain_id is None:
            skipped_missing_identity += 1
            continue
        row, parse_failures = _normalize_vault(vault, vault_address=vault_address, chain_id=chain_id)
        for field in parse_failures:
            numeric_failures[field] += 1
        identity = (chain_id, vault_address)
        if identity in rows_by_identity:
            duplicate_identities += 1
        rows_by_identity[identity] = row

    rows = list(rows_by_identity.values())
    if not rows:
        raise ValueError(
            "Snapshot normalization produced 0 valid rows "
            f"(payload={len(vaults)}, skipped_missing_identity={skipped_missing_identity})"
        )
    _assert_snapshot_size_guard(
        conn,
        normalized_count=len(rows),
        payload_count=len(vaults),
        skipped_missing_identity=skipped_missing_identity,
    )

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("UPDATE vault_dim SET active = FALSE WHERE active = TRUE")
            cur.executemany(UPSERT_SQL, rows)

    if skipped_missing_identity or duplicate_identities:
        logging.warning(
            "Snapshot normalization anomalies: skipped_missing_identity=%s duplicate_identities=%s",
            skipped_missing_identity,
            duplicate_identities,
        )
    if any(numeric_failures.values()):
        logging.warning(
            "Snapshot numeric parse fallbacks: tvl_usd=%s est_apy=%s",
            numeric_failures["tvl_usd"],
            numeric_failures["est_apy"],
        )
    return len(rows)


def _select_kong_vaults(conn: psycopg.Connection) -> list[tuple[int, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT chain_id, vault_address
            FROM vault_dim
            WHERE active = TRUE AND tvl_usd >= %s
            ORDER BY tvl_usd DESC NULLS LAST, chain_id, vault_address
            LIMIT %s
            """,
            (KONG_MIN_TVL_USD, KONG_MAX_VAULTS),
        )
        return [(int(row[0]), str(row[1])) for row in cur.fetchall()]


def _utc_midnight_epoch_days_ago(days_ago: int) -> int:
    safe_days = max(0, days_ago)
    midnight = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((midnight - timedelta(days=safe_days)).timestamp())


def _fetch_kong_series(
    *,
    chain_id: int,
    vault_address: str,
    limit: int | None,
    timestamp: int | None,
) -> list[tuple[int, float]]:
    variables = {
        "label": "pps",
        "chainId": chain_id,
        "address": vault_address,
        "component": "raw",
        "limit": limit,
        "timestamp": timestamp,
    }
    response = requests.post(
        KONG_GQL_URL,
        json={"query": KONG_PPS_QUERY, "variables": variables},
        timeout=KONG_TIMEOUT_SEC,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        raise ValueError(f"Kong errors: {payload['errors']}")
    timeseries = (payload.get("data") or {}).get("timeseries") or []
    out: list[tuple[int, float]] = []
    for point in timeseries:
        try:
            t = int(point.get("time"))
            v = float(point.get("value"))
        except (TypeError, ValueError):
            continue
        out.append((t, v))
    out.sort(key=lambda x: x[0])
    return out


def _fetch_kong_pps(chain_id: int, vault_address: str) -> list[tuple[int, float]]:
    target_lookback_days = max(0, KONG_PPS_LOOKBACK_DAYS)
    candidate_days: list[int] = [target_lookback_days]
    for delta in range(1, KONG_PPS_ANCHOR_SLACK_DAYS + 1):
        candidate_days.append(target_lookback_days + delta)
        candidate_days.append(max(0, target_lookback_days - delta))
    unique_days: list[int] = []
    for value in candidate_days:
        if value not in unique_days:
            unique_days.append(value)

    best_partial: list[tuple[int, float]] = []
    for days_ago in unique_days:
        points = _fetch_kong_series(
            chain_id=chain_id,
            vault_address=vault_address,
            limit=KONG_PPS_LIMIT,
            timestamp=_utc_midnight_epoch_days_ago(days_ago),
        )
        if len(points) >= 2:
            return points
        if len(points) > len(best_partial):
            best_partial = points

    # Fallback path: pull full history if anchored snapshots did not return enough points.
    points = _fetch_kong_series(chain_id=chain_id, vault_address=vault_address, limit=None, timestamp=None)
    if points:
        trimmed = points[-KONG_PPS_LIMIT:] if KONG_PPS_LIMIT > 0 else points
        if len(trimmed) >= len(best_partial):
            return trimmed
    return best_partial


def _upsert_pps_points(conn: psycopg.Connection, chain_id: int, vault_address: str, points: list[tuple[int, float]]) -> int:
    if not points:
        return 0
    rows = [
        {
            "vault_address": vault_address,
            "chain_id": chain_id,
            "ts": t,
            "pps_raw": v,
        }
        for t, v in points
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO pps_timeseries (vault_address, chain_id, ts, pps_raw, fetched_at)
            VALUES (%(vault_address)s, %(chain_id)s, %(ts)s, %(pps_raw)s, NOW())
            ON CONFLICT (chain_id, vault_address, ts) DO UPDATE SET
                pps_raw = EXCLUDED.pps_raw,
                fetched_at = NOW()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def _apy_for_window(points: list[tuple[int, float]], days: int) -> float | None:
    if len(points) < 2:
        return None
    latest_t, latest_v = points[-1]
    if latest_v <= 0:
        return None
    target_t = latest_t - days * 86400
    base_t, base_v = points[0]
    for t, v in points:
        if t >= target_t and v > 0:
            base_t, base_v = t, v
            break
    if base_v <= 0 or latest_v <= 0 or latest_t <= base_t:
        return None
    window_days = (latest_t - base_t) / 86400
    if window_days < 1:
        return None
    ratio = latest_v / base_v
    if ratio <= 0:
        return None
    return ratio ** (365 / window_days) - 1


def _vol_30d(points: list[tuple[int, float]]) -> tuple[float | None, float | None]:
    if len(points) < 3:
        return None, None
    latest_t = points[-1][0]
    floor_t = latest_t - 30 * 86400
    recent = [p for p in points if p[0] >= floor_t]
    if len(recent) < 3:
        return None, None
    log_returns: list[float] = []
    positive_count = 0
    for idx in range(1, len(recent)):
        prev = recent[idx - 1][1]
        curr = recent[idx][1]
        if prev <= 0 or curr <= 0:
            continue
        ret = curr / prev - 1
        if ret > 0:
            positive_count += 1
        log_returns.append(math.log(curr / prev))
    if len(log_returns) < 2:
        return None, None
    vol = statistics.pstdev(log_returns) * math.sqrt(365)
    positive_ratio = positive_count / len(log_returns)
    consistency = max(0.0, min(1.0, positive_ratio * (1.0 / (1.0 + vol))))
    return vol, consistency


def _compute_metrics(chain_id: int, vault_address: str, points: list[tuple[int, float]]) -> dict | None:
    if not points:
        return None
    apy_7d = _apy_for_window(points, 7)
    apy_30d = _apy_for_window(points, 30)
    apy_90d = _apy_for_window(points, 90)
    vol_30d, consistency = _vol_30d(points)
    momentum = None
    if apy_7d is not None and apy_30d is not None:
        momentum = apy_7d - apy_30d
    return {
        "vault_address": vault_address,
        "chain_id": chain_id,
        "as_of": datetime.now(UTC),
        "points_count": len(points),
        "last_point_time": datetime.fromtimestamp(points[-1][0], tz=UTC),
        "apy_7d": apy_7d,
        "apy_30d": apy_30d,
        "apy_90d": apy_90d,
        "vol_30d": vol_30d,
        "momentum_7d_30d": momentum,
        "consistency_score": consistency,
    }


def _upsert_metrics(conn: psycopg.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO vault_metrics_latest (
                vault_address,
                chain_id,
                as_of,
                points_count,
                last_point_time,
                apy_7d,
                apy_30d,
                apy_90d,
                vol_30d,
                momentum_7d_30d,
                consistency_score
            ) VALUES (
                %(vault_address)s,
                %(chain_id)s,
                %(as_of)s,
                %(points_count)s,
                %(last_point_time)s,
                %(apy_7d)s,
                %(apy_30d)s,
                %(apy_90d)s,
                %(vol_30d)s,
                %(momentum_7d_30d)s,
                %(consistency_score)s
            )
            ON CONFLICT (chain_id, vault_address) DO UPDATE SET
                as_of = EXCLUDED.as_of,
                points_count = EXCLUDED.points_count,
                last_point_time = EXCLUDED.last_point_time,
                apy_7d = EXCLUDED.apy_7d,
                apy_30d = EXCLUDED.apy_30d,
                apy_90d = EXCLUDED.apy_90d,
                vol_30d = EXCLUDED.vol_30d,
                momentum_7d_30d = EXCLUDED.momentum_7d_30d,
                consistency_score = EXCLUDED.consistency_score
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def _cleanup_old_data(conn: psycopg.Connection) -> dict[str, int]:
    deleted_pps = 0
    deleted_runs = 0
    deleted_styfi_snapshots = 0
    deleted_styfi_epochs = 0
    deleted_product_interactions = 0
    deleted_vault_harvests = 0
    with conn.cursor() as cur:
        if PPS_RETENTION_DAYS > 0:
            cutoff_ts = int((datetime.now(UTC) - timedelta(days=PPS_RETENTION_DAYS)).timestamp())
            cur.execute("DELETE FROM pps_timeseries WHERE ts < %s", (cutoff_ts,))
            deleted_pps = cur.rowcount
        if STYFI_SNAPSHOT_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM styfi_snapshots WHERE observed_at < NOW() - (%s * INTERVAL '1 day')",
                (STYFI_SNAPSHOT_RETENTION_DAYS,),
            )
            deleted_styfi_snapshots = cur.rowcount
        if STYFI_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM styfi_epoch_stats WHERE epoch_start < NOW() - (%s * INTERVAL '1 day')",
                (STYFI_RETENTION_DAYS,),
            )
            deleted_styfi_epochs = cur.rowcount
        if INGESTION_RUN_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM ingestion_runs WHERE started_at < NOW() - (%s * INTERVAL '1 day')",
                (INGESTION_RUN_RETENTION_DAYS,),
            )
            deleted_runs = cur.rowcount
        if PRODUCT_ACTIVITY_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM product_interactions WHERE block_time < NOW() - (%s * INTERVAL '1 day')",
                (PRODUCT_ACTIVITY_RETENTION_DAYS,),
            )
            deleted_product_interactions = cur.rowcount
        if HARVEST_RETENTION_DAYS > 0:
            cur.execute(
                "DELETE FROM vault_harvests WHERE block_time < NOW() - (%s * INTERVAL '1 day')",
                (HARVEST_RETENTION_DAYS,),
            )
            deleted_vault_harvests = cur.rowcount
    conn.commit()
    return {
        "pps_timeseries": deleted_pps,
        "styfi_snapshots": deleted_styfi_snapshots,
        "styfi_epoch_stats": deleted_styfi_epochs,
        "ingestion_runs": deleted_runs,
        "product_interactions": deleted_product_interactions,
        "vault_harvests": deleted_vault_harvests,
    }


def _maybe_cleanup_old_data(conn: psycopg.Connection) -> None:
    global LAST_CLEANUP_AT
    if not DB_CLEANUP_ENABLED:
        return
    now = datetime.now(UTC)
    if LAST_CLEANUP_AT is not None:
        elapsed = max(0, int((now - LAST_CLEANUP_AT).total_seconds()))
        if elapsed < DB_CLEANUP_MIN_INTERVAL_SEC:
            return
    result = _cleanup_old_data(conn)
    LAST_CLEANUP_AT = now
    if any(value > 0 for value in result.values()):
        logging.info(
            "DB cleanup removed rows: pps_timeseries=%s styfi_snapshots=%s styfi_epoch_stats=%s ingestion_runs=%s product_interactions=%s vault_harvests=%s",
            result["pps_timeseries"],
            result["styfi_snapshots"],
            result["styfi_epoch_stats"],
            result["ingestion_runs"],
            result["product_interactions"],
            result["vault_harvests"],
        )
    else:
        logging.info("DB cleanup check completed; no rows removed")


def _run_kong_snapshot_ingestion(conn: psycopg.Connection) -> tuple[int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_KONG_SNAPSHOT, started_at)
    try:
        vaults = _fetch_kong_snapshot()
        stored = _store_snapshot(conn, vaults)
        _complete_run(conn, run_id, "success", stored)
        logging.info("Kong vault snapshot success: stored %s vault records", stored)
        return run_id, stored
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)}))
        logging.exception("Kong vault snapshot failed: %s", exc)
        return run_id, 0


def _run_kong_ingestion(conn: psycopg.Connection) -> tuple[int, int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_KONG_PPS, started_at)
    pps_rows_stored = 0
    metrics_rows = 0
    errors: list[str] = []
    try:
        targets = _select_kong_vaults(conn)
        if not targets:
            _complete_run(conn, run_id, "success", 0, json.dumps({"note": "no eligible vaults"}))
            return run_id, 0, 0
        metric_payload: list[dict] = []
        for chain_id, vault_address in targets:
            try:
                points = _fetch_kong_pps(chain_id, vault_address)
                if not points:
                    continue
                pps_rows_stored += _upsert_pps_points(conn, chain_id, vault_address, points)
                computed = _compute_metrics(chain_id, vault_address, points)
                if computed:
                    metric_payload.append(computed)
            except Exception as exc:
                if len(errors) < 10:
                    errors.append(f"{chain_id}:{vault_address}:{exc}")
            if KONG_SLEEP_BETWEEN_REQ_MS > 0:
                time.sleep(KONG_SLEEP_BETWEEN_REQ_MS / 1000)
        metrics_rows = _upsert_metrics(conn, metric_payload)
        summary = {"targets": len(targets), "points": pps_rows_stored, "metrics": metrics_rows, "errors": errors}
        _complete_run(conn, run_id, "success", pps_rows_stored, json.dumps(summary))
        logging.info(
            "Kong ingestion success: targets=%s points=%s metrics=%s errors=%s",
            len(targets),
            pps_rows_stored,
            metrics_rows,
            len(errors),
        )
        return run_id, pps_rows_stored, metrics_rows
    except Exception as exc:
        _complete_run(conn, run_id, "failed", pps_rows_stored, json.dumps({"error": str(exc), "errors": errors}))
        logging.exception("Kong ingestion failed: %s", exc)
        return run_id, pps_rows_stored, metrics_rows


def _run_styfi_snapshot(conn: psycopg.Connection) -> tuple[int, int, int]:
    started_at = datetime.now(UTC)
    run_id = _insert_run(conn, JOB_STYFI, started_at)
    try:
        snapshot, epochs, sync_state = _fetch_styfi_snapshot_data()
        _upsert_styfi_snapshot(conn, snapshot)
        epoch_rows = _upsert_styfi_epoch_stats(conn, epochs)
        _upsert_styfi_sync_state(conn, sync_state)
        summary = {
            "observed_at": snapshot["observed_at"].isoformat(),
            "reward_epoch": snapshot["reward_epoch"],
            "epoch_rows": epoch_rows,
            "combined_staked_raw": str(snapshot["combined_staked_raw"]),
        }
        _complete_run(conn, run_id, "success", epoch_rows + 1, json.dumps(summary))
        logging.info(
            "stYFI snapshot success: reward_epoch=%s combined_staked_raw=%s epoch_rows=%s",
            snapshot["reward_epoch"],
            snapshot["combined_staked_raw"],
            epoch_rows,
        )
        return run_id, 1, epoch_rows
    except Exception as exc:
        _complete_run(conn, run_id, "failed", 0, json.dumps({"error": str(exc)}))
        logging.exception("stYFI snapshot failed: %s", exc)
        return run_id, 0, 0


def run_once() -> None:
    global HARVEST_WSS_MANAGER
    logging.info("Tick at %s", datetime.now(UTC).isoformat())
    logging.info("Fetching Kong vault snapshot: %s", KONG_GQL_URL)
    with _connect() as conn:
        _ensure_schema(conn)
        abandoned = _mark_stale_running_runs(conn)
        if abandoned > 0:
            logging.warning("Marked %s stale running ingestion rows as abandoned", abandoned)
        _, stored = _run_kong_snapshot_ingestion(conn)
        if stored > 0:
            _run_kong_ingestion(conn)
        else:
            logging.warning("Skipping Kong PPS ingestion because Kong snapshot stored 0 records")
        if STYFI_SYNC_ENABLED:
            _run_styfi_snapshot(conn)
        else:
            logging.info("Skipping stYFI snapshot because STYFI_SYNC_ENABLED=0")
        _run_product_dau(conn)
        _backfill_styfi_activity_amounts(conn)
        if HARVEST_WSS_MANAGER is not None:
            HARVEST_WSS_MANAGER.refresh(_select_harvest_contracts(conn))
        _run_vault_harvests(conn)
        _retry_failed_discord_notifications(conn)
        _evaluate_alerts(conn)
        _maybe_cleanup_old_data(conn)


def main() -> None:
    global HARVEST_WSS_MANAGER
    configure_logging()
    _validate_data_policy_config()
    interval = int(os.getenv("WORKER_INTERVAL_SEC", "21600"))
    logging.info("Worker booted with interval=%ss", interval)
    with _connect() as conn:
        _ensure_schema(conn)
        orphaned = _mark_boot_orphaned_runs(conn)
        if orphaned > 0:
            logging.warning("Marked %s orphaned running ingestion rows as abandoned on boot", orphaned)
        if HARVEST_WSS_ENABLED:
            HARVEST_WSS_MANAGER = HarvestWssManager()
            HARVEST_WSS_MANAGER.refresh(_select_harvest_contracts(conn))
    while True:
        run_once()
        time.sleep(interval)


if __name__ == "__main__":
    main()
