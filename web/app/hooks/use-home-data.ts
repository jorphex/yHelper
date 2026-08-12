"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

const HOME_REFRESH_MS = 60_000;

type OverviewResponse = {
  protocol?: {
    tvl_usd?: number | null;
    fetched_at?: string | null;
    freshness_status?: string | null;
  } | null;
};

export type HomePulse = {
  trend: "improving" | "softening" | "steady";
  data_state: "ready" | "limited" | "delayed";
  latest_7d_apy: number;
  change_7d: number;
  directional_tvl_ratio: number | null;
  coverage_ratio: number | null;
  fresh_tvl_ratio: number | null;
  freshness_window_hours: number;
  eligible_vaults: number;
  comparable_vaults: number;
  latest_data_at: string | null;
};

type PulseResponse = { pulse?: HomePulse | null };

export type HomeMover = {
  vault_address?: string | null;
  chain_id?: number | null;
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  realized_apy_window?: number | null;
  tvl_usd?: number | null;
  age_seconds?: number | null;
};

type ChangesResponse = {
  summary?: {
    vaults_with_change?: number | null;
    riser_vaults?: number | null;
    faller_vaults?: number | null;
    riser_tvl_usd?: number | null;
    faller_tvl_usd?: number | null;
    tvl_weighted_delta?: number | null;
  } | null;
  movers?: { risers?: HomeMover[]; fallers?: HomeMover[] } | null;
  freshness?: {
    newest_comparison_age_seconds?: number | null;
    current_comparisons?: number | null;
    tracked_comparisons?: number | null;
  } | null;
};

export type HomeReport = {
  chain_id: number;
  block_time: string;
  vault_address: string;
  vault_symbol?: string | null;
  strategy_name?: string | null;
  gain?: string | null;
  loss?: string | null;
};

type ReportsResponse = { recent?: HomeReport[] | null };

type StyfiResponse = {
  summary?: {
    observed_at?: string | null;
    reward_epoch?: number | null;
    combined_staked?: number | null;
  } | null;
  current_reward_state?: {
    epoch?: number | null;
    styfi_current_apr?: number | null;
  } | null;
  freshness?: { latest_snapshot_age_seconds?: number | null } | null;
};

type HomeData = {
  overview: OverviewResponse | null;
  pulse: PulseResponse | null;
  changes: ChangesResponse | null;
  reports: ReportsResponse | null;
  styfi: StyfiResponse | null;
};

export async function fetchHomeData(): Promise<HomeData> {
  const [overviewRes, pulseRes, changesRes, reportsRes, styfiRes] = await Promise.allSettled([
    fetch(apiUrl("/meta/protocol-context"), { cache: "no-store" }),
    fetch(apiUrl("/overview-pulse"), { cache: "no-store" }),
    fetch(apiUrl("/changes", { window: "7d", universe: "core", limit: 3 }), { cache: "no-store" }),
    fetch(apiUrl("/reports", { days: 7, limit: 1, meaningful_only: true }), { cache: "no-store" }),
    fetch(apiUrl("/styfi", { days: 30, epoch_limit: 3 }), { cache: "no-store" }),
  ]);
  const overview = overviewRes.status === "fulfilled" && overviewRes.value.ok
    ? await overviewRes.value.json() as OverviewResponse : null;
  const pulse = pulseRes.status === "fulfilled" && pulseRes.value.ok
    ? await pulseRes.value.json() as PulseResponse : null;
  const changes = changesRes.status === "fulfilled" && changesRes.value.ok
    ? await changesRes.value.json() as ChangesResponse : null;
  const reports = reportsRes.status === "fulfilled" && reportsRes.value.ok
    ? await reportsRes.value.json() as ReportsResponse : null;
  const styfi = styfiRes.status === "fulfilled" && styfiRes.value.ok
    ? await styfiRes.value.json() as StyfiResponse : null;
  return { overview, pulse, changes, reports, styfi };
}

export function useHomeData() {
  return useQuery({
    queryKey: ["home"],
    queryFn: fetchHomeData,
    refetchInterval: HOME_REFRESH_MS,
    staleTime: 30_000,
  });
}
