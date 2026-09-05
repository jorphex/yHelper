"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";
import type { FlexMarketsResponse } from "./use-flex-data";
import type { YlockerRewardsResponse } from "./use-ylocker-rewards";

type HomeStaking = {
  summary?: { reward_epoch?: number | null; combined_staked?: number | null };
  current_reward_state?: { epoch?: number | null; styfi_current_apr?: number | null };
  freshness?: { latest_snapshot_at?: string | null; latest_snapshot_age_seconds?: number | null };
};

// Keep each destination usable when another product's source is unavailable.
async function optionalJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

export async function fetchHomeData() {
  const [styfi, flex, rewards] = await Promise.all([
    optionalJson<HomeStaking>(apiUrl("/styfi", { days: 30, epoch_limit: 3, include_history: false })),
    optionalJson<FlexMarketsResponse>(apiUrl("/flex/markets", { status: "active" })),
    optionalJson<YlockerRewardsResponse>(apiUrl("/ylockers/rewards", { limit: 2, include_events: false })),
  ]);
  return { styfi, flex, rewards };
}

export function useHomeData() {
  return useQuery({ queryKey: ["home-products"], queryFn: fetchHomeData, refetchInterval: 60_000, staleTime: 30_000 });
}
