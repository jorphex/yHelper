"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatHours, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { useChangesData } from "../hooks/use-changes-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { VaultLink } from "../components/vault-link";
import { ScatterPlot } from "../components/visuals";
import type { UniverseKind } from "../lib/universe";

function formatDelta(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const pct = value * 100;
  const prefix = pct >= 0 ? "+" : "";
  return `${prefix}${pct.toFixed(2)}%`;
}

function ChangesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 100000),
    windowDays: Number(searchParams.get("window_days") || 7) <= 1 ? 1 : Number(searchParams.get("window_days") || 7) <= 7 ? 7 : 30,
  }), [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, String(value));
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  const windowKey = query.windowDays <= 1 ? "24h" : query.windowDays <= 7 ? "7d" : "30d";

  const { data, isLoading } = useChangesData({
    universe: query.universe,
    minTvl: query.minTvl,
    window: windowKey,
    staleThreshold: "auto",
  });

  const movers = data?.movers?.largest_abs_delta ?? [];
  const summary = data?.summary;

  const scatterPoints = useMemo(() => movers.slice(0, 50).map((row: any) => ({
    id: row.vault_address,
    x: row.delta_apy ?? 0,
    y: row.safe_apy_window ?? 0,
    size: row.tvl_usd ?? 0,
    tone: (row.delta_apy ?? 0) >= 0 ? "positive" as const : "negative" as const,
    href: yearnVaultUrl(row.chain_id, row.vault_address),
    tooltip: `${row.symbol || row.vault_address}\nAPY: ${formatPct(row.safe_apy_window)}\nDelta: ${formatDelta(row.delta_apy)}`,
  })), [movers]);

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Changes.
          <br />
          <em className="page-title-accent">Recent shifts.</em>
        </h1>
        <p className="page-description">
          APY movers over a configurable window. Spot which vaults are rising, falling, 
          and how concentrated the changes are.
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
                onChange={(e) => updateQuery({ universe: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="core">Core</option>
                <option value="extended">Extended</option>
                <option value="raw">Raw</option>
              </select>
            </label>

            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Window</span>
              <select
                value={query.windowDays}
                onChange={(e) => updateQuery({ window_days: Number(e.target.value) })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
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
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Changes</span>
              <div style={{ marginTop: "12px", fontSize: "14px", color: "var(--text-secondary)" }}>
                {isLoading ? "Loading..." : `${summary?.vaults_with_change ?? 0} vaults with change`}
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Summary KPIs */}
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
                {formatDelta(summary?.avg_delta)}
              </div>
              <div className="kpi-hint">Across all vaults</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Vaults with Change</div>
              <div className="kpi-value">{summary?.vaults_with_change ?? "n/a"}</div>
              <div className="kpi-hint">Above threshold</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Risers</div>
              <div className="kpi-value" style={{ color: "var(--positive)" }}>
                {data?.movers?.risers?.length ?? 0}
              </div>
              <div className="kpi-hint">Improving APY</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Fallers</div>
              <div className="kpi-value" style={{ color: "var(--negative)" }}>
                {data?.movers?.fallers?.length ?? 0}
              </div>
              <div className="kpi-hint">Declining APY</div>
            </div>
          </div>
        )}
      </section>

      {/* Movers Table */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Top Movers</h2>
          <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            By absolute delta
          </span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th style={{ textAlign: "center" }}>Chain</th>
                <th style={{ textAlign: "center" }}>Token</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Previous</th>
                <th style={{ textAlign: "right" }}>Current</th>
                <th style={{ textAlign: "right" }}>Delta</th>
                <th style={{ textAlign: "right" }}>Age</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={8} />
              ) : movers.slice(0, 20).map((row: any) => (
                <tr key={row.vault_address}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td style={{ textAlign: "center" }}>{chainLabel(row.chain_id)}</td>
                  <td style={{ textAlign: "center" }}>{row.token_symbol || "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_prev_window)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_window)}</td>
                  <td style={{ textAlign: "right", color: (row.delta_apy ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }} className="data-value">
                    {formatDelta(row.delta_apy)}
                  </td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatHours(row.age_seconds, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Visualizations */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Trend Analysis</h2>
        </div>

        <div style={{ display: "grid", gap: "24px" }}>
          <ScatterPlot
            title="Delta vs Current APY"
            xLabel="Delta (vs window start)"
            yLabel="Current APY"
            points={scatterPoints}
            xFormatter={(v) => formatDelta(v)}
            yFormatter={(v) => formatPct(v)}
          />
        </div>
      </section>
    </div>
  );
}

export default function ChangesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <ChangesPageContent />
    </Suspense>
  );
}
