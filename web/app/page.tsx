"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chainLabel, formatPct, formatUsd, yearnVaultUrl } from "./lib/format";
import { KpiCardSkeleton } from "./components/skeleton";
import { useHomeData } from "./hooks/use-home-data";
import { useDauData } from "./hooks/use-dau-data";
import { MiniLineChart } from "./components/mini-line-chart";

type ChangeMoverRow = {
  vault_address?: string | null;
  chain_id?: number | null;
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  realized_apy_30d?: number | null;
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
  const { data: dauData, isLoading: isDauLoading } = useDauData(30);
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
  const liveShiftApy = topMover ? formatPct(topMover?.realized_apy_30d ?? null, 2) : "n/a";

  const highestYieldVault = socialPreview?.highest_est_apy_vault ?? null;
  const highestYieldHref = highestYieldVault?.vault_address && highestYieldVault?.chain_id != null
    ? yearnVaultUrl(Number(highestYieldVault.chain_id), highestYieldVault.vault_address)
    : null;
  const highestYieldName = compactTitle(highestYieldVault?.name ?? highestYieldVault?.symbol ?? null);
  const highestYieldApy = formatPct(highestYieldVault?.est_apy ?? null, 1);

  const currentYearnVaultCount = Number.isFinite(overview?.protocol_context?.current_yearn?.vaults ?? null)
    ? `${overview?.protocol_context?.current_yearn?.vaults}`
    : "n/a";

  // DAU data formatting
  const dauHeadline = dauData?.trailing_24h?.dau_total ?? null;
  const dauHeadlineLabel = dauData?.metric?.headline_label ?? "Active Accounts (24h)";
  const dauChartLabel = dauData?.metric?.history_label ?? "Daily Active Accounts";
  const dauWindowLabel = dauData?.metric?.history_window_label ?? "Last 30d";
  const dauChartData = (dauData?.daily ?? [])
    .filter((d): d is { day_utc: string; dau_total: number } => !!d && typeof d.dau_total === "number")
    .map((d) => ({ x: d.day_utc, y: d.dau_total }));
  const hasDauHistory = dauChartData.some((point) => point.y > 0);
  const isDauBackfilling = dauData?.last_run?.status === "running" && !hasDauHistory;

  return (
    <div className={`transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* Hero Section with Yearn Logo */}
      <section className="page-header" style={{ borderBottom: 'none', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '48px', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">
            Find the best<br />
            <em className="page-title-accent">Yearn vaults</em>
          </h1>
          <p className="page-description">
            Move from raw yield data to calm, defensible allocation decisions in minutes. Track shifts, compare venues, and time your moves.
          </p>
          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <Link href="/explore" className="button button-primary">
              Start in Explore
            </Link>
            <Link href="/momentum" className="button button-secondary">
              Check Momentum
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
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi-card">
              <div className="kpi-label">Largest Shift</div>
              <div className={`kpi-value ${(topMover?.delta_apy ?? 0) >= 0 ? 'text-positive delta-positive' : 'text-negative delta-negative'}`}>
                {liveShiftValue}
              </div>
              <div className="kpi-hint">
                {liveShiftHref ? (
                  <a href={liveShiftHref} target="_blank" rel="noopener noreferrer" className="external-link" style={{ color: 'var(--accent)' }}>
                    {topMoverName}
                  </a>
                ) : topMoverName} · Realized APY 30d now {liveShiftApy}
              </div>
            </div>

            <div className="kpi-card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <div className="kpi-label" style={{ marginBottom: '4px' }}>{dauHeadlineLabel}</div>
                  <div className="kpi-value" style={{ fontSize: '28px', fontWeight: 700 }}>
                    {!isDauLoading && Number.isFinite(dauHeadline) ? (dauHeadline as number).toLocaleString() : "—"}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {dauWindowLabel}
                </div>
              </div>
              <div style={{ marginTop: '8px', minHeight: '50px' }}>
                {!isDauLoading && hasDauHistory && dauChartData.length >= 2 ? (
                  <MiniLineChart
                    data={dauChartData}
                    color="var(--accent, #0657E9)"
                    height={50}
                    width={280}
                    strokeWidth={2}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{
                      height: '50px',
                      borderRadius: '10px',
                      background:
                        'linear-gradient(90deg, rgba(6,87,233,0.08) 0%, rgba(6,87,233,0.16) 50%, rgba(6,87,233,0.08) 100%)',
                    }}
                  />
                )}
              </div>
              <div className="kpi-hint" style={{ marginTop: '8px' }}>
                {isDauLoading || isDauBackfilling ? 'Backfilling daily history…' : dauChartLabel}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Highest Est. APY</div>
              <div className="kpi-value" style={{ fontSize: '20px' }}>
                {highestYieldHref ? (
                  <a href={highestYieldHref} target="_blank" rel="noopener noreferrer" className="external-link" style={{ color: 'var(--accent)' }}>
                    {highestYieldName}
                  </a>
                ) : highestYieldName}
              </div>
              <div className="kpi-hint">Est. APY {highestYieldApy} · {chainLabel(highestYieldVault?.chain_id ?? null)}</div>
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
          <div className="kpi-grid home-overview-summary">
            <div className="kpi-card home-overview-summary-card">
              <div className="kpi-label">Current Yearn TVL</div>
              <div className="kpi-value">{formatUsd(overview?.protocol_context?.current_yearn?.tvl_usd ?? null, 0, false)}</div>
              <div className="kpi-hint">Active visible current-scope vaults</div>
            </div>

            <div className="kpi-card home-overview-summary-card">
              <div className="kpi-label">Current Vaults</div>
              <div className="kpi-value">{currentYearnVaultCount}</div>
              <div className="kpi-hint">In deduped live Yearn universe</div>
            </div>

            <div className="kpi-card home-overview-summary-card">
              <div className="kpi-label">stYFI APR</div>
              <div className="kpi-value">{formatPct(styfi?.current_reward_state?.styfi_current_apr ?? null, 2)}</div>
              <div className="kpi-hint">Current staking rewards rate</div>
            </div>

            <div className="kpi-card home-overview-summary-card">
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {[
            { href: "/explore", title: "Explore", desc: "Find vaults and compare token venues.", tag: "Best first stop" },
            { href: "/structure", title: "Structure", desc: "Check concentration and chain coverage.", tag: "Risk sizing" },
            { href: "/momentum", title: "Momentum", desc: "Track realized APY changes and regime shifts.", tag: "Timing matters" },
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
