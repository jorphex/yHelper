"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useChainsData } from "../hooks/use-chains-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { HeatGrid, BarList } from "../components/visuals";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, replaceQuery } from "../lib/url";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

type ChainSortKey = "chain" | "vaults" | "with_metrics" | "tvl" | "apy" | "momentum" | "consistency";

function ChainsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sort, setSort] = useState<SortState<ChainSortKey>>({ key: "tvl", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      sortKey: queryChoice<ChainSortKey>(searchParams, "sort", ["chain", "vaults", "with_metrics", "tvl", "apy", "momentum", "consistency"] as const, "tvl"),
      sortDir: queryChoice(searchParams, "dir", ["asc", "desc"] as const, "desc"),
    };
  }, [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const { data, isLoading } = useChainsData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const sortedChains = sortRows(data?.rows ?? [], sort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.active_vaults,
    with_metrics: (row) => row.with_metrics,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.avg_momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.avg_consistency ?? Number.NEGATIVE_INFINITY,
  });

  const summary = data?.summary;

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Chains.
          <br />
          <em className="page-title-accent">Network view.</em>
        </h1>
        <p className="page-description">
          Compare chain scale, weighted yield, and coverage quality from the same filtered universe.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value, min_tvl: null })}
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
          </div>
        </div>
      </section>

      {/* KPI Grid with new metrics */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">With Metrics</div>
              <div className="kpi-value">{summary?.with_metrics ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Coverage Ratio</div>
              <div className="kpi-value">{formatPct(summary?.metrics_coverage_ratio)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Median Chain APY</div>
              <div className="kpi-value">{formatPct(summary?.median_chain_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Top Chain Share</div>
              <div className="kpi-value">{formatPct(summary?.top_chain_tvl_share)}</div>
              <div className="kpi-hint">{chainLabel(summary?.top_chain_id ?? 0)}</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Chain Comparison</h2>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "24px", marginBottom: "48px" }}>
          <HeatGrid
            title="By Chain"
            items={sortedChains.slice(0, 6).map((row) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.active_vaults,
              note: formatUsd(row.total_tvl_usd),
            }))}
            valueFormatter={(v) => String(v ?? "n/a")}
          />
          
          <BarList
            title="TVL Distribution"
            items={sortedChains.map((row) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.total_tvl_usd,
            }))}
            valueFormatter={(v) => formatUsd(v)}
          />
        </div>
        
        {/* Sortable Chain Rollup Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "chain"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Chain {sortIndicator(sort, "chain")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "vaults"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Vaults {sortIndicator(sort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "with_metrics"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    With Metrics {sortIndicator(sort, "with_metrics")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "tvl"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    TVL {sortIndicator(sort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "apy"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Weighted APY {sortIndicator(sort, "apy")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "momentum"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Avg Momentum {sortIndicator(sort, "momentum")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button 
                    className="th-button" 
                    onClick={() => { const next = toggleSort(sort, "consistency"); setSort(next); updateQuery({ sort: next.key, dir: next.direction }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Avg Consistency {sortIndicator(sort, "consistency")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={7} />
              ) : sortedChains.map((row) => (
                <tr key={row.chain_id}>
                  <td>
                    <Link href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.active_vaults ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.with_metrics ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.total_tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.avg_momentum_7d_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.avg_consistency?.toFixed(2) ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ChainsPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <ChainsPageContent />
    </Suspense>
  );
}
