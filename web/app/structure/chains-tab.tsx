"use client";

import Link from "next/link";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { BarList, HeatGrid } from "../components/visuals";
import { TableWrap } from "../components/table-wrap";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { sortIndicator, toggleSort, type SortState } from "../lib/sort";
import type { ChainSortKey, StructureQuery } from "./types";

type ChainSummary = {
  with_realized_apy?: number;
  metrics_coverage_ratio?: number | null;
  median_chain_realized_apy_30d?: number | null;
};

type ChainTabRow = {
  chain_id: number;
  active_vaults: number;
  with_realized_apy: number;
  total_tvl_usd: number | null;
  weighted_realized_apy_30d: number | null;
  avg_momentum_7d_30d: number | null;
  avg_consistency: number | null;
};

export function ChainsTab({
  isLoading,
  query,
  summary,
  rows,
  chainSort,
  setChainSort,
}: {
  isLoading: boolean;
  query: StructureQuery;
  summary?: ChainSummary;
  rows: ChainTabRow[];
  chainSort: SortState<ChainSortKey>;
  setChainSort: (value: SortState<ChainSortKey>) => void;
}) {
  return (
    <>
      <section className="section section-lg">
        {isLoading ? (
          <div className="kpi-grid kpi-grid-3">
            {Array(3).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid kpi-grid-3">
            <div className="kpi-card">
              <div className="kpi-label">With Realized APY</div>
              <div className="kpi-value">{summary?.with_realized_apy ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Coverage Ratio</div>
              <div className="kpi-value">{formatPct(summary?.metrics_coverage_ratio)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Median Chain Realized APY 30d</div>
              <div className="kpi-value">{formatPct(summary?.median_chain_realized_apy_30d)}</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Chain Comparison</h2>
        </div>

        <div className="cols-responsive-2 section-lg">
          <HeatGrid
            title="By Chain"
            items={rows.slice(0, 6).map((row) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.active_vaults,
              note: formatUsd(row.total_tvl_usd),
            }))}
            valueFormatter={(value) => String(value ?? "n/a")}
          />
          <BarList
            title="TVL Distribution"
            items={rows.map((row) => ({
              id: String(row.chain_id),
              label: chainLabel(row.chain_id),
              value: row.total_tvl_usd,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
        </div>

        <TableWrap>
          <table>
            <thead>
              <tr>
                <th aria-sort={chainSort.key === "chain" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "chain"))}>
                    Chain {sortIndicator(chainSort, "chain")}
                  </button>
                </th>
                <th className="numeric" aria-sort={chainSort.key === "vaults" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "vaults"))}>
                    Vaults {sortIndicator(chainSort, "vaults")}
                  </button>
                </th>
                <th className="numeric" aria-sort={chainSort.key === "with_realized_apy" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "with_realized_apy"))}>
                    With Realized APY {sortIndicator(chainSort, "with_realized_apy")}
                  </button>
                </th>
                <th className="numeric" aria-sort={chainSort.key === "tvl" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "tvl"))}>
                    TVL {sortIndicator(chainSort, "tvl")}
                  </button>
                </th>
                <th className="numeric" aria-sort={chainSort.key === "apy" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "apy"))}>
                    Realized APY 30d {sortIndicator(chainSort, "apy")}
                  </button>
                </th>
                <th className="numeric" aria-sort={chainSort.key === "momentum" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "momentum"))}>
                    Avg Momentum {sortIndicator(chainSort, "momentum")}
                  </button>
                </th>
                <th className="numeric" aria-sort={chainSort.key === "consistency" ? (chainSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setChainSort(toggleSort(chainSort, "consistency"))}>
                    Avg Consistency {sortIndicator(chainSort, "consistency")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={7} />
              ) : (
                rows.map((row) => (
                  <tr key={row.chain_id}>
                    <td>
                      <Link href={`/explore?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                        {chainLabel(row.chain_id)}
                      </Link>
                    </td>
                    <td className="data-value numeric">{row.active_vaults}</td>
                    <td className="data-value numeric">{row.with_realized_apy}</td>
                    <td className="data-value numeric">{formatUsd(row.total_tvl_usd)}</td>
                    <td className="data-value numeric">{formatPct(row.weighted_realized_apy_30d)}</td>
                    <td className="data-value numeric">{formatPct(row.avg_momentum_7d_30d)}</td>
                    <td className="data-value numeric">{row.avg_consistency?.toFixed(2) ?? "n/a"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
            </TableWrap>
      </section>
    </>
  );
}
