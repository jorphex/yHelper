"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { VaultHistoryPoint } from "../hooks/use-vault-history";
import { formatPct, formatUsd, formatUsdCompact } from "../lib/format";

const DAY = 86400;
const dateLabel = (ts: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(ts * 1000);
const shareLabel = (value: number | null) => value === null ? "n/a" : new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(value);

function domain(values: number[], zero = false): [number, number] {
  if (!values.length) return [0, 1];
  const min = Math.min(...values, ...(zero ? [0] : []));
  const max = Math.max(...values, ...(zero ? [0] : []));
  const padding = Math.max((max - min) * .12, Math.abs(max) * .0001, zero ? .01 : .00001);
  return [zero ? (min >= 0 ? 0 : min - padding) : Math.max(0, min - padding), max + padding];
}

function linePath(points: VaultHistoryPoint[], key: "pps" | "apy_7d", x: (ts: number) => number, y: (value: number) => number) {
  let previous: number | null = null;
  return points.map(point => {
    const value = point[key];
    if (value === null || !Number.isFinite(value)) { previous = null; return ""; }
    const command = previous === null || point.timestamp - previous > DAY * 1.5 ? "M" : "L";
    previous = point.timestamp;
    return `${command}${x(point.timestamp).toFixed(2)},${y(value).toFixed(2)}`;
  }).join(" ");
}

export function VaultChart({ points, days, asset }: { points: VaultHistoryPoint[]; days: 7 | 30 | 90; asset: string | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const end = points.at(-1)!.timestamp;
  const start = end - days * DAY;
  const visible = points.filter(point => point.timestamp >= start);
  const selectedIndex = selectedTime === null ? -1 : visible.findIndex(point => point.timestamp === selectedTime);
  const activeIndex = selectedIndex < 0 ? visible.length - 1 : selectedIndex;
  const active = visible[activeIndex] ?? visible.at(-1)!;
  const left = width < 520 ? 48 : 60;
  const right = width < 520 ? 66 : 78;
  const chartTop = 27;
  const plotHeight = width < 520 ? 230 : 290;
  const tvlTop = chartTop + plotHeight + 51;
  const tvlHeight = 72;
  const bottom = tvlTop + tvlHeight;
  const height = bottom + 36;
  const plotWidth = Math.max(1, width - left - right);
  const dayWidth = plotWidth / (days + 1);
  const x = (ts: number) => left + dayWidth / 2 + ((ts - start) / (end - start || DAY)) * (plotWidth - dayWidth);
  const [apyMin, apyMax] = domain(visible.flatMap(point => point.apy_7d === null ? [] : [point.apy_7d]), true);
  const [ppsMin, ppsMax] = domain(visible.flatMap(point => point.pps === null ? [] : [point.pps]));
  const ppsDigits = Math.min(8, Math.max(2, Math.ceil(-Math.log10((ppsMax - ppsMin) / 4))));
  const apyY = (value: number) => chartTop + plotHeight * (1 - (value - apyMin) / (apyMax - apyMin));
  const ppsY = (value: number) => chartTop + plotHeight * (1 - (value - ppsMin) / (ppsMax - ppsMin));
  const tvlMax = Math.max(1, ...visible.map(point => point.tvl_usd ?? 0));
  const barWidth = Math.max(1, Math.min(36, plotWidth / (days + 1) * .68));
  const hasPps = visible.some(point => point.pps !== null);
  const hasApy = visible.some(point => point.apy_7d !== null);
  const hasTvl = visible.some(point => point.tvl_usd !== null);
  const ticks = width < 520 ? 3 : 5;
  const inspect = (event: PointerEvent<HTMLDivElement>) => {
    if (!container.current || !width) return;
    const bounds = container.current.getBoundingClientRect();
    const position = (event.clientX - bounds.left) * width / bounds.width;
    const time = start + Math.max(0, Math.min(1, (position - left - dayWidth / 2) / (plotWidth - dayWidth))) * (end - start);
    const nearest = visible.reduce((best, point) => Math.abs(point.timestamp - time) < Math.abs(best.timestamp - time) ? point : best, visible[0]);
    setSelectedTime(nearest.timestamp);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = activeIndex;
    if (event.key === "ArrowLeft") index--;
    else if (event.key === "ArrowRight") index++;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visible.length - 1;
    else return;
    event.preventDefault();
    setSelectedTime(visible[Math.max(0, Math.min(visible.length - 1, index))].timestamp);
  };

  return <figure className="vault-chart">
    <div className="vault-chart-readout" aria-label="Selected daily observation">
      <span className="vault-chart-date">{dateLabel(active.timestamp)} <span>UTC</span></span>
      <span><span className="vault-chart-label apy-color">7d APY</span><strong>{formatPct(active.apy_7d)}</strong></span>
      <span><span className="vault-chart-label pps-color">PPS{asset ? ` · ${asset}` : ""}</span><strong>{shareLabel(active.pps)}</strong></span>
      <span><span className="vault-chart-label">TVL</span><strong>{formatUsd(active.tvl_usd)}</strong></span>
    </div>
    <div ref={container} className="vault-chart-interactive" role="slider" tabIndex={0}
      aria-label="Explore vault history" aria-valuemin={0} aria-valuemax={visible.length - 1} aria-valuenow={activeIndex}
      aria-valuetext={`${dateLabel(active.timestamp)}, seven day APY ${formatPct(active.apy_7d)}, price per share ${shareLabel(active.pps)}, TVL ${formatUsd(active.tvl_usd)}`}
      onKeyDown={keyboard} onPointerMove={inspect} onPointerDown={inspect}>
      {width > 0 ? <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-testid="vault-history-chart">
        <defs><clipPath id="vault-main-clip"><rect x={left - 1} y={chartTop - 3} width={plotWidth + 2} height={plotHeight + 6} /></clipPath></defs>
        <text x={left} y={12} className="vault-axis-label apy-color">7d realized APY</text>
        <text x={width - right} y={12} textAnchor="end" className="vault-axis-label pps-color">Price per share</text>
        {Array.from({ length: 5 }, (_, index) => {
          const ratio = index / 4;
          const y = chartTop + plotHeight * ratio;
          return <g key={index}>
            <line x1={left} x2={width - right} y1={y} y2={y} className="vault-chart-grid" />
            <text x={left - 10} y={y + 4} textAnchor="end" className="vault-axis-tick">{hasApy ? formatPct(apyMax - (apyMax - apyMin) * ratio, 1) : "—"}</text>
            <text x={width - right + 10} y={y + 4} className="vault-axis-tick">{hasPps ? (ppsMax - (ppsMax - ppsMin) * ratio).toFixed(ppsDigits) : "—"}</text>
          </g>;
        })}
        <g clipPath="url(#vault-main-clip)">
          <path d={linePath(visible, "apy_7d", x, apyY)} className="vault-line vault-line-apy" data-testid="apy-line" />
          <path d={linePath(visible, "pps", x, ppsY)} className="vault-line vault-line-pps" data-testid="pps-line" />
        </g>
        {!hasPps ? <text x={left + 10} y={chartTop + 22} className="vault-axis-label">Share price history unavailable</text> : !hasApy ? <text x={left + 10} y={chartTop + 22} className="vault-axis-label">Realized APY unavailable</text> : null}
        <text x={left} y={tvlTop - 16} className="vault-axis-label">TVL · USD</text>
        {hasTvl ? [0, .5, 1].map(ratio => <g key={ratio}>
          <line x1={left} x2={width - right} y1={bottom - ratio * tvlHeight} y2={bottom - ratio * tvlHeight} className="vault-chart-grid" />
          <text x={left - 10} y={bottom - ratio * tvlHeight + 4} textAnchor="end" className="vault-axis-tick">{formatUsdCompact(ratio * tvlMax)}</text>
        </g>) : <text x={left + plotWidth / 2} y={tvlTop + tvlHeight / 2} textAnchor="middle" className="vault-axis-label">TVL history unavailable</text>}
        {visible.map(point => point.tvl_usd !== null ? <rect key={point.timestamp} x={Math.max(left, x(point.timestamp) - barWidth / 2)} y={bottom - point.tvl_usd / tvlMax * tvlHeight}
          width={Math.min(barWidth, width - right - Math.max(left, x(point.timestamp) - barWidth / 2))} height={point.tvl_usd / tvlMax * tvlHeight} className="vault-tvl-bar" data-testid="tvl-bar" /> : null)}
        <line x1={x(active.timestamp)} x2={x(active.timestamp)} y1={chartTop} y2={bottom} className="vault-chart-cursor" />
        {active.apy_7d !== null ? <circle cx={x(active.timestamp)} cy={apyY(active.apy_7d)} r={3.5} className="vault-marker-apy" /> : null}
        {active.pps !== null ? <circle cx={x(active.timestamp)} cy={ppsY(active.pps)} r={3.5} className="vault-marker-pps" /> : null}
        {Array.from({ length: ticks }, (_, index) => {
          const ts = start + (end - start) * index / (ticks - 1);
          return <text key={index} x={x(ts)} y={bottom + 26} textAnchor={index === 0 ? "start" : index === ticks - 1 ? "end" : "middle"} className="vault-axis-tick">{dateLabel(ts)}</text>;
        })}
      </svg> : <div className="vault-chart-loading" />}
    </div>
    <figcaption className="vault-chart-caption">{days} days · {asset || "Asset"} per vault share</figcaption>
  </figure>;
}
