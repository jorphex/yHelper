"use client";

import Link from "next/link";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { marketLabel, type MarketKind, type UniverseKind } from "../lib/universe";
import { TvlTreemap } from "./components";
import type { BreakdownRow } from "./types";

export function OverviewTab({
  isLoading,
  universe,
  market,
  summary,
  chainRows,
  marketRows,
  tokenRows,
  comparableTokenSymbols,
}: {
  isLoading: boolean;
  universe: UniverseKind;
  market: MarketKind;
  summary?: { vaults?: number; total_tvl_usd?: number | null };
  chainRows: BreakdownRow[];
  marketRows: BreakdownRow[];
  tokenRows: BreakdownRow[];
  comparableTokenSymbols: string[];
}) {
  const topMarket = marketRows[0];
  const topChain = chainRows[0];
  const topToken = tokenRows[0];
  return (
    <>
      <section className="section section-lg">
        <div className="card-header"><div><h2 className="card-title">Selected-set context</h2><p className="card-description">Composition describes the currently selected tracked vault set; it is not total Yearn protocol TVL.</p></div></div>
        {isLoading ? <KpiGridSkeleton count={3} /> : <div className="kpi-grid kpi-grid-3">
          <div className="kpi-card"><div className="kpi-label">Tracked TVL</div><div className="kpi-value">{formatUsd(summary?.total_tvl_usd)}</div><div className="kpi-hint">Across {summary?.vaults ?? 0} vaults</div></div>
          {market === "all" ? <div className="kpi-card"><div className="kpi-label">Largest market share</div><div className="kpi-value">{formatPct(topMarket?.share_tvl)}</div><div className="kpi-hint">{topMarket?.category ? marketLabel(topMarket.category as MarketKind) : "n/a"}</div></div> : <div className="kpi-card"><div className="kpi-label">Largest chain share</div><div className="kpi-value">{formatPct(topChain?.share_tvl)}</div><div className="kpi-hint">{topChain?.chain_id ? chainLabel(topChain.chain_id) : "n/a"}</div></div>}
          <div className="kpi-card"><div className="kpi-label">Largest asset share</div><div className="kpi-value">{formatPct(topToken?.share_tvl)}</div><div className="kpi-hint">{topToken?.token_symbol ?? "n/a"}</div></div>
        </div>}
      </section>
      <section className="section section-lg">
        <TvlTreemap title={market === "all" ? "TVL composition" : `${marketLabel(market)} composition`} chains={chainRows} categories={market === "all" ? marketRows.map((row) => ({ ...row, category: row.category ? marketLabel(row.category as MarketKind) : "Other" })) : []} tokens={tokenRows} />
      </section>
      <section className="section">
        <div className="card-header"><div><h2 className="card-title">Underlying assets</h2><p className="card-description">Select linked assets to compare their vaults; unlinked assets have no valid multi-vault comparison.</p></div></div>
        <TableWrap><table className="decision-table"><thead><tr><th>Asset</th><th className="numeric mobile-secondary-column">Vaults</th><th className="numeric">TVL</th><th className="numeric">Share</th></tr></thead><tbody>
          {isLoading ? <TableSkeleton rows={7} columns={4} /> : tokenRows.map((row) => <tr key={row.token_symbol}><td>{row.token_symbol && comparableTokenSymbols.includes(row.token_symbol) ? <Link href={`/explore?tab=venues&token=${encodeURIComponent(row.token_symbol)}&universe=${universe}`}>{row.token_symbol}</Link> : row.token_symbol || "Unknown"}</td><td className="numeric mobile-secondary-column">{row.vaults}</td><td className="numeric">{formatUsd(row.tvl_usd)}</td><td className="numeric">{formatPct(row.share_tvl)}</td></tr>)}
        </tbody></table></TableWrap>
      </section>
    </>
  );
}
