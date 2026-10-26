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
    for (const window of WINDOWS) {
      const request = { universe, market, minTvl, minPoints, window, staleThreshold: "auto" as const };
      queryClient.prefetchQuery({
        queryKey: ["changes", request],
        queryFn: () => fetchChangesData(request),
        staleTime: 30_000,
      });
    }
    const discoverRequest = { universe, market, minTvl, minPoints, limit: 250, sort: "tvl", dir: "desc", chain, allRows: true };
    queryClient.prefetchQuery({
      queryKey: ["discover", discoverRequest],
      queryFn: () => fetchDiscoverData(discoverRequest),
      staleTime: 30_000,
    });
    const compositionRequest = { universe, market, minTvl };
    queryClient.prefetchQuery({
      queryKey: ["composition", compositionRequest],
      queryFn: () => fetchCompositionData(compositionRequest),
      staleTime: 30_000,
    });
  }, [queryClient, universe, market, minTvl, minPoints, chain]);

  return null;
}
