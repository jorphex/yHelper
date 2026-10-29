"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { fetchChangesData } from "../hooks/use-changes-data";
import { fetchCompositionData } from "../hooks/use-composition-data";
import { fetchDiscoverData } from "../hooks/use-discover-data";
import { MARKET_VALUES, UNIVERSE_VALUES, universeDefaults } from "../lib/universe";
import { queryChoice } from "../lib/url";

const WINDOWS = ["24h", "7d", "30d"] as const;

/** Warm API data for sibling views and comparison windows. */
export function MarketsTabPreloader() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
  const market = queryChoice(searchParams, "market", MARKET_VALUES, "all");
  const { minTvl, minPoints } = universeDefaults(universe);
  const chain = searchParams.get("chain");

  useEffect(() => {
    const keys: unknown[][] = [];
    for (const window of WINDOWS) {
      const request = { universe, market, minTvl, minPoints, window, staleThreshold: "auto" as const };
      const queryKey = ["changes", request];
      keys.push(queryKey);
      queryClient.prefetchQuery({
        queryKey,
        queryFn: ({ signal }) => fetchChangesData(request, signal),
        staleTime: 30_000,
      });
    }
    const discoverRequest = { universe, market, minTvl, minPoints, limit: 250, sort: "tvl", dir: "desc", chain, allRows: true };
    keys.push(["discover", discoverRequest]);
    queryClient.prefetchQuery({
      queryKey: ["discover", discoverRequest],
      queryFn: ({ signal }) => fetchDiscoverData(discoverRequest, signal),
      staleTime: 30_000,
    });
    const compositionRequest = { universe, market, minTvl };
    keys.push(["composition", compositionRequest]);
    queryClient.prefetchQuery({
      queryKey: ["composition", compositionRequest],
      queryFn: ({ signal }) => fetchCompositionData(compositionRequest, signal),
      staleTime: 30_000,
    });
    return () => { for (const queryKey of keys) void queryClient.cancelQueries({ queryKey, exact: true, type: "inactive" }); };
  }, [queryClient, universe, market, minTvl, minPoints, chain]);

  return null;
}
