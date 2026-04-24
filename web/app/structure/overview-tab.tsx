"use client";

import Link from "next/link";
import { formatPct, formatUsd } from "../lib/format";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
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
      <section className="section" style={{ marginBottom: "48px" }}>
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

      <section className="section" style={{ marginBottom: "48px" }}>
        <TvlTreemap title="TVL Treemap (Chain -> Category -> Token Lens)" chains={chainRows} categories={categoryRows} tokens={tokenRows} />
      </section>

      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Category Concentration</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "category"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Category {sortIndicator(categorySort, "category")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "vaults"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(categorySort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(categorySort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "share"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Share {sortIndicator(categorySort, "share")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCategorySort(toggleSort(categorySort, "apy"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
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
                    <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_realized_apy_30d)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Top Tokens by TVL</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "token"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Token {sortIndicator(tokenSort, "token")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "vaults"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(tokenSort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(tokenSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "share"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Share {sortIndicator(tokenSort, "share")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setTokenSort(toggleSort(tokenSort, "apy"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
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
                    <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_realized_apy_30d)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
