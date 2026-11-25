"use client";

import { queryOptions } from "@tanstack/react-query";
import type { SourceFreshness } from "../components/source-notes";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";
import { MarketKind, UniverseKind } from "../lib/universe";

export const CHANGE_WINDOWS = ["24h", "7d", "30d"] as const;
export type WindowKey = typeof CHANGE_WINDOWS[number];

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

export type ChangeRow = {
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
  source_freshness?: SourceFreshness;
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
}

export function changesOptions(params: UseChangesDataParams) {
  return queryOptions({
    queryKey: ["changes", params],
    queryFn: ({ signal }) => fetchJson<ChangesResponse>(apiUrl("/changes", {
      window: params.window,
      stale_threshold: "auto",
      universe: params.universe,
      min_tvl_usd: params.minTvl,
      min_points: params.minPoints,
      limit: 60,
      market: params.market,
    }), { signal }),
    staleTime: 30_000,
  });
}
