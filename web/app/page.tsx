"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatHours, formatPct, formatUsd, yearnVaultUrl } from "./lib/format";
import { apiUrl } from "./lib/api";
import { ShareMeter } from "./components/visuals";

type OverviewResponse = {
  freshness?: {
    latest_pps_age_seconds?: number | null;
    pps_stale_ratio?: number | null;
  } | null;
  protocol_context?: {
    current_yearn?: {
      tvl_usd?: number | null;
      vaults?: number | null;
    } | null;
    total_yearn?: {
      tvl_usd?: number | null;
      vaults?: number | null;
    } | null;
  } | null;
};

type ChangeMoverRow = {
  vault_address?: string | null;
  chain_id?: number | null;
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  safe_apy_30d?: number | null;
  safe_apy_window?: number | null;
};

type ChangesResponse = {
  summary?: {
    avg_delta?: number | null;
    vaults_with_change?: number | null;
  };
  freshness?: {
    latest_pps_age_seconds?: number | null;
  } | null;
  movers?: {
    risers?: ChangeMoverRow[];
    fallers?: ChangeMoverRow[];
    largest_abs_delta?: ChangeMoverRow[];
  };
};

type StYfiHomeResponse = {
  summary?: {
    combined_staked?: number | null;
  } | null;
  current_reward_state?: {
    styfi_current_apr?: number | null;
  } | null;
};

const HOME_REFRESH_MS = 60_000;
const HOME_ROUTE_CARDS = [
  {
    href: "/discover",
    eyebrow: "Scan",
    title: "Discover",
    description: "Rank vaults by quality, size, and trend direction when you need a fast shortlist.",
    note: "Best first stop for new ideas",
  },
  {
    href: "/changes",
    eyebrow: "Time",
    title: "Changes",
    description: "See recent APY movers, stale series, and freshness context before acting on a shift.",
    note: "Use when timing matters",
  },
  {
    href: "/assets",
    eyebrow: "Compare",
    title: "Assets",
    description: "Compare venues for the same token to spot spread, structure, and concentration tradeoffs.",
    note: "Best for one-asset decisions",
  },
  {
    href: "/composition",
    eyebrow: "Concentration",
    title: "Composition",
    description: "Check chain, category, and token concentration before sizing risk in the filtered universe.",
    note: "Use before sizing exposure",
  },
  {
    href: "/regimes",
    eyebrow: "Behavior",
    title: "Regimes",
    description: "Follow rising, stable, falling, and choppy states plus how cohorts are transitioning.",
    note: "Explains recent yield behavior",
  },
  {
    href: "/chains",
    eyebrow: "Network",
    title: "Chains",
    description: "Compare chain scale, weighted yield, and coverage quality from the same filtered universe.",
    note: "Best for chain-level context",
  },
  {
    href: "/styfi",
    eyebrow: "Staking",
    title: "stYFI",
    description: "Track stake balances, reward epochs, and the current split between stYFI and stYFIx.",
    note: "For Yearn staking context",
  },
] as const;

const HOME_PLAYBOOKS = [
  {
    step: "01",
    title: "Find a candidate",
    body: "Start in Discover to rank the universe, then confirm the latest move in Changes before treating a vault as actionable.",
    links: [
      { href: "/discover", label: "Discover" },
      { href: "/changes", label: "Changes" },
    ],
  },
  {
    step: "02",
    title: "Pressure-test the idea",
    body: "Use Assets, Composition, and Chains to understand spread, concentration, and chain context before sizing up.",
    links: [
      { href: "/assets", label: "Assets" },
      { href: "/composition", label: "Composition" },
      { href: "/chains", label: "Chains" },
    ],
  },
  {
    step: "03",
    title: "Monitor behavior over time",
    body: "Use Regimes for state changes and stYFI for staking context when you need to monitor behavior rather than just scan once.",
    links: [
      { href: "/regimes", label: "Regimes" },
      { href: "/styfi", label: "stYFI" },
    ],
  },
] as const;

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

function isMeaningfulMove(row: ChangeMoverRow | undefined): boolean {
  return Number.isFinite(row?.delta_apy ?? null) && Math.abs(row?.delta_apy ?? 0) >= 0.0001;
}

