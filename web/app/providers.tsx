"use client";

import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { fetchAssetsData } from "./hooks/use-assets-data";
import { fetchChainsData } from "./hooks/use-chains-data";
import { fetchChangesData, fetchTrendDailyData } from "./hooks/use-changes-data";
import { fetchCompositionData } from "./hooks/use-composition-data";
import { fetchDauData } from "./hooks/use-dau-data";
import { fetchDiscoverData } from "./hooks/use-discover-data";
import { fetchHarvestData } from "./hooks/use-harvest-data";
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
      const routePrefetches = ["/", "/explore", "/harvests", "/structure", "/momentum", "/styfi"];
      for (const href of routePrefetches) {
        router.prefetch(href);
      }

      warmImage(HOME_HERO_SRC);
      warmImage(STYFI_HERO_SRC);

      const tasks = [
        () => client.prefetchQuery({ queryKey: ["home"], queryFn: fetchHomeData, staleTime: 30_000 }),
        () => client.prefetchQuery({ queryKey: ["dau", 30], queryFn: () => fetchDauData(30), staleTime: 30_000 }),
        () => client.prefetchQuery({
          queryKey: ["discover", {
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            limit: 30,
            sort: "tvl",
            dir: "desc",
            chain: null,
            category: null,
            token: null,
          }],
          queryFn: () => fetchDiscoverData({
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            limit: 30,
            sort: "tvl",
            dir: "desc",
            chain: null,
            category: null,
            token: null,
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["assets", {
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            limit: 120,
            tokenScope: "featured",
            apiSort: "tvl",
            apiDir: "desc",
          }],
          queryFn: () => fetchAssetsData({
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            limit: 120,
            tokenScope: "featured",
            apiSort: "tvl",
            apiDir: "desc",
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["composition", { universe: "core", minTvl: 1000000 }],
          queryFn: () => fetchCompositionData({ universe: "core", minTvl: 1000000 }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["chains", { universe: "core", minTvl: 1000000 }],
          queryFn: () => fetchChainsData({ universe: "core", minTvl: 1000000 }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["changes", {
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            window: "7d",
            staleThreshold: "auto",
          }],
          queryFn: () => fetchChangesData({
            universe: "core",
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
            minTvl: 1000000,
            minPoints: 45,
            days: 90,
            enabled: true,
          }],
          queryFn: () => fetchTrendDailyData({
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            days: 90,
            enabled: true,
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["trend-daily", {
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            days: 90,
            groupBy: "chain",
            groupLimit: 10,
            enabled: true,
          }],
          queryFn: () => fetchTrendDailyData({
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            days: 90,
            groupBy: "chain",
            groupLimit: 10,
            enabled: true,
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["trend-daily", {
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            days: 90,
            groupBy: "category",
            groupLimit: 10,
            enabled: true,
          }],
          queryFn: () => fetchTrendDailyData({
            universe: "core",
            minTvl: 1000000,
            minPoints: 45,
            days: 90,
            groupBy: "category",
            groupLimit: 10,
            enabled: true,
          }),
          staleTime: 30_000,
        }),
        () => client.prefetchQuery({
          queryKey: ["harvests", 90, null, null, 50],
          queryFn: () => fetchHarvestData({ days: 90, chainId: null, vaultAddress: null, limit: 50 }),
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
