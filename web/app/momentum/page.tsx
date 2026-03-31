"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatHours, formatPct, formatUsd } from "../lib/format";
import { useChangesData } from "../hooks/use-changes-data";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, ScatterPlot, ShareMeter, TrendStrips } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type TabKey = "changes" | "regimes";
type WindowKey = "24h" | "7d" | "30d";
type MoverSortKey = "vault" | "chain" | "tvl" | "delta" | "age";

function MomentumPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("changes");
  const [moverSort, setMoverSort] = useState<SortState<MoverSortKey>>({ key: "delta", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      window: queryChoice<WindowKey>(searchParams, "window", ["24h", "7d", "30d"] as const, "7d"),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      tab: (searchParams.get("tab") || "changes") as TabKey,
    };
  }, [searchParams]);

  useMemo(() => {
    if (query.tab && ["changes", "regimes"].includes(query.tab)) {
      setActiveTab(query.tab);
    }
  }, [query.tab]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    updateQuery({ tab });
  };

  const { data, isLoading, error, refetch } = useChangesData({
    universe: query.universe,
    minTvl: query.minTvl,
    window: query.window,
    staleThreshold: "auto",
  });

  const summary = data?.summary;
  const eligibleVaults = summary?.vaults_eligible ?? 0;
  const comparedVaults = data?.freshness?.window_tracked_vaults ?? summary?.vaults_with_change ?? 0;
  const staleVaults = data?.freshness?.window_stale_vaults ?? summary?.stale_vaults ?? 0;
  const freshComparedVaults = Math.max(0, comparedVaults - staleVaults);

  const filteredTvl = summary?.total_tvl_usd;
  const trackedTvl = summary?.tracked_tvl_usd;

  const vaultCoverageSegments = [
    { id: "fresh", label: "Fresh", value: freshComparedVaults, tone: "positive" as const },
    { id: "stale", label: "Stale", value: staleVaults, tone: "warning" as const },
    { id: "missing", label: "Missing", value: Math.max(0, eligibleVaults - comparedVaults), tone: "muted" as const },
  ];

  const tvlCoverageSegments = [
    { id: "fresh", label: "Fresh TVL", value: trackedTvl ?? 0, tone: "positive" as const },
    { id: "stale", label: "Stale TVL", value: (filteredTvl ?? 0) - (trackedTvl ?? 0), tone: "warning" as const },
  ];

  const moverRows = sortRows(data?.movers?.risers ?? [], moverSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    delta: (row) => row.delta_apy ?? Number.NEGATIVE_INFINITY,
    age: (row) => row.age_seconds ?? Number.NEGATIVE_INFINITY,
  });

  if (error && !data) {
    return (
      <div className="card" style={{ padding: "48px" }}>
        <h2>Changes data is temporarily unavailable</h2>
        <p>The change feed failed to load. Please try again later.</p>
        <button onClick={() => refetch()} className="button button-primary" style={{ marginTop: "16px" }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Momentum
          <br />
          <em className="page-title-accent">Recent shifts</em>
        </h1>
        <p className="page-description">
          Track APY changes with freshness metrics and trend direction.
        </p>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "16px" }}>
          <button
            onClick={() => setTab("changes")}
            className={`button ${activeTab === "changes" ? "button-primary" : "button-ghost"}`}
          >
            Changes
          </button>
          <button
            onClick={() => setTab("regimes")}
            className={`button ${activeTab === "regimes" ? "button-primary" : "button-ghost"}`}
          >
            Regimes
          </button>
        </div>
      </section>

      {/* Shared Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Window</span>
              <select
                value={query.window}
                onChange={(e) => updateQuery({ window: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value })}
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

      {/* CHANGES TAB */}
      {activeTab === "changes" && (
        <>
          {/* KPIs */}
          <section className="section" style={{ marginBottom: "48px" }}>
            {isLoading ? (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
              </div>
            ) : (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div className="kpi-card">
                  <div className="kpi-label">Avg Delta</div>
                  <div className="kpi-value" style={{ color: (summary?.avg_delta ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {formatPct(summary?.avg_delta)}
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">With Change</div>
                  <div className="kpi-value">{summary?.vaults_with_change ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Fresh PPS Age</div>
                  <div className="kpi-value">{formatHours(data?.freshness?.latest_pps_age_seconds)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Window Stale</div>
                  <div className="kpi-value">{formatPct(data?.freshness?.window_stale_ratio)}</div>
                </div>
              </div>
            )}
          </section>

          {/* Coverage */}
          <section className="section" style={{ marginBottom: "48px" }}>
            <div className="card-header">
              <h2 className="card-title">Window Coverage</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              <ShareMeter
                title="By Vaults"
                segments={vaultCoverageSegments}
                total={eligibleVaults}
                valueFormatter={(value) => (value === null || value === undefined ? "n/a" : Number(value).toLocaleString())}
                legend="Eligible vaults split by comparison freshness"
              />
              <ShareMeter
                title="By TVL"
                segments={tvlCoverageSegments}
                total={filteredTvl ?? 0}
                valueFormatter={(value) => formatUsd(value)}
                legend="Filtered TVL split by freshness"
              />
            </div>
          </section>

          {/* Movers */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Top Risers</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th>Chain</th>
                    <th style={{ textAlign: "right" }}>TVL</th>
                    <th style={{ textAlign: "right" }}>Current</th>
                    <th style={{ textAlign: "right" }}>Previous</th>
                    <th style={{ textAlign: "right" }}>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <TableSkeleton rows={5} columns={6} />
                  ) : (
                    moverRows.slice(0, 10).map((row) => (
                      <tr key={row.vault_address}>
                        <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                        <td>{chainLabel(row.chain_id)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_window)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_prev_window)}</td>
                        <td style={{ textAlign: "right", color: (row.delta_apy ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }} className="data-value">
                          {formatPct(row.delta_apy)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* REGIMES TAB - Placeholder for regime content */}
      {activeTab === "regimes" && (
        <section className="section">
          <div className="card" style={{ padding: "48px", textAlign: "center" }}>
            <h2 className="card-title" style={{ marginBottom: "16px" }}>Regimes</h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Regime analysis content will be integrated here.
            </p>
            <p style={{ color: "var(--text-tertiary)", marginTop: "8px", fontSize: "14px" }}>
              This includes regime distribution, transitions, and flow visualizations.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

export default function MomentumPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <MomentumPageContent />
    </Suspense>
  );
}
