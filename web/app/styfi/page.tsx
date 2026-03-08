"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api";
import { formatHours, formatPct, formatUtcDateTime } from "../lib/format";
import { BarList, KpiGrid, ShareMeter, TrendStrips } from "../components/visuals";
import { PageTopPanel } from "../components/page-top-panel";

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
  filters?: {
    days?: number;
    epoch_limit?: number;
    chain_id?: number;
  };
  summary?: {
    observed_at?: string | null;
    reward_epoch?: number | null;
    yfi_total_supply?: number | null;
    styfi_staked?: number | null;
    styfi_supply?: number | null;
    styfix_staked?: number | null;
    styfix_supply?: number | null;
    combined_staked?: number | null;
    staked_share_supply?: number | null;
    net_flow_24h?: number | null;
    net_flow_7d?: number | null;
    snapshots_count?: number | null;
    first_snapshot_at?: string | null;
    latest_snapshot_at?: string | null;
  };
  reward_token?: {
    address?: string | null;
    symbol?: string | null;
    decimals?: number | null;
  };
  series?: {
    snapshots?: StYfiSnapshotPoint[];
    epochs?: StYfiEpochPoint[];
  };
  component_split_latest_completed?: {
    epoch?: number | null;
    rows?: Array<{
      component: string;
      reward: number | null;
    }>;
  };
  freshness?: {
    latest_snapshot_at?: string | null;
    latest_snapshot_age_seconds?: number | null;
    snapshots_count?: number | null;
    first_snapshot_at?: string | null;
  };
  data_policy?: {
    retention_days?: number | null;
    snapshot_retention_days?: number | null;
    epoch_lookback?: number | null;
  };
  ingestion?: {
    last_run?: {
      status?: string | null;
      started_at?: string | null;
      ended_at?: string | null;
      records?: number | null;
      error_summary?: string | null;
    } | null;
  };
};

const STYFI_PAGE_SNAPSHOT_DAYS = 122;
const STYFI_PAGE_EPOCH_LIMIT = 12;

function formatTokenCompact(value: number | null | undefined, symbol: string, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value)} ${symbol}`;
}

function formatToken(value: number | null | undefined, symbol: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value)} ${symbol}`;
}

