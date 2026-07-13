"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { KpiCardSkeleton } from "./components/skeleton";
import { useHomeData, type HomeMover } from "./hooks/use-home-data";
import { formatPct, formatUsd, yearnVaultUrl } from "./lib/format";

function signedPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? null)) return "n/a";
  const points = (value ?? 0) * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(2)} pp`;
}

function moverName(row: HomeMover | undefined): string {
  return row?.symbol?.trim() || row?.token_symbol?.trim() || "No comparable move";
}

function MoverLink({ row }: { row: HomeMover | undefined }) {
  const url = row?.vault_address && row.chain_id != null ? yearnVaultUrl(row.chain_id, row.vault_address) : null;
  return url ? <a className="external-link text-accent" href={url} target="_blank" rel="noreferrer">{moverName(row)}</a> : <>{moverName(row)}</>;
}

export default function HomePage() {
  const { data, isLoading } = useHomeData();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const riser = data?.changes?.movers?.risers?.[0];
  const faller = data?.changes?.movers?.fallers?.[0];
  const opportunity = data?.assets?.rows?.find((row) => Number.isFinite(row.realized_spread_30d));
  const protocolTvl = data?.overview?.protocol_context?.protocol?.tvl_usd;
  const vaultCount = data?.overview?.protocol_context?.catalog?.active_yearn?.vaults;
  const summary = data?.changes?.summary;

  return (
    <div className={`transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}>
      <section className="page-header page-header-hero page-header-no-border">
        <div>
          <h1 className="page-title">See where Yearn yield<br /><em className="page-title-accent">is moving</em></h1>
          <p className="page-description">
            Compare like assets, follow realized-yield changes, and understand where Yearn&apos;s vault TVL is concentrated.
          </p>
          <div className="tab-bar-plain">
            <Link href="/explore" className="button button-primary">Compare vaults</Link>
            <Link href="/momentum" className="button button-secondary">Follow momentum</Link>
          </div>
        </div>
        <div className="hero-image">
          <Image src="/home-assets-yearn-blender/hero-yearn-blender-coins.png" alt="Yearn Finance" width={500} height={320} priority style={{ objectFit: "contain" }} />
        </div>
      </section>

      <section className="section section-lg">
        <div className="card-header"><div><h2 className="card-title">This week</h2><p className="card-subtitle">Realized APY, compared with the preceding seven-day window</p></div></div>
        {isLoading ? <div className="kpi-grid kpi-grid-3"><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /></div> : (
          <div className="kpi-grid kpi-grid-3">
            <div className="kpi-card">
              <div className="kpi-label">Strongest riser</div>
              <div className="kpi-value kpi-value-md"><MoverLink row={riser} /></div>
              <div className="kpi-hint">{signedPercent(riser?.delta_apy)} · now {formatPct(riser?.realized_apy_30d ?? null, 2)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Largest faller</div>
              <div className="kpi-value kpi-value-md"><MoverLink row={faller} /></div>
              <div className="kpi-hint">{signedPercent(faller?.delta_apy)} · now {formatPct(faller?.realized_apy_30d ?? null, 2)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Largest venue spread</div>
              <div className="kpi-value kpi-value-md">{opportunity ? <Link className="text-accent" href={`/explore?tab=venues&token=${encodeURIComponent(opportunity.token_symbol)}`}>{opportunity.token_symbol}</Link> : "n/a"}</div>
              <div className="kpi-hint">{formatPct(opportunity?.realized_spread_30d ?? null, 2)} across {opportunity?.venues ?? 0} exact-symbol venues</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header"><div><h2 className="card-title">Market context</h2><p className="card-subtitle">Protocol size and the direction of comparable established vaults</p></div></div>
        {isLoading ? <div className="kpi-grid kpi-grid-3"><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /></div> : (
          <div className="kpi-grid kpi-grid-3">
            <div className="kpi-card"><div className="kpi-label">Yearn protocol TVL</div><div className="kpi-value">{formatUsd(protocolTvl ?? null, 0, false)}</div><div className="kpi-hint">Yearn-reported total · {vaultCount ?? "n/a"} active catalog vaults</div></div>
            <div className="kpi-card"><div className="kpi-label">TVL-weighted change</div><div className="kpi-value">{signedPercent(summary?.tvl_weighted_delta)}</div><div className="kpi-hint">Across {summary?.vaults_with_change ?? 0} comparable vaults</div></div>
            <div className="kpi-card"><div className="kpi-label">Direction</div><div className="kpi-value kpi-value-md">{summary?.riser_vaults ?? 0} rising · {summary?.faller_vaults ?? 0} falling</div><div className="kpi-hint">{formatUsd(summary?.riser_tvl_usd ?? null, 0, false)} rising TVL · {formatUsd(summary?.faller_tvl_usd ?? null, 0, false)} falling</div></div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header"><h2 className="card-title">Go deeper</h2></div>
        <div className="card-grid">
          {[
            { href: "/explore", title: "Explore", desc: "Screen vaults or compare venues sharing an exact token symbol.", tag: "Choose" },
            { href: "/momentum", title: "Momentum", desc: "See which realized yields are strengthening or weakening.", tag: "Time" },
            { href: "/structure", title: "Structure", desc: "Understand concentration by market, chain, and asset.", tag: "Size" },
            { href: "/harvests", title: "Reports", desc: "Inspect recent strategy gains, losses, fees, and debt updates.", tag: "Verify" },
            { href: "/styfi", title: "stYFI", desc: "Track participation, reward allocation, and epochs.", tag: "Stake" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="hover-card card-grid-link">
              <div className="card-grid-link-head"><span className="card-grid-link-title">{item.title}</span><span className="card-grid-link-tag">{item.tag}</span></div>
              <p className="card-grid-link-desc">{item.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
