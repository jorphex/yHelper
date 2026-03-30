"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chainLabel, formatHours, formatPct, formatUsd, yearnVaultUrl } from "./lib/format";
import { KpiCardSkeleton } from "./components/skeleton";
import { useHomeData } from "./hooks/use-home-data";

type ChangeMoverRow = {
  vault_address?: string | null;
  chain_id?: number | null;
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  safe_apy_30d?: number | null;
};

function pctDelta(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const signed = value * 100;
  const prefix = signed > 0 ? "+" : "";
  return `${prefix}${signed.toFixed(digits)}%`;
}

function moverTitle(row: ChangeMoverRow | undefined): string {
  if (!row) return "n/a";
  if (row.symbol?.trim()) return row.symbol.trim();
  if (row.token_symbol?.trim()) return row.token_symbol.trim();
  return "Vault";
}

function isMeaningfulMove(row: ChangeMoverRow | undefined): boolean {
  return Number.isFinite(row?.delta_apy ?? null) && Math.abs(row?.delta_apy ?? 0) >= 0.0001;
}

function featuredMover(changes: { movers?: { largest_abs_delta?: ChangeMoverRow[]; risers?: ChangeMoverRow[]; fallers?: ChangeMoverRow[] } } | null): ChangeMoverRow | undefined {
  const largest = changes?.movers?.largest_abs_delta?.[0];
  if (isMeaningfulMove(largest)) return largest;
  const riser = changes?.movers?.risers?.find((row) => isMeaningfulMove(row));
  if (riser) return riser;
  return changes?.movers?.fallers?.find((row) => isMeaningfulMove(row));
}

