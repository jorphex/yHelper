"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

const HOME_REFRESH_MS = 60_000;

type OverviewResponse = {
  protocol_context?: {
    protocol?: { tvl_usd?: number | null; observed_at?: string | null } | null;
    catalog?: { active_yearn?: { vaults?: number | null; gross_tvl_usd?: number | null } | null } | null;
  } | null;
};

export type HomeMover = {
  vault_address?: string | null;
  chain_id?: number | null;
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  realized_apy_30d?: number | null;
};

type ChangesResponse = {
  summary?: {
    vaults_with_change?: number | null;
    riser_vaults?: number | null;
    faller_vaults?: number | null;
    riser_tvl_usd?: number | null;
    faller_tvl_usd?: number | null;
    tvl_weighted_delta?: number | null;
  } | null;
  movers?: { risers?: HomeMover[]; fallers?: HomeMover[] } | null;
};

export type HomeAsset = {
  token_symbol: string;
  venues: number;
  chains: number;
  total_tvl_usd: number | null;
  realized_spread_30d: number | null;
  best_realized_apy_30d: number | null;
  weighted_realized_apy_30d: number | null;
};

type AssetsResponse = { rows?: HomeAsset[] };

type HomeData = {
  overview: OverviewResponse | null;
  changes: ChangesResponse | null;
  assets: AssetsResponse | null;
};

export async function fetchHomeData(): Promise<HomeData> {
  const [overviewRes, changesRes, assetsRes] = await Promise.allSettled([
    fetch(apiUrl("/overview"), { cache: "no-store" }),
    fetch(apiUrl("/changes", { window: "7d", universe: "core", limit: 3 }), { cache: "no-store" }),
    fetch(apiUrl("/assets", {
      universe: "core",
      market: "all",
      token_scope: "featured",
      sort_by: "spread",
      direction: "desc",
      limit: 3,
    }), { cache: "no-store" }),
  ]);
  const overview = overviewRes.status === "fulfilled" && overviewRes.value.ok
    ? await overviewRes.value.json() as OverviewResponse : null;
  const changes = changesRes.status === "fulfilled" && changesRes.value.ok
    ? await changesRes.value.json() as ChangesResponse : null;
  const assets = assetsRes.status === "fulfilled" && assetsRes.value.ok
    ? await assetsRes.value.json() as AssetsResponse : null;
  return { overview, changes, assets };
}

export function useHomeData() {
  return useQuery({
    queryKey: ["home"],
    queryFn: fetchHomeData,
    refetchInterval: HOME_REFRESH_MS,
    staleTime: 30_000,
  });
}
