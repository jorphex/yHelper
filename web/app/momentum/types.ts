import type { UniverseKind } from "../lib/universe";

export type TabKey = "changes" | "regimes";
export type WindowKey = "24h" | "7d" | "30d";
export type TrendGroupKey = "none" | "chain" | "category";
export type TvlViewKey = "filtered" | "reference";
export type MoverSortKey = "vault" | "chain" | "tvl" | "current" | "previous" | "delta" | "age";

export type ChangeRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  realized_apy_window: number | null;
  realized_apy_prev_window: number | null;
  delta_apy: number | null;
  age_seconds: number | null;
};

export type DailyTrendRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
  riser_ratio?: number | null;
  faller_ratio?: number | null;
  bucket_high_ratio?: number | null;
};

export type GroupedTrendRow = {
  day: string;
  group_key: string;
  total_tvl_usd?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
};

export type StaleByChain = {
  chain_id: number;
  vaults: number;
  stale_vaults: number;
  stale_ratio: number;
  tvl_usd: number | null;
  stale_tvl_usd: number | null;
};

export type StaleByCategory = {
  category: string;
  vaults: number;
  stale_vaults: number;
  stale_ratio: number;
  tvl_usd: number | null;
  stale_tvl_usd: number | null;
};

export type RegimeSummary = {
  regime: string;
  vaults: number;
  tvl_usd: number;
};

export type RegimeMover = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  tvl_usd: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  regime: string;
};

export type TransitionRow = {
  previous_regime: string;
  current_regime: string;
  vaults: number;
  tvl_usd: number | null;
  avg_current_momentum: number | null;
  avg_previous_momentum: number | null;
};

export type TransitionSummary = {
  vaults_total?: number;
  changed_vaults?: number;
  changed_ratio?: number | null;
  tvl_total_usd?: number | null;
  changed_tvl_usd?: number | null;
  changed_tvl_ratio?: number | null;
};

export type TransitionDailyRow = {
  day: string;
  changed_ratio?: number | null;
  changed_tvl_ratio?: number | null;
  momentum_spread?: number | null;
};

export type GroupedTransitionRow = TransitionDailyRow & {
  group_key: string;
  tvl_total_usd?: number | null;
};

export type TransitionDailyGrouped = {
  group_by?: "none" | "chain" | "category";
  rows?: GroupedTransitionRow[];
  latest?: GroupedTransitionRow[];
  series?: Record<string, GroupedTransitionRow[]>;
};

export type RegimeSummarySortKey = "regime" | "vaults" | "tvl";
export type RegimeMoverSortKey = "vault" | "chain" | "token" | "tvl" | "apy" | "momentum" | "regime";
export type SplitSnapshotSortKey = "cohort" | "churn" | "churn_tvl" | "momentum" | "tvl";
export type StaleSortKey = "chain" | "vaults" | "stale" | "ratio" | "tvl" | "stale_tvl";
export type StaleCatSortKey = "category" | "vaults" | "stale" | "ratio" | "tvl" | "stale_tvl";

export type MomentumQuery = {
  universe: UniverseKind;
  window: WindowKey;
  trendGroup: TrendGroupKey;
  tvlView: TvlViewKey;
  minTvl: number;
  minPoints: number;
  tab: TabKey;
  limit: number;
  chain: number;
  transitionSplit: "none" | "chain" | "category";
  transitionDays: "60" | "120" | "180" | "365";
  transitionMinCohortTvl: number;
};

export type SplitSnapshotRow = {
  group_key: string;
  cohort_label: string;
  changed_ratio: number | null;
  changed_tvl_ratio: number | null;
  momentum_spread: number | null;
  tvl_total_usd: number | null;
};

export const REGIME_ORDER = ["rising", "stable", "falling", "choppy"] as const;
