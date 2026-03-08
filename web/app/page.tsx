"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatHours, formatPct, formatUsd } from "./lib/format";

type OverviewResponse = {
  freshness?: {
    latest_pps_age_seconds?: number | null;
    pps_stale_ratio?: number | null;
  } | null;
  tracked_scope?: {
    tracked_tvl_active_usd?: number | null;
  } | null;
  protocol_context?: {
    tvl_change_7d_pct?: number | null;
  } | null;
};

type ChangeMoverRow = {
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  safe_apy_30d?: number | null;
};

type ChangesResponse = {
  summary?: {
    avg_delta_apy?: number | null;
    vaults_with_change?: number | null;
  };
  freshness?: {
    latest_pps_age_seconds?: number | null;
  } | null;
  movers?: {
    risers?: ChangeMoverRow[];
  };
};

const HOME_REFRESH_MS = 60_000;

function pctDelta(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const signed = value * 100;
  const prefix = signed > 0 ? "+" : "";
  return `${prefix}${signed.toFixed(digits)}%`;
}

function moverTitle(row: ChangeMoverRow | undefined): string {
  if (!row) return "n/a";
  if (row.symbol && row.symbol.trim().length > 0) return row.symbol.trim();
  if (row.token_symbol && row.token_symbol.trim().length > 0) return row.token_symbol.trim();
  return "Vault";
}

function liveHeadline(
  topRiser: ChangeMoverRow | undefined,
): string {
  const topMoverName = topRiser ? moverTitle(topRiser) : "syncing";
  const topMoverApy = Number.isFinite(topRiser?.safe_apy_30d ?? null) ? formatPct(topRiser?.safe_apy_30d ?? null, 2) : "n/a";
  const topMoverDelta = Number.isFinite(topRiser?.delta_apy ?? null) ? pctDelta(topRiser?.delta_apy, 2) : "n/a";
  return `Top mover ${topMoverName} · 30d APY ${topMoverApy} · 24h move ${topMoverDelta}`;
}

function liveMeta(
  avgDeltaApy: number | null | undefined,
  trackedVaults: number | null | undefined,
  ageSeconds: number | null | undefined,
): string {
  const universeDelta = Number.isFinite(avgDeltaApy ?? null) ? pctDelta(avgDeltaApy, 2) : "n/a";
  const universeCoverage = Number.isFinite(trackedVaults ?? null) ? `${trackedVaults} vaults with change` : "vault count syncing";
  const freshness = freshnessSummary(ageSeconds);
  return `Core universe avg 24h move ${universeDelta} · ${universeCoverage} · ${freshness}`;
}

function freshnessSummary(ageSeconds: number | null | undefined): string {
  const value = formatHours(ageSeconds ?? null, 1);
  if (value === "n/a") return "Freshness syncing";
  return `Freshness ${value}`;
}

