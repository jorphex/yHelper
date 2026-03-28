"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type ChainRow = {
  chain_id: number;
  active_vaults: number;
  with_metrics: number;
  total_tvl_usd: number | null;
  weighted_apy_30d: number | null;
  avg_momentum_7d_30d: number | null;
  avg_consistency: number | null;
};

type ChainsResponse = {
  summary?: {
    chains?: number;
    total_tvl_usd?: number;
    active_vaults?: number;
    with_metrics?: number;
    metrics_coverage_ratio?: number | null;
    tvl_weighted_apy_30d?: number | null;
    median_chain_apy_30d?: number | null;
    tvl_hhi?: number | null;
    top_chain_id?: number | null;
    top_chain_tvl_share?: number | null;
  };
  rows: ChainRow[];
};

interface UseChainsDataParams {
  universe: UniverseKind;
  minTvl: number;
}

async function fetchChainsData(params: UseChainsDataParams): Promise<ChainsResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
  });

  const res = await fetch(apiUrl("/chains/rollups", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ChainsResponse>;
}

export function useChainsData(params: UseChainsDataParams) {
  return useQuery({
    queryKey: ["chains", params],
    queryFn: () => fetchChainsData(params),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
