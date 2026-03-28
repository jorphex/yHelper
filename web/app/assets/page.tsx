"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../lib/api";
import { chainLabel, compactCategoryLabel, compactChainLabel, formatPct, formatUsd } from "../lib/format";
import { useAssetsData, useAssetVenues } from "../hooks/use-assets-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, queryString, replaceQuery } from "../lib/url";
import { BarList, KpiGrid } from "../components/visuals";
import { PageTopPanel } from "../components/page-top-panel";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

type AssetRow = {
  token_symbol: string;
  token_type?: "canonical" | "structured";
  venues: number;
  chains: number;
  total_tvl_usd: number | null;
  best_safe_apy_30d: number | null;
  weighted_safe_apy_30d: number | null;
  spread_safe_apy_30d: number | null;
};

type AssetsResponse = {
  filters?: {
    token_scope?: "featured" | "canonical" | "all";
    featured_min_tvl_usd?: number;
    featured_min_venues?: number;
    featured_min_chains?: number;
  };
  summary?: {
    tokens?: number;
    tokens_available_featured?: number;
    tokens_available_all?: number;
    tokens_available_canonical?: number;
    tokens_available_structured?: number;
    total_tvl_usd?: number;
    total_venues?: number;
    avg_venues_per_token?: number | null;
    multi_chain_tokens?: number;
    high_spread_tokens?: number;
    median_spread_safe_apy_30d?: number | null;
    median_best_safe_apy_30d?: number | null;
    tvl_weighted_safe_apy_30d?: number | null;
    top_token_symbol?: string | null;
    top_token_tvl_share?: number | null;
  };
  rows: AssetRow[];
};

type VenueRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  category: string | null;
  version: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  regime: string;
};

type AssetVenuesResponse = {
  token_symbol: string;
  summary: {
    venues: number;
    chains: number;
    total_tvl_usd: number;
    best_safe_apy_30d: number | null;
    worst_safe_apy_30d: number | null;
    spread_safe_apy_30d: number | null;
    weighted_safe_apy_30d: number | null;
    best_venue_symbol: string | null;
    median_safe_apy_30d?: number | null;
    median_momentum_7d_30d?: number | null;
    tvl_weighted_momentum_7d_30d?: number | null;
    regime_counts?: Array<{ regime: string; vaults: number }>;
  };
  rows: VenueRow[];
};

type TokenSortKey = "token" | "venues" | "chains" | "tvl" | "best" | "weighted" | "spread";
type VenueSortKey = "vault" | "chain" | "category" | "tvl" | "apy" | "momentum" | "consistency" | "regime";
type AssetApiSort = "tvl" | "spread" | "best_apy" | "venues";
type TokenScope = "featured" | "canonical" | "all";

function compactRegimeLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.toLowerCase();
  if (key === "rising") return "Rising";
  if (key === "falling") return "Falling";
  if (key === "stable") return "Stable";
  if (key === "choppy") return "Choppy";
  return value;
}

function AssetsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [tokenSort, setTokenSort] = useState<SortState<TokenSortKey>>({ key: "tvl", direction: "desc" });
  const [venueSort, setVenueSort] = useState<SortState<VenueSortKey>>({ key: "apy", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      limit: queryInt(searchParams, "limit", 120, { min: 10, max: 300 }),
      tokenScope: queryChoice<TokenScope>(searchParams, "token_scope", ["featured", "canonical", "all"] as const, "featured"),
      apiSort: queryChoice<AssetApiSort>(searchParams, "api_sort", ["tvl", "spread", "best_apy", "venues"] as const, "tvl"),
      apiDir: queryChoice(searchParams, "api_dir", ["asc", "desc"] as const, "desc"),
      token: queryString(searchParams, "token", ""),
      tokenQuery: queryString(searchParams, "token_query", ""),
      tokenSort: queryChoice<TokenSortKey>(
        searchParams,
        "token_sort",
        ["token", "venues", "chains", "tvl", "best", "weighted", "spread"] as const,
        "tvl",
      ),
      tokenDir: queryChoice(searchParams, "token_dir", ["asc", "desc"] as const, "desc"),
      venueSort: queryChoice<VenueSortKey>(
        searchParams,
        "venue_sort",
        ["vault", "chain", "category", "tvl", "apy", "momentum", "consistency", "regime"] as const,
        "apy",
      ),
      venueDir: queryChoice(searchParams, "venue_dir", ["asc", "desc"] as const, "desc"),
    };
  }, [searchParams]);

  useEffect(() => {
    setTokenSort({ key: query.tokenSort, direction: query.tokenDir });
    setVenueSort({ key: query.venueSort, direction: query.venueDir });
  }, [query.tokenSort, query.tokenDir, query.venueSort, query.venueDir]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  // React Query data fetching
  const { data: assetData, isLoading: isLoadingAssets, error: assetsError } = useAssetsData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: query.limit,
    tokenScope: query.tokenScope,
    apiSort: query.apiSort,
    apiDir: query.apiDir,
  });

  const selectedSymbol = query.token || "";

  const { data: detail, isLoading: isLoadingDetail, error: detailError } = useAssetVenues(
    selectedSymbol,
    {
      universe: query.universe,
      minTvl: query.minTvl,
      minPoints: query.minPoints,
    }
  );

  const tokenRows = sortRows(assetData?.rows ?? [], tokenSort, {
    token: (row) => row.token_symbol,
    venues: (row) => row.venues,
    chains: (row) => row.chains,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    best: (row) => row.best_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    weighted: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    spread: (row) => row.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });
  const tokenQueryNormalized = query.tokenQuery.trim().toLowerCase();
  const filteredTokenRows = useMemo(
    () =>
      tokenQueryNormalized.length === 0
        ? tokenRows
        : tokenRows.filter((row) => row.token_symbol.toLowerCase().includes(tokenQueryNormalized)),
    [tokenRows, tokenQueryNormalized],
  );

  useEffect(() => {
    const firstSymbol = filteredTokenRows[0]?.token_symbol;
    if (!query.token) {
      if (firstSymbol) {
        replaceQuery(router, pathname, searchParams, { token: firstSymbol });
      }
      return;
    }
    const exists = filteredTokenRows.some((row) => row.token_symbol === query.token);
    if (!exists) {
      replaceQuery(router, pathname, searchParams, { token: firstSymbol ?? null });
    }
  }, [filteredTokenRows, pathname, query.token, router, searchParams]);

  const venueRows = sortRows(detail?.rows ?? [], venueSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.consistency_score ?? Number.NEGATIVE_INFINITY,
    regime: (row) => row.regime,
  });
  const topTokenByTvl = useMemo(
    () =>
      [...filteredTokenRows]
        .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 8),
    [filteredTokenRows],
  );
  const featuredMinVenues = assetData?.filters?.featured_min_venues;
  const featuredMinChains = assetData?.filters?.featured_min_chains;
  const tokenSpreadCards = useMemo(
    () =>
      [...filteredTokenRows]
        .filter((row) => row.spread_safe_apy_30d !== null && row.spread_safe_apy_30d !== undefined)
        .sort((left, right) => (right.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY) - (left.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY))
        .slice(0, 8),
    [filteredTokenRows],
  );

  if (assetsError && !assetData) {
    return (
      <main className="container route-page">
        <section className="card section-card status-card status-card-error">
          <h2>Asset comparison is temporarily unavailable</h2>
          <p className="card-intro">The token list did not load, so the comparison surface is holding back its KPI and table stack until the feed recovers.</p>
          <p className="muted">Retry after the next ingestion run or check again once the API is healthy.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="container route-page">
      <section className="hero hero-assets">
        <p className="hero-kicker">Venue comparison</p>
        <h1>Assets</h1>
        <p className="muted">
          Compare vault venues for the same token to spot meaningful APY dispersion and momentum gaps.
        </p>
      </section>

      <PageTopPanel
        introTitle="Comparison Lens"
        filtersTitle="Primary Filters"
        tone="assets"
        intro={
          <>
            <p className="muted card-intro">
              APY spread is the gap between the best and worst venue for one token. Weighted APY leans toward high-TVL venues, so
              it reflects where most capital sits.
            </p>
            <p className="muted">Use this page when venue differences matter, not just raw yield.</p>
          </>
        }
        filtersIntro={<p className="muted card-intro">These controls live in the URL, so this comparison is easy to share.</p>}
        filters={
          <div className="inline-controls controls-tight">
            <label>
              Universe:&nbsp;
              <select
                value={query.universe}
                onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}
              >
                {UNIVERSE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {universeLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-compact">
              Min TVL (USD):&nbsp;
              <input
                type="number"
                min={0}
                value={query.minTvl}
                onChange={(event) => updateQuery({ min_tvl: Number(event.target.value || 0) })}
              />
            </label>
            <label className="field-compact">
              Min Points:&nbsp;
              <input
                type="number"
                min={0}
                max={365}
                value={query.minPoints}
                onChange={(event) => updateQuery({ min_points: Number(event.target.value || 0) })}
              />
            </label>
            <label>
              Selected Token:&nbsp;
              <select value={selectedSymbol} onChange={(event) => updateQuery({ token: event.target.value })}>
                {filteredTokenRows.length === 0 ? (
                  <option value="">No tokens available</option>
                ) : (
                  filteredTokenRows.map((row) => (
                    <option key={row.token_symbol} value={row.token_symbol}>
                      {row.token_symbol}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        }
        secondaryFilters={
          <div className="inline-controls controls-tight">
            <label>
              List:&nbsp;
              <select value={query.tokenScope} onChange={(event) => updateQuery({ token_scope: event.target.value as TokenScope, token: null })}>
                <option value="featured">Featured (clean list)</option>
                <option value="canonical">Canonical only</option>
                <option value="all">All symbols (incl. LP/structured)</option>
              </select>
            </label>
            <label>
              Rows:&nbsp;
              <select value={query.limit} onChange={(event) => updateQuery({ limit: Number(event.target.value) })}>
                <option value={60}>60</option>
                <option value={120}>120</option>
                <option value={180}>180</option>
              </select>
            </label>
            <label>
              Sort:&nbsp;
              <select value={query.apiSort} onChange={(event) => updateQuery({ api_sort: event.target.value })}>
                <option value="tvl">TVL</option>
                <option value="spread">APY Spread</option>
                <option value="best_apy">Best APY</option>
                <option value="venues">Venues</option>
              </select>
            </label>
            <label>
              Direction:&nbsp;
              <select value={query.apiDir} onChange={(event) => updateQuery({ api_dir: event.target.value })}>
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
            <label>
              Token Search:&nbsp;
              <input
                type="text"
                value={query.tokenQuery}
                onChange={(event) => updateQuery({ token_query: event.target.value, token: null })}
                placeholder="e.g. DAI, WETH"
              />
            </label>
          </div>
        }
        secondaryFiltersTitle="Search + Sorting"
      />

      {detailError ? <section className="card">{String(detailError)}</section> : null}

      <section className="card section-card table-card assets-venues-card">
        <h2>{detail?.token_symbol || selectedSymbol || "Token"} Venues</h2>
        <p className="muted card-intro">
          Sort venue rows to compare the selected token quickly. Pro mode adds deeper context.
        </p>
        <p className="muted">
          Scope: active, non-retired <strong>Multi Strategy v3</strong> vaults only.
        </p>
        {!selectedSymbol ? <p className="muted">Select a token above to load venue-level details.</p> : null}
        <div className="split-grid">
          <KpiGrid
            items={[
              { label: "Venues", value: String(detail?.summary.venues ?? "n/a") },
              { label: "Chains", value: String(detail?.summary.chains ?? "n/a") },
              { label: "Total TVL", value: formatUsd(detail?.summary.total_tvl_usd) },
              { label: "Best APY 30d", value: formatPct(detail?.summary.best_safe_apy_30d) },
              { label: "Median APY 30d", value: formatPct(detail?.summary.median_safe_apy_30d) },
              { label: "Weighted APY 30d", value: formatPct(detail?.summary.weighted_safe_apy_30d) },
              { label: "Median Momentum", value: formatPct(detail?.summary.median_momentum_7d_30d) },
              { label: "APY Spread", value: formatPct(detail?.summary.spread_safe_apy_30d) },
            ]}
          />
          <div className="analyst-only">
            <BarList
              title="Regime Count (Selected Token)"
              items={(detail?.summary.regime_counts ?? []).map((row) => ({
                id: row.regime,
                label: compactRegimeLabel(row.regime),
                value: row.vaults,
              }))}
              valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="assets-venues-table">
            <thead>
              <tr>
                <th className="col-vault">
                  <button
                    className={`th-button ${venueSort.key === "vault" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "vault");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Vault <span className="th-indicator">{sortIndicator(venueSort, "vault")}</span>
                  </button>
                </th>
                <th className="col-chain">
                  <button
                    className={`th-button ${venueSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "chain");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(venueSort, "chain")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only col-category">
                  <button
                    className={`th-button ${venueSort.key === "category" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "category");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Category <span className="th-indicator">{sortIndicator(venueSort, "category")}</span>
                  </button>
                </th>
                <th className="is-numeric col-tvl">
                  <button
                    className={`th-button ${venueSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "tvl");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(venueSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric col-apy">
                  <button
                    className={`th-button ${venueSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "apy");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    APY 30d <span className="th-indicator">{sortIndicator(venueSort, "apy")}</span>
                  </button>
                </th>
                <th className="is-numeric col-momentum">
                  <button
                    className={`th-button ${venueSort.key === "momentum" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "momentum");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Momentum <span className="th-indicator">{sortIndicator(venueSort, "momentum")}</span>
                  </button>
                </th>
                <th className="is-numeric analyst-only col-consistency">
                  <button
                    className={`th-button ${venueSort.key === "consistency" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "consistency");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Consistency <span className="th-indicator">{sortIndicator(venueSort, "consistency")}</span>
                  </button>
                </th>
                <th className="analyst-only col-regime">
                  <button
                    className={`th-button ${venueSort.key === "regime" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "regime");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Regime <span className="th-indicator">{sortIndicator(venueSort, "regime")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {venueRows.map((row) => (
                <tr key={row.vault_address}>
                  <td className="col-vault"><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td className="col-chain" title={chainLabel(row.chain_id)}>
                    <Link
                      href={`/discover?chain=${row.chain_id}&token=${encodeURIComponent(
                        detail?.token_symbol ?? selectedSymbol,
                      )}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {compactChainLabel(row.chain_id, isCompactViewport)}
                    </Link>
                  </td>
                  <td className="tablet-hide analyst-only col-category" title={row.category || "n/a"}>
                    {compactCategoryLabel(row.category, isCompactViewport)}
                  </td>
                  <td className="is-numeric col-tvl">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric col-apy">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric col-momentum">{formatPct(row.momentum_7d_30d)}</td>
                  <td className="is-numeric analyst-only col-consistency">{formatPct(row.consistency_score)}</td>
                  <td className="analyst-only col-regime" title={compactRegimeLabel(row.regime)}>{compactRegimeLabel(row.regime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card section-card summary-card assets-universe-card">
        <h2>Token Universe</h2>
        <p className="muted card-intro">
          Pick a token, then sort by spread, TVL, or weighted APY. Featured focuses on larger canonical tokens with enough venue
          depth. Canonical shows plain symbols. All includes LP and structured symbols.
        </p>
        <p className="muted card-intro">
          Current detail view: <strong>{selectedSymbol || "No token selected"}</strong>. Change it with <strong>Selected Token</strong>
          above.
        </p>
        {query.tokenScope === "featured" ? (
          <p className="muted card-intro">
            Featured means token TVL at least {formatUsd(assetData?.filters?.featured_min_tvl_usd)}, at least{" "}
            {featuredMinVenues ?? "n/a"} {featuredMinVenues === 1 ? "venue" : "venues"}, and at least {featuredMinChains ?? "n/a"}{" "}
            {featuredMinChains === 1 ? "chain" : "chains"}.
          </p>
        ) : null}
        {filteredTokenRows.length === 0 ? (
          <p className="muted card-intro">
            No tokens matched this filter set. Lower <strong>Min TVL</strong>, lower <strong>Min Points</strong>, or switch list mode.
          </p>
        ) : null}
        <div className="split-grid assets-universe-top">
          <KpiGrid
            items={[
              { label: "Tokens", value: String(assetData?.summary?.tokens ?? tokenRows.length) },
              {
                label: "Featured Available",
                value: String(assetData?.summary?.tokens_available_featured ?? "n/a"),
                hint: "Large + multi-venue",
              },
              {
                label: "Median Spread",
                value: formatPct(assetData?.summary?.median_spread_safe_apy_30d),
                hint: "Middle APY spread (best minus worst venue) across tokens",
              },
              {
                label: "Multi-Chain Tokens",
                value: String(assetData?.summary?.multi_chain_tokens ?? "n/a"),
                hint: "Tokens available on more than one chain",
              },
              {
                label: "High Spread Tokens",
                value: String(assetData?.summary?.high_spread_tokens ?? "n/a"),
                hint: "Tokens with APY spread >= 2 percentage points",
              },
              {
                label: "Canonical Available",
                value: String(assetData?.summary?.tokens_available_canonical ?? "n/a"),
                hint: "Plain token symbols (no LP/structured syntax)",
              },
              {
                label: "Structured Available",
                value: String(assetData?.summary?.tokens_available_structured ?? "n/a"),
                hint: "LP/pooled/structured symbols detected by token format",
              },
            ]}
          />
          <div className="analyst-only">
            <BarList
              title="Top Tokens by TVL"
              items={topTokenByTvl.map((row) => ({
                id: row.token_symbol,
                label: row.token_symbol,
                value: row.total_tvl_usd,
                note: `Spread ${formatPct(row.spread_safe_apy_30d)}`,
              }))}
              valueFormatter={(value) => formatUsd(value)}
            />
          </div>
        </div>
        <details className="section-details analyst-only">
          <summary>Token spread outliers</summary>
          <div className="section-details-body">
            <section className="assets-spread-cards analyst-only">
              <h3>Token Spread Cards</h3>
              <div className="assets-spread-card-grid">
                {tokenSpreadCards.map((row) => {
                  const best = row.best_safe_apy_30d ?? 0;
                  const weighted = row.weighted_safe_apy_30d ?? 0;
                  const spread = row.spread_safe_apy_30d ?? 0;
                  const worst = best - spread;
                  const maxAbs = Math.max(0.08, Math.abs(best), Math.abs(weighted), Math.abs(worst));
                  const sparkHeight = 58;
                  const sparkBaseline = 54;
                  const toY = (value: number) => sparkBaseline - ((value + maxAbs) / (2 * maxAbs)) * 47;
                  const sparkLeft = 2;
                  const sparkMid = 66;
                  const sparkRight = 130;
                  const spark = `M${sparkLeft},${toY(worst).toFixed(2)} L${sparkMid},${toY(weighted).toFixed(2)} L${sparkRight},${toY(best).toFixed(2)}`;
                  const nearFlat = spread < 0.15;
                  return (
                    <button
                      key={`spread-card-${row.token_symbol}`}
                      type="button"
                      className="assets-spread-card"
                      onClick={() => updateQuery({ token: row.token_symbol })}
                    >
                      <p className="assets-spread-token">{row.token_symbol}</p>
                      <svg viewBox={`0 0 132 ${sparkHeight}`} aria-label={`${row.token_symbol} APY spread shape`}>
                        <line x1={sparkLeft} y1={sparkBaseline} x2={sparkRight} y2={sparkBaseline} className="assets-spread-baseline" />
                        <path d={spark} className="assets-spread-line" />
                        <circle cx={sparkLeft} cy={toY(worst)} r={2.25} className="assets-spread-point" />
                        <circle cx={sparkMid} cy={toY(weighted)} r={2.25} className="assets-spread-point" />
                        <circle cx={sparkRight} cy={toY(best)} r={2.25} className="assets-spread-point" />
                      </svg>
                      <p className="assets-spread-value">{formatPct(spread)}</p>
                      <p className="assets-spread-note muted">
                        {nearFlat ? "Near-flat spread." : "Worst → weighted → best."} {formatPct(worst, 1)} · {formatPct(weighted, 1)} ·{" "}
                        {formatPct(best, 1)}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="muted viz-legend">
                Cards rank by APY spread. Sparkline points are worst → weighted → best APY; flatter lines mean token venues are currently similar.
              </p>
            </section>
          </div>
        </details>
        {filteredTokenRows.length === 0 ? (
          <p className="muted">No tokens match these filters. Try lower Min TVL, lower Min Points, or switch List mode.</p>
        ) : (
          <div className="table-wrap">
            <table className="assets-token-table">
              <thead>
                <tr>
                  <th className="col-token">
                    <button
                      className={`th-button ${tokenSort.key === "token" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "token");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      Token <span className="th-indicator">{sortIndicator(tokenSort, "token")}</span>
                    </button>
                  </th>
                  {query.tokenScope === "all" ? <th className="col-type">Type</th> : null}
                  <th className="is-numeric col-venues">
                    <button
                      className={`th-button ${tokenSort.key === "venues" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "venues");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      Venues <span className="th-indicator">{sortIndicator(tokenSort, "venues")}</span>
                    </button>
                  </th>
                  <th className="is-numeric tablet-hide analyst-only col-chains">
                    <button
                      className={`th-button ${tokenSort.key === "chains" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "chains");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      Chains <span className="th-indicator">{sortIndicator(tokenSort, "chains")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-tvl">
                    <button
                      className={`th-button ${tokenSort.key === "tvl" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "tvl");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      Total TVL <span className="th-indicator">{sortIndicator(tokenSort, "tvl")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-best">
                    <button
                      className={`th-button ${tokenSort.key === "best" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "best");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      Best APY 30d <span className="th-indicator">{sortIndicator(tokenSort, "best")}</span>
                    </button>
                  </th>
                  <th className="is-numeric tablet-hide analyst-only col-weighted">
                    <button
                      className={`th-button ${tokenSort.key === "weighted" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "weighted");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      Weighted APY 30d <span className="th-indicator">{sortIndicator(tokenSort, "weighted")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-spread">
                    <button
                      className={`th-button ${tokenSort.key === "spread" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(tokenSort, "spread");
                        setTokenSort(next);
                        updateQuery({ token_sort: next.key, token_dir: next.direction });
                      }}
                    >
                      APY Spread <span className="th-indicator">{sortIndicator(tokenSort, "spread")}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTokenRows.map((row) => (
                  <tr
                    key={row.token_symbol}
                    className={row.token_symbol === selectedSymbol ? "row-selected" : "row-clickable"}
                    onClick={() => updateQuery({ token: row.token_symbol })}
                  >
                    <td className="col-token">{row.token_symbol}</td>
                    {query.tokenScope === "all" ? <td className="col-type">{row.token_type === "structured" ? "Structured" : "Canonical"}</td> : null}
                    <td className="is-numeric col-venues">{row.venues}</td>
                    <td className="is-numeric tablet-hide analyst-only col-chains">{row.chains}</td>
                    <td className="is-numeric col-tvl">{formatUsd(row.total_tvl_usd)}</td>
                    <td className="is-numeric col-best">{formatPct(row.best_safe_apy_30d)}</td>
                    <td className="is-numeric tablet-hide analyst-only col-weighted">{formatPct(row.weighted_safe_apy_30d)}</td>
                    <td className="is-numeric col-spread">{formatPct(row.spread_safe_apy_30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </main>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<main className="container route-page"><section className="card">Loading…</section></main>}>
      <AssetsPageContent />
    </Suspense>
  );
}