function featuredMover(changes: ChangesResponse | null): ChangeMoverRow | undefined {
  const largest = changes?.movers?.largest_abs_delta?.[0];
  if (isMeaningfulMove(largest)) return largest;
  const riser = changes?.movers?.risers?.find((row) => isMeaningfulMove(row));
  if (riser) return riser;
  return changes?.movers?.fallers?.find((row) => isMeaningfulMove(row));
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

function formatTokenCompact(value: number | null | undefined, symbol: string, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value)} ${symbol}`;
}

function formatUsdCompact(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

export default function HomePage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [changes, setChanges] = useState<ChangesResponse | null>(null);
  const [styfi, setStyfi] = useState<StYfiHomeResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [overviewResult, moversResult, styfiResult] = await Promise.allSettled([
        fetch(apiUrl("/overview"), { cache: "no-store" }),
        fetch(apiUrl("/changes", { window: "24h", universe: "core", limit: 1 }), { cache: "no-store" }),
        fetch(apiUrl("/styfi", { days: "30", epoch_limit: "4" }), { cache: "no-store" }),
      ]);
      if (!active) return;

      if (overviewResult.status === "fulfilled" && overviewResult.value.ok) {
        setOverview((await overviewResult.value.json()) as OverviewResponse);
      }
      if (moversResult.status === "fulfilled" && moversResult.value.ok) {
        setChanges((await moversResult.value.json()) as ChangesResponse);
      }
      if (styfiResult.status === "fulfilled" && styfiResult.value.ok) {
        setStyfi((await styfiResult.value.json()) as StYfiHomeResponse);
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

  const topMover = featuredMover(changes);
  const liveFreshnessLine = liveMeta(
    changes?.summary?.avg_delta ?? null,
    changes?.summary?.vaults_with_change ?? null,
    changes?.freshness?.latest_pps_age_seconds ?? null,
  );
  const topMoverName = topMover ? moverTitle(topMover) : "Syncing";
  const liveShiftHref =
    topMover?.vault_address && topMover?.chain_id !== null && topMover?.chain_id !== undefined
      ? yearnVaultUrl(Number(topMover.chain_id), topMover.vault_address)
      : null;
  const liveShiftValue = Number.isFinite(topMover?.delta_apy ?? null) ? pctDelta(topMover?.delta_apy, 2) : "n/a";
  const liveShiftApy = topMover ? formatPct(topMover?.safe_apy_30d ?? null, 2) : "n/a";
  const staleRatio = overview?.freshness?.pps_stale_ratio ?? null;
  const freshRatio = staleRatio !== null && staleRatio !== undefined ? Math.max(0, 1 - staleRatio) : null;
  const currentYearnNote =
    overview?.protocol_context?.current_yearn?.vaults !== null &&
    overview?.protocol_context?.current_yearn?.vaults !== undefined &&
    Number.isFinite(overview?.protocol_context?.current_yearn?.vaults)
      ? `${overview?.protocol_context?.current_yearn?.vaults} active visible current-scope vaults`
      : "Deduped active visible current-scope Yearn inventory";
  const totalYearnNote =
    overview?.protocol_context?.total_yearn?.vaults !== null &&
    overview?.protocol_context?.total_yearn?.vaults !== undefined &&
    Number.isFinite(overview?.protocol_context?.total_yearn?.vaults)
      ? `${overview?.protocol_context?.total_yearn?.vaults} active Yearn vaults including hidden, retired, and Fantom`
      : "Deduped full Yearn inventory";
  const styfiTotalYfi = formatTokenCompact(styfi?.summary?.combined_staked ?? null, "YFI");
  const styfiApr = formatPct(styfi?.current_reward_state?.styfi_current_apr ?? null, 2);

  return (
    <main className="container home-overview">
      <section className="card home-overview-hero">
        <div className="home-overview-hero-copy">
          <h1>Clear signals for faster vault decisions</h1>
          <p>Move from signal to route without wading through repeated chrome or guesswork.</p>
          <div className="home-overview-hero-highlights" aria-label="Overview highlights">
            <div className="home-overview-hero-highlight">
              <span className="home-overview-hero-highlight-label">Current TVL</span>
              <span className="home-overview-hero-highlight-value">
                {formatUsdCompact(overview?.protocol_context?.current_yearn?.tvl_usd ?? null, 1)}
              </span>
            </div>
            <div className="home-overview-hero-highlight">
              <span className="home-overview-hero-highlight-label">Freshness</span>
              <span className="home-overview-hero-highlight-value">
                {formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1)}
              </span>
            </div>
            <div className="home-overview-hero-highlight">
              <span className="home-overview-hero-highlight-label">stYFI</span>
              <span className="home-overview-hero-highlight-value">{styfiTotalYfi}</span>
            </div>
          </div>
          <div className="home-minimal-cta-row">
            <Link href="/discover" className="home-lite-cta primary">Start in Discover</Link>
            <Link href="/changes" className="home-lite-cta">Check Changes</Link>
            <Link href="/assets" className="home-lite-cta">Compare Assets</Link>
          </div>
          <p className="home-overview-hero-meta">{liveFreshnessLine}</p>
        </div>
        <div className="home-overview-hero-art" aria-hidden="true">
          <Image
            src="/home-assets-yearn-blender/hero-yearn-blender-coins.png"
            alt=""
            fill
            priority
            sizes="(max-width: 1100px) 100vw, 46vw"
            className="home-art-image home-overview-hero-image"
            draggable={false}
          />
        </div>
      </section>

      <section className="card section-card home-overview-route-section">
        <div className="home-overview-section-head">
          <p className="home-kicker">Explore The Suite</p>
          <h2>Every primary destination is visible from the front door</h2>
          <p className="card-intro">
            Pick the page that matches your question: scan, compare, time, inspect concentration, follow behavior, compare chains,
            or check staking context.
          </p>
        </div>
        <div className="home-overview-route-grid">
          {HOME_ROUTE_CARDS.map((card, index) => (
            <Link
              key={card.href}
              href={card.href}
              className={`card home-route-clickable home-overview-route-card${index === 0 ? " is-featured" : ""}`}
            >
              <p className="home-overview-route-eyebrow">{card.eyebrow}</p>
              <div className="home-route-head">
                <h2>{card.title}</h2>
              </div>
              <p className="muted">{card.description}</p>
              <p className="home-overview-route-note">{card.note}</p>
              <span className="home-route-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card analyst-only section-card home-overview-analyst-section">
        <div className="home-overview-section-head">
          <p className="home-kicker">Live Analyst View</p>
          <h2>Keep the front door actionable when you already know the workflow</h2>
          <p className="card-intro">Analyst mode surfaces current movement, coverage quality, and staking context instead of onboarding guidance.</p>
        </div>
        <div className="home-overview-analyst-grid">
          <article className="home-overview-analyst-card" aria-live="polite">
            <p className="home-kicker">Latest Shift</p>
            <p className="home-overview-summary-value">{liveShiftValue}</p>
            <p className="home-overview-summary-note">
              {liveShiftHref ? (
                <a href={liveShiftHref} target="_blank" rel="noopener noreferrer" className="home-overview-summary-link">
                  {topMoverName}
                </a>
              ) : (
                topMoverName
              )}{" "}
              · 30d APY now {liveShiftApy}
            </p>
            <p className="home-overview-summary-meta">{liveFreshnessLine}</p>
          </article>
          <article className="home-overview-analyst-card">
            <p className="home-kicker">Coverage Quality</p>
            <p className="home-overview-summary-value">{formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1)}</p>
            <p className="home-overview-summary-note">Latest PPS age in tracked scope.</p>
            <ShareMeter
              title=""
              embedded
              total={1}
              segments={[
                {
                  id: "fresh",
                  label: "Fresh",
                  value: freshRatio,
                  note: staleRatio !== null && staleRatio !== undefined ? `${formatPct(freshRatio, 0)} within 24h cutoff` : "Coverage syncing",
                  tone: "positive",
                },
                {
                  id: "stale",
                  label: "Stale",
                  value: staleRatio,
                  note: staleRatio !== null && staleRatio !== undefined ? `${formatPct(staleRatio, 0)} past 24h cutoff` : "Stale share syncing",
                  tone: "warning",
                },
              ]}
              valueFormatter={(value) => formatPct(value, 0)}
            />
          </article>
          <article className="home-overview-analyst-card">
            <p className="home-kicker">Staking Context</p>
            <p className="home-overview-summary-value">{styfiTotalYfi}</p>
            <p className="home-overview-summary-note">Combined YFI currently staked across stYFI and stYFIx.</p>
            <p className="home-overview-summary-meta">Current reward run-rate {styfiApr}</p>
          </article>
        </div>
      </section>

      <section className="home-overview-summary">
        <article className="card home-overview-summary-card">
          <p className="home-kicker">Current Yearn TVL</p>
          <p className="home-overview-summary-value">{formatUsd(overview?.protocol_context?.current_yearn?.tvl_usd ?? null, 0)}</p>
          <p className="home-overview-summary-note">{currentYearnNote}. Deduped across multi/single overlap.</p>
        </article>
        <article className="card home-overview-summary-card">
          <p className="home-kicker">Total Yearn TVL</p>
          <p className="home-overview-summary-value">{formatUsd(overview?.protocol_context?.total_yearn?.tvl_usd ?? null, 0)}</p>
          <p className="home-overview-summary-note">{totalYearnNote}. Uses the same deduped accounting rule.</p>
        </article>
        <article className="card home-overview-summary-card home-overview-meter-card">
          <p className="home-kicker">Data Freshness</p>
          <p className="home-overview-summary-value">{formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1)}</p>
          <p className="home-overview-summary-note">Latest PPS age in tracked scope.</p>
          <ShareMeter
            title=""
            embedded
            total={1}
            segments={[
              {
                id: "fresh",
                label: "Fresh",
                value: freshRatio,
                note: staleRatio !== null && staleRatio !== undefined ? `${formatPct(freshRatio, 0)} within 24h cutoff` : "Coverage syncing",
                tone: "positive",
              },
              {
                id: "stale",
                label: "Stale",
                value: staleRatio,
                note: staleRatio !== null && staleRatio !== undefined ? `${formatPct(staleRatio, 0)} past 24h cutoff` : "Stale share syncing",
                tone: "warning",
              },
            ]}
            valueFormatter={(value) => formatPct(value, 0)}
          />
        </article>
        <article className="card home-overview-summary-card home-overview-live-card" aria-live="polite">
          <p className="home-kicker">Latest Shift</p>
          <p className="home-overview-summary-value">{liveShiftValue}</p>
          <p className="home-overview-summary-note">
            {liveShiftHref ? (
              <a href={liveShiftHref} target="_blank" rel="noopener noreferrer" className="home-overview-summary-link">
                {topMoverName}
              </a>
            ) : (
              topMoverName
            )}{" "}
            · 30d APY now {liveShiftApy}
          </p>
          <p className="home-overview-summary-meta">{liveFreshnessLine}</p>
        </article>
        <article className="card home-overview-summary-card">
          <p className="home-kicker">stYFI Total YFI</p>
          <p className="home-overview-summary-value">{styfiTotalYfi}</p>
          <p className="home-overview-summary-note">Combined YFI currently staked across stYFI and stYFIx.</p>
        </article>
        <article className="card home-overview-summary-card">
          <p className="home-kicker">stYFI APR</p>
          <p className="home-overview-summary-value">{styfiApr}</p>
          <p className="home-overview-summary-note">Current stYFI reward run-rate from the latest on-chain reward state.</p>
        </article>
      </section>

      <section className="card guide-only section-card home-overview-playbooks">
        <div className="home-overview-section-head">
          <p className="home-kicker">How To Use It</p>
          <h2>Move from scan to conviction without leaving the dashboard</h2>
          <p className="card-intro">The fastest path is to scan first, pressure-test second, and monitor behavior last.</p>
        </div>
        <div className="home-overview-playbook-grid">
          {HOME_PLAYBOOKS.map((playbook) => (
            <article key={playbook.step} className="home-overview-playbook-card">
              <p className="home-overview-step-index">{playbook.step}</p>
              <h3>{playbook.title}</h3>
              <p className="muted">{playbook.body}</p>
              <div className="home-overview-playbook-links">
                {playbook.links.map((link) => (
                  <Link key={link.href} href={link.href} className="home-lite-cta">
                    {link.label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card section-card home-overview-context">
        <div className="home-overview-context-art" aria-hidden="true">
          <Image
            src="/home-assets-yearn-blender/purpose-yearn-blender-coins.png"
            alt=""
            fill
            sizes="(max-width: 1100px) 100vw, 34vw"
            className="home-art-image home-overview-context-image"
            draggable={false}
          />
        </div>
        <div className="home-overview-context-copy">
          <p className="home-kicker">Read The Numbers</p>
          <h2>Start with trust, then drill down</h2>
          <div className="home-overview-context-list">
            <article className="home-overview-context-item">
              <h3>Check freshness before acting</h3>
              <p className="muted">Use the freshness card and the Changes page to separate real movement from stale data.</p>
            </article>
            <article className="home-overview-context-item">
              <h3>Keep scope comparisons aligned</h3>
              <p className="muted">The overview TVL cards use deduped Yearn accounting, so compare filtered views against the right scope.</p>
            </article>
            <article className="home-overview-context-item">
              <h3>Use the page built for the question</h3>
              <p className="muted">Discover and Changes answer &quot;what moved?&quot; Assets, Composition, Regimes, and Chains answer &quot;why should I care?&quot;.</p>
            </article>
          </div>
        </div>
      </section>

      <footer className="card home-minimal-footer">
        <p className="home-minimal-footer-title">Official channels</p>
        <div className="home-minimal-footer-links">
          <a href="https://yearn.fi" target="_blank" rel="noopener noreferrer">Yearn</a>
          <a href="https://x.com/yearnfi" target="_blank" rel="noopener noreferrer">X / Twitter</a>
        </div>
      </footer>
    </main>
  );
}
