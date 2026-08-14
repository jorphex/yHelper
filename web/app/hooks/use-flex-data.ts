"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

export type FlexStatus = "active" | "deprecated" | "unendorsed";

export type FlexFreshness = {
  data_state: "ready" | "delayed" | "unavailable";
  indexed_through: string | null;
  age_seconds: number | null;
  stale_after_seconds: number;
  block_number: number | null;
  reconciliation_verdict: "ok" | "mismatch" | "unavailable" | null;
  reconciliation_checked_at: string | null;
};

export type FlexMarketMetrics = {
  collateral_raw: string;
  collateral: number;
  collateral_usd: number;
  debt_raw: string;
  debt: number;
  debt_usd: number;
  deposits_raw: string;
  deposits: number;
  deposits_usd: number;
  idle_liquidity_raw: string;
  idle_liquidity: number;
  idle_liquidity_usd: number;
  utilization: number;
  lender_apr: number;
  average_borrow_rate: number;
};

export type FlexMarket = {
  chain_id: 1;
  label: string;
  status: FlexStatus;
  endorsement_status: "endorsed" | "unendorsed";
  contract_version: "1.0.0" | "1.1.0";
  deployment_block: number;
  deployment_time: string;
  collateral_token: { address: string; symbol: string; decimals: number };
  borrow_token: { address: string; symbol: string; decimals: number };
  addresses: {
    market: string;
    lender: string;
    collateral_token: string;
    borrow_token: string;
    price_oracle: string;
    auction: string;
  };
  metrics: FlexMarketMetrics | null;
  latest_block_number: number | null;
  latest_block_time: string | null;
};

type FlexSummary = {
  markets: { total: number; active: number; deprecated: number; unendorsed: number };
  collateral_usd: number;
  debt_usd: number;
  deposits_usd: number;
  idle_liquidity_usd: number;
  utilization: number | null;
  weighted_lender_apr: number | null;
  weighted_average_borrow_rate: number | null;
};

export type FlexMarketsResponse = {
  freshness: FlexFreshness;
  summary: FlexSummary;
  rows: FlexMarket[];
};

export type FlexHistoryPoint = {
  sampled_at: string;
  block_number: number;
  block_time: string;
  collateral_usd: number;
  debt_usd: number;
  deposits_usd: number;
  idle_liquidity_usd: number;
  utilization: number;
  lender_apr: number;
  average_borrow_rate: number;
};

export type FlexMarketDetailResponse = {
  freshness: FlexFreshness;
  market: FlexMarket;
  risk: {
    minimum_debt_raw: string | null;
    minimum_debt: number | null;
    safe_ltv: number | null;
    maximum_ltv: number | null;
    maximum_penalty_ltv: number | null;
    minimum_liquidation_fee: number | null;
    maximum_liquidation_fee: number | null;
    minimum_annual_interest_rate: number | null;
    maximum_annual_interest_rate: number | null;
  };
  oracle: {
    address: string;
    description: string | null;
    collateral_price_in_borrow_token: number | null;
    borrow_token_usd_price: number | null;
  };
};

export type FlexHistoryResponse = {
  market_address: string;
  freshness: FlexFreshness;
  coverage: {
    requested_start: string;
    first_point_at: string | null;
    latest_point_at: string | null;
    points: number;
    expected_points: number;
    coverage_ratio: number;
  };
  points: FlexHistoryPoint[];
};

export type FlexRedemptionPriorityPoint = {
  annual_interest_rate_raw: string;
  annual_interest_rate: number;
  redeemable_before_raw: string;
  redeemable_before: number;
};

export type FlexRedemptionPriorityResponse = {
  scope: { chain_id: 1; network: "ethereum"; source: "flex_ui_api" };
  market_address: string;
  borrow_token: { address: string; symbol: string; decimals: number };
  rate_scale: { one_pct_raw: string; unit: string };
  total_debt_raw: string | null;
  total_debt: number | null;
  points: FlexRedemptionPriorityPoint[];
  source_url: string | null;
  freshness: {
    data_state: "ready" | "delayed" | "unavailable";
    source_block_number: number | null;
    source_block_time: string | null;
    source_age_seconds: number | null;
    fetched_at: string | null;
    fetched_age_seconds: number | null;
    stale_after_seconds: number;
    last_attempted_at: string | null;
    last_error: string | null;
  };
};

export type FlexActivityRow = {
  chain_id: 1;
  market_address: string;
  market_label: string;
  contract_version: string;
  block_number: number;
  block_time: string;
  tx_hash: string;
  log_index: number;
  event: string;
  actors: Record<string, string | number | boolean>;
  amounts: Record<string, string | number | boolean>;
};

type FlexActivityResponse = {
  freshness: FlexFreshness;
  pagination: { limit: number; next_cursor: string | null };
  rows: FlexActivityRow[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Flex request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function useFlexMarkets() {
  return useQuery({
    queryKey: ["flex-markets", "all"],
    queryFn: () => fetchJson<FlexMarketsResponse>(apiUrl("/flex/markets", { status: "all" })),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useFlexHistory(marketAddress: string | null, days: 7 | 30 | 90) {
  return useQuery({
    queryKey: ["flex-history", marketAddress, days],
    queryFn: () => fetchJson<FlexHistoryResponse>(apiUrl(`/flex/markets/${marketAddress}/history`, {
      days,
      interval: "day",
    })),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
  });
}

export function useFlexMarketDetail(marketAddress: string | null) {
  return useQuery({
    queryKey: ["flex-market-detail", marketAddress],
    queryFn: () => fetchJson<FlexMarketDetailResponse>(apiUrl(`/flex/markets/${marketAddress}`)),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
  });
}

export function useFlexRedemptionPriority(marketAddress: string | null) {
  return useQuery({
    queryKey: ["flex-redemption-priority", marketAddress],
    queryFn: () => fetchJson<FlexRedemptionPriorityResponse>(apiUrl(`/flex/markets/${marketAddress}/redemption-priority`)),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useFlexActivity() {
  return useInfiniteQuery({
    queryKey: ["flex-activity"],
    queryFn: ({ pageParam }) => fetchJson<FlexActivityResponse>(apiUrl("/flex/activity", {
      limit: 12,
      cursor: pageParam || undefined,
    })),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.pagination.next_cursor ?? undefined,
    staleTime: 60_000,
  });
}
