"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { formatPct, formatUsd, formatUsdCompact } from "../lib/format";

type Kpi = {
  label: string;
  value: string;
  hint?: string;
};

type BarDatum = {
  id: string;
  label: string;
  value: number | null | undefined;
  note?: string;
};

type HeatCellDatum = {
  id: string;
  label: string;
  value: number | null | undefined;
  note?: string;
};

type MeterSegmentDatum = {
  id: string;
  label: string;
  value: number | null | undefined;
  note?: string;
  tone?: "primary" | "positive" | "warning" | "muted";
};

type ScatterPoint = {
  id: string;
  x: number | null | undefined;
  y: number | null | undefined;
  size?: number | null | undefined;
  href?: string;
  tooltip?: string;
  label?: string;
  tone?: "positive" | "negative" | "neutral";
};

type TrendStripDatum = {
  id: string;
  label: string;
  points: Array<number | null | undefined>;
  note?: string;
};

type RidgelineSeries = {
  id: string;
  label: string;
  values: number[];
  note: string;
};

type SankeyRow = {
  previous_regime: string;
  current_regime: string;
  tvl_usd: number | null | undefined;
  vaults: number;
};

function finiteValues(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5;
  return (value - min) / (max - min);
}

const TREND_STROKE_COLORS = [
  "var(--viz-line-1)",
  "var(--viz-line-2)",
  "var(--viz-line-3)",
  "var(--viz-line-4)",
  "var(--viz-line-5)",
];

function pickTrendStroke(id: string, index: number): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TREND_STROKE_COLORS[(hash + index) % TREND_STROKE_COLORS.length];
}

// Regime helpers for Sankey
const REGIME_ORDER: Record<string, number> = {
  rising: 0,
  improving: 0,
  stable: 1,
  plateau: 1,
  falling: 2,
  declining: 2,
  choppy: 3,
  uncertain: 3,
  unknown: 4,
};

function regimeOrder(regime: string): number {
  return REGIME_ORDER[regime?.toLowerCase()] ?? 99;
}

function regimeColor(regime: string): [number, number, number] {
  const tone = regime?.toLowerCase() || "unknown";
  if (tone === "rising" || tone === "improving") return [34, 197, 94]; // green
  if (tone === "stable" || tone === "plateau") return [250, 204, 21]; // yellow
  if (tone === "falling" || tone === "declining") return [239, 68, 68]; // red
  if (tone === "choppy" || tone === "uncertain") return [168, 85, 247]; // purple
  return [148, 163, 184]; // gray
}

function compactRegimeLabel(regime: string): string {
  const map: Record<string, string> = {
    rising: "Rising",
    improving: "Rising",
    stable: "Stable",
    plateau: "Stable",
    falling: "Falling",
    declining: "Falling",
    choppy: "Choppy",
    uncertain: "Choppy",
    unknown: "Unknown",
  };
  return map[regime?.toLowerCase()] || regime || "Unknown";
}

