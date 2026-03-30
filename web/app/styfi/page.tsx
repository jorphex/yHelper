"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api";
import { formatHours, formatPct, formatUtcDateTime } from "../lib/format";

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
    yfi_total_supply?: number | null;
    styfi_staked?: number | null;
    styfix_staked?: number | null;
    combined_staked?: number | null;
    staked_share_supply?: number | null;
    net_flow_24h?: number | null;
    net_flow_7d?: number | null;
    reward_epoch?: number | null;
  } | null;
  reward_token?: { symbol?: string | null } | null;
  current_reward_state?: {
    epoch?: number | null;
    styfi_current_apr?: number | null;
    styfix_current_apr?: number | null;
    styfi_current_reward?: number | null;
    styfix_current_reward?: number | null;
  } | null;
  series?: { epochs?: StYfiEpochPoint[] } | null;
  freshness?: { latest_snapshot_age_seconds?: number | null; latest_snapshot_at?: string | null } | null;
};

function formatToken(value: number | null | undefined, symbol: string, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)} ${symbol}`;
}

function formatTokenCompact(value: number | null | undefined, symbol: string): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)} ${symbol}`;
}

function formatSignedToken(value: number | null | undefined, symbol: string): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatToken(value, symbol, 2)}`;
}

function percentShare(value: number | null | undefined, total: number | null | undefined): string {
  if (value == null || total == null || !Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return "Share syncing";
  }
  return `${formatPct(value / total, 0)} of total`;
}

function formatUtcDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" }).format(date);
}

function StYfiPageContent() {
  const [data, setData] = useState<StYfiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(apiUrl("/styfi", new URLSearchParams({ days: "122", epoch_limit: "12" })), { cache: "no-store" })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`)))
      .then((payload) => { if (active) { setData(payload); setError(null); } })
      .catch((err) => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, []);

  const rewardSymbol = data?.reward_token?.symbol?.trim() || "yvUSDC-1";
  const summary = data?.summary ?? null;
  const currentReward = data?.current_reward_state ?? null;
  const epochSeries = useMemo(() => data?.series?.epochs ?? [], [data?.series?.epochs]);
  const currentEpoch = summary?.reward_epoch ?? null;
  const freshness = data?.freshness ?? null;

  const hasFlow24h = Number.isFinite(summary?.net_flow_24h ?? null);
  const hasFlow7d = Number.isFinite(summary?.net_flow_7d ?? null);

  if (error && !data) {
    return (
      <div className="card" style={{ padding: "48px", textAlign: "center" }}>
        <h2 style={{ marginBottom: "16px" }}>Data temporarily unavailable</h2>
        <p style={{ color: "var(--text-secondary)" }}>The staking snapshot endpoint failed. Retry after the next ingestion cycle.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Staking.
          <br />
          <em className="page-title-accent">Rewards. Epochs.</em>
        </h1>
        <p className="page-description">
          Track Yearn staking balance, reward epochs, and legacy carryover at the protocol level. 
          Current reward token: {rewardSymbol}.
        </p>
        <div style={{ display: "flex", gap: "12px", marginTop: "32px" }}>
          <a href="https://styfi.yearn.fi" target="_blank" rel="noreferrer" className="button button-primary">Open stYFI App</a>
        </div>
      </section>

      {/* KPI Grid */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="kpi-card">
            <div className="kpi-label">stYFI Staked</div>
            <div className="kpi-value">{formatTokenCompact(summary?.styfi_staked ?? null, "YFI")}</div>
            <div className="kpi-hint">{percentShare(summary?.styfi_staked ?? null, summary?.combined_staked ?? null)}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">stYFIx Staked</div>
            <div className="kpi-value">{formatTokenCompact(summary?.styfix_staked ?? null, "YFI")}</div>
            <div className="kpi-hint">{percentShare(summary?.styfix_staked ?? null, summary?.combined_staked ?? null)}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Combined Staked</div>
            <div className="kpi-value">{formatTokenCompact(summary?.combined_staked ?? null, "YFI")}</div>
            <div className="kpi-hint">{formatPct(summary?.staked_share_supply ?? null, 2)} of YFI supply</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Current Reward APR</div>
            <div className="kpi-value">{formatPct(currentReward?.styfi_current_apr ?? null, 2)}</div>
            <div className="kpi-hint">stYFIx: {formatPct(currentReward?.styfix_current_apr ?? null, 2)}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Snapshot Freshness</div>
            <div className="kpi-value">{formatHours(freshness?.latest_snapshot_age_seconds ?? null, 1)}</div>
            <div className="kpi-hint">{formatUtcDateTime(freshness?.latest_snapshot_at ?? null)}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">{hasFlow24h ? "Net Flow 24h" : "History Warm-Up"}</div>
            <div className="kpi-value" style={{ fontSize: "20px" }}>
              {hasFlow24h ? formatSignedToken(summary?.net_flow_24h ?? null, "YFI") : "Building history..."}
            </div>
            <div className="kpi-hint">{hasFlow24h ? "Snapshot derived" : "Need more data points"}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">{hasFlow7d ? "Net Flow 7d" : "Reward Token"}</div>
            <div className="kpi-value" style={{ fontSize: "20px" }}>
              {hasFlow7d ? formatSignedToken(summary?.net_flow_7d ?? null, "YFI") : rewardSymbol}
            </div>
            <div className="kpi-hint">{hasFlow7d ? "7-day comparison" : "Current distribution"}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Current Epoch</div>
            <div className="kpi-value" style={{ fontSize: "28px" }}>{currentReward?.epoch ?? "n/a"}</div>
            <div className="kpi-hint">Reward distribution cycle</div>
          </div>
        </div>
      </section>

      {/* Reward Split */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Current Reward Split (Epoch {currentReward?.epoch ?? "n/a"})</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>stYFI</span>
              <span className="data-value" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {formatToken(currentReward?.styfi_current_reward ?? null, rewardSymbol, 2)}
              </span>
            </div>
            <div style={{ height: "8px", background: "var(--bg-elevated)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ 
                height: "100%", 
                width: `${((currentReward?.styfi_current_reward ?? 0) / ((currentReward?.styfi_current_reward ?? 0) + (currentReward?.styfix_current_reward ?? 0) || 1)) * 100}%`,
                background: "var(--accent)"
              }} />
            </div>
            <div style={{ marginTop: "8px", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {formatPct(currentReward?.styfi_current_apr ?? null, 2)} APR
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>stYFIx</span>
              <span className="data-value" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {formatToken(currentReward?.styfix_current_reward ?? null, rewardSymbol, 2)}
              </span>
            </div>
            <div style={{ height: "8px", background: "var(--bg-elevated)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ 
                height: "100%", 
                width: `${((currentReward?.styfix_current_reward ?? 0) / ((currentReward?.styfi_current_reward ?? 0) + (currentReward?.styfix_current_reward ?? 0) || 1)) * 100}%`,
                background: "var(--positive)"
              }} />
            </div>
            <div style={{ marginTop: "8px", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {formatPct(currentReward?.styfix_current_apr ?? null, 2)} APR
            </div>
          </div>
        </div>
      </section>

      {/* Epoch Table */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Epoch Detail</h2>
        </div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: "20px" }}>
          Epochs start at 00:00:00 UTC. Component columns are completed-epoch protocol allocations, not user claim totals.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "60px", textAlign: "center" }}>Epoch</th>
                <th style={{ width: "90px", textAlign: "center" }}>Status</th>
                <th>Start</th>
                <th style={{ textAlign: "right" }}>Reward Pot</th>
                <th style={{ textAlign: "right" }}>stYFI</th>
                <th style={{ textAlign: "right" }}>stYFIx</th>
                <th style={{ textAlign: "right" }}>veYFI</th>
                <th style={{ textAlign: "right" }}>Lockers</th>
              </tr>
            </thead>
            <tbody>
              {[...epochSeries].reverse().map((row) => {
                const isCurrent = row.epoch === currentEpoch;
                return (
                  <tr key={row.epoch ?? row.epoch_start ?? "epoch"}>
                    <td style={{ textAlign: "center" }}>{row.epoch ?? "n/a"}</td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        background: isCurrent ? "var(--accent)" : "var(--bg-elevated)",
                        color: isCurrent ? "white" : "var(--text-secondary)"
                      }}>
                        {isCurrent ? "Ongoing" : "Completed"}
                      </span>
                    </td>
                    <td>{formatUtcDate(row.epoch_start ?? null)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_total ?? null, rewardSymbol, 2)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_styfi ?? null, rewardSymbol, 2)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_styfix ?? null, rewardSymbol, 2)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_veyfi ?? null, rewardSymbol, 2)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatToken(row.reward_liquid_lockers ?? null, rewardSymbol, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function StYfiPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading…</div>}>
      <StYfiPageContent />
    </Suspense>
  );
}
