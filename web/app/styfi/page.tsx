"use client";

import Image from "next/image";
import { Suspense, useMemo } from "react";
import { explorerAddressUrl, explorerTxUrl, formatHours, formatPct, formatUtcDateTime } from "../lib/format";
import { BarList, TrendStrips } from "../components/visuals";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { useStYfiData } from "../hooks/use-styfi-data";

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

type StYfiRecentActivityPoint = {
  chain_id?: number | null;
  block_time?: string | null;
  tx_hash?: string | null;
  user_account?: string | null;
  product_type?: string | null;
  product_label?: string | null;
  event_kind?: string | null;
  action_label?: string | null;
  product_contract?: string | null;
  amount_raw?: string | null;
  amount_decimals?: number | null;
  amount_symbol?: string | null;
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
  recent_activity?: StYfiRecentActivityPoint[];
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

function shortHex(value: string | null | undefined, left = 6, right = 4): string {
  if (!value || value.length <= left + right + 2) return value ?? "n/a";
  return `${value.slice(0, left + 2)}…${value.slice(-right)}`;
}

function addThousandsSeparators(rawDigits: string): string {
  const digits = rawDigits.replace(/^0+(?=\d)/, "") || "0";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatRawAmount(raw: string | null | undefined, decimals: number | null | undefined, symbol: string | null | undefined): string {
  if (!raw) return "n/a";
  const digitsOnly = raw.replace(/\D/g, "");
  if (!digitsOnly) return "n/a";
  const resolvedDecimals = Math.max(0, decimals ?? 0);
  const padded = digitsOnly.padStart(resolvedDecimals + 1, "0");
  const wholeDigits = resolvedDecimals > 0 ? padded.slice(0, -resolvedDecimals) : padded;
  const fractionalDigits = resolvedDecimals > 0 ? padded.slice(-resolvedDecimals) : "";
  const whole = addThousandsSeparators(wholeDigits);
  const trimmedFraction = fractionalDigits.replace(/0+$/, "");
  let value = whole;
  if (trimmedFraction) {
    const visibleFraction = trimmedFraction.slice(0, 6);
    const hasMore = trimmedFraction.length > 6;
    value = `${whole}.${visibleFraction}${hasMore ? "…" : ""}`;
  }
  return symbol ? `${value} ${symbol}` : value;
}

function StYfiPageContent() {
  const { data, isLoading, error, refetch } = useStYfiData({ days: 122, epochLimit: 12 });

  const rewardSymbol = data?.reward_token?.symbol?.trim() || "yvUSDC-1";
  const summary = data?.summary ?? null;
  const epochSeries = useMemo<StYfiEpochPoint[]>(() => data?.series?.epochs ?? [], [data?.series?.epochs]);
  const snapshotSeries = useMemo<StYfiSnapshotPoint[]>(() => data?.series?.snapshots ?? [], [data?.series?.snapshots]);
  const recentActivity = useMemo<StYfiRecentActivityPoint[]>(() => data?.recent_activity ?? [], [data?.recent_activity]);
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
          onClick={() => void refetch()}
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
            href="https://styfi.yearn.fi"
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

      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Recent Activity</h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Latest 10 stYFI and stYFIx stake, unstake, withdraw, and claim actions.
          </p>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Time</th>
                <th style={{ width: "14%" }}>Product</th>
                <th style={{ width: "14%" }}>Action</th>
                <th style={{ width: "22%" }}>Amount</th>
                <th style={{ width: "16%" }}>Account</th>
                <th style={{ width: "12%" }}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={6} columns={6} />
              ) : recentActivity.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "18px", color: "var(--text-secondary)" }}>
                    Recent activity is still warming up.
                  </td>
                </tr>
              ) : (
                recentActivity.map((row) => {
                  const chainId = row.chain_id ?? 1;
                  const accountHref = row.user_account ? explorerAddressUrl(chainId, row.user_account) : null;
                  const txHref = row.tx_hash ? explorerTxUrl(chainId, row.tx_hash) : null;
                  const actionTone =
                    row.event_kind === "claim"
                      ? "var(--accent)"
                      : row.event_kind === "withdraw"
                        ? "var(--ink-subtle)"
                        : row.event_kind === "unstake"
                          ? "#9a5b23"
                          : "var(--accent)";
                  const actionBackground =
                    row.event_kind === "claim"
                      ? "rgba(6, 87, 233, 0.12)"
                      : row.event_kind === "withdraw"
                        ? "rgba(90, 84, 78, 0.10)"
                        : row.event_kind === "unstake"
                          ? "rgba(154, 91, 35, 0.12)"
                          : "rgba(6, 87, 233, 0.12)";
                  return (
                    <tr key={`${row.tx_hash}-${row.product_type}-${row.event_kind}-${row.user_account}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatUtcDateTime(row.block_time ?? null)}</td>
                      <td>{row.product_label ?? "Unknown"}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "4px 10px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 600,
                            background: actionBackground,
                            color: actionTone,
                          }}
                        >
                          {row.action_label ?? "Activity"}
                        </span>
                      </td>
                      <td className="data-value">
                        {formatRawAmount(row.amount_raw, row.amount_decimals, row.amount_symbol)}
                      </td>
                      <td>
                        {accountHref ? (
                          <a href={accountHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                            {shortHex(row.user_account)}
                          </a>
                        ) : (
                          shortHex(row.user_account)
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {txHref ? (
                          <a
                            href={txHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent)", whiteSpace: "nowrap" }}
                          >
                            {shortHex(row.tx_hash)}
                          </a>
                        ) : (
                          shortHex(row.tx_hash)
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
