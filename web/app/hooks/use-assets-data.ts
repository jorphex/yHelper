"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { UniverseKind } from "../lib/universe";

type AssetRow = {
  token_symbol: string;
  token_type?: "canonical" | "structured";
  venues: number;
  chains: number;
  total_tvl_usd: number | null;
  best_est_apy: number | null;
  weighted_est_apy: number | null;
  best_realized_apy_30d: number | null;
  weighted_realized_apy_30d: number | null;
  realized_spread_30d: number | null;
};

type AssetsResponse = {
  filters?: {
    token_scope?: "featured" | "canonical" | "all";
    featured_min_tvl_usd?: number;
    featured_min_venues?: number;
    featured_min_chains?: number;
  };
  summary?: {
    tokens?: number;
    tokens_available_featured?: number;
    tokens_available_all?: number;
    tokens_available_canonical?: number;
    tokens_available_structured?: number;
    total_tvl_usd?: number;
    total_venues?: number;
    avg_venues_per_token?: number | null;
    multi_chain_tokens?: number;
    high_spread_tokens?: number;
    median_realized_spread_30d?: number | null;
    median_best_est_apy?: number | null;
    median_best_realized_apy_30d?: number | null;
    tvl_weighted_est_apy?: number | null;
    tvl_weighted_realized_apy_30d?: number | null;
    top_token_symbol?: string | null;
    top_token_tvl_share?: number | null;
  };
  rows: AssetRow[];
};

type VenueRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  category: string | null;
  version: string | null;
  tvl_usd: number | null;
  est_apy: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  regime: string;
};

type AssetVenuesResponse = {
  token_symbol: string;
  summary: {
    venues: number;
    chains: number;
    total_tvl_usd: number;
    best_est_apy: number | null;
    weighted_est_apy: number | null;
    best_realized_apy_30d: number | null;
    worst_realized_apy_30d: number | null;
    realized_spread_30d: number | null;
    weighted_realized_apy_30d: number | null;
    best_venue_symbol: string | null;
    median_est_apy?: number | null;
    median_realized_apy_30d?: number | null;
    median_momentum_7d_30d?: number | null;
    tvl_weighted_momentum_7d_30d?: number | null;
    regime_counts?: Array<{ regime: string; vaults: number }>;
  };
  rows: VenueRow[];
};

interface UseAssetsDataParams {
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  limit: number;
  tokenScope: string;
  apiSort: string;
  apiDir: string;
}

export async function fetchAssetsData(params: UseAssetsDataParams): Promise<AssetsResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
    limit: String(params.limit),
    token_scope: params.tokenScope,
    sort_by: params.apiSort,
    direction: params.apiDir,
  });

  const res = await fetch(apiUrl("/assets", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AssetsResponse>;
}

export async function fetchAssetVenues(
  token: string,
  params: { universe: UniverseKind; minTvl: number; minPoints: number }
): Promise<AssetVenuesResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
  });

  const res = await fetch(apiUrl(`/assets/${encodeURIComponent(token)}/venues`, searchParams), {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AssetVenuesResponse>;
}

export function useAssetsData(params: UseAssetsDataParams) {
  return useQuery({
    queryKey: ["assets", params],
    queryFn: () => fetchAssetsData(params),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}

export function useAssetVenues(token: string | null, params: { universe: UniverseKind; minTvl: number; minPoints: number }) {
  return useQuery({
    queryKey: ["assetVenues", token, params],
    queryFn: () => {
      if (!token) throw new Error("No token selected");
      return fetchAssetVenues(token, params);
    },
    enabled: !!token,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
