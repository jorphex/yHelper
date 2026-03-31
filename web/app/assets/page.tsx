"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, compactCategoryLabel, compactChainLabel, formatPct, formatUsd } from "../lib/format";
import { useAssetsData, useAssetVenues } from "../hooks/use-assets-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, queryString, replaceQuery } from "../lib/url";
import { BarList } from "../components/visuals";
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

type VenueRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  regime: string;
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
    };
  }, [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const { data: assetData, isLoading: isLoadingAssets } = useAssetsData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: query.limit,
    tokenScope: query.tokenScope,
    apiSort: query.apiSort,
    apiDir: query.apiDir,
  });

  const selectedSymbol = query.token || "";

  const { data: detail, isLoading: isLoadingDetail } = useAssetVenues(
    selectedSymbol,
    { universe: query.universe, minTvl: query.minTvl, minPoints: query.minPoints }
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
  const filteredTokenRows = useMemo(() =>
    tokenQueryNormalized.length === 0
      ? tokenRows
      : tokenRows.filter((row) => row.token_symbol.toLowerCase().includes(tokenQueryNormalized)),
    [tokenRows, tokenQueryNormalized]
  );

  useEffect(() => {
    const firstSymbol = filteredTokenRows[0]?.token_symbol;
    if (!query.token && firstSymbol) {
      replaceQuery(router, pathname, searchParams, { token: firstSymbol });
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

  const topTokenByTvl = useMemo(() =>
    [...filteredTokenRows]
      .sort((a, b) => (b.total_tvl_usd ?? 0) - (a.total_tvl_usd ?? 0))
      .slice(0, 8),
    [filteredTokenRows]
  );

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Assets
          <br />
          <em className="page-title-accent">Venue comparison</em>
        </h1>
        <p className="page-description">
          Compare vault venues for the same token.
          <br />
          Weighted APY reflects where most capital sits.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value, min_tvl: null, min_points: null })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                {UNIVERSE_VALUES.map((v) => (
                  <option key={v} value={v}>{universeLabel(v)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min TVL</span>
              <input
                type="number"
                value={query.minTvl}
                onChange={(e) => updateQuery({ min_tvl: Number(e.target.value) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Token</span>
              <select
                value={selectedSymbol}
                onChange={(e) => updateQuery({ token: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                {filteredTokenRows.map((row) => (
                  <option key={row.token_symbol} value={row.token_symbol}>{row.token_symbol}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>List</span>
              <select
                value={query.tokenScope}
                onChange={(e) => updateQuery({ token_scope: e.target.value as TokenScope })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="featured">Featured</option>
                <option value="canonical">Canonical</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Selected Token Venues */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">{selectedSymbol || "Token"} Venues</h2>
        </div>

        {isLoadingDetail ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "24px" }}>
            {Array(3).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : selectedSymbol ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "24px" }}>
            <div className="kpi-card">
              <div className="kpi-label">Venues</div>
              <div className="kpi-value">{detail?.summary.venues ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chains</div>
              <div className="kpi-value">{detail?.summary.chains ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Spread</div>
              <div className="kpi-value">{formatPct(detail?.summary.spread_safe_apy_30d)}</div>
              <div className="kpi-hint">Best minus worst</div>
            </div>
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Chain</th>
                <th style={{ textAlign: "center" }}>Category</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>APY</th>
                <th style={{ textAlign: "right" }}>Momentum</th>
                <th style={{ textAlign: "center" }}>Regime</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingDetail ? (
                <TableSkeleton rows={5} columns={6} />
              ) : (
                venueRows.map((row) => (
                  <tr key={row.vault_address}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                    <td>{compactChainLabel(row.chain_id, isCompactViewport)}</td>
                    <td style={{ textAlign: "center" }}>{compactCategoryLabel(row.category)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.momentum_7d_30d)}</td>
                    <td style={{ textAlign: "center" }}>{compactRegimeLabel(row.regime)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Token Universe */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Token Universe</h2>
          <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            {isLoadingAssets ? "Loading..." : `${filteredTokenRows.length} tokens`}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px", marginBottom: "32px" }}>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Multi-Chain</div>
              <div className="kpi-value">{assetData?.summary?.multi_chain_tokens ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Median Spread</div>
              <div className="kpi-value">{formatPct(assetData?.summary?.median_spread_safe_apy_30d)}</div>
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

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th style={{ textAlign: "center" }}>Venues</th>
                <th style={{ textAlign: "center" }}>Chains</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Best APY</th>
                <th style={{ textAlign: "right" }}>Spread</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingAssets ? (
                <TableSkeleton rows={8} columns={6} />
              ) : (
                filteredTokenRows.map((row) => (
                  <tr
                    key={row.token_symbol}
                    onClick={() => updateQuery({ token: row.token_symbol })}
                    style={{ 
                      cursor: "pointer", 
                      backgroundColor: row.token_symbol === selectedSymbol ? "rgba(6, 87, 233, 0.08)" : undefined 
                    }}
                  >
                    <td style={{ fontWeight: 500 }}>{row.token_symbol}</td>
                    <td style={{ textAlign: "center" }}>{row.venues}</td>
                    <td style={{ textAlign: "center" }}>{row.chains}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.total_tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.best_safe_apy_30d)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.spread_safe_apy_30d)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <AssetsPageContent />
    </Suspense>
  );
}
