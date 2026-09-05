"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { MarketFilter } from "../components/market-filter";
import { MarketModeNav } from "../components/market-mode-nav";
import { NoVaultsEmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { VaultLink } from "../components/vault-link";
import { useCompositionData } from "../hooks/use-composition-data";
import { useDiscoverData } from "../hooks/use-discover-data";
import { chainLabel, formatPct, formatPercentagePoints, formatUsd } from "../lib/format";
import {
  MARKET_VALUES,
  marketLabel,
  type MarketKind,
  UNIVERSE_VALUES,
  universeDefaults,
  universeLabel,
  type UniverseKind,
} from "../lib/universe";
import { queryChoice, queryInt, replaceQuery } from "../lib/url";
import { OverviewTab } from "../structure/overview-tab";

type TabKey = "vaults" | "structure";
type VaultSortKey = "tvl" | "est_apy" | "apy_30d" | "momentum";

function vaultCountLabel(count: number): string {
  return `${count} ${count === 1 ? "vault" : "vaults"}`;
}

function ExplorePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortButtons = useRef<Partial<Record<VaultSortKey, HTMLButtonElement | null>>>({});
  const pendingSortFocus = useRef<VaultSortKey | null>(null);
  const query = useMemo(() => {
    const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      market: queryChoice(searchParams, "market", MARKET_VALUES, "all"),
      tab: (searchParams.get("view") === "structure"
        ? "structure"
        : "vaults") as TabKey,
      chain: searchParams.get("chain"),
      search: searchParams.get("q") ?? "",
      limit: queryInt(searchParams, "limit", 30, { min: 10, max: 10000 }),
      sort: queryChoice(
        searchParams,
        "sort",
        [
          "tvl:desc",
          "tvl:asc",
          "est_apy:desc",
          "est_apy:asc",
          "apy_30d:desc",
          "apy_30d:asc",
          "momentum:desc",
          "momentum:asc",
        ] as const,
        "tvl:desc",
      ),
      minTvl: defaults.minTvl,
      minPoints: defaults.minPoints,
    };
  }, [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const [sort, direction] = query.sort.split(":");
  const sortKey = sort as VaultSortKey;
  const sortDirection = direction as "asc" | "desc";
  const toggleColumnSort = (key: VaultSortKey) => {
    const nextDirection = sortKey === key && sortDirection === "desc" ? "asc" : "desc";
    pendingSortFocus.current = key;
    updateQuery({ sort: `${key}:${nextDirection}` });
  };
  const columnSort = (key: VaultSortKey) => sortKey === key
    ? (sortDirection === "asc" ? "ascending" : "descending")
    : "none";
  const columnIndicator = (key: VaultSortKey) => sortKey === key
    ? (sortDirection === "asc" ? "↑" : "↓")
    : null;
  useEffect(() => {
    const key = pendingSortFocus.current;
    if (!key) return;
    pendingSortFocus.current = null;
    window.requestAnimationFrame(() => sortButtons.current[key]?.focus());
  }, [query.sort]);
  const { data, isLoading, error, refetch } = useDiscoverData({
    universe: query.universe,
    market: query.market,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: 250,
    allRows: true,
    sort,
    dir: direction,
    chain: query.chain,
    enabled: query.tab === "vaults",
  });
  const { data: composition, isLoading: compositionLoading } = useCompositionData({
    universe: query.universe,
    market: query.market,
    minTvl: query.minTvl,
    enabled: query.tab === "structure",
  });
  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  const search = query.search.trim().toLowerCase();
  const matchingRows = (data?.rows ?? []).filter((row) => !search || [row.symbol, row.token_symbol, row.vault_address].some((value) => value?.toLowerCase().includes(search)));
  const visibleRows = matchingRows.slice(0, query.limit);
  const coverage = data?.coverage?.coverage_ratio;
  const summary = data?.summary;
  const pageCopy = query.tab === "vaults"
    ? {
        accent: "Find a vault",
        description: "Find a Yearn vault and compare its estimated yield with what it has earned over time.",
      }
      : {
          accent: "Where tracked capital sits",
        description: "See how the selected vault set is distributed across markets, chains, and underlying assets.",
        };

  return (
    <div className="markets-surface">
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Vault research<br /><em className="page-title-accent">{pageCopy.accent}</em></h1>
        <p className="page-description">{pageCopy.description}</p>
        <MarketModeNav active={query.tab} />
      </section>

      <section className="section section-md">
        {query.tab === "vaults" ? <label className="search-field">
          <span className="filter-label">Find by vault name, asset, or address</span>
          <input className="filter-control" type="search" value={query.search} placeholder="Try yvUSD, USDC, or 0x…" onChange={(event) => updateQuery({ q: event.target.value || null, limit: null })} />
        </label> : null}
        <div className="card market-filter-panel">
          <div className="filter-grid">
            <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market })} />
            <label>
              <span className="filter-label">Vault set</span>
              <select className="filter-control" value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}>
                {UNIVERSE_VALUES.map((universe) => <option key={universe} value={universe}>{universeLabel(universe)}</option>)}
              </select>
            </label>
            {query.tab === "vaults" ? (
              <>
                <label>
                  <span className="filter-label">Chain</span>
                  <select className="filter-control" value={query.chain ?? ""} onChange={(event) => updateQuery({ chain: event.target.value || null })}>
                    <option value="">All chains</option>
                    {(data?.facets?.chains ?? []).map((row) => <option key={row.chain_id} value={row.chain_id}>{chainLabel(row.chain_id)}</option>)}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {query.tab === "vaults" ? (
        <>
          <section className="section market-scope-summary" aria-label="Selected vault scope">
            {isLoading ? <span className="muted">Loading vault set…</span> : <>
              <span><strong>{vaultCountLabel(matchingRows.length)}</strong> {search ? "matching your search" : "in view"}</span>
              <section className="scope-note"><h2 className="detail-title">About this vault set</h2>
                <p>{formatUsd(summary?.total_tvl_usd)} tracked TVL · {formatPct(summary?.tvl_weighted_realized_apy_30d)} TVL-weighted 30d realized APY{query.universe === "raw" ? ` · ${formatPct(coverage, 0)} history coverage` : ""}. These totals cover the selected filters before name search.</p>
              </section>
            </>}
          </section>

          <section className="section section-lg">
            <div className="card-header"><div><h2 className="card-title">Vault comparison</h2><p className="card-description">Estimated APY is the current estimate. Realized APY annualizes past earnings. The 7d vs 30d column shows how recent yield differs from the longer baseline.</p></div></div>
            {!isLoading && !matchingRows.length ? <NoVaultsEmptyState onReset={() => updateQuery({ market: "all", chain: null, universe: "raw", q: null })} /> : (
              <TableWrap><table className="decision-table" aria-label="Vault comparison">
                <thead><tr>
                  <th>Vault</th>
                  <th className="mobile-secondary-column">Asset</th>
                  <th className="mobile-secondary-column">Market</th>
                  <th className="mobile-secondary-column">Chain</th>
                  <th className="numeric" aria-sort={columnSort("tvl")}><button ref={(node) => { sortButtons.current.tvl = node; }} className="th-button" aria-label="Sort by TVL" onClick={() => toggleColumnSort("tvl")}>TVL {columnIndicator("tvl") ? <span className="th-indicator" aria-hidden="true">{columnIndicator("tvl")}</span> : null}</button></th>
                  <th className="numeric mobile-secondary-column" aria-sort={columnSort("est_apy")}><button ref={(node) => { sortButtons.current.est_apy = node; }} className="th-button" aria-label="Sort by estimated APY" onClick={() => toggleColumnSort("est_apy")}>Est. APY {columnIndicator("est_apy") ? <span className="th-indicator" aria-hidden="true">{columnIndicator("est_apy")}</span> : null}</button></th>
                  <th className="numeric" aria-sort={columnSort("apy_30d")}><button ref={(node) => { sortButtons.current.apy_30d = node; }} className="th-button" aria-label="Sort by 30d realized APY" onClick={() => toggleColumnSort("apy_30d")}><span className="sort-label-desktop" aria-hidden="true">Realized APY · 30d</span><span className="sort-label-mobile" aria-hidden="true">30d APY</span>{columnIndicator("apy_30d") ? <span className="th-indicator" aria-hidden="true">{columnIndicator("apy_30d")}</span> : null}</button></th>
                  <th className="numeric" aria-sort={columnSort("momentum")}><button ref={(node) => { sortButtons.current.momentum = node; }} className="th-button" aria-label="Sort by 7d versus 30d realized APY" onClick={() => toggleColumnSort("momentum")}><span className="sort-label-desktop" aria-hidden="true">7d vs 30d</span><span className="sort-label-mobile" aria-hidden="true">7d−30d</span>{columnIndicator("momentum") ? <span className="th-indicator" aria-hidden="true">{columnIndicator("momentum")}</span> : null}</button></th>
                </tr></thead>
                <tbody>{isLoading ? <TableSkeleton rows={7} columns={8} /> : visibleRows.map((row) => (
                  <tr key={`${row.chain_id}:${row.vault_address}`}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /><Link className="vault-report-link" href={`/reports?view=vaults&vault_address=${row.vault_address}&chain_id=${row.chain_id}`}>Reports</Link><div className="mobile-only muted">{marketLabel(row.market as MarketKind)} · {chainLabel(row.chain_id)}</div></td>
                    <td className="mobile-secondary-column">{row.token_symbol || "Unknown"}</td>
                    <td className="mobile-secondary-column">{marketLabel(row.market as MarketKind)}</td>
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
            <p className="explanation">Search covers the selected vault set. Choose All tracked vaults to include smaller vaults.</p>
          </section>
        </>
      ) : (
        <OverviewTab
          isLoading={compositionLoading}
          market={query.market}
          summary={composition?.summary}
          chainRows={composition?.chains ?? []}
          marketRows={composition?.categories ?? []}
          tokenRows={composition?.tokens ?? []}
        />
      )}
    </div>
  );
}

export default function ExplorePage() {
  return <Suspense fallback={<div className="page-loading">Loading vaults…</div>}><ExplorePageContent /></Suspense>;
}
