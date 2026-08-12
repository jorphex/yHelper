"use client";

import Image from "next/image";
import Link from "next/link";
import { useHomeData, type HomeMover, type HomeReport } from "./hooks/use-home-data";
import { formatPct, formatUsd, formatUtcDateTime, yearnVaultUrl } from "./lib/format";

function signedPoints(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? null)) return "n/a";
  const points = (value ?? 0) * 100;
  return `${points > 0 ? "+" : points < 0 ? "−" : ""}${Math.abs(points).toFixed(2)} pp`;
}

function ageLabel(seconds: number | null | undefined): string | null {
  if (!Number.isFinite(seconds ?? null)) return null;
  const value = Math.max(0, seconds ?? 0);
  if (value < 3_600) return `${Math.max(1, Math.round(value / 60))}m ago`;
  if (value < 86_400) return `${Math.max(1, Math.round(value / 3_600))}h ago`;
  return `${Math.max(1, Math.round(value / 86_400))}d ago`;
}

function absoluteMove(row: HomeMover | undefined): number {
  if (!Number.isFinite(row?.delta_apy ?? null)) return Number.NEGATIVE_INFINITY;
  return Math.abs(row?.delta_apy ?? 0);
}

function moverName(row: HomeMover | undefined): string {
  return row?.symbol?.trim() || row?.token_symbol?.trim() || "Vault yield";
}

function reportDirection(report: HomeReport): string {
  if (report.loss && Number(report.loss) > 0) return "reported a realized loss";
  if (report.gain && Number(report.gain) > 0) return "reported a realized gain";
  return "posted a meaningful strategy report";
}

