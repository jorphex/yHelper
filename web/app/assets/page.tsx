"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, regimeLabel, shortVaultLabel, yearnVaultUrl } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, queryString, replaceQuery } from "../lib/url";
import { BarList, KpiGrid } from "../components/visuals";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

type AssetRow = {
  token_symbol: string;
  venues: number;
  chains: number;
  total_tvl_usd: number | null;
  best_safe_apy_30d: number | null;
  weighted_safe_apy_30d: number | null;
  spread_safe_apy_30d: number | null;
};

type AssetsResponse = {
  summary?: {
    tokens?: number;
    total_tvl_usd?: number;
    total_venues?: number;
    avg_venues_per_token?: number | null;
    multi_chain_tokens?: number;
    high_spread_tokens?: number;
    median_spread_safe_apy_30d?: number | null;
    median_best_safe_apy_30d?: number | null;
    tvl_weighted_safe_apy_30d?: number | null;
    top_token_symbol?: string | null;
    top_token_tvl_share?: number | null;
  };
  rows: AssetRow[];
};

type VenueRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  category: string | null;
  version: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  regime: string;
};

type AssetVenuesResponse = {
  token_symbol: string;
  summary: {
    venues: number;
    chains: number;
    total_tvl_usd: number;
    best_safe_apy_30d: number | null;
    worst_safe_apy_30d: number | null;
    spread_safe_apy_30d: number | null;
    weighted_safe_apy_30d: number | null;
    best_venue_symbol: string | null;
    median_safe_apy_30d?: number | null;
    median_momentum_7d_30d?: number | null;
    tvl_weighted_momentum_7d_30d?: number | null;
    regime_counts?: Array<{ regime: string; vaults: number }>;
  };
  rows: VenueRow[];
};

type TokenSortKey = "token" | "venues" | "chains" | "tvl" | "best" | "weighted" | "spread";
type VenueSortKey = "vault" | "chain" | "category" | "version" | "tvl" | "apy" | "momentum" | "consistency" | "regime";
type AssetApiSort = "tvl" | "spread" | "best_apy" | "venues";

function AssetsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [assetData, setAssetData] = useState<AssetsResponse | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetVenuesResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tokenSort, setTokenSort] = useState<SortState<TokenSortKey>>({ key: "tvl", direction: "desc" });
  const [venueSort, setVenueSort] = useState<SortState<VenueSortKey>>({ key: "apy", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      limit: queryInt(searchParams, "limit", 120, { min: 10, max: 300 }),
      apiSort: queryChoice<AssetApiSort>(searchParams, "api_sort", ["tvl", "spread", "best_apy", "venues"] as const, "tvl"),
      apiDir: queryChoice(searchParams, "api_dir", ["asc", "desc"] as const, "desc"),
      token: queryString(searchParams, "token", ""),
      tokenSort: queryChoice<TokenSortKey>(
        searchParams,
        "token_sort",
        ["token", "venues", "chains", "tvl", "best", "weighted", "spread"] as const,
        "tvl",
      ),
      tokenDir: queryChoice(searchParams, "token_dir", ["asc", "desc"] as const, "desc"),
      venueSort: queryChoice<VenueSortKey>(
        searchParams,
        "venue_sort",
        ["vault", "chain", "category", "version", "tvl", "apy", "momentum", "consistency", "regime"] as const,
        "apy",
      ),
      venueDir: queryChoice(searchParams, "venue_dir", ["asc", "desc"] as const, "desc"),
    };
  }, [searchParams]);

  useEffect(() => {
    setTokenSort({ key: query.tokenSort, direction: query.tokenDir });
    setVenueSort({ key: query.venueSort, direction: query.venueDir });
  }, [query.tokenSort, query.tokenDir, query.venueSort, query.venueDir]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    let active = true;
    const loadAssets = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          limit: String(query.limit),
          sort_by: query.apiSort,
          direction: query.apiDir,
        });
        const res = await fetch(`/api/assets?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setAssetsError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as AssetsResponse;
        if (!active) return;
        setAssetData(payload);
        setAssetsError(null);
      } catch (err) {
        if (active) setAssetsError(`Load failed: ${String(err)}`);
      }
    };
    void loadAssets();
    return () => {
      active = false;
    };
  }, [query.universe, query.minTvl, query.minPoints, query.limit, query.apiSort, query.apiDir]);

  const selectedSymbol = query.token || assetData?.rows[0]?.token_symbol || "";

  useEffect(() => {
    if (!query.token && assetData?.rows[0]?.token_symbol) {
      replaceQuery(router, pathname, searchParams, { token: assetData.rows[0].token_symbol });
    }
  }, [assetData, pathname, query.token, router, searchParams]);

  useEffect(() => {
    if (!selectedSymbol) {
      setDetail(null);
      return;
    }
    let active = true;
    const loadDetail = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          limit: String(query.limit),
        });
        const path = `/api/assets/${encodeURIComponent(selectedSymbol)}/venues?${params.toString()}`;
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) {
          if (active) setDetailError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as AssetVenuesResponse;
        if (active) {
          setDetail(payload);
          setDetailError(null);
        }
      } catch (err) {
        if (active) setDetailError(`Load failed: ${String(err)}`);
      }
    };
    void loadDetail();
    return () => {
      active = false;
    };
  }, [selectedSymbol, query.universe, query.minTvl, query.minPoints, query.limit]);

  const tokenRows = sortRows(assetData?.rows ?? [], tokenSort, {
    token: (row) => row.token_symbol,
    venues: (row) => row.venues,
    chains: (row) => row.chains,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    best: (row) => row.best_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    weighted: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    spread: (row) => row.spread_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });

  const venueRows = sortRows(detail?.rows ?? [], venueSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    category: (row) => row.category ?? "",
    version: (row) => row.version ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.consistency_score ?? Number.NEGATIVE_INFINITY,
    regime: (row) => row.regime,
  });
  const topTokenByTvl = useMemo(
    () =>
      [...(assetData?.rows ?? [])]
        .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 8),
    [assetData?.rows],
  );

  return (
    <main className="container">
      <section className="hero">
        <h1>Assets</h1>
        <p className="muted">
          Compare Yearn venues for the same underlying token, then inspect spread, momentum, and consistency in one place.
        </p>
      </section>

      <section className="card explain-card">
        <h2>Read Me First</h2>
        <p className="muted card-intro">
          APY spread = best APY minus worst APY for one token. Weighted APY gives more weight to high-TVL (larger) venues, so it
          reflects where most capital sits.
        </p>
        <p className="muted">Use this page to find large tokens where venue differences are meaningful, not just noise.</p>
      </section>

      {assetsError ? <section className="card">{assetsError}</section> : null}
      {detailError ? <section className="card">{detailError}</section> : null}

      <section className="card">
        <h2>Token Universe</h2>
        <p className="muted card-intro">Pick a token, then sort by spread, TVL, or weighted APY.</p>
        <div className="inline-controls">
          <label>
            Token:&nbsp;
            <select value={selectedSymbol} onChange={(event) => updateQuery({ token: event.target.value })}>
              {tokenRows.map((row) => (
                <option key={row.token_symbol} value={row.token_symbol}>
                  {row.token_symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            Universe:&nbsp;
            <select
              value={query.universe}
              onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null, min_points: null })}
            >
              {UNIVERSE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {universeLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Min TVL (USD):&nbsp;
            <input
              type="number"
              min={0}
              value={query.minTvl}
              onChange={(event) => updateQuery({ min_tvl: Number(event.target.value || 0) })}
            />
          </label>
          <label>
            Min Points:&nbsp;
            <input
              type="number"
              min={0}
              max={365}
              value={query.minPoints}
              onChange={(event) => updateQuery({ min_points: Number(event.target.value || 0) })}
            />
          </label>
          <label>
            Rows:&nbsp;
            <select value={query.limit} onChange={(event) => updateQuery({ limit: Number(event.target.value) })}>
              <option value={60}>60</option>
              <option value={120}>120</option>
              <option value={180}>180</option>
            </select>
          </label>
          <label>
            API Sort:&nbsp;
            <select value={query.apiSort} onChange={(event) => updateQuery({ api_sort: event.target.value })}>
              <option value="tvl">TVL</option>
              <option value="spread">APY Spread</option>
              <option value="best_apy">Best APY</option>
              <option value="venues">Venues</option>
            </select>
          </label>
          <label>
            API Dir:&nbsp;
            <select value={query.apiDir} onChange={(event) => updateQuery({ api_dir: event.target.value })}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>
        </div>
        <div className="split-grid">
          <KpiGrid
            items={[
              { label: "Tokens", value: String(assetData?.summary?.tokens ?? tokenRows.length) },
              { label: "Total TVL", value: formatUsd(assetData?.summary?.total_tvl_usd) },
              {
                label: "TVL-Weighted APY",
                value: formatPct(assetData?.summary?.tvl_weighted_safe_apy_30d),
              },
              {
                label: "Median Spread",
                value: formatPct(assetData?.summary?.median_spread_safe_apy_30d),
              },
              {
                label: "Multi-Chain Tokens",
                value: String(assetData?.summary?.multi_chain_tokens ?? "n/a"),
              },
              {
                label: "High Spread Tokens",
                value: String(assetData?.summary?.high_spread_tokens ?? "n/a"),
                hint: "Spread >= 2%",
              },
            ]}
          />
          <BarList
            title="Top Tokens by TVL"
            items={topTokenByTvl.map((row) => ({
              id: row.token_symbol,
              label: row.token_symbol,
              value: row.total_tvl_usd,
              note: `Spread ${formatPct(row.spread_safe_apy_30d)}`,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${tokenSort.key === "token" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "token");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Token <span className="th-indicator">{sortIndicator(tokenSort, "token")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "venues" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "venues");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Venues <span className="th-indicator">{sortIndicator(tokenSort, "venues")}</span>
                  </button>
                </th>
                <th className="is-numeric tablet-hide analyst-only">
                  <button
                    className={`th-button ${tokenSort.key === "chains" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "chains");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Chains <span className="th-indicator">{sortIndicator(tokenSort, "chains")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "tvl");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Total TVL <span className="th-indicator">{sortIndicator(tokenSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "best" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "best");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Best APY 30d <span className="th-indicator">{sortIndicator(tokenSort, "best")}</span>
                  </button>
                </th>
                <th className="is-numeric tablet-hide analyst-only">
                  <button
                    className={`th-button ${tokenSort.key === "weighted" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "weighted");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Weighted APY 30d <span className="th-indicator">{sortIndicator(tokenSort, "weighted")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "spread" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "spread");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    APY Spread <span className="th-indicator">{sortIndicator(tokenSort, "spread")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokenRows.map((row) => (
                <tr
                  key={row.token_symbol}
                  className={row.token_symbol === selectedSymbol ? "row-selected" : "row-clickable"}
                  onClick={() => updateQuery({ token: row.token_symbol })}
                >
                  <td>{row.token_symbol}</td>
                  <td className="is-numeric">{row.venues}</td>
                  <td className="is-numeric tablet-hide analyst-only">{row.chains}</td>
                  <td className="is-numeric">{formatUsd(row.total_tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.best_safe_apy_30d)}</td>
                  <td className="is-numeric tablet-hide analyst-only">{formatPct(row.weighted_safe_apy_30d)}</td>
                  <td className="is-numeric">{formatPct(row.spread_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>{detail?.token_symbol || selectedSymbol || "Token"} Venues</h2>
        <p className="muted card-intro">
          Venue-level detail for the selected token. Sort to compare alternatives quickly. Analyst mode adds extra context columns.
        </p>
        <div className="split-grid">
          <KpiGrid
            items={[
              { label: "Venues", value: String(detail?.summary.venues ?? "n/a") },
              { label: "Chains", value: String(detail?.summary.chains ?? "n/a") },
              { label: "Total TVL", value: formatUsd(detail?.summary.total_tvl_usd) },
              { label: "Best APY 30d", value: formatPct(detail?.summary.best_safe_apy_30d) },
              { label: "Median APY 30d", value: formatPct(detail?.summary.median_safe_apy_30d) },
              { label: "Weighted APY 30d", value: formatPct(detail?.summary.weighted_safe_apy_30d) },
              { label: "Median Momentum", value: formatPct(detail?.summary.median_momentum_7d_30d) },
              { label: "APY Spread", value: formatPct(detail?.summary.spread_safe_apy_30d) },
            ]}
          />
          <BarList
            title="Regime Count (Selected Token)"
            items={(detail?.summary.regime_counts ?? []).map((row) => ({
              id: row.regime,
              label: regimeLabel(row.regime),
              value: row.vaults,
            }))}
            valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
          />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${venueSort.key === "vault" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "vault");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Vault <span className="th-indicator">{sortIndicator(venueSort, "vault")}</span>
                  </button>
                </th>
                <th>
                  <button
                    className={`th-button ${venueSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "chain");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(venueSort, "chain")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only">
                  <button
                    className={`th-button ${venueSort.key === "category" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "category");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Category <span className="th-indicator">{sortIndicator(venueSort, "category")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only">
                  <button
                    className={`th-button ${venueSort.key === "version" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "version");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Version <span className="th-indicator">{sortIndicator(venueSort, "version")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${venueSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "tvl");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(venueSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${venueSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "apy");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    APY 30d <span className="th-indicator">{sortIndicator(venueSort, "apy")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${venueSort.key === "momentum" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "momentum");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Momentum <span className="th-indicator">{sortIndicator(venueSort, "momentum")}</span>
                  </button>
                </th>
                <th className="is-numeric tablet-hide analyst-only">
                  <button
                    className={`th-button ${venueSort.key === "consistency" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "consistency");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Consistency <span className="th-indicator">{sortIndicator(venueSort, "consistency")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only">
                  <button
                    className={`th-button ${venueSort.key === "regime" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(venueSort, "regime");
                      setVenueSort(next);
                      updateQuery({ venue_sort: next.key, venue_dir: next.direction });
                    }}
                  >
                    Regime <span className="th-indicator">{sortIndicator(venueSort, "regime")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {venueRows.map((row) => (
                <tr key={row.vault_address}>
                  <td title={row.vault_address}>
                    <Link
                      href={yearnVaultUrl(row.chain_id, row.vault_address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="vault-link"
                    >
                      {shortVaultLabel(row.symbol, row.vault_address)}
                    </Link>
                  </td>
                  <td>
                    <Link
                      href={`/discover?chain=${row.chain_id}&token=${encodeURIComponent(
                        detail?.token_symbol ?? selectedSymbol,
                      )}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="tablet-hide analyst-only">{row.category || "n/a"}</td>
                  <td className="tablet-hide analyst-only">{row.version || "n/a"}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric">{formatPct(row.momentum_7d_30d)}</td>
                  <td className="is-numeric tablet-hide analyst-only">{formatPct(row.consistency_score)}</td>
                  <td className="tablet-hide analyst-only">{regimeLabel(row.regime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <AssetsPageContent />
    </Suspense>
  );
}
