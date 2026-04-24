"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel } from "../lib/format";
import { useCompositionData } from "../hooks/use-composition-data";
import { useChainsData } from "../hooks/use-chains-data";
import { sortRows, type SortState } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { OverviewTab } from "./overview-tab";
import { ChainsTab } from "./chains-tab";
import { CrowdingTab } from "./crowding-tab";
import type {
  BreakdownRow,
  CategorySortKey,
  ChainSortKey,
  CrowdingRow,
  CrowdingSortKey,
  StructureQuery,
  TabKey,
  TokenSortKey,
} from "./types";

function StructurePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [chainSort, setChainSort] = useState<SortState<ChainSortKey>>({ key: "tvl", direction: "desc" });
  const [categorySort, setCategorySort] = useState<SortState<CategorySortKey>>({ key: "tvl", direction: "desc" });
  const [tokenSort, setTokenSort] = useState<SortState<TokenSortKey>>({ key: "tvl", direction: "desc" });
  const [crowdingSort, setCrowdingSort] = useState<SortState<CrowdingSortKey>>({ key: "crowding", direction: "desc" });
  const [uncrowdedSort, setUncrowdedSort] = useState<SortState<CrowdingSortKey>>({ key: "crowding", direction: "asc" });
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const query = useMemo<StructureQuery>(() => {
    const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      tab: (searchParams.get("tab") || "overview") as TabKey,
      topN: queryInt(searchParams, "top_n", 12, { min: 3, max: 50 }),
      crowdingLimit: queryInt(searchParams, "crowding_limit", 15, { min: 5, max: 80 }),
    };
  }, [searchParams]);

  useEffect(() => {
    if (query.tab === "overview" || query.tab === "chains" || query.tab === "crowding") {
      setActiveTab(query.tab);
    }
  }, [query.tab]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const { data: compData, isLoading: isLoadingComp } = useCompositionData({
    universe: query.universe,
    minTvl: query.minTvl,
  });
  const { data: chainsData, isLoading: isLoadingChains } = useChainsData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const chainRows = useMemo<BreakdownRow[]>(
    () =>
      [...(compData?.chains ?? [])].sort(
        (left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY),
      ),
    [compData?.chains],
  );
  const chainsTabRows = sortRows(chainsData?.rows ?? [], chainSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.active_vaults,
    with_realized_apy: (row) => row.with_realized_apy,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_realized_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.avg_momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.avg_consistency ?? Number.NEGATIVE_INFINITY,
  });
  const categoryRows = sortRows(compData?.categories ?? [], categorySort, {
    category: (row) => row.category ?? "",
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    share: (row) => row.share_tvl ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_realized_apy_30d ?? Number.NEGATIVE_INFINITY,
  });
  const tokenRows = sortRows(compData?.tokens ?? [], tokenSort, {
    token: (row) => row.token_symbol ?? "",
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    share: (row) => row.share_tvl ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_realized_apy_30d ?? Number.NEGATIVE_INFINITY,
  });
  const crowdedRows = sortRows(compData?.crowding.most_crowded ?? [], crowdingSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.realized_apy_30d ?? Number.NEGATIVE_INFINITY,
    crowding: (row) => row.crowding_index ?? Number.NEGATIVE_INFINITY,
  });
  const uncrowdedRows = sortRows(compData?.crowding.least_crowded ?? [], uncrowdedSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.realized_apy_30d ?? Number.NEGATIVE_INFINITY,
    crowding: (row) => row.crowding_index ?? Number.NEGATIVE_INFINITY,
  });
  const crowdingScatterRows = useMemo<CrowdingRow[]>(() => {
    const index = new Map<string, CrowdingRow>();
    for (const row of [...(compData?.crowding.most_crowded ?? []), ...(compData?.crowding.least_crowded ?? [])]) {
      const key = `${row.chain_id}:${row.vault_address}`;
      const existing = index.get(key);
      if (!existing || (row.tvl_usd ?? 0) > (existing.tvl_usd ?? 0)) {
        index.set(key, row);
      }
    }
    return [...index.values()]
      .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, isCompactViewport ? 60 : 100);
  }, [compData?.crowding.least_crowded, compData?.crowding.most_crowded, isCompactViewport]);

  const isLoading = isLoadingComp || isLoadingChains;

  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    updateQuery({ tab });
  };

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Structure
          <br />
          <em className="page-title-accent">Concentration lens</em>
        </h1>
        <p className="page-description">
          Map where TVL concentrates and how realized APY 30d is distributed.
        </p>
        <div className="tab-bar">
          <button onClick={() => setTab("overview")} className={`button ${activeTab === "overview" ? "button-primary" : "button-ghost"}`}>
            Overview
          </button>
          <button onClick={() => setTab("chains")} className={`button ${activeTab === "chains" ? "button-primary" : "button-ghost"}`}>
            Chains
          </button>
          <button onClick={() => setTab("crowding")} className={`button ${activeTab === "crowding" ? "button-primary" : "button-ghost"}`}>
            Crowding
          </button>
        </div>
      </section>

      <section className="section section-md">
        <div className="card">
          <div className="filter-grid">
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select value={query.universe} onChange={(e) => updateQuery({ universe: e.target.value, min_tvl: null })} style={{ width: "100%", marginTop: "6px" }}>
                {UNIVERSE_VALUES.map((value) => (
                  <option key={value} value={value}>{universeLabel(value)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min TVL (USD)</span>
              <input type="number" min={0} value={query.minTvl} onChange={(e) => updateQuery({ min_tvl: Number(e.target.value || 0) })} style={{ width: "100%", marginTop: "6px" }} />
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Top Groups</span>
              <select value={query.topN} onChange={(e) => updateQuery({ top_n: Number(e.target.value) })} style={{ width: "100%", marginTop: "6px" }}>
                <option value={10}>10</option>
                <option value={12}>12</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {activeTab === "overview" && (
        <OverviewTab
          isLoading={isLoading}
          query={query}
          summary={compData?.summary}
          concentration={compData?.concentration}
          chainRows={chainRows}
          categoryRows={categoryRows}
          tokenRows={tokenRows}
          categorySort={categorySort}
          setCategorySort={setCategorySort}
          tokenSort={tokenSort}
          setTokenSort={setTokenSort}
        />
      )}

      {activeTab === "chains" && (
        <ChainsTab
          isLoading={isLoading}
          query={query}
          summary={chainsData?.summary}
          rows={chainsTabRows}
          chainSort={chainSort}
          setChainSort={setChainSort}
        />
      )}

      {activeTab === "crowding" && (
        <CrowdingTab
          isLoading={isLoading}
          query={query}
          isCompactViewport={isCompactViewport}
          crowdingScatterRows={crowdingScatterRows}
          crowdedRows={crowdedRows}
          uncrowdedRows={uncrowdedRows}
          crowdingSort={crowdingSort}
          setCrowdingSort={setCrowdingSort}
          uncrowdedSort={uncrowdedSort}
          setUncrowdedSort={setUncrowdedSort}
        />
      )}
    </div>
  );
}

export default function StructurePage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <StructurePageContent />
    </Suspense>
  );
}
