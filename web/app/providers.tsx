"use client";

import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { fetchChangesData, fetchTrendDailyData } from "./hooks/use-changes-data";
import { fetchCompositionData } from "./hooks/use-composition-data";
import { fetchDiscoverData } from "./hooks/use-discover-data";
import { fetchReportData } from "./hooks/use-report-data";
import { fetchHomeData } from "./hooks/use-home-data";
import { fetchStYfiData } from "./hooks/use-styfi-data";
import { queryClient } from "./lib/query-client";

const HOME_HERO_SRC = "/home-assets-yearn-blender/hero-yearn-blender-coins.png";
const STYFI_HERO_SRC = "/styfi-assets-blender/hero-styfi-blender-coin-tilt-left.png";

function warmImage(src: string) {
  if (typeof window === "undefined") return;
  const image = new window.Image();
  image.decoding = "async";
  image.src = src;
}

function GlobalPrefetch() {
  const client = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const routePrefetches = ["/", "/markets", "/reports", "/styfi"];
      for (const href of routePrefetches) {
        router.prefetch(href);
      }

      warmImage(HOME_HERO_SRC);
      warmImage(STYFI_HERO_SRC);

      const tasks = [
        () => client.prefetchQuery({ queryKey: ["home"], queryFn: fetchHomeData, staleTime: 30_000 }),
        () => client.prefetchQuery({
          queryKey: ["discover", {
            universe: "core",
            market: "all",
            minTvl: 1000000,
            minPoints: 45,
            limit: 30,
            sort: "tvl",
            dir: "desc",
            chain: null,
          }],
          queryFn: () => fetchDiscoverData({
            universe: "core",
            market: "all",
            minTvl: 1000000,
            minPoints: 45,
            limit: 30,
            sort: "tvl",
            dir: "desc",
            chain: null,
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["composition", { universe: "core", market: "all", minTvl: 1000000 }],
          queryFn: () => fetchCompositionData({ universe: "core", market: "all", minTvl: 1000000 }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["changes", {
            universe: "core",
            market: "all",
            minTvl: 1000000,
            minPoints: 45,
            window: "7d",
            staleThreshold: "auto",
          }],
          queryFn: () => fetchChangesData({
            universe: "core",
            market: "all",
            minTvl: 1000000,
            minPoints: 45,
            window: "7d",
            staleThreshold: "auto",
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["trend-daily", {
            universe: "core",
            market: "all",
            minTvl: 1000000,
            minPoints: 45,
            days: 60,
            enabled: true,
          }],
          queryFn: () => fetchTrendDailyData({
            universe: "core",
            market: "all",
            minTvl: 1000000,
            minPoints: 45,
            days: 60,
            enabled: true,
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["reports", 90, null, null, 25, true],
          queryFn: () => fetchReportData({ days: 90, chainId: null, vaultAddress: null, limit: 25, meaningfulOnly: true }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["styfi", { days: 122, epochLimit: 12 }],
          queryFn: () => fetchStYfiData({ days: 122, epochLimit: 12 }),
          staleTime: 30_000,
        }),
      ];

      for (const task of tasks) {
        if (cancelled) return;
        try {
          await task();
        } catch {
          // Keep navigation warm-up best effort only.
        }
      }
    };

    const idle = window.setTimeout(() => {
      if (!cancelled) void run();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(idle);
    };
  }, [client, router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <GlobalPrefetch />
      {children}
    </QueryClientProvider>
  );
}
