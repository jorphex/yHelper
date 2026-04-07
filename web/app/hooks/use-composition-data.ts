"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type BreakdownRow = {
  chain_id?: number;
  category?: string;
  token_symbol?: string;
  vaults: number;
  tvl_usd: number | null;
  share_tvl?: number | null;
  weighted_realized_apy_30d?: number | null;
};

type CrowdingRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  crowding_index: number | null;
};

type CompositionResponse = {
  summary: {
    vaults: number;
    total_tvl_usd: number | null;
    avg_realized_apy_30d: number | null;
  };
  concentration: {
    chain_hhi: number | null;
    category_hhi: number | null;
    token_hhi: number | null;
  };
  chains: BreakdownRow[];
  categories: BreakdownRow[];
  tokens: BreakdownRow[];
  crowding: {
    most_crowded: CrowdingRow[];
    least_crowded: CrowdingRow[];
  };
};

interface UseCompositionDataParams {
  universe: UniverseKind;
  minTvl: number;
}

export async function fetchCompositionData(params: UseCompositionDataParams): Promise<CompositionResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
  });

  const res = await fetch(apiUrl("/composition", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<CompositionResponse>;
}

export function useCompositionData(params: UseCompositionDataParams) {
  return useQuery({
    queryKey: ["composition", params],
    queryFn: () => fetchCompositionData(params),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
