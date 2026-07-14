"use client";

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useInViewOnce } from "../components/visuals";
import type { BreakdownRow } from "./types";

type DisplayRow = BreakdownRow & { isRemainder?: boolean };

function topWithRemainder(rows: BreakdownRow[], limit: number, remainder: Partial<BreakdownRow>): DisplayRow[] {
  const ranked = [...rows]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY));
  const top = ranked.slice(0, limit);
  const allTvl = ranked.reduce((sum, row) => sum + Number(row.tvl_usd ?? 0), 0);
  const shownTvl = top.reduce((sum, row) => sum + Number(row.tvl_usd ?? 0), 0);
  const remainderTvl = Math.max(0, allTvl - shownTvl);
  if (remainderTvl <= 0) return top;
  return [
    ...top,
    {
      ...remainder,
      vaults: Math.max(0, ranked.reduce((sum, row) => sum + row.vaults, 0) - top.reduce((sum, row) => sum + row.vaults, 0)),
      tvl_usd: remainderTvl,
      share_tvl: allTvl > 0 ? remainderTvl / allTvl : null,
      isRemainder: true,
    },
  ];
}

export function TvlTreemap({
  title,
  chains,
  categories,
  tokens,
}: {
  title: string;
  chains: BreakdownRow[];
  categories: BreakdownRow[];
  tokens: BreakdownRow[];
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const [hoveredSegment, setHoveredSegment] = useState<{ id: string; text: string; x: number; y: number } | null>(null);
  const width = 820;
  const topChains = topWithRemainder(chains, 6, { category: "Other chains" });
  const topMarkets = topWithRemainder(categories, 6, { category: "Other markets" });
  const topTokens = topWithRemainder(tokens, 8, { token_symbol: "Other assets" });
  const groups = [
    { key: "chain", label: "Chain", color: "rgba(100, 150, 255, 0.78)", rows: topChains, text: (row: DisplayRow) => row.isRemainder ? row.category || "Other chains" : chainLabel(row.chain_id) },
    { key: "market", label: "Market", color: "rgba(100, 200, 180, 0.7)", rows: topMarkets, text: (row: DisplayRow) => row.category || "unknown" },
    { key: "token", label: "Token", color: "rgba(180, 120, 220, 0.72)", rows: topTokens, text: (row: DisplayRow) => row.token_symbol || "unknown" },
  ];
  const validGroups = groups.filter((group) => group.rows.length > 0);
  const height = validGroups.length === 2 ? 118 : 168;
  if (validGroups.length === 0) {
    return (
      <section className="viz-panel">
        <h3>{title}</h3>
        <p className="text-secondary">No composition rows available.</p>
      </section>
    );
  }
  const laneGap = Math.max(7, Math.round(height * 0.04));
  const laneHeight = (height - 12 - (validGroups.length - 1) * laneGap) / validGroups.length;

  return (
    <section ref={ref} className="treemap-panel" style={{ opacity: isInView ? 1 : 0.9, transition: "opacity 0.3s" }}>
      <h3 className="card-title">{title}</h3>
      <div className="treemap-wrap viz-interactive-wrap" style={{ overflowX: "auto" }}>
        <svg
          className={hoveredSegment ? "has-active-segment" : undefined}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
          style={{ width: "100%", minWidth: "600px", height: "auto" }}
        >
          {validGroups.map((group, groupIndex) => {
            const y = 5 + groupIndex * (laneHeight + laneGap);
            const total = group.rows.reduce((acc, row) => acc + Number(row.tvl_usd ?? 0), 0);
            const labelOffset = Math.max(68, Math.min(98, Math.round(width * 0.095)));
            const laneWidth = width - labelOffset - 8;
            const scaledWidths = group.rows.map((row) => {
              const value = Number(row.tvl_usd ?? 0);
              return total > 0 ? (value / total) * laneWidth : 0;
            });
            let x = 0;
            return (
              <g key={group.key}>
                <text x={2} y={y + laneHeight / 2 + 0.5} className="svg-label" dominantBaseline="central">
                  {group.label}
                </text>
                {group.rows.map((row, rowIndex) => {
                  const targetWidth = scaledWidths[rowIndex] ?? 0;
                  const widthPx = rowIndex === group.rows.length - 1 ? Math.max(0, laneWidth - x) : Math.max(0, targetWidth);
                  const rectX = labelOffset + x;
                  x += widthPx;
                  const name = group.text(row);
                  const maxChars = Math.max(0, Math.floor((widthPx - 10) / 5.8));
                  const compactName = maxChars > 0 ? (name.length > maxChars ? `${name.slice(0, Math.max(2, maxChars - 1))}…` : name) : "";
                  const segmentId = `${group.key}-${name}`;
                  const tooltip = `${group.label}: ${name}\nTVL: ${formatUsd(row.tvl_usd)}\nShare: ${formatPct(row.share_tvl, 1)}`;
                  return (
                    <g
                      key={segmentId}
                      className={`treemap-segment ${hoveredSegment?.id === segmentId ? "is-active" : ""}`.trim()}
                      tabIndex={0}
                      role="img"
                      aria-label={tooltip.replaceAll("\n", ", ")}
                      onPointerEnter={(event) => setHoveredSegment({ id: segmentId, text: tooltip, x: event.clientX, y: event.clientY })}
                      onPointerMove={(event) => setHoveredSegment({ id: segmentId, text: tooltip, x: event.clientX, y: event.clientY })}
                      onPointerLeave={() => setHoveredSegment(null)}
                      onFocus={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setHoveredSegment({ id: segmentId, text: tooltip, x: bounds.left + bounds.width / 2, y: bounds.top });
                      }}
                      onBlur={() => setHoveredSegment(null)}
                    >
                      <rect
                        x={rectX}
                        y={y}
                        width={widthPx}
                        height={laneHeight}
                        fill={group.color}
                        opacity={row.isRemainder ? 0.38 : 0.85}
                        stroke="var(--border)"
                        style={{ transition: "all 0.2s" } as CSSProperties}
                      />
                      {widthPx >= 54 && compactName ? (
                        <text x={rectX + 5} y={y + Math.min(18, laneHeight - 6)} className="svg-label-small">
                          {compactName}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mobile-only text-sm text-secondary section-sm">Swipe horizontally to see the full composition.</p>
      {hoveredSegment && typeof document !== "undefined"
        ? createPortal(
            <div className="viz-hover-tooltip" style={{ left: hoveredSegment.x, top: hoveredSegment.y }} role="status">
              {hoveredSegment.text}
            </div>,
            document.body,
          )
        : null}
      <p className="text-sm text-secondary section-sm">Bars show the full selected TVL, with smaller contributors grouped as Other.</p>
    </section>
  );
}
