"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CHANGE_WINDOWS, changesOptions } from "../hooks/use-changes-data";
import { compositionOptions } from "../hooks/use-composition-data";
import { discoverOptions } from "../hooks/use-discover-data";
import { marketScope } from "../lib/universe";
import { queryInt } from "../lib/url";

/** Warm API data for sibling views and comparison windows. */
export function MarketsTabPreloader() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { universe, market, minTvl, minPoints } = marketScope(searchParams);
  const chain = queryInt(searchParams, "chain", null, { min: 1 });

  useEffect(() => {
    const changes = CHANGE_WINDOWS.map(window => changesOptions({ universe, market, minTvl, minPoints, window }));
    const discover = discoverOptions({ universe, market, minTvl, minPoints, sort: "tvl", dir: "desc", chain });
    const composition = compositionOptions({ universe, market, minTvl });
    for (const options of changes) void queryClient.prefetchQuery(options);
    void queryClient.prefetchQuery(discover);
    void queryClient.prefetchQuery(composition);
    return () => {
      for (const { queryKey } of [...changes, discover, composition]) {
        void queryClient.cancelQueries({ queryKey, exact: true, type: "inactive" });
      }
    };
  }, [queryClient, universe, market, minTvl, minPoints, chain]);

  return null;
}
