"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, queryString, replaceQuery } from "../lib/url";
import { BarList, KpiGrid } from "../components/visuals";
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
  const [assetData, setAssetData] = useState<AssetsResponse | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetVenuesResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
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

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    let active = true;
    const loadAssets = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          limit: String(query.limit),
          token_scope: query.tokenScope,
          sort_by: query.apiSort,
          direction: query.apiDir,
        });
        const res = await fetch(`/api/assets?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setAssetsError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as AssetsResponse;
        if (!active) return;
        setAssetData(payload);
        setAssetsError(null);
      } catch (err) {
        if (active) setAssetsError(`Load failed: ${String(err)}`);
      }
    };
    void loadAssets();
    return () => {
      active = false;
    };
  }, [query.universe, query.minTvl, query.minPoints, query.limit, query.tokenScope, query.apiSort, query.apiDir]);

  const selectedSymbol = query.token || assetData?.rows[0]?.token_symbol || "";

  useEffect(() => {
    if (!query.token && assetData?.rows[0]?.token_symbol) {
      replaceQuery(router, pathname, searchParams, { token: assetData.rows[0].token_symbol });
      return;
    }
    if (query.token && assetData?.rows.length) {
      const exists = assetData.rows.some((row) => row.token_symbol === query.token);
      if (!exists) {
        replaceQuery(router, pathname, searchParams, { token: assetData.rows[0].token_symbol });
      }
    }
  }, [assetData, pathname, query.token, router, searchParams]);

  useEffect(() => {
    if (!selectedSymbol) {
      setDetail(null);
      return;
    }
    let active = true;
    const loadDetail = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          limit: String(query.limit),
        });
        const path = `/api/assets/${encodeURIComponent(selectedSymbol)}/venues?${params.toString()}`;
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) {
          if (active) setDetailError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as AssetVenuesResponse;
        if (active) {
          setDetail(payload);
          setDetailError(null);
        }
      } catch (err) {
        if (active) setDetailError(`Load failed: ${String(err)}`);
      }
    };
    void loadDetail();
    return () => {
      active = false;
    };
  }, [selectedSymbol, query.universe, query.minTvl, query.minPoints, query.limit]);

  const tokenRows = sortRows(assetData?.rows ?? [], tokenSort, {
    token: (row) => row.token_symbol,
    venues: (row) => row.venues,
    chains: (row) => row.chains,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    best: (row) => row.best_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    weighted: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    spread: (row) => row.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });

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
      [...(assetData?.rows ?? [])]
        .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 8),
    [assetData?.rows],
  );
  const featuredMinVenues = assetData?.filters?.featured_min_venues;
  const featuredMinChains = assetData?.filters?.featured_min_chains;
  const tokenSpreadCards = useMemo(
    () =>
      [...tokenRows]
        .filter((row) => row.spread_safe_apy_30d !== null && row.spread_safe_apy_30d !== undefined)
        .sort((left, right) => (right.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY) - (left.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY))
        .slice(0, 8),
    [tokenRows],
  );

  return (
    <main className="container">
      <section className="hero">
        <h1>Assets</h1>
        <p className="muted">
          Compare Yearn venues for the same underlying token, then inspect spread, momentum, and consistency in one place.
        </p>
      </section>

      <section className="card explain-card">
        <h2>Read Me First</h2>
        <p className="muted card-intro">
          APY spread = best APY minus worst APY for one token. Weighted APY gives more weight to high-TVL (larger) venues, so it
          reflects where most capital sits.
        </p>
        <p className="muted">Use this page to find large tokens where venue differences are meaningful, not just noise.</p>
      </section>

      {assetsError ? <section className="card">{assetsError}</section> : null}
      {detailError ? <section className="card">{detailError}</section> : null}

      <section className="card">
        <h2>Filters</h2>
        <p className="muted card-intro">All controls are URL-backed so this comparison view is shareable.</p>
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
        </div>
      </section>

      <section className="card assets-universe-card">
        <h2>Token Universe</h2>
        <p className="muted card-intro">
          Pick a token, then sort by spread, TVL, or weighted APY. Featured focuses on larger canonical tokens with enough venue depth.
          Canonical shows all plain symbols. All includes LP and structured symbols.
        </p>
        <div className="inline-controls controls-tight">
          <label>
            Token:&nbsp;
            <select value={selectedSymbol} onChange={(event) => updateQuery({ token: event.target.value })}>
              {tokenRows.length === 0 ? (
                <option value="">No tokens available</option>
              ) : (
                tokenRows.map((row) => (
                  <option key={row.token_symbol} value={row.token_symbol}>
                    {row.token_symbol}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
        {query.tokenScope === "featured" ? (
          <p className="muted card-intro">
            Featured criteria: token TVL at least {formatUsd(assetData?.filters?.featured_min_tvl_usd)}, at least{" "}
            {featuredMinVenues ?? "n/a"} {featuredMinVenues === 1 ? "venue" : "venues"}, and at least {featuredMinChains ?? "n/a"}{" "}
            {featuredMinChains === 1 ? "chain" : "chains"}.
          </p>
        ) : null}
        {tokenRows.length === 0 ? (
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
        <section className="assets-spread-cards">
          <h3>Token Spread Cards</h3>
          <div className="assets-spread-card-grid">
            {tokenSpreadCards.map((row) => {
              const best = row.best_safe_apy_30d ?? 0;
              const weighted = row.weighted_safe_apy_30d ?? 0;
              const spread = row.spread_safe_apy_30d ?? 0;
              const worst = best - spread;
              const maxAbs = Math.max(0.08, Math.abs(best), Math.abs(weighted), Math.abs(worst));
              const toY = (value: number) => 40 - ((value + maxAbs) / (2 * maxAbs)) * 34;
              const spark = `M3,${toY(worst).toFixed(2)} L30,${toY(weighted).toFixed(2)} L57,${toY(best).toFixed(2)}`;
              const nearFlat = spread < 0.15;
              return (
                <button
                  key={`spread-card-${row.token_symbol}`}
                  type="button"
                  className="assets-spread-card"
                  onClick={() => updateQuery({ token: row.token_symbol })}
                >
                  <p className="assets-spread-token">{row.token_symbol}</p>
                  <svg viewBox="0 0 60 44" aria-label={`${row.token_symbol} APY spread shape`}>
                    <line x1={3} y1={40} x2={57} y2={40} className="assets-spread-baseline" />
                    <path d={spark} className="assets-spread-line" />
                    <circle cx={3} cy={toY(worst)} r={2} className="assets-spread-point" />
                    <circle cx={30} cy={toY(weighted)} r={2} className="assets-spread-point" />
                    <circle cx={57} cy={toY(best)} r={2} className="assets-spread-point" />
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
        {tokenRows.length === 0 ? (
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
                {tokenRows.map((row) => (
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

      <section className="card assets-venues-card">
        <h2>{detail?.token_symbol || selectedSymbol || "Token"} Venues</h2>
        <p className="muted card-intro">
          Venue-level detail for the selected token. Sort to compare alternatives quickly. Dense mode adds extra context columns.
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
                  <td className="col-chain">
                    <Link
                      href={`/discover?chain=${row.chain_id}&token=${encodeURIComponent(
                        detail?.token_symbol ?? selectedSymbol,
                      )}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="tablet-hide analyst-only col-category">{row.category || "n/a"}</td>
                  <td className="is-numeric col-tvl">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric col-apy">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric col-momentum">{formatPct(row.momentum_7d_30d)}</td>
                  <td className="is-numeric analyst-only col-consistency">{formatPct(row.consistency_score)}</td>
                  <td className="analyst-only col-regime">{compactRegimeLabel(row.regime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <AssetsPageContent />
    </Suspense>
  );
}
