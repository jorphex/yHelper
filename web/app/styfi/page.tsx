"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api";
import { formatHours, formatPct } from "../lib/format";
import { BarList, ShareMeter, TrendStrips } from "../components/visuals";
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
  };
};

function formatTokenCompact(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: digits }).format(value);
}

function formatToken(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function formatSignedToken(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatToken(value, digits)}`;
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

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({ days: "122", epoch_limit: "12" });
        const res = await fetch(apiUrl("/styfi", params), { cache: "no-store" });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const payload = await res.json() as StYfiResponse;
        if (active) {
          setData(payload);
          setIsLoading(false);
        }
      } catch {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, []);

  const rewardSymbol = data?.reward_token?.symbol?.trim() || "yvUSDC-1";
  const summary = data?.summary ?? null;
  const epochSeries = data?.series?.epochs ?? [];
  const snapshotSeries = data?.series?.snapshots ?? [];
  const currentEpoch = summary?.reward_epoch ?? null;

  const stakeSplitSegments = useMemo(() => [
    { id: "styfi", label: "stYFI", value: summary?.styfi_staked ?? null, tone: "primary" as const },
    { id: "styfix", label: "stYFIx", value: summary?.styfix_staked ?? null, tone: "positive" as const },
  ], [summary?.styfi_staked, summary?.styfix_staked]);

  const stakeTrendItems = useMemo(() => [
    { id: "combined", label: "Combined", points: snapshotSeries.map((r) => r.combined_staked) },
    { id: "styfi", label: "stYFI", points: snapshotSeries.map((r) => r.styfi_staked) },
    { id: "styfix", label: "stYFIx", points: snapshotSeries.map((r) => r.styfix_staked) },
  ], [snapshotSeries]);

  const rewardBars = useMemo(() => [
    { id: "styfi", label: "stYFI", value: data?.current_reward_state?.styfi_current_reward ?? null },
    { id: "styfix", label: "stYFIx", value: data?.current_reward_state?.styfix_current_reward ?? null },
  ], [data?.current_reward_state]);

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          stYFI.
          <br />
          <em className="page-title-accent">Staking surface.</em>
        </h1>
        <p className="page-description">
          Track Yearn staking balance, reward epochs, and protocol-level yield. Focused on the shared staking surface.
        </p>
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
              <div className="kpi-label">stYFI Staked</div>
              <div className="kpi-value">{formatTokenCompact(summary?.styfi_staked)} YFI</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">stYFIx Staked</div>
              <div className="kpi-value">{formatTokenCompact(summary?.styfix_staked)} YFI</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Combined</div>
              <div className="kpi-value">{formatTokenCompact(summary?.combined_staked)} YFI</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Current APR</div>
              <div className="kpi-value">{formatPct(data?.current_reward_state?.styfi_current_apr)}</div>
            </div>
          </div>
        )}
      </section>

      {/* Visualizations */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Stake Split</h2>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "48px" }}>
          <ShareMeter
            title="By Type"
            segments={stakeSplitSegments}
            total={summary?.combined_staked ?? null}
            valueFormatter={(value) => `${formatTokenCompact(value)} YFI`}
          />
          <BarList
            title={`Current Reward Split (Epoch ${data?.current_reward_state?.epoch ?? "-"})`}
            items={rewardBars}
            valueFormatter={(value) => formatToken(value)}
          />
        </div>

        <div className="card-header">
          <h2 className="card-title">Stake Trend</h2>
        </div>
        
        <TrendStrips
          title="History"
          items={stakeTrendItems}
          valueFormatter={(value) => `${formatTokenCompact(value)} YFI`}
          deltaFormatter={(value) => formatSignedToken(value)}
        />
      </section>

      {/* Epoch Table */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Epoch Detail</h2>
        </div>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Epoch</th>
                <th>Status</th>
                <th>Start</th>
                <th style={{ textAlign: "right" }}>Pot</th>
                <th style={{ textAlign: "right" }}>stYFI</th>
                <th style={{ textAlign: "right" }}>stYFIx</th>
                <th style={{ textAlign: "right" }}>veYFI</th>
                <th style={{ textAlign: "right" }}>Lockers</th>
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
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_total)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_styfi)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_styfix)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_veyfi)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_liquid_lockers)}</td>
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
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <StYfiPageContent />
    </Suspense>
  );
}
