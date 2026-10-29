"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import { fetchJson } from "../lib/fetch-json";
import type { StakingSourceState } from "../components/source-notes";
import type { StakingAprState } from "../lib/staking-apr";
import type { FlexMarketsResponse } from "./use-flex-data";
import type { YlockerRewardsResponse } from "./use-ylocker-rewards";

type HomeStaking = {
  summary?: { reward_epoch?: number | null; combined_staked?: number | null };
  current_reward_state?: StakingSourceState & StakingAprState & { epoch?: number | null; styfi_current_apr?: number | null };
  freshness?: { latest_snapshot_at?: string | null; latest_snapshot_age_seconds?: number | null };
};

// Keep each destination usable when another product's source is unavailable.
async function optionalJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    return await fetchJson<T>(url, { signal, timeoutMs: 8_000 });
  } catch {
    return null;
  }
}

export async function fetchHomeData(signal?: AbortSignal) {
  const [styfi, flex, rewards] = await Promise.all([
    optionalJson<HomeStaking>(apiUrl("/styfi", { days: 30, epoch_limit: 3, include_history: false }), signal),
    optionalJson<FlexMarketsResponse>(apiUrl("/flex/markets", { status: "active" }), signal),
    optionalJson<YlockerRewardsResponse>(apiUrl("/ylockers/rewards", { limit: 2, include_events: false }), signal),
  ]);
  return { styfi, flex, rewards };
}

export function useHomeData() {
  return useQuery({ queryKey: ["home-products"], queryFn: ({ signal }) => fetchHomeData(signal), refetchInterval: 60_000, staleTime: 30_000 });
}
