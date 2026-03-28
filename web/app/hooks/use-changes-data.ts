"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type ChangesRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  previous_apy: number | null;
  current_apy: number | null;
  delta_apy: number | null;
  pps_timestamp: string | null;
  previous_pps_timestamp: string | null;
};

type ChangesResponse = {
  filters: {
    window: string;
    stale_threshold: string;
    universe: string;
    min_tvl_usd: number;
  };
  summary: {
    vaults: number;
    with_change: number;
    stale_vaults: number;
    total_tvl: number | null;
    tracked_tvl: number | null;
    yearn_aligned_proxy_tvl: number | null;
    yearn_aligned_vaults: number;
    filtered_vs_yearn_gap: number | null;
    filtered_vs_yearn_ratio: number | null;
    avg_delta: number | null;
  };
  freshness: {
    latest_pps_age_seconds: number | null;
    window_fresh_vaults: number;
    window_stale_vaults: number;
    window_missing_vaults: number;
    fresh_tracked_tvl: number | null;
    stale_tracked_tvl: number | null;
    missing_tracked_tvl: number | null;
  };
  risers: ChangesRow[];
  fallers: ChangesRow[];
  stale: ChangesRow[];
};

interface UseChangesDataParams {
  universe: UniverseKind;
  minTvl: number;
  window: string;
  staleThreshold: string;
}

async function fetchChangesData(params: UseChangesDataParams): Promise<ChangesResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    window: params.window,
    stale_threshold: params.staleThreshold,
  });

  const res = await fetch(apiUrl("/changes", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ChangesResponse>;
}

export function useChangesData(params: UseChangesDataParams) {
  return useQuery({
    queryKey: ["changes", params],
    queryFn: () => fetchChangesData(params),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
