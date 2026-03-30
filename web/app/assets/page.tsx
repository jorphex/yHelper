"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useAssetsData, useAssetVenues } from "../hooks/use-assets-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { VaultLink } from "../components/vault-link";
import type { UniverseKind } from "../lib/universe";

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

function regimeLabel(regime: string | null): string {
  if (!regime) return "n/a";
  const map: Record<string, string> = { rising: "Rising", stable: "Stable", falling: "Falling", choppy: "Choppy" };
  return map[regime] || regime;
}

function AssetsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
    minPoints: Number(searchParams.get("min_points") || 45),
    token: searchParams.get("token") || null,
    tokenScope: (searchParams.get("token_scope") || "featured") as "featured" | "canonical" | "all",
  }), [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, String(value));
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  const { data: assetData, isLoading: loadingAssets } = useAssetsData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: 120,
    tokenScope: query.tokenScope,
    apiSort: "tvl",
    apiDir: "desc",
  });

  const selectedToken = query.token || assetData?.rows?.[0]?.token_symbol || null;

  const { data: venueData, isLoading: loadingVenues } = useAssetVenues(
    selectedToken,
    { universe: query.universe, minTvl: query.minTvl, minPoints: query.minPoints }
  );

  const tokenRows = assetData?.rows ?? [];
  const venueRows: VenueRow[] = venueData?.rows ?? [];

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Assets.
          <br />
          <em className="page-title-accent">Compare venues.</em>
        </h1>
        <p className="page-description">
          Compare vault venues for the same token to spot meaningful APY dispersion and momentum gaps. 
          Weighted APY reflects where most capital sits.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Token</span>
              <select
                value={selectedToken || ""}
                onChange={(e) => updateQuery({ token: e.target.value || null })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                {tokenRows.map((row) => (
                  <option key={row.token_symbol} value={row.token_symbol}>{row.token_symbol}</option>
                ))}
              </select>
            </label>

            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="core">Core</option>
                <option value="extended">Extended</option>
                <option value="raw">Raw</option>
              </select>
            </label>

            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Scope</span>
              <select
                value={query.tokenScope}
                onChange={(e) => updateQuery({ token_scope: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="featured">Featured</option>
                <option value="canonical">Canonical</option>
                <option value="all">All</option>
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
          </div>
        </div>
      </section>

      {/* Venue KPIs */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">{selectedToken || "Select token"} Venues</h2>
        </div>

        {loadingVenues ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Venues</div>
              <div className="kpi-value">{venueData?.summary.venues ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chains</div>
              <div className="kpi-value">{venueData?.summary.chains ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Best APY</div>
              <div className="kpi-value">{formatPct(venueData?.summary.best_safe_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Spread</div>
              <div className="kpi-value">{formatPct(venueData?.summary.spread_safe_apy_30d)}</div>
              <div className="kpi-hint">Best minus worst</div>
            </div>
          </div>
        )}

        {/* Venue Table */}
        <div className="table-wrap" style={{ marginTop: "24px" }}>
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th style={{ textAlign: "center" }}>Chain</th>
                <th style={{ textAlign: "center" }}>Category</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>APY</th>
                <th style={{ textAlign: "right" }}>Momentum</th>
                <th style={{ textAlign: "center" }}>Regime</th>
              </tr>
            </thead>
            <tbody>
              {loadingVenues ? (
                <TableSkeleton rows={5} columns={7} />
              ) : venueRows.map((row) => (
                <tr key={row.vault_address}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td style={{ textAlign: "center" }}>{chainLabel(row.chain_id)}</td>
                  <td style={{ textAlign: "center" }}>{row.category || "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                  <td style={{ textAlign: "right", color: (row.momentum_7d_30d ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }} className="data-value">
                    {formatPct(row.momentum_7d_30d)}
                  </td>
                  <td style={{ textAlign: "center" }}>{regimeLabel(row.regime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Token Universe */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Token Universe</h2>
          <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            {loadingAssets ? "Loading..." : `${tokenRows.length} tokens`}
          </span>
        </div>

        {loadingAssets ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "24px" }}>
            {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "24px" }}>
            <div className="kpi-card">
              <div className="kpi-label">Tokens</div>
              <div className="kpi-value">{assetData?.summary?.tokens ?? tokenRows.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Median Spread</div>
              <div className="kpi-value">{formatPct(assetData?.summary?.median_spread_safe_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Multi-Chain</div>
              <div className="kpi-value">{assetData?.summary?.multi_chain_tokens ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total TVL</div>
              <div className="kpi-value">{formatUsd(assetData?.summary?.total_tvl_usd)}</div>
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th style={{ textAlign: "right" }}>Venues</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Best APY</th>
                <th style={{ textAlign: "right" }}>Spread</th>
              </tr>
            </thead>
            <tbody>
              {loadingAssets ? (
                <TableSkeleton rows={8} columns={5} />
              ) : tokenRows.map((row) => (
                <tr
                  key={row.token_symbol}
                  onClick={() => updateQuery({ token: row.token_symbol })}
                  style={{ cursor: "pointer", background: row.token_symbol === selectedToken ? "rgba(6, 87, 233, 0.1)" : undefined }}
                >
                  <td style={{ fontWeight: row.token_symbol === selectedToken ? 600 : undefined }}>{row.token_symbol}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.venues}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.total_tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.best_safe_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.spread_safe_apy_30d)}</td>
                </tr>
              ))}
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
