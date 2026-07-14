"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { MarketKind, UniverseKind } from "../lib/universe";

type WindowKey = "24h" | "7d" | "30d";
type StaleThresholdKey = "auto" | "24h" | "7d" | "30d";

type Summary = {
  vaults_eligible: number;
  vaults_with_change: number;
  tracked_tvl_usd: number | null;
  tvl_weighted_delta?: number | null;
  riser_vaults?: number;
  faller_vaults?: number;
  flat_vaults?: number;
  riser_tvl_usd?: number | null;
  faller_tvl_usd?: number | null;
};

type ChangeRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  tvl_usd: number | null;
  realized_apy_window: number | null;
  realized_apy_prev_window: number | null;
  delta_apy: number | null;
  age_seconds: number | null;
};

type ChangesResponse = {
  summary: Summary;
  freshness?: {
    newest_comparison_age_seconds?: number | null;
    current_comparisons?: number | null;
    tracked_comparisons?: number | null;
  };
  movers?: {
    risers: ChangeRow[];
    fallers: ChangeRow[];
  };
};

type TrendDailyRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  riser_ratio?: number | null;
};

export type TrendDailyResponse = {
  methodology?: {
    membership?: "current_selected_vault_set";
    weighting?: "current_tvl_usd";
    interpretation?: "retrospective_yield_for_current_set";
  };
  rows?: TrendDailyRow[];
};

interface UseChangesDataParams {
  universe: UniverseKind;
  market: MarketKind;
  minTvl: number;
  minPoints: number;
  window: WindowKey;
  staleThreshold: StaleThresholdKey;
}

interface UseTrendDailyParams {
  universe: UniverseKind;
  market: MarketKind;
  minTvl: number;
  minPoints: number;
  days: number;
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
    market: params.market,
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
    market: params.market,
  });

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