function formatSignedToken(value: number | null | undefined, symbol: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatToken(value, symbol, digits)}`;
}

function percentShare(value: number | null | undefined, total: number | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    total === null ||
    total === undefined ||
    !Number.isFinite(value) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return "Share syncing";
  }
  return `${formatPct(value / total, 0)} of the current total`;
}

function formatRollingSpan(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "n/a";
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "n/a";
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 24) return `${diffHours.toFixed(1)}h`;
  return `${(diffHours / 24).toFixed(1)}d`;
}

function StYfiPageContent() {
  const [data, setData] = useState<StYfiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          days: String(STYFI_PAGE_SNAPSHOT_DAYS),
          epoch_limit: String(STYFI_PAGE_EPOCH_LIMIT),
        });
        const res = await fetch(apiUrl("/styfi", params), { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as StYfiResponse;
        if (active) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (active) setError(`Load failed: ${String(err)}`);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  const rewardSymbol = data?.reward_token?.symbol?.trim() || "yvUSDC-1";
  const summary = data?.summary ?? null;
  const freshness = data?.freshness ?? null;
  const epochSeries = useMemo(() => data?.series?.epochs ?? [], [data?.series?.epochs]);
  const snapshotSeries = useMemo(() => data?.series?.snapshots ?? [], [data?.series?.snapshots]);
  const currentEpoch = summary?.reward_epoch ?? null;
  const latestCompletedEpoch =
    data?.component_split_latest_completed?.epoch !== null && data?.component_split_latest_completed?.epoch !== undefined
      ? data.component_split_latest_completed.epoch
      : null;
  const latestCompletedEpochRow =
    latestCompletedEpoch !== null ? epochSeries.find((row) => row.epoch === latestCompletedEpoch) ?? null : null;
  const historySpan = formatRollingSpan(summary?.first_snapshot_at ?? null, summary?.latest_snapshot_at ?? null);
  const snapshotCountValue =
    summary?.snapshots_count !== null && summary?.snapshots_count !== undefined && Number.isFinite(summary.snapshots_count)
      ? String(summary.snapshots_count)
      : "n/a";
  const hasNetFlow24h = summary?.net_flow_24h !== null && summary?.net_flow_24h !== undefined && Number.isFinite(summary.net_flow_24h);
  const hasNetFlow7d = summary?.net_flow_7d !== null && summary?.net_flow_7d !== undefined && Number.isFinite(summary.net_flow_7d);

  const summaryItems = useMemo(
    () => {
      const items = [
        {
          label: "Combined Staked",
          value: formatTokenCompact(summary?.combined_staked ?? null, "YFI"),
          hint: "Current stYFI plus stYFIx balance",
        },
        {
          label: "Share of YFI Supply",
          value: formatPct(summary?.staked_share_supply ?? null, 2),
          hint: formatTokenCompact(summary?.yfi_total_supply ?? null, "YFI"),
        },
        {
          label: "Current Reward Epoch",
          value:
            summary?.reward_epoch !== null && summary?.reward_epoch !== undefined && Number.isFinite(summary.reward_epoch)
              ? String(summary.reward_epoch)
              : "n/a",
          hint: `Rewards accrue in ${rewardSymbol}`,
        },
        {
          label: "Latest Completed Reward Pot",
          value: formatTokenCompact(latestCompletedEpochRow?.reward_total ?? null, rewardSymbol),
          hint: latestCompletedEpoch !== null ? `Epoch ${latestCompletedEpoch}` : "Completed epoch syncing",
        },
        {
          label: "Snapshot Freshness",
          value: formatHours(freshness?.latest_snapshot_age_seconds ?? null, 1),
          hint: formatUtcDateTime(freshness?.latest_snapshot_at ?? null),
        },
      ];
      items.push(
        hasNetFlow24h
          ? {
              label: "Net Flow 24h",
              value: formatSignedToken(summary?.net_flow_24h ?? null, "YFI"),
              hint: "Snapshot derived, not gross stake and unstake",
            }
          : {
              label: "Snapshots Captured",
              value: snapshotCountValue,
              hint: formatUtcDateTime(summary?.first_snapshot_at ?? null),
            },
      );
      items.push(
        hasNetFlow7d
          ? {
              label: "Net Flow 7d",
              value: formatSignedToken(summary?.net_flow_7d ?? null, "YFI"),
              hint: "Compared with the latest snapshot seven days back",
            }
          : {
              label: "History Span",
              value: historySpan,
              hint: "Rolling snapshot history available so far",
            },
      );
      return items;
    },
    [
      freshness?.latest_snapshot_age_seconds,
      freshness?.latest_snapshot_at,
      hasNetFlow24h,
      hasNetFlow7d,
      historySpan,
      latestCompletedEpoch,
      latestCompletedEpochRow?.reward_total,
      rewardSymbol,
      summary?.combined_staked,
      summary?.first_snapshot_at,
      summary?.net_flow_24h,
      summary?.net_flow_7d,
      summary?.reward_epoch,
      summary?.staked_share_supply,
      summary?.yfi_total_supply,
      snapshotCountValue,
    ],
  );

  const stakeSplitSegments = useMemo(
    () => [
      {
        id: "styfi",
        label: "stYFI",
        value: summary?.styfi_staked ?? null,
        note: percentShare(summary?.styfi_staked ?? null, summary?.combined_staked ?? null),
        tone: "primary" as const,
      },
      {
        id: "styfix",
        label: "stYFIx",
        value: summary?.styfix_staked ?? null,
        note: percentShare(summary?.styfix_staked ?? null, summary?.combined_staked ?? null),
        tone: "positive" as const,
      },
    ],
    [summary?.combined_staked, summary?.styfi_staked, summary?.styfix_staked],
  );

  const stakeTrendItems = useMemo(
    () => [
      {
        id: "combined-staked",
        label: "Combined staked",
        points: snapshotSeries.map((row) => row.combined_staked),
        note: "Total YFI sitting across stYFI and stYFIx.",
      },
      {
        id: "styfi-staked",
        label: "stYFI",
        points: snapshotSeries.map((row) => row.styfi_staked),
        note: "Core stYFI staking balance.",
      },
      {
        id: "styfix-staked",
        label: "stYFIx",
        points: snapshotSeries.map((row) => row.styfix_staked),
        note: "stYFIx staking balance.",
      },
    ],
    [snapshotSeries],
  );

  const rewardEpochBars = useMemo(
    () =>
      epochSeries
        .slice()
        .reverse()
        .map((row) => ({
          id: `epoch-${row.epoch ?? "na"}`,
          label: row.epoch !== null && row.epoch !== undefined ? `Epoch ${row.epoch}` : "Epoch",
          value: row.reward_total ?? null,
          note:
            row.epoch !== null && row.epoch !== undefined && currentEpoch !== null && row.epoch === currentEpoch
              ? `Started ${formatUtcDateTime(row.epoch_start ?? null)} • current epoch can stay unsplit until sync`
              : `Started ${formatUtcDateTime(row.epoch_start ?? null)}`,
        })),
    [currentEpoch, epochSeries],
  );

  const latestComponentBars = useMemo(
    () =>
      (data?.component_split_latest_completed?.rows ?? []).map((row) => ({
        id: row.component,
        label: row.component,
        value: row.reward,
        note: percentShare(row.reward ?? null, latestCompletedEpochRow?.reward_total ?? null),
      })),
    [data?.component_split_latest_completed?.rows, latestCompletedEpochRow?.reward_total],
  );

  return (
    <main className="container">
      <section className="hero">
        <h1>stYFI</h1>
        <p className="muted">
          Track Yearn staking balance, reward epochs, and legacy carryover at the protocol level. This page stays out of
          wallet-level views and focuses on the shared staking surface.
        </p>
      </section>

      <PageTopPanel
        intro={
          <>
            <p className="muted card-intro">
              stYFI is Yearn&apos;s staking layer. This page tracks stake balance, epoch reward pots, and how the latest completed
              epoch split across stYFI, stYFIx, migrated veYFI, and liquid lockers.
            </p>
            <p className="muted analyst-only">
              Net flow is derived from rolling snapshots, not from gross deposit and withdrawal logs. Current epochs can show a
              reward pot before component splits are fully synced.
            </p>
          </>
        }
        filtersIntro={<p className="muted card-intro">The page uses the full retained snapshot history and the latest stored reward epochs.</p>}
        filters={
          <div className="inline-controls controls-tight">
            <label>
              <span>Snapshot history</span>
              <strong>{summary?.snapshots_count ?? "n/a"} captures</strong>
            </label>
            <label>
              <span>History span</span>
              <strong>{historySpan}</strong>
            </label>
            <label>
              <span>Reward epochs shown</span>
              <strong>{Math.min(epochSeries.length, STYFI_PAGE_EPOCH_LIMIT)}</strong>
            </label>
            <label>
              <span>Current reward token</span>
              <strong>{rewardSymbol}</strong>
            </label>
          </div>
        }
        introTitle="What It Tracks"
        filtersTitle="History Coverage"
      />

      {error ? <section className="card">{error}</section> : null}

      <section className="card styfi-summary-card">
        <h2>Protocol Snapshot</h2>
        <p className="muted card-intro">
          The reward token is currently {rewardSymbol}. Rolling history is capped at {data?.data_policy?.retention_days ?? "n/a"} days,
          with higher-frequency snapshots capped at {data?.data_policy?.snapshot_retention_days ?? "n/a"} days. Net-flow cards appear
          only once enough history exists to make them meaningful.
        </p>
        <KpiGrid items={summaryItems} />
      </section>

      <section className="split-grid styfi-visual-grid">
        <ShareMeter
          title="Stake Split Now"
          segments={stakeSplitSegments}
          total={summary?.combined_staked ?? null}
          valueFormatter={(value) => formatTokenCompact(value, "YFI")}
          legend="This is the current stake mix, not a historical average."
        />
        <BarList
          title={
            latestCompletedEpoch !== null
              ? `Latest Completed Reward Split (Epoch ${latestCompletedEpoch})`
              : "Latest Completed Reward Split"
          }
          items={latestComponentBars}
          valueFormatter={(value) => formatToken(value, rewardSymbol, 2)}
          emptyText="Completed epoch split syncing."
        />
      </section>

      <section className="split-grid styfi-visual-grid">
        <TrendStrips
          title="Stake Trend"
          items={stakeTrendItems}
          valueFormatter={(value) => formatTokenCompact(value, "YFI")}
          deltaFormatter={(value) => formatSignedToken(value, "YFI", 2)}
          columns={1}
          emptyText="Snapshot history is still warming up."
        />
        <BarList
          title={`Reward Pot by Epoch (${rewardSymbol}, latest ${STYFI_PAGE_EPOCH_LIMIT})`}
          items={rewardEpochBars}
          valueFormatter={(value) => formatToken(value, rewardSymbol, 2)}
          emptyText="Epoch rewards syncing."
        />
      </section>

      <section className="card">
        <h2>Epoch Detail</h2>
        <p className="muted card-intro">
          Current epochs can show a funded reward pot before splits are fully synced. Component columns below are protocol-level
          allocations, not user claim totals.
        </p>
        <div className="table-wrap styfi-epoch-wrap">
          <table className="styfi-epoch-table">
            <thead>
              <tr>
                <th className="col-epoch">Epoch</th>
                <th className="col-status">Status</th>
                <th className="col-start">Start</th>
                <th className="is-numeric col-total">Reward Pot</th>
                <th className="is-numeric col-styfi">stYFI</th>
                <th className="is-numeric analyst-only col-styfix">stYFIx</th>
                <th className="is-numeric col-veyfi">Migrated veYFI</th>
                <th className="is-numeric col-lockers">Liquid Lockers</th>
              </tr>
            </thead>
            <tbody>
              {[...epochSeries].reverse().map((row) => {
                const isCurrentEpoch =
                  row.epoch !== null &&
                  row.epoch !== undefined &&
                  currentEpoch !== null &&
                  currentEpoch !== undefined &&
                  row.epoch === currentEpoch;
                return (
                  <tr key={row.epoch ?? row.epoch_start ?? "epoch"}>
                    <td className="col-epoch">{row.epoch ?? "n/a"}</td>
                    <td className="col-status">
                      <span className="pill">{isCurrentEpoch ? "Ongoing" : "Completed"}</span>
                    </td>
                    <td className="col-start">{formatUtcDateTime(row.epoch_start ?? null)}</td>
                    <td className="is-numeric col-total">{formatToken(row.reward_total ?? null, rewardSymbol, 2)}</td>
                    <td className="is-numeric col-styfi">{formatToken(row.reward_styfi ?? null, rewardSymbol, 2)}</td>
                    <td className="is-numeric analyst-only col-styfix">{formatToken(row.reward_styfix ?? null, rewardSymbol, 2)}</td>
                    <td className="is-numeric col-veyfi">{formatToken(row.reward_veyfi ?? null, rewardSymbol, 2)}</td>
                    <td className="is-numeric col-lockers">{formatToken(row.reward_liquid_lockers ?? null, rewardSymbol, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function StYfiPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <StYfiPageContent />
    </Suspense>
  );
}
