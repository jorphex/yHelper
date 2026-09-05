"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { MarketKind, UniverseKind } from "../lib/universe";

type DiscoverRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  market: MarketKind;
  tvl_usd: number | null;
  est_apy: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
};

type DiscoverResponse = {
  pagination: { total: number; limit: number; offset: number };
  summary?: {
    total_tvl_usd?: number | null;
    tvl_weighted_realized_apy_30d?: number | null;
  };
  coverage?: {
    visible_vaults?: number;
    with_realized_apy?: number;
    coverage_ratio?: number | null;
    without_realized_apy?: number;
  };
  facets?: { chains?: Array<{ chain_id: number; vaults: number }> };
  rows: DiscoverRow[];
};

interface UseDiscoverDataParams {
  universe: UniverseKind;
  market: MarketKind;
  minTvl: number;
  minPoints: number;
  limit: number;
  sort: string;
  dir: string;
  chain?: string | null;
  enabled?: boolean;
  allRows?: boolean;
}

export async function fetchDiscoverData(params: UseDiscoverDataParams): Promise<DiscoverResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    limit: String(params.limit),
    sort_by: params.sort,
    direction: params.dir,
    market: params.market,
  });
  if (params.chain) searchParams.set("chain_id", params.chain);
  const res = await fetch(apiUrl("/discover", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json() as DiscoverResponse;
  if (params.allRows) {
    while (data.rows.length < data.pagination.total) {
      searchParams.set("offset", String(data.rows.length));
      const next = await fetch(apiUrl("/discover", searchParams), { cache: "no-store" });
      if (!next.ok) throw new Error(`API error: ${next.status}`);
      const page = await next.json() as DiscoverResponse;
      if (!page.rows.length) break;
      data.rows.push(...page.rows);
    }
  }
  return data;
}

export function useDiscoverData(params: UseDiscoverDataParams) {
  const { enabled = true, ...request } = params;
  return useQuery({
    queryKey: ["discover", request],
    queryFn: () => fetchDiscoverData(request),
    enabled,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
