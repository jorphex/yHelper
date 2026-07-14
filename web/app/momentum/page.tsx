"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { MarketFilter } from "../components/market-filter";
import { ScatterPlot, ShareMeter, TrendStrips } from "../components/visuals";
import { useChangesData, useTrendDailyData } from "../hooks/use-changes-data";
import { formatPct, formatPercentagePoints, formatUsd, yearnVaultUrl } from "../lib/format";
import { MARKET_VALUES, UNIVERSE_VALUES, universeDefaults, universeLabel } from "../lib/universe";
import { queryChoice, replaceQuery } from "../lib/url";
import { MoverTable } from "./components";
import type { ChangeRow, DailyTrendRow } from "./types";

function shortDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
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
  const { data: trends } = useTrendDailyData({
    universe: query.universe,
    market: query.market,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    days: 90,
  });

  if (error && !data) {
    return <div className="card card-padded-lg"><h2>Momentum is temporarily unavailable</h2><button className="button button-primary section-sm" onClick={() => refetch()}>Retry</button></div>;
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

  const daily = (trends?.rows ?? []) as DailyTrendRow[];
  const recent = daily.slice(-60);
  const startLabel = shortDate(recent[0]?.day);
  const endLabel = shortDate(recent.at(-1)?.day);
  const trendItems = [
    { id: "7d", label: "Realized APY 7d", points: recent.map((row) => row.weighted_apy_7d), note: "TVL-weighted short window", startLabel, endLabel, deltaLabel: "1d change" },
    { id: "30d", label: "Realized APY 30d", points: recent.map((row) => row.weighted_apy_30d), note: "TVL-weighted baseline", startLabel, endLabel, deltaLabel: "1d change" },
  ];
  const breadthItems = [
    { id: "riser", label: "Strengthening share", points: recent.map((row) => row.riser_ratio), note: "Share with realized 7d APY above 30d", startLabel, endLabel, deltaLabel: "1d change" },
  ];
  const yieldValues = trendItems.flatMap((item) => item.points).filter((value): value is number => value != null && Number.isFinite(value));
  const yieldDomain: readonly [number, number] | undefined = yieldValues.length > 0
    ? [Math.min(...yieldValues), Math.max(...yieldValues)]
    : undefined;
  const moverRows = [...(data?.movers?.risers ?? []), ...(data?.movers?.fallers ?? [])].filter((row, index, rows) => rows.findIndex((candidate) => candidate.chain_id === row.chain_id && candidate.vault_address === row.vault_address) === index);

  return (
    <div>
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Momentum<br /><em className="page-title-accent">What changed, and where</em></h1>
        <p className="page-description">Compare realized yield with the immediately preceding equal-length window. Positive changes are risers; negative changes are fallers.</p>
      </section>
      <section className="section section-md"><div className="card"><div className="filter-grid">
        <label><span className="filter-label">Window</span><select className="filter-control" value={query.window} onChange={(event) => updateQuery({ window: event.target.value })}><option value="24h">24 hours vs prior 24 hours</option><option value="7d">7 days vs prior 7 days</option><option value="30d">30 days vs prior 30 days</option></select></label>
        <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market })} />
        <label><span className="filter-label">Vault set</span><select className="filter-control" value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}>{UNIVERSE_VALUES.map((universe) => <option key={universe} value={universe}>{universeLabel(universe)}</option>)}</select></label>
      </div></div></section>

      <section className="section section-lg">
        {isLoading ? <KpiGridSkeleton count={3} /> : <div className="kpi-grid kpi-grid-3">
          <div className="kpi-card"><div className="kpi-label">Comparable vaults</div><div className="kpi-value">{compared}</div><div className="kpi-hint">{summary?.vaults_eligible ?? 0} eligible</div></div>
          <div className="kpi-card"><div className="kpi-label">Compared TVL</div><div className="kpi-value">{formatUsd(totalTvl)}</div></div>
          <div className="kpi-card"><div className="kpi-label">TVL-weighted change</div><div className={`kpi-value ${(summary?.tvl_weighted_delta ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatPercentagePoints(summary?.tvl_weighted_delta)}</div></div>
        </div>}
      </section>

      <section className="section section-lg"><div className="card-header"><h2 className="card-title">Market breadth</h2></div><div className="cols-2"><ShareMeter title="By vaults" segments={breadthByVault} total={compared} valueFormatter={(value) => String(value ?? 0)} /><ShareMeter title="By TVL" segments={breadthByTvl} total={totalTvl} valueFormatter={formatUsd} /></div></section>

      <section className="section section-lg">
        {isLoading ? <><TableSkeleton rows={4} columns={7} /><TableSkeleton rows={4} columns={7} /></> : <>
          <MoverTable title="Top Risers" rows={(data?.movers?.risers ?? []) as ChangeRow[]} universe={query.universe} market={query.market} window={query.window} compact={compact} />
          <MoverTable title="Top Fallers" rows={(data?.movers?.fallers ?? []) as ChangeRow[]} universe={query.universe} market={query.market} window={query.window} compact={compact} />
        </>}
      </section>

      <section className="section"><div className="card-header"><div><h2 className="card-title">60-day context</h2><p className="card-description">Fixed 7d and 30d history for the selected market and vault set. The window control above applies to the current comparison, mover tables, and scatter plot—not these context strips.</p></div></div><div className="viz-stack"><div className="cols-2"><TrendStrips title="Realized yield" items={trendItems} domain={yieldDomain} valueFormatter={(value) => formatPct(value, 2)} deltaFormatter={(value) => formatPercentagePoints(value, 2)} /><TrendStrips title="7d vs 30d breadth" items={breadthItems} domain={[0, 1]} valueFormatter={(value) => formatPct(value, 0)} deltaFormatter={(value) => formatPercentagePoints(value, 1)} /></div><div><ScatterPlot title="Current realized yield vs window change" xLabel="Window change" yLabel="Current realized APY" points={moverRows.filter((row) => row.delta_apy != null && row.realized_apy_window != null).map((row) => ({ id: `${row.chain_id}:${row.vault_address}`, x: row.delta_apy, y: row.realized_apy_window, size: row.tvl_usd, tone: (row.delta_apy ?? 0) > 0 ? "positive" : "negative", href: yearnVaultUrl(row.chain_id, row.vault_address), tooltip: `${row.symbol ?? row.vault_address}\nChange: ${formatPercentagePoints(row.delta_apy)}\nCurrent: ${formatPct(row.realized_apy_window)}\nTVL: ${formatUsd(row.tvl_usd)}` }))} xFormatter={(value) => formatPercentagePoints(value, 1)} yFormatter={(value) => formatPct(value, 1)} /><p className="muted viz-legend">Bubble size represents tracked TVL. The zero line separates strengthening from weakening. Select a point to open its Yearn vault page.</p></div></div></section>
    </div>
  );
}

export default function MomentumPage() {
  return <Suspense fallback={<div className="page-loading">Loading yield changes…</div>}><MomentumPageContent /></Suspense>;
}
