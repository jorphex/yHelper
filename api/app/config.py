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
DAILY_APY_MAX_WINDOW_DAYS = 90
DAILY_APY_LOOKBACK_BUFFER_DAYS = 21
DAILY_APY_LOOKBACK_DAYS = DAILY_APY_MAX_WINDOW_DAYS + DAILY_APY_LOOKBACK_BUFFER_DAYS
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
ASSETS_FEATURED_MIN_TVL_USD = float(os.getenv("API_ASSETS_FEATURED_MIN_TVL_USD", "1000000"))
ASSETS_FEATURED_MIN_VENUES = 2
ASSETS_FEATURED_MIN_CHAINS = 1
WORKER_INTERVAL_SEC = int(os.getenv("WORKER_INTERVAL_SEC", "21600"))
PPS_RETENTION_DAYS = int(os.getenv("PPS_RETENTION_DAYS", "180"))
INGESTION_RUN_RETENTION_DAYS = int(os.getenv("INGESTION_RUN_RETENTION_DAYS", "30"))
DB_CLEANUP_MIN_INTERVAL_SEC = int(os.getenv("DB_CLEANUP_MIN_INTERVAL_SEC", "21600"))
KONG_PPS_LOOKBACK_DAYS = int(os.getenv("KONG_PPS_LOOKBACK_DAYS", "119"))
KONG_GQL_URL = os.getenv("KONG_GQL_URL", "https://kong.yearn.fi/api/gql")
KONG_REST_VAULTS_URL = os.getenv(
    "KONG_REST_VAULTS_URL",
    "https://kong.yearn.fi/api/rest/list/vaults?origin=yearn",
)
SOCIAL_PREVIEW_LIVE_TTL_SEC = int(os.getenv("SOCIAL_PREVIEW_LIVE_TTL_SEC", "300"))
STYFI_RETENTION_DAYS = int(os.getenv("STYFI_RETENTION_DAYS", str(PPS_RETENTION_DAYS)))
STYFI_SNAPSHOT_RETENTION_DAYS = int(os.getenv("STYFI_SNAPSHOT_RETENTION_DAYS", "30"))
STYFI_EPOCH_LOOKBACK = int(os.getenv("STYFI_EPOCH_LOOKBACK", "12"))
STYFI_CHAIN_ID = int(os.getenv("STYFI_CHAIN_ID", "1"))
STYFI_TOKEN_SCALE = float(10**18)
STYFI_SITE_REWARD_SCALE = float(10**18)
STYFI_REWARD_TOKEN_DEFAULT = {"address": None, "symbol": "yvUSDC-1", "decimals": 6}
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
            cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_raw NUMERIC(78, 0)")
            cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_decimals INTEGER")
            cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_symbol TEXT")
        conn.commit()
