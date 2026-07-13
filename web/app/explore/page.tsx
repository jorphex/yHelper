"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { MarketFilter } from "../components/market-filter";
import { NoVaultsEmptyState } from "../components/empty-state";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { VaultLink } from "../components/vault-link";
import { useAssetsData, useAssetVenues } from "../hooks/use-assets-data";
import { useChainsData } from "../hooks/use-chains-data";
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

type TabKey = "vaults" | "venues";

function riskLabel(level: string | null): string {
  const labels: Record<string, string> = { "1": "Low", "2": "Medium", "3": "High", "4": "Very high" };
  return level ? labels[level] ?? (level === "-1" ? "Unrated" : level) : "n/a";
}

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
      tab: queryChoice(searchParams, "tab", ["vaults", "venues"] as const, "vaults") as TabKey,
      chain: searchParams.get("chain"),
      token: searchParams.get("token"),
      limit: queryInt(searchParams, "limit", 30, { min: 10, max: 100 }),
      sort: searchParams.get("sort") || "tvl:desc",
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
    category: null,
    token: null,
  });
  const { data: chainsData } = useChainsData({ universe: query.universe, minTvl: query.minTvl });
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
    if (query.tab !== "venues") return;
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

  const { data: venues, isLoading: venuesLoading } = useAssetVenues(query.token, {
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
  });

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  const coverage = data?.coverage?.coverage_ratio;
  const summary = data?.summary;

  return (
    <div>
      <section className="page-header page-header-no-border">
        <h1 className="page-title">Explore<br /><em className="page-title-accent">Compare like with like</em></h1>
        <p className="page-description">
          Start with the asset exposure you want, then compare current estimated yield with realized history and direction.
        </p>
        <div className="tab-bar">
          <button className={`button ${query.tab === "vaults" ? "button-primary" : "button-ghost"}`} onClick={() => updateQuery({ tab: "vaults" })}>Vaults</button>
          <button className={`button ${query.tab === "venues" ? "button-primary" : "button-ghost"}`} onClick={() => updateQuery({ tab: "venues", market: "all", token: null })}>Asset venues</button>
        </div>
      </section>

      <section className="section section-md">
        <div className="card">
          <div className="filter-grid">
            {query.tab === "vaults" ? <MarketFilter market={query.market} universe={query.universe} minTvl={query.minTvl} onChange={(market) => updateQuery({ market, token: null })} /> : null}
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
                    {(chainsData?.rows ?? []).map((row) => <option key={row.chain_id} value={row.chain_id}>{chainLabel(row.chain_id)}</option>)}
                  </select>
                </label>
                <label>
                  <span className="filter-label">Order by</span>
                  <select className="filter-control" value={query.sort} onChange={(event) => updateQuery({ sort: event.target.value })}>
                    <option value="tvl:desc">Largest TVL</option>
                    <option value="apy_30d:desc">Highest realized 30d</option>
                    <option value="momentum:desc">Strengthening fastest</option>
                    <option value="momentum:asc">Weakening fastest</option>
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
          <section className="section section-lg">
            {isLoading ? <KpiGridSkeleton count={4} /> : (
              <div className="kpi-grid kpi-grid-4">
                <div className="kpi-card"><div className="kpi-label">Comparable vaults</div><div className="kpi-value">{data?.pagination.total ?? 0}</div></div>
                <div className="kpi-card"><div className="kpi-label">Tracked TVL</div><div className="kpi-value">{formatUsd(summary?.total_tvl_usd)}</div></div>
                <div className="kpi-card"><div className="kpi-label">TVL-weighted realized 30d</div><div className="kpi-value">{formatPct(summary?.tvl_weighted_realized_apy_30d)}</div></div>
                <div className="kpi-card"><div className="kpi-label">History coverage</div><div className="kpi-value">{formatPct(coverage, 0)}</div><div className="kpi-hint">Automatic history-quality gate</div></div>
              </div>
            )}
          </section>

          <section className="section">
            <div className="card-header"><div><h2 className="card-title">Vault comparison</h2><p className="card-description">Momentum is realized 7d APY minus realized 30d APY. Positive means recent yield strengthened.</p></div></div>
            {!isLoading && !(data?.rows.length ?? 0) ? <NoVaultsEmptyState onReset={() => updateQuery({ market: "all", chain: null, universe: "core" })} /> : (
              <TableWrap><table>
                <thead><tr><th>Vault</th><th>Market</th><th>Chain</th><th className="numeric">TVL</th><th className="numeric">Est. APY</th><th className="numeric">Realized 30d</th><th className="numeric">Momentum</th><th>Risk</th></tr></thead>
                <tbody>{isLoading ? <TableSkeleton rows={7} columns={8} /> : data?.rows.map((row) => (
                  <tr key={`${row.chain_id}:${row.vault_address}`}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                    <td>{marketLabel(row.market as MarketKind)}</td>
                    <td><Link href={`/explore?market=${query.market}&universe=${query.universe}&chain=${row.chain_id}`}>{chainLabel(row.chain_id)}</Link></td>
                    <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                    <td className="data-value numeric">{formatPct(row.est_apy)}</td>
                    <td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td>
                    <td className={`data-value numeric ${(row.momentum_7d_30d ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatPercentagePoints(row.momentum_7d_30d)}</td>
                    <td>{riskLabel(row.risk_level)}</td>
                  </tr>
                ))}</tbody>
              </table></TableWrap>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="section section-lg">
            <div className="card-header"><div><h2 className="card-title">Comparable assets</h2><p className="card-description">Choose an exact symbol with at least two tracked venues and meaningful TVL. Wrapped or differently named assets are not silently merged.</p></div></div>
            <TableWrap><table><thead><tr><th>Asset</th><th className="numeric">Venues</th><th className="numeric">TVL</th><th className="numeric">Best realized 30d</th><th className="numeric">Realized range</th></tr></thead><tbody>
              {assetsLoading ? <TableSkeleton rows={3} columns={5} /> : assetRows.length === 0 ? <tr><td colSpan={5} className="muted">No exact-symbol venue comparisons are available for this market and vault set.</td></tr> : assetRows.map((row) => <tr key={row.token_symbol}><td><button aria-pressed={query.token === row.token_symbol} className={`button-reset ${query.token === row.token_symbol ? "text-accent" : ""}`.trim()} onClick={() => updateQuery({ token: row.token_symbol })}>{row.token_symbol}{query.token === row.token_symbol ? <span className="muted"> · selected</span> : null}</button></td><td className="numeric">{row.venues}</td><td className="numeric">{formatUsd(row.total_tvl_usd)}</td><td className="numeric">{formatPct(row.best_realized_apy_30d)}</td><td className="numeric">{formatPct(row.realized_spread_30d)}</td></tr>)}
            </tbody></table></TableWrap>
          </section>
          {assetRows.length > 0 ? <>
          <section className="section section-lg">
            {assetsLoading || venuesLoading ? <KpiGridSkeleton count={4} /> : (
              <div className="kpi-grid kpi-grid-4">
                <div className="kpi-card"><div className="kpi-label">Comparable venues</div><div className="kpi-value">{venues?.summary.venues ?? 0}</div></div>
                <div className="kpi-card"><div className="kpi-label">Realized range</div><div className="kpi-value">{formatPct(venues?.summary.realized_spread_30d)}</div><div className="kpi-hint">Best minus lowest 30d result</div></div>
                <div className="kpi-card"><div className="kpi-label">Best realized 30d</div><div className="kpi-value">{formatPct(venues?.summary.best_realized_apy_30d)}</div></div>
                <div className="kpi-card"><div className="kpi-label">Weighted realized 30d</div><div className="kpi-value">{formatPct(venues?.summary.weighted_realized_apy_30d)}</div></div>
              </div>
            )}
          </section>
          <section className="section">
            <div className="card-header"><div><h2 className="card-title">{query.token || "Asset"} venues</h2><p className="card-description">Exact token-symbol matches only; wrapped or differently named assets are not silently merged.</p></div></div>
            <TableWrap><table>
              <thead><tr><th>Vault</th><th>Chain</th><th className="numeric">TVL</th><th className="numeric">Est. APY</th><th className="numeric">Realized 30d</th><th className="numeric">Momentum</th></tr></thead>
              <tbody>{venuesLoading ? <TableSkeleton rows={6} columns={6} /> : venues?.rows.map((row) => (
                <tr key={`${row.chain_id}:${row.vault_address}`}><td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td><td>{chainLabel(row.chain_id)}</td><td className="data-value numeric">{formatUsd(row.tvl_usd)}</td><td className="data-value numeric">{formatPct(row.est_apy)}</td><td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td><td className={`data-value numeric ${(row.momentum_7d_30d ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatPercentagePoints(row.momentum_7d_30d)}</td></tr>
              ))}</tbody>
            </table></TableWrap>
          </section>
          </> : null}
        </>
      )}
    </div>
  );
}

export default function ExplorePage() {
  return <Suspense fallback={<div className="page-loading">Loading vault intelligence…</div>}><ExplorePageContent /></Suspense>;
}
