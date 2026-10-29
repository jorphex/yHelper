"use client";

import { useInfiniteQuery, useQuery, useQueryClient, type QueryFunctionContext } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";

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
  idle_liquidity_raw: string | null;
  idle_liquidity: number | null;
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

export type FlexTroveHealthResponse = {
  scope: { chain_id: 1; network: "ethereum"; source: "flex_ui_api" };
  market_address: string;
  collateral_token: { address: string; symbol: string; decimals: number };
  borrow_token: { address: string; symbol: string; decimals: number };
  metrics: {
    active_troves: number;
    total_collateral_raw: string;
    total_collateral: number;
    total_debt_raw: string;
    total_debt: number;
    median_ltv: number | null;
    maximum_position_ltv: number | null;
    minimum_buffer_to_max_ltv: number | null;
    near_max_threshold: number;
    near_max_troves: number;
    debt_near_max_raw: string;
    debt_near_max: number;
    debt_near_max_share: number | null;
    largest_debt_share: number | null;
  } | null;
  freshness: FlexRedemptionPriorityResponse["freshness"];
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

export type FlexPerformanceRow = {
  market_address: string;
  market_label: string;
  kind: "trove" | "lender_position" | "lender_pool";
  position_id: string | null;
  start_value_usd: number | null;
  end_value_usd: number | null;
  net_funding_usd: number | null;
  pnl_usd: number | null;
  is_complete: boolean;
  issue: string | null;
};

type FlexPerformanceSide = {
  pnl_usd: number | null;
  end_value_usd: number | null;
  positions: number;
  covered_positions: number;
  rows: FlexPerformanceRow[];
};

export type FlexPerformanceResponse = {
  scope: { chain_id: 1; source: "ethereum_archive_rpc"; address: string | null; market_status: "active" | "all" };
  period: { days: number; start_at: string; end_at: string; start_block: number; end_block: number };
  freshness: { data_state: "ready" | "delayed" };
  borrowers: FlexPerformanceSide;
  lenders: FlexPerformanceSide;
};

export const FLEX_PERIODS = [7, 30, 90] as const;

function performanceOptions(address: string | null, days: 7 | 30 | 90) {
  return {
    queryKey: ["flex-performance", address, days],
    queryFn: ({ signal }: QueryFunctionContext) => fetchJson<FlexPerformanceResponse>(apiUrl("/flex/performance", { address, days }), { signal, timeoutMs: 75_000 }),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  };
}

export function useFlexPerformance(address: string | null, days: 7 | 30 | 90, enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    ...performanceOptions(address, days), enabled,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === address ? previous : undefined,
  });
  useEffect(() => {
    if (!enabled || !query.isSuccess || query.isPlaceholderData) return;
    let cancelled = false;
    void (async () => {
      // Archive calculations are expensive; warm one period at a time after the visible result.
      for (const period of FLEX_PERIODS) {
        if (cancelled) break;
        if (period !== days) await client.prefetchQuery(performanceOptions(address, period));
      }
    })();
    return () => {
      cancelled = true;
      void client.cancelQueries({ queryKey: ["flex-performance", address], type: "inactive" });
    };
  }, [client, address, days, enabled, query.isSuccess, query.isPlaceholderData]);
  return query;
}

export function useFlexMarketPreload(markets: FlexMarket[]) {
  const client = useQueryClient();
  const addresses = markets.map(market => market.addresses.market).join(",");
  useEffect(() => {
    if (!addresses) return;
    for (const address of addresses.split(",")) {
      for (const days of FLEX_PERIODS) void client.prefetchQuery({
        queryKey: ["flex-history", address, days],
        queryFn: ({ signal }) => fetchJson<FlexHistoryResponse>(apiUrl(`/flex/markets/${address}/history`, { days, interval: "day" }), { signal }),
        staleTime: 60_000,
      });
      for (const [key, path] of [
        ["flex-market-detail", ""],
        ["flex-redemption-priority", "/redemption-priority"],
        ["flex-trove-health", "/trove-health"],
      ]) void client.prefetchQuery({
        queryKey: [key, address],
        queryFn: ({ signal }) => fetchJson(apiUrl(`/flex/markets/${address}${path}`), { signal }),
        staleTime: 60_000,
      });
    }
    return () => {
      const targets = new Set(addresses.split(","));
      const keys = new Set(["flex-history", "flex-market-detail", "flex-redemption-priority", "flex-trove-health"]);
      void client.cancelQueries({ predicate: query => !query.isActive() && typeof query.queryKey[0] === "string" && keys.has(query.queryKey[0]) && typeof query.queryKey[1] === "string" && targets.has(query.queryKey[1]) });
    };
  }, [client, addresses]);
}

export function useFlexMarkets() {
  return useQuery({
    queryKey: ["flex-markets", "all"],
    queryFn: ({ signal }) => fetchJson<FlexMarketsResponse>(apiUrl("/flex/markets", { status: "all" }), { signal }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useFlexHistory(marketAddress: string | null, days: 7 | 30 | 90) {
  return useQuery({
    queryKey: ["flex-history", marketAddress, days],
    queryFn: ({ signal }) => fetchJson<FlexHistoryResponse>(apiUrl(`/flex/markets/${marketAddress}/history`, {
      days,
      interval: "day",
    }), { signal }),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === marketAddress ? previous : undefined,
  });
}

export function useFlexMarketDetail(marketAddress: string | null) {
  return useQuery({
    queryKey: ["flex-market-detail", marketAddress],
    queryFn: ({ signal }) => fetchJson<FlexMarketDetailResponse>(apiUrl(`/flex/markets/${marketAddress}`), { signal }),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
  });
}

export function useFlexRedemptionPriority(marketAddress: string | null) {
  return useQuery({
    queryKey: ["flex-redemption-priority", marketAddress],
    queryFn: ({ signal }) => fetchJson<FlexRedemptionPriorityResponse>(apiUrl(`/flex/markets/${marketAddress}/redemption-priority`), { signal }),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useFlexTroveHealth(marketAddress: string | null) {
  return useQuery({
    queryKey: ["flex-trove-health", marketAddress],
    queryFn: ({ signal }) => fetchJson<FlexTroveHealthResponse>(apiUrl(`/flex/markets/${marketAddress}/trove-health`), { signal }),
    enabled: Boolean(marketAddress),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useFlexActivity() {
  return useInfiniteQuery({
    queryKey: ["flex-activity"],
    queryFn: ({ pageParam, signal }) => fetchJson<FlexActivityResponse>(apiUrl("/flex/activity", {
      limit: 12,
      cursor: pageParam || undefined,
    }), { signal }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.pagination.next_cursor ?? undefined,
    staleTime: 60_000,
  });
}
