"use client";

import { queryOptions } from "@tanstack/react-query";
import type { SourceFreshness } from "../components/source-notes";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";
import { MarketKind, UniverseKind } from "../lib/universe";

export type BreakdownRow = {
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
}

export function compositionOptions(params: UseCompositionDataParams) {
  return queryOptions({
    queryKey: ["composition", params],
    queryFn: ({ signal }) => fetchJson<CompositionResponse>(apiUrl("/composition", {
      universe: params.universe,
      min_tvl_usd: params.minTvl,
      market: params.market,
    }), { signal }),
    staleTime: 30_000,
  });
}
