"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { MarketFilter } from "../components/market-filter";
import { MarketModeNav } from "../components/market-mode-nav";
import { NoVaultsEmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { VaultLink } from "../components/vault-link";
import { useAssetsData, useAssetVaults } from "../hooks/use-assets-data";
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

type TabKey = "vaults" | "compare" | "structure";

function ExplorePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => {
    const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      market: queryChoice(searchParams, "market", MARKET_VALUES, "all"),
      tab: (searchParams.get("view") === "vaults" || searchParams.get("view") === "compare" || searchParams.get("view") === "structure"
        ? searchParams.get("view")
        : searchParams.get("tab") === "venues"
        ? "compare"
        : queryChoice(searchParams, "tab", ["vaults", "compare", "structure"] as const, "vaults")) as TabKey,
      chain: searchParams.get("chain"),
      token: searchParams.get("token"),
      limit: queryInt(searchParams, "limit", 30, { min: 10, max: 100 }),
      sort: queryChoice(
        searchParams,
        "sort",
        ["tvl:desc", "apy_30d:desc", "momentum:desc", "momentum:asc", "est_apy:desc"] as const,
        "tvl:desc",
      ),
      minTvl: defaults.minTvl,
      minPoints: defaults.minPoints,
    };
  }, [searchParams]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const [sort, direction] = query.sort.split(":");
  const { data, isLoading, error, refetch } = useDiscoverData({
    universe: query.universe,
    market: query.market,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: query.limit,
    sort,
    dir: direction,
    chain: query.chain,
  });
  const { data: composition, isLoading: compositionLoading } = useCompositionData({
    universe: query.universe,
    market: query.market,
    minTvl: query.minTvl,
  });
  const { data: assets, isLoading: assetsLoading } = useAssetsData({
    universe: query.universe,
    market: "all",
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: 100,
    tokenScope: "featured",
    apiSort: "tvl",
    apiDir: "desc",
  });
  const assetRows = useMemo(() => assets?.rows ?? [], [assets?.rows]);

  useEffect(() => {
    if (query.tab !== "compare") return;
    if (query.market !== "all") {
      updateQuery({ market: "all" });
      return;
    }
    if (assetRows.length === 0) return;
    if (!query.token || !assetRows.some((row) => row.token_symbol === query.token)) {
      updateQuery({ token: assetRows[0].token_symbol });
    }
    // updateQuery intentionally follows the current URL state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetRows, query.market, query.tab, query.token]);

  const { data: assetVaults, isLoading: assetVaultsLoading } = useAssetVaults(query.token, {
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
  });

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  const coverage = data?.coverage?.coverage_ratio;
  const summary = data?.summary;
  const pageCopy = query.tab === "vaults"
    ? {
        accent: "Compare like with like",
        description: "Screen Yearn vaults by market, chain, size, and realized yield. Open a vault to inspect its evidence.",
      }
    : query.tab === "compare"
      ? {
          accent: "Same asset, different vault",
        description: "Compare vaults with the same token symbol. Wrapped or differently named assets stay separate.",
        }
      : {
          accent: "Where tracked capital sits",
        description: "See how the selected vault set is distributed across markets, chains, and underlying assets.",
        };

  return (
    <div className="markets-surface">
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Markets<br /><em className="page-title-accent">{pageCopy.accent}</em></h1>
        <p className="page-description">{pageCopy.description}</p>
        <MarketModeNav active={query.tab} />
      </section>

      <section className="section section-md">
        <div className="card market-filter-panel">
          <div className="filter-grid">
            {query.tab !== "compare" ? <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market, token: null })} /> : null}
            <label>
              <span className="filter-label">Vault set</span>
              <select className="filter-control" value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null, token: null })}>
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
                <label>
                  <span className="filter-label">Order by</span>
                  <select className="filter-control" value={query.sort} onChange={(event) => updateQuery({ sort: event.target.value })}>
                    <option value="tvl:desc">Largest TVL</option>
                    <option value="apy_30d:desc">Highest realized APY · 30d</option>
                    <option value="momentum:desc">Highest 7d vs 30d</option>
                    <option value="momentum:asc">Lowest 7d vs 30d</option>
                    <option value="est_apy:desc">Highest estimated APY</option>
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
              <span><strong>{data?.pagination.total ?? 0}</strong> comparable vaults</span>
              <span><strong>{formatUsd(summary?.total_tvl_usd)}</strong> tracked TVL</span>
              <span><strong>{formatPct(summary?.tvl_weighted_realized_apy_30d)}</strong> TVL-weighted realized APY · 30d</span>
              {query.universe === "raw" ? <span><strong>{formatPct(coverage, 0)}</strong> history coverage</span> : null}
            </>}
          </section>

          <section className="section section-lg">
            <div className="card-header"><div><h2 className="card-title">Vault comparison</h2><p className="card-description">7d vs 30d is short-window realized APY minus the 30d baseline. Open a vault for its contract, strategies, and risk profile.</p></div></div>
            {!isLoading && !(data?.rows.length ?? 0) ? <NoVaultsEmptyState onReset={() => updateQuery({ market: "all", chain: null, universe: "core" })} /> : (
              <TableWrap><table className="decision-table">
                <thead><tr><th>Vault</th><th className="mobile-secondary-column">Market</th><th className="mobile-secondary-column">Chain</th><th className="numeric">TVL</th><th className="numeric mobile-secondary-column">Est. APY</th><th className="numeric" data-mobile-label="30d APY">Realized APY · 30d</th><th className="numeric" data-mobile-label="7d−30d">7d vs 30d</th></tr></thead>
                <tbody>{isLoading ? <TableSkeleton rows={7} columns={7} /> : data?.rows.map((row) => (
                  <tr key={`${row.chain_id}:${row.vault_address}`}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /><div className="mobile-only muted">{marketLabel(row.market as MarketKind)} · {chainLabel(row.chain_id)}</div></td>
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
          </section>
        </>
      ) : query.tab === "compare" ? (
        <>
          <section className="section section-lg">
            <div className="card-header"><div><h2 className="card-title">Exact-symbol comparisons</h2><p className="card-description">Choose a symbol shared by at least two tracked Yearn vaults. Ranges are descriptive, not risk-adjusted; wrapped and differently named assets stay separate.</p></div></div>
            <TableWrap><table className="decision-table market-asset-selector"><thead><tr><th>Asset</th><th className="numeric mobile-secondary-column">Vaults</th><th className="numeric">TVL</th><th className="numeric mobile-secondary-column">Weighted realized APY · 30d</th><th className="numeric" data-mobile-label="Best 30d">Best realized APY · 30d</th><th className="numeric" data-mobile-label="Range">Realized range</th></tr></thead><tbody>
              {assetsLoading ? <TableSkeleton rows={3} columns={6} /> : assetRows.length === 0 ? <tr><td colSpan={6} className="muted">No exact-symbol comparisons in this vault set.</td></tr> : assetRows.map((row) => <tr key={row.token_symbol} className={query.token === row.token_symbol ? "is-selected" : undefined}><td><button aria-pressed={query.token === row.token_symbol} className={`button-reset market-asset-choice ${query.token === row.token_symbol ? "is-selected" : ""}`.trim()} onClick={() => updateQuery({ token: row.token_symbol })}>{row.token_symbol}{query.token === row.token_symbol ? <span className="muted"> · selected</span> : null}</button></td><td className="numeric mobile-secondary-column">{row.vaults}</td><td className="numeric">{formatUsd(row.total_tvl_usd)}</td><td className="numeric mobile-secondary-column">{formatPct(row.weighted_realized_apy_30d)}</td><td className="numeric">{formatPct(row.best_realized_apy_30d)}</td><td className="numeric">{formatPct(row.realized_spread_30d)}</td></tr>)}
            </tbody></table></TableWrap>
          </section>
          {assetRows.length > 0 ? <>
          <section className="section section-lg">
            <div className="card-header"><div><h2 className="card-title">{query.token || "Asset"} vaults{!assetVaultsLoading && assetVaults ? ` · ${assetVaults.summary.vaults} comparable` : ""}</h2><p className="card-description">Exact token-symbol matches only. The comparison above is descriptive, not risk-adjusted.</p></div></div>
            <TableWrap><table className="decision-table">
              <thead><tr><th>Vault</th><th className="mobile-secondary-column">Chain</th><th className="numeric">TVL</th><th className="numeric mobile-secondary-column">Est. APY</th><th className="numeric" data-mobile-label="30d APY">Realized APY · 30d</th><th className="numeric" data-mobile-label="7d−30d">7d vs 30d</th></tr></thead>
              <tbody>{assetVaultsLoading ? <TableSkeleton rows={6} columns={6} /> : assetVaults?.rows.map((row) => (
                <tr key={`${row.chain_id}:${row.vault_address}`}><td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /><div className="mobile-only muted">{chainLabel(row.chain_id)}</div></td><td className="mobile-secondary-column">{chainLabel(row.chain_id)}</td><td className="data-value numeric">{formatUsd(row.tvl_usd)}</td><td className="data-value numeric mobile-secondary-column">{formatPct(row.est_apy)}</td><td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td><td className={`data-value numeric ${(row.momentum_7d_30d ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatPercentagePoints(row.momentum_7d_30d)}</td></tr>
              ))}</tbody>
            </table></TableWrap>
          </section>
          </> : null}
        </>
      ) : (
        <OverviewTab
          isLoading={compositionLoading}
          universe={query.universe}
          market={query.market}
          summary={composition?.summary}
          chainRows={composition?.chains ?? []}
          marketRows={composition?.categories ?? []}
          tokenRows={composition?.tokens ?? []}
          comparableTokenSymbols={assetRows.map((row) => row.token_symbol)}
        />
      )}
    </div>
  );
}

export default function ExplorePage() {
  return <Suspense fallback={<div className="page-loading">Loading vaults…</div>}><ExplorePageContent /></Suspense>;
}