export function useInViewOnce<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [isInView, setIsInView] = useState(false);
  const ref = useCallback((value: T | null) => {
    setNode(value);
  }, []);

  useEffect(() => {
    if (!node) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsInView(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { root: null, threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, isInView };
}

export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div className="kpi-grid">
      {items.map((item) => (
        <article className="kpi-card" key={item.label}>
          <p className="kpi-label">{item.label}</p>
          <p className="kpi-value">{item.value}</p>
          {item.hint ? <p className="kpi-hint">{item.hint}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function BarList({
  title,
  items,
  valueFormatter,
  emptyText = "No data available.",
}: {
  title: string;
  items: BarDatum[];
  valueFormatter: (value: number | null | undefined) => string;
  emptyText?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const valid = items.filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  const max = valid.reduce((acc, item) => Math.max(acc, Number(item.value)), 0);

  return (
    <section ref={ref} className={`bar-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      <h3>{title}</h3>
      {valid.length === 0 ? (
        <div className="panel-empty muted">{emptyText}</div>
      ) : (
        <ul className="bar-list">
          {valid.map((item, index) => {
            const value = Number(item.value);
            const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
            return (
              <li key={item.id}>
                <div className="bar-row-head">
                  <span className="bar-label">{item.label}</span>
                  <span className="bar-value">{valueFormatter(item.value)}</span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${width}%`, "--bar-delay": `${Math.min(index, 8) * 0.012}s` } as CSSProperties}
                  />
                </div>
                {item.note ? <p className="bar-note muted">{item.note}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function HeatGrid({
  title,
  items,
  valueFormatter,
  legend,
  embedded = false,
  emptyText = "No data available.",
}: {
  title: string;
  items: HeatCellDatum[];
  valueFormatter: (value: number | null | undefined) => string;
  legend?: string;
  embedded?: boolean;
  emptyText?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const valid = items.filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  const min = valid.reduce((acc, item) => Math.min(acc, Number(item.value)), Number.POSITIVE_INFINITY);
  const max = valid.reduce((acc, item) => Math.max(acc, Number(item.value)), Number.NEGATIVE_INFINITY);

  const content = (
    <>
      {title ? <h3>{title}</h3> : null}
      {valid.length === 0 ? (
        <div className="panel-empty muted">{emptyText}</div>
      ) : (
        <>
          <div className="heat-grid">
            {valid.map((item, index) => {
              const value = Number(item.value);
              const intensity = normalize(value, min, max);
              return (
                <article
                  className={`heat-cell ${item.value ? "has-value" : ""}`}
                  key={item.id}
                  style={
                    {
                      "--heat-alpha": `${Math.pow(intensity, 0.7) * 0.35}`,
                      "--heat-delay": `${Math.min(index, 10) * 0.012}s`,
                    } as CSSProperties
                  }
                >
                  <p className="heat-label">{item.label}</p>
                  <p className="heat-value">{valueFormatter(item.value)}</p>
                  {item.note ? <p className="heat-note muted">{item.note}</p> : null}
                </article>
              );
            })}
          </div>
          {legend ? <p className="muted viz-legend">{legend}</p> : null}
        </>
      )}
    </>
  );

  if (embedded) return <div ref={ref} className={isInView ? "is-in-view" : undefined}>{content}</div>;

  return <section ref={ref} className={`viz-panel ${isInView ? "is-in-view" : ""}`.trim()}>{content}</section>;
}

export function ShareMeter({
  title,
  segments,
  total,
  valueFormatter,
  legend,
  embedded = false,
  emptyText = "No data available.",
}: {
  title: string;
  segments: MeterSegmentDatum[];
  total?: number | null | undefined;
  valueFormatter: (value: number | null | undefined) => string;
  legend?: string;
  embedded?: boolean;
  emptyText?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const normalizedSegments = segments
    .map((segment) => ({
      ...segment,
      value:
        segment.value !== null && segment.value !== undefined && Number.isFinite(segment.value)
          ? Math.max(0, Number(segment.value))
          : null,
    }))
    .filter((segment) => segment.value !== null);
  const computedTotal = normalizedSegments.reduce((sum, segment) => sum + Number(segment.value), 0);
  const resolvedTotal =
    total !== null && total !== undefined && Number.isFinite(total) && Number(total) > 0 ? Number(total) : computedTotal;

  const content = (
    <>
      {title ? <h3>{title}</h3> : null}
      {normalizedSegments.length === 0 || resolvedTotal <= 0 ? (
        <div className="panel-empty muted">{emptyText}</div>
      ) : (
        <>
          <div className="meter-track" aria-hidden="true">
            {normalizedSegments.map((segment, index) => {
              const share = Math.max(0, Number(segment.value) / resolvedTotal);
              return (
                <span
                  key={segment.id}
                  className={`meter-segment tone-${segment.tone ?? "primary"}`}
                  style={
                    {
                      "--meter-share": `${share}`,
                      "--meter-delay": `${Math.min(index, 8) * 0.018}s`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
          <ul className="meter-legend">
            {normalizedSegments.map((segment) => (
              <li key={segment.id} className="meter-legend-item">
                <div className="meter-legend-head">
                  <span className={`meter-dot tone-${segment.tone ?? "primary"}`} aria-hidden="true" />
                  <span className="meter-label">{segment.label}</span>
                  <span className="meter-value">{valueFormatter(segment.value)}</span>
                </div>
                {segment.note ? <p className="meter-note muted">{segment.note}</p> : null}
              </li>
            ))}
          </ul>
          {legend ? <p className="muted viz-legend">{legend}</p> : null}
        </>
      )}
    </>
  );

  if (embedded) return <div ref={ref} className={`meter-panel ${isInView ? "is-in-view" : ""}`.trim()}>{content}</div>;

  return <section ref={ref} className={`viz-panel meter-panel ${isInView ? "is-in-view" : ""}`.trim()}>{content}</section>;
}

export function TrendStrips({
  title,
  items,
  valueFormatter,
  deltaFormatter,
  columns = 1,
  embedded = false,
  emptyText = "No trend data available.",
}: {
  title: string;
  items: TrendStripDatum[];
  valueFormatter: (value: number) => string;
  deltaFormatter: (value: number) => string;
  columns?: number;
  embedded?: boolean;
  emptyText?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const validItems = items.filter((item) => finiteValues(item.points).length > 0);
  if (validItems.length === 0) {
    if (embedded) {
      return (
        <div ref={ref} className={isInView ? "is-in-view" : undefined}>
          <div className="trend-strip-panel">
            {title ? <h3>{title}</h3> : null}
            <div className="panel-empty muted">{emptyText}</div>
          </div>
        </div>
      );
    }
    return (
      <section ref={ref} className={`viz-panel ${isInView ? "is-in-view" : ""}`.trim()}>
        <h3>{title}</h3>
        <div className="panel-empty muted">{emptyText}</div>
      </section>
    );
  }

  const content = (
    <div className="trend-strip-panel">
      {title ? <h3>{title}</h3> : null}
      <div className={`trend-strip-list trend-strip-cols-${Math.min(4, Math.max(1, columns))}`}>
        {validItems.map((item, index) => {
          const finite = finiteValues(item.points);
          const latest = finite[finite.length - 1];
          const previous = finite.length >= 2 ? finite[finite.length - 2] : finite[0];
          const delta = latest - previous;
          const min = Math.min(...finite);
          const max = Math.max(...finite);
          const width = 480;
          const height = 38;
          const innerW = width - 8;
          const innerH = height - 10;
          const zeroNorm = Math.max(0, Math.min(1, normalize(0, min, max)));
          const zeroY = 4 + (1 - zeroNorm) * innerH;
          const path = finite
            .map((value, index) => {
              const x = 4 + (finite.length > 1 ? (index / (finite.length - 1)) * innerW : innerW / 2);
              const y = 4 + (1 - normalize(value, min, max)) * innerH;
              return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ");
          const toneClass = delta > 0 ? "text-positive" : delta < 0 ? "text-negative" : "";
          const strokeColor = pickTrendStroke(item.id, index);
          return (
            <article className="trend-strip" key={item.id} style={{ "--trend-stroke": strokeColor } as CSSProperties}>
              <div className="trend-strip-head">
                <p className="trend-strip-label">{item.label}</p>
                <p className="trend-strip-value">
                  <span className="trend-strip-latest">{valueFormatter(latest)}</span>
                  <span className={`trend-strip-delta ${toneClass}`.trim()}>{`Delta ${deltaFormatter(delta)}`}</span>
                </p>
              </div>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${item.label} trend`}
              >
                <line x1={4} x2={width - 4} y1={zeroY} y2={zeroY} className="trend-strip-zero" />
                <path d={path} className="trend-strip-line" pathLength={1} />
              </svg>
              {item.note ? <p className="trend-strip-note muted">{item.note}</p> : null}
            </article>
          );
        })}
      </div>
    </div>
  );

  if (embedded) return <div ref={ref} className={isInView ? "is-in-view" : undefined}>{content}</div>;

  return (
    <section ref={ref} className={`viz-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      {content}
    </section>
  );
}

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
            const radius = point.size !== null && point.size !== undefined && Number.isFinite(point.size)
              ? 4 + normalize(Number(point.size), sizeMin, sizeMax) * 6.3
              : 5;
            const toneClass =
              point.tone === "positive" ? "viz-point-positive" : point.tone === "negative" ? "viz-point-negative" : "viz-point-neutral";
            const title = point.tooltip ?? `${xLabel}: ${xFormatter(x)}\n${yLabel}: ${yFormatter(y)}`;
            if (point.href) {
              return (
                <a key={point.id} href={point.href} target="_blank" rel="noreferrer noopener" className="viz-point-link">
                  <title>{title}</title>
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
                <title>{title}</title>
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

// Ridgeline component for APY distribution
export function Ridgeline({
  title,
  series,
  emptyText = "Need more APY samples for distribution curves.",
}: {
  title: string;
  series: RidgelineSeries[];
  emptyText?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const ridgelinePalette = [
    { stroke: "var(--viz-line-2)", fill: "rgba(var(--accent-rgb), 0.24)" },
    { stroke: "var(--viz-line-5)", fill: "rgba(var(--accent-teal-rgb), 0.22)" },
    { stroke: "var(--viz-line-4)", fill: "rgba(var(--accent-purple-rgb), 0.22)" },
    { stroke: "var(--viz-line-3)", fill: "rgba(var(--accent-2-rgb), 0.2)" },
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
              .map((count, bIdx) => {
                const x = chartLeft + (bIdx / (bins - 1)) * chartWidth;
                const y = yBase - (count / maxCount) * peakHeight;
                return `${bIdx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ");
            const pathBottom = counts
              .map((_, bIdx) => {
                const rev = bins - 1 - bIdx;
                const x = chartLeft + (rev / (bins - 1)) * chartWidth;
                return `L${x.toFixed(2)},${yBase.toFixed(2)}`;
              })
              .join(" ");
            return (
              <g key={row.id}>
                <title>{`${row.label}\n${row.note}\nAPY range ${formatPct(min, 1)} to ${formatPct(max, 1)}`}</title>
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
      <p className="muted viz-legend">Ridgelines show APY shape by chain. Taller peaks mean more vaults at that APY zone.</p>
    </section>
  );
}

// Sankey diagram for regime transitions
export function RegimeSankey({
  title,
  rows,
  emptyText = "No transition flows available.",
}: {
  title: string;
  rows: SankeyRow[];
  emptyText?: string;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const validRows = rows
    .filter((row) => row.tvl_usd !== null && row.tvl_usd !== undefined && Number.isFinite(row.tvl_usd) && Number(row.tvl_usd) > 0)
    .sort((left, right) => Number(right.tvl_usd) - Number(left.tvl_usd))
    .slice(0, 20);
  const regimes = Array.from(
    new Set(validRows.flatMap((row) => [row.previous_regime, row.current_regime]).filter(Boolean)),
  ).sort((a, b) => regimeOrder(a) - regimeOrder(b));
  if (validRows.length === 0 || regimes.length === 0) {
    return (
      <section className="viz-panel sankey-panel">
        {title ? <h3>{title}</h3> : null}
        <p className="muted">{emptyText}</p>
      </section>
    );
  }
  const width = 720;
  const height = 268;
  const xLeft = 112;
  const xRight = width - 112;
  const laneTop = 60;
  const laneBottom = height - 38;
  const laneHeight = laneBottom - laneTop;
  const laneStep = regimes.length > 1 ? laneHeight / (regimes.length - 1) : laneHeight / 2;
  const yPos = new Map(regimes.map((key, index) => [key, laneTop + index * laneStep]));
  const maxFlow = Math.max(...validRows.map((row) => Number(row.tvl_usd)));
  const incomingByRegime = new Map<string, number>();
  const outgoingByRegime = new Map<string, number>();
  for (const row of validRows) {
    outgoingByRegime.set(row.previous_regime, (outgoingByRegime.get(row.previous_regime) ?? 0) + Number(row.tvl_usd));
    incomingByRegime.set(row.current_regime, (incomingByRegime.get(row.current_regime) ?? 0) + Number(row.tvl_usd));
  }

  return (
    <section ref={ref} className={`viz-panel sankey-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      {title ? <h3>{title}</h3> : null}
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {validRows.map((row) => {
            const y1 = yPos.get(row.previous_regime) ?? laneTop;
            const y2 = yPos.get(row.current_regime) ?? laneTop;
            const value = Number(row.tvl_usd);
            const strokeWidth = 1.4 + (value / maxFlow) * 7.2;
            const intensity = Math.max(0, Math.min(1, value / maxFlow));
            const [prevR, prevG, prevB] = regimeColor(row.previous_regime);
            const [currR, currG, currB] = regimeColor(row.current_regime);
            const strokeR = Math.round((prevR + currR) / 2);
            const strokeG = Math.round((prevG + currG) / 2);
            const strokeB = Math.round((prevB + currB) / 2);
            const stroke = `rgba(${strokeR}, ${strokeG}, ${strokeB}, ${0.26 + intensity * 0.5})`;
            const c1x = xLeft + (xRight - xLeft) * 0.34;
            const c2x = xLeft + (xRight - xLeft) * 0.66;
            const path = `M${xLeft},${y1} C${c1x},${y1} ${c2x},${y2} ${xRight},${y2}`;
            return (
              <g key={`${row.previous_regime}-${row.current_regime}-${row.vaults}`} className="sankey-flow">
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  pathLength={1}
                >
                  <title>
                    {`${compactRegimeLabel(row.previous_regime)} → ${compactRegimeLabel(row.current_regime)}\nTVL ${formatUsd(row.tvl_usd)}\nVaults ${row.vaults}`}
                  </title>
                </path>
              </g>
            );
          })}
          {regimes.map((regime) => {
            const y = yPos.get(regime) ?? laneTop;
            const outValue = outgoingByRegime.get(regime) ?? 0;
            const inValue = incomingByRegime.get(regime) ?? 0;
            const [r, g, b] = regimeColor(regime);
            const fill = `rgba(${r}, ${g}, ${b}, 0.24)`;
            const stroke = `rgba(${Math.min(255, r + 36)}, ${Math.min(255, g + 36)}, ${Math.min(255, b + 36)}, 0.78)`;
            return (
              <g key={`left-${regime}`}>
                <rect x={8} y={y - 15} width={104} height={30} rx={6} fill={fill} stroke={stroke} />
                <text x={14} y={y + 0.5} className="sankey-label" dominantBaseline="central">{compactRegimeLabel(regime)}</text>
                <text x={106} y={y + 0.5} className="sankey-value" textAnchor="end" dominantBaseline="central">{formatUsdCompact(outValue)}</text>
                <rect x={width - 112} y={y - 15} width={104} height={30} rx={6} fill={fill} stroke={stroke} />
                <text x={width - 106} y={y + 0.5} className="sankey-label" dominantBaseline="central">{compactRegimeLabel(regime)}</text>
                <text x={width - 14} y={y + 0.5} className="sankey-value" textAnchor="end" dominantBaseline="central">{formatUsdCompact(inValue)}</text>
              </g>
            );
          })}
          <text x={8} y={18} className="sankey-axis-label">Previous Regime</text>
          <text x={width - 8} y={18} className="sankey-axis-label" textAnchor="end">Current Regime</text>
        </svg>
      </div>
      <p className="muted viz-legend">Stroke width scales by transitioned TVL; labels show total outgoing vs incoming TVL per regime.</p>
    </section>
  );
}
