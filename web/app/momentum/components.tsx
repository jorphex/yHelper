"use client";

import Link from "next/link";
import { chainLabel, compactChainLabel, deltaArrow, formatHours, formatPct, formatPctSigned, formatUsd } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { useInViewOnce } from "../components/visuals";
import { TableWrap } from "../components/table-wrap";
import { VaultLink } from "../components/vault-link";
import { compactRegimeLabel, formatUsdCompact, regimeColor, regimeOrder } from "./helpers";
import type { ChangeRow, MoverSortKey, TransitionRow } from "./types";
import type { UniverseKind } from "../lib/universe";
import { useState } from "react";

export function MoverTable({
  title,
  rows,
  universe,
  minTvl,
  minPoints,
  compact,
}: {
  title: string;
  rows: ChangeRow[];
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  compact: boolean;
}) {
  const [sort, setSort] = useState<SortState<MoverSortKey>>({
    key: title === "Stalest Series" ? "age" : "delta",
    direction: "desc",
  });

  const sortedRows = sortRows(rows, sort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    current: (row) => row.realized_apy_window ?? Number.NEGATIVE_INFINITY,
    previous: (row) => row.realized_apy_prev_window ?? Number.NEGATIVE_INFINITY,
    delta: (row) => row.delta_apy ?? Number.NEGATIVE_INFINITY,
    age: (row) => row.age_seconds ?? Number.NEGATIVE_INFINITY,
  });

  return (
    <>
      <div className="card-header" style={{ marginTop: "24px" }}>
        <h2 className="card-title">{title}</h2>
      </div>
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th aria-sort={sort.key === "vault" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "vault"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Vault {sortIndicator(sort, "vault")}
                </button>
              </th>
              <th aria-sort={sort.key === "chain" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Chain {sortIndicator(sort, "chain")}
                </button>
              </th>
              <th style={{ textAlign: "right" }} aria-sort={sort.key === "tvl" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  TVL {sortIndicator(sort, "tvl")}
                </button>
              </th>
              <th style={{ textAlign: "right" }} aria-sort={sort.key === "current" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "current"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Current Realized APY {sortIndicator(sort, "current")}
                </button>
              </th>
              <th style={{ textAlign: "right" }} aria-sort={sort.key === "previous" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "previous"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Previous Realized APY {sortIndicator(sort, "previous")}
                </button>
              </th>
              <th style={{ textAlign: "right" }} aria-sort={sort.key === "delta" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "delta"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Delta {sortIndicator(sort, "delta")}
                </button>
              </th>
              <th style={{ textAlign: "right" }} aria-sort={sort.key === "age" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "age"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Age {sortIndicator(sort, "age")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={`${title}-${row.vault_address}`}>
                <td>
                  <VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} />
                </td>
                <td>
                  <Link href={`/explore?chain=${row.chain_id}&universe=${universe}&min_tvl=${minTvl}&min_points=${minPoints}`}>
                    {compactChainLabel(row.chain_id, compact)}
                  </Link>
                </td>
                <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.realized_apy_window)}</td>
                <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.realized_apy_prev_window)}</td>
                <td style={{ textAlign: "right" }} className={`data-value ${(row.delta_apy ?? 0) >= 0 ? "text-positive delta-positive" : "text-negative delta-negative"}`}>
                  {deltaArrow(row.delta_apy)} {formatPctSigned(row.delta_apy)}
                </td>
                <td style={{ textAlign: "right" }} className="data-value">{formatHours(row.age_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

export function RegimeFlowSankey({
  title,
  rows,
}: {
  title: string;
  rows: TransitionRow[];
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
      <section className="regime-sankey-panel">
        {title ? <h3 className="panel-title">{title}</h3> : null}
        <p style={{ color: "var(--text-secondary)" }}>No transition flows available.</p>
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
    <section ref={ref} className={`regime-sankey-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      {title ? <h3 className="panel-title">{title}</h3> : null}
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: "100%", height: "auto" }}>
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
                <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" pathLength={1}>
                  <title>
                    {`${compactRegimeLabel(row.previous_regime)} -> ${compactRegimeLabel(row.current_regime)}\nTVL ${formatUsd(row.tvl_usd)}\nVaults ${row.vaults}`}
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
                <text x={14} y={y + 0.5} className="sankey-label" dominantBaseline="central" style={{ fontSize: "12px", fill: "var(--text-primary)" }}>{compactRegimeLabel(regime)}</text>
                <text x={106} y={y + 0.5} className="sankey-value" textAnchor="end" dominantBaseline="central" style={{ fontSize: "11px", fill: "var(--text-secondary)" }}>{formatUsdCompact(outValue)}</text>
                <rect x={width - 112} y={y - 15} width={104} height={30} rx={6} fill={fill} stroke={stroke} />
                <text x={width - 106} y={y + 0.5} className="sankey-label" dominantBaseline="central" style={{ fontSize: "12px", fill: "var(--text-primary)" }}>{compactRegimeLabel(regime)}</text>
                <text x={width - 14} y={y + 0.5} className="sankey-value" textAnchor="end" dominantBaseline="central" style={{ fontSize: "11px", fill: "var(--text-secondary)" }}>{formatUsdCompact(inValue)}</text>
              </g>
            );
          })}
          <text x={8} y={18} className="sankey-axis-label" style={{ fontSize: "11px", fill: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Previous Regime</text>
          <text x={width - 8} y={18} className="sankey-axis-label" textAnchor="end" style={{ fontSize: "11px", fill: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Current Regime</text>
        </svg>
      </div>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "12px" }}>Stroke width scales by transitioned TVL; labels show total outgoing vs incoming TVL per regime.</p>
    </section>
  );
}
