"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";
import type { SourceFreshness } from "../components/source-notes";

export type VaultHistoryPoint = {
  timestamp: number;
  pps: number | null;
  apy_7d: number | null;
  tvl_usd: number | null;
};

export type VaultHistory = {
  vault: { chain_id: number; vault_address: string; symbol: string | null; name: string | null; token_symbol: string | null; est_apy: number | null };
  points: VaultHistoryPoint[];
  source_freshness: SourceFreshness;
  history_state: "ready" | "partial" | "delayed" | "unavailable";
  history_delayed: boolean;
  retry_after_seconds: number;
  pps_source: "kong" | "stored" | "cached" | "unavailable";
  tvl_source: "kong" | "cached" | "unavailable";
  fetched_at: string;
};

export function useVaultHistory(chainId: number, address: string) {
  return useQuery({
    queryKey: ["vault-history", chainId, address.toLowerCase()],
    queryFn: ({ signal }) => fetchJson<VaultHistory>(apiUrl(`/vaults/${chainId}/${address.toLowerCase()}/history`), { signal }),
    enabled: Number.isInteger(chainId) && chainId > 0 && /^0x[0-9a-fA-F]{40}$/.test(address),
    staleTime: query => query.state.data?.history_state === "ready" ? 5 * 60_000 : 15_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
