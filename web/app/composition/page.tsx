"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatPct, formatUsd } from "../lib/format";
import { useCompositionData } from "../hooks/use-composition-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { HeatGrid } from "../components/visuals";
import type { UniverseKind } from "../lib/universe";

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
    router.push(`${pathname}?${params.toString()}`);
  };

  const { data, isLoading } = useCompositionData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const composition = data?.categories ?? [];
  const chains = data?.chains ?? [];
  const tokens = data?.tokens ?? [];

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Composition.
          <br />
          <em className="page-title-accent">Allocation. Mix.</em>
        </h1>
        <p className="page-description">
          Check chain, category, and token concentration before sizing risk in the filtered universe.
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
              <div className="kpi-value">{formatUsd(data?.summary?.total_tvl_usd)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Vaults</div>
              <div className="kpi-value">{data?.summary?.vaults ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg APY</div>
              <div className="kpi-value">{formatPct(data?.summary?.avg_safe_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Categories</div>
              <div className="kpi-value">{data?.categories?.length ?? "n/a"}</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Composition by Category</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "48px" }}>
          <HeatGrid
            title="Categories"
            items={composition.map((row: any) => ({
              id: row.category,
              label: row.category || "Unknown",
              value: row.vaults,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => String(v ?? "n/a")}
          />
          <HeatGrid
            title="Chains"
            items={chains.slice(0, 6).map((row: any) => ({
              id: String(row.chain_id),
              label: `Chain ${row.chain_id}`,
              value: row.vaults,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => String(v ?? "n/a")}
          />
        </div>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: "right" }}>Vaults</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Share</th>
                <th style={{ textAlign: "right" }}>Weighted APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : composition.map((row: any) => (
                <tr key={row.category}>
                  <td>{row.category || "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
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
