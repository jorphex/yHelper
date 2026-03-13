"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

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
              const emphasized = Math.pow(intensity, 0.62);
              return (
                <article
                  className="heat-cell"
                  key={item.id}
                  style={
                    {
                      "--heat-alpha": `${0.16 + emphasized * 0.78}`,
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

  const width = 520;
  const height = 252;
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
  const paddingLeft = Math.min(78, Math.max(48, 14 + widestYTick * 6));
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 48;
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
      <p className="muted viz-legend">
        Desktop hover reveals exact values. Linked points open the vault on Yearn. Dot size scales with TVL when available.
      </p>
    </section>
  );
}
