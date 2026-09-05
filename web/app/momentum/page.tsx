"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { MarketFilter } from "../components/market-filter";
import { MarketModeNav } from "../components/market-mode-nav";
import { ScatterPlot, ShareMeter } from "../components/visuals";
import { useChangesData } from "../hooks/use-changes-data";
import { formatPct, formatPercentagePoints, formatUsd, yearnVaultUrl } from "../lib/format";
import { MARKET_VALUES, UNIVERSE_VALUES, universeDefaults, universeLabel } from "../lib/universe";
import { queryChoice, replaceQuery } from "../lib/url";
import { MoverTable } from "./components";
import type { ChangeRow } from "./types";

function comparisonLabel(window: "24h" | "7d" | "30d"): string {
  if (window === "24h") return "24 hours vs preceding 24 hours";
  if (window === "30d") return "30 days vs preceding 30 days";
  return "7 days vs preceding 7 days";
}

function ageLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return "less than a minute ago";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.max(1, Math.round(seconds / 3600))}h ago`;
  return `${Math.max(1, Math.round(seconds / 86_400))}d ago`;
}

function MomentumPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [compact, setCompact] = useState(false);
  const query = useMemo(() => {
    const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
    return {
      universe,
      market: queryChoice(searchParams, "market", MARKET_VALUES, "all"),
      window: queryChoice(searchParams, "window", ["24h", "7d", "30d"] as const, "7d"),
      ...universeDefaults(universe),
    };
  }, [searchParams]);
  const updateQuery = (updates: Record<string, string | number | null | undefined>) => replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const { data, isLoading, error, refetch } = useChangesData({
    universe: query.universe,
    market: query.market,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    window: query.window,
    staleThreshold: "auto",
  });
  if (error && !data) {
    return <div className="error-state"><h2>Markets are temporarily unavailable</h2><button className="button button-primary section-sm" onClick={() => refetch()}>Retry</button></div>;
  }

  const summary = data?.summary;
  const compared = summary?.vaults_with_change ?? 0;
  const totalTvl = summary?.tracked_tvl_usd ?? 0;
  const riserTvl = summary?.riser_tvl_usd ?? 0;
  const fallerTvl = summary?.faller_tvl_usd ?? 0;
  const neutralTvl = Math.max(0, totalTvl - riserTvl - fallerTvl);
  const breadthByVault = [
    { id: "rising", label: "Strengthening", value: summary?.riser_vaults ?? 0, note: compared ? `${formatPct((summary?.riser_vaults ?? 0) / compared, 0)} of comparable` : "n/a", tone: "positive" as const },
    { id: "falling", label: "Weakening", value: summary?.faller_vaults ?? 0, note: compared ? `${formatPct((summary?.faller_vaults ?? 0) / compared, 0)} of comparable` : "n/a", tone: "warning" as const },
    { id: "flat", label: "Unchanged", value: summary?.flat_vaults ?? 0, note: "No measured window change", tone: "muted" as const },
  ];
  const breadthByTvl = [
    { id: "rising-tvl", label: "Strengthening TVL", value: riserTvl, note: totalTvl ? `${formatPct(riserTvl / totalTvl, 0)} of compared TVL` : "n/a", tone: "positive" as const },
    { id: "falling-tvl", label: "Weakening TVL", value: fallerTvl, note: totalTvl ? `${formatPct(fallerTvl / totalTvl, 0)} of compared TVL` : "n/a", tone: "warning" as const },
    { id: "flat-tvl", label: "Unchanged TVL", value: neutralTvl, note: "No measured window change", tone: "muted" as const },
  ];

  const moverRows = [...(data?.movers?.risers ?? []), ...(data?.movers?.fallers ?? [])].filter((row, index, rows) => rows.findIndex((candidate) => candidate.chain_id === row.chain_id && candidate.vault_address === row.vault_address) === index);
  const newestMetricAge = ageLabel(data?.freshness?.newest_comparison_age_seconds);
  const currentComparisons = data?.freshness?.current_comparisons;
  const trackedComparisons = data?.freshness?.tracked_comparisons;
  const currentScopeNote = [
    newestMetricAge ? `Latest price per share (PPS) ${newestMetricAge}` : null,
    currentComparisons != null && trackedComparisons != null
      ? `${currentComparisons} of ${trackedComparisons} comparisons within the freshness window`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="markets-surface">
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Vault research<br /><em className="page-title-accent">Yield changes</em></h1>
        <p className="page-description">Realized yield compared with the preceding period.</p>
        <MarketModeNav active="changes" />
      </section>
      <section className="section section-md"><div className="card market-filter-panel"><div className="filter-grid">
        <label><span className="filter-label">Window</span><select className="filter-control" value={query.window} onChange={(event) => updateQuery({ window: event.target.value })}><option value="24h">24 hours vs prior 24 hours</option><option value="7d">7 days vs prior 7 days</option><option value="30d">30 days vs prior 30 days</option></select></label>
        <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market })} />
        <label><span className="filter-label">Vault set</span><select className="filter-control" value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}>{UNIVERSE_VALUES.map((universe) => <option key={universe} value={universe}>{universeLabel(universe)}</option>)}</select></label>
      </div></div></section>

      <section className="section section-lg">
        {isLoading ? <table className="decision-table" aria-label="Loading yield changes"><tbody><TableSkeleton rows={8} columns={6} /></tbody></table> : <>
          <MoverTable title="Yield increased" direction="strengthening" rows={(data?.movers?.risers ?? []) as ChangeRow[]} universe={query.universe} market={query.market} window={query.window} compact={compact} />
          <MoverTable title="Yield decreased" direction="weakening" rows={(data?.movers?.fallers ?? []) as ChangeRow[]} universe={query.universe} market={query.market} window={query.window} compact={compact} />
        </>}
      </section>
      <section className="detail-section"><h2 className="detail-title">Across vaults</h2><div className="detail-body">
      <section className="section section-lg analysis-scope" aria-labelledby="current-comparison-title">
        <div className="card-header"><div><div className="scope-label">Selected comparison</div><h2 className="card-title" id="current-comparison-title">{comparisonLabel(query.window)}</h2>{currentScopeNote ? <p className="card-description">{currentScopeNote}</p> : null}</div></div>
        {isLoading ? <KpiGridSkeleton count={3} /> : <div className="kpi-grid kpi-grid-3">
          <div className="kpi-card"><div className="kpi-label">Comparable vaults</div><div className="kpi-value">{compared}</div><div className="kpi-hint">{summary?.vaults_eligible ?? 0} eligible</div></div>
          <div className="kpi-card"><div className="kpi-label">Compared TVL</div><div className="kpi-value">{formatUsd(totalTvl)}</div></div>
          <div className="kpi-card"><div className="kpi-label">TVL-weighted change</div><div className={`kpi-value ${(summary?.tvl_weighted_delta ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatPercentagePoints(summary?.tvl_weighted_delta)}</div></div>
        </div>}
      </section>

      <section className="section section-lg"><div className="card-header"><div><h2 className="card-title">Change by vault and TVL</h2></div></div><div className="cols-2"><ShareMeter title="By vaults" segments={breadthByVault} total={compared} valueFormatter={(value) => String(value ?? 0)} /><ShareMeter title="By TVL" segments={breadthByTvl} total={totalTvl} valueFormatter={formatUsd} /></div></section>

      <section className="section section-lg market-scatter"><div className="card-header"><div><h2 className="card-title">Yield vs change</h2></div></div><ScatterPlot title={`Current yield against ${query.window} change`} xLabel={`${query.window} change`} yLabel={`Current ${query.window} APY`} points={moverRows.filter((row) => row.delta_apy != null && row.realized_apy_window != null).map((row) => ({ id: `${row.chain_id}:${row.vault_address}`, x: row.delta_apy, y: row.realized_apy_window, size: row.tvl_usd, tone: (row.delta_apy ?? 0) > 0 ? "positive" : "negative", href: yearnVaultUrl(row.chain_id, row.vault_address), tooltip: `${row.symbol ?? row.vault_address}\nChange: ${formatPercentagePoints(row.delta_apy)}\nCurrent: ${formatPct(row.realized_apy_window)}\nTVL: ${formatUsd(row.tvl_usd)}` }))} xFormatter={(value) => formatPercentagePoints(value, 1)} yFormatter={(value) => formatPct(value, 1)} /><p className="muted viz-legend">Bubble size: TVL. Select a vault to open it.</p></section>

      </div></section>


    </div>
  );
}

export default function MomentumPage() {
  return <Suspense fallback={<div className="page-loading">Loading yield changes…</div>}><MomentumPageContent /></Suspense>;
}
