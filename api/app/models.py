from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RealizedApyPolicy(ApiModel):
    kind: Literal["bounded"]
    min: float
    max: float


class UniverseFilters(ApiModel):
    universe: Literal["core", "extended", "raw"]
    min_tvl_usd: float
    min_points: int
    max_vaults: int | None


class DiscoverFilters(UniverseFilters):
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"]
    chain_id: int | None
    token_symbol: str | None
    sort_by: Literal["tvl", "est_apy", "apy_30d", "momentum"]
    direction: Literal["asc", "desc"]


class Pagination(ApiModel):
    limit: int
    offset: int
    total: int


class DiscoverSummary(ApiModel):
    vaults: int
    total_tvl_usd: float | None
    best_realized_apy_30d: float | None
    worst_realized_apy_30d: float | None
    realized_spread_30d: float | None
    tvl_weighted_realized_apy_30d: float | None


class DiscoverCoverage(ApiModel):
    visible_vaults: int
    with_realized_apy: int
    coverage_ratio: float | None
    without_realized_apy: int


class ChainFacet(ApiModel):
    chain_id: int
    vaults: int


class DiscoverFacets(ApiModel):
    chains: list[ChainFacet]


class VaultMetricRow(ApiModel):
    vault_address: str
    chain_id: int
    symbol: str | None
    tvl_usd: float | None
    est_apy: float | None
    realized_apy_30d: float | None
    momentum_7d_30d: float | None


class DiscoverRow(VaultMetricRow):
    market: str
    token_symbol: str | None


class DiscoverResponse(ApiModel):
    filters: DiscoverFilters
    realized_apy_policy: RealizedApyPolicy
    pagination: Pagination
    summary: DiscoverSummary
    coverage: DiscoverCoverage
    facets: DiscoverFacets
    rows: list[DiscoverRow]


class CompositionFilters(UniverseFilters):
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"]


class CompositionSummary(ApiModel):
    vaults: int
    total_tvl_usd: float | None


class CompositionChain(ApiModel):
    chain_id: int
    vaults: int
    tvl_usd: float | None
    share_tvl: float | None


class CompositionCategory(ApiModel):
    category: str
    vaults: int
    tvl_usd: float | None
    share_tvl: float | None


class CompositionToken(ApiModel):
    token_symbol: str
    vaults: int
    tvl_usd: float | None
    share_tvl: float | None


class CompositionResponse(ApiModel):
    filters: CompositionFilters
    summary: CompositionSummary
    chains: list[CompositionChain]
    categories: list[CompositionCategory]
    tokens: list[CompositionToken]


class ChangeWindow(ApiModel):
    name: Literal["24h", "7d", "30d"]
    stale_after_seconds: int


class ChangeSummary(ApiModel):
    vaults_eligible: int
    vaults_with_change: int
    tracked_tvl_usd: float | None
    riser_vaults: int
    faller_vaults: int
    flat_vaults: int
    riser_tvl_usd: float | None
    faller_tvl_usd: float | None
    tvl_weighted_delta: float | None


class ChangeFreshness(ApiModel):
    newest_comparison_age_seconds: int | None
    current_comparisons: int
    tracked_comparisons: int


class ChangeMover(ApiModel):
    vault_address: str
    chain_id: int
    symbol: str | None
    token_symbol: str
    tvl_usd: float
    realized_apy_window: float
    realized_apy_prev_window: float
    delta_apy: float
    age_seconds: int


class ChangeMovers(ApiModel):
    risers: list[ChangeMover]
    fallers: list[ChangeMover]


class ChangesResponse(ApiModel):
    window: ChangeWindow
    realized_apy_policy: RealizedApyPolicy
    summary: ChangeSummary
    freshness: ChangeFreshness
    movers: ChangeMovers


class AssetVaultSummary(ApiModel):
    vaults: int
    chains: int
    total_tvl_usd: float
    best_realized_apy_30d: float | None
    worst_realized_apy_30d: float | None
    realized_spread_30d: float | None
    weighted_realized_apy_30d: float | None


class AssetVaultsResponse(ApiModel):
    token_symbol: str
    identity: Literal["exact_token_symbol"]
    filters: UniverseFilters
    realized_apy_policy: RealizedApyPolicy
    summary: AssetVaultSummary
    rows: list[VaultMetricRow]


class ReportEvent(ApiModel):
    name: Literal["StrategyReported"]
    level: Literal["vault"]


class ReportTrailing(ApiModel):
    report_count: int
    vault_count: int
    strategy_count: int


class ReportChain(ApiModel):
    chain_id: int
    chain_label: str


class ReportRow(ApiModel):
    chain_id: int
    chain_label: str
    block_time: str | None
    tx_hash: str
    log_index: int
    vault_address: str
    vault_symbol: str | None
    token_symbol: str | None
    token_decimals: int | None
    vault_version: str
    strategy_address: str
    strategy_name: str | None
    gain: str
    loss: str
    debt_after: str | None
    fee_assets: str | None
    refund_assets: str | None
    report_type: Literal["realized_result", "accounting_update"]


