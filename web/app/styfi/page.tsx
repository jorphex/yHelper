"use client";

import Image from "next/image";
import { Suspense, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api";
import { formatHours, formatPct, formatUtcDateTime } from "../lib/format";
import { BarList, TrendStrips } from "../components/visuals";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type StYfiSnapshotPoint = {
  observed_at?: string | null;
  reward_epoch?: number | null;
  styfi_staked?: number | null;
  styfix_staked?: number | null;
  combined_staked?: number | null;
  staked_share_supply?: number | null;
};

type StYfiEpochPoint = {
  epoch?: number | null;
  epoch_start?: string | null;
  reward_total?: number | null;
  reward_styfi?: number | null;
  reward_styfix?: number | null;
  reward_veyfi?: number | null;
  reward_liquid_lockers?: number | null;
};

type StYfiResponse = {
  summary?: {
    reward_epoch?: number | null;
    yfi_total_supply?: number | null;
    styfi_staked?: number | null;
    styfix_staked?: number | null;
    combined_staked?: number | null;
    staked_share_supply?: number | null;
    net_flow_24h?: number | null;
    net_flow_7d?: number | null;
    snapshots_count?: number | null;
    first_snapshot_at?: string | null;
    latest_snapshot_at?: string | null;
  };
  reward_token?: { symbol?: string | null };
  current_reward_state?: {
    epoch?: number | null;
    styfi_current_apr?: number | null;
    styfix_current_apr?: number | null;
    styfi_current_reward?: number | null;
    styfix_current_reward?: number | null;
  } | null;
  series?: {
    snapshots?: StYfiSnapshotPoint[];
    epochs?: StYfiEpochPoint[];
  };
  freshness?: {
    latest_snapshot_age_seconds?: number | null;
    latest_snapshot_at?: string | null;
    snapshots_count?: number | null;
  };
  data_policy?: {
    retention_days?: number | null;
    snapshot_retention_days?: number | null;
  };
};

function formatTokenCompact(value: number | null | undefined, symbol: string, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: digits }).format(value)} ${symbol}`;
}

function formatToken(value: number | null | undefined, symbol: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)} ${symbol}`;
}

