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
  current_reward_state?: {
    source?: string | null;
    epoch?: number | null;
    timestamp?: number | null;
    block_number?: number | null;
    reward_pps?: number | null;
    global_apr?: number | null;
    styfi_current_reward?: number | null;
    styfi_current_apr?: number | null;
    styfi_projected_reward?: number | null;
    styfi_projected_apr?: number | null;
    styfix_current_reward?: number | null;
    styfix_current_apr?: number | null;
    styfix_projected_reward?: number | null;
    styfix_projected_apr?: number | null;
  } | null;
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

function formatUtcDate(value: Date | number | string | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
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
  const currentRewardState = data?.current_reward_state ?? null;
  const summary = data?.summary ?? null;
  const freshness = data?.freshness ?? null;
  const epochSeries = useMemo(() => data?.series?.epochs ?? [], [data?.series?.epochs]);
  const snapshotSeries = useMemo(() => data?.series?.snapshots ?? [], [data?.series?.snapshots]);
  const currentEpoch = summary?.reward_epoch ?? null;
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
          label: "stYFI Staked",
          value: formatTokenCompact(summary?.styfi_staked ?? null, "YFI"),
          hint: "Matches the public stYFI site headline.",
        },
        {
          label: "stYFIx Staked",
          value: formatTokenCompact(summary?.styfix_staked ?? null, "YFI"),
          hint: "Additional YFI staked through stYFIx.",
        },
        {
          label: "Combined Staked",
          value: formatTokenCompact(summary?.combined_staked ?? null, "YFI"),
          hint: "Combined stYFI plus stYFIx.",
        },
        {
          label: "Share of YFI Supply",
          value: formatPct(summary?.staked_share_supply ?? null, 2),
          hint: `${formatToken(summary?.yfi_total_supply ?? null, "YFI", 0)} total supply`,
        },
        {
          label: "Current Reward APR",
          value: formatPct(currentRewardState?.styfi_current_apr ?? null, 2),
          hint:
            currentRewardState?.styfi_current_apr !== null &&
            currentRewardState?.styfix_current_apr !== null &&
            currentRewardState?.styfi_current_apr !== undefined &&
            currentRewardState?.styfix_current_apr !== undefined
              ? `stYFI ${formatPct(currentRewardState.styfi_current_apr, 2)} • stYFIx ${formatPct(currentRewardState.styfix_current_apr, 2)}`
              : `Current run-rate from ${rewardSymbol} rewards`,
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
              label: "History Warm-Up",
              value: `${snapshotCountValue} captures`,
              hint: "Each capture stores protocol stake balances and reward epoch state.",
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
      currentRewardState?.styfi_current_apr,
      currentRewardState?.styfix_current_apr,
      hasNetFlow24h,
      hasNetFlow7d,
      historySpan,
      rewardSymbol,
      summary?.combined_staked,
      summary?.net_flow_24h,
      summary?.net_flow_7d,
      summary?.styfi_staked,
      summary?.styfix_staked,
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
        note: "Latest combined balance. Delta is versus the previous captured snapshot.",
      },
      {
        id: "styfi-staked",
        label: "stYFI",
        points: snapshotSeries.map((row) => row.styfi_staked),
        note: "Latest stYFI balance. Delta is versus the previous captured snapshot.",
      },
      {
        id: "styfix-staked",
        label: "stYFIx",
        points: snapshotSeries.map((row) => row.styfix_staked),
        note: "Latest stYFIx balance. Delta is versus the previous captured snapshot.",
      },
    ],
    [snapshotSeries],
  );

  const latestComponentBars = useMemo(
    () => [
      {
        id: "styfi-current",
        label: "stYFI",
        value: currentRewardState?.styfi_current_reward ?? null,
        note:
          currentRewardState?.styfi_current_apr !== null && currentRewardState?.styfi_current_apr !== undefined
            ? `${formatPct(currentRewardState.styfi_current_apr, 2)} APR • ${percentShare(
                currentRewardState?.styfi_current_reward ?? null,
                (currentRewardState?.styfi_current_reward ?? 0) + (currentRewardState?.styfix_current_reward ?? 0),
              )}`
            : percentShare(
                currentRewardState?.styfi_current_reward ?? null,
                (currentRewardState?.styfi_current_reward ?? 0) + (currentRewardState?.styfix_current_reward ?? 0),
              ),
      },
      {
        id: "styfix-current",
        label: "stYFIx",
        value: currentRewardState?.styfix_current_reward ?? null,
        note:
          currentRewardState?.styfix_current_apr !== null && currentRewardState?.styfix_current_apr !== undefined
            ? `${formatPct(currentRewardState.styfix_current_apr, 2)} APR • ${percentShare(
                currentRewardState?.styfix_current_reward ?? null,
                (currentRewardState?.styfi_current_reward ?? 0) + (currentRewardState?.styfix_current_reward ?? 0),
              )}`
            : percentShare(
                currentRewardState?.styfix_current_reward ?? null,
                (currentRewardState?.styfi_current_reward ?? 0) + (currentRewardState?.styfix_current_reward ?? 0),
              ),
      },
    ],
    [
      currentRewardState?.styfi_current_apr,
      currentRewardState?.styfi_current_reward,
      currentRewardState?.styfix_current_apr,
      currentRewardState?.styfix_current_reward,
    ],
  );

  if (error && !data) {
    return (
      <main className="container">
        <section className="card section-card status-card status-card-error">
          <h2>stYFI data is temporarily unavailable</h2>
          <p className="card-intro">The staking snapshot endpoint failed before any page data loaded. The layout is intact, but the live protocol cards are intentionally withheld until the feed recovers.</p>
          <p className="muted">Retry after the next ingestion cycle or check the live app again once the API health recovers.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="hero hero-styfi">
        <p className="hero-kicker">Staking surface</p>
        <h1>stYFI</h1>
        <p className="muted">
          Track Yearn staking balance, reward epochs, and legacy carryover at the protocol level. This page stays out of
          wallet-level views and focuses on the shared staking surface.
        </p>
        <div className="home-minimal-cta-row">
          <a href="https://styfi.yearn.fi" target="_blank" rel="noreferrer noopener" className="home-lite-cta primary">
            Open stYFI App
          </a>
        </div>
      </section>

      <section className="card section-card summary-card styfi-summary-card">
        <h2>Protocol Snapshot</h2>
        <p className="muted card-intro">
          The reward token is currently {rewardSymbol}. Rolling history is capped at {data?.data_policy?.retention_days ?? "n/a"} days,
          with higher-frequency snapshots capped at {data?.data_policy?.snapshot_retention_days ?? "n/a"} days. Net-flow cards appear
          only once enough history exists to make them meaningful.
        </p>
        <KpiGrid items={summaryItems} />
      </section>

      <PageTopPanel
        intro={
          <>
            <p className="muted card-intro">
              stYFI is Yearn&apos;s staking layer. This page tracks stake balance, epoch reward pots, and how the latest completed
              epoch distribution compares with the current reward run-rate across stYFI and stYFIx.
            </p>
            <p className="muted analyst-only">
              Net flow is derived from rolling snapshots, not from gross deposit and withdrawal logs. Current epochs can show a
              reward run-rate before the completed-epoch allocation below is finalized.
            </p>
          </>
        }
        filtersIntro={<p className="muted card-intro">The page uses the full retained snapshot history and the latest stored reward epochs.</p>}
        filters={
          <div className="inline-controls controls-tight">
            <label>
              <span>Stored history</span>
              <strong>
                {summary?.snapshots_count ?? "n/a"} captures across {historySpan}
              </strong>
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
        tone="styfi"
        className="styfi-history-panel"
      />

      <section className="split-grid styfi-visual-grid">
        <ShareMeter
          title="Stake Split Now"
          segments={stakeSplitSegments}
          total={summary?.combined_staked ?? null}
          valueFormatter={(value) => formatTokenCompact(value, "YFI")}
          legend="This is the combined current stake mix across stYFI and stYFIx."
        />
        <BarList
          title={
            currentRewardState?.epoch !== null && currentRewardState?.epoch !== undefined
              ? `Current Reward Run-Rate Split (Epoch ${currentRewardState.epoch})`
              : "Current Reward Run-Rate Split"
          }
          items={latestComponentBars}
          valueFormatter={(value) => formatToken(value, rewardSymbol, 2)}
          emptyText="Current reward split syncing."
        />
      </section>

      <section className="card section-card visual-card styfi-trend-card">
        <TrendStrips
          title="Stake Trend"
          items={stakeTrendItems}
          valueFormatter={(value) => formatTokenCompact(value, "YFI")}
          deltaFormatter={(value) => formatSignedToken(value, "YFI", 2)}
          columns={1}
          embedded
          emptyText="Snapshot history is still warming up."
        />
      </section>

      <section className="card section-card table-card">
        <h2>Epoch Detail</h2>
        <p className="muted card-intro">
          Epochs start at 00:00:00 UTC. Current epochs can show a funded reward pot before splits are fully synced. Component columns
          below are completed-epoch protocol allocations, not user claim totals.
        </p>
        <div className="mobile-only styfi-epoch-mobile-list">
          {[...epochSeries].reverse().map((row) => {
            const isCurrentEpoch =
              row.epoch !== null &&
              row.epoch !== undefined &&
              currentEpoch !== null &&
              currentEpoch !== undefined &&
              row.epoch === currentEpoch;
            return (
              <article key={`mobile-${row.epoch ?? row.epoch_start ?? "epoch"}`} className="styfi-epoch-mobile-card">
                <div className="styfi-epoch-mobile-head">
                  <p className="home-kicker">Epoch {row.epoch ?? "n/a"}</p>
                  <span className="pill">{isCurrentEpoch ? "Ongoing" : "Completed"}</span>
                </div>
                <div className="styfi-epoch-mobile-grid">
                  <div>
                    <span>Start</span>
                    <strong>{formatUtcDate(row.epoch_start ?? null)}</strong>
                  </div>
                  <div>
                    <span>Reward Pot</span>
                    <strong>{formatToken(row.reward_total ?? null, rewardSymbol, 2)}</strong>
                  </div>
                  <div>
                    <span>stYFI</span>
                    <strong>{formatToken(row.reward_styfi ?? null, rewardSymbol, 2)}</strong>
                  </div>
                  <div>
                    <span>stYFIx</span>
                    <strong>{formatToken(row.reward_styfix ?? null, rewardSymbol, 2)}</strong>
                  </div>
                  <div>
                    <span>Migrated veYFI</span>
                    <strong>{formatToken(row.reward_veyfi ?? null, rewardSymbol, 2)}</strong>
                  </div>
                  <div>
                    <span>Liquid Lockers</span>
                    <strong>{formatToken(row.reward_liquid_lockers ?? null, rewardSymbol, 2)}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="table-wrap styfi-epoch-wrap desktop-only">
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
                    <td className="col-start">{formatUtcDate(row.epoch_start ?? null)}</td>
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
