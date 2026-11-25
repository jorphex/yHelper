"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { compositionOptions } from "../hooks/use-composition-data";
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
  const { data } = useQuery(compositionOptions({ universe, market: "all", minTvl }));
  const counts = new Map(data?.categories.map(row => [row.category, row.vaults]));
  counts.set("all", data?.summary.vaults ?? 0);
  const marketCount = counts.get(market) ?? 0;

  useEffect(() => {
    if (data && market !== "all" && !marketCount) onChange("all");
  }, [data, market, marketCount, onChange]);

  return (
    <label>
      <span className="filter-label">Market</span>
      <select className="filter-control" value={market} onChange={(event) => onChange(event.target.value as MarketKind)}>
        {MARKET_VALUES.map((value) => {
          const count = counts.get(value) ?? 0;
          return (
            <option key={value} value={value} disabled={Boolean(data && count === 0)}>
              {marketLabel(value)}{data ? ` · ${count}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
