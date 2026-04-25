"use client";

import Link from "next/link";
import { formatPct, formatUsd } from "../lib/format";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { sortIndicator, toggleSort, type SortState } from "../lib/sort";
import { TvlTreemap } from "./components";
import type { BreakdownRow, CategorySortKey, StructureQuery, TokenSortKey } from "./types";

type CompositionSummary = {
  vaults?: number;
  avg_realized_apy_30d?: number | null;
};

type ConcentrationSummary = {
  chain_hhi?: number | null;
  category_hhi?: number | null;
  token_hhi?: number | null;
};

export function OverviewTab({
  isLoading,
  query,
  summary,
  concentration,
  chainRows,
  categoryRows,
  tokenRows,
  categorySort,
  setCategorySort,
  tokenSort,
  setTokenSort,
}: {
  isLoading: boolean;
  query: StructureQuery;
  summary?: CompositionSummary;
  concentration?: ConcentrationSummary;
  chainRows: BreakdownRow[];
  categoryRows: BreakdownRow[];
  tokenRows: BreakdownRow[];
  categorySort: SortState<CategorySortKey>;
  setCategorySort: (value: SortState<CategorySortKey>) => void;
  tokenSort: SortState<TokenSortKey>;
  setTokenSort: (value: SortState<TokenSortKey>) => void;
}) {
  return (
    <>
      <section className="section section-lg">
        {isLoading ? (
          <div className="kpi-grid kpi-grid-5">
            {Array(5).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid kpi-grid-5">
            <div className="kpi-card">
              <div className="kpi-label">Vaults</div>
              <div className="kpi-value">{summary?.vaults ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Average Realized APY 30d</div>
              <div className="kpi-value">{formatPct(summary?.avg_realized_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chain HHI</div>
              <div className="kpi-value">{concentration?.chain_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Category HHI</div>
              <div className="kpi-value">{concentration?.category_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Token HHI</div>
              <div className="kpi-value">{concentration?.token_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
          </div>
        )}
      </section>

      <section className="section section-lg">
        <TvlTreemap title="TVL Treemap (Chain -> Category -> Token Lens)" chains={chainRows} categories={categoryRows} tokens={tokenRows} />
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Category Concentration</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th aria-sort={categorySort.key === "category" ? (categorySort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "category"))}>
                    Category {sortIndicator(categorySort, "category")}
                  </button>
                </th>
                <th className="numeric" aria-sort={categorySort.key === "vaults" ? (categorySort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "vaults"))}>
                    Vaults {sortIndicator(categorySort, "vaults")}
                  </button>
                </th>
                <th className="numeric" aria-sort={categorySort.key === "tvl" ? (categorySort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "tvl"))}>
                    TVL {sortIndicator(categorySort, "tvl")}
                  </button>
                </th>
                <th className="numeric" aria-sort={categorySort.key === "share" ? (categorySort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "share"))}>
                    Share {sortIndicator(categorySort, "share")}
                  </button>
                </th>
                <th className="numeric" aria-sort={categorySort.key === "apy" ? (categorySort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "apy"))}>
                    Realized APY 30d {sortIndicator(categorySort, "apy")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : (
                categoryRows.map((row) => (
                  <tr key={row.category}>
                    <td>
                      {row.category ? (
                        <Link href={`/explore?category=${encodeURIComponent(row.category)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                          {row.category}
                        </Link>
                      ) : "Unknown"}
                    </td>
                    <td className="data-value numeric">{row.vaults}</td>
                    <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                    <td className="data-value numeric">{formatPct(row.share_tvl)}</td>
                    <td className="data-value numeric">{formatPct(row.weighted_realized_apy_30d)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
            </TableWrap>
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Top Tokens by TVL</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th aria-sort={tokenSort.key === "token" ? (tokenSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "token"))}>
                    Token {sortIndicator(tokenSort, "token")}
                  </button>
                </th>
                <th className="numeric" aria-sort={tokenSort.key === "vaults" ? (tokenSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "vaults"))}>
                    Vaults {sortIndicator(tokenSort, "vaults")}
                  </button>
                </th>
                <th className="numeric" aria-sort={tokenSort.key === "tvl" ? (tokenSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "tvl"))}>
                    TVL {sortIndicator(tokenSort, "tvl")}
                  </button>
                </th>
                <th className="numeric" aria-sort={tokenSort.key === "share" ? (tokenSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "share"))}>
                    Share {sortIndicator(tokenSort, "share")}
                  </button>
                </th>
                <th className="numeric" aria-sort={tokenSort.key === "apy" ? (tokenSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "apy"))}>
                    Realized APY 30d {sortIndicator(tokenSort, "apy")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : (
                tokenRows.slice(0, query.topN).map((row) => (
                  <tr key={row.token_symbol}>
                    <td>
                      {row.token_symbol ? (
                        <Link href={`/explore?tab=venues&token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                          {row.token_symbol}
                        </Link>
                      ) : "Unknown"}
                    </td>
                    <td className="data-value numeric">{row.vaults}</td>
                    <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                    <td className="data-value numeric">{formatPct(row.share_tvl)}</td>
                    <td className="data-value numeric">{formatPct(row.weighted_realized_apy_30d)}</td>
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
