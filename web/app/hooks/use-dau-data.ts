"use client";

import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

const DAU_REFRESH_MS = 60_000;

export type DauResponse = {
  metric?: {
    headline_label?: string;
    history_label?: string;
    history_window_label?: string;
  } | null;
  trailing_24h?: {
    dau_total?: number | null;
  } | null;
  last_run?: {
    status?: string | null;
  } | null;
  daily?: Array<{
    day_utc: string;
    dau_total: number;
  }> | null;
};

export async function fetchDauData(days: number = 30): Promise<DauResponse | null> {
  const res = await fetch(apiUrl("/dau", { days }), { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as DauResponse;
}

export function useDauData(days: number = 30) {
  return useQuery({
    queryKey: ["dau", days],
    queryFn: () => fetchDauData(days),
    refetchInterval: DAU_REFRESH_MS,
    staleTime: 30_000,
  });
}