class ReportsResponse(ApiModel):
    event: ReportEvent
    trailing_24h: ReportTrailing
    available_chains: list[ReportChain]
    recent: list[ReportRow]


class YlockerRewardToken(ApiModel):
    address: str
    symbol: str
    decimals: int
    asset_symbol: str
    asset_decimals: int


class YlockerReportingWeekPolicy(ApiModel):
    anchor: Literal["thursday_00_utc"]
    seconds: int


class YlockerScope(ApiModel):
    chain_id: Literal[1]
    products: list[Literal["ycrv", "yyb"]]
    official_deposits_only: Literal[True] = Field(description="Tracks deposits from Yearn's designated distributors.")
    reward_token: YlockerRewardToken
    reporting_week: YlockerReportingWeekPolicy


class YlockerFilters(ApiModel):
    product: Literal["all", "ycrv", "yyb"]
    limit: int
    include_events: bool


class YlockerProductFreshness(ApiModel):
    product: Literal["ycrv", "yyb"]
    product_label: str
    indexed_through_block: int | None
    indexed_through: str | None = Field(description="Most recent block time in this response.")
    age_seconds: int | None
    status: str


class YlockerFreshness(ApiModel):
    status: Literal["fresh", "delayed", "unavailable"]
    indexed_through: str | None = Field(description="Most recent block time in this response.")
    age_seconds: int | None
    stale_after_seconds: int
    products: list[YlockerProductFreshness]


class YlockerCurrentCycle(ApiModel):
    product: Literal["ycrv", "yyb"]
    product_label: str
    native_week: int
    cycle_start: str
    cycle_end: str
    status: Literal["current"] = Field(description="This locker week is in progress.")
    event_count: int
    reward_shares_raw: str
    reward_shares: float
    value_crvusd_raw: str
    value_crvusd_at_deposit: float


class YlockerRewardEvent(ApiModel):
    block_number: int
    block_time: str
    tx_hash: str
    log_index: int
    depositor_address: str
    reward_shares_raw: str
    reward_shares: float = Field(description="yvcrvUSD-2 shares added to the locker.")
    pps_raw: str
    pps_at_deposit: float
    value_crvusd_raw: str
    value_crvusd_at_deposit: float = Field(
        description="crvUSD value at the time of deposit, using the recorded yvcrvUSD-2 PPS."
    )


class YlockerRewardCycle(ApiModel):
    product: Literal["ycrv", "yyb"]
    product_label: str
    native_week: int
    cycle_start: str
    cycle_end: str
    status: Literal["finalized"] = Field(description="This locker week is complete.")
    event_count: int = Field(description="Deposits in this locker week.")
    reward_shares_raw: str
    reward_shares: float = Field(description="yvcrvUSD-2 shares added to the locker.")
    value_crvusd_raw: str
    value_crvusd_at_deposit: float = Field(
        description="crvUSD value at the time of deposit, using the recorded yvcrvUSD-2 PPS."
    )
    events: list[YlockerRewardEvent]


class YlockerReportingProduct(ApiModel):
    product: Literal["ycrv", "yyb"]
    product_label: str
    event_count: int
    value_crvusd_at_deposit: float


class YlockerReportingWeek(ApiModel):
    calendar_week: int = Field(description="Thu-to-Thu presentation group. Each locker keeps its own schedule.")
    week_start: str
    week_end: str
    status: Literal["finalized", "awaiting_product_cycles"]
    digest_ready_at: str | None
    ready_for_digest: bool
    total_crvusd_at_deposit: float
    products: list[YlockerReportingProduct]


class YlockerRewardsResponse(ApiModel):
    filters: YlockerFilters
    scope: YlockerScope
    freshness: YlockerFreshness
    current_cycles: list[YlockerCurrentCycle]
    cycles: list[YlockerRewardCycle]
    reporting_weeks: list[YlockerReportingWeek]


class HealthResponse(ApiModel):
    status: Literal["ok"]


class PulseScope(ApiModel):
    name: str
    min_tvl_usd: float
    min_points: int
    max_vaults: int


class OverviewPulse(ApiModel):
    trend: Literal["improving", "softening", "steady"]
    data_state: Literal["ready", "limited", "delayed"]
    latest_7d_apy: float
    previous_7d_apy: float
    change_7d: float
    directional_tvl_ratio: float | None
    coverage_ratio: float | None
    fresh_tvl_ratio: float | None
    eligible_vaults: int
    comparable_vaults: int
    fresh_comparable_vaults: int
    eligible_tvl_usd: float | None
    comparable_tvl_usd: float | None
    latest_data_at: str | None
    oldest_data_at: str | None
    window_days: int
    freshness_window_hours: int
    scope: PulseScope


class OverviewPulseResponse(ApiModel):
    pulse: OverviewPulse | None