export default function HomePage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [changes, setChanges] = useState<ChangesResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [overviewResult, moversResult] = await Promise.allSettled([
        fetch("/api/overview", { cache: "no-store" }),
        fetch("/api/changes?window=24h&universe=core&limit=1", { cache: "no-store" }),
      ]);
      if (!active) return;

      if (overviewResult.status === "fulfilled" && overviewResult.value.ok) {
        setOverview((await overviewResult.value.json()) as OverviewResponse);
      }
      if (moversResult.status === "fulfilled" && moversResult.value.ok) {
        setChanges((await moversResult.value.json()) as ChangesResponse);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, HOME_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>(".home-reveal"));
    if (revealNodes.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealNodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );

    revealNodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
    };
  }, []);

  const topRiser = changes?.movers?.risers?.[0];
  const liveNowLine = liveHeadline(topRiser);
  const liveFreshnessLine = liveMeta(
    changes?.summary?.avg_delta_apy ?? null,
    changes?.summary?.vaults_with_change ?? null,
    changes?.freshness?.latest_pps_age_seconds ?? null,
  );

  return (
    <main className="container home-minimal">
      <section className="card home-minimal-hero home-reveal">
        <div className="home-minimal-hero-copy">
          <h1>Clear signals for faster vault decisions</h1>
          <p>Track yield shifts, spot vault trends, and find your next move.</p>
          <div className="home-minimal-cta-row">
            <Link href="/discover" className="home-lite-cta primary">Start in Discover</Link>
            <Link href="/changes" className="home-lite-cta">See recent changes</Link>
          </div>
        </div>
        <div className="home-minimal-hero-art" aria-hidden="true">
          <Image
            src="/home-assets-yearn-blender/hero-yearn-blender-coins.png"
            alt=""
            fill
            priority
            sizes="(max-width: 1100px) 100vw, 46vw"
            className="home-art-image prism-hero-image"
            draggable={false}
          />
        </div>
      </section>

      <section className="home-minimal-signals">
        <article className="card home-sparse-signal-card home-reveal">
          <p className="home-sparse-signal-label">Tracked TVL</p>
          <p className="home-sparse-signal-value">{formatUsd(overview?.tracked_scope?.tracked_tvl_active_usd ?? null, 0)}</p>
        </article>
        <article className="card home-sparse-signal-card home-reveal">
          <p className="home-sparse-signal-label">Protocol TVL Change 7d</p>
          <p className="home-sparse-signal-value">{formatPct(overview?.protocol_context?.tvl_change_7d_pct ?? null, 2)}</p>
        </article>
        <article className="card home-sparse-signal-card home-reveal">
          <p className="home-sparse-signal-label">Data Freshness</p>
          <p className="home-sparse-signal-value">{formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1)}</p>
        </article>
      </section>

      <section className="home-minimal-routes">
        <Link href="/discover" className="card home-sparse-route-card home-route-clickable home-reveal">
          <div className="home-route-head">
            <h2>Discover</h2>
          </div>
          <p className="muted">Find opportunities quickly with sortable quality-filtered vault signals.</p>
          <span className="home-route-arrow" aria-hidden="true">→</span>
        </Link>
        <Link href="/composition" className="card home-sparse-route-card home-route-clickable home-reveal">
          <div className="home-route-head">
            <h2>Composition</h2>
          </div>
          <p className="muted">Understand chain, category, and token concentration before sizing risk.</p>
          <span className="home-route-arrow" aria-hidden="true">→</span>
        </Link>
        <Link href="/regimes" className="card home-sparse-route-card home-route-clickable home-reveal">
          <div className="home-route-head">
            <h2>Regimes</h2>
          </div>
          <p className="muted">Monitor rising, stable, falling, and choppy behavior transitions.</p>
          <span className="home-route-arrow" aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="card home-live-strip home-reveal" aria-live="polite">
        <span className="home-live-dot" aria-hidden="true" />
        <div className="home-live-copy">
          <p className="home-live-label">Live now</p>
          <p className="home-live-text">{liveNowLine}</p>
          <p className="home-live-meta">{liveFreshnessLine}</p>
        </div>
      </section>

      <div className="home-minimal-break home-minimal-break-soft prism-divider prism-divider-alt home-reveal" aria-hidden="true">
        <Image
          src="/home-assets-yearn-blender/divider-yearn-blender-coins.png"
          alt=""
          fill
          sizes="100vw"
          className="home-divider-image"
          draggable={false}
        />
      </div>

      <section className="card home-minimal-purpose home-reveal">
        <div className="home-minimal-purpose-art prism-purpose-art" aria-hidden="true">
          <Image
            src="/home-assets-yearn-blender/purpose-yearn-blender-coins.png"
            alt=""
            fill
            sizes="(max-width: 1100px) 100vw, 32vw"
            className="home-art-image prism-purpose-image"
            draggable={false}
          />
        </div>
        <div className="home-minimal-purpose-content">
          <article className="home-minimal-step step-a">
            <p className="home-minimal-step-index">01</p>
            <h2>What It Is</h2>
            <p className="muted">A compact Yearn intelligence layer for discovery and monitoring.</p>
          </article>
          <article className="home-minimal-step step-b">
            <p className="home-minimal-step-index">02</p>
            <h2>What It Solves</h2>
            <p className="muted">Cuts scan time by turning raw vault metrics into directional signals.</p>
          </article>
          <article className="home-minimal-step step-c">
            <p className="home-minimal-step-index">03</p>
            <h2>How to use</h2>
            <p className="muted">Discover for scan. Changes for timing. Composition and Regimes for context.</p>
          </article>
        </div>
      </section>

      <footer className="card home-minimal-footer home-reveal">
        <p className="home-minimal-footer-title">Official channels</p>
        <div className="home-minimal-footer-links">
          <a href="https://yearn.fi" target="_blank" rel="noopener noreferrer">Yearn</a>
          <a href="https://x.com/yearnfi" target="_blank" rel="noopener noreferrer">X / Twitter</a>
        </div>
      </footer>

    </main>
  );
}
