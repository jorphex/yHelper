"use client";

import type { CSSProperties } from "react";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useInViewOnce } from "../components/visuals";
import type { BreakdownRow } from "./types";

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
  const width = 820;
  const height = 168;
  const topChains = [...chains]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
    .slice(0, 6);
  const topCategories = [...categories]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
    .slice(0, 6);
  const topTokens = [...tokens]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
    .slice(0, 8);
  const groups = [
    { key: "chain", label: "Chain", color: "rgba(100, 150, 255, 0.78)", rows: topChains, text: (row: BreakdownRow) => chainLabel(row.chain_id) },
    { key: "category", label: "Category", color: "rgba(100, 200, 180, 0.7)", rows: topCategories, text: (row: BreakdownRow) => row.category || "unknown" },
    { key: "token", label: "Token", color: "rgba(180, 120, 220, 0.72)", rows: topTokens, text: (row: BreakdownRow) => row.token_symbol || "unknown" },
  ];
  const validGroups = groups.filter((group) => group.rows.length > 0);
  if (validGroups.length === 0) {
    return (
      <section style={{ padding: "24px" }}>
        <h3>{title}</h3>
        <p style={{ color: "var(--text-secondary)" }}>No composition rows available.</p>
      </section>
    );
  }
  const laneGap = Math.max(7, Math.round(height * 0.04));
  const laneHeight = (height - 12 - (validGroups.length - 1) * laneGap) / validGroups.length;

  return (
    <section ref={ref} style={{ padding: "24px", opacity: isInView ? 1 : 0.9, transition: "opacity 0.3s" }}>
      <h3 className="card-title">{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: "100%", minWidth: "600px", height: "auto" }}>
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
                <text x={2} y={y + laneHeight / 2 + 0.5} style={{ fontSize: "11px", fill: "var(--text-secondary)" }} dominantBaseline="central">
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
                  return (
                    <g key={`${group.key}-${name}`}>
                      <rect
                        x={rectX}
                        y={y}
                        width={widthPx}
                        height={laneHeight}
                        fill={group.color}
                        opacity={0.85}
                        stroke="var(--border)"
                        style={{ transition: "all 0.2s" } as CSSProperties}
                      />
                      {widthPx >= 54 && compactName ? (
                        <text x={rectX + 5} y={y + Math.min(18, laneHeight - 6)} style={{ fontSize: "10px", fill: "var(--text-primary)" }}>
                          {compactName}
                        </text>
                      ) : null}
                      <title>{`${group.label}: ${name}\nTVL: ${formatUsd(row.tvl_usd)}\nShare: ${formatPct(row.share_tvl, 1)}`}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "12px" }}>
        Treemap lanes show top TVL contributors by chain, category, and token.
      </p>
    </section>
  );
}
