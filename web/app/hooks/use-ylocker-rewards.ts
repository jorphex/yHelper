"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

export type YlockerProduct = "ycrv" | "yyb";

export type YlockerRewardEvent = {
  block_number: number;
  block_time: string;
  tx_hash: string;
  log_index: number;
  depositor_address: string;
  reward_shares: number;
  pps_at_deposit: number;
  value_crvusd_at_deposit: number;
};

export type YlockerRewardCycle = {
  product: YlockerProduct;
  product_label: string;
  native_week: number;
  cycle_start: string;
  cycle_end: string;
  status: "finalized";
  event_count: number;
  reward_shares: number;
  value_crvusd_at_deposit: number;
  events: YlockerRewardEvent[];
};

export type YlockerReportingWeek = {
  calendar_week: number;
  week_start: string;
  week_end: string;
  status: "finalized" | "awaiting_product_cycles";
  digest_ready_at: string | null;
  ready_for_digest: boolean;
  total_crvusd_at_deposit: number;
  products: Array<{
    product: YlockerProduct;
    product_label: string;
    event_count: number;
    value_crvusd_at_deposit: number;
  }>;
};

export type YlockerRewardsResponse = {
  freshness: {
    status: "fresh" | "delayed" | "unavailable";
    indexed_through: string | null;
    age_seconds: number | null;
  };
  current_cycles: Array<{
    product: YlockerProduct;
    product_label: string;
    native_week: number;
    cycle_start: string;
    cycle_end: string;
    status: "current";
    event_count: number;
    reward_shares: number;
    value_crvusd_at_deposit: number;
  }>;
  cycles: YlockerRewardCycle[];
  reporting_weeks: YlockerReportingWeek[];
};

export async function fetchYlockerRewards(): Promise<YlockerRewardsResponse> {
  const response = await fetch(apiUrl("/ylockers/rewards", {
    product: "all",
    limit: 12,
    include_events: true,
  }), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load rewards (${response.status})`);
  return response.json() as Promise<YlockerRewardsResponse>;
}

export function useYlockerRewards() {
  return useQuery({
    queryKey: ["ylocker-rewards", "all", 12, true],
    queryFn: fetchYlockerRewards,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
