"use client";

import { useEffect, useState } from "react";
import { formatHours, formatPct, formatUtcDateTime } from "./lib/format";
import { KpiGrid } from "./components/visuals";

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
    last_runs?: Record<
      string,
      {
        status?: string;
        started_at?: string | null;
        ended_at?: string | null;
        records?: number | null;
      } | null
    >;
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
        last_success_at?: string | null;
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
    mcap_source?: string | null;
    gecko_id?: string | null;
    mcap_tvl_ratio?: number | null;
    tvl_change_7d_pct?: number | null;
    tvl_change_30d_pct?: number | null;
    eligible_vs_protocol_tvl_ratio?: number | null;
    eligible_vs_protocol_tvl_gap_usd?: number | null;
    yearn_aligned_proxy?: {
      vaults?: number;
      tvl_usd?: number | null;
    } | null;
    defillama_vs_yearn_proxy_gap_usd?: number | null;
    defillama_vs_yearn_proxy_ratio?: number | null;
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
  data_policy?: {
    worker_interval_sec?: number;
    pps_retention_days?: number;
    ingestion_run_retention_days?: number;
    db_cleanup_min_interval_sec?: number;
    kong_pps_lookback_days?: number;
  };
};

export default function HomePage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <main className="container">
      <section className="hero">
        <h1>yHelper</h1>
        <p>Public Yearn dashboard. Built for quick checks by newcomers and deeper diagnostics by power users.</p>
      </section>

      <section className="card">
        <h2>Dashboards</h2>
        <p className="muted card-intro">
          All pages apply quality filters so tiny/noisy vaults do not dominate rankings.
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

      <section className="card overview-snapshot-card">
        <h2>Snapshot and Scope</h2>
        <p className="muted card-intro">
          Lightweight freshness and universe context for the data shown across dashboards.
        </p>
        {data ? (
          <>
            <KpiGrid
              items={[
                { label: "Server Time (UTC)", value: formatUtcDateTime(data.server_time_utc) },
                { label: "Latest PPS Age", value: formatHours(data.freshness?.latest_pps_age_seconds) },
                { label: "Newest Metrics Age", value: formatHours(data.freshness?.metrics_newest_age_seconds) },
                { label: "PPS Stale Ratio", value: formatPct(data.freshness?.pps_stale_ratio, 1) },
                { label: "Active Vaults", value: String(data?.lifecycle?.active_vaults ?? data?.coverage?.global?.active_vaults ?? "n/a") },
                { label: "Eligible Vaults", value: String(data?.coverage?.global?.eligible_vaults ?? "n/a") },
                { label: "Migration Ready", value: String(data?.lifecycle?.migration_ready_vaults ?? "n/a") },
                { label: "Highlighted Vaults", value: String(data?.lifecycle?.highlighted_vaults ?? "n/a") },
                { label: "Excluded Vaults", value: String(data?.coverage?.global?.excluded_vaults ?? "n/a") },
                { label: "Low Data Points", value: String(data?.coverage?.global?.low_points ?? "n/a") },
              ]}
            />
            <p className="muted overview-guardrails-note">
              Inclusion filter: TVL (Total Value Locked) ≥ {data?.coverage?.filters?.min_tvl_usd?.toLocaleString("en-US") ?? "n/a"} and
              data points ≥ {data?.coverage?.filters?.min_points ?? "n/a"}.
            </p>
          </>
        ) : loading ? (
          <p>Loading snapshot…</p>
        ) : (
          <p>Snapshot is temporarily unavailable. Try again shortly.</p>
        )}
      </section>
    </main>
  );
}
