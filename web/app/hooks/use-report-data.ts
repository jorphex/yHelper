"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";

const REPORT_REFRESH_MS = 60_000;

export type ReportResponse = {
  trailing_24h?: {
    report_count?: number | null;
    vault_count?: number | null;
    strategy_count?: number | null;
  } | null;
  available_chains?: Array<{ chain_id: number; chain_label?: string | null }> | null;
  recent?: Array<{
    chain_id: number;
    chain_label?: string | null;
    block_time: string;
    tx_hash: string;
    log_index: number;
    vault_address: string;
    vault_symbol?: string | null;
    token_symbol?: string | null;
    token_decimals?: number | null;
    vault_version?: string | null;
    strategy_address: string;
    strategy_name?: string | null;
    report_type?: "realized_result" | "accounting_update";
    gain?: string | null;
    loss?: string | null;
    debt_after?: string | null;
    fee_assets?: string | null;
    refund_assets?: string | null;
  }> | null;
} | null;

export type ReportQuery = {
  days?: number;
  chainId?: number | null;
  vaultAddress?: string | null;
  limit?: number;
  meaningfulOnly?: boolean;
};

export async function fetchReportData(query: ReportQuery, signal?: AbortSignal): Promise<ReportResponse> {
  return fetchJson<ReportResponse>(
    apiUrl("/reports", {
      days: query.days ?? 90,
      chain_id: query.chainId ?? undefined,
      vault_address: query.vaultAddress ?? undefined,
      limit: query.limit ?? 50,
      meaningful_only: query.meaningfulOnly ?? false,
    }),
    { signal },
  );
}

export function useReportData(query: ReportQuery) {
  return useQuery({
    queryKey: ["reports", query.days ?? 90, query.chainId ?? null, query.vaultAddress ?? null, query.limit ?? 50, query.meaningfulOnly ?? false],
    queryFn: ({ signal }) => fetchReportData(query, signal),
    refetchInterval: REPORT_REFRESH_MS,
    staleTime: 30_000,
  });
}
