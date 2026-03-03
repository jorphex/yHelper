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
  coverage?: {
    global?: {
      eligible_vaults?: number;
    };
  } | null;
  protocol_context?: {
    tvl_change_7d_pct?: number | null;
    yearn_aligned_proxy?: {
      tvl_usd?: number | null;
    } | null;
  } | null;
};

type MetaMoverRow = {
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  safe_apy_30d?: number | null;
};

type MetaMoversResponse = {
  summary?: {
    avg_delta_apy?: number | null;
  };
  movers?: {
    risers?: MetaMoverRow[];
  };
};

function pctDelta(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const signed = value * 100;
  const prefix = signed > 0 ? "+" : "";
  return `${prefix}${signed.toFixed(digits)}%`;
}

function moverTitle(row: MetaMoverRow | undefined): string {
  if (!row) return "n/a";
  if (row.symbol && row.symbol.trim().length > 0) return row.symbol.trim();
  if (row.token_symbol && row.token_symbol.trim().length > 0) return row.token_symbol.trim();
  return "Vault";
}

function liveSummary(
  topRiser: MetaMoverRow | undefined,
  avgDeltaApy: number | null | undefined,
  eligibleVaults: number | undefined,
): string {
  const topMoverName = topRiser ? moverTitle(topRiser) : "syncing";
  const topMoverApy = Number.isFinite(topRiser?.safe_apy_30d ?? null) ? formatPct(topRiser?.safe_apy_30d ?? null, 2) : "n/a";
  const topMoverDelta = Number.isFinite(topRiser?.delta_apy ?? null) ? pctDelta(topRiser?.delta_apy, 2) : "n/a";
  const universeDelta = Number.isFinite(avgDeltaApy ?? null) ? pctDelta(avgDeltaApy, 2) : "n/a";
  const universeCoverage = Number.isFinite(eligibleVaults ?? null) ? `${eligibleVaults} vaults tracked` : "vault count syncing";
  return `Top mover ${topMoverName} · APY 30d ${topMoverApy} · 24h change ${topMoverDelta} | Universe avg 24h change ${universeDelta} | ${universeCoverage}`;
}

function freshnessSummary(ageSeconds: number | null | undefined): string {
  const value = formatHours(ageSeconds ?? null, 1);
  if (value === "n/a") return "Freshness syncing";
  return `Freshness ${value}`;
}

export default function HomePage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [movers, setMovers] = useState<MetaMoversResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [overviewResult, moversResult] = await Promise.allSettled([
        fetch("/api/overview", { cache: "no-store" }),
        fetch("/api/meta/movers?window=24h&limit=1&include_freshness=false", { cache: "no-store" }),
      ]);
      if (!active) return;

      if (overviewResult.status === "fulfilled" && overviewResult.value.ok) {
        setOverview((await overviewResult.value.json()) as OverviewResponse);
      }
      if (moversResult.status === "fulfilled" && moversResult.value.ok) {
        setMovers((await moversResult.value.json()) as MetaMoversResponse);
      }
    };

    void load();
    return () => {
      active = false;
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

  const topRiser = movers?.movers?.risers?.[0];
  const liveNowLine = liveSummary(topRiser, movers?.summary?.avg_delta_apy ?? null, overview?.coverage?.global?.eligible_vaults);
  const liveFreshnessLine = freshnessSummary(overview?.freshness?.latest_pps_age_seconds ?? null);

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

      <div className="home-minimal-break prism-divider" aria-hidden="true">
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

      <div className="home-minimal-break home-minimal-break-soft prism-divider prism-divider-alt" aria-hidden="true">
        <Image
          src="/home-assets-yearn-blender/divider-yearn-blender-coins.png"
          alt=""
          fill
          sizes="100vw"
          className="home-divider-image"
          draggable={false}
        />
      </div>

      <section className="home-minimal-signals">
        <article className="card home-sparse-signal-card home-reveal">
          <p className="home-sparse-signal-label">Tracked TVL</p>
          <p className="home-sparse-signal-value">{formatUsd(overview?.protocol_context?.yearn_aligned_proxy?.tvl_usd ?? null, 0)}</p>
        </article>
        <article className="card home-sparse-signal-card home-reveal">
          <p className="home-sparse-signal-label">TVL Change 7d</p>
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
