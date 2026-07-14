"use client";

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useInViewOnce } from "./use-in-view-once";
import { finiteValues, normalize } from "./utils";
import type { ScatterPoint } from "./types";

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
  const [hoveredPoint, setHoveredPoint] = useState<{ id: string; text: string; x: number; y: number } | null>(null);
  const showPoint = (id: string, text: string, x: number, y: number) => {
    setHoveredPoint({ id, text, x, y });
  };
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
      <div className="scatter-wrap viz-interactive-wrap">
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
                    fill="rgba(59, 130, 246, 1)"
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
          {xMin < 0 && xMax > 0 ? (
            <>
              <line
                x1={paddingLeft + normalize(0, xMin, xMax) * innerWidth}
                x2={paddingLeft + normalize(0, xMin, xMax) * innerWidth}
                y1={paddingTop}
                y2={height - paddingBottom}
                className="viz-axis viz-axis-zero"
              />
              <text
                x={paddingLeft + normalize(0, xMin, xMax) * innerWidth + 5}
                y={paddingTop + 13}
                className="viz-tick"
              >
                No change
              </text>
            </>
          ) : null}
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
                <a
                  key={point.id}
                  href={point.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={pointTitle.replaceAll("\n", ", ")}
                  onPointerEnter={(event) => showPoint(point.id, pointTitle, event.clientX, event.clientY)}
                  onPointerMove={(event) => showPoint(point.id, pointTitle, event.clientX, event.clientY)}
                  onPointerLeave={() => setHoveredPoint(null)}
                  onFocus={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    showPoint(point.id, pointTitle, bounds.left + bounds.width / 2, bounds.top);
                  }}
                  onBlur={() => setHoveredPoint(null)}
                >
                  <circle cx={cx} cy={cy} r={Math.max(12, radius + 6)} className="viz-point-hit" />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    className={`viz-point ${toneClass} ${hoveredPoint?.id === point.id ? "is-active" : ""}`.trim()}
                    style={{ "--point-delay": `${Math.min(index, 12) * 0.01}s` } as CSSProperties}
                  />
                </a>
              );
            }
            return (
              <g
                key={point.id}
                tabIndex={0}
                role="img"
                aria-label={pointTitle.replaceAll("\n", ", ")}
                onPointerEnter={(event) => showPoint(point.id, pointTitle, event.clientX, event.clientY)}
                onPointerMove={(event) => showPoint(point.id, pointTitle, event.clientX, event.clientY)}
                onPointerLeave={() => setHoveredPoint(null)}
                onFocus={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  showPoint(point.id, pointTitle, bounds.left + bounds.width / 2, bounds.top);
                }}
                onBlur={() => setHoveredPoint(null)}
              >
                <circle cx={cx} cy={cy} r={Math.max(12, radius + 6)} className="viz-point-hit" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  className={`viz-point ${toneClass} ${hoveredPoint?.id === point.id ? "is-active" : ""}`.trim()}
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
      {hoveredPoint && typeof document !== "undefined"
        ? createPortal(
            <div
              className="viz-hover-tooltip"
              style={{ left: hoveredPoint.x, top: hoveredPoint.y }}
              role="status"
            >
              {hoveredPoint.text}
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
