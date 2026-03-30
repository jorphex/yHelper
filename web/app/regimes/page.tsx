"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatPct, formatUsd } from "../lib/format";
import { useRegimesData } from "../hooks/use-regimes-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { HeatGrid } from "../components/visuals";
import type { UniverseKind } from "../lib/universe";

function RegimesPageContent() {
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

  const { data, isLoading } = useRegimesData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: 45,
  });

  const regimes = data?.summary ?? [];
  const movers = data?.movers ?? [];
  const currentRegime = regimes[0]?.regime ?? "n/a";

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Regimes.
          <br />
          <em className="page-title-accent">States. Behavior.</em>
        </h1>
        <p className="page-description">
          Follow rising, stable, falling, and choppy states. Understand recent yield behavior 
          and how cohorts are transitioning.
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
              <div className="kpi-label">Current Regime</div>
              <div className="kpi-value" style={{ textTransform: "capitalize" }}>
                {currentRegime}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rising</div>
              <div className="kpi-value" style={{ color: "var(--positive)" }}>
                {regimes.find((r: any) => r.regime === "rising")?.vaults ?? "n/a"}
              </div>
              <div className="kpi-hint">Vaults improving</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Stable</div>
              <div className="kpi-value">
                {regimes.find((r: any) => r.regime === "stable")?.vaults ?? "n/a"}
              </div>
              <div className="kpi-hint">Holding steady</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Falling</div>
              <div className="kpi-value" style={{ color: "var(--negative)" }}>
                {regimes.find((r: any) => r.regime === "falling")?.vaults ?? "n/a"}
              </div>
              <div className="kpi-hint">Vaults declining</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Regime Distribution</h2>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "24px", marginBottom: "48px" }}>
          <HeatGrid
            title="By Regime"
            items={regimes.map((row: any) => ({
              id: row.regime,
              label: row.regime.charAt(0).toUpperCase() + row.regime.slice(1),
              value: row.vaults,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => String(v ?? "n/a")}
          />
          
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Regime</th>
                  <th style={{ textAlign: "right" }}>Vaults</th>
                  <th style={{ textAlign: "right" }}>TVL</th>
                  <th style={{ textAlign: "right" }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton rows={4} columns={4} />
                ) : regimes.map((row: any) => (
                  <tr key={row.regime}>
                    <td style={{ textTransform: "capitalize" }}>{row.regime || "n/a"}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{row.vaults ?? "n/a"}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">-</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card-header">
          <h2 className="card-title">Recent Movers</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th style={{ textAlign: "center" }}>Regime</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={4} />
              ) : movers.slice(0, 10).map((row: any) => (
                <tr key={row.vault_address}>
                  <td>{row.symbol || row.vault_address.slice(0, 8)}</td>
                  <td style={{ textAlign: "center" }}>{row.regime}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function RegimesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <RegimesPageContent />
    </Suspense>
  );
}
