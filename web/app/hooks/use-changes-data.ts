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

interface UseChangesDataParams {
  universe: UniverseKind;
  market: MarketKind;
  minTvl: number;
  minPoints: number;
  window: WindowKey;
  staleThreshold: StaleThresholdKey;
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

export function useChangesData(params: UseChangesDataParams) {
  return useQuery({
    queryKey: ["changes", params],
    queryFn: () => fetchChangesData(params),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
