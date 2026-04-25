"use client";

import type { CSSProperties } from "react";
import { useInViewOnce } from "./use-in-view-once";
import { finiteValues, normalize, pickTrendStroke } from "./utils";
import type { BarDatum, HeatCellDatum, Kpi, MeterSegmentDatum, TrendStripDatum } from "./types";

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
      <h3 className="panel-title">{title}</h3>
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
      {title ? <h3 className="panel-title">{title}</h3> : null}
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
      {title ? <h3 className="panel-title">{title}</h3> : null}
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
            {title ? <h3 className="panel-title">{title}</h3> : null}
            <div className="panel-empty muted">{emptyText}</div>
          </div>
        </div>
      );
    }
    return (
      <section ref={ref} className={`viz-panel ${isInView ? "is-in-view" : ""}`.trim()}>
        <h3 className="panel-title">{title}</h3>
        <div className="panel-empty muted">{emptyText}</div>
      </section>
    );
  }

  const content = (
    <div className="trend-strip-panel">
      {title ? <h3 className="panel-title">{title}</h3> : null}
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
            .map((value, pointIndex) => {
              const x = 4 + (finite.length > 1 ? (pointIndex / (finite.length - 1)) * innerW : innerW / 2);
              const y = 4 + (1 - normalize(value, min, max)) * innerH;
              return `${pointIndex === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
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
