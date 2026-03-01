"use client";

import type { CSSProperties } from "react";

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
  const valid = items.filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  const max = valid.reduce((acc, item) => Math.max(acc, Number(item.value)), 0);

  return (
    <section className="bar-panel">
      <h3>{title}</h3>
      {valid.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ul className="bar-list">
          {valid.map((item) => {
            const value = Number(item.value);
            const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
            return (
              <li key={item.id}>
                <div className="bar-row-head">
                  <span className="bar-label">{item.label}</span>
                  <span className="bar-value">{valueFormatter(item.value)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${width}%` }} />
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
  emptyText = "No data available.",
}: {
  title: string;
  items: HeatCellDatum[];
  valueFormatter: (value: number | null | undefined) => string;
  legend?: string;
  emptyText?: string;
}) {
  const valid = items.filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  const min = valid.reduce((acc, item) => Math.min(acc, Number(item.value)), Number.POSITIVE_INFINITY);
  const max = valid.reduce((acc, item) => Math.max(acc, Number(item.value)), Number.NEGATIVE_INFINITY);

  return (
    <section className="viz-panel">
      <h3>{title}</h3>
      {valid.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <>
          <div className="heat-grid">
            {valid.map((item) => {
              const value = Number(item.value);
              const intensity = normalize(value, min, max);
              const emphasized = Math.pow(intensity, 0.62);
              return (
                <article className="heat-cell" key={item.id} style={{ "--heat-alpha": `${0.16 + emphasized * 0.78}` } as CSSProperties}>
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
    </section>
  );
}

export function TrendStrips({
  title,
  items,
  valueFormatter,
  deltaFormatter,
  columns = 1,
  emptyText = "No trend data available.",
}: {
  title: string;
  items: TrendStripDatum[];
  valueFormatter: (value: number) => string;
  deltaFormatter: (value: number) => string;
  columns?: number;
  emptyText?: string;
}) {
  const validItems = items.filter((item) => finiteValues(item.points).length > 0);
  if (validItems.length === 0) {
    return (
      <section className="viz-panel">
        <h3>{title}</h3>
        <p className="muted">{emptyText}</p>
      </section>
    );
  }

  return (
    <section className="viz-panel">
      <h3>{title}</h3>
      <div className={`trend-strip-list trend-strip-cols-${Math.min(4, Math.max(1, columns))}`}>
        {validItems.map((item) => {
          const finite = finiteValues(item.points);
          const latest = finite[finite.length - 1];
          const previous = finite.length >= 2 ? finite[finite.length - 2] : finite[0];
          const delta = latest - previous;
          const min = Math.min(...finite);
          const max = Math.max(...finite);
          const width = 480;
          const height = 34;
          const innerW = width - 8;
          const innerH = height - 8;
          const path = finite
            .map((value, index) => {
              const x = 4 + (finite.length > 1 ? (index / (finite.length - 1)) * innerW : innerW / 2);
              const y = 4 + (1 - normalize(value, min, max)) * innerH;
              return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ");
          const toneClass = delta > 0 ? "text-positive" : delta < 0 ? "text-negative" : "";
          return (
            <article className="trend-strip" key={item.id}>
              <div className="trend-strip-head">
                <p className="trend-strip-label">{item.label}</p>
                <p className="trend-strip-value">
                  {valueFormatter(latest)} <span className={toneClass}>{deltaFormatter(delta)}</span>
                </p>
              </div>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${item.label} trend`}
              >
                <path d={path} className="trend-strip-line" />
              </svg>
              {item.note ? <p className="trend-strip-note muted">{item.note}</p> : null}
            </article>
          );
        })}
      </div>
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
  densityBackdrop = true,
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
  const valid = points.filter((point) => {
    const x = point.x;
    const y = point.y;
    return x !== null && x !== undefined && y !== null && y !== undefined && Number.isFinite(x) && Number.isFinite(y);
  });
  if (valid.length === 0) {
    return (
      <section className={`viz-panel ${className ?? ""}`.trim()}>
        <h3>{title}</h3>
        <p className="muted">{emptyText}</p>
      </section>
    );
  }

  const width = 700;
  const height = 352;
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
  const paddingLeft = Math.min(92, Math.max(56, 18 + widestYTick * 7));
  const paddingRight = 20;
  const paddingTop = 24;
  const paddingBottom = 66;
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
    <section className={`viz-panel ${className ?? ""}`.trim()}>
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
                    fill="rgba(125, 176, 228, 1)"
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
          <line
            x1={paddingLeft}
            x2={width - paddingRight}
            y1={paddingTop + (1 - normalize(yMid, yMin, yMax)) * innerHeight}
            y2={paddingTop + (1 - normalize(yMid, yMin, yMax)) * innerHeight}
            className="viz-axis viz-axis-mid"
          />
          <line
            x1={paddingLeft + normalize(xMid, xMin, xMax) * innerWidth}
            x2={paddingLeft + normalize(xMid, xMin, xMax) * innerWidth}
            y1={paddingTop}
            y2={height - paddingBottom}
            className="viz-axis viz-axis-mid"
          />
          {valid.map((point) => {
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
                  <circle cx={cx} cy={cy} r={radius} className={`viz-point ${toneClass}`} />
                </a>
              );
            }
            return (
              <g key={point.id}>
                <title>{title}</title>
                <circle cx={cx} cy={cy} r={radius} className={`viz-point ${toneClass}`} />
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
        Hover points for exact values. Click a point to open the vault on Yearn. Dot size scales with TVL when available.
      </p>
    </section>
  );
}
