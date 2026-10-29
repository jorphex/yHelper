"use client";

import { useQuery } from "@tanstack/react-query";
import type { SourceFreshness } from "../components/source-notes";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";
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
  source_freshness?: SourceFreshness;
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
  enabled?: boolean;
}

export async function fetchCompositionData(params: UseCompositionDataParams, signal?: AbortSignal): Promise<CompositionResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    market: params.market,
  });

  return fetchJson<CompositionResponse>(apiUrl("/composition", searchParams), { signal });
}

export function useCompositionData(params: UseCompositionDataParams) {
  const { enabled = true, ...request } = params;
  return useQuery({
    queryKey: ["composition", request],
    queryFn: ({ signal }) => fetchCompositionData(request, signal),
    enabled,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
