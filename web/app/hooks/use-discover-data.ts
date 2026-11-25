"use client";

import { queryOptions } from "@tanstack/react-query";
import type { SourceFreshness } from "../components/source-notes";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";
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
  source_freshness?: SourceFreshness;
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
  sort: string;
  dir: string;
  chain: number | null;
}

async function fetchDiscoverData(params: UseDiscoverDataParams, signal: AbortSignal): Promise<DiscoverResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    limit: "250",
    sort_by: params.sort,
    direction: params.dir,
    market: params.market,
  });
  if (params.chain !== null) searchParams.set("chain_id", String(params.chain));
  const data = await fetchJson<DiscoverResponse>(apiUrl("/discover", searchParams), { signal });
  while (data.rows.length < data.pagination.total) {
    searchParams.set("offset", String(data.rows.length));
    const page = await fetchJson<DiscoverResponse>(apiUrl("/discover", searchParams), { signal });
    if (!page.rows.length) break;
    data.rows.push(...page.rows);
  }
  return data;
}

export function discoverOptions(params: UseDiscoverDataParams) {
  return queryOptions({
    queryKey: ["discover", params],
    queryFn: ({ signal }) => fetchDiscoverData(params, signal),
    staleTime: 30_000,
  });
}
