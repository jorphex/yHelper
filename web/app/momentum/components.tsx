"use client";

import Link from "next/link";
import { useState } from "react";
import { TableWrap } from "../components/table-wrap";
import { VaultLink } from "../components/vault-link";
import { chainLabel, compactChainLabel, deltaArrow, formatPct, formatPercentagePoints, formatUsd } from "../lib/format";
import { sortIndicator, sortRows, toggleSort, type SortState } from "../lib/sort";
import type { MarketKind, UniverseKind } from "../lib/universe";
import type { ChangeRow, MoverSortKey, WindowKey } from "./types";

function compactAge(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m old`;
  if (seconds < 86_400) return `${Math.max(1, Math.round(seconds / 3600))}h old`;
  return `${Math.max(1, Math.round(seconds / 86_400))}d old`;
}

export function MoverTable({ title, rows, universe, market, window, compact, direction }: { title: string; rows: ChangeRow[]; universe: UniverseKind; market: MarketKind; window: WindowKey; compact: boolean; direction: "strengthening" | "weakening" }) {
  const [sort, setSort] = useState<SortState<MoverSortKey>>({ key: "delta", direction: direction === "weakening" ? "asc" : "desc" });
  const [expanded, setExpanded] = useState(false);
  const sortedRows = sortRows(rows, sort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    current: (row) => row.realized_apy_window ?? Number.NEGATIVE_INFINITY,
    previous: (row) => row.realized_apy_prev_window ?? Number.NEGATIVE_INFINITY,
    delta: (row) => row.delta_apy ?? Number.NEGATIVE_INFINITY,
  });
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 5);
  const windowLabel = window === "24h" ? "24h" : window;
  return (
    <>
      <div className="card-header"><h2 className="card-title">{title}</h2></div>
      <TableWrap><table className="decision-table"><thead><tr>
        <th aria-sort={sort.key === "vault" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="th-button" onClick={() => setSort(toggleSort(sort, "vault"))}>Vault {sortIndicator(sort, "vault")}</button></th>
        <th className="mobile-secondary-column" aria-sort={sort.key === "chain" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="th-button" onClick={() => setSort(toggleSort(sort, "chain"))}>Chain {sortIndicator(sort, "chain")}</button></th>
        <th className="numeric" aria-sort={sort.key === "tvl" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="th-button" onClick={() => setSort(toggleSort(sort, "tvl"))}>TVL {sortIndicator(sort, "tvl")}</button></th>
        <th className="numeric" data-mobile-label="Current" aria-sort={sort.key === "current" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="th-button" onClick={() => setSort(toggleSort(sort, "current"))}>Current {windowLabel} APY {sortIndicator(sort, "current")}</button></th>
        <th className="numeric mobile-secondary-column" aria-sort={sort.key === "previous" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="th-button" onClick={() => setSort(toggleSort(sort, "previous"))}>Prior {windowLabel} APY {sortIndicator(sort, "previous")}</button></th>
        <th className="numeric" data-mobile-label="Change" aria-sort={sort.key === "delta" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="th-button" onClick={() => setSort(toggleSort(sort, "delta"))}>Change {sortIndicator(sort, "delta")}</button></th>
      </tr></thead><tbody>
        {sortedRows.length === 0 ? <tr><td colSpan={6} className="muted">No {title.toLowerCase()} in this window.</td></tr> : visibleRows.map((row) => {
          const metricAge = compactAge(row.age_seconds);
          return <tr key={`${title}:${row.chain_id}:${row.vault_address}`}><td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /><div className="market-row-meta">{row.token_symbol ? <Link className="market-link-secondary" href={`/markets?view=compare&token=${encodeURIComponent(row.token_symbol)}&universe=${universe}`}>Compare {row.token_symbol}</Link> : null}{metricAge ? <span>{row.token_symbol ? " · " : ""}PPS {metricAge}</span> : null}</div><div className="mobile-only muted">{compactChainLabel(row.chain_id, compact)}</div></td><td className="mobile-secondary-column"><Link className="market-link-secondary" href={`/markets?view=vaults&chain=${row.chain_id}&universe=${universe}&market=${market}`}>{compactChainLabel(row.chain_id, compact)}</Link></td><td className="numeric">{formatUsd(row.tvl_usd)}</td><td className="numeric">{formatPct(row.realized_apy_window)}</td><td className="numeric mobile-secondary-column">{formatPct(row.realized_apy_prev_window)}</td><td className={`numeric ${(row.delta_apy ?? 0) > 0 ? "text-positive" : "text-negative"}`}>{deltaArrow(row.delta_apy)} {formatPercentagePoints(row.delta_apy)}</td></tr>;
        })}
      </tbody></table></TableWrap>
      {sortedRows.length > 5 ? <button className="button button-ghost section-sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show all ${sortedRows.length}`}</button> : null}
    </>
  );
}
