"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "./empty-state";
import { DataLoadError } from "./error-state";
import { TableSkeleton } from "./skeleton";
import { TableWrap } from "./table-wrap";
import { explorerTxUrl, formatUtcDateTime } from "../lib/format";
import {
  useYlockerRewards,
  type YlockerReportingWeek,
  type YlockerRewardCycle,
} from "../hooks/use-ylocker-rewards";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const freshnessDateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
type ChartMode = "combined" | "ycrv" | "yyb";

function formatValue(value: number): string {
  return `${number.format(value)} crvUSD`;
}

function formatShares(value: number): string {
  return `${number.format(value)} yvcrvUSD-2`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatFreshness(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${freshnessDateTime.format(date)} UTC`;
}

function productValue(week: YlockerReportingWeek, product: "ycrv" | "yyb"): number {
  return week.products.find((row) => row.product === product)?.value_crvusd_at_deposit ?? 0;
}

function RewardChart({ weeks, mode }: { weeks: YlockerReportingWeek[]; mode: ChartMode }) {
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const chronological = [...weeks].reverse();
  const chartValue = (week: YlockerReportingWeek) => (
    mode === "combined" ? week.total_crvusd_at_deposit : productValue(week, mode)
  );
  const maximum = Math.max(1, ...chronological.map(chartValue));
  const description = mode === "combined"
    ? "Completed yCRV and yYB deposits, grouped Thursday–Thursday UTC. crvUSD value at deposit."
    : mode === "ycrv"
      ? "Completed yCRV deposits, grouped Thursday–Thursday UTC. crvUSD value at deposit."
      : "Completed yYB deposits, grouped Thursday–Thursday UTC. crvUSD value at deposit.";
  const label = mode === "combined"
    ? "yLocker rewards, Thu to Thu UTC"
    : mode === "ycrv"
      ? "yCRV rewards, Thu to Thu UTC"
      : "yYB rewards, Thu to Thu UTC";

  const updateOverflow = useCallback(() => {
    const wrap = chartWrapRef.current;
    if (!wrap) return;
    setOverflow({
      start: wrap.scrollLeft > 1,
      end: wrap.scrollWidth - wrap.scrollLeft - wrap.clientWidth > 1,
    });
  }, []);

  useEffect(() => {
    const wrap = chartWrapRef.current;
    if (!wrap) return;
    const frame = requestAnimationFrame(() => {
      wrap.scrollLeft = wrap.scrollWidth;
      updateOverflow();
    });
    wrap.addEventListener("scroll", updateOverflow, { passive: true });
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(frame);
      wrap.removeEventListener("scroll", updateOverflow);
      observer.disconnect();
    };
  }, [mode, updateOverflow, weeks]);

  return (
    <div
      ref={chartWrapRef}
      className="ylocker-chart-wrap"
      data-overflow-start={overflow.start ? "true" : "false"}
      data-overflow-end={overflow.end ? "true" : "false"}
    >
      <p className="sr-only" id="ylocker-chart-description">{description}</p>
      <div className={`ylocker-chart-legend ${mode !== "combined" ? "is-single" : ""}`.trim()} aria-hidden="true">
        {mode !== "yyb" ?
        <span><i className="ylocker-swatch ylocker-swatch-ycrv" />yCRV</span>
        : null}
        {mode !== "ycrv" ? <span><i className="ylocker-swatch ylocker-swatch-yyb" />yYB</span> : null}
      </div>
      <div className="ylocker-chart" role="list" aria-label={label} aria-describedby="ylocker-chart-description">
        {chronological.map((week) => {
          const ycrv = productValue(week, "ycrv");
          const yyb = productValue(week, "yyb");
          const value = chartValue(week);
          const totalHeight = Math.max(2, (value / maximum) * 100);
          const ycrvShare = week.total_crvusd_at_deposit > 0 ? ycrv / week.total_crvusd_at_deposit : 0;
          const weekRange = `${formatDate(week.week_start)} to ${formatDate(week.week_end)}`;
          const ariaLabel = mode === "combined"
            ? `${weekRange}. Total ${formatValue(week.total_crvusd_at_deposit)}. yCRV ${formatValue(ycrv)}. yYB ${formatValue(yyb)}.`
            : mode === "ycrv"
              ? `${weekRange}. yCRV ${formatValue(ycrv)}.`
              : `${weekRange}. yYB ${formatValue(yyb)}.`;
          return (
            <div
              key={week.calendar_week}
              className="ylocker-bar"
              role="listitem"
              tabIndex={0}
              aria-label={ariaLabel}
            >
              <span className="ylocker-bar-value" aria-hidden="true">{compactNumber.format(value)}</span>
              <span className="ylocker-bar-track" aria-hidden="true">
                <span className="ylocker-bar-stack" style={{ height: `${totalHeight}%` }}>
                  {mode !== "yyb" ? <span className="ylocker-bar-segment ylocker-bar-ycrv" style={{ height: `${mode === "combined" ? ycrvShare * 100 : 100}%` }} /> : null}
                  {mode !== "ycrv" ? <span className="ylocker-bar-segment ylocker-bar-yyb" style={{ height: `${mode === "combined" ? (1 - ycrvShare) * 100 : 100}%` }} /> : null}
                </span>
              </span>
              <span className="ylocker-bar-label" aria-hidden="true">{formatDate(week.week_start).replace(/, \d{4}$/, "")}</span>
              <span className="ylocker-bar-tooltip" aria-hidden="true">
                <strong>{formatValue(week.total_crvusd_at_deposit)}</strong>
                <span>yCRV {formatValue(ycrv)}</span>
                <span>yYB {formatValue(yyb)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceRows({ cycle }: { cycle: YlockerRewardCycle }) {
  return (
    <tr className="ylocker-evidence-row">
      <td colSpan={5}>
        <TableWrap className="ylocker-evidence-wrap">
          <table className="ylocker-evidence-table">
            <thead><tr><th>Time</th><th className="numeric">Value at deposit</th><th className="numeric">Reward shares</th><th className="numeric">PPS at deposit</th><th>Transaction</th></tr></thead>
            <tbody>{cycle.events.map((event) => {
              const txUrl = explorerTxUrl(1, event.tx_hash);
              return <tr key={`${event.tx_hash}:${event.log_index}`}>
                <td data-label="Time">{formatUtcDateTime(event.block_time)}</td>
                <td data-label="Value at deposit" className="numeric">{formatValue(event.value_crvusd_at_deposit)}</td>
                <td data-label="Reward shares" className="numeric">{formatShares(event.reward_shares)}</td>
                <td data-label="PPS at deposit" className="numeric">{number.format(event.pps_at_deposit)}</td>
                <td data-label="Transaction">{txUrl ? <a className="external-link report-link report-link-utility" href={txUrl} target="_blank" rel="noreferrer" aria-label={`Open the ${cycle.product_label} deposit transaction from ${formatUtcDateTime(event.block_time)} in a new tab`}>View transaction</a> : "Unavailable"}</td>
              </tr>;
            })}</tbody>
          </table>
        </TableWrap>
      </td>
    </tr>
  );
}

export function LockerRewards() {
  const { data, isLoading, error, refetch } = useYlockerRewards();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [chartMode, setChartMode] = useState<ChartMode>("combined");
  const [showAllCycles, setShowAllCycles] = useState(false);
  const cycles = useMemo(() => data?.cycles ?? [], [data?.cycles]);
  const visibleCycles = showAllCycles ? cycles : cycles.slice(0, 12);
  const finalizedWeeks = useMemo(
    () => data?.reporting_weeks.filter((week) => week.status === "finalized") ?? [],
    [data?.reporting_weeks],
  );
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  return (
    <>
      <section className="section section-lg ylocker-chart-section">
        <div className="card-header ylocker-chart-header"><div><h2 className="card-title">Reward deposits by week</h2><p className="card-description">Thursday–Thursday UTC. crvUSD value at deposit.</p>
          <div className="ylocker-freshness" aria-label="Locker reward freshness">{isLoading && !data ? <span>Loading locker rewards…</span> : <span className="ylocker-freshness-time"><span className="ylocker-freshness-label">{data?.freshness.status === "fresh" ? "Updated" : data?.freshness.status === "delayed" ? "Update delayed" : "Updates unavailable"}</span>{data?.freshness.indexed_through ? <time className="ylocker-freshness-value" dateTime={data.freshness.indexed_through}>{formatFreshness(data.freshness.indexed_through)}</time> : null}</span>}</div>
        </div>
          <div className="ylocker-chart-modes" role="group" aria-label="Chart scale">
            {([['combined', 'Combined'], ['ycrv', 'yCRV'], ['yyb', 'yYB']] as const).map(([value, label]) => <button key={value} type="button" className={`button-reset ylocker-chart-mode ${chartMode === value ? "is-active" : ""}`.trim()} aria-pressed={chartMode === value} onClick={() => setChartMode(value)}>{label}</button>)}
          </div>
        </div>
        {isLoading && !data ? <div className="ylocker-chart-skeleton skeleton" /> : finalizedWeeks.length === 0 ? <EmptyState title="No completed weeks yet" description="Rewards will appear here when a week is complete." /> : <RewardChart weeks={finalizedWeeks} mode={chartMode} />}
      </section>

      <section className="section section-lg ylocker-history-section">
        <div className="card-header"><div><h2 className="card-title">Reward history</h2><p className="card-subtitle">Each locker’s reward schedule · newest first</p></div></div>
        {!isLoading && cycles.length === 0 ? <EmptyState title="No reward history yet" description="Completed yCRV and yYB weeks will appear here." /> : (
          <TableWrap className="reports-table-wrap ylocker-cycles-wrap">
            <table className="reports-table ylocker-cycles-table">
              <thead><tr><th>Locker</th><th>Week</th><th className="numeric">Value at deposit</th><th className="numeric">yvcrvUSD-2 shares</th><th className="numeric">Deposits</th></tr></thead>
              <tbody>{isLoading && !data ? <TableSkeleton rows={8} columns={5} /> : visibleCycles.map((cycle) => {
                const key = `${cycle.product}:${cycle.native_week}`;
                const open = expanded.has(key);
                return [
                  <tr key={key}>
                    <td data-label="Locker"><strong>{cycle.product_label}</strong></td>
                    <td data-label="Week"><div>Week {cycle.native_week}</div><div className="muted">{formatDate(cycle.cycle_start)} to {formatDate(cycle.cycle_end)}</div></td>
                    <td data-label="Value at deposit" className="numeric">{formatValue(cycle.value_crvusd_at_deposit)}</td>
                    <td data-label="yvcrvUSD-2 shares" className="numeric">{number.format(cycle.reward_shares)}</td>
                    <td data-label="Deposits" className="numeric"><div className="ylocker-deposits-cell"><span>{cycle.event_count}</span>{cycle.events.length > 0 ? <button type="button" className="button-reset table-filter-action ylocker-disclosure" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} deposits for ${cycle.product_label}, week ${cycle.native_week}, ${formatDate(cycle.cycle_start)} to ${formatDate(cycle.cycle_end)}`} onClick={() => toggle(key)}>{open ? "Hide deposits" : "Show deposits"}</button> : null}</div></td>
                  </tr>,
                  open ? <EvidenceRows key={`${key}:evidence`} cycle={cycle} /> : null,
                ];
              })}</tbody>
            </table>
          </TableWrap>
        )}
        {cycles.length > 12 ? <button type="button" className="button button-ghost section-sm" aria-label={showAllCycles ? "Show the 12 most recent completed locker weeks" : `Show all ${cycles.length} completed locker weeks`} onClick={() => setShowAllCycles((current) => !current)}>{showAllCycles ? "Show 12 weeks" : "Show all weeks"}</button> : null}
      </section>
    </>
  );
}
