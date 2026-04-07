"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type DiscoverRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  est_apy: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  risk_level: string | null;
  is_retired: boolean;
  is_highlighted: boolean;
  migration_available: boolean;
  strategies_count: number;
  regime: string;
};

type DiscoverResponse = {
  pagination: { total: number; limit: number; offset: number };
  summary?: {
    vaults?: number;
    chains?: number;
    tokens?: number;
    categories?: number;
    total_tvl_usd?: number | null;
    avg_est_apy?: number | null;
    median_est_apy?: number | null;
    tvl_weighted_est_apy?: number | null;
    avg_realized_apy_30d?: number | null;
    median_realized_apy_30d?: number | null;
    tvl_weighted_realized_apy_30d?: number | null;
    avg_momentum_7d_30d?: number | null;
    median_momentum_7d_30d?: number | null;
    avg_consistency_score?: number | null;
    retired_vaults?: number;
    highlighted_vaults?: number;
    migration_ready_vaults?: number;
    avg_strategies_per_vault?: number | null;
    apy_negative_vaults?: number;
    apy_low_vaults?: number;
    apy_mid_vaults?: number;
    apy_high_vaults?: number;
  };
  coverage?: {
    visible_vaults?: number;
    with_realized_apy?: number;
    missing_metrics?: number;
    low_points?: number;
    missing_or_low_points?: number;
    coverage_ratio?: number | null;
    visible_tvl_usd?: number | null;
    with_realized_apy_tvl_usd?: number | null;
  };
  risk_mix?: Array<{ risk_level: string; vaults: number; tvl_usd: number | null }>;
  rows: DiscoverRow[];
};

interface UseDiscoverDataParams {
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  limit: number;
  sort: string;
  dir: string;
  chain?: string | null;
  category?: string | null;
  token?: string | null;
}

export async function fetchDiscoverData(params: UseDiscoverDataParams): Promise<DiscoverResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    limit: String(params.limit),
    sort_by: params.sort,
    direction: params.dir,
  });
  if (params.chain) searchParams.set("chain_id", params.chain);
  if (params.category) searchParams.set("category", params.category);
  if (params.token) searchParams.set("token_symbol", params.token);

  const res = await fetch(apiUrl("/discover", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<DiscoverResponse>;
}

export function useDiscoverData(params: UseDiscoverDataParams) {
  return useQuery({
    queryKey: ["discover", params],
    queryFn: () => fetchDiscoverData(params),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
