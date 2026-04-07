"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

const HARVEST_REFRESH_MS = 60_000;

export type HarvestResponse = {
  metric?: {
    headline_label?: string;
    history_label?: string;
    history_window_label?: string;
  } | null;
  filters?: {
    chain_id?: number | null;
    chain_label?: string | null;
    vault_address?: string | null;
    limit?: number | null;
  } | null;
  trailing_24h?: {
    harvest_count?: number | null;
    vault_count?: number | null;
    strategy_count?: number | null;
  } | null;
  chain_rollups?: Array<{
    chain_id: number;
    chain_label?: string | null;
    harvest_count: number;
    vault_count: number;
    strategy_count: number;
    last_harvest_at?: string | null;
  }> | null;
  daily_by_chain?: Array<{
    day_utc: string;
    chain_id: number;
    chain_label?: string | null;
    harvest_count: number;
    vault_count: number;
    strategy_count: number;
  }> | null;
  recent?: Array<{
    chain_id: number;
    chain_label?: string | null;
    block_time: string;
    tx_hash: string;
    vault_address: string;
    vault_symbol?: string | null;
    token_symbol?: string | null;
    token_decimals?: number | null;
    vault_version?: string | null;
    strategy_address: string;
    gain?: string | null;
    loss?: string | null;
    debt_after?: string | null;
    fee_assets?: string | null;
    refund_assets?: string | null;
  }> | null;
  last_run?: {
    status?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
  } | null;
} | null;

export type HarvestQuery = {
  days?: number;
  chainId?: number | null;
  vaultAddress?: string | null;
  limit?: number;
};

export async function fetchHarvestData(query: HarvestQuery): Promise<HarvestResponse> {
  const res = await fetch(
    apiUrl("/harvests", {
      days: query.days ?? 90,
      chain_id: query.chainId ?? undefined,
      vault_address: query.vaultAddress ?? undefined,
      limit: query.limit ?? 50,
    }),
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Harvest API request failed with ${res.status}`);
  }
  return (await res.json()) as HarvestResponse;
}

export function useHarvestData(query: HarvestQuery) {
  return useQuery({
    queryKey: ["harvests", query.days ?? 90, query.chainId ?? null, query.vaultAddress ?? null, query.limit ?? 50],
    queryFn: () => fetchHarvestData(query),
    refetchInterval: HARVEST_REFRESH_MS,
    staleTime: 30_000,
  });
}
