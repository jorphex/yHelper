"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chainLabel, formatHours, formatPct, formatUsd, yearnVaultUrl } from "./lib/format";
import { ShareMeter } from "./components/visuals";
import { KpiCardSkeleton } from "./components/skeleton";
import { useHomeData } from "./hooks/use-home-data";

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

type SocialPreviewResponse = {
  highest_apy_vault?: {
    vault_address?: string | null;
    name?: string | null;
    symbol?: string | null;
    chain_id?: number | null;
    tvl_usd?: number | null;
    current_net_apy?: number | null;
    safe_apy_30d?: number | null;
  } | null;
};

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
    body: "Start in Discover to rank the universe, then confirm the move in Changes before treating it as actionable.",
    links: [
      { href: "/discover", label: "Discover" },
      { href: "/changes", label: "Changes" },
    ],
  },
  {
    step: "02",
    title: "Pressure-test the idea",
    body: "Use Assets, Composition, and Chains to check spread, concentration, and chain context before sizing up.",
    links: [
      { href: "/assets", label: "Assets" },
      { href: "/composition", label: "Composition" },
      { href: "/chains", label: "Chains" },
    ],
  },
  {
    step: "03",
    title: "Monitor behavior over time",
    body: "Use Regimes for state changes and stYFI when the job shifts from scanning to ongoing monitoring.",
    links: [
      { href: "/regimes", label: "Regimes" },
      { href: "/styfi", label: "stYFI" },
    ],
  },
] as const;

const HOME_SUPPORT_ROUTE_CARDS = HOME_ROUTE_CARDS.filter((card) => !["/discover", "/changes"].includes(card.href));

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

