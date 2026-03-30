"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useCompositionData } from "../hooks/use-composition-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { HeatGrid } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, UNIVERSE_VALUES } from "../lib/universe";

type BreakdownRow = {
  chain_id?: number;
  category?: string;
  token_symbol?: string;
  vaults: number;
  tvl_usd: number | null;
  share_tvl?: number | null;
  weighted_safe_apy_30d?: number | null;
};

type CrowdingRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  crowding_index: number | null;
};

function CompositionPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
  }), [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, String(value));
    });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const { data, isLoading } = useCompositionData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const summary = data?.summary;
  const concentration = data?.concentration;
  const chains = data?.chains ?? [];
  const categories = data?.categories ?? [];
  const tokens = data?.tokens ?? [];
  const mostCrowded = data?.crowding?.most_crowded ?? [];
  const leastCrowded = data?.crowding?.least_crowded ?? [];

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Composition.
          <br />
          <em className="page-title-accent">Concentration lens.</em>
        </h1>
        <p className="page-description">
          Map where TVL concentrates and which vaults are crowded or under-densed.
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
                onChange={(e) => updateQuery({ universe: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="core">Core</option>
                <option value="extended">Extended</option>
                <option value="raw">Raw</option>
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

      {/* Summary */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {Array(5).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Vaults</div>
              <div className="kpi-value">{summary?.vaults ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total TVL</div>
              <div className="kpi-value">{formatUsd(summary?.total_tvl_usd)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chain HHI</div>
              <div className="kpi-value">{concentration?.chain_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Category HHI</div>
              <div className="kpi-value">{concentration?.category_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Token HHI</div>
              <div className="kpi-value">{concentration?.token_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
          </div>
        )}
      </section>

      {/* Concentration Heatmaps */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Concentration Heatmaps</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px", marginBottom: "48px" }}>
          <HeatGrid
            title="By Chain"
            items={chains.slice(0, 6).map((row: BreakdownRow) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.share_tvl,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => formatPct(v, 1)}
          />
          <HeatGrid
            title="By Category"
            items={categories.slice(0, 6).map((row: BreakdownRow) => ({
              id: row.category || "unknown",
              label: row.category || "Unknown",
              value: row.share_tvl,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => formatPct(v, 1)}
          />
          <HeatGrid
            title="By Token"
            items={tokens.slice(0, 6).map((row: BreakdownRow) => ({
              id: row.token_symbol || "unknown",
              label: row.token_symbol || "Unknown",
              value: row.share_tvl,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => formatPct(v, 1)}
          />
        </div>

        {/* Chain Table */}
        <div className="card-header">
          <h2 className="card-title">Chain Concentration</h2>
        </div>
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>Chain</th>
                <th style={{ textAlign: "right" }}>Vaults</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>TVL Share</th>
                <th style={{ textAlign: "right" }}>Weighted APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : (
                chains.map((row: BreakdownRow) => (
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

        {/* Crowding Tables */}
        <div className="card-header">
          <h2 className="card-title">Most Crowded</h2>
        </div>
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
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
                mostCrowded.slice(0, 10).map((row: CrowdingRow) => (
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

        <div className="card-header">
          <h2 className="card-title">Least Crowded</h2>
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
                leastCrowded.slice(0, 10).map((row: CrowdingRow) => (
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
    </div>
  );
}

export default function CompositionPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <CompositionPageContent />
    </Suspense>
  );
}
