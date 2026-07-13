"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MarketFilter } from "../components/market-filter";
import { useCompositionData } from "../hooks/use-composition-data";
import { MARKET_VALUES, UNIVERSE_VALUES, universeDefaults, universeLabel } from "../lib/universe";
import { queryChoice, replaceQuery } from "../lib/url";
import { OverviewTab } from "./overview-tab";

function StructurePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => {
    const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
    return {
      universe,
      market: queryChoice(searchParams, "market", MARKET_VALUES, "all"),
      ...universeDefaults(universe),
    };
  }, [searchParams]);
  const updateQuery = (updates: Record<string, string | number | null | undefined>) => replaceQuery(router, pathname, searchParams, updates);
  const { data, isLoading } = useCompositionData({ universe: query.universe, market: query.market, minTvl: query.minTvl });

  return (
    <div>
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Structure<br /><em className="page-title-accent">Where tracked capital sits</em></h1>
        <p className="page-description">Understand concentration by market, chain, and exact underlying symbol before comparing individual vaults.</p>
      </section>
      <section className="section section-md">
        <div className="card"><div className="filter-grid">
          <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market })} />
          <label><span className="filter-label">Vault set</span><select className="filter-control" value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}>{UNIVERSE_VALUES.map((universe) => <option key={universe} value={universe}>{universeLabel(universe)}</option>)}</select></label>
        </div></div>
      </section>
      <OverviewTab isLoading={isLoading} universe={query.universe} market={query.market} summary={data?.summary} chainRows={data?.chains ?? []} marketRows={data?.categories ?? []} tokenRows={data?.tokens ?? []} />
    </div>
  );
}

export default function StructurePage() {
  return <Suspense fallback={<div className="page-loading">Loading composition…</div>}><StructurePageContent /></Suspense>;
}
