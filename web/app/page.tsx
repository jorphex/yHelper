"use client";

import Link from "next/link";
import { useHomeData } from "./hooks/use-home-data";
import { formatPct, formatUsd, formatUtcDateTime } from "./lib/format";

export default function HomePage() {
  const { data, isLoading } = useHomeData();
  const staking = data?.styfi;
  const stakingAge = staking?.freshness?.latest_snapshot_age_seconds;
  const stakingFresh = stakingAge != null && stakingAge < 3600;
  const flex = data?.flex;
  const rewards = data?.rewards;
  const latestWeek = [...(rewards?.reporting_weeks ?? [])]
    .filter((week) => week.status === "finalized")
    .sort((a, b) => b.week_end.localeCompare(a.week_end))[0];
  const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="home-page">
      <header className="page-header home-header">
        <div className="scope-label">Your guide to Yearn</div>
        <h1 className="page-title">Yearn,<br /><em className="page-title-accent">made clearer</em></h1>
        <p className="page-description">Check staking rewards, explore lending markets, or follow vault activity. Start with the essentials, then open the details.</p>
        <nav className="home-shortcuts" aria-label="Product shortcuts"><Link href="/styfi">stYFI</Link><Link href="/flex">Flex</Link><Link href="/reports?view=lockers">Locker rewards</Link></nav>
      </header>

      <section className="product-grid" aria-label="Explore Yearn products">
        <article className="product-entry">
          <div className="scope-label">YFI staking</div>
          <h2><Link href="/styfi">stYFI <span aria-hidden="true">↗</span></Link></h2>
          <p>Understand staking rewards and how participation is changing.</p>
          <div className="product-snapshot" aria-live="polite">
            <span className="product-metric">{isLoading ? "Loading…" : stakingFresh ? formatPct(staking?.current_reward_state?.styfi_current_apr, 2) : "Check rewards"}</span>
            <span>{stakingFresh ? `Current stYFI APR · Epoch ${staking?.current_reward_state?.epoch ?? staking?.summary?.reward_epoch ?? "unavailable"}` : isLoading ? "Staking rewards" : staking ? "Staking snapshot is delayed" : "Staking snapshot is unavailable"}</span>
            {stakingFresh && staking?.freshness?.latest_snapshot_at ? <time dateTime={staking.freshness.latest_snapshot_at}>Updated {formatUtcDateTime(staking.freshness.latest_snapshot_at)}</time> : null}
          </div>
          <Link className="button button-primary" href="/styfi">View staking rewards</Link>
        </article>

        <article className="product-entry">
          <div className="scope-label">Lending & borrowing</div>
          <h2><Link href="/flex">Flex <span aria-hidden="true">↗</span></Link></h2>
          <p>Compare lending rates, borrowing capacity, and the health of each market.</p>
          <div className="product-snapshot" aria-live="polite">
            <span className="product-metric">{isLoading ? "Loading…" : flex?.freshness.data_state === "ready" ? `${flex.rows.filter((row) => row.status === "active").length} markets` : "Explore Flex"}</span>
            <span>{flex?.freshness.data_state === "ready" ? `${formatUsd(flex.summary.deposits_usd)} deposited in active markets` : isLoading ? "Active lending markets" : flex?.freshness.data_state === "delayed" ? "Market snapshot is delayed" : "Market snapshot is unavailable"}</span>
            {flex?.freshness.data_state === "ready" && flex.freshness.indexed_through ? <time dateTime={flex.freshness.indexed_through}>Updated {formatUtcDateTime(flex.freshness.indexed_through)}</time> : null}
          </div>
          <Link className="button button-primary" href="/flex">Explore lending markets</Link>
        </article>

        <article className="product-entry">
          <div className="scope-label">Rewards & activity</div>
          <h2><Link href="/reports?view=lockers">Rewards & reports <span aria-hidden="true">↗</span></Link></h2>
          <p>Follow yCRV and yYB reward deposits, or look up a vault&apos;s reported results.</p>
          <div className="product-snapshot" aria-live="polite">
            <span className="product-metric">{isLoading ? "Loading…" : latestWeek ? `${latestWeek.total_crvusd_at_deposit.toLocaleString("en-US", { maximumFractionDigits: 0 })} crvUSD` : "Follow rewards"}</span>
            <span>{latestWeek ? `yCRV + yYB deposits · ${date(latestWeek.week_start)}–${date(latestWeek.week_end)} UTC` : isLoading ? "Completed weekly deposits" : "Weekly snapshot is unavailable"}</span>
            <span className="product-provenance">{latestWeek ? `Value at deposit · completed week${rewards?.freshness.status !== "fresh" ? " · updates delayed" : ""}` : "Browse reward history and vault accounting"}</span>
          </div>
          <div className="product-actions"><Link className="button button-primary" href="/reports?view=lockers">View locker rewards</Link><Link className="text-link" href="/reports?view=vaults">Vault reports →</Link></div>
        </article>
      </section>

      <section className="home-research" aria-labelledby="research-title">
        <div><h2 id="research-title">Looking into a vault?</h2><p>Find a vault, compare estimated and realized yield, and explore changes over time.</p></div>
        <Link href="/markets" className="button button-secondary">Find a vault</Link>
      </section>
    </div>
  );
}
