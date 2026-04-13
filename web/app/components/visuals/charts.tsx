"use client";

import type { CSSProperties } from "react";
import { formatPct, formatUsd, formatUsdCompact } from "../../lib/format";
import { useInViewOnce } from "./use-in-view-once";
import { finiteValues, normalize } from "./utils";
import type { RidgelineSeries, ScatterPoint } from "./types";

export function ScatterPlot({
  title,
  xLabel,
  yLabel,
  points,
  xFormatter,
  yFormatter,
  emptyText = "No points available for this filter.",
  className,
  densityBackdrop = false,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  points: ScatterPoint[];
  xFormatter: (value: number) => string;
  yFormatter: (value: number) => string;
  emptyText?: string;
  className?: string;
  densityBackdrop?: boolean;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const valid = points.filter((point) => {
    const x = point.x;
    const y = point.y;
    return x !== null && x !== undefined && y !== null && y !== undefined && Number.isFinite(x) && Number.isFinite(y);
  });
  if (valid.length === 0) {
    return (
      <section ref={ref} className={`viz-panel ${className ?? ""} ${isInView ? "is-in-view" : ""}`.trim()}>
        <h3>{title}</h3>
        <div className="panel-empty muted">{emptyText}</div>
      </section>
    );
  }

  const width = 900;
  const height = 360;
  const xValues = finiteValues(valid.map((point) => point.x));
  const yValues = finiteValues(valid.map((point) => point.y));
  const sizeValues = finiteValues(valid.map((point) => point.size));
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const sizeMin = sizeValues.length > 0 ? Math.min(...sizeValues) : 0;
  const sizeMax = sizeValues.length > 0 ? Math.max(...sizeValues) : 1;
  const xMid = (xMin + xMax) / 2;
  const yMid = (yMin + yMax) / 2;
  const yTickLabels = [yFormatter(yMin), yFormatter(yMid), yFormatter(yMax)];
  const widestYTick = yTickLabels.reduce((max, label) => Math.max(max, label.length), 0);
  const paddingLeft = Math.min(90, Math.max(56, 16 + widestYTick * 7));
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 56;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;
  const densityBins = new Map<string, number>();
  const densityColumns = 18;
  const densityRows = 10;
  if (densityBackdrop) {
    for (const point of valid) {
      const x = Number(point.x);
      const y = Number(point.y);
      const col = Math.min(densityColumns - 1, Math.max(0, Math.floor(normalize(x, xMin, xMax) * densityColumns)));
      const row = Math.min(densityRows - 1, Math.max(0, Math.floor((1 - normalize(y, yMin, yMax)) * densityRows)));
      const key = `${col}:${row}`;
      densityBins.set(key, (densityBins.get(key) ?? 0) + 1);
    }
  }
  const maxDensity = densityBins.size > 0 ? Math.max(...densityBins.values()) : 0;

  return (
    <section ref={ref} className={`viz-panel ${className ?? ""} ${isInView ? "is-in-view" : ""}`.trim()}>
      <h3>{title}</h3>
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <rect x={paddingLeft} y={paddingTop} width={innerWidth} height={innerHeight} className="viz-plot-bg" rx="6" ry="6" />
          {densityBackdrop && maxDensity > 0
            ? [...densityBins.entries()].map(([key, count]) => {
                const [colRaw, rowRaw] = key.split(":");
                const col = Number(colRaw);
                const row = Number(rowRaw);
                const cellW = innerWidth / densityColumns;
                const cellH = innerHeight / densityRows;
                const x = paddingLeft + (col + 0.5) * cellW;
                const y = paddingTop + (row + 0.5) * cellH;
                const alpha = 0.03 + (count / maxDensity) * 0.2;
                return (
                  <circle
                    key={`density-${key}`}
                    cx={x}
                    cy={y}
                    r={Math.max(cellW, cellH) * 0.72}
                    fill="rgba(var(--accent-2-rgb), 1)"
                    opacity={alpha}
                  />
                );
              })
            : null}
          <line
            x1={paddingLeft}
            x2={width - paddingRight}
            y1={paddingTop + innerHeight * 0.25}
            y2={paddingTop + innerHeight * 0.25}
            className="viz-axis viz-axis-grid"
          />
          <line
            x1={paddingLeft}
            x2={width - paddingRight}
            y1={paddingTop + innerHeight * 0.75}
            y2={paddingTop + innerHeight * 0.75}
            className="viz-axis viz-axis-grid"
          />
          <line
            x1={paddingLeft + innerWidth * 0.25}
            x2={paddingLeft + innerWidth * 0.25}
            y1={paddingTop}
            y2={height - paddingBottom}
            className="viz-axis viz-axis-grid"
          />
          <line
            x1={paddingLeft + innerWidth * 0.75}
            x2={paddingLeft + innerWidth * 0.75}
            y1={paddingTop}
            y2={height - paddingBottom}
            className="viz-axis viz-axis-grid"
          />
          <line x1={paddingLeft} x2={width - paddingRight} y1={height - paddingBottom} y2={height - paddingBottom} className="viz-axis" />
          <line x1={paddingLeft} x2={paddingLeft} y1={paddingTop} y2={height - paddingBottom} className="viz-axis" />
          {valid.map((point, index) => {
            const x = Number(point.x);
            const y = Number(point.y);
            const xNorm = normalize(x, xMin, xMax);
            const yNorm = normalize(y, yMin, yMax);
            const cx = paddingLeft + xNorm * innerWidth;
            const cy = paddingTop + (1 - yNorm) * innerHeight;
            const radius =
              point.size !== null && point.size !== undefined && Number.isFinite(point.size)
                ? 4 + normalize(Number(point.size), sizeMin, sizeMax) * 6.3
                : 5;
            const toneClass =
              point.tone === "positive" ? "viz-point-positive" : point.tone === "negative" ? "viz-point-negative" : "viz-point-neutral";
            const pointTitle = point.tooltip ?? `${xLabel}: ${xFormatter(x)}\n${yLabel}: ${yFormatter(y)}`;
            if (point.href) {
              return (
                <a key={point.id} href={point.href} target="_blank" rel="noreferrer noopener" className="viz-point-link">
                  <title>{pointTitle}</title>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    className={`viz-point ${toneClass}`}
                    style={{ "--point-delay": `${Math.min(index, 12) * 0.01}s` } as CSSProperties}
                  />
                </a>
              );
            }
            return (
              <g key={point.id}>
                <title>{pointTitle}</title>
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  className={`viz-point ${toneClass}`}
                  style={{ "--point-delay": `${Math.min(index, 12) * 0.01}s` } as CSSProperties}
                />
              </g>
            );
          })}
          <text x={paddingLeft} y={height - 10} className="viz-tick">
            {xFormatter(xMin)}
          </text>
          <text x={paddingLeft + innerWidth / 2} y={height - 10} className="viz-tick" textAnchor="middle">
            {xFormatter(xMid)}
          </text>
          <text x={width - paddingRight} y={height - 10} className="viz-tick" textAnchor="end">
            {xFormatter(xMax)}
          </text>
          <text x={paddingLeft - 10} y={height - paddingBottom} className="viz-tick" textAnchor="end" dominantBaseline="central">
            {yTickLabels[0]}
          </text>
          <text x={paddingLeft - 10} y={paddingTop + innerHeight / 2} className="viz-tick" textAnchor="end" dominantBaseline="central">
            {yTickLabels[1]}
          </text>
          <text x={paddingLeft - 10} y={paddingTop} className="viz-tick" textAnchor="end" dominantBaseline="hanging">
            {yTickLabels[2]}
          </text>
          <text x={paddingLeft + innerWidth / 2} y={height - 26} className="viz-axis-label" textAnchor="middle">
            {xLabel}
          </text>
          <text x={paddingLeft + 4} y={14} className="viz-axis-label" textAnchor="start">
            {yLabel}
          </text>
        </svg>
      </div>
    </section>
  );
}

export function Ridgeline({
  title,
  series,
  emptyText = "Need more samples for distribution curves.",
  valueLabel = "APY",
}: {
  title: string;
  series: RidgelineSeries[];
  emptyText?: string;
  valueLabel?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const ridgelinePalette = [
    { stroke: "var(--viz-line-1)", fill: "rgba(6, 87, 233, 0.22)" },
    { stroke: "var(--viz-line-3)", fill: "rgba(168, 85, 247, 0.2)" },
    { stroke: "var(--viz-line-4)", fill: "rgba(245, 158, 11, 0.2)" },
    { stroke: "var(--viz-line-2)", fill: "rgba(45, 212, 191, 0.2)" },
  ];
  const valid = series.filter((row) => row.values.length >= 4).slice(0, 6);
  if (valid.length === 0) {
    return (
      <section className="viz-panel ridgeline-panel">
        <h3>{title}</h3>
        <p className="muted">{emptyText}</p>
      </section>
    );
  }
  const width = 920;
  const rowH = valid.length >= 5 ? 28 : 32;
  const maxLabelChars = valid.reduce((acc, row) => Math.max(acc, row.label.length), 0);
  const maxNoteChars = valid.reduce((acc, row) => Math.max(acc, row.note.length), 0);
  const chartLeft = Math.round(width * Math.max(0.102, Math.min(0.172, 0.036 + maxLabelChars * 0.0072)));
  const chartRight = Math.round(width * Math.max(0.104, Math.min(0.188, 0.048 + maxNoteChars * 0.0068)));
  const chartWidth = Math.max(220, width - chartLeft - chartRight);
  const peakHeight = Math.max(8, Math.min(11, rowH * 0.38));
  const height = 8 + valid.length * rowH + 16;
  const bins = Math.max(14, Math.min(20, Math.round(chartWidth / 48)));
  const allValues = valid.flatMap((row) => row.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(0.0001, max - min);

  return (
    <section ref={ref} className={`viz-panel ridgeline-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      <h3>{title}</h3>
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {valid.map((row, idx) => {
            const tone = ridgelinePalette[idx % ridgelinePalette.length];
            const yBase = 8 + idx * rowH + peakHeight + 3;
            const counts = new Array<number>(bins).fill(0);
            for (const value of row.values) {
              const bucket = Math.max(0, Math.min(bins - 1, Math.floor(((value - min) / span) * bins)));
              counts[bucket] += 1;
            }
            const maxCount = Math.max(1, ...counts);
            const pathTop = counts
              .map((count, bucketIndex) => {
                const x = chartLeft + (bucketIndex / (bins - 1)) * chartWidth;
                const y = yBase - (count / maxCount) * peakHeight;
                return `${bucketIndex === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ");
            const pathBottom = counts
              .map((_, bucketIndex) => {
                const reverseIndex = bins - 1 - bucketIndex;
                const x = chartLeft + (reverseIndex / (bins - 1)) * chartWidth;
                return `L${x.toFixed(2)},${yBase.toFixed(2)}`;
              })
              .join(" ");
            return (
              <g key={row.id}>
                <title>{`${row.label}\n${row.note}\n${valueLabel} range ${formatPct(min, 1)} to ${formatPct(max, 1)}`}</title>
                <path d={`${pathTop} ${pathBottom} Z`} fill={tone.fill} stroke={tone.stroke} strokeWidth={0.9} className="ridgeline-curve" />
                <text x={8} y={yBase - 0.5} className="ridgeline-label" dominantBaseline="central">{row.label}</text>
                <text x={width - 8} y={yBase - 0.5} className="ridgeline-note" textAnchor="end" dominantBaseline="central">{row.note}</text>
              </g>
            );
          })}
          <line x1={chartLeft} x2={width - chartRight} y1={height - 12} y2={height - 12} className="viz-axis" />
          <text x={chartLeft} y={height - 2} className="ridgeline-axis">{formatPct(min, 1)}</text>
          <text x={width - chartRight} y={height - 2} className="ridgeline-axis" textAnchor="end">{formatPct(max, 1)}</text>
        </svg>
      </div>
      <p className="muted viz-legend">Ridgelines show {valueLabel.toLowerCase()} shape by chain. Taller peaks mean more vaults at that {valueLabel.toLowerCase()} zone.</p>
    </section>
  );
}
