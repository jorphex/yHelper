"use client";

import { VaultSourceNote } from "../components/source-notes";
import { RiskAssessmentLink } from "../components/risk-assessment-link";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { MarketFilter } from "../components/market-filter";
import { MarketModeNav } from "../components/market-mode-nav";
import { EmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { VaultLink } from "../components/vault-link";
import { compositionOptions } from "../hooks/use-composition-data";
import { discoverOptions } from "../hooks/use-discover-data";
import { chainLabel, formatPct, formatPercentagePoints, formatUsd } from "../lib/format";
import {
  marketLabel,
  marketScope,
  UNIVERSE_VALUES,
  universeLabel,
} from "../lib/universe";
import { queryChoice, queryInt, replaceQuery } from "../lib/url";
import { OverviewTab } from "../structure/overview-tab";

const SORT_COLUMNS = [
  { key: "tvl", label: "TVL", ariaLabel: "Sort by TVL" },
  { key: "est_apy", label: "Est. APY", ariaLabel: "Sort by estimated APY", secondary: true },
  { key: "apy_30d", label: "Realized APY · 30d", mobileLabel: "30d APY", ariaLabel: "Sort by 30d realized APY" },
  { key: "momentum", label: "7d vs 30d", mobileLabel: "7d−30d", ariaLabel: "Sort by 7d versus 30d realized APY" },
] as const;
type VaultSortKey = typeof SORT_COLUMNS[number]["key"];
const SORT_VALUES = SORT_COLUMNS.flatMap(({ key }) => [`${key}:desc`, `${key}:asc`] as const);

function vaultCountLabel(count: number): string {
  return `${count} ${count === 1 ? "vault" : "vaults"}`;
}

export function VaultResearchView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortButtons = useRef<Partial<Record<VaultSortKey, HTMLButtonElement | null>>>({});
  const pendingSortFocus = useRef<VaultSortKey | null>(null);
  const query = {
    ...marketScope(searchParams),
    chain: queryInt(searchParams, "chain", null, { min: 1 }),
    search: searchParams.get("q") ?? "",
    limit: queryInt(searchParams, "limit", 30, { min: 10, max: 10000 }),
    sort: queryChoice(searchParams, "sort", SORT_VALUES, "tvl:desc"),
  };
  const showVaults = searchParams.get("view") !== "structure";

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(pathname, searchParams, updates, pathname === "/markets" ? undefined : router);

  const [sort, direction] = query.sort.split(":");
  const sortKey = sort as VaultSortKey;
  const sortDirection = direction as "asc" | "desc";
  const toggleColumnSort = (key: VaultSortKey) => {
    const nextDirection = sortKey === key && sortDirection === "desc" ? "asc" : "desc";
    pendingSortFocus.current = key;
    updateQuery({ sort: `${key}:${nextDirection}` });
  };
  useEffect(() => {
    const key = pendingSortFocus.current;
    if (!key) return;
    pendingSortFocus.current = null;
    window.requestAnimationFrame(() => sortButtons.current[key]?.focus());
  }, [query.sort]);
  const { universe, market, minTvl, minPoints, chain } = query;
  const vaults = useQuery({ ...discoverOptions({ universe, market, minTvl, minPoints, sort, dir: direction, chain }), enabled: showVaults });
  const composition = useQuery({ ...compositionOptions({ universe, market, minTvl }), enabled: !showVaults });
  const activeQuery = showVaults ? vaults : composition;
  const { data, isLoading } = vaults;

  const search = query.search.trim().toLowerCase();
  const matchingRows = (data?.rows ?? []).filter((row) => !search || [row.symbol, row.token_symbol, row.vault_address].some((value) => value?.toLowerCase().includes(search)));
  const visibleRows = matchingRows.slice(0, query.limit);
  const coverage = data?.coverage?.coverage_ratio;
  const summary = data?.summary;
  const [accent, description] = showVaults
    ? ["Find a vault", "Compare estimated and past vault yields."]
    : ["Where tracked capital sits", "Vault TVL by market, chain, and asset."];

  return (
    <div className="markets-surface">
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Vault research<br /><em className="page-title-accent">{accent}</em></h1>
        <p className="page-description">{description}</p>
        <MarketModeNav active={showVaults ? "vaults" : "structure"} />
        <VaultSourceNote source={activeQuery.data?.source_freshness} />
      </section>

      <section className="section section-md">
        {showVaults && <label className="search-field">
          <span className="filter-label">Find by vault name, asset, or address</span>
          <input className="filter-control" type="search" value={query.search} placeholder="Try yvUSD, USDC, or 0x…" onChange={(event) => updateQuery({ q: event.target.value || null, limit: null })} />
        </label>}
        <div className="card market-filter-panel">
          <div className="filter-grid">
            <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market })} />
            <label>
              <span className="filter-label">Vault set</span>
              <select className="filter-control" value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}>
                {UNIVERSE_VALUES.map((universe) => <option key={universe} value={universe}>{universeLabel(universe)}</option>)}
              </select>
            </label>
            {showVaults && (
                <label>
                  <span className="filter-label">Chain</span>
                  <select className="filter-control" value={query.chain ?? ""} onChange={(event) => updateQuery({ chain: event.target.value || null })}>
                    <option value="">All chains</option>
                    {(data?.facets?.chains ?? []).map((row) => <option key={row.chain_id} value={row.chain_id}>{chainLabel(row.chain_id)}</option>)}
                  </select>
                </label>
            )}
          </div>
        </div>
      </section>

      {activeQuery.error && !activeQuery.data ? <DataLoadError onRetry={() => activeQuery.refetch()} /> : showVaults ? (
        <>
          <section className="section market-scope-summary" aria-label="Selected vault scope">
            {isLoading ? <span className="muted">Loading vault set…</span> : <>
              <span><strong>{vaultCountLabel(matchingRows.length)}</strong> {search ? "matching your search" : "in view"}</span>
              <section className="scope-note"><h2 className="detail-title">About this vault set</h2>
                <p>{formatUsd(summary?.total_tvl_usd)} tracked TVL · {formatPct(summary?.tvl_weighted_realized_apy_30d)} TVL-weighted 30d realized APY{query.universe === "raw" ? ` · ${formatPct(coverage, 0)} history coverage` : ""}. Totals exclude the name search filter.</p>
              </section>
            </>}
          </section>

          <section className="section section-lg">
            <div className="card-header"><div><h2 className="card-title">Vault comparison</h2><p className="card-description">Estimated APY projects yield. Realized APY annualizes past earnings.</p></div></div>
            {!isLoading && !matchingRows.length ? <EmptyState title="No vaults match this view" description="Try a different market, chain, or vault set." icon="filter" actionLabel="Reset filters" onAction={() => updateQuery({ market: "all", chain: null, universe: "raw", q: null })} /> : (
              <TableWrap><table className="decision-table" aria-label="Vault comparison">
                <thead><tr>
                  <th>Vault</th>
                  <th className="mobile-secondary-column">Asset</th>
                  <th className="mobile-secondary-column">Market</th>
                  <th className="mobile-secondary-column">Chain</th>
                  {SORT_COLUMNS.map((column) => {
                    const active = column.key === sortKey;
                    const ascending = sortDirection === "asc";
                    return <th key={column.key} className={"secondary" in column ? "numeric mobile-secondary-column" : "numeric"} aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}>
                      <button ref={(node) => { sortButtons.current[column.key] = node; }} className="th-button" aria-label={column.ariaLabel} onClick={() => toggleColumnSort(column.key)}>
                        {"mobileLabel" in column ? <>
                          <span className="sort-label-desktop" aria-hidden="true">{column.label}</span>
                          <span className="sort-label-mobile" aria-hidden="true">{column.mobileLabel}</span>
                        </> : column.label}
                        {active && <span className="th-indicator" aria-hidden="true">{ascending ? "↑" : "↓"}</span>}
                      </button>
                    </th>;
                  })}
                </tr></thead>
                <tbody>{isLoading ? <TableSkeleton rows={7} columns={8} /> : visibleRows.map((row) => (
                  <tr key={`${row.chain_id}:${row.vault_address}`}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} returnTo={`${pathname}?${searchParams.toString()}`} /><Link className="vault-report-link" href={`/reports?view=vaults&vault_address=${row.vault_address}&chain_id=${row.chain_id}`}>Reports</Link><RiskAssessmentLink chainId={row.chain_id} address={row.vault_address} label={row.symbol ?? row.vault_address} /><div className="mobile-only muted">{marketLabel(row.market)} · {chainLabel(row.chain_id)}</div></td>
                    <td className="mobile-secondary-column">{row.token_symbol || "Unknown"}</td>
                    <td className="mobile-secondary-column">{marketLabel(row.market)}</td>
                    <td className="mobile-secondary-column"><Link className="market-link-secondary" href={`/markets?view=vaults&market=${query.market}&universe=${query.universe}&chain=${row.chain_id}`}>{chainLabel(row.chain_id)}</Link></td>
                    <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                    <td className="data-value numeric mobile-secondary-column">{formatPct(row.est_apy)}</td>
                    <td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td>
                    <td className={`data-value numeric ${(row.momentum_7d_30d ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatPercentagePoints(row.momentum_7d_30d)}</td>
                  </tr>
                ))}</tbody>
              </table></TableWrap>
            )}
            {matchingRows.length > visibleRows.length ? <button className="button button-ghost" onClick={() => updateQuery({ limit: query.limit + 30 })}>Show more vaults ({matchingRows.length - visibleRows.length} remaining)</button> : null}
            <p className="explanation">Choose All tracked vaults to include smaller vaults.</p>
          </section>
        </>
      ) : (
        <OverviewTab
          isLoading={composition.isLoading}
          market={query.market}
          summary={composition.data?.summary}
          chainRows={composition.data?.chains ?? []}
          marketRows={composition.data?.categories ?? []}
          tokenRows={composition.data?.tokens ?? []}
        />
      )}
    </div>
  );
}
