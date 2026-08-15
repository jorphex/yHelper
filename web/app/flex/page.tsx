"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { EmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { formatPct, formatUsd } from "../lib/format";
import { replaceQuery } from "../lib/url";
import {
  useFlexActivity,
  useFlexHistory,
  useFlexMarketDetail,
  useFlexMarkets,
  useFlexRedemptionPriority,
  type FlexActivityRow,
  type FlexHistoryPoint,
  type FlexMarket,
  type FlexRedemptionPriorityResponse,
} from "../hooks/use-flex-data";
import { flexA11y, flexCopy } from "./copy";

type SortKey = "deposits" | "debt" | "liquidity" | "utilization" | "lenderApr" | "borrowerRate";
type HistoryDays = 7 | 30 | 90;

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

function metric(market: FlexMarket, key: SortKey): number {
  const values = market.metrics;
  if (!values) return -1;
  return {
    deposits: values.deposits_usd,
    debt: values.debt_usd,
    liquidity: values.idle_liquidity_usd,
    utilization: values.utilization,
    lenderApr: values.lender_apr,
    borrowerRate: values.average_borrow_rate,
  }[key];
}

function MarketTable({ rows }: { rows: FlexMarket[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "ascending" | "descending" }>({
    key: "deposits",
    direction: "descending",
  });
  const ordered = useMemo(() => [...rows].sort((a, b) => {
    const delta = metric(a, sort.key) - metric(b, sort.key);
    return sort.direction === "ascending" ? delta : -delta;
  }), [rows, sort]);
  const toggle = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === "descending" ? "ascending" : "descending",
  }));
  const header = (key: SortKey, label: string, mobileLabel?: string) => (
    <th className="numeric" aria-sort={sort.key === key ? sort.direction : "none"} data-mobile-label={mobileLabel}>
      <button
        type="button"
        className="th-button"
        aria-label={flexA11y(flexCopy.accessibility.tableSort, { column: label })}
        onClick={() => toggle(key)}
      >
        {label}{sort.key === key ? <span className="th-indicator" aria-hidden="true">{sort.direction === "ascending" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
  return (
    <TableWrap className="flex-market-table-wrap">
      <table className="decision-table flex-market-table">
        <thead><tr>
          <th>{flexCopy.markets.headers.market}</th>
          {header("deposits", flexCopy.markets.headers.deposits, flexCopy.markets.mobile.deposits)}
          {header("debt", flexCopy.markets.headers.debt, flexCopy.markets.mobile.debt)}
          {header("liquidity", flexCopy.markets.headers.liquidity, flexCopy.markets.mobile.liquidity)}
          {header("utilization", flexCopy.markets.headers.utilization, flexCopy.markets.mobile.utilization)}
          {header("lenderApr", flexCopy.markets.headers.lenderApr, flexCopy.markets.mobile.lenderApr)}
          {header("borrowerRate", flexCopy.markets.headers.borrowerRate, flexCopy.markets.mobile.borrowerRate)}
          <th className="mobile-secondary-column">{flexCopy.markets.headers.age}</th>
        </tr></thead>
        <tbody>{ordered.map((market) => <tr key={market.addresses.market}>
          <td>
            <strong>{market.label}</strong>
            <span className="flex-market-version">v{market.contract_version}</span>
          </td>
          <td className="numeric data-value" data-label={flexCopy.markets.mobile.deposits}>{formatUsd(market.metrics?.deposits_usd)}</td>
          <td className="numeric data-value" data-label={flexCopy.markets.mobile.debt}>{formatUsd(market.metrics?.debt_usd)}</td>
          <td className="numeric data-value" data-label={flexCopy.markets.mobile.liquidity}>{formatUsd(market.metrics?.idle_liquidity_usd)}</td>
          <td className="numeric data-value" data-label={flexCopy.markets.mobile.utilization}>{formatPct(market.metrics?.utilization)}</td>
          <td className="numeric data-value" data-label={flexCopy.markets.mobile.lenderApr}>{formatPct(market.metrics?.lender_apr)}</td>
          <td className="numeric data-value" data-label={flexCopy.markets.mobile.borrowerRate}>{formatPct(market.metrics?.average_borrow_rate)}</td>
          <td className="mobile-secondary-column" data-label={flexCopy.markets.headers.age}><time dateTime={market.deployment_time}>{date.format(new Date(market.deployment_time))}</time></td>
        </tr>)}</tbody>
      </table>
    </TableWrap>
  );
}

type ChartSeries = { key: keyof FlexHistoryPoint; label: string; color: string };

function HistoryChart({
  title,
  description,
  points,
  series,
  percentage = true,
  inspectionIndex,
  activeInspector,
  onInspect,
  onInspectEnd,
}: {
  title: string;
  description: string;
  points: FlexHistoryPoint[];
  series: ChartSeries[];
  percentage?: boolean;
  inspectionIndex: number | null;
  activeInspector: string | null;
  onInspect: (chart: string, index: number) => void;
  onInspectEnd: (chart: string) => void;
}) {
  const chartId = String(series[0].key);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const height = width < 480 ? 180 : 240;
  const left = 0;
  const right = width < 480 ? 4 : 8;
  const top = width < 480 ? 16 : 20;
  const bottom = width < 480 ? 32 : 40;
  const values = points.flatMap((point) => series.map((item) => Number(point[item.key]) || 0));
  const maxValue = Math.max(percentage && series.length === 1 ? 1 : 0, ...values, 0.0001);
  const x = (index: number) => left + (index / Math.max(1, points.length - 1)) * (width - left - right);
  const y = (value: number) => top + (1 - value / maxValue) * (height - top - bottom);
  const path = (item: ChartSeries) => points.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command}${x(index).toFixed(2)},${y(Number(point[item.key]) || 0).toFixed(2)}`;
  }).join(" ");
  const first = points[0];
  const latest = points.at(-1);
  const summary = latest
    ? series.map((item) => `${item.label} ${formatPct(Number(latest[item.key]) || 0)}`).join(". ")
    : description;
  const inspected = inspectionIndex === null ? null : points[inspectionIndex];
  const inspectedX = inspectionIndex === null ? null : x(inspectionIndex);
  const inspectionSummary = inspected ? flexA11y(flexCopy.history.inspection.summary, {
    timestamp: `${dateTime.format(new Date(inspected.sampled_at))} UTC`,
    utilization: formatPct(inspected.utilization),
    lenderApr: formatPct(inspected.lender_apr),
    borrowerRate: formatPct(inspected.average_borrow_rate),
  }) : "";
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const inspectFromClientX = (clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const svgX = ((clientX - rect.left) / rect.width) * width;
    const ratio = Math.max(0, Math.min(1, (svgX - left) / (width - left - right)));
    onInspect(chartId, Math.round(ratio * (points.length - 1)));
  };
  const moveInspection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || points.length === 0) return;
    event.preventDefault();
    const current = inspectionIndex ?? points.length - 1;
    if (event.key === "Home") onInspect(chartId, 0);
    else if (event.key === "End") onInspect(chartId, points.length - 1);
    else onInspect(chartId, Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowRight" ? 1 : -1))));
  };
  return (
    <section className="flex-chart-panel" aria-labelledby={`${chartId}-title`}>
      <div className="flex-chart-heading">
        <div><h3 id={`${String(series[0].key)}-title`}>{title}</h3><p>{description}</p></div>
        {latest ? <div className="flex-chart-latest" aria-label={summary}>{series.map((item) => <span key={String(item.key)}><i style={{ background: item.color }} />{item.label} <strong>{formatPct(Number(latest[item.key]) || 0)}</strong></span>)}</div> : null}
      </div>
      <div
        ref={chartRef}
        className="flex-chart-interactive"
        tabIndex={0}
        role="group"
        aria-label={`${title}. ${summary}. ${flexCopy.history.inspection.keyboardHint}`}
        onFocus={() => onInspect(chartId, inspectionIndex ?? points.length - 1)}
        onBlur={() => onInspectEnd(chartId)}
        onKeyDown={moveInspection}
        onPointerMove={(event) => inspectFromClientX(event.clientX)}
        onPointerDown={(event) => inspectFromClientX(event.clientX)}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") onInspectEnd(chartId); }}
      >
        <svg className="flex-line-chart" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {[0, 0.5, 1].map((ratio) => <g key={ratio}>
            <line x1={left} x2={width - right} y1={top + ratio * (height - top - bottom)} y2={top + ratio * (height - top - bottom)} className="flex-chart-grid" />
            <text x="4" y={top + ratio * (height - top - bottom) - 4} textAnchor="start" className="flex-chart-axis flex-chart-axis-inset">{formatPct(maxValue * (1 - ratio), 0)}</text>
          </g>)}
          {series.map((item) => <path key={String(item.key)} d={path(item)} fill="none" stroke={item.color} className="flex-chart-line" />)}
          {series.map((item) => latest ? <circle key={String(item.key)} cx={x(points.length - 1)} cy={y(Number(latest[item.key]) || 0)} r="4" fill={item.color} /> : null)}
          {inspected && inspectedX !== null ? <g className="flex-chart-inspection">
            <line x1={inspectedX} x2={inspectedX} y1={top} y2={height - bottom} />
            {series.map((item) => <circle key={String(item.key)} cx={inspectedX} cy={y(Number(inspected[item.key]) || 0)} r="5" fill={item.color} />)}
          </g> : null}
          {first ? <text x={left} y={height - 12} className="flex-chart-axis">{date.format(new Date(first.sampled_at))}</text> : null}
          {latest ? <text x={width - right} y={height - 12} textAnchor="end" className="flex-chart-axis">{date.format(new Date(latest.sampled_at))}</text> : null}
        </svg>
        {inspected && activeInspector === chartId && inspectedX !== null ? <div className={`flex-chart-tooltip ${inspectionIndex !== null && inspectionIndex > points.length * 0.68 ? "is-right" : ""}`} style={{ left: `${(inspectedX / width) * 100}%` }}>
          <time dateTime={inspected.sampled_at}>{dateTime.format(new Date(inspected.sampled_at))} UTC</time>
          <span>{flexCopy.history.utilization.title}<strong>{formatPct(inspected.utilization)}</strong></span>
          <span>{flexCopy.history.rates.lenderApr}<strong>{formatPct(inspected.lender_apr)}</strong></span>
          <span>{flexCopy.history.rates.borrowerRate}<strong>{formatPct(inspected.average_borrow_rate)}</strong></span>
        </div> : null}
        <span className="sr-only" aria-live="polite">{activeInspector === chartId ? inspectionSummary : ""}</span>
      </div>
    </section>
  );
}

function HistoryCharts({ points }: { points: FlexHistoryPoint[] }) {
  const [inspection, setInspection] = useState<{ chart: string; index: number } | null>(null);
  return <div className="flex-chart-grid-layout">
    <HistoryChart
      title={flexCopy.history.utilization.title}
      description={flexCopy.history.utilization.description}
      points={points}
      series={[{ key: "utilization", label: flexCopy.history.utilization.title, color: "#3b82f6" }]}
      inspectionIndex={inspection?.index ?? null}
      activeInspector={inspection?.chart ?? null}
      onInspect={(chart, index) => setInspection({ chart, index })}
      onInspectEnd={(chart) => setInspection((current) => current?.chart === chart ? null : current)}
    />
    <HistoryChart
      title={flexCopy.history.rates.title}
      description={flexCopy.history.rates.description}
      points={points}
      series={[{ key: "lender_apr", label: flexCopy.history.rates.lenderApr, color: "#3b82f6" }, { key: "average_borrow_rate", label: flexCopy.history.rates.borrowerRate, color: "#2dd4bf" }]}
      inspectionIndex={inspection?.index ?? null}
      activeInspector={inspection?.chart ?? null}
      onInspect={(chart, index) => setInspection({ chart, index })}
      onInspectEnd={(chart) => setInspection((current) => current?.chart === chart ? null : current)}
    />
  </div>;
}

function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const ceiling = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function RedemptionPriorityChart({ data }: { data: FlexRedemptionPriorityResponse }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1088);
  const [inspectionIndex, setInspectionIndex] = useState<number | null>(null);
  const height = width < 480 ? 200 : 260;
  const left = 0;
  const right = width < 480 ? 4 : 8;
  const top = width < 480 ? 16 : 20;
  const bottom = width < 480 ? 32 : 40;
  const points = data.points;
  const totalDebt = data.total_debt ?? Math.max(0, ...points.map((point) => point.redeemable_before));
  const xMax = Math.max(points.at(-1)?.annual_interest_rate ?? 0, 0.0001);
  const yMax = niceCeiling(Math.max(totalDebt, ...points.map((point) => point.redeemable_before), 1));
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (rate: number) => left + (rate / xMax) * plotWidth;
  const y = (debt: number) => top + (1 - debt / yMax) * plotHeight;
  const stepPath = points.reduce((path, point) => `${path} H${x(point.annual_interest_rate).toFixed(2)} V${y(point.redeemable_before).toFixed(2)}`, `M${x(0).toFixed(2)},${y(0).toFixed(2)}`);
  const areaPath = `${stepPath} L${x(xMax).toFixed(2)},${y(0).toFixed(2)} Z`;
  const inspected = inspectionIndex === null ? null : points[inspectionIndex];
  const inspectedShare = inspected && totalDebt > 0 ? inspected.redeemable_before / totalDebt : 0;
  const tickStep = 10 ** Math.floor(Math.log10(xMax));
  const xTicks = width < 480
    ? [0, xMax / 2, xMax]
    : [...Array.from({ length: 5 }, (_, index) => index * tickStep).filter((tick) => tick < xMax), xMax];
  const yTicks = width < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const inspectFromClientX = (clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const chartX = ((clientX - rect.left) / rect.width) * width;
    const rate = Math.max(0, Math.min(xMax, ((chartX - left) / plotWidth) * xMax));
    const closest = points.reduce((best, point, index) => (
      Math.abs(point.annual_interest_rate - rate) < Math.abs(points[best].annual_interest_rate - rate) ? index : best
    ), 0);
    setInspectionIndex(closest);
  };
  const moveInspection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || points.length === 0) return;
    event.preventDefault();
    const current = inspectionIndex ?? points.length - 1;
    if (event.key === "Home") setInspectionIndex(0);
    else if (event.key === "End") setInspectionIndex(points.length - 1);
    else setInspectionIndex(Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowRight" ? 1 : -1))));
  };
  const summary = inspected ? flexA11y(flexCopy.redemptionPriority.summary, {
    rate: formatPct(inspected.annual_interest_rate),
    debtAhead: `${compact.format(inspected.redeemable_before)} ${data.borrow_token.symbol}`,
    share: formatPct(inspectedShare),
  }) : "";

  return <div
    ref={chartRef}
    className="flex-chart-interactive flex-redemption-chart"
    tabIndex={0}
    role="group"
    aria-label={`${flexCopy.redemptionPriority.chart.ariaLabel}. ${flexCopy.redemptionPriority.axes.annualRate}. ${flexA11y(flexCopy.redemptionPriority.axes.debtAhead, { symbol: data.borrow_token.symbol })}. ${flexCopy.redemptionPriority.chart.interaction}`}
    onFocus={() => setInspectionIndex((current) => current ?? points.length - 1)}
    onBlur={() => setInspectionIndex(null)}
    onKeyDown={moveInspection}
    onPointerMove={(event) => inspectFromClientX(event.clientX)}
    onPointerDown={(event) => inspectFromClientX(event.clientX)}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") setInspectionIndex(null); }}
  >
    <svg className="flex-line-chart" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {yTicks.map((ratio) => <g key={ratio}>
        <line x1={left} x2={width - right} y1={y(yMax * ratio)} y2={y(yMax * ratio)} className="flex-chart-grid" />
        <text x="4" y={y(yMax * ratio) - 4} textAnchor="start" className="flex-chart-axis flex-chart-axis-inset">{compact.format(yMax * ratio)}</text>
      </g>)}
      <path d={areaPath} className="flex-redemption-area" />
      <path d={stepPath} className="flex-redemption-line" />
      {points.map((point) => <circle key={`${point.annual_interest_rate_raw}:${point.redeemable_before_raw}`} cx={x(point.annual_interest_rate)} cy={y(point.redeemable_before)} r={width < 480 ? "2" : "3.5"} className="flex-redemption-point" />)}
      {inspected ? <g className="flex-chart-inspection">
        <line x1={x(inspected.annual_interest_rate)} x2={x(inspected.annual_interest_rate)} y1={top} y2={height - bottom} />
        <circle cx={x(inspected.annual_interest_rate)} cy={y(inspected.redeemable_before)} r={width < 480 ? "4" : "5"} className="flex-redemption-active-point" />
      </g> : null}
      {xTicks.map((tick, index) => <text key={`${tick}:${index}`} x={x(tick)} y={height - 10} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"} className="flex-chart-axis">{formatPct(tick, tick === 0 ? 0 : width < 480 || tick === xMax ? 1 : 0)}</text>)}
    </svg>
    {inspected ? <div className={`flex-chart-tooltip ${inspectionIndex !== null && inspectionIndex > points.length * 0.65 ? "is-right" : ""}`} style={{ left: `${(x(inspected.annual_interest_rate) / width) * 100}%` }}>
      <span>{flexCopy.redemptionPriority.tooltip.annualRate}<strong>{formatPct(inspected.annual_interest_rate)}</strong></span>
      <span>{flexCopy.redemptionPriority.tooltip.debtAhead}<strong>{compact.format(inspected.redeemable_before)} {data.borrow_token.symbol}</strong></span>
      <span>{flexCopy.redemptionPriority.tooltip.shareOfTotal}<strong>{formatPct(inspectedShare)}</strong></span>
    </div> : null}
    <span className="sr-only" aria-live="polite">{summary}</span>
  </div>;
}

function RedemptionPrioritySection({
  query,
}: {
  query: ReturnType<typeof useFlexRedemptionPriority>;
}) {
  const data = query.data;
  const freshness = data?.freshness;
  const freshnessLabel = freshness?.data_state === "delayed"
    ? flexCopy.redemptionPriority.freshness.delayed
    : flexCopy.redemptionPriority.freshness.ready;
  const source = freshness?.source_block_number && freshness.source_block_time ? [
    flexA11y(flexCopy.redemptionPriority.freshness.sourceBlock, { block: String(freshness.source_block_number) }),
    flexA11y(flexCopy.redemptionPriority.freshness.sourceTime, { time: `${dateTime.format(new Date(freshness.source_block_time))} UTC` }),
  ] : [];

  return <section className="flex-redemption-section" aria-labelledby="flex-redemption-title">
    <div className="flex-redemption-heading">
      <h3 id="flex-redemption-title">{flexCopy.redemptionPriority.title}</h3>
      <p>{flexCopy.redemptionPriority.description}</p>
      {freshness && freshness.data_state !== "unavailable" ? <p className="flex-redemption-freshness"><span>{freshnessLabel}</span>{source.map((item) => <span key={item}>{item}</span>)}</p> : null}
    </div>
    {query.isLoading && !data ? <div className="skeleton flex-redemption-skeleton" /> : null}
    {query.error || data?.freshness.data_state === "unavailable" ? <div className="flex-redemption-error"><p>{flexCopy.redemptionPriority.unavailable.title}</p><button type="button" className="button button-secondary" onClick={() => query.refetch()}>{flexCopy.redemptionPriority.unavailable.retry}</button></div> : null}
    {data && data.freshness.data_state !== "unavailable" && data.points.length === 0 ? <EmptyState title={flexCopy.redemptionPriority.empty.title} description={flexCopy.redemptionPriority.empty.description} icon="chart" /> : null}
    {data && data.freshness.data_state !== "unavailable" && data.points.length > 0 ? <RedemptionPriorityChart data={data} /> : null}
  </section>;
}

function eventLabel(event: string): string {
  const normalized = event.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return flexCopy.events[normalized as keyof typeof flexCopy.events] ?? event.replaceAll("_", " ");
}

function primaryAmount(row: FlexActivityRow, market: FlexMarket | undefined): string {
  const values = row.amounts;
  const candidates: Array<[string, number, string]> = [
    ["debt_raw", market?.borrow_token.decimals ?? 6, market?.borrow_token.symbol ?? ""],
    ["assets_raw", market?.borrow_token.decimals ?? 6, market?.borrow_token.symbol ?? ""],
    ["collateral_raw", market?.collateral_token.decimals ?? 18, market?.collateral_token.symbol ?? ""],
    ["take_raw", market?.collateral_token.decimals ?? 18, market?.collateral_token.symbol ?? ""],
    ["loss_raw", market?.borrow_token.decimals ?? 6, market?.borrow_token.symbol ?? ""],
  ];
  const entry = candidates.find(([key]) => values[key] !== undefined);
  if (!entry) return flexCopy.values.unavailable;
  const raw = Number(values[entry[0]]);
  if (!Number.isFinite(raw)) return flexCopy.values.unavailable;
  return `${compact.format(raw / 10 ** entry[1])} ${entry[2]}`.trim();
}

function FlexPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading, error, refetch } = useFlexMarkets();
  const active = useMemo(() => data?.rows.filter((row) => row.status === "active") ?? [], [data]);
  const requestedMarket = searchParams.get("market")?.toLowerCase() ?? null;
  const selected = active.find((market) => market.addresses.market === requestedMarket)
    ?? [...active].sort((a, b) => (b.metrics?.deposits_usd ?? 0) - (a.metrics?.deposits_usd ?? 0))[0]
    ?? null;
  const rawDays = Number(searchParams.get("days") ?? 30);
  const days: HistoryDays = rawDays === 7 || rawDays === 90 ? rawDays : 30;
  const history = useFlexHistory(selected?.addresses.market ?? null, days);
  const detail = useFlexMarketDetail(selected?.addresses.market ?? null);
  const redemptionPriority = useFlexRedemptionPriority(selected?.addresses.market ?? null);
  const activity = useFlexActivity();
  const activityRows = activity.data?.pages.flatMap((page) => page.rows) ?? [];
  const marketByAddress = useMemo(() => new Map(data?.rows.map((market) => [market.addresses.market, market])), [data]);
  const updateQuery = useCallback(
    (updates: Record<string, string | number | null>) => replaceQuery(router, pathname, searchParams, updates),
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (!selected || requestedMarket === selected.addresses.market) return;
    updateQuery({ market: selected.addresses.market });
  }, [requestedMarket, selected, updateQuery]);

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  return (
    <div className="flex-page">
      <section className="page-header page-header-no-border">
        <h1 className="page-title">{flexCopy.hero.title}<br /><em className="page-title-accent">{flexCopy.hero.accent}</em></h1>
        <p className="page-description">{flexCopy.hero.blurb}</p>
        <div className="tab-bar-plain">
          <a href="https://flexmeow.com" target="_blank" rel="noopener noreferrer" className="button button-primary">{flexCopy.hero.officialLink}</a>
        </div>
      </section>

      <section className="section section-lg">
        <div className="card-header"><div><h2 className="card-title">{flexCopy.markets.title}</h2><p className="card-description">{flexCopy.markets.description}</p></div></div>
        {isLoading && !data ? <TableWrap><table className="decision-table"><tbody><TableSkeleton rows={2} columns={8} /></tbody></table></TableWrap> : active.length ? <MarketTable rows={active} /> : <p className="muted">{flexCopy.markets.noActive}</p>}
      </section>

      {selected ? <section className="section section-lg flex-history-section">
        <div className="flex-market-tabs flex-market-selector" role="tablist" aria-label={flexCopy.detail.selectLabel}>
          {active.map((market) => <button key={market.addresses.market} type="button" role="tab" aria-selected={market.addresses.market === selected.addresses.market} className={`flex-market-tab ${market.addresses.market === selected.addresses.market ? "is-active" : ""}`} onClick={() => updateQuery({ market: market.addresses.market })}>{market.label}</button>)}
        </div>
        {detail.data ? <section className="flex-risk-section" aria-labelledby="flex-risk-title">
          <div><h3 id="flex-risk-title">{flexCopy.detail.risk.title}</h3><p>{flexCopy.detail.risk.description}</p></div>
          <div className="flex-risk-content">
            <dl className="flex-risk-grid flex-risk-grid-all">
              <div><dt>{flexCopy.detail.risk.primary.minimumDebt}</dt><dd>{detail.data.risk.minimum_debt === null ? flexCopy.values.unavailable : `${compact.format(detail.data.risk.minimum_debt)} ${selected.borrow_token.symbol}`}</dd></div>
              <div><dt>{flexCopy.detail.risk.primary.maximumLtv}</dt><dd>{formatPct(detail.data.risk.maximum_ltv)}</dd></div>
              <div><dt>{flexCopy.detail.risk.secondary.safeLtv}</dt><dd>{formatPct(detail.data.risk.safe_ltv)}</dd></div>
              <div><dt>{flexCopy.detail.risk.secondary.maximumFeeThreshold}</dt><dd>{formatPct(detail.data.risk.maximum_penalty_ltv)}</dd></div>
              <div><dt>{flexCopy.detail.risk.secondary.liquidationFeeRange}</dt><dd>{formatPct(detail.data.risk.minimum_liquidation_fee)} – {formatPct(detail.data.risk.maximum_liquidation_fee)}</dd></div>
            </dl>
          </div>
        </section> : null}
        <RedemptionPrioritySection query={redemptionPriority} />
        <div className="flex-history-heading-row">
          <div><h2 className="card-title">{flexCopy.history.title}</h2><p className="card-description">{flexCopy.history.description}</p></div>
          <div className="flex-range-tabs" role="group" aria-label={flexCopy.history.rangeLabel}>
            {([[7, flexCopy.history.ranges.seven], [30, flexCopy.history.ranges.thirty], [90, flexCopy.history.ranges.ninety]] as const).map(([value, label]) => <button key={value} type="button" className={`flex-range-tab ${days === value ? "is-active" : ""}`} aria-pressed={days === value} onClick={() => updateQuery({ days: value })}>{label}</button>)}
          </div>
        </div>
        {history.isLoading && !history.data ? <div className="flex-chart-grid-layout"><div className="skeleton flex-chart-skeleton" /><div className="skeleton flex-chart-skeleton" /></div> : history.data?.points.length ? <HistoryCharts points={history.data.points} /> : <p className="muted">{flexCopy.history.unavailable}</p>}
      </section> : null}

      <section className="section section-lg flex-activity-section">
        <div className="card-header"><div><h2 className="card-title">{flexCopy.activity.title}</h2><p className="card-description">{flexCopy.activity.description}</p></div></div>
        <TableWrap className="flex-activity-wrap"><table className="decision-table flex-activity-table">
          <thead><tr><th>{flexCopy.activity.headers.time}</th><th>{flexCopy.activity.headers.event}</th><th>{flexCopy.activity.headers.market}</th><th className="numeric">{flexCopy.activity.headers.amount}</th></tr></thead>
          <tbody>{activity.isLoading && !activity.data ? <TableSkeleton rows={8} columns={4} /> : activityRows.map((row) => <tr key={`${row.tx_hash}:${row.log_index}`}>
            <td data-label={flexCopy.activity.mobile.time}><Link className="report-link report-link-utility" href={`https://etherscan.io/tx/${row.tx_hash}`} target="_blank" rel="noreferrer" aria-label={flexA11y(flexCopy.accessibility.transaction, { hash: row.tx_hash })}><time dateTime={row.block_time}>{dateTime.format(new Date(row.block_time))} UTC</time></Link></td>
            <td data-label={flexCopy.activity.mobile.event}>{eventLabel(row.event)}</td>
            <td data-label={flexCopy.activity.mobile.market}>{row.market_label}</td>
            <td data-label={flexCopy.activity.mobile.amount} className="numeric data-value">{primaryAmount(row, marketByAddress.get(row.market_address))}</td>
          </tr>)}</tbody>
        </table></TableWrap>
        {!activity.isLoading && activityRows.length === 0 ? <p className="muted">{flexCopy.activity.empty}</p> : null}
        {activity.hasNextPage ? <button type="button" className="button button-ghost section-sm" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>{activity.isFetchingNextPage ? flexCopy.activity.loadingMore : flexCopy.activity.loadMore}</button> : null}
      </section>
    </div>
  );
}

export default function FlexPage() {
  return <Suspense fallback={<div className="page-loading">{flexCopy.loading.page}</div>}><FlexPageContent /></Suspense>;
}
