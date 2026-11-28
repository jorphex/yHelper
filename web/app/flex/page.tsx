"use client";

import { RiskAssessmentLink } from "../components/risk-assessment-link";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { chartKeyIndex } from "../components/visuals/utils";
import { formatPct, formatUsd } from "../lib/format";
import { replaceQuery } from "../lib/url";
import {
  useFlexActivity,
  FLEX_PERIODS,
  useFlexMarketData,
  useFlexMarkets,
  useFlexMarketPreload,
  type FlexHistoryPoint,
  type FlexMarket,
  type FlexMarketDetailResponse,
  type FlexRedemptionPriorityResponse,
} from "../hooks/use-flex-data";
import { flexA11y, flexCopy } from "./copy";
import { BorrowScenario } from "./borrow-scenario";
import { FlexPerformance } from "./performance";

const SECTION_IDS = ["flex-markets-title", "flex-performance-title", "flex-activity-title"];

const MARKET_COLUMNS = [
  { key: "deposits_usd", label: "Deposits", format: formatUsd },
  { key: "debt_usd", label: "Debt", format: formatUsd },
  { key: "idle_liquidity_usd", label: "Idle liquidity", card: "Idle liquidity", format: formatUsd },
  { key: "utilization", label: "Utilization", format: formatPct },
  { key: "lender_apr", label: "Expected lender APR", card: "Lend APR", format: formatPct },
  { key: "collateral_apr", label: "7d collateral APR", format: formatPct },
  { key: "average_borrow_rate", label: "Borrow rate", card: "Borrow rate", format: formatPct },
] as const;
type SortKey = typeof MARKET_COLUMNS[number]["key"];

function marketValue(market: FlexMarket, key: SortKey) {
  return key === "collateral_apr" ? market.collateral_yield?.apr : market.metrics?.[key];
}

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
const tokenAmount = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 });
const percentagePoints = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const axisPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumSignificantDigits: 3 });

