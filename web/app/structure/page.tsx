"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { useCompositionData } from "../hooks/use-composition-data";
import { useChainsData } from "../hooks/use-chains-data";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, ScatterPlot } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type TabKey = "overview" | "chains" | "crowding";
type ChainSortKey = "chain" | "vaults" | "tvl" | "share" | "apy";
type CrowdingSortKey = "vault" | "chain" | "tvl" | "apy" | "crowding";

function StructurePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [chainSort, setChainSort] = useState<SortState<ChainSortKey>>({ key: "tvl", direction: "desc" });
  const [crowdingSort, setCrowdingSort] = useState<SortState<CrowdingSortKey>>({ key: "crowding", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      tab: (searchParams.get("tab") || "overview") as TabKey,
    };
  }, [searchParams]);

  useMemo(() => {
    if (query.tab && ["overview", "chains", "crowding"].includes(query.tab)) {
      setActiveTab(query.tab);
    }
  }, [query.tab]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    updateQuery({ tab });
  };

  // Composition data
  const { data: compData, isLoading: isLoadingComp } = useCompositionData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  // Chains data
  const { data: chainsData, isLoading: isLoadingChains } = useChainsData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const chainRows = sortRows(compData?.chains ?? [], chainSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    share: (row) => row.share_tvl ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });

  const crowdedRows = sortRows(compData?.crowding.most_crowded ?? [], crowdingSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    crowding: (row) => row.crowding_index ?? Number.NEGATIVE_INFINITY,
  });

  const isLoading = isLoadingComp || isLoadingChains;

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Structure
          <br />
          <em className="page-title-accent">Concentration lens</em>
        </h1>
        <p className="page-description">
          Map where TVL concentrates and which vaults are crowded.
        </p>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "16px" }}>
          <button
            onClick={() => setTab("overview")}
            className={`button ${activeTab === "overview" ? "button-primary" : "button-ghost"}`}
          >
            Overview
          </button>
          <button
            onClick={() => setTab("chains")}
            className={`button ${activeTab === "chains" ? "button-primary" : "button-ghost"}`}
          >
            Chains
          </button>
          <button
            onClick={() => setTab("crowding")}
            className={`button ${activeTab === "crowding" ? "button-primary" : "button-ghost"}`}
          >
            Crowding
          </button>
        </div>
      </section>

      {/* Shared Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
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
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min TVL (USD)</span>
              <input
                type="number"
                min={0}
                value={query.minTvl}
                onChange={(e) => updateQuery({ min_tvl: Number(e.target.value || 0) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <>
          {/* KPIs */}
          <section className="section" style={{ marginBottom: "48px" }}>
            {isLoading ? (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                {Array(5).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
              </div>
            ) : (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                <div className="kpi-card">
                  <div className="kpi-label">Vaults</div>
                  <div className="kpi-value">{compData?.summary.vaults ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Average APY 30d</div>
                  <div className="kpi-value">{formatPct(compData?.summary.avg_safe_apy_30d)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Chain HHI</div>
                  <div className="kpi-value">{compData?.concentration.chain_hhi?.toFixed(3) ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Category HHI</div>
                  <div className="kpi-value">{compData?.concentration.category_hhi?.toFixed(3) ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Token HHI</div>
                  <div className="kpi-value">{compData?.concentration.token_hhi?.toFixed(3) ?? "n/a"}</div>
                </div>
              </div>
            )}
          </section>

          {/* Category Table */}
          <section className="section" style={{ marginBottom: "48px" }}>
            <div className="card-header">
              <h2 className="card-title">Category Concentration</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>Vaults</th>
                    <th style={{ textAlign: "right" }}>TVL</th>
                    <th style={{ textAlign: "right" }}>Share</th>
                    <th style={{ textAlign: "right" }}>APY</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <TableSkeleton rows={5} columns={5} />
                  ) : (
                    compData?.categories?.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category || "Unknown"}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Top Tokens */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Top Tokens by TVL</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th style={{ textAlign: "center" }}>Vaults</th>
                    <th style={{ textAlign: "right" }}>TVL</th>
                    <th style={{ textAlign: "right" }}>Share</th>
                    <th style={{ textAlign: "right" }}>APY</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <TableSkeleton rows={5} columns={5} />
                  ) : (
                    compData?.tokens?.slice(0, 12).map((row) => (
                      <tr key={row.token_symbol}>
                        <td>{row.token_symbol || "Unknown"}</td>
                        <td style={{ textAlign: "center" }}>{row.vaults}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* CHAINS TAB */}
      {activeTab === "chains" && (
        <>
          <section className="section" style={{ marginBottom: "48px" }}>
            {isLoading ? (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {Array(3).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
              </div>
            ) : (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                <div className="kpi-card">
                  <div className="kpi-label">With Metrics</div>
                  <div className="kpi-value">{chainsData?.summary?.with_metrics ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Coverage Ratio</div>
                  <div className="kpi-value">{formatPct(chainsData?.summary?.metrics_coverage_ratio)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Median Chain APY</div>
                  <div className="kpi-value">{formatPct(chainsData?.summary?.median_chain_apy_30d)}</div>
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
                items={chainsData?.rows?.slice(0, 6).map((row) => ({
                  id: String(row.chain_id),
                  label: chainLabel(row.chain_id),
                  value: row.active_vaults,
                  note: formatUsd(row.total_tvl_usd),
                })) ?? []}
                valueFormatter={(v) => String(v ?? "n/a")}
              />
              <BarList
                title="TVL Distribution"
                items={chainsData?.rows?.map((row) => ({
                  id: String(row.chain_id),
                  label: chainLabel(row.chain_id),
                  value: row.total_tvl_usd,
                })) ?? []}
                valueFormatter={(v) => formatUsd(v)}
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <button className="th-button" onClick={() => { const next = toggleSort(chainSort, "chain"); setChainSort(next); }}>
                        Chain {sortIndicator(chainSort, "chain")}
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>Vaults</th>
                    <th style={{ textAlign: "right" }}>TVL</th>
                    <th style={{ textAlign: "right" }}>Share</th>
                    <th style={{ textAlign: "right" }}>APY</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <TableSkeleton rows={5} columns={5} />
                  ) : (
                    chainRows.map((row) => (
                      <tr key={row.chain_id}>
                        <td>{chainLabel(row.chain_id)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* CROWDING TAB */}
      {activeTab === "crowding" && (
        <>
          <section className="section" style={{ marginBottom: "48px" }}>
            <div className="card-header">
              <h2 className="card-title">APY vs TVL Map</h2>
            </div>
            <ScatterPlot
              title=""
              xLabel="APY 30d"
              yLabel="TVL (USD)"
              points={(compData?.crowding.most_crowded ?? []).slice(0, 50).map((row) => ({
                id: `${row.chain_id}:${row.vault_address}`,
                x: row.safe_apy_30d,
                y: row.tvl_usd,
                size: row.crowding_index,
                href: yearnVaultUrl(row.chain_id, row.vault_address),
                tone: (row.crowding_index ?? 0) >= 0 ? "negative" : "positive",
              }))}
              xFormatter={(value) => formatPct(value, 1)}
              yFormatter={(value) => formatUsd(value)}
            />
          </section>

          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Most Crowded</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th>Chain</th>
                    <th style={{ textAlign: "right" }}>TVL</th>
                    <th style={{ textAlign: "right" }}>APY</th>
                    <th style={{ textAlign: "right" }}>Crowding</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <TableSkeleton rows={5} columns={5} />
                  ) : (
                    crowdedRows.slice(0, 15).map((row) => (
                      <tr key={row.vault_address}>
                        <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                        <td>{chainLabel(row.chain_id)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                        <td style={{ textAlign: "right" }} className="data-value">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
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