export default function HomePage() {
  const { data, isLoading } = useHomeData();
  const riser = data?.changes?.movers?.risers?.[0];
  const faller = data?.changes?.movers?.fallers?.[0];
  const pulse = data?.pulse?.pulse;
  const freshnessLimit = (pulse?.freshness_window_hours ?? 48) * 3_600;
  const freshRiser = (riser?.age_seconds ?? Number.POSITIVE_INFINITY) <= freshnessLimit ? riser : undefined;
  const freshFaller = (faller?.age_seconds ?? Number.POSITIVE_INFINITY) <= freshnessLimit ? faller : undefined;
  const mover = absoluteMove(freshRiser) >= absoluteMove(freshFaller) ? freshRiser : freshFaller;
  const report = data?.reports?.recent?.[0];
  const styfiSummary = data?.styfi?.summary;
  const styfiReward = data?.styfi?.current_reward_state;
  const protocol = data?.overview?.protocol;
  const styfiAge = ageLabel(data?.styfi?.freshness?.latest_snapshot_age_seconds);
  const pulseAge = ageLabel(pulse?.latest_data_at ? Math.max(0, (Date.now() - Date.parse(pulse.latest_data_at)) / 1_000) : null);
  const pulseStatement = pulse?.data_state === "ready"
    ? `Core realized yield is ${pulse.trend === "improving" ? "strengthening" : pulse.trend === "softening" ? "softening" : "steady"}`
    : pulse?.data_state === "limited"
      ? "The core comparison has limited coverage"
      : pulse?.data_state === "delayed"
        ? "Core yield data is delayed"
        : "Current market direction is syncing";

  return (
    <div>
      <section className="page-header page-header-hero page-header-no-border">
        <div>
          <div className="scope-label">Current Yearn brief</div>
          <h1 className="page-title">What changed<br /><em className="page-title-accent">and where to look</em></h1>
          <p className="page-description">
            A concise route into meaningful vault movements, strategy reports, and stYFI activity—with the evidence and freshness needed to inspect them.
          </p>
          <div className="tab-bar-plain">
            <Link href="/markets" className="button button-primary">Inspect markets</Link>
            <Link href="/reports" className="button button-secondary">Verify reports</Link>
          </div>
          {protocol?.tvl_usd != null && protocol.freshness_status === "fresh" ? (
            <p className="hero-context">Yearn website TVL {formatUsd(protocol.tvl_usd, 0, false)}{protocol.fetched_at ? ` · source fetched ${formatUtcDateTime(protocol.fetched_at)}` : ""}</p>
          ) : null}
        </div>
        <div className="hero-image">
          <Image src="/home-assets-yearn-blender/hero-yearn-blender-coins.png" alt="Yearn Finance" width={500} height={320} priority style={{ objectFit: "contain" }} />
        </div>
      </section>

      <section className="section section-lg" aria-labelledby="brief-title">
        <div className="card-header">
          <div>
            <h2 className="card-title" id="brief-title">Worth inspecting now</h2>
            <p className="card-description">
              {pulseStatement}{pulse?.data_state === "ready" && pulse.directional_tvl_ratio != null ? ` across ${Math.round(pulse.directional_tvl_ratio * 100)}% of comparable TVL` : ""}{pulseAge ? ` · source PPS ${pulseAge}` : ""}.
            </p>
          </div>
        </div>

        {isLoading ? <div className="brief-list"><div className="brief-item skeleton" /><div className="brief-item skeleton" /><div className="brief-item skeleton" /></div> : (
          <div className="brief-list">
            {mover ? (
              <article className="brief-item">
                <div className="brief-kicker">Vault yield · 7d vs preceding 7d · source PPS {ageLabel(mover.age_seconds) || "age unavailable"}</div>
                <div className="brief-content">
                  <div>
                    <h3 className="brief-title">{moverName(mover)} moved {signedPoints(mover.delta_apy)}</h3>
                    <p className="brief-description">Current realized APY {formatPct(mover.realized_apy_window, 2)} · tracked TVL {formatUsd(mover.tvl_usd)}. This is the largest absolute move in the established set, not a recommendation.</p>
                  </div>
                  <div className="brief-actions">
                    {mover.chain_id != null && mover.vault_address ? <a href={yearnVaultUrl(mover.chain_id, mover.vault_address)} target="_blank" rel="noreferrer">Inspect vault</a> : null}
                    {mover.token_symbol ? <Link href={`/explore?tab=compare&token=${encodeURIComponent(mover.token_symbol)}`}>Compare {mover.token_symbol}</Link> : null}
                  </div>
                </div>
              </article>
            ) : null}

            {report ? (
              <article className="brief-item">
                <div className="brief-kicker">Latest realized report · {formatUtcDateTime(report.block_time)}</div>
                <div className="brief-content">
                  <div>
                    <h3 className="brief-title">{report.vault_symbol || "A Yearn vault"} {reportDirection(report)}</h3>
                    <p className="brief-description">{report.strategy_name || "Strategy report"}. Open the ledger to verify the transaction, gain or loss, fees, and debt after the update.</p>
                  </div>
                  <div className="brief-actions"><Link href={`/reports?vault_address=${encodeURIComponent(report.vault_address)}`}>Open report evidence</Link></div>
                </div>
              </article>
            ) : null}

            {styfiReward || styfiSummary ? (
              <article className="brief-item">
                <div className="brief-kicker">stYFI · snapshot {styfiAge || "age unavailable"}</div>
                <div className="brief-content">
                  <div>
                    <h3 className="brief-title">Epoch {styfiReward?.epoch ?? styfiSummary?.reward_epoch ?? "—"} · {formatPct(styfiReward?.styfi_current_apr, 2)} APR</h3>
                    <p className="brief-description">{styfiSummary?.combined_staked != null ? `${styfiSummary.combined_staked.toLocaleString("en-US", { maximumFractionDigits: 1 })} YFI participating. ` : ""}Inspect reward allocation, stake flows, recent actions, and epoch history.</p>
                  </div>
                  <div className="brief-actions"><Link href="/styfi">Open stYFI evidence</Link></div>
                </div>
              </article>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