function formatSignedToken(value: number | null | undefined, symbol: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatToken(value, symbol, digits)}`;
}

function percentShare(value: number | null | undefined, total: number | null | undefined): string {
  if (value === null || value === undefined || total === null || total === undefined) return "Share syncing";
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "Share syncing";
  return `${formatPct(value / total, 0)} of total`;
}

function formatRollingSpan(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "n/a";
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "n/a";
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 24) return `${diffHours.toFixed(1)}h`;
  return `${(diffHours / 24).toFixed(1)}d`;
}

function formatUtcDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" }).format(date);
}

function StYfiPageContent() {
  const [data, setData] = useState<StYfiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({ days: "122", epoch_limit: "12" });
        const res = await fetch(apiUrl("/styfi", params), { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const payload = await res.json() as StYfiResponse;
        if (active) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (active) setError(`Load failed: ${String(err)}`);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, []);

  const rewardSymbol = data?.reward_token?.symbol?.trim() || "yvUSDC-1";
  const summary = data?.summary ?? null;
  const epochSeries = useMemo<StYfiEpochPoint[]>(() => data?.series?.epochs ?? [], [data?.series?.epochs]);
  const snapshotSeries = useMemo<StYfiSnapshotPoint[]>(() => data?.series?.snapshots ?? [], [data?.series?.snapshots]);
  const currentEpoch = summary?.reward_epoch ?? null;
  const historySpan = formatRollingSpan(summary?.first_snapshot_at ?? null, summary?.latest_snapshot_at ?? null);
  const snapshotCountValue = summary?.snapshots_count ?? "n/a";
  const hasNetFlow24h = summary?.net_flow_24h !== null && summary?.net_flow_24h !== undefined && Number.isFinite(summary.net_flow_24h);
  const hasNetFlow7d = summary?.net_flow_7d !== null && summary?.net_flow_7d !== undefined && Number.isFinite(summary.net_flow_7d);

  const summaryItems = useMemo(() => {
    const items = [
      {
        label: "Combined Staked",
        value: formatTokenCompact(summary?.combined_staked ?? null, "YFI"),
        hint: "Total stYFI plus stYFIx balance.",
      },
      {
        label: "Share of Supply",
        value: formatPct(summary?.staked_share_supply ?? null, 2),
        hint: `${formatToken(summary?.yfi_total_supply ?? null, "YFI", 0)} total supply`,
      },
      {
        label: "Snapshot Freshness",
        value: formatHours(data?.freshness?.latest_snapshot_age_seconds ?? null, 1),
        hint: formatUtcDateTime(data?.freshness?.latest_snapshot_at ?? null),
      },
      hasNetFlow24h ? {
        label: "Net Flow 24h",
        value: formatSignedToken(summary?.net_flow_24h ?? null, "YFI"),
        hint: "Snapshot derived, not gross stake/unstake",
      } : {
        label: "History Warm-Up",
        value: `${snapshotCountValue} captures`,
        hint: "Protocol stake balances and reward epoch state.",
      },
      hasNetFlow7d ? {
        label: "Net Flow 7d",
        value: formatSignedToken(summary?.net_flow_7d ?? null, "YFI"),
        hint: "Compared with snapshot seven days back",
      } : {
        label: "Reward Token",
        value: rewardSymbol,
        hint: `History span ${historySpan}`,
      },
    ];
    return items;
  }, [summary, data?.freshness, rewardSymbol, hasNetFlow24h, hasNetFlow7d, historySpan, snapshotCountValue]);

  const stakeTrendItems = useMemo(() => [
    { id: "combined", label: "Total", points: snapshotSeries.map((r) => r.combined_staked), note: "Latest combined balance vs previous snapshot" },
    { id: "styfi", label: "stYFI", points: snapshotSeries.map((r) => r.styfi_staked), note: "Latest stYFI balance vs previous snapshot" },
    { id: "styfix", label: "stYFIx", points: snapshotSeries.map((r) => r.styfix_staked), note: "Latest stYFIx balance vs previous snapshot" },
  ], [snapshotSeries]);

  const rewardBars = useMemo(() => [
    { 
      id: "styfi", 
      label: "stYFI", 
      value: data?.current_reward_state?.styfi_current_reward ?? null,
      note: data?.current_reward_state?.styfi_current_apr 
        ? `${formatPct(data.current_reward_state.styfi_current_apr, 2)} APR • ${percentShare(data.current_reward_state.styfi_current_reward, (data.current_reward_state.styfi_current_reward ?? 0) + (data.current_reward_state.styfix_current_reward ?? 0))}`
        : percentShare(data?.current_reward_state?.styfi_current_reward ?? null, (data?.current_reward_state?.styfi_current_reward ?? 0) + (data?.current_reward_state?.styfix_current_reward ?? 0)),
    },
    { 
      id: "styfix", 
      label: "stYFIx", 
      value: data?.current_reward_state?.styfix_current_reward ?? null,
      note: data?.current_reward_state?.styfix_current_apr 
        ? `${formatPct(data.current_reward_state.styfix_current_apr, 2)} APR • ${percentShare(data.current_reward_state.styfix_current_reward, (data.current_reward_state.styfi_current_reward ?? 0) + (data.current_reward_state.styfix_current_reward ?? 0))}`
        : percentShare(data?.current_reward_state?.styfix_current_reward ?? null, (data?.current_reward_state?.styfi_current_reward ?? 0) + (data?.current_reward_state?.styfix_current_reward ?? 0)),
    },
  ], [data?.current_reward_state]);

  // Error state fallback - after all hooks
  if (error && !data) {
    return (
      <div className="card" style={{ padding: "48px", textAlign: "center" }}>
        <h2 style={{ marginBottom: "16px" }}>Data temporarily unavailable</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "24px" }}>
          The stYFI data feed failed to load. Please try again later.
        </p>
        <button 
          onClick={() => window.location.reload()} 
          className="button button-primary"
          style={{ padding: "12px 24px" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none", display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "48px", alignItems: "center" }}>
        <div>
          <h1 className="page-title">
            stYFI
            <br />
            <em className="page-title-accent">Governance staking</em>
          </h1>
          <p className="page-description">
            Track Yearn staking balance, reward epochs, and protocol-level yield.
          </p>
          <a
            href="https://yearn.finance/stake-yfi"
            target="_blank"
            rel="noopener noreferrer"
            className="button button-primary"
            style={{ marginTop: "24px" }}
          >
            Open stYFI App
          </a>
        </div>
        <div style={{ position: "relative", height: "280px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Image
            src="/styfi-assets-blender/hero-styfi-blender-coin-tilt-left.png"
            alt="stYFI"
            width={420}
            height={280}
            priority
            style={{ objectFit: "contain" }}
          />
        </div>
      </section>

      {/* Summary KPIs - 5 cards */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {Array(5).fill(null).map((_, i) => (
              <KpiGridSkeleton key={i} count={1} />
            ))}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {summaryItems.map((item) => (
              <div key={item.label} className="kpi-card">
                <div className="kpi-label">{item.label}</div>
                <div className="kpi-value">{item.value}</div>
                {item.hint && <div className="kpi-hint" style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "4px" }}>{item.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reward Split */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <BarList
          title={`Current Reward Split (Epoch ${data?.current_reward_state?.epoch ?? "-"})`}
          items={rewardBars}
          valueFormatter={(value) => formatToken(value, rewardSymbol, 2)}
          emptyText="Current reward split syncing."
        />
      </section>

      {/* Stake Trend */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Stake Trend</h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{snapshotSeries.length} snapshots across {historySpan}</p>
        </div>
        <TrendStrips
          title=""
          items={stakeTrendItems}
          valueFormatter={(value) => formatTokenCompact(value, "YFI")}
          deltaFormatter={(value) => formatSignedToken(value, "YFI", 2)}
          columns={3}
          emptyText="Snapshot history is still warming up."
        />
      </section>

      {/* Epoch Detail Table */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Epoch Detail</h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Epochs start at 00:00:00 UTC. Component columns are protocol allocations (not user claim totals).
          </p>
        </div>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "8%" }}>Epoch</th>
                <th style={{ width: "10%" }}>Status</th>
                <th style={{ width: "14%" }}>Start</th>
                <th style={{ width: "16%", textAlign: "right" }}>Pot</th>
                <th style={{ width: "16%", textAlign: "right" }}>stYFI</th>
                <th style={{ width: "16%", textAlign: "right" }}>stYFIx</th>
                <th style={{ width: "10%", textAlign: "right" }}>veYFI</th>
                <th style={{ width: "10%", textAlign: "right" }}>Lockers</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={8} />
              ) : (
                [...epochSeries].reverse().map((row) => {
                  const isCurrent = row.epoch === currentEpoch;
                  return (
                    <tr key={row.epoch ?? row.epoch_start ?? "epoch"}>
                      <td>{row.epoch ?? "n/a"}</td>
                      <td>
                        <span style={{ 
                          fontSize: "11px", 
                          padding: "2px 8px", 
                          borderRadius: "4px",
                          background: isCurrent ? "var(--accent)" : "var(--bg-elevated)",
                          color: isCurrent ? "white" : "var(--text-secondary)"
                        }}>
                          {isCurrent ? "Ongoing" : "Completed"}
                        </span>
                      </td>
                      <td>{formatUtcDate(row.epoch_start ?? null)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_total, rewardSymbol, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_styfi, rewardSymbol, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_styfix, rewardSymbol, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_veyfi, rewardSymbol, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_liquid_lockers, rewardSymbol, 2)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function StYfiPage() {
  return (
    <Suspense fallback={
      <div className="card" style={{ padding: "48px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="skeleton" style={{ height: "40px", width: "200px" }} />
          <div className="skeleton" style={{ height: "20px", width: "60%" }} />
        </div>
      </div>
    }>
      <StYfiPageContent />
    </Suspense>
  );
}
