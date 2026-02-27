"use client";

import { useEffect, useState } from "react";
import { formatHours, formatPct, formatUsd, formatUtcDateTime } from "./lib/format";
import { BarList, KpiGrid } from "./components/visuals";

type OverviewResponse = {
  project: string;
  status: string;
  server_time_utc: string;
  message: string;
  ingestion?: {
    active_vaults?: number | null;
    total_vaults?: number | null;
    pps_points?: number | null;
    metrics_count?: number | null;
  };
  freshness?: {
    latest_pps_age_seconds?: number | null;
    pps_vaults_total?: number;
    pps_vaults_stale?: number;
    pps_stale_ratio?: number | null;
    metrics_newest_age_seconds?: number | null;
    ingestion_jobs?: Record<
      string,
      {
        running?: boolean;
        last_success_age_seconds?: number | null;
      }
    >;
    alerts?: Record<
      string,
      {
        status?: string;
        is_firing?: boolean;
        job_name?: string;
        last_notified_at?: string | null;
      }
    >;
  } | null;
  coverage?: {
    filters?: {
      min_tvl_usd?: number;
      min_points?: number;
    };
    global?: {
      active_vaults?: number;
      eligible_vaults?: number;
      excluded_vaults?: number;
      missing_metrics?: number;
      below_tvl?: number;
      low_points?: number;
    };
  } | null;
  protocol_context?: {
    status?: string;
    protocol_name?: string;
    tvl_usd?: number | null;
    mcap_usd?: number | null;
    mcap_tvl_ratio?: number | null;
    tvl_change_7d_pct?: number | null;
    tvl_change_30d_pct?: number | null;
    eligible_vs_protocol_tvl_ratio?: number | null;
    eligible_vs_protocol_tvl_gap_usd?: number | null;
    top_chains?: Array<{ chain: string; tvl_usd: number }>;
    error?: string;
  } | null;
  lifecycle?: {
    active_vaults?: number;
    retired_vaults?: number;
    highlighted_vaults?: number;
    migration_ready_vaults?: number;
    risk_unrated_vaults?: number;
    risk_0_vaults?: number;
    risk_1_vaults?: number;
    risk_2_vaults?: number;
    risk_3_vaults?: number;
    risk_4_vaults?: number;
  } | null;
  sources: {
    ydaemon: string;
    kong_gql: string;
  };
};

