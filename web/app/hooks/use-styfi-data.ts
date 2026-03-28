"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

type StYfiSnapshotPoint = {
  observed_at?: string | null;
  reward_epoch?: number | null;
  styfi_staked?: number | null;
  styfix_staked?: number | null;
  combined_staked?: number | null;
  staked_share_supply?: number | null;
};

type StYfiEpochPoint = {
  epoch?: number | null;
  epoch_start?: string | null;
  reward_total?: number | null;
  reward_styfi?: number | null;
  reward_styfix?: number | null;
  reward_veyfi?: number | null;
  reward_liquid_lockers?: number | null;
};

type StYfiResponse = {
  filters?: {
    days?: number;
    epoch_limit?: number;
    chain_id?: number;
  };
  summary?: {
    observed_at?: string | null;
    reward_epoch?: number | null;
    yfi_total_supply?: number | null;
    styfi_staked?: number | null;
    styfi_supply?: number | null;
    styfix_staked?: number | null;
    styfix_supply?: number | null;
    combined_staked?: number | null;
    staked_share_supply?: number | null;
    net_flow_24h?: number | null;
    net_flow_7d?: number | null;
    snapshots_count?: number | null;
    first_snapshot_at?: string | null;
    latest_snapshot_at?: string | null;
  };
  reward_token?: {
    address?: string | null;
    symbol?: string | null;
    decimals?: number | null;
  };
  current_reward_state?: {
    source?: string | null;
    epoch?: number | null;
    timestamp?: number | null;
    block_number?: number | null;
    reward_pps?: number | null;
    global_apr?: number | null;
    styfi_current_reward?: number | null;
    styfi_current_apr?: number | null;
    styfi_projected_reward?: number | null;
    styfi_projected_apr?: number | null;
    styfix_current_reward?: number | null;
    styfix_current_apr?: number | null;
    styfix_projected_reward?: number | null;
    styfix_projected_apr?: number | null;
  } | null;
  series?: {
    snapshots?: StYfiSnapshotPoint[];
    epochs?: StYfiEpochPoint[];
  };
  component_split_latest_completed?: {
    epoch?: number | null;
    rows?: Array<{
      component: string;
      reward: number | null;
    }>;
  };
  freshness?: {
    latest_snapshot_at?: string | null;
    latest_snapshot_age_seconds?: number | null;
    snapshots_count?: number | null;
    first_snapshot_at?: string | null;
  };
  data_policy?: {
    retention_days?: number | null;
    snapshot_retention_days?: number | null;
    epoch_lookback?: number | null;
  };
  ingestion?: {
    last_run?: {
      status?: string | null;
      started_at?: string | null;
      ended_at?: string | null;
      records?: number | null;
      error_summary?: string | null;
    } | null;
    next_scheduled?: string | null;
  };
};

interface UseStYfiDataParams {
  days?: number;
  epochLimit?: number;
}

async function fetchStYfiData(params: UseStYfiDataParams): Promise<StYfiResponse> {
  const searchParams = new URLSearchParams();
  if (params.days) searchParams.set("days", String(params.days));
  if (params.epochLimit) searchParams.set("epoch_limit", String(params.epochLimit));

  const res = await fetch(apiUrl("/styfi", searchParams), { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<StYfiResponse>;
}

export function useStYfiData(params: UseStYfiDataParams = {}) {
  return useQuery({
    queryKey: ["styfi", params],
    queryFn: () => fetchStYfiData(params),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
