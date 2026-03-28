"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

const HOME_REFRESH_MS = 60_000;

type OverviewResponse = {
  freshness?: {
    latest_pps_age_seconds?: number | null;
    pps_stale_ratio?: number | null;
  } | null;
  protocol_context?: {
    current_yearn?: {
      tvl_usd?: number | null;
      vaults?: number | null;
    } | null;
    total_yearn?: {
      tvl_usd?: number | null;
      vaults?: number | null;
    } | null;
  } | null;
};

type ChangeMoverRow = {
  vault_address?: string | null;
  chain_id?: number | null;
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  safe_apy_30d?: number | null;
  safe_apy_window?: number | null;
};

type ChangesResponse = {
  summary?: {
    avg_delta?: number | null;
    vaults_with_change?: number | null;
  };
  freshness?: {
    latest_pps_age_seconds?: number | null;
  } | null;
  movers?: {
    risers?: ChangeMoverRow[];
    fallers?: ChangeMoverRow[];
    largest_abs_delta?: ChangeMoverRow[];
  };
};

type StYfiHomeResponse = {
  summary?: {
    combined_staked?: number | null;
  } | null;
  current_reward_state?: {
    styfi_current_apr?: number | null;
  } | null;
};

type SocialPreviewResponse = {
  highest_apy_vault?: {
    vault_address?: string | null;
    name?: string | null;
    symbol?: string | null;
    chain_id?: number | null;
    tvl_usd?: number | null;
    current_net_apy?: number | null;
    safe_apy_30d?: number | null;
  } | null;
};

type HomeData = {
  overview: OverviewResponse | null;
  changes: ChangesResponse | null;
  styfi: StYfiHomeResponse | null;
  socialPreview: SocialPreviewResponse | null;
};

async function fetchHomeData(): Promise<HomeData> {
  const [overviewRes, changesRes, styfiRes, socialRes] = await Promise.allSettled([
    fetch(apiUrl("/overview"), { cache: "no-store" }),
    fetch(apiUrl("/changes", { window: "24h", universe: "core", limit: 1 }), { cache: "no-store" }),
    fetch(apiUrl("/styfi", { days: "30", epoch_limit: "4" }), { cache: "no-store" }),
    fetch(apiUrl("/meta/social-preview"), { cache: "no-store" }),
  ]);

  const overview = overviewRes.status === "fulfilled" && overviewRes.value.ok
    ? (await overviewRes.value.json()) as OverviewResponse
    : null;

  const changes = changesRes.status === "fulfilled" && changesRes.value.ok
    ? (await changesRes.value.json()) as ChangesResponse
    : null;

  const styfi = styfiRes.status === "fulfilled" && styfiRes.value.ok
    ? (await styfiRes.value.json()) as StYfiHomeResponse
    : null;

  const socialPreview = socialRes.status === "fulfilled" && socialRes.value.ok
    ? (await socialRes.value.json()) as SocialPreviewResponse
    : null;

  return { overview, changes, styfi, socialPreview };
}

export function useHomeData() {
  return useQuery({
    queryKey: ["home"],
    queryFn: fetchHomeData,
    refetchInterval: HOME_REFRESH_MS,
    staleTime: 30_000,
  });
}