function compactTitle(value: string | null | undefined, max = 18): string {
  if (!value?.trim()) return "Syncing";
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(3, max - 1))}…`;
}

export default function HomePage() {
  const { data, isLoading } = useHomeData();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const overview = data?.overview ?? null;
  const changes = data?.changes ?? null;
  const styfi = data?.styfi ?? null;
  const socialPreview = data?.socialPreview ?? null;

  const topMover = featuredMover(changes);
  const topMoverName = topMover ? moverTitle(topMover) : "Syncing";
  const liveShiftHref = topMover?.vault_address && topMover?.chain_id != null
    ? yearnVaultUrl(Number(topMover.chain_id), topMover.vault_address)
    : null;
  const liveShiftValue = Number.isFinite(topMover?.delta_apy ?? null) ? pctDelta(topMover?.delta_apy, 2) : "n/a";
  const liveShiftApy = topMover ? formatPct(topMover?.safe_apy_30d ?? null, 2) : "n/a";
  const universeMoveValue = Number.isFinite(changes?.summary?.avg_delta ?? null) ? pctDelta(changes?.summary?.avg_delta, 2) : "n/a";

  const highestYieldVault = socialPreview?.highest_apy_vault ?? null;
  const highestYieldHref = highestYieldVault?.vault_address && highestYieldVault?.chain_id != null
    ? yearnVaultUrl(Number(highestYieldVault.chain_id), highestYieldVault.vault_address)
    : null;
  const highestYieldName = compactTitle(highestYieldVault?.name ?? highestYieldVault?.symbol ?? null);
  const highestYieldApy = formatPct(highestYieldVault?.current_net_apy ?? highestYieldVault?.safe_apy_30d ?? null, 1);

  const currentYearnVaultCount = Number.isFinite(overview?.protocol_context?.current_yearn?.vaults ?? null)
    ? `${overview?.protocol_context?.current_yearn?.vaults}`
    : "n/a";

  return (
    <div className={`transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* Hero Section with Yearn Logo */}
      <section className="page-header" style={{ borderBottom: 'none', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '48px', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '24px' }}>
            Clear signals.<br />
            <em className="page-title-accent">Faster decisions.</em>
          </h1>
          <p className="page-description" style={{ maxWidth: '480px', marginBottom: '32px' }}>
            Purpose-built analytics for Yearn vault discovery, yield shifts, and strategic decisions. 
            Find opportunities without wading through repeated guesswork.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Link href="/discover" className="button button-primary">
              Start in Discover
            </Link>
            <Link href="/changes" className="button button-secondary">
              Check Changes
            </Link>
          </div>
        </div>
        <div style={{ position: 'relative', height: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Image
            src="/home-assets-yearn-blender/hero-yearn-blender-coins.png"
            alt="Yearn Finance"
            width={500}
            height={320}
            priority
            style={{ objectFit: 'contain' }}
          />
        </div>
      </section>

      {/* Quick Stats Row */}
      <section className="section" style={{ marginBottom: '48px' }}>
        {isLoading ? (
          <div className="kpi-grid">
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi-card">
              <div className="kpi-label">Latest Shift</div>
              <div className="kpi-value" style={{ color: (topMover?.delta_apy ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                {liveShiftValue}
              </div>
              <div className="kpi-hint">
                {liveShiftHref ? (
                  <a href={liveShiftHref} target="_blank" rel="noopener noreferrer" className="external-link" style={{ color: 'var(--accent)' }}>
                    {topMoverName}
                  </a>
                ) : topMoverName} · 30d APY now {liveShiftApy}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Coverage Quality</div>
              <div className="kpi-value">{formatHours(overview?.freshness?.latest_pps_age_seconds ?? null, 1, false)}</div>
              <div className="kpi-hint">Latest PPS age in tracked scope</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Highest Yield</div>
              <div className="kpi-value" style={{ fontSize: '20px' }}>
                {highestYieldHref ? (
                  <a href={highestYieldHref} target="_blank" rel="noopener noreferrer" className="external-link" style={{ color: 'var(--accent)' }}>
                    {highestYieldName}
                  </a>
                ) : highestYieldName}
              </div>
              <div className="kpi-hint">{highestYieldApy} · {chainLabel(highestYieldVault?.chain_id ?? null)}</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Core 24h Move</div>
              <div className="kpi-value">{universeMoveValue}</div>
              <div className="kpi-hint">
                {Number.isFinite(changes?.summary?.vaults_with_change ?? null)
                  ? `${changes?.summary?.vaults_with_change} vaults with change`
                  : "Change count syncing"}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Protocol Overview */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Protocol Overview</h2>
        </div>
        {isLoading ? (
          <div className="kpi-grid">
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi-card">
              <div className="kpi-label">Current Yearn TVL</div>
              <div className="kpi-value">{formatUsd(overview?.protocol_context?.current_yearn?.tvl_usd ?? null, 0, false)}</div>
              <div className="kpi-hint">Active visible current-scope vaults</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Current Vaults</div>
              <div className="kpi-value">{currentYearnVaultCount}</div>
              <div className="kpi-hint">In deduped live Yearn universe</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">stYFI APR</div>
              <div className="kpi-value">{formatPct(styfi?.current_reward_state?.styfi_current_apr ?? null, 2)}</div>
              <div className="kpi-hint">Current staking rewards rate</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Total Staked</div>
              <div className="kpi-value" style={{ fontSize: '20px' }}>
                {Number.isFinite(styfi?.summary?.combined_staked ?? null)
                  ? `${Math.round((styfi?.summary?.combined_staked ?? 0)).toLocaleString()} YFI`
                  : "n/a"}
              </div>
              <div className="kpi-hint">Combined stYFI + stYFIx</div>
            </div>
          </div>
        )}
      </section>

      {/* Navigation Cards */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Explore</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {[
            { href: "/discover", title: "Discover", desc: "Rank vaults by quality, size, and trend direction.", tag: "Best first stop" },
            { href: "/changes", title: "Changes", desc: "See recent APY movers and freshness context.", tag: "Timing matters" },
            { href: "/assets", title: "Assets", desc: "Compare venues for the same token.", tag: "One-asset focus" },
            { href: "/composition", title: "Composition", desc: "Check concentration before sizing risk.", tag: "Risk sizing" },
            { href: "/regimes", title: "Regimes", desc: "Follow rising, stable, falling states.", tag: "Yield behavior" },
            { href: "/chains", title: "Chains", desc: "Compare chain scale and coverage.", tag: "Network view" },
            { href: "/styfi", title: "stYFI", desc: "Track stake balances and reward epochs.", tag: "Governance" },
          ].map((item) => (
            <Link 
              key={item.href} 
              href={item.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '20px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                textDecoration: 'none',
                transition: 'all 150ms ease-out',
              }}
              className="hover-card"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</span>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)' }}>{item.tag}</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{item.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
