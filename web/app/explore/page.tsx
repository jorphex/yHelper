"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatPctSigned, formatUsd, yearnVaultUrl } from "../lib/format";
import { useDiscoverData } from "../hooks/use-discover-data";
import { useAssetsData, useAssetVenues } from "../hooks/use-assets-data";
import type { UniverseKind } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { NoVaultsEmptyState } from "../components/empty-state";
import { DataLoadError } from "../components/error-state";
import { VaultLink } from "../components/vault-link";
import { BarList, HeatGrid, ScatterPlot, Ridgeline } from "../components/visuals";
import { VizSkeleton } from "../components/viz-skeleton";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";

type TabKey = "vaults" | "venues";

type DiscoverRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  est_apy: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  risk_level: string | null;
  is_retired: boolean;
  is_highlighted: boolean;
  migration_available: boolean;
  strategies_count: number;
  regime: string;
};

type AssetRow = {
  token_symbol: string;
  token_type?: "canonical" | "structured";
  venues: number;
  chains: number;
  total_tvl_usd: number | null;
  best_est_apy: number | null;
  weighted_est_apy: number | null;
  best_realized_apy_30d: number | null;
  weighted_realized_apy_30d: number | null;
  realized_spread_30d: number | null;
};

type VenueRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  est_apy: number | null;
  realized_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  regime: string;
};

type TokenSortKey = "token" | "venues" | "chains" | "tvl" | "best" | "weighted" | "spread";
type VenueSortKey = "vault" | "chain" | "category" | "tvl" | "apy" | "momentum" | "consistency" | "regime";
type AssetApiSort = "tvl" | "spread" | "best_est_apy" | "venues";
type TokenScope = "featured" | "canonical" | "all";

function riskLabel(level: string | null): string {
  if (!level) return "n/a";
  const map: Record<string, string> = { "1": "Low", "2": "Medium", "3": "High", "4": "Very High" };
  return map[level] || level;
}

function regimeLabel(regime: string | null): string {
  if (!regime) return "n/a";
  const map: Record<string, string> = { rising: "Rising", stable: "Stable", falling: "Falling", choppy: "Choppy" };
  return map[regime] || regime;
}

function ExplorePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
    minPoints: Number(searchParams.get("min_points") || 45),
    limit: Number(searchParams.get("limit") || 30),
    sort: searchParams.get("api_sort") || "tvl",
    dir: searchParams.get("api_dir") || "desc",
    chain: searchParams.get("chain") || null,
    category: searchParams.get("category") || null,
    token: searchParams.get("token") || null,
    tab: (searchParams.get("tab") || "vaults") as TabKey,
    tokenScope: (searchParams.get("token_scope") || "featured") as TokenScope,
    apiSort: (searchParams.get("api_sort_assets") || "tvl") as AssetApiSort,
    apiDir: searchParams.get("api_dir_assets") || "desc",
  }), [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, String(value));
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  const setTab = (tab: TabKey) => updateQuery({ tab });
  const selectToken = (token: string) => updateQuery({ token, tab: "venues" });

  // Discover data for vaults tab
  const { data: discoverData, isLoading: isLoadingDiscover, error: errorDiscover, refetch: refetchDiscover } = useDiscoverData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: query.limit,
    sort: query.sort,
    dir: query.dir,
    chain: query.chain,
    category: query.category,
    token: query.tab === "vaults" ? query.token : null,
  });

  // Assets data for venues tab
  const { data: assetData, isLoading: isLoadingAssets } = useAssetsData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: 120,
    tokenScope: query.tokenScope,
    apiSort: query.apiSort,
    apiDir: query.apiDir as "asc" | "desc",
  });

  const { data: venueData, isLoading: isLoadingVenues } = useAssetVenues(
    query.token || "",
    { universe: query.universe, minTvl: query.minTvl, minPoints: query.minPoints }
  );

  const [showFilters, setShowFilters] = useState(false);
  const [tokenSort, setTokenSort] = useState<SortState<TokenSortKey>>({ key: "tvl", direction: "desc" });
  const [venueSort, setVenueSort] = useState<SortState<VenueSortKey>>({ key: "apy", direction: "desc" });
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const discoverRows = useMemo<DiscoverRow[]>(() => discoverData?.rows ?? [], [discoverData?.rows]);
  const discoverSummary = discoverData?.summary;

  // KPI items for vaults tab
  const vaultKpiItems = useMemo(() => [
    { label: "Chains", value: String(discoverSummary?.chains ?? "n/a") },
    { label: "Median Est. APY", value: formatPct(discoverSummary?.median_est_apy) },
    { label: "Median Realized APY 30d", value: formatPct(discoverSummary?.median_realized_apy_30d) },
    { label: "Coverage", value: formatPct(discoverData?.coverage?.coverage_ratio, 0), hint: "Visible vaults with realized APY history" },
    { label: "Avg Realized Momentum", value: formatPct(discoverSummary?.avg_momentum_7d_30d), hint: "7d minus 30d realized APY" },
  ], [discoverSummary, discoverData]);

  // Scatter data
  const scatterPoints = useMemo(() =>
    [...discoverRows]
      .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, 50)
      .map((row) => ({
        id: row.vault_address,
        x: row.momentum_7d_30d ?? 0,
        y: row.realized_apy_30d ?? 0,
        size: row.tvl_usd ?? 0,
        tone: (row.momentum_7d_30d ?? 0) >= 0 ? "positive" as const : "negative" as const,
        href: yearnVaultUrl(row.chain_id, row.vault_address),
        tooltip: `${row.symbol || row.vault_address}\nRealized APY 30d: ${formatPct(row.realized_apy_30d)}\nRealized Momentum: ${formatPct(row.momentum_7d_30d)}`,
      })),
  [discoverRows]);

  // Ridgeline data
  const chainRidgelineSeries = useMemo(() => {
    const byChain = new Map<number, number[]>();
    for (const row of discoverRows) {
      if (row.realized_apy_30d === null || row.realized_apy_30d === undefined) continue;
      if (!byChain.has(row.chain_id)) byChain.set(row.chain_id, []);
      byChain.get(row.chain_id)!.push(row.realized_apy_30d);
    }
    return Array.from(byChain.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([chainId, values]) => ({
        id: String(chainId),
        label: chainLabel(chainId),
        values,
        note: `${values.length} vaults`,
      }));
  }, [discoverRows]);

  // Assets sorting
  const tokenRows = sortRows(assetData?.rows ?? [], tokenSort, {
    token: (row) => row.token_symbol,
    venues: (row) => row.venues,
    chains: (row) => row.chains,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    best: (row) => row.best_est_apy ?? Number.NEGATIVE_INFINITY,
    weighted: (row) => row.weighted_est_apy ?? Number.NEGATIVE_INFINITY,
    spread: (row) => row.realized_spread_30d ?? Number.NEGATIVE_INFINITY,
  });

  const venueRows = sortRows(venueData?.rows ?? [], venueSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.est_apy ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.consistency_score ?? Number.NEGATIVE_INFINITY,
    regime: (row) => row.regime,
  });

  const topTokenByTvl = useMemo(() =>
    [...tokenRows]
      .sort((a, b) => (b.total_tvl_usd ?? 0) - (a.total_tvl_usd ?? 0))
      .slice(0, 8),
    [tokenRows]
  );

  const selectedSymbol = query.token || "";

  // Auto-select first token when venues tab opens without a selected token,
  // or when the current token becomes invalid after a token_scope change
  useEffect(() => {
    if (query.tab !== "venues" || tokenRows.length === 0) return;

    const currentToken = query.token;
    const tokenExists = tokenRows.some((row) => row.token_symbol === currentToken);

    // Select first token if: no token selected, or current token not in list
    if (!currentToken || !tokenExists) {
      updateQuery({ token: tokenRows[0].token_symbol });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.tab, query.token, tokenRows]);

  if (errorDiscover && !discoverData) {
    return <DataLoadError onRetry={() => refetchDiscover()} />;
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header page-header-no-border">
        <h1 className="page-title">
          Explore
          <br />
          <em className="page-title-accent">Scan and filter</em>
        </h1>
        <p className="page-description">
          Browse current estimated APY, then compare realized 30d APY and momentum from PPS history.
          <br />
          Estimated APY is current-looking; realized APY 30d is backward-looking.
        </p>

        {/* Tab Navigation */}
        <div className="tab-bar">
          <button
            onClick={() => setTab("vaults")}
            className={`button ${query.tab === "vaults" ? "button-primary" : "button-ghost"}`}
          >
            Vaults
          </button>
          <button
            onClick={() => setTab("venues")}
            className={`button ${query.tab === "venues" ? "button-primary" : "button-ghost"}`}
          >
            Venues
          </button>
        </div>
      </section>

      {/* Shared Filters */}
      <section className="section section-md">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Filters</span>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="button button-ghost"
            >
              {showFilters ? "Hide" : "Show"} advanced
            </button>
          </div>

          <div className="filter-grid-responsive">
            <label>
              <span className="filter-label">Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value })}
                className="filter-control"
              >
                <option value="core">Core (high signal)</option>
                <option value="extended">Extended (more vaults)</option>
                <option value="raw">Raw (all data)</option>
              </select>
            </label>

            <label>
              <span className="filter-label">Min TVL</span>
              <input
                type="number"
                value={query.minTvl}
                onChange={(e) => updateQuery({ min_tvl: Number(e.target.value) })}
                className="filter-control"
              />
            </label>

            <label>
              <span className="filter-label">Min Points</span>
              <input
                type="number"
                value={query.minPoints}
                onChange={(e) => updateQuery({ min_points: Number(e.target.value) })}
                className="filter-control"
              />
            </label>

            {query.tab === "vaults" ? (
              <label>
                <span className="filter-label">Sort</span>
                <select
                  value={query.sort}
                  onChange={(e) => updateQuery({ api_sort: e.target.value })}
                  className="filter-control"
                >
                  <option value="tvl">TVL</option>
                  <option value="quality">Quality</option>
                  <option value="est_apy">Est. APY</option>
                  <option value="apy_30d">Realized APY 30d</option>
                  <option value="momentum">Momentum</option>
                  <option value="consistency">Consistency</option>
                </select>
              </label>
            ) : (
              <>
                <label>
                  <span className="filter-label">Token</span>
                  <select
                    value={query.token || ""}
                    onChange={(e) => updateQuery({ token: e.target.value || null })}
                    className="filter-control"
                  >
                    {isLoadingAssets ? (
                      <option value="">Loading...</option>
                    ) : (
                      tokenRows.map((row) => (
                        <option key={row.token_symbol} value={row.token_symbol}>{row.token_symbol}</option>
                      ))
                    )}
                  </select>
                </label>
                <label>
                  <span className="filter-label">List</span>
                  <select
                    value={query.tokenScope}
                    onChange={(e) => updateQuery({ token_scope: e.target.value })}
                    className="filter-control"
                  >
                    <option value="featured">Featured</option>
                    <option value="canonical">Canonical</option>
                    <option value="all">All</option>
                  </select>
                </label>
              </>
            )}
          </div>

          {showFilters && (
            <div className="filter-grid filter-advanced">
              <label>
                <span className="filter-label">Chain</span>
                <select
                  value={query.chain || ""}
                  onChange={(e) => updateQuery({ chain: e.target.value || null })}
                  className="filter-control"
                >
                  <option value="">All chains</option>
                  <option value="1">Ethereum</option>
                  <option value="8453">Base</option>
                  <option value="42161">Arbitrum</option>
                  <option value="10">Optimism</option>
                  <option value="137">Polygon</option>
                </select>
              </label>

              <label>
                <span className="filter-label">Category</span>
                <select
                  value={query.category || ""}
                  onChange={(e) => updateQuery({ category: e.target.value || null })}
                  className="filter-control"
                >
                  <option value="">All categories</option>
                  <option value="Stablecoin">Stablecoin</option>
                  <option value="Volatile">Volatile</option>
                </select>
              </label>

              {query.tab === "vaults" && (
                <>
                  <label>
                    <span className="filter-label">Rows</span>
                    <select
                      value={query.limit}
                      onChange={(e) => updateQuery({ limit: Number(e.target.value) })}
                      className="filter-control"
                    >
                      <option value={30}>30</option>
                      <option value={60}>60</option>
                      <option value={100}>100</option>
                    </select>
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={query.dir === "asc"}
                      onChange={(e) => updateQuery({ api_dir: e.target.checked ? "asc" : "desc" })}
                    />
                    <span className="text-sm">Lowest first</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* VAULTS TAB */}
      {query.tab === "vaults" && (
        <>
          {/* KPIs */}
          <section className="section section-lg">
            {isLoadingDiscover ? (
              <div className="kpi-grid kpi-grid-5">
                {Array(5).fill(null).map((_, i) => (
                  <div key={i} className="kpi-card"><KpiGridSkeleton count={1} /></div>
                ))}
              </div>
            ) : (
              <div className="kpi-grid kpi-grid-5">
                {vaultKpiItems.map((item) => (
                  <div key={item.label} className="kpi-card">
                    <div className="kpi-label">{item.label}</div>
                    <div className="kpi-value">{item.value}</div>
                    {item.hint && <div className="kpi-hint">{item.hint}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Vault Table */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Vault Universe</h2>
              <span className="text-sm text-tertiary">
                {isLoadingDiscover ? "Loading..." : `${discoverData?.pagination?.total ?? 0} vaults`}
              </span>
            </div>

            {!isLoadingDiscover && !discoverRows.length ? (
              <NoVaultsEmptyState onReset={() => updateQuery({ min_tvl: 0, min_points: 0, chain: null, category: null })} />
            ) : (
              <TableWrap>
                <table>
                  <thead>
                    <tr>
                      <th>Vault</th>
                      <th className="text-center">Chain</th>
                      <th>Token</th>
                      <th className="text-center">Category</th>
                      <th className="numeric">TVL</th>
                      <th className="numeric">Est. APY</th>
                      <th className="numeric">Realized 30d</th>
                      <th className="numeric">Realized Momentum</th>
                      <th className="text-center">Risk</th>
                      <th className="text-center">Regime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingDiscover ? (
                      <TableSkeleton rows={5} columns={10} />
                    ) : (
                      discoverRows.map((row) => (
                        <tr key={row.vault_address}>
                          <td>
                            <VaultLink
                              chainId={row.chain_id}
                              vaultAddress={row.vault_address}
                              symbol={row.symbol}
                            />
                          </td>
                          <td className="text-center">
                            <Link href={`/structure?tab=chains&chain=${row.chain_id}`} className="text-secondary">
                              {chainLabel(row.chain_id)}
                            </Link>
                          </td>
                          <td>
                            {row.token_symbol ? (
                              <button
                                onClick={() => selectToken(row.token_symbol!)}
                                className="button-reset text-accent"
                              >
                                {row.token_symbol}
                              </button>
                            ) : "n/a"}
                          </td>
                          <td className="text-center">{row.category || "n/a"}</td>
                          <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                          <td className="data-value numeric">{formatPct(row.est_apy)}</td>
                          <td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td>
                          <td className={`data-value numeric ${(row.momentum_7d_30d ?? 0) >= 0 ? "text-positive delta-positive" : "text-negative delta-negative"}`}>
                            {formatPctSigned(row.momentum_7d_30d)}
                          </td>
                          <td className="text-center">{riskLabel(row.risk_level)}</td>
                          <td className="text-center">{regimeLabel(row.regime)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
            </TableWrap>
            )}
          </section>

          {/* Visualizations */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Yield Structure</h2>
            </div>

            {isLoadingDiscover ? (
              <div className="viz-stack">
                <VizSkeleton />
                <VizSkeleton />
                <div className="cols-2">
                  <VizSkeleton variant="bars" />
                  <VizSkeleton />
                </div>
              </div>
            ) : (
              <div className="viz-stack">
              <ScatterPlot
                title="Realized APY vs Momentum (Top 50 by TVL)"
                xLabel="Realized Momentum (7d - 30d realized APY)"
                yLabel="Realized APY 30d"
                points={scatterPoints}
                xFormatter={(v) => formatPct(v, 1)}
                yFormatter={(v) => formatPct(v, 1)}
              />

              <Ridgeline
                title="Realized APY Distribution by Chain"
                series={chainRidgelineSeries}
                valueLabel="Realized APY 30d"
              />

              <div className="cols-2">
                <BarList
                  title="Realized APY 30d Buckets"
                  items={[
                    { id: "high", label: "15%+", value: discoverSummary?.apy_high_vaults },
                    { id: "mid", label: "5-15%", value: discoverSummary?.apy_mid_vaults },
                    { id: "low", label: "<5%", value: discoverSummary?.apy_low_vaults },
                  ]}
                  valueFormatter={(v) => (v == null ? "n/a" : String(v))}
                />

                <HeatGrid
                  title="Risk Mix"
                  items={(discoverData?.risk_mix ?? []).map((r: { risk_level: string; vaults: number; tvl_usd: number | null }) => ({
                    id: r.risk_level,
                    label: riskLabel(r.risk_level),
                    value: r.vaults,
                    note: formatUsd(r.tvl_usd),
                  }))}
                  valueFormatter={(v) => String(v ?? "n/a")}
                />
              </div>
            </div>
          )}
          </section>
        </>
      )}

      {/* VENUES TAB */}
      {query.tab === "venues" && (
        <>
          {/* Selected Token Venues */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">{selectedSymbol || "Token"} Venues</h2>
            </div>

            {isLoadingVenues ? (
              <div className="kpi-grid kpi-grid-4 section-sm">
                {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
              </div>
            ) : selectedSymbol ? (
              <div className="kpi-grid kpi-grid-4 section-sm">
                <div className="kpi-card">
                  <div className="kpi-label">Venues</div>
                  <div className="kpi-value">{venueData?.summary.venues ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Chains</div>
                  <div className="kpi-value">{venueData?.summary.chains ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Best Est. APY</div>
                  <div className="kpi-value">{formatPct(venueData?.summary.best_est_apy)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Realized Spread 30d</div>
                  <div className="kpi-value">{formatPct(venueData?.summary.realized_spread_30d)}</div>
                  <div className="kpi-hint">Best minus worst</div>
                </div>
              </div>
            ) : null}

            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th>Chain</th>
                    <th className="text-center">Category</th>
                    <th className="numeric">TVL</th>
                    <th className="numeric">Est. APY</th>
                    <th className="numeric">Realized 30d</th>
                    <th className="numeric">Realized Momentum</th>
                    <th className="text-center">Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingVenues ? (
                    <TableSkeleton rows={5} columns={8} />
                  ) : (
                    venueRows.map((row) => (
                      <tr key={row.vault_address}>
                        <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                        <td>{chainLabel(row.chain_id)}</td>
                        <td className="text-center">{row.category || "n/a"}</td>
                        <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                        <td className="data-value numeric">{formatPct(row.est_apy)}</td>
                        <td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td>
                        <td className="data-value numeric">{formatPct(row.momentum_7d_30d)}</td>
                        <td className="text-center">{regimeLabel(row.regime)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableWrap>
          </section>

          {/* Token Universe */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Token Universe</h2>
              <span className="text-sm text-tertiary">
                {isLoadingAssets ? "Loading..." : `${tokenRows.length} tokens`}
              </span>
            </div>

            <div className="cols-responsive-2 section-md">
              <div className="kpi-grid kpi-grid-2">
                <div className="kpi-card">
                  <div className="kpi-label">Multi-Chain</div>
                  <div className="kpi-value">{assetData?.summary?.multi_chain_tokens ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Median Best Est. APY</div>
                  <div className="kpi-value">{formatPct(assetData?.summary?.median_best_est_apy)}</div>
                </div>
              </div>

              <BarList
                title="Top by TVL"
                items={topTokenByTvl.map((row) => ({
                  id: row.token_symbol,
                  label: row.token_symbol,
                  value: row.total_tvl_usd,
                }))}
                valueFormatter={(v) => formatUsd(v)}
              />
            </div>

            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th className="text-center">Venues</th>
                    <th className="text-center">Chains</th>
                    <th className="numeric">TVL</th>
                    <th className="numeric">Best Est. APY</th>
                    <th className="numeric">Realized Spread 30d</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingAssets ? (
                    <TableSkeleton rows={8} columns={6} />
                  ) : (
                    tokenRows.map((row) => (
                      <tr
                        key={row.token_symbol}
                        onClick={() => selectToken(row.token_symbol)}
                        style={{
                          cursor: "pointer",
                          backgroundColor: row.token_symbol === selectedSymbol ? "rgba(6, 87, 233, 0.08)" : undefined
                        }}
                      >
                        <td className="font-semibold">{row.token_symbol}</td>
                        <td className="text-center">{row.venues}</td>
                        <td className="text-center">{row.chains}</td>
                        <td className="data-value numeric">{formatUsd(row.total_tvl_usd)}</td>
                        <td className="data-value numeric">{formatPct(row.best_est_apy)}</td>
                        <td className="data-value numeric">{formatPct(row.realized_spread_30d)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableWrap>
          </section>
        </>
      )}
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="card card-padded-lg">Loading...</div>}>
      <ExplorePageContent />
    </Suspense>
  );
}