function MarketTable({ rows, marketHref }: { rows: FlexMarket[]; marketHref: (address: string) => string }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "ascending" | "descending" }>({
    key: "deposits_usd",
    direction: "descending",
  });
  const ordered = useMemo(() => [...rows].sort((a, b) => {
    const first = marketValue(a, sort.key), second = marketValue(b, sort.key);
    if (first === undefined) return second === undefined ? 0 : 1;
    if (second === undefined) return -1;
    const delta = first - second;
    return sort.direction === "ascending" ? delta : -delta;
  }), [rows, sort]);
  const toggle = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === "descending" ? "ascending" : "descending",
  }));
  const cardSort = MARKET_COLUMNS.find(column => column.key === sort.key && !("card" in column));
  const header = ({ key, label }: typeof MARKET_COLUMNS[number]) => (
    <th key={key} className="numeric" aria-sort={sort.key === key ? sort.direction : "none"}>
      <button
        type="button"
        className="th-button"
        aria-label={`Sort by ${label}`}
        onClick={() => toggle(key)}
      >
        {label}{sort.key === key ? <span className="th-indicator" aria-hidden="true">{sort.direction === "ascending" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
  return (
    <TableWrap className="flex-market-table-wrap">
      <label className="flex-market-sort flex-filter">Sort markets
        <select value={`${sort.key}:${sort.direction}`} onChange={event => {
          const [key, direction] = event.target.value.split(":") as [SortKey, typeof sort.direction];
          setSort({ key, direction });
        }}>
          {MARKET_COLUMNS.flatMap(column => [
            <option key={`${column.key}:descending`} value={`${column.key}:descending`}>{"card" in column ? column.card : column.label} · high to low</option>,
            <option key={`${column.key}:ascending`} value={`${column.key}:ascending`}>{"card" in column ? column.card : column.label} · low to high</option>,
          ])}
        </select>
      </label>
      <table className="decision-table flex-market-table" aria-labelledby="flex-markets-title">
        <thead><tr>
          <th>{flexCopy.markets.headers.market}</th>
          {MARKET_COLUMNS.map(header)}
        </tr></thead>
        <tbody>{ordered.map((market) => <tr key={market.addresses.market}>
          <td>
            <Link className="report-link" href={marketHref(market.addresses.market)}><strong>{market.label}</strong></Link>
            <small className="flex-market-meta">v{market.contract_version} · <time dateTime={market.deployment_time} title="Deployment date">{date.format(new Date(market.deployment_time))}</time></small>
            {cardSort ? <small className="flex-card-sort-value">{cardSort.label} {cardSort.format(marketValue(market, cardSort.key))}</small> : null}
          </td>
          {MARKET_COLUMNS.map(column => <td key={column.key} className="numeric data-value" data-column={column.key}
            data-label={"card" in column ? column.card : column.label} data-card={"card" in column || undefined}>
            <span>{column.format(marketValue(market, column.key))}
              {column.key === "idle_liquidity_usd" && market.metrics ? <small className="flex-market-unit">{tokenAmount.format(market.metrics.idle_liquidity)} {market.borrow_token.symbol}</small> : null}
            </span>
          </td>)}
        </tr>)}</tbody>
      </table>
    </TableWrap>
  );
}

function MarketPricing({ detail, peg }: {
  detail: FlexMarketDetailResponse;
  peg: ReturnType<typeof useFlexMarketData>["peg"];
}) {
  const { market, oracle, risk } = detail;
  const apr = market.collateral_yield;
  const quote = peg.data;
  const quoteReadout = useRef<HTMLElement>(null);
  const quoteBusy = peg.fetchStatus !== "idle";
  const showQuoteRetry = peg.isError || (peg.isPending && peg.errorUpdateCount > 0);
  const oracleTime = market.latest_block_time;
  const formatTime = (value: string) => `${dateTime.format(new Date(value))} UTC`;
  const formatPrice = (value: number | null) => value === null ? flexCopy.values.unavailable : tokenAmount.format(value);

  async function retryQuote(event: React.MouseEvent<HTMLButtonElement>) {
    if (quoteBusy) return;
    const button = event.currentTarget;
    const result = await peg.refetch({ cancelRefetch: false });
    if (result.isSuccess && document.activeElement === button) quoteReadout.current?.focus({ preventScroll: true });
  }

  return <section className="flex-market-pricing" aria-labelledby="flex-pricing-title">
    <h3 id="flex-pricing-title">Collateral and pricing</h3>
    <dl className="flex-pricing-grid">
      <div>
        <dt>7-day collateral APR</dt>
        <dd className="flex-pricing-value">{formatPct(apr?.apr)}
          {apr ? <span>Share return in {apr.asset_symbol}</span> : null}
        </dd>
        {apr ? <dd className="flex-pricing-source">
          <time dateTime={apr.observed_at}>{formatTime(apr.observed_at)}</time>
        </dd> : null}
      </div>
      <div>
        <dt>Liquidation oracle</dt>
        <dd className="flex-pricing-value">{formatPrice(oracle.collateral_price_in_borrow_token)}
          <span>{market.borrow_token.symbol} per {market.collateral_token.symbol}</span>
        </dd>
        <dd className="flex-pricing-source">
          <Link className="evidence-link-primary" href={`https://etherscan.io/address/${oracle.address}`} target="_blank" rel="noreferrer">Oracle contract</Link>
          {oracleTime ? <> · <time dateTime={oracleTime}>{formatTime(oracleTime)}</time></> : null}
        </dd>
      </div>
      {market.has_market_peg ? <div>
        <dt>Curve sell quote</dt>
        <dd ref={quoteReadout} tabIndex={-1} className={quote ? "flex-pricing-value" : "flex-pricing-status"} aria-live="polite">
          {quote ? <>{formatPrice(quote.usdc_per_token)}<span>USDC per {quote.asset_symbol}</span></>
            : quoteBusy ? "Loading quote…" : peg.isError ? "Quote temporarily unavailable." : "No indexed quote yet."}
        </dd>
        {quote ? <dd className="flex-pricing-source">
          <Link className="evidence-link-primary" href={`https://www.curve.finance/dex/ethereum/pools/${quote.pool_address}/swap`} target="_blank" rel="noreferrer">Curve pool</Link>
          {` · Block ${quote.block_number.toLocaleString("en-US")} · `}<time dateTime={quote.block_time}>{formatTime(quote.block_time)}</time>
        </dd> : null}
        {showQuoteRetry ? <dd className="flex-pricing-source">
          {quote ? <div role="status">{quoteBusy ? "Refreshing quote…" : "Refresh failed. Showing the last quote."}</div> : null}
          <button type="button" className="button-reset flex-quote-retry" aria-disabled={quoteBusy} onClick={retryQuote}>Retry quote</button>
        </dd> : null}
      </div> : null}
    </dl>
    {apr && risk.minimum_annual_interest_rate !== null && risk.maximum_annual_interest_rate !== null && risk.maximum_ltv ?
      <BorrowScenario key={market.addresses.market} collateralApr={apr.apr} averageRate={market.metrics?.average_borrow_rate ?? risk.minimum_annual_interest_rate} minimumRate={risk.minimum_annual_interest_rate} maximumRate={risk.maximum_annual_interest_rate} maximumLtv={risk.maximum_ltv} /> : null}
    {oracle.description ? <p className="section-note flex-oracle-method">{oracle.description}</p> : null}
  </section>;
}

type ChartSeries = { key: keyof FlexHistoryPoint; label: string; color: string; dashed?: boolean };

function tooltipLeft(x: number, width: number) {
  const anchor = `${(x / width) * 100}%`;
  return x <= width / 2
    ? `min(calc(${anchor} + var(--space-3)), calc(100% - var(--chart-tooltip-width)))`
    : `max(0px, calc(${anchor} - var(--chart-tooltip-width) - var(--space-3)))`;
}

function HistoryChart({
  title,
  description,
  points,
  series,
  priceSymbol,
  inspectionIndex,
  activeInspector,
  onInspect,
  onInspectEnd,
}: {
  title: string;
  description: string;
  points: FlexHistoryPoint[];
  series: ChartSeries[];
  priceSymbol?: string;
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
  const minValue = priceSymbol ? Math.min(...values) : 0;
  const maxValue = priceSymbol ? Math.max(...values) : Math.max(series.length === 1 ? 1 : 0, ...values);
  const formatValue = (value: number) => priceSymbol ? `${tokenAmount.format(value)} ${priceSymbol}` : formatPct(value);
  const seriesValue = (point: FlexHistoryPoint, item: ChartSeries) => formatValue(Number(point[item.key]) || 0);
  const pointSummary = (point: FlexHistoryPoint) => series.map(item => `${item.label} ${seriesValue(point, item)}`).join(". ");
  const x = (index: number) => left + (index / Math.max(1, points.length - 1)) * (width - left - right);
  const y = (value: number) => top + (maxValue === minValue ? 0.5 : (maxValue - value) / (maxValue - minValue)) * (height - top - bottom);
  const yTicks = maxValue === minValue ? [minValue] : [maxValue, (minValue + maxValue) / 2, minValue];
  const path = (item: ChartSeries) => points.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command}${x(index).toFixed(2)},${y(Number(point[item.key]) || 0).toFixed(2)}`;
  }).join(" ");
  const first = points[0];
  const latest = points.at(-1);
  const summary = latest ? pointSummary(latest) : description;
  const inspected = inspectionIndex === null ? null : points[inspectionIndex];
  const inspectedX = inspectionIndex === null ? null : x(inspectionIndex);
  const inspectionAt = priceSymbol ? inspected?.block_time : inspected?.sampled_at;
  const inspectionTime = inspectionAt ? `${dateTime.format(new Date(inspectionAt))} UTC` : "";
  const inspectionSummary = inspected ? `${inspectionTime}. ${pointSummary(inspected)}` : "";
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.round(entry.contentRect.width))));
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
    const index = chartKeyIndex(event.key, inspectionIndex, points.length);
    if (index === undefined) return;
    event.preventDefault();
    onInspect(chartId, index);
  };
  return (
    <section className="flex-chart-panel" aria-labelledby={`${chartId}-title`}>
      <div className="flex-chart-heading">
        <div><h4 id={`${chartId}-title`}>{title}</h4><p>{description}</p></div>
        {latest ? <div className="flex-chart-latest">{series.map((item) => <span key={String(item.key)}><i style={{ borderTopColor: item.color, borderTopStyle: item.dashed ? "dashed" : "solid" }} />{item.label} <strong>{seriesValue(latest, item)}</strong></span>)}</div> : null}
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
          {yTicks.map(value => <line key={value} x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="flex-chart-grid" />)}
          {series.map((item) => <path key={String(item.key)} d={path(item)} fill="none" stroke={item.color} strokeDasharray={item.dashed ? "5 4" : undefined} className="flex-chart-line" />)}
          {series.map((item) => latest ? <circle key={String(item.key)} cx={x(points.length - 1)} cy={y(Number(latest[item.key]) || 0)} r="4" fill={item.color} /> : null)}
          {inspected && inspectedX !== null ? <g className="flex-chart-inspection">
            <line x1={inspectedX} x2={inspectedX} y1={top} y2={height - bottom} />
            {series.map((item) => <circle key={String(item.key)} cx={inspectedX} cy={y(Number(inspected[item.key]) || 0)} r="5" fill={item.color} />)}
          </g> : null}
          {yTicks.map(value => <text key={value} x="4" y={y(value) - 4} className="flex-chart-axis flex-chart-axis-inset">{priceSymbol ? formatValue(value) : axisPercent.format(value)}</text>)}
          {first ? <text x={left} y={height - 12} className="flex-chart-axis">{date.format(new Date(first.sampled_at))}</text> : null}
          {latest ? <text x={width - right} y={height - 12} textAnchor="end" className="flex-chart-axis">{date.format(new Date(latest.sampled_at))}</text> : null}
        </svg>
        {inspected && activeInspector === chartId && inspectedX !== null ? <div className="flex-chart-tooltip" style={{ left: tooltipLeft(inspectedX, width) }}>
          <time dateTime={inspectionAt}>{inspectionTime}</time>
          {series.map(item => <span key={item.key}>{priceSymbol ? "Price" : item.label}<strong>{seriesValue(inspected, item)}</strong></span>)}
        </div> : null}
        <span className="sr-only" aria-live="polite">{activeInspector === chartId ? inspectionSummary : ""}</span>
      </div>
    </section>
  );
}

function HistoryCharts({ points, market }: { points: FlexHistoryPoint[]; market: FlexMarket }) {
  const [inspection, setInspection] = useState<{ chart: string; index: number } | null>(null);
  const inspector = {
    inspectionIndex: inspection?.index ?? null,
    activeInspector: inspection?.chart ?? null,
    onInspect: (chart: string, index: number) => setInspection({ chart, index }),
    onInspectEnd: (chart: string) => setInspection((current) => current?.chart === chart ? null : current),
  };
  return <div className="flex-chart-grid-layout">
    <HistoryChart
      title={flexCopy.history.utilization.title}
      description={flexCopy.history.utilization.description}
      points={points}
      series={[{ key: "utilization", label: flexCopy.history.utilization.title, color: "var(--viz-line-1)" }]}
      {...inspector}
    />
    <HistoryChart
      title={flexCopy.history.rates.title}
      description={flexCopy.history.rates.description}
      points={points}
      series={[{ key: "lender_apr", label: flexCopy.history.rates.lenderApr, color: "var(--viz-line-1)" }, { key: "average_borrow_rate", label: flexCopy.history.rates.borrowerRate, color: "var(--viz-line-2)", dashed: true }]}
      {...inspector}
    />
    {points.every(point => typeof point.collateral_price_in_borrow_token === "number") ? <HistoryChart
      title="Oracle price history"
      description={`Flex valuation per ${market.collateral_token.symbol}.`}
      points={points}
      priceSymbol={market.borrow_token.symbol}
      series={[{ key: "collateral_price_in_borrow_token", label: "Oracle", color: "var(--viz-line-1)" }]}
      {...inspector}
    /> : null}
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
  const idleLiquidity = Math.max(0, data.idle_liquidity ?? 0);
  const totalDebt = data.total_debt ?? Math.max(0, ...points.map((point) => point.redeemable_before));
  const borrowingCapacity = (redeemableBefore: number) => idleLiquidity + redeemableBefore;
  const xMax = Math.max(points.at(-1)?.annual_interest_rate ?? 0, 0.0001);
  const yMax = niceCeiling(Math.max(borrowingCapacity(totalDebt), ...points.map((point) => borrowingCapacity(point.redeemable_before)), 1));
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (rate: number) => left + (rate / xMax) * plotWidth;
  const y = (debt: number) => top + (1 - debt / yMax) * plotHeight;
  const stepPath = points.reduce((path, point) => `${path} H${x(point.annual_interest_rate).toFixed(2)} V${y(borrowingCapacity(point.redeemable_before)).toFixed(2)}`, `M${x(0).toFixed(2)},${y(idleLiquidity).toFixed(2)}`);
  const areaPath = `${stepPath} L${x(xMax).toFixed(2)},${y(idleLiquidity).toFixed(2)} Z`;
  const inspected = inspectionIndex === null ? null : points[inspectionIndex];
  const inspectedCapacity = inspected ? borrowingCapacity(inspected.redeemable_before) : 0;
  const inspectedShare = inspected && totalDebt > 0 ? inspected.redeemable_before / totalDebt : 0;
  const idlePatternId = `flex-idle-${data.market_address.slice(2, 10)}`;
  const ticks = width < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.round(entry.contentRect.width))));
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
    const index = chartKeyIndex(event.key, inspectionIndex, points.length);
    if (index === undefined) return;
    event.preventDefault();
    setInspectionIndex(index);
  };
  const summary = inspected ? flexA11y(flexCopy.redemptionPriority.summary, {
    symbol: data.borrow_token.symbol,
    rate: formatPct(inspected.annual_interest_rate),
    idle: compact.format(idleLiquidity),
    redeemed: `${compact.format(inspected.redeemable_before)} ${data.borrow_token.symbol}`,
    total: `${compact.format(inspectedCapacity)} ${data.borrow_token.symbol}`,
    share: formatPct(inspectedShare),
  }) : "";
  const inspectionDetails = inspected ? [
    [flexCopy.redemptionPriority.tooltip.annualRate, formatPct(inspected.annual_interest_rate)],
    [flexA11y(flexCopy.redemptionPriority.tooltip.idle, { symbol: data.borrow_token.symbol }), `${compact.format(idleLiquidity)} ${data.borrow_token.symbol}`],
    [flexCopy.redemptionPriority.tooltip.redeemed, `${compact.format(inspected.redeemable_before)} ${data.borrow_token.symbol}`],
    [flexCopy.redemptionPriority.tooltip.total, `${compact.format(inspectedCapacity)} ${data.borrow_token.symbol}`],
    [flexCopy.redemptionPriority.tooltip.shareOfTotal, formatPct(inspectedShare)],
  ] : [];

  return <>
  <div className="flex-redemption-legend">
    <span><i className="flex-redemption-idle-swatch" aria-hidden="true" />{flexA11y(flexCopy.redemptionPriority.legend.idle, { symbol: data.borrow_token.symbol })}<strong>{compact.format(idleLiquidity)} {data.borrow_token.symbol}</strong></span>
    <span><i className="flex-redemption-redeemable-swatch" aria-hidden="true" />{flexCopy.redemptionPriority.legend.redeemable}</span>
  </div>
  <p className="flex-chart-hint" id="flex-capacity-hint">{flexCopy.redemptionPriority.chart.interaction}</p>
  <div
    ref={chartRef}
    className="flex-chart-interactive flex-redemption-chart"
    tabIndex={0}
    role="group"
    aria-label={`${flexCopy.redemptionPriority.chart.ariaLabel}. ${flexCopy.redemptionPriority.axes.annualRate}. ${flexA11y(flexCopy.redemptionPriority.axes.capacity, { symbol: data.borrow_token.symbol })}.`}
    aria-describedby="flex-capacity-hint"
    onFocus={() => setInspectionIndex((current) => current ?? points.length - 1)}
    onBlur={() => setInspectionIndex(null)}
    onKeyDown={moveInspection}
    onPointerMove={(event) => inspectFromClientX(event.clientX)}
    onPointerDown={(event) => inspectFromClientX(event.clientX)}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") setInspectionIndex(null); }}
  >
    <svg className="flex-line-chart" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <pattern id={idlePatternId} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6L6 0" className="flex-redemption-idle-pattern" />
        </pattern>
      </defs>
      {ticks.map(ratio => <line key={ratio} x1={left} x2={width - right} y1={y(yMax * ratio)} y2={y(yMax * ratio)} className="flex-chart-grid" />)}
      <rect x={left} y={y(idleLiquidity)} width={plotWidth} height={Math.max(0, y(0) - y(idleLiquidity))} fill={`url(#${idlePatternId})`} className="flex-redemption-idle-area" />
      <line x1={left} x2={width - right} y1={y(idleLiquidity)} y2={y(idleLiquidity)} className="flex-redemption-idle-line" />
      <path d={areaPath} className="flex-redemption-area" />
      <path d={stepPath} className="flex-redemption-line" />
      {points.map((point) => <circle key={`${point.annual_interest_rate_raw}:${point.redeemable_before_raw}`} cx={x(point.annual_interest_rate)} cy={y(borrowingCapacity(point.redeemable_before))} r={width < 480 ? "2" : "3.5"} className="flex-redemption-point" />)}
      {inspected ? <g className="flex-chart-inspection">
        <line x1={x(inspected.annual_interest_rate)} x2={x(inspected.annual_interest_rate)} y1={top} y2={height - bottom} />
        <circle cx={x(inspected.annual_interest_rate)} cy={y(inspectedCapacity)} r={width < 480 ? "4" : "5"} className="flex-redemption-active-point" />
      </g> : null}
      {ticks.map(ratio => <text key={ratio} x="4" y={y(yMax * ratio) - 4} className="flex-chart-axis flex-chart-axis-inset">{compact.format(yMax * ratio)}</text>)}
      {ticks.map(ratio => <text key={ratio} x={x(xMax * ratio)} y={height - 10} textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"} className="flex-chart-axis">{axisPercent.format(xMax * ratio)}</text>)}
    </svg>
    {inspected && width >= 480 ? <dl className="flex-chart-tooltip flex-redemption-detail-list" style={{ left: tooltipLeft(x(inspected.annual_interest_rate), width) }}>
      {inspectionDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl> : null}
    <span className="sr-only" aria-live="polite">{summary}</span>
  </div>
  {inspected && width < 480 ? <dl className="flex-redemption-mobile-details flex-redemption-detail-list">
    {inspectionDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl> : null}
  </>;
}

function RedemptionPrioritySection({
  query,
}: {
  query: ReturnType<typeof useFlexMarketData>["redemptionPriority"];
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
      <p>{flexA11y(flexCopy.redemptionPriority.description, { symbol: data?.borrow_token.symbol ?? "borrow assets" })}</p>
      {freshness && freshness.data_state !== "unavailable" ? <p className="flex-redemption-freshness"><span>{freshnessLabel}</span>{source.map((item) => <span key={item}>{item}</span>)}</p> : null}
    </div>
    {query.isLoading && !data ? <div className="skeleton flex-redemption-skeleton" /> : null}
    {query.error || data?.freshness.data_state === "unavailable" ? <div className="flex-redemption-error"><p>{flexCopy.redemptionPriority.unavailable.title}</p><button type="button" className="button button-secondary" onClick={() => query.refetch()}>{flexCopy.redemptionPriority.unavailable.retry}</button></div> : null}
    {data && data.freshness.data_state !== "unavailable" && data.points.length === 0 ? <p className="muted">{flexCopy.redemptionPriority.empty}</p> : null}
    {data && data.freshness.data_state !== "unavailable" && data.points.length > 0 ? <RedemptionPriorityChart data={data} /> : null}
  </section>;
}

function TroveHealthSection({
  query,
}: {
  query: ReturnType<typeof useFlexMarketData>["troveHealth"];
}) {
  const data = query.data;
  const metrics = data?.metrics;
  const freshness = data?.freshness;
  const sourceTime = freshness?.source_block_time
    ? `${dateTime.format(new Date(freshness.source_block_time))} UTC`
    : null;

  return <section className="flex-trove-section" aria-labelledby="flex-trove-title">
    <div className="flex-trove-heading">
      <h3 id="flex-trove-title">{flexCopy.troveHealth.title}</h3>
      <p>{flexCopy.troveHealth.description}</p>
      <p className="flex-trove-definition" id="flex-trove-ltv-definition">{flexCopy.troveHealth.definition}</p>
      {sourceTime ? <p className="flex-trove-freshness"><span>{freshness?.data_state === "delayed" ? flexCopy.redemptionPriority.freshness.delayed : flexCopy.redemptionPriority.freshness.ready}</span><time dateTime={freshness?.source_block_time ?? undefined}>{sourceTime}</time></p> : null}
    </div>
    <div className="flex-trove-content">
      {query.isLoading && !data ? <p className="muted" role="status">{flexCopy.troveHealth.loading}</p> : null}
      {query.error || freshness?.data_state === "unavailable" ? <p className="muted">{flexCopy.troveHealth.unavailable}</p> : null}
      {metrics?.active_troves === 0 ? <p className="muted">{flexCopy.troveHealth.empty}</p> : null}
      {metrics && metrics.active_troves > 0 ? <dl className="flex-stat-grid" aria-describedby="flex-trove-ltv-definition">
        <div><dt>{flexCopy.troveHealth.metrics.activeTroves}</dt><dd>{metrics.active_troves}</dd></div>
        <div><dt title={flexCopy.troveHealth.ltvDefinition}>{flexCopy.troveHealth.metrics.medianLtv}</dt><dd>{formatPct(metrics.median_ltv)}</dd></div>
        <div><dt title={flexCopy.troveHealth.ltvDefinition}>{flexCopy.troveHealth.metrics.minimumBuffer}</dt><dd>{metrics.minimum_buffer_to_max_ltv === null ? flexCopy.values.unavailable : `${percentagePoints.format(metrics.minimum_buffer_to_max_ltv * 100)} pp`}</dd></div>
        <div><dt title={flexCopy.troveHealth.ltvDefinition}>{flexCopy.troveHealth.metrics.debtNearMax}</dt><dd>{formatPct(metrics.debt_near_max_share)}</dd></div>
        <div><dt>{flexCopy.troveHealth.metrics.largestDebtShare}</dt><dd>{formatPct(metrics.largest_debt_share)}</dd></div>
      </dl> : null}
    </div>
  </section>;
}

type EventDetail = readonly [label: string] | readonly [label: string, amount: string, token: "borrow_token" | "collateral_token"];
const EVENTS = new Map<string, EventDetail>([
  ["open_trove", ["Position opened", "debt_raw", "borrow_token"]],
  ["close_trove", ["Position closed", "debt_raw", "borrow_token"]],
  ["close_zombie_trove", ["Dormant position closed", "debt_raw", "borrow_token"]],
  ["borrow", ["Borrowed", "debt_raw", "borrow_token"]],
  ["repay", ["Repaid", "debt_raw", "borrow_token"]],
  ["liquidation", ["Liquidated", "debt_raw", "borrow_token"]],
  ["redeem_trove", ["Position redeemed", "debt_raw", "borrow_token"]],
  ["redemption", ["Redeemed", "debt_raw", "borrow_token"]],
  ["lender_deposit", ["Deposited", "assets_raw", "borrow_token"]],
  ["lender_withdrawal", ["Withdrawn", "assets_raw", "borrow_token"]],
  ["add_collateral", ["Collateral added", "collateral_raw", "collateral_token"]],
  ["remove_collateral", ["Collateral removed", "collateral_raw", "collateral_token"]],
  ["auction_kick", ["Auction started", "collateral_raw", "collateral_token"]],
  ["auction_take", ["Auction filled", "take_raw", "collateral_token"]],
  ["bad_debt", ["Bad debt recorded", "loss_raw", "borrow_token"]],
  ["market_deployed", ["Market deployed"]],
  ["market_endorsed", ["Market endorsed"]],
  ["market_unendorsed", ["Market unendorsed"]],
  ["adjust_interest_rate", ["Interest rate adjusted"]],
  ["adjust", ["Position adjusted"]],
  ["close", ["Position closed", "debt_raw", "borrow_token"]],
  ["deposit", ["Deposited", "assets_raw", "borrow_token"]],
  ["withdrawal", ["Withdrawn", "assets_raw", "borrow_token"]],
]);

const ACTIVITY_FILTERS = ["redemption", "redeem_trove", "liquidation", "open_trove", "close_trove", "borrow", "repay", "lender_deposit", "lender_withdrawal", "add_collateral", "remove_collateral", "adjust_interest_rate", "auction_kick", "auction_take", "bad_debt"];

function formatActivityAmount(raw: unknown, asset: FlexMarket["borrow_token"] | undefined): string {
  const amount = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
  if (!asset || !Number.isInteger(amount) || amount < 0) return flexCopy.values.unavailable;
  return `${compact.format(amount / 10 ** asset.decimals)} ${asset.symbol}`;
}

function FlexPageContent() {
  const pageRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading, error, refetch } = useFlexMarkets();
  const showPage = !error || Boolean(data);
  const active = useMemo(() => data?.rows.filter((row) => row.status === "active") ?? [], [data]);
  const requestedMarket = searchParams.get("market")?.toLowerCase() ?? null;
  const selected = requestedMarket
    ? data?.rows.find((market) => market.addresses.market === requestedMarket) ?? null
    : [...active].sort((a, b) => (b.metrics?.deposits_usd ?? 0) - (a.metrics?.deposits_usd ?? 0))[0] ?? null;
  const selectableMarkets = selected && selected.status !== "active" ? [...active, selected] : active;
  useFlexMarketPreload(selectableMarkets);
  const period = (key: string) => FLEX_PERIODS.find(days => days === Number(searchParams.get(key))) ?? 30;
  const days = period("days");
  const performanceDays = period("pnl_days");
  const selectedAddress = selected?.addresses.market;
  const { history, detail, peg, redemptionPriority, troveHealth } = useFlexMarketData(selected, days);
  const risk = detail.data?.risk;
  const [activityMarket, setActivityMarket] = useState("");
  const [activityEvent, setActivityEvent] = useState("");
  const activity = useFlexActivity({ market_address: activityMarket || undefined, event: activityEvent || undefined });
  const activityRows = activity.data?.pages.flatMap((page) => page.rows) ?? [];
  const marketByAddress = useMemo(() => new Map(data?.rows.map((market) => [market.addresses.market, market])), [data]);
  function marketHref(address: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("market", address);
    return `${pathname}?${next}#flex-detail-title`;
  }
  const updateQuery = useCallback((updates: Record<string, string | number | null>) => {
    const hash = window.location.hash;
    replaceQuery(pathname, searchParams, updates, undefined, hash === "#flex-detail-title" ? "" : hash);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!selected || requestedMarket) return;
    updateQuery({ market: selected.addresses.market });
  }, [requestedMarket, selected, updateQuery]);

  useEffect(() => {
    if (!selectedAddress || window.location.hash !== "#flex-detail-title") return;
    const title = document.getElementById("flex-detail-title");
    title?.focus({ preventScroll: true });
    title?.scrollIntoView();
  }, [selectedAddress]);

  useEffect(() => {
    const page = pageRef.current;
    const { hash } = window.location;
    const id = hash.slice(1);
    if (!page || !SECTION_IDS.includes(id)) return;
    const title = document.getElementById(id);
    if (!title) return;

    const events = new AbortController();
    const observer = new ResizeObserver(() => {
      if (window.location.hash === hash) title.scrollIntoView();
    });
    const stop = () => {
      observer.disconnect();
      events.abort();
    };
    for (const event of ["pointerdown", "keydown", "wheel", "hashchange"]) {
      window.addEventListener(event, stop, { passive: true, signal: events.signal });
    }
    title.focus({ preventScroll: true });
    title.scrollIntoView();
    observer.observe(page);
    return stop;
  }, [showPage]);

  if (!showPage) return <DataLoadError onRetry={() => refetch()} />;

  return (
    <div className="flex-page" ref={pageRef}>
      <section className="page-header page-header-no-border">
        <h1 className="page-title">{flexCopy.hero.title}<br /><em className="page-title-accent">{flexCopy.hero.accent}</em></h1>
        <p className="page-description">{flexCopy.hero.blurb}</p>
        <div className="tab-bar-plain">
          <a href="https://flexmeow.com" target="_blank" rel="noopener noreferrer" className="button button-primary">{flexCopy.hero.officialLink}</a>
        </div>
      </section>

      <section className="section section-lg flex-markets-section" aria-labelledby="flex-markets-title">
        <div className="flex-section-heading">
          <div><h2 className="card-title" id="flex-markets-title" tabIndex={-1}>{flexCopy.markets.title}</h2><p className="card-description">{flexCopy.markets.description}</p></div>
          {data?.freshness.indexed_through ? <p className="flex-market-freshness">{data.freshness.data_state === "ready" ? "Updated" : "Updates delayed. Last indexed"} <time dateTime={data.freshness.indexed_through}>{dateTime.format(new Date(data.freshness.indexed_through))} UTC</time></p> : null}
        </div>
        {isLoading && !data ? <TableWrap className="flex-market-table-wrap"><table className="decision-table" aria-labelledby="flex-markets-title"><tbody><TableSkeleton rows={2} columns={MARKET_COLUMNS.length + 1} /></tbody></table></TableWrap> : active.length ? <MarketTable rows={active} marketHref={marketHref} /> : <p className="muted">{flexCopy.markets.noActive}</p>}
        <p className="section-note flex-market-note">Expected lender APR assumes all debt pays interest. Borrow rate is weighted by outstanding debt.</p>
      </section>

      {selected ? <section className="ruled-section flex-detail-section" aria-label={flexCopy.detail.title}>
        <div className="flex-section-heading flex-detail-heading">
          <div>
            <h2 className="card-title" id="flex-detail-title" tabIndex={-1}>{selected.label}</h2>
            <p className="card-description">v{selected.contract_version} · <time dateTime={selected.deployment_time} title="Deployment date">{date.format(new Date(selected.deployment_time))}</time></p>
          </div>
          {selectableMarkets.length > 1 ? <label className="flex-filter flex-market-picker">Market
            <select aria-label={flexCopy.detail.selectLabel} value={selected.addresses.market} onChange={event => updateQuery({ market: event.target.value })}>
              {selectableMarkets.map(market => <option key={market.addresses.market} value={market.addresses.market}>{market.label}{market.status !== "active" ? " (historical)" : ""}</option>)}
            </select>
          </label> : null}
        </div>
        {selected.status !== "active" ? <p className="section-note">Historical market · {flexCopy.status[selected.status]} · <Link className="report-link" href={`https://etherscan.io/address/${selected.addresses.market}`} target="_blank" rel="noreferrer">{selected.addresses.market.slice(0, 6)}…{selected.addresses.market.slice(-4)}</Link></p> : null}
        <dl className="flex-stat-grid flex-market-card-details">
          {MARKET_COLUMNS.filter(column => !("card" in column) && column.key !== "collateral_apr").map(column =>
            <div key={column.key}><dt>{column.label}</dt><dd>{column.format(marketValue(selected, column.key))}</dd></div>)}
        </dl>
        {risk ? <section className="flex-risk-section" aria-labelledby="flex-risk-title">
          <div className="flex-section-heading"><h3 id="flex-risk-title">{flexCopy.detail.risk.title}</h3><RiskAssessmentLink chainId={1} address={selected.addresses.lender} label={selected.label} /></div>
          <dl className="flex-stat-grid">
            <div><dt>{flexCopy.detail.risk.primary.minimumDebt}</dt><dd>{risk.minimum_debt === null ? flexCopy.values.unavailable : `${compact.format(risk.minimum_debt)} ${selected.borrow_token.symbol}`}</dd></div>
            <div><dt>{flexCopy.detail.risk.primary.maximumLtv}</dt><dd>{formatPct(risk.maximum_ltv)}</dd></div>
            <div><dt>{flexCopy.detail.risk.secondary.safeLtv}</dt><dd>{formatPct(risk.safe_ltv)}</dd></div>
            <div><dt>{flexCopy.detail.risk.secondary.maximumFeeThreshold}</dt><dd>{formatPct(risk.maximum_penalty_ltv)}</dd></div>
            <div><dt>{flexCopy.detail.risk.secondary.liquidationFeeRange}</dt><dd>{formatPct(risk.minimum_liquidation_fee)} – {formatPct(risk.maximum_liquidation_fee)}</dd></div>
          </dl>
          <p className="section-note">LTV = debt ÷ collateral value. Safe LTV is a protocol threshold.</p>
        </section> : null}
        {detail.data ? <MarketPricing detail={detail.data} peg={peg} /> : null}
        <TroveHealthSection query={troveHealth} />
        <RedemptionPrioritySection query={redemptionPriority} />
        <div className="flex-history-heading-row">
          <div><h3>{flexCopy.history.title}{history.isPlaceholderData ? " · Updating…" : ""}</h3></div>
          <div className="flex-range-tabs" role="group" aria-label={flexCopy.history.rangeLabel}>
            {FLEX_PERIODS.map(value => <button key={value} type="button" className={`flex-range-tab ${days === value ? "is-active" : ""}`} aria-pressed={days === value} onClick={() => updateQuery({ days: value })}>{value} days</button>)}
          </div>
        </div>
        {history.isLoading && !history.data ? <div className="flex-chart-grid-layout"><div className="skeleton flex-chart-skeleton" /><div className="skeleton flex-chart-skeleton" /></div> : history.data?.points.length ? <HistoryCharts points={history.data.points} market={selected} /> : <p className="muted">{flexCopy.history.unavailable}</p>}
      </section> : null}
      {requestedMarket && data && !selected ? <section className="ruled-section" aria-labelledby="flex-detail-title">
        <h2 className="card-title" id="flex-detail-title">{flexCopy.detail.title}</h2>
        <p className="muted">Market not found.</p>
        <Link className="report-link" href="/flex">View active markets</Link>
      </section> : null}

      <FlexPerformance days={performanceDays} onDays={(value) => updateQuery({ pnl_days: value })} marketHref={marketHref} />

      <section className="ruled-section flex-activity-section" aria-labelledby="flex-activity-title">
        <div className="flex-section-heading">
          <h2 className="card-title" id="flex-activity-title" tabIndex={-1}>{flexCopy.activity.title}</h2>
          <div className="flex-activity-filters">
            <label className="flex-filter">Market<select aria-label="Activity market" value={activityMarket} onChange={event => setActivityMarket(event.target.value)}>
              <option value="">All markets</option>
              {data?.rows.map(market => <option key={market.addresses.market} value={market.addresses.market}>{market.label} · v{market.contract_version}</option>)}
            </select></label>
            <label className="flex-filter">Event<select aria-label="Activity event" value={activityEvent} onChange={event => setActivityEvent(event.target.value)}>
              <option value="">All events</option>
              {ACTIVITY_FILTERS.map(event => <option key={event} value={event}>{event === "redemption" ? "Redemptions" : EVENTS.get(event)?.[0]}</option>)}
            </select></label>
          </div>
        </div>
        <TableWrap className="flex-activity-wrap"><table className="decision-table flex-activity-table" aria-labelledby="flex-activity-title">
          <thead><tr><th>{flexCopy.activity.headers.event}</th>{!activityMarket ? <th>{flexCopy.activity.headers.market}</th> : null}<th className="flex-activity-time">{flexCopy.activity.headers.time}</th><th className="numeric">{flexCopy.activity.headers.amount}</th></tr></thead>
          <tbody>{activity.isLoading && !activity.data ? <TableSkeleton rows={8} columns={activityMarket ? 3 : 4} /> : activityRows.map((row) => {
            const event = EVENTS.get(row.event);
            const market = marketByAddress.get(row.market_address);
            const amount = event?.length === 3
              ? formatActivityAmount(row.amounts[event[1]], market?.[event[2]])
              : flexCopy.values.unavailable;
            return <tr key={`${row.tx_hash}:${row.log_index}`}>
              <td className="flex-activity-event">{event?.[0] ?? row.event.replaceAll("_", " ")}
                {row.redemption ? <small className="flex-market-unit">
                  {row.redemption.troves === null ? "Trove count unavailable" : `${row.redemption.troves} ${row.redemption.troves === 1 ? "trove" : "troves"}`}
                  {row.redemption.highest_annual_rate === null ? "" : ` · up to ${formatPct(row.redemption.highest_annual_rate)}`}
                </small> : null}
              </td>
              {!activityMarket ? <td className="flex-activity-market">{row.market_label}</td> : null}
              <td className="flex-activity-time"><Link className="report-link report-link-utility" href={`https://etherscan.io/tx/${row.tx_hash}`} target="_blank" rel="noreferrer" aria-label={flexA11y(flexCopy.accessibility.transaction, { hash: row.tx_hash })}><time dateTime={row.block_time}>{dateTime.format(new Date(row.block_time))} UTC</time></Link></td>
              <td className="flex-activity-amount numeric data-value">{amount}</td>
            </tr>;
          })}</tbody>
        </table></TableWrap>
        {activity.isError ? <DataLoadError onRetry={() => activity.refetch()} /> : !activity.isLoading && activityRows.length === 0 ? <p className="muted">{flexCopy.activity.empty}</p> : null}
        {activity.hasNextPage ? <button type="button" className="button button-ghost flex-activity-more" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>{activity.isFetchingNextPage ? flexCopy.activity.loadingMore : flexCopy.activity.loadMore}</button> : null}
      </section>
    </div>
  );
}

export default function FlexPage() {
  return <Suspense fallback={<div className="page-loading">{flexCopy.loading.page}</div>}><FlexPageContent /></Suspense>;
}
