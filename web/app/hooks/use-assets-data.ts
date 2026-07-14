"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { MarketKind, UniverseKind } from "../lib/universe";

type AssetRow = {
  token_symbol: string;
  vaults: number;
  chains: number;
  total_tvl_usd: number | null;
  best_realized_apy_30d: number | null;
  weighted_realized_apy_30d: number | null;
  realized_spread_30d: number | null;
};

type AssetsResponse = {
  summary?: {
    tokens?: number;
    total_tvl_usd?: number;
    total_vaults?: number;
  };
  rows: AssetRow[];
};

type AssetVaultRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  tvl_usd: number | null;
  est_apy: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
};

type AssetVaultsResponse = {
  token_symbol: string;
  summary: {
    vaults: number;
    chains: number;
    total_tvl_usd: number;
    best_realized_apy_30d: number | null;
    worst_realized_apy_30d: number | null;
    realized_spread_30d: number | null;
    weighted_realized_apy_30d: number | null;
  };
  rows: AssetVaultRow[];
};

interface UseAssetsDataParams {
  universe: UniverseKind;
  market: MarketKind;
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
    market: params.market,
  });

  const res = await fetch(apiUrl("/assets", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AssetsResponse>;
}

export async function fetchAssetVaults(
  token: string,
  params: { universe: UniverseKind; minTvl: number; minPoints: number }
): Promise<AssetVaultsResponse> {
  const searchParams = new URLSearchParams({
    universe: params.universe,
    min_tvl_usd: String(params.minTvl),
    min_points: String(params.minPoints),
  });

  const res = await fetch(apiUrl(`/assets/${encodeURIComponent(token)}/vaults`, searchParams), {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AssetVaultsResponse>;
}

export function useAssetsData(params: UseAssetsDataParams) {
  return useQuery({
    queryKey: ["assets", params],
    queryFn: () => fetchAssetsData(params),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}

export function useAssetVaults(token: string | null, params: { universe: UniverseKind; minTvl: number; minPoints: number }) {
  return useQuery({
    queryKey: ["assetVaults", token, params],
    queryFn: () => {
      if (!token) throw new Error("No token selected");
      return fetchAssetVaults(token, params);
    },
    enabled: !!token,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}