function formatUsdCompact(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function compactTitle(value: string | null | undefined, max = 18): string {
  if (!value || value.trim().length === 0) return "Syncing";
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(3, max - 1))}…`;
}

export default function HomePage() {
  const { data, isLoading, error, refetch } = useHomeData();
  const [revealed, setRevealed] = useState(false);
  
  // Destructure data for easier access
  const overview = data?.overview ?? null;
  const changes = data?.changes ?? null;
  const styfi = data?.styfi ?? null;
  const socialPreview = data?.socialPreview ?? null;

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => setRevealed(true));
    return () => window.cancelAnimationFrame(frame);
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
  const universeMoveValue = Number.isFinite(changes?.summary?.avg_delta ?? null) ? pctDelta(changes?.summary?.avg_delta, 2) : "n/a";
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
  const styfiApr = formatPct(styfi?.current_reward_state?.styfi_current_apr ?? null, 2);
  const highestYieldVault = socialPreview?.highest_apy_vault ?? null;
  const highestYieldHref =
    highestYieldVault?.vault_address && highestYieldVault?.chain_id !== null && highestYieldVault?.chain_id !== undefined
      ? yearnVaultUrl(Number(highestYieldVault.chain_id), highestYieldVault.vault_address)
      : null;
  const highestYieldName = compactTitle(highestYieldVault?.name ?? highestYieldVault?.symbol ?? null);
  const highestYieldApy = formatPct(highestYieldVault?.current_net_apy ?? highestYieldVault?.safe_apy_30d ?? null, 1);
  const highestYieldMeta = highestYieldVault
    ? `${chainLabel(highestYieldVault.chain_id ?? null)} · Net APY ${highestYieldApy} · TVL ${formatUsdCompact(highestYieldVault.tvl_usd ?? null, 1)}`
    : "Highest APY syncing";
  const currentYearnVaultCount =
    overview?.protocol_context?.current_yearn?.vaults !== null &&
    overview?.protocol_context?.current_yearn?.vaults !== undefined &&
    Number.isFinite(overview?.protocol_context?.current_yearn?.vaults)
      ? `${overview?.protocol_context?.current_yearn?.vaults}`
      : "n/a";
  const revealClass = revealed ? " home-reveal is-visible" : " home-reveal";

  return (
    <main className="container home-overview">
      <section className={`home-overview-hero${revealClass}`}>
        <div className="home-overview-hero-copy">
          <div className="home-overview-hero-eyebrow">Yearn Vault Analytics</div>
          <h1>
            Clear signals for <span className="highlight">faster</span> vault decisions
          </h1>
          <p className="home-overview-hero-lead">
            Move from signal to route without wading through repeated chrome or guesswork. 
            Purpose-built analytics for Yearn vault discovery, yield shifts, and strategic decisions.
          </p>
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
              <span className="home-overview-hero-highlight-label">Core 24h Move</span>
              <span className="home-overview-hero-highlight-value">{universeMoveValue}</span>
            </div>
          </div>
          <div className="home-minimal-cta-row">
            <Link href="/discover" className="home-lite-cta primary">Start in Discover</Link>
            <Link href="/changes" className="home-lite-cta">Check Changes</Link>
          </div>
          <p className="home-overview-hero-meta">{liveFreshnessLine}</p>
        </div>
        <div className="home-overview-hero-art" aria-hidden="true">
          <Image
            src="/home-assets-yearn-blender/hero-yearn-blender-coins.png"
            alt=""
            fill
            priority
            sizes="(max-width: 1100px) 100vw, 40vw"
            className="home-art-image home-overview-hero-image"
            draggable={false}
          />
        </div>
      </section>

      <section className={`card section-card home-overview-flow-section${revealClass}`}>
        <div className="home-overview-section-head">
          <p className="home-kicker">How to use</p>
          <h2>Shortlist first. Then pressure-test when the move looks real.</h2>
          <p className="card-intro">
            Discover answers whether anything deserves attention. Changes confirms that the move is fresh and actionable.
          </p>
        </div>
        <div className="home-overview-flow-grid">
          <article className="home-overview-flow-card">
            <div className="home-overview-flow-card-head">
              <p className="home-kicker">Use This Order</p>
              <p className="muted">Keep the first pass narrow. Branch out only when the question changes.</p>
            </div>
            <div className="home-overview-flow-steps">
              {HOME_PLAYBOOKS.map((playbook) => (
                <article key={playbook.step} className="home-overview-flow-step">
                  <p className="home-overview-step-index">{playbook.step}</p>
                  <div className="home-overview-flow-step-copy">
                    <h3>{playbook.title}</h3>
                    <p className="muted">{playbook.body}</p>
                  </div>
                  <div className="home-overview-flow-step-links">
                    {playbook.links.map((link) => (
                      <Link key={link.href} href={link.href} className="home-lite-cta">
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </article>
          <aside className="home-overview-support-card">
            <p className="home-kicker">Branch Out When Needed</p>
            <p className="muted">Open these only when the shortlist already looks worth deeper work.</p>
            <div className="home-overview-support-links">
              {HOME_SUPPORT_ROUTE_CARDS.map((card) => (
                <Link key={card.href} href={card.href} className="home-overview-support-link">
                  <span className="home-overview-support-link-title">{card.title}</span>
                  <span className="home-overview-support-link-note">{card.note}</span>
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className={`card section-card home-overview-analyst-section${revealClass}`}>
        <div className="home-overview-section-head">
          <p className="home-kicker">Live Data</p>
          <h2>Real-time signals for informed decisions</h2>
          <p className="card-intro">Current movement, coverage quality, and yield leadership at a glance. For analysts who know the workflow.</p>
        </div>
        <div className="home-overview-analyst-grid">
          {isLoading ? (
            <>
              <KpiCardSkeleton />
              <KpiCardSkeleton />
              <KpiCardSkeleton />
            </>
          ) : (
            <>
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
                <p className="home-overview-summary-value">{formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1, false)}</p>
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
                <p className="home-kicker">Highest Yield</p>
                <p className="home-overview-summary-value home-overview-name-value">
                  {highestYieldHref ? (
                    <a href={highestYieldHref} target="_blank" rel="noopener noreferrer" className="home-overview-summary-link">
                      {highestYieldName}
                    </a>
                  ) : (
                    highestYieldName
                  )}
                </p>
                <p className="home-overview-summary-note">Current highest-yielding live vault in visible multi-strategy v3 scope.</p>
                <p className="home-overview-summary-meta">{highestYieldMeta}</p>
              </article>
            </>
          )}
        </div>
      </section>

      <section className={`home-overview-summary${revealClass}`}>
        {isLoading ? (
          <>
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </>
        ) : (
          <>
            <article className="card home-overview-summary-card">
              <p className="home-kicker">Current Yearn TVL</p>
              <p className="home-overview-summary-value">{formatUsd(overview?.protocol_context?.current_yearn?.tvl_usd ?? null, 0, false)}</p>
              <p className="home-overview-summary-note">{currentYearnNote}. Deduped across multi/single overlap.</p>
            </article>
            <article className="card home-overview-summary-card home-overview-meter-card">
              <p className="home-kicker">Data Freshness</p>
              <p className="home-overview-summary-value">{formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1, false)}</p>
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
              <p className="home-kicker">stYFI APR</p>
              <p className="home-overview-summary-value">{styfiApr}</p>
              <p className="home-overview-summary-note">Current stYFI reward run-rate from the latest on-chain reward state.</p>
            </article>
          </>
        )}
      </section>

      <section className={`home-overview-summary-compact${revealClass}`}>
        {isLoading ? (
          <>
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </>
        ) : (
          <>
            <article className="card home-overview-summary-card">
              <p className="home-kicker">Current Yearn TVL</p>
              <p className="home-overview-summary-value">{formatUsd(overview?.protocol_context?.current_yearn?.tvl_usd ?? null, 0, false)}</p>
              <p className="home-overview-summary-note">{currentYearnNote}. Deduped across multi/single overlap.</p>
            </article>
            <article className="card home-overview-summary-card">
              <p className="home-kicker">Current Vaults</p>
              <p className="home-overview-summary-value">{currentYearnVaultCount}</p>
              <p className="home-overview-summary-note">Active visible current-scope vaults in the deduped live Yearn universe.</p>
            </article>
          </>
        )}
      </section>

      <footer className={`card home-minimal-footer${revealClass}`}>
        <p className="home-minimal-footer-title">Official channels</p>
        <div className="home-minimal-footer-links">
          <a href="https://yearn.fi" target="_blank" rel="noopener noreferrer">Yearn</a>
          <a href="https://x.com/yearnfi" target="_blank" rel="noopener noreferrer">X / Twitter</a>
        </div>
      </footer>
    </main>
  );
}
