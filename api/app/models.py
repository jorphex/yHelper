from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


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


class TrendFilters(UniverseFilters):
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"]
    days: int


class TrendMethodology(ApiModel):
    membership: Literal["current_selected_vault_set"]
    weighting: Literal["current_tvl_usd"]
    interpretation: Literal["retrospective_yield_for_current_set"]


class TrendRow(ApiModel):
    day: str
    weighted_apy_7d: float | None
    weighted_apy_30d: float | None
    riser_ratio: float | None


class TrendsResponse(ApiModel):
    filters: TrendFilters
    realized_apy_policy: RealizedApyPolicy
    methodology: TrendMethodology
    rows: list[TrendRow]


class AssetFilters(UniverseFilters):
    market: Literal["all", "stablecoins", "eth", "bitcoin", "other"]
    token_scope: Literal["featured", "all"]
    sort_by: Literal["tvl", "spread", "vaults"]
    direction: Literal["asc", "desc"]


class AssetSummary(ApiModel):
    tokens: int
    total_tvl_usd: float | None
    total_vaults: int | None


class AssetRow(ApiModel):
    token_symbol: str
    vaults: int
    chains: int
    total_tvl_usd: float | None
    best_realized_apy_30d: float | None
    worst_realized_apy_30d: float | None
    realized_spread_30d: float | None
    weighted_realized_apy_30d: float | None


class AssetsResponse(ApiModel):
    identity: Literal["exact_token_symbol"]
    filters: AssetFilters
    realized_apy_policy: RealizedApyPolicy
    summary: AssetSummary
    rows: list[AssetRow]


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