class FreshnessResponse(ApiModel):
    as_of_utc: str
    stale_threshold_seconds: int
    stale_threshold_hours: float
    min_tvl_usd: float
    latest_pps_at: str | None
    latest_pps_age_seconds: int | None
    pps_vaults_total: int
    pps_vaults_stale: int
    pps_stale_ratio: float | None
    metrics_rows: int
    metrics_newest_point_at: str | None
    metrics_newest_age_seconds: int | None
    stale_by_chain: list[dict[str, object]]
    stale_by_category: list[dict[str, object]]
    ingestion_jobs: dict[str, object]
    alerts: dict[str, object]
    threshold: Literal["24h", "7d", "30d"] | None = None


class CoverageResponse(ApiModel):
    as_of_utc: str
    filters: dict[str, object]
    global_: dict[str, object] = Field(alias="global")
    by_chain: list[dict[str, object]]
    by_category: list[dict[str, object]]

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ProtocolContextResponse(ApiModel):
    schema_version: int
    source: str
    status: Literal["ok", "unavailable"]
    as_of_utc: str
    protocol: dict[str, object] | None = None
    catalog: dict[str, object] | None = None
    analytics: dict[str, object] | None = None
    current_yearn: dict[str, object] | None = None
    total_yearn: dict[str, object] | None = None


class OperationalStatusResponse(ApiModel):
    status: Literal["ok"]
    generated_at_utc: str
    data_policy: dict[str, object]
    protocol_context: ProtocolContextResponse
    tracked_scope: dict[str, object]
    freshness: FreshnessResponse
    coverage: CoverageResponse


class StyfiFilters(ApiModel):
    days: int
    epoch_limit: int
    chain_id: int
    include_history: bool


class StyfiSummary(ApiModel):
    observed_at: str | None
    reward_epoch: int
    yfi_total_supply: float | None
    styfi_staked: float | None
    styfi_supply: float | None
    styfix_staked: float | None
    styfix_supply: float | None
    liquid_lockers_staked: float | None
    migrated_yfi: float | None
    combined_staked: float | None
    staked_share_supply: float | None
    net_flow_24h: float | None
    net_flow_7d: float | None
    snapshots_count: int
    first_snapshot_at: str | None
    latest_snapshot_at: str | None


class StyfiRewardToken(ApiModel):
    address: str
    symbol: str
    decimals: int


class StyfiCurrentRewardState(ApiModel):
    source: str | None
    epoch: int | None
    timestamp: int | None
    block_number: int | None
    reward_pps: float | None
    global_apr: float | None
    styfi_current_reward: float | None
    styfi_current_apr: float | None
    styfi_projected_reward: float | None
    styfi_projected_apr: float | None
    styfix_current_reward: float | None
    styfix_current_apr: float | None
    styfix_projected_reward: float | None
    styfix_projected_apr: float | None
    liquid_lockers_staked: float | None
    liquid_lockers_participating: float | None
    migrated_yfi: float | None


class StyfiSnapshot(ApiModel):
    observed_at: str | None
    reward_epoch: int
    styfi_staked: float | None
    styfix_staked: float | None
    liquid_lockers_staked: float | None
    migrated_yfi: float | None
    combined_staked: float | None
    staked_share_supply: float | None


class StyfiEpoch(ApiModel):
    epoch: int
    epoch_start: str | None
    reward_total: float | None
    reward_styfi: float | None
    reward_styfix: float | None
    reward_veyfi: float | None
    reward_liquid_lockers: float | None


class StyfiSeries(ApiModel):
    snapshots: list[StyfiSnapshot]
    epochs: list[StyfiEpoch]


class StyfiComponentRow(ApiModel):
    component: str
    reward: float | None


class StyfiComponentSplit(ApiModel):
    epoch: int | None
    rows: list[StyfiComponentRow]


class StyfiActivity(ApiModel):
    chain_id: int
    block_time: str | None
    tx_hash: str
    user_account: str
    product_type: str
    product_label: str
    event_kind: str
    action_label: str
    product_contract: str
    amount_raw: str | None
    amount_decimals: int | None
    amount_symbol: str | None


class StyfiFreshness(ApiModel):
    latest_snapshot_at: str | None
    latest_snapshot_age_seconds: int | None
    snapshots_count: int
    first_snapshot_at: str | None


class StyfiDataPolicy(ApiModel):
    retention_days: int
    snapshot_retention_days: int
    epoch_lookback: int


class StyfiIngestionRun(ApiModel):
    status: str
    started_at: str | None
    ended_at: str | None
    records: int
    error_summary: str | None


class StyfiIngestion(ApiModel):
    last_run: StyfiIngestionRun | None


class StyfiResponse(ApiModel):
    filters: StyfiFilters
    summary: StyfiSummary
    reward_token: StyfiRewardToken
    current_reward_state: StyfiCurrentRewardState | None
    series: StyfiSeries
    component_split_latest_completed: StyfiComponentSplit
    recent_activity: list[StyfiActivity]
    freshness: StyfiFreshness
    data_policy: StyfiDataPolicy
    ingestion: StyfiIngestion
