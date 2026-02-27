"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, regimeLabel } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryBool, queryChoice, queryFloat, queryInt, queryString, replaceQuery } from "../lib/url";
import { BarList, KpiGrid } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

type DiscoverRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  risk_level: string | null;
  is_retired: boolean;
  is_highlighted: boolean;
  migration_available: boolean;
  strategies_count: number;
  regime: string;
};

type DiscoverResponse = {
  pagination: { total: number; limit: number; offset: number };
  summary?: {
    vaults?: number;
    chains?: number;
    tokens?: number;
    categories?: number;
    total_tvl_usd?: number | null;
    avg_safe_apy_30d?: number | null;
    median_safe_apy_30d?: number | null;
    tvl_weighted_safe_apy_30d?: number | null;
    avg_momentum_7d_30d?: number | null;
    median_momentum_7d_30d?: number | null;
    avg_consistency_score?: number | null;
    avg_feature_score?: number | null;
    retired_vaults?: number;
    highlighted_vaults?: number;
    migration_ready_vaults?: number;
    avg_strategies_per_vault?: number | null;
    apy_negative_vaults?: number;
    apy_low_vaults?: number;
    apy_mid_vaults?: number;
    apy_high_vaults?: number;
  };
  regime_mix?: Array<{ regime: string; vaults: number; tvl_usd: number | null }>;
  risk_mix?: Array<{ risk_level: string; vaults: number; tvl_usd: number | null }>;
  rows: DiscoverRow[];
};

type DiscoverSortKey = "vault" | "chain" | "token" | "category" | "tvl" | "apy" | "momentum" | "consistency" | "risk" | "regime";
type DiscoverApiSort = "quality" | "tvl" | "apy_7d" | "apy_30d" | "momentum" | "consistency";

function riskLevelLabel(value: string | null | undefined): string {
  if (!value || value === "unknown") return "Unknown";
  if (value === "-1") return "Unrated";
  if (value === "0") return "0 (Lower)";
  if (value === "1") return "1";
  if (value === "2") return "2";
  if (value === "3") return "3";
  if (value === "4") return "4 (Higher)";
  return value;
}

function DiscoverPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<DiscoverSortKey>>({ key: "tvl", direction: "desc" });

  const query = useMemo(() => {
    const serverSort = queryChoice<DiscoverApiSort>(
      searchParams,
      "api_sort",
      ["quality", "tvl", "apy_7d", "apy_30d", "momentum", "consistency"] as const,
      "quality",
    );
    const serverDir = queryChoice(searchParams, "api_dir", ["asc", "desc"] as const, "desc");
    const uiSort = queryChoice<DiscoverSortKey>(
      searchParams,
      "sort",
      ["vault", "chain", "token", "category", "tvl", "apy", "momentum", "consistency", "risk", "regime"] as const,
      "tvl",
    );
    const uiDir = queryChoice(searchParams, "dir", ["asc", "desc"] as const, "desc");
    const chain = queryInt(searchParams, "chain", 0, { min: 0 });
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      limit: queryInt(searchParams, "limit", 60, { min: 10, max: 200 }),
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      chain: chain > 0 ? chain : null,
      category: queryString(searchParams, "category", ""),
      token: queryString(searchParams, "token", ""),
      includeRetired: queryBool(searchParams, "include_retired", false),
      migrationOnly: queryBool(searchParams, "migration_only", false),
      highlightedOnly: queryBool(searchParams, "highlighted_only", false),
      serverSort,
      serverDir,
      uiSort,
      uiDir,
    };
  }, [searchParams]);

  useEffect(() => {
    setSort({ key: query.uiSort, direction: query.uiDir });
  }, [query.uiSort, query.uiDir]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          limit: String(query.limit),
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          sort_by: query.serverSort,
          direction: query.serverDir,
        });
        if (query.chain) params.set("chain_id", String(query.chain));
        if (query.category) params.set("category", query.category);
        if (query.token) params.set("token_symbol", query.token);
        if (query.includeRetired) params.set("include_retired", "true");
        if (query.migrationOnly) params.set("migration_only", "true");
        if (query.highlightedOnly) params.set("highlighted_only", "true");
        const res = await fetch(`/api/discover?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as DiscoverResponse;
        if (active) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (active) setError(`Load failed: ${String(err)}`);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [query]);

  const rows = sortRows(data?.rows ?? [], sort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.consistency_score ?? Number.NEGATIVE_INFINITY,
    risk: (row) => {
      if (!row.risk_level || row.risk_level === "unknown") return Number.POSITIVE_INFINITY;
      const parsed = Number.parseInt(row.risk_level, 10);
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    },
    regime: (row) => row.regime,
  });

  const availableChains = useMemo(
    () => Array.from(new Set((data?.rows ?? []).map((row) => row.chain_id))).sort((a, b) => a - b),
    [data?.rows],
  );
  const availableCategories = useMemo(
    () => Array.from(new Set((data?.rows ?? []).map((row) => row.category).filter((value): value is string => Boolean(value)))).sort(),
    [data?.rows],
  );
  const availableTokens = useMemo(
    () =>
      Array.from(new Set((data?.rows ?? []).map((row) => row.token_symbol).filter((value): value is string => Boolean(value)))).sort(),
    [data?.rows],
  );

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const onSort = (key: DiscoverSortKey) => {
    const next = toggleSort(sort, key);
    setSort(next);
    updateQuery({ sort: next.key, dir: next.direction });
  };

  return (
    <main className="container">
      <section className="hero">
        <h1>Discover</h1>
        <p className="muted">
          Vault scanner for yield, trend, and stability. This view is filtered to reduce tiny-vault noise and includes summary
          context so noobs and power users can read the same table quickly.
        </p>
      </section>

      <section className="card explain-card">
        <h2>Read Me First</h2>
        <p className="muted card-intro">
          APY (annual percentage yield) here is an estimate from Price Per Share history, not a guaranteed forward rate. Momentum
          means 7-day APY minus 30-day APY. Positive momentum means yield has improved recently.
        </p>
        <p className="muted">
          Lifecycle flags come from yDaemon metadata: highlighted (promoted), migration-ready (new vault target exists), retired
          (legacy/being phased out).
        </p>
      </section>

      {error ? <section className="card">{error}</section> : null}

      <section className="card">
        <h2>Filters</h2>
        <p className="muted card-intro">All controls are encoded in the URL, so this exact view is shareable.</p>
        <div className="inline-controls">
          <label>
            Chain:&nbsp;
            <select
              value={query.chain ? String(query.chain) : ""}
              onChange={(event) => updateQuery({ chain: event.target.value || null })}
            >
              <option value="">All</option>
              {availableChains.map((chain) => (
                <option key={chain} value={chain}>
                  {chainLabel(chain)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category:&nbsp;
            <select
              value={query.category}
              onChange={(event) => updateQuery({ category: event.target.value || null })}
            >
              <option value="">All</option>
              {availableCategories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Token:&nbsp;
            <select value={query.token} onChange={(event) => updateQuery({ token: event.target.value || null })}>
              <option value="">All</option>
              {availableTokens.map((value) => (
                <option key={value} value={value}>
                  {value}
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
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={query.includeRetired}
              onChange={(event) => updateQuery({ include_retired: event.target.checked ? "true" : null })}
            />
            <span>Include retired</span>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={query.migrationOnly}
              onChange={(event) => updateQuery({ migration_only: event.target.checked ? "true" : null })}
            />
            <span>Migration ready only</span>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={query.highlightedOnly}
              onChange={(event) => updateQuery({ highlighted_only: event.target.checked ? "true" : null })}
            />
            <span>Highlighted only</span>
          </label>
          <label>
            Rows:&nbsp;
            <select value={query.limit} onChange={(event) => updateQuery({ limit: Number(event.target.value) })}>
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={100}>100</option>
              <option value={150}>150</option>
            </select>
          </label>
          <label>
            API Sort:&nbsp;
            <select value={query.serverSort} onChange={(event) => updateQuery({ api_sort: event.target.value })}>
              <option value="quality">Quality</option>
              <option value="tvl">TVL</option>
              <option value="apy_30d">APY 30d</option>
              <option value="momentum">Momentum</option>
              <option value="consistency">Consistency</option>
            </select>
          </label>
          <label>
            API Dir:&nbsp;
            <select value={query.serverDir} onChange={(event) => updateQuery({ api_dir: event.target.value })}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card split-grid">
        <div>
          <h2>Universe Snapshot</h2>
          <p className="muted card-intro">Current size and quality profile for the filtered vault universe.</p>
          <KpiGrid
            items={[
              { label: "Vaults", value: String(data?.summary?.vaults ?? data?.pagination.total ?? "n/a") },
              { label: "Chains", value: String(data?.summary?.chains ?? "n/a") },
              { label: "Tokens", value: String(data?.summary?.tokens ?? "n/a") },
              { label: "Total TVL", value: formatUsd(data?.summary?.total_tvl_usd) },
              { label: "TVL-Weighted APY", value: formatPct(data?.summary?.tvl_weighted_safe_apy_30d) },
              { label: "Median APY", value: formatPct(data?.summary?.median_safe_apy_30d) },
              { label: "Avg Momentum", value: formatPct(data?.summary?.avg_momentum_7d_30d) },
              { label: "Avg Consistency", value: formatPct(data?.summary?.avg_consistency_score) },
              {
                label: "Avg Strategies",
                value:
                  data?.summary?.avg_strategies_per_vault !== null && data?.summary?.avg_strategies_per_vault !== undefined
                    ? data.summary.avg_strategies_per_vault.toFixed(2)
                    : "n/a",
              },
              { label: "Migration Ready", value: String(data?.summary?.migration_ready_vaults ?? "n/a") },
              { label: "Highlighted", value: String(data?.summary?.highlighted_vaults ?? "n/a") },
              { label: "Retired in Scope", value: String(data?.summary?.retired_vaults ?? "n/a") },
            ]}
          />
        </div>
        <div className="stack">
          <BarList
            title="Regime TVL Mix"
            items={(data?.regime_mix ?? []).map((row) => ({
              id: row.regime,
              label: regimeLabel(row.regime),
              value: row.tvl_usd,
              note: `${row.vaults} vaults`,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
          <BarList
            title="APY Bucket Count"
            items={[
              { id: "neg", label: "Negative APY", value: data?.summary?.apy_negative_vaults ?? null },
              { id: "low", label: "0% to <5%", value: data?.summary?.apy_low_vaults ?? null },
              { id: "mid", label: "5% to <15%", value: data?.summary?.apy_mid_vaults ?? null },
              { id: "high", label: "15% and above", value: data?.summary?.apy_high_vaults ?? null },
            ]}
            valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
          />
          <BarList
            title="Risk Level Mix (TVL)"
            items={(data?.risk_mix ?? []).map((row) => ({
              id: String(row.risk_level),
              label: riskLevelLabel(row.risk_level),
              value: row.tvl_usd,
              note: `${row.vaults} vaults`,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
        </div>
      </section>

      <section className="card">
        <h2>Vault Universe</h2>
        <p className="muted card-intro">
          Filtered vaults with enough TVL and data history to reduce noisy outliers. Switch to Analyst mode for extra context columns. Rows:{" "}
          {data?.pagination.total ?? "loading..."}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className={`th-button ${sort.key === "vault" ? "is-active" : ""}`} onClick={() => onSort("vault")}>
                    Vault <span className="th-indicator">{sortIndicator(sort, "vault")}</span>
                  </button>
                </th>
                <th>
                  <button className={`th-button ${sort.key === "chain" ? "is-active" : ""}`} onClick={() => onSort("chain")}>
                    Chain <span className="th-indicator">{sortIndicator(sort, "chain")}</span>
                  </button>
                </th>
                <th>
                  <button className={`th-button ${sort.key === "token" ? "is-active" : ""}`} onClick={() => onSort("token")}>
                    Token <span className="th-indicator">{sortIndicator(sort, "token")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only">
                  <button className={`th-button ${sort.key === "category" ? "is-active" : ""}`} onClick={() => onSort("category")}>
                    Category <span className="th-indicator">{sortIndicator(sort, "category")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button className={`th-button ${sort.key === "tvl" ? "is-active" : ""}`} onClick={() => onSort("tvl")}>
                    TVL <span className="th-indicator">{sortIndicator(sort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button className={`th-button ${sort.key === "apy" ? "is-active" : ""}`} onClick={() => onSort("apy")}>
                    APY 30d <span className="th-indicator">{sortIndicator(sort, "apy")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${sort.key === "momentum" ? "is-active" : ""}`}
                    onClick={() => onSort("momentum")}
                  >
                    Momentum <span className="th-indicator">{sortIndicator(sort, "momentum")}</span>
                  </button>
                </th>
                <th className="is-numeric tablet-hide analyst-only">
                  <button
                    className={`th-button ${sort.key === "consistency" ? "is-active" : ""}`}
                    onClick={() => onSort("consistency")}
                  >
                    Consistency <span className="th-indicator">{sortIndicator(sort, "consistency")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only">
                  <button className={`th-button ${sort.key === "risk" ? "is-active" : ""}`} onClick={() => onSort("risk")}>
                    Risk <span className="th-indicator">{sortIndicator(sort, "risk")}</span>
                  </button>
                </th>
                <th className="tablet-hide analyst-only">
                  <button className={`th-button ${sort.key === "regime" ? "is-active" : ""}`} onClick={() => onSort("regime")}>
                    Regime <span className="th-indicator">{sortIndicator(sort, "regime")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.vault_address}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td>
                    <Link
                      href={`/regimes?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td>
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      >
                        {row.token_symbol}
                      </Link>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td className="tablet-hide analyst-only">{row.category || "n/a"}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric">{formatPct(row.momentum_7d_30d)}</td>
                  <td className="is-numeric tablet-hide analyst-only">{formatPct(row.consistency_score)}</td>
                  <td className="tablet-hide analyst-only">
                    {riskLevelLabel(row.risk_level)}
                    {row.strategies_count > 0 ? ` · ${row.strategies_count} strat` : ""}
                    {row.migration_available ? " · Migration" : ""}
                    {row.is_highlighted ? " · Highlighted" : ""}
                    {row.is_retired ? " · Retired" : ""}
                  </td>
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

export default function DiscoverPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <DiscoverPageContent />
    </Suspense>
  );
}
