"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { MarketKind, UniverseKind } from "../lib/universe";

type BreakdownRow = {
  chain_id?: number;
  category?: string;
  token_symbol?: string;
  vaults: number;
  tvl_usd: number | null;
  share_tvl?: number | null;
};

type CompositionResponse = {
  summary: {
    vaults: number;
    total_tvl_usd: number | null;
  };
  chains: BreakdownRow[];
  categories: BreakdownRow[];
  tokens: BreakdownRow[];
};

interface UseCompositionDataParams {
  universe: UniverseKind;
  market: MarketKind;
  minTvl: number;
}

export async function fetchCompositionData(params: UseCompositionDataParams): Promise<CompositionResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    market: params.market,
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
