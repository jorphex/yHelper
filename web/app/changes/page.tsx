"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { useChangesData } from "../hooks/use-changes-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { VaultLink } from "../components/vault-link";
import { ScatterPlot, BarList } from "../components/visuals";
import { UniverseKind, universeDefaults, UNIVERSE_VALUES } from "../lib/universe";

type ChangeRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  tvl_usd: number | null;
  safe_apy_window: number | null;
  safe_apy_prev_window: number | null;
  delta_apy: number | null;
};

type WindowKey = "24h" | "7d" | "30d";

function ChangesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => {
    const universe = (searchParams.get("universe") || "core") as UniverseKind;
    const defaults = universeDefaults(universe);
    return {
      universe,
      window: (searchParams.get("window") || "7d") as WindowKey,
      minTvl: Number(searchParams.get("min_tvl") || defaults.minTvl),
      minPoints: Number(searchParams.get("min_points") || defaults.minPoints),
    };
  }, [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined) params.delete(key);
      else params.set(key, String(value));
    });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const { data, isLoading } = useChangesData({
    universe: query.universe,
    minTvl: query.minTvl,
    window: query.window,
    staleThreshold: "auto",
  });

  const summary = data?.summary;
  const risers = data?.movers?.risers ?? [];
  const fallers = data?.movers?.fallers ?? [];
  const largest = data?.movers?.largest_abs_delta ?? [];

  const scatterPoints = useMemo(() => {
    return largest.slice(0, 50).map((row: ChangeRow) => ({
      id: `${row.chain_id}:${row.vault_address}`,
      x: row.delta_apy ?? 0,
      y: row.safe_apy_window ?? 0,
      size: row.tvl_usd ?? 0,
      href: yearnVaultUrl(row.chain_id, row.vault_address),
      tone: (row.delta_apy ?? 0) >= 0 ? "positive" as const : "negative" as const,
    }));
  }, [largest]);

  const deltaBands = useMemo(() => {
    const bands = [
      { id: "gt5", label: "+5%+", min: 0.05, max: Infinity },
      { id: "gt1", label: "+1% to +5%", min: 0.01, max: 0.05 },
      { id: "mid", label: "-1% to +1%", min: -0.01, max: 0.01 },
      { id: "lt1", label: "-5% to -1%", min: -0.05, max: -0.01 },
      { id: "lt5", label: "-5%+", min: -Infinity, max: -0.05 },
    ];
    return bands.map((band) => ({
      id: band.id,
      label: band.label,
      value: largest.filter((r: ChangeRow) => {
        const d = r.delta_apy ?? 0;
        return d >= band.min && d < band.max;
      }).length,
    }));
  }, [largest]);

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Changes.
          <br />
          <em className="page-title-accent">Recent shifts.</em>
        </h1>
        <p className="page-description">
          APY movers over a configurable window. Spot which vaults are rising, falling, and how concentrated the changes are.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Window</span>
              <select
                value={query.window}
                onChange={(e) => updateQuery({ window: e.target.value as WindowKey })}
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
                  <option key={v} value={v}>{v}</option>
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
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Delta</span>
              <div style={{ marginTop: "12px", fontSize: "14px", color: "var(--text-secondary)" }}>
                {isLoading ? "Loading..." : formatPct(summary?.avg_delta)}
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Summary */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {Array(4).fill(null).map((_, i) => (
              <KpiGridSkeleton key={i} count={1} />
            ))}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Eligible</div>
              <div className="kpi-value">{summary?.vaults_eligible ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">With Change</div>
              <div className="kpi-value">{summary?.vaults_with_change ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Risers</div>
              <div className="kpi-value" style={{ color: "var(--positive)" }}>{risers.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Fallers</div>
              <div className="kpi-value" style={{ color: "var(--negative)" }}>{fallers.length}</div>
            </div>
          </div>
        )}
      </section>

      {/* Movers Tables */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Top Risers</h2>
        </div>
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Chain</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Previous</th>
                <th style={{ textAlign: "right" }}>Current</th>
                <th style={{ textAlign: "right" }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={6} />
              ) : (
                risers.slice(0, 10).map((row: ChangeRow) => (
                  <tr key={row.vault_address}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                    <td>{chainLabel(row.chain_id)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_prev_window)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_window)}</td>
                    <td style={{ textAlign: "right", color: "var(--positive)" }} className="data-value">+{formatPct(row.delta_apy)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card-header">
          <h2 className="card-title">Top Fallers</h2>
        </div>
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Chain</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Previous</th>
                <th style={{ textAlign: "right" }}>Current</th>
                <th style={{ textAlign: "right" }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={6} />
              ) : (
                fallers.slice(0, 10).map((row: ChangeRow) => (
                  <tr key={row.vault_address}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                    <td>{chainLabel(row.chain_id)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_prev_window)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_window)}</td>
                    <td style={{ textAlign: "right", color: "var(--negative)" }} className="data-value">{formatPct(row.delta_apy)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Visualizations */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Delta Analysis</h2>
        </div>
        <div style={{ display: "grid", gap: "24px" }}>
          <ScatterPlot
            title="Delta vs Current APY"
            xLabel="Delta"
            yLabel="Current APY"
            points={scatterPoints}
            xFormatter={(v) => formatPct(v, 1)}
            yFormatter={(v) => formatPct(v, 1)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <BarList
              title="Delta Distribution"
              items={deltaBands}
              valueFormatter={(v) => String(v ?? 0)}
            />
            <div className="card" style={{ padding: "24px" }}>
              <h3 style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Summary</h3>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Delta shows the change in APY from the previous period to the current period. 
                Positive values indicate rising yields, negative values indicate falling yields.
              </p>
            </div>
          </div>
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