export default function HomePage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverTimeLive, setServerTimeLive] = useState("n/a");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/overview", { cache: "no-store" });
        if (!res.ok) {
          if (active) {
            setData(null);
            setLoading(false);
          }
          return;
        }
        const payload = (await res.json()) as OverviewResponse;
        if (active) {
          setData(payload);
          setLoading(false);
        }
      } catch {
        if (active) {
          setData(null);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!data?.server_time_utc) {
      setServerTimeLive("n/a");
      return;
    }
    const baseMs = Date.parse(data.server_time_utc);
    if (!Number.isFinite(baseMs)) {
      setServerTimeLive("n/a");
      return;
    }
    const startMs = Date.now();
    const tick = () => {
      const liveMs = baseMs + (Date.now() - startMs);
      setServerTimeLive(formatUtcDateTime(liveMs));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [data?.server_time_utc]);

  return (
    <main className="container">
      <section className="hero">
        <h1>yHelper</h1>
        <p>Public Yearn dashboard. No wallet needed. Built for quick checks by newcomers and deeper diagnostics by power users.</p>
      </section>

      <section className="card">
        <h2>System Snapshot</h2>
        <p className="muted card-intro">Live ingestion state. If these values stall, treat all dashboard signals as stale.</p>
        {data ? (
          <>
            <KpiGrid
              items={[
                { label: "Project", value: data.project },
                { label: "Status", value: data.status },
                { label: "Server Time (UTC, Live)", value: serverTimeLive },
                { label: "Active Vaults", value: String(data.ingestion?.active_vaults ?? "n/a") },
                { label: "PPS Data Points", value: String(data.ingestion?.pps_points ?? "n/a") },
                { label: "Metric Rows", value: String(data.ingestion?.metrics_count ?? "n/a") },
              ]}
            />
            <p className="muted">{data.message}</p>
          </>
        ) : loading ? (
          <p>Loading live status…</p>
        ) : (
          <p>API unavailable. Start services with Docker Compose.</p>
        )}
      </section>

      <section className="card">
        <h2>Lifecycle Snapshot (yDaemon Metadata)</h2>
        <p className="muted card-intro">
          Lifecycle flags help users avoid stale vault choices and find migration paths faster.
        </p>
        {data?.lifecycle ? (
          <div className="split-grid">
            <KpiGrid
              items={[
                { label: "Active Vaults", value: String(data.lifecycle.active_vaults ?? "n/a") },
                { label: "Retired Vaults", value: String(data.lifecycle.retired_vaults ?? "n/a") },
                { label: "Highlighted Vaults", value: String(data.lifecycle.highlighted_vaults ?? "n/a") },
                { label: "Migration Ready", value: String(data.lifecycle.migration_ready_vaults ?? "n/a") },
              ]}
            />
            <BarList
              title="Risk Level Count"
              items={[
                { id: "unrated", label: "Unrated (-1)", value: data.lifecycle.risk_unrated_vaults ?? null },
                { id: "r0", label: "Risk 0", value: data.lifecycle.risk_0_vaults ?? null },
                { id: "r1", label: "Risk 1", value: data.lifecycle.risk_1_vaults ?? null },
                { id: "r2", label: "Risk 2", value: data.lifecycle.risk_2_vaults ?? null },
                { id: "r3", label: "Risk 3", value: data.lifecycle.risk_3_vaults ?? null },
                { id: "r4", label: "Risk 4", value: data.lifecycle.risk_4_vaults ?? null },
              ]}
              valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
            />
          </div>
        ) : (
          <p>Lifecycle metadata unavailable.</p>
        )}
      </section>

      <section className="card">
        <h2>Data Freshness</h2>
        <p className="muted card-intro">
          PPS means Price Per Share (vault share value over time). Most yield estimates here come from PPS history.
        </p>
        {data?.freshness ? (
          <KpiGrid
            items={[
              { label: "Latest PPS Age", value: formatHours(data.freshness.latest_pps_age_seconds) },
              { label: "Newest Metrics Age", value: formatHours(data.freshness.metrics_newest_age_seconds) },
              { label: "PPS Stale Ratio", value: formatPct(data.freshness.pps_stale_ratio, 1) },
              { label: "PPS Vaults Tracked", value: String(data.freshness.pps_vaults_total ?? "n/a") },
              { label: "PPS Vaults Stale", value: String(data.freshness.pps_vaults_stale ?? "n/a") },
              {
                label: "Kong Last Success",
                value: formatHours(data.freshness.ingestion_jobs?.kong_pps_metrics?.last_success_age_seconds),
              },
              {
                label: "yDaemon Last Success",
                value: formatHours(data.freshness.ingestion_jobs?.ydaemon_snapshot?.last_success_age_seconds),
              },
              {
                label: "Alerts Firing",
                value: String(Object.values(data.freshness.alerts ?? {}).filter((alert) => alert.is_firing).length),
              },
            ]}
          />
        ) : (
          <p>Freshness metrics unavailable.</p>
        )}
        {Object.entries(data?.freshness?.alerts ?? {}).length > 0 ? (
          <div className="inline-controls">
            {Object.entries(data?.freshness?.alerts ?? {}).map(([key, alert]) => (
              <span className="pill" key={key}>
                {(alert.job_name ?? key).replaceAll("_", " ")}: {alert.status ?? "unknown"}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Protocol Context (DefiLlama)</h2>
        <p className="muted card-intro">
          External context for Yearn total value locked (TVL) versus what this dashboard tracks. DefiLlama and yHelper use
          different vault scopes, so tracked share can be above 100%.
        </p>
        {data?.protocol_context ? (
          <div className="stats-grid">
            <div>
              <strong>Source Status:</strong> {data.protocol_context.status ?? "n/a"}
            </div>
            <div>
              <strong>Protocol TVL:</strong> {formatUsd(data.protocol_context.tvl_usd)}
            </div>
            <div>
              <strong>Tracked TVL Share:</strong> {formatPct(data.protocol_context.eligible_vs_protocol_tvl_ratio)}
            </div>
            <div>
              <strong>Protocol minus Tracked TVL:</strong> {formatUsd(data.protocol_context.eligible_vs_protocol_tvl_gap_usd)}
            </div>
            <div>
              <strong>Protocol MCap:</strong> {formatUsd(data.protocol_context.mcap_usd)}
            </div>
            <div>
              <strong>MCap / TVL:</strong> {formatPct(data.protocol_context.mcap_tvl_ratio)}
            </div>
            <div>
              <strong>Protocol TVL Change 7d:</strong> {formatPct(data.protocol_context.tvl_change_7d_pct)}
            </div>
            <div>
              <strong>Protocol TVL Change 30d:</strong> {formatPct(data.protocol_context.tvl_change_30d_pct)}
            </div>
          </div>
        ) : (
          <p>Protocol context unavailable.</p>
        )}
        <p className="muted">
          If “Protocol minus Tracked TVL” is negative, this dashboard’s filtered vault set is larger than the DefiLlama Yearn
          scope used for that snapshot.
        </p>
        {(data?.protocol_context?.top_chains ?? []).length > 0 ? (
          <BarList
            title="DefiLlama Chain TVL"
            items={(data?.protocol_context?.top_chains ?? []).map((row) => ({
              id: row.chain,
              label: row.chain,
              value: row.tvl_usd,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
        ) : null}
      </section>

      <section className="card">
        <h2>Dashboards</h2>
        <p className="muted card-intro">
          No wallet input required. All pages apply quality filters so tiny/noisy vaults do not dominate rankings.
        </p>
        <ol>
          <li>
            <a href="/discover">Discover</a>: sortable vault scanner by yield, trend, and stability.
          </li>
          <li>
            <a href="/assets">Assets</a>: compare venues for the same token and see spread between best and worst yield.
          </li>
          <li>
            <a href="/composition">Composition</a>: concentration and crowding across chains, categories, and tokens.
          </li>
          <li>
            <a href="/changes">Changes</a>: changefeed for rising/falling yield using 24h, 7d, or 30d windows.
          </li>
          <li>
            <a href="/regimes">Regimes</a>: vault behavior classes (rising, falling, stable, choppy).
          </li>
          <li>
            <a href="/chains">Chains</a>: chain-level weighted yield and consistency.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Coverage Guardrails</h2>
        <p className="muted card-intro">
          Inclusion filter: TVL (Total Value Locked) ≥ {data?.coverage?.filters?.min_tvl_usd?.toLocaleString("en-US") ?? "n/a"} and
          data points ≥ {data?.coverage?.filters?.min_points ?? "n/a"}.
        </p>
        {data?.coverage?.global ? (
          <KpiGrid
            items={[
              { label: "Active Vaults", value: String(data.coverage.global.active_vaults ?? "n/a") },
              { label: "Eligible Vaults", value: String(data.coverage.global.eligible_vaults ?? "n/a") },
              { label: "Excluded Vaults", value: String(data.coverage.global.excluded_vaults ?? "n/a") },
              { label: "Missing Metrics", value: String(data.coverage.global.missing_metrics ?? "n/a") },
              { label: "Below TVL Filter", value: String(data.coverage.global.below_tvl ?? "n/a") },
              { label: "Low Data Points", value: String(data.coverage.global.low_points ?? "n/a") },
            ]}
          />
        ) : (
          <p>Coverage metrics unavailable.</p>
        )}
      </section>

      <section className="card">
        <h2>Metric Guide</h2>
        <p className="muted card-intro">Quick glossary for common values used across pages.</p>
        <ul>
          <li>
            <strong>APY:</strong> annualized yield estimate. It turns a shorter return window into yearly terms.
          </li>
          <li>
            <strong>TVL:</strong> total dollar value currently deposited in a vault or group.
          </li>
          <li>
            <strong>PPS:</strong> price per share. If PPS rises, the vault share value has increased.
          </li>
          <li>
            <strong>Momentum:</strong> 7d APY minus 30d APY. Positive means recent yield is improving.
          </li>
          <li>
            <strong>Consistency:</strong> score for steadier, less erratic returns.
          </li>
          <li>
            <strong>Regime:</strong> rule label from momentum and volatility (rising, falling, stable, choppy).
          </li>
          <li>
            <strong>HHI:</strong> concentration index from 0 to 1. Higher means more concentrated.
          </li>
        </ul>
      </section>
    </main>
  );
}
