"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type RegimeSummary = {
  regime: string;
  vaults: number;
  tvl_usd: number;
};

type RegimeMover = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  tvl_usd: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  regime: string;
};

type RegimeResponse = {
  summary: RegimeSummary[];
  movers: RegimeMover[];
};

type TransitionRow = {
  previous_regime: string;
  current_regime: string;
  vaults: number;
  tvl_usd: number | null;
  avg_current_momentum: number | null;
  avg_previous_momentum: number | null;
};

type TransitionResponse = {
  summary?: {
    vaults_total?: number;
    changed_vaults?: number;
    changed_ratio?: number | null;
    tvl_total_usd?: number | null;
    changed_tvl_usd?: number | null;
    changed_tvl_ratio?: number | null;
  };
  matrix?: TransitionRow[];
  chain_breakdown?: Array<{
    chain_id: number;
    vaults: number;
    tvl_usd: number | null;
    changed_vaults: number;
    changed_tvl_usd: number | null;
    changed_ratio: number | null;
  }>;
};

type TransitionDailyRow = {
  day: string;
  changed_ratio?: number | null;
  changed_tvl_ratio?: number | null;
  momentum_spread?: number | null;
};

type TransitionDailyResponse = {
  rows?: TransitionDailyRow[];
  grouped?: {
    group_by?: "none" | "chain" | "category";
    rows?: Array<TransitionDailyRow & { group_key: string; tvl_total_usd?: number | null }>;
    latest?: Array<TransitionDailyRow & { group_key: string; tvl_total_usd?: number | null }>;
    series?: Record<string, Array<TransitionDailyRow & { group_key: string; tvl_total_usd?: number | null }>>;
  };
};

interface UseRegimesDataParams {
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  limit?: number;
  chainId?: number | null;
  days?: number;
  groupBy?: "none" | "chain" | "category";
  groupLimit?: number;
  enabled?: boolean;
}

export async function fetchRegimesData(params: UseRegimesDataParams): Promise<RegimeResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
  });
  if (params.limit) searchParams.set("limit", String(params.limit));
  if ((params.chainId ?? 0) > 0) searchParams.set("chain_id", String(params.chainId));

  const res = await fetch(apiUrl("/regimes", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<RegimeResponse>;
}

export async function fetchTransitionsData(params: UseRegimesDataParams): Promise<TransitionResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
  });
  if (params.limit) searchParams.set("limit", String(params.limit));
  if ((params.chainId ?? 0) > 0) searchParams.set("chain_id", String(params.chainId));

  const res = await fetch(apiUrl("/regimes/transitions", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<TransitionResponse>;
}

export async function fetchTransitionsDailyData(params: UseRegimesDataParams): Promise<TransitionDailyResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    days: String(params.days ?? 90),
  });
  if (params.groupBy) searchParams.set("group_by", params.groupBy);
  if (params.groupLimit) searchParams.set("group_limit", String(params.groupLimit));
  if ((params.chainId ?? 0) > 0) searchParams.set("chain_id", String(params.chainId));

  const res = await fetch(apiUrl("/regimes/transitions/daily", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<TransitionDailyResponse>;
}

export function useRegimesData(params: UseRegimesDataParams) {
  return useQuery({
    queryKey: ["regimes", params],
    queryFn: () => fetchRegimesData(params),
    enabled: params.enabled ?? true,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}

export function useTransitionsData(params: UseRegimesDataParams) {
  return useQuery({
    queryKey: ["transitions", params],
    queryFn: () => fetchTransitionsData(params),
    enabled: params.enabled ?? true,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}

export function useTransitionsDailyData(params: UseRegimesDataParams) {
  return useQuery({
    queryKey: ["transitions-daily", params],
    queryFn: () => fetchTransitionsDailyData(params),
    enabled: params.enabled ?? true,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
