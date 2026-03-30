"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useChainsData } from "../hooks/use-chains-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { HeatGrid, BarList } from "../components/visuals";
import type { UniverseKind } from "../lib/universe";

function ChainsPageContent() {
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

  const { data, isLoading } = useChainsData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const chains = data?.rows ?? [];
  const summary = {
    total_tvl_usd: data?.rows?.reduce((sum, r) => sum + (r.total_tvl_usd || 0), 0) || null,
    chains: data?.rows?.length ?? 0,
    top_chain_id: data?.rows?.[0]?.chain_id ?? null,
  };

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

      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Total TVL</div>
              <div className="kpi-value">{formatUsd(summary?.total_tvl_usd)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chains</div>
              <div className="kpi-value">{summary?.chains ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Top Chain</div>
              <div className="kpi-value" style={{ fontSize: "20px" }}>
                {chainLabel(summary?.top_chain_id)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total Vaults</div>
              <div className="kpi-value">{chains?.reduce((sum, r) => sum + (r.active_vaults || 0), 0) ?? "n/a"}</div>
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
            items={chains.slice(0, 6).map((row) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.active_vaults,
              note: formatUsd(row.total_tvl_usd),
            }))}
            valueFormatter={(v) => String(v ?? "n/a")}
          />
          
          <BarList
            title="TVL Distribution"
            items={chains.map((row) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.total_tvl_usd,
            }))}
            valueFormatter={(v) => formatUsd(v)}
          />
        </div>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chain</th>
                <th style={{ textAlign: "right" }}>Vaults</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Weighted APY</th>
                <th style={{ textAlign: "right" }}>Median APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : chains.map((row) => (
                <tr key={row.chain_id}>
                  <td>{chainLabel(row.chain_id)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.active_vaults ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.total_tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">-</td>
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
