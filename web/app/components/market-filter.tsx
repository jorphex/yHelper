"use client";

import { useEffect, useMemo } from "react";
import { useCompositionData } from "../hooks/use-composition-data";
import {
  MARKET_VALUES,
  marketLabel,
  type MarketKind,
  type UniverseKind,
} from "../lib/universe";

export function MarketFilter({
  market,
  universe,
  minTvl,
  onChange,
}: {
  market: MarketKind;
  universe: UniverseKind;
  minTvl: number;
  onChange: (market: MarketKind) => void;
}) {
  const { data } = useCompositionData({ universe, market: "all", minTvl });
  const counts = useMemo(() => {
    const next = new Map<MarketKind, number>();
    if (!data) return next;
    for (const row of data.categories) {
      const key = row.category as MarketKind;
      if (!MARKET_VALUES.includes(key) || key === "all") continue;
      next.set(key, row.vaults);
    }
    next.set("all", data.summary.vaults);
    return next;
  }, [data]);
  const hasCounts = Boolean(data) && counts.has("all");

  useEffect(() => {
    if (hasCounts && market !== "all" && (counts.get(market) ?? 0) === 0) onChange("all");
  }, [counts, hasCounts, market, onChange]);

  return (
    <label>
      <span className="filter-label">Market</span>
      <select className="filter-control" value={market} onChange={(event) => onChange(event.target.value as MarketKind)}>
        {MARKET_VALUES.map((value) => {
          const count = counts.get(value) ?? 0;
          return (
            <option key={value} value={value} disabled={hasCounts && count === 0}>
              {marketLabel(value)}{hasCounts ? ` · ${count}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
