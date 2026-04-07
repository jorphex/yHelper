"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type WindowKey = "24h" | "7d" | "30d";
type StaleThresholdKey = "auto" | "24h" | "7d" | "30d";

type Summary = {
  vaults_eligible: number;
  vaults_with_change: number;
  stale_vaults: number;
  total_tvl_usd: number | null;
  tracked_tvl_usd: number | null;
  stale_tracked_tvl_usd?: number | null;
  avg_realized_apy_window: number | null;
  avg_realized_apy_prev_window: number | null;
  avg_delta: number | null;
};

type ChangeRow = {
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

type StaleByChain = {
  chain_id: number;
  vaults: number;
  stale_vaults: number;
  stale_ratio: number;
  tvl_usd: number | null;
  stale_tvl_usd: number | null;
};

type StaleByCategory = {
  category: string;
  vaults: number;
  stale_vaults: number;
  stale_ratio: number;
  tvl_usd: number | null;
  stale_tvl_usd: number | null;
};

type ChangesResponse = {
  filters?: {
    stale_threshold?: StaleThresholdKey;
    stale_threshold_seconds?: number;
  };
  summary: Summary;
  reference_tvl?: {
    yearn_aligned_proxy?: {
      vaults?: number;
      tvl_usd?: number | null;
      comparison_to_filtered_universe?: {
        filtered_total_tvl_usd?: number | null;
        gap_usd?: number | null;
        ratio?: number | null;
      };
    };
  };
  freshness?: {
    latest_pps_age_seconds?: number | null;
    pps_stale_ratio?: number | null;
    metrics_newest_age_seconds?: number | null;
    window_stale_vaults?: number | null;
    window_tracked_vaults?: number | null;
    window_stale_ratio?: number | null;
    stale_by_chain?: StaleByChain[];
    stale_by_category?: StaleByCategory[];
  };
  movers?: {
    risers: ChangeRow[];
    fallers: ChangeRow[];
    largest_abs_delta: ChangeRow[];
  };
  risers?: ChangeRow[];
  fallers?: ChangeRow[];
  stale?: ChangeRow[];
};

type TrendDailyRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
  riser_ratio?: number | null;
  faller_ratio?: number | null;
  bucket_high_ratio?: number | null;
};

type GroupedTrendRow = {
  day: string;
  group_key: string;
  total_tvl_usd?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
};

export type TrendDailyResponse = {
  rows?: TrendDailyRow[];
  grouped?: {
    latest?: GroupedTrendRow[];
    series?: Record<string, GroupedTrendRow[]>;
  };
};

interface UseChangesDataParams {
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  window: WindowKey;
  staleThreshold: StaleThresholdKey;
}

interface UseTrendDailyParams {
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  days: number;
  groupBy?: "chain" | "category" | null;
  groupLimit?: number;
  enabled?: boolean;
}

export async function fetchChangesData(params: UseChangesDataParams): Promise<ChangesResponse> {
  const searchParams = new URLSearchParams({
    window: params.window,
    stale_threshold: params.staleThreshold,
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    limit: "60",
  });

  const res = await fetch(apiUrl("/changes", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ChangesResponse>;
}

export async function fetchTrendDailyData(params: UseTrendDailyParams): Promise<TrendDailyResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    days: String(params.days),
  });
  if (params.groupBy) searchParams.set("group_by", params.groupBy);
  if (params.groupLimit) searchParams.set("group_limit", String(params.groupLimit));

  const res = await fetch(apiUrl("/trends/daily", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<TrendDailyResponse>;
}

export function useChangesData(params: UseChangesDataParams) {
  return useQuery({
    queryKey: ["changes", params],
    queryFn: () => fetchChangesData(params),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}

export function useTrendDailyData(params: UseTrendDailyParams) {
  return useQuery({
    queryKey: ["trend-daily", params],
    queryFn: () => fetchTrendDailyData(params),
    enabled: params.enabled ?? true,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
