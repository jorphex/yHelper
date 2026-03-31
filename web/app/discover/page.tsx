"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../lib/api";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useDiscoverData } from "../hooks/use-discover-data";
import type { UniverseKind } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { NoVaultsEmptyState } from "../components/empty-state";
import { DataLoadError } from "../components/error-state";
import { VaultLink } from "../components/vault-link";
import { BarList, HeatGrid, ScatterPlot, TrendStrips, Ridgeline } from "../components/visuals";

type DiscoverRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  risk_level: string | null;
  is_retired: boolean;
  is_highlighted: boolean;
  migration_available: boolean;
  strategies_count: number;
  regime: string;
};

function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

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

function DiscoverPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
    minPoints: Number(searchParams.get("min_points") || 45),
    limit: Number(searchParams.get("limit") || 30),
    sort: searchParams.get("api_sort") || "quality",
    dir: searchParams.get("api_dir") || "desc",
    chain: searchParams.get("chain") || null,
    category: searchParams.get("category") || null,
    token: searchParams.get("token") || null,
  }), [searchParams]);

  const { data, isLoading, error, refetch } = useDiscoverData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: query.limit,
    sort: query.sort,
    dir: query.dir,
  });
  
  const [showFilters, setShowFilters] = useState(false);

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, String(value));
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  const rows: DiscoverRow[] = data?.rows ?? [];
  const summary = data?.summary;

  // KPI items
  const kpiItems = useMemo(() => [
    { label: "Chains", value: String(summary?.chains ?? "n/a") },
    { label: "Tokens", value: String(summary?.tokens ?? "n/a") },
    { label: "Median APY", value: formatPct(summary?.median_safe_apy_30d) },
    { label: "Coverage", value: formatPct(data?.coverage?.coverage_ratio, 0), hint: "Visible vaults with metrics" },
    { label: "Avg Momentum", value: formatPct(summary?.avg_momentum_7d_30d), hint: "7d minus 30d APY" },
  ], [summary, data]);

  // Scatter data
  const scatterPoints = useMemo(() => rows.slice(0, 50).map((row) => ({
    id: row.vault_address,
    x: row.momentum_7d_30d ?? 0,
    y: row.safe_apy_30d ?? 0,
    size: row.tvl_usd ?? 0,
    tone: (row.momentum_7d_30d ?? 0) >= 0 ? "positive" as const : "negative" as const,
    href: `https://yearn.fi/v3/${row.chain_id}/${row.vault_address}`,
    tooltip: `${row.symbol || row.vault_address}\nAPY: ${formatPct(row.safe_apy_30d)}\nMomentum: ${formatPct(row.momentum_7d_30d)}`,
  })), [rows]);

  // Ridgeline data - group by chain
  const chainRidgelineSeries = useMemo(() => {
    const byChain = new Map<number, number[]>();
    for (const row of rows) {
      if (!row.safe_apy_30d) continue;
      if (!byChain.has(row.chain_id)) byChain.set(row.chain_id, []);
      byChain.get(row.chain_id)!.push(row.safe_apy_30d);
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
  }, [rows]);



  if (error && !data) {
    return <DataLoadError onRetry={() => refetch()} />;
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Discover
          <br />
          <em className="page-title-accent">Scan and filter</em>
        </h1>
        <p className="page-description">
          Find vaults with filters for size, data quality, and trend direction.
          <br />
          APY is estimated from Price Per Share history, a backward-looking signal.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <span className="card-title">Filters</span>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className="button button-ghost"
            >
              {showFilters ? "Hide" : "Show"} advanced
            </button>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select 
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="core">Core (high signal)</option>
                <option value="extended">Extended (more vaults)</option>
                <option value="raw">Raw (all data)</option>
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
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min Points</span>
              <input 
                type="number"
                value={query.minPoints}
                onChange={(e) => updateQuery({ min_points: Number(e.target.value) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
            
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sort</span>
              <select 
                value={query.sort}
                onChange={(e) => updateQuery({ api_sort: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="quality">Quality</option>
                <option value="tvl">TVL</option>
                <option value="apy_30d">APY 30d</option>
                <option value="momentum">Momentum</option>
                <option value="consistency">Consistency</option>
              </select>
            </label>
          </div>
          
          {showFilters && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-subtle)" }}>
              <label>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Chain</span>
                <select 
                  value={query.chain || ""}
                  onChange={(e) => updateQuery({ chain: e.target.value || null })}
                  style={{ width: "100%", marginTop: "6px" }}
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
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Category</span>
                <select 
                  value={query.category || ""}
                  onChange={(e) => updateQuery({ category: e.target.value || null })}
                  style={{ width: "100%", marginTop: "6px" }}
                >
                  <option value="">All categories</option>
                  <option value="Stablecoin">Stablecoin</option>
                  <option value="Volatile">Volatile</option>
                </select>
              </label>
              
              <label>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Rows</span>
                <select 
                  value={query.limit}
                  onChange={(e) => updateQuery({ limit: Number(e.target.value) })}
                  style={{ width: "100%", marginTop: "6px" }}
                >
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                  <option value={100}>100</option>
                </select>
              </label>
              
              <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "20px" }}>
                <input 
                  type="checkbox"
                  checked={query.dir === "asc"}
                  onChange={(e) => updateQuery({ api_dir: e.target.checked ? "asc" : "desc" })}
                />
                <span style={{ fontSize: "13px" }}>Lowest first</span>
              </label>
            </div>
          )}
        </div>
      </section>

      {/* KPIs */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {Array(5).fill(null).map((_, i) => (
              <div key={i} className="kpi-card"><KpiGridSkeleton count={1} /></div>
            ))}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {kpiItems.map((item) => (
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
          <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            {isLoading ? "Loading..." : `${data?.pagination?.total ?? 0} vaults`}
          </span>
        </div>
        
        {!isLoading && !rows.length ? (
          <NoVaultsEmptyState onReset={() => updateQuery({ min_tvl: 0, min_points: 0, chain: null, category: null })} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vault</th>
                  <th style={{ textAlign: "center" }}>Chain</th>
                  <th>Token</th>
                  <th style={{ textAlign: "center" }}>Category</th>
                  <th style={{ textAlign: "right" }}>TVL</th>
                  <th style={{ textAlign: "right" }}>APY</th>
                  <th style={{ textAlign: "right" }}>Momentum</th>
                  <th style={{ textAlign: "center" }}>Risk</th>
                  <th style={{ textAlign: "center" }}>Regime</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton rows={5} columns={9} />
                ) : (
                  rows.map((row) => (
                    <tr key={row.vault_address}>
                      <td>
                        <VaultLink 
                          chainId={row.chain_id} 
                          vaultAddress={row.vault_address} 
                          symbol={row.symbol} 
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <Link href={`/discover?chain=${row.chain_id}`} style={{ color: "var(--text-secondary)" }}>
                          {chainLabel(row.chain_id)}
                        </Link>
                      </td>
                      <td>
                        {row.token_symbol ? (
                          <Link href={`/assets?token=${encodeURIComponent(row.token_symbol)}`} style={{ color: "var(--accent)" }}>
                            {row.token_symbol}
                          </Link>
                        ) : "n/a"}
                      </td>
                      <td style={{ textAlign: "center" }}>{row.category || "n/a"}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                      <td style={{ textAlign: "right", color: (row.momentum_7d_30d ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }} className="data-value">
                        {formatPct(row.momentum_7d_30d)}
                      </td>
                      <td style={{ textAlign: "center" }}>{riskLabel(row.risk_level)}</td>
                      <td style={{ textAlign: "center" }}>{regimeLabel(row.regime)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Visualizations */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Yield Structure</h2>
        </div>
        
        <div style={{ display: "grid", gap: "24px" }}>
          <ScatterPlot
            title="APY vs Momentum (Top 50 by TVL)"
            xLabel="Momentum (7d - 30d APY)"
            yLabel="APY 30d"
            points={scatterPoints}
            xFormatter={(v) => formatPct(v, 1)}
            yFormatter={(v) => formatPct(v, 1)}
          />
          
          <Ridgeline
            title="APY Distribution by Chain"
            series={chainRidgelineSeries}
          />
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <BarList
              title="APY Buckets"
              items={[
                { id: "high", label: "15%+", value: summary?.apy_high_vaults },
                { id: "mid", label: "5-15%", value: summary?.apy_mid_vaults },
                { id: "low", label: "<5%", value: summary?.apy_low_vaults },
              ]}
              valueFormatter={(v) => (v == null ? "n/a" : String(v))}
            />
            
            <HeatGrid
              title="Risk Mix"
              items={(data?.risk_mix ?? []).map((r: { risk_level: string; vaults: number; tvl_usd: number | null }) => ({
                id: r.risk_level,
                label: riskLabel(r.risk_level),
                value: r.vaults,
                note: formatUsd(r.tvl_usd),
              }))}
              valueFormatter={(v) => String(v ?? "n/a")}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <DiscoverPageContent />
    </Suspense>
  );
}
