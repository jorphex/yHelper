"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatHours, formatPct, formatUsd, regimeLabel } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, KpiGrid } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

type WindowKey = "24h" | "7d" | "30d";
type StaleThresholdKey = "auto" | "24h" | "7d" | "30d";

type Summary = {
  vaults_eligible: number;
  vaults_with_change: number;
  stale_vaults: number;
  total_tvl_usd: number | null;
  tracked_tvl_usd: number | null;
  avg_safe_apy_window: number | null;
  avg_safe_apy_prev_window: number | null;
  avg_delta: number | null;
};

type RegimeCount = {
  regime: string;
  vaults: number;
  tvl_usd: number | null;
};

type ChangeRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  safe_apy_window: number | null;
  safe_apy_prev_window: number | null;
  delta_apy: number | null;
  age_seconds: number | null;
};

type ChangesResponse = {
  filters?: {
    stale_threshold?: StaleThresholdKey;
    stale_threshold_seconds?: number;
  };
  summary: Summary;
  freshness?: {
    latest_pps_age_seconds?: number | null;
    pps_stale_ratio?: number | null;
    metrics_newest_age_seconds?: number | null;
    window_stale_ratio?: number | null;
    stale_by_chain?: Array<{
      chain_id: number;
      vaults: number;
      stale_vaults: number;
      stale_ratio: number | null;
      tvl_usd: number | null;
      stale_tvl_usd: number | null;
    }>;
    stale_by_category?: Array<{
      category: string;
      vaults: number;
      stale_vaults: number;
      stale_ratio: number | null;
      tvl_usd: number | null;
      stale_tvl_usd: number | null;
    }>;
    ingestion_jobs?: Record<
      string,
      {
        running?: boolean;
        last_success_age_seconds?: number | null;
      }
    >;
  } | null;
  regime_counts: RegimeCount[];
  movers: {
    risers: ChangeRow[];
    fallers: ChangeRow[];
    largest_abs_delta: ChangeRow[];
  };
  stale: ChangeRow[];
};

type MoverSortKey = "vault" | "chain" | "token" | "category" | "tvl" | "current" | "previous" | "delta" | "age";
type StaleChainSortKey = "chain" | "vaults" | "stale_vaults" | "stale_ratio" | "tvl" | "stale_tvl";
type StaleCategorySortKey = "category" | "vaults" | "stale_vaults" | "stale_ratio" | "tvl" | "stale_tvl";
type RegimeSortKey = "regime" | "vaults" | "tvl";

function staleThresholdLabel(value: StaleThresholdKey): string {
  if (value === "auto") return "Auto (2× selected APY range)";
  return value;
}

function MoverTable({
  title,
  rows,
  universe,
  minTvl,
  minPoints,
}: {
  title: string;
  rows: ChangeRow[];
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
}) {
  const [sort, setSort] = useState<SortState<MoverSortKey>>({
    key: title === "Stalest Series" ? "age" : "delta",
    direction: title === "Stalest Series" ? "desc" : "desc",
  });

  const sortedRows = sortRows(rows, sort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    current: (row) => row.safe_apy_window ?? Number.NEGATIVE_INFINITY,
    previous: (row) => row.safe_apy_prev_window ?? Number.NEGATIVE_INFINITY,
    delta: (row) => row.delta_apy ?? Number.NEGATIVE_INFINITY,
    age: (row) => row.age_seconds ?? Number.NEGATIVE_INFINITY,
  });

  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted card-intro">
        Click columns to sort by signal, size, or data staleness. Analyst mode adds token/category and previous-APY context columns.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <button className={`th-button ${sort.key === "vault" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "vault"))}>
                  Vault <span className="th-indicator">{sortIndicator(sort, "vault")}</span>
                </button>
              </th>
              <th>
                <button className={`th-button ${sort.key === "chain" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "chain"))}>
                  Chain <span className="th-indicator">{sortIndicator(sort, "chain")}</span>
                </button>
              </th>
              <th className="tablet-hide analyst-only">
                <button className={`th-button ${sort.key === "token" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "token"))}>
                  Token <span className="th-indicator">{sortIndicator(sort, "token")}</span>
                </button>
              </th>
              <th className="mobile-hide analyst-only">
                <button
                  className={`th-button ${sort.key === "category" ? "is-active" : ""}`}
                  onClick={() => setSort((current) => toggleSort(current, "category"))}
                >
                  Category <span className="th-indicator">{sortIndicator(sort, "category")}</span>
                </button>
              </th>
              <th className="is-numeric">
                <button className={`th-button ${sort.key === "tvl" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "tvl"))}>
                  TVL <span className="th-indicator">{sortIndicator(sort, "tvl")}</span>
                </button>
              </th>
              <th className="is-numeric">
                <button
                  className={`th-button ${sort.key === "current" ? "is-active" : ""}`}
                  onClick={() => setSort((current) => toggleSort(current, "current"))}
                >
                  Current APY <span className="th-indicator">{sortIndicator(sort, "current")}</span>
                </button>
              </th>
              <th className="is-numeric mobile-hide analyst-only">
                <button
                  className={`th-button ${sort.key === "previous" ? "is-active" : ""}`}
                  onClick={() => setSort((current) => toggleSort(current, "previous"))}
                >
                  Previous APY <span className="th-indicator">{sortIndicator(sort, "previous")}</span>
                </button>
              </th>
              <th className="is-numeric">
                <button className={`th-button ${sort.key === "delta" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "delta"))}>
                  Delta <span className="th-indicator">{sortIndicator(sort, "delta")}</span>
                </button>
              </th>
              <th className="is-numeric">
                <button className={`th-button ${sort.key === "age" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "age"))}>
                  Data Age <span className="th-indicator">{sortIndicator(sort, "age")}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
              {sortedRows.map((row) => (
                <tr key={`${title}-${row.vault_address}`}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td>
                    <Link href={`/discover?chain=${row.chain_id}&universe=${universe}&min_tvl=${minTvl}&min_points=${minPoints}`}>
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="tablet-hide analyst-only">
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${universe}&min_tvl=${minTvl}&min_points=${minPoints}`}
                      >
                        {row.token_symbol}
                      </Link>
                    ) : (
                      "unknown"
                    )}
                  </td>
                <td className="mobile-hide analyst-only">{row.category || "unknown"}</td>
                <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                <td className="is-numeric">{formatPct(row.safe_apy_window)}</td>
                <td className="is-numeric mobile-hide analyst-only">{formatPct(row.safe_apy_prev_window)}</td>
                <td className="is-numeric">{formatPct(row.delta_apy)}</td>
                <td className="is-numeric">{formatHours(row.age_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChangesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ChangesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleChainSort, setStaleChainSort] = useState<SortState<StaleChainSortKey>>({
    key: "stale_ratio",
    direction: "desc",
  });
  const [staleCategorySort, setStaleCategorySort] = useState<SortState<StaleCategorySortKey>>({
    key: "stale_ratio",
    direction: "desc",
  });
  const [regimeSort, setRegimeSort] = useState<SortState<RegimeSortKey>>({ key: "tvl", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      window: queryChoice<WindowKey>(searchParams, "window", ["24h", "7d", "30d"] as const, "7d"),
      staleThreshold: queryChoice<StaleThresholdKey>(
        searchParams,
        "stale_threshold",
        ["auto", "24h", "7d", "30d"] as const,
        "auto",
      ),
      limit: queryInt(searchParams, "limit", 20, { min: 5, max: 80 }),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      staleChainSort: queryChoice<StaleChainSortKey>(
        searchParams,
        "stale_chain_sort",
        ["chain", "vaults", "stale_vaults", "stale_ratio", "tvl", "stale_tvl"] as const,
        "stale_ratio",
      ),
      staleChainDir: queryChoice(searchParams, "stale_chain_dir", ["asc", "desc"] as const, "desc"),
      staleCategorySort: queryChoice<StaleCategorySortKey>(
        searchParams,
        "stale_category_sort",
        ["category", "vaults", "stale_vaults", "stale_ratio", "tvl", "stale_tvl"] as const,
        "stale_ratio",
      ),
      staleCategoryDir: queryChoice(searchParams, "stale_category_dir", ["asc", "desc"] as const, "desc"),
      regimeSort: queryChoice<RegimeSortKey>(searchParams, "regime_sort", ["regime", "vaults", "tvl"] as const, "tvl"),
      regimeDir: queryChoice(searchParams, "regime_dir", ["asc", "desc"] as const, "desc"),
    };
  }, [searchParams]);

  useEffect(() => {
    setStaleChainSort({ key: query.staleChainSort, direction: query.staleChainDir });
    setStaleCategorySort({ key: query.staleCategorySort, direction: query.staleCategoryDir });
    setRegimeSort({ key: query.regimeSort, direction: query.regimeDir });
  }, [
    query.staleChainSort,
    query.staleChainDir,
    query.staleCategorySort,
    query.staleCategoryDir,
    query.regimeSort,
    query.regimeDir,
  ]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          window: query.window,
          stale_threshold: query.staleThreshold,
          limit: String(query.limit),
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
        });
        const res = await fetch(`/api/changes?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as ChangesResponse;
        if (active) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (active) setError(`Load failed: ${String(err)}`);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [query.window, query.staleThreshold, query.limit, query.universe, query.minTvl, query.minPoints]);

  const staleByChain = sortRows(data?.freshness?.stale_by_chain ?? [], staleChainSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.vaults,
    stale_vaults: (row) => row.stale_vaults,
    stale_ratio: (row) => row.stale_ratio ?? Number.NEGATIVE_INFINITY,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    stale_tvl: (row) => row.stale_tvl_usd ?? Number.NEGATIVE_INFINITY,
  });

  const staleByCategory = sortRows(data?.freshness?.stale_by_category ?? [], staleCategorySort, {
    category: (row) => row.category,
    vaults: (row) => row.vaults,
    stale_vaults: (row) => row.stale_vaults,
    stale_ratio: (row) => row.stale_ratio ?? Number.NEGATIVE_INFINITY,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    stale_tvl: (row) => row.stale_tvl_usd ?? Number.NEGATIVE_INFINITY,
  });

  const regimeRows = sortRows(data?.regime_counts ?? [], regimeSort, {
    regime: (row) => row.regime,
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
  });

  return (
    <main className="container">
      <section className="hero">
        <h1>Changes</h1>
        <p className="muted">
          Compare APY shifts across consecutive windows (24h, 7d, 30d), with freshness diagnostics beside each signal.
        </p>
      </section>

      <section className="card explain-card">
        <h2>Read Me First</h2>
        <p className="muted card-intro">
          Delta = current window APY minus previous window APY. Positive delta means yield is strengthening; negative delta means it
          is weakening.
        </p>
        <p className="muted">
          Example: on 7d mode, current APY uses the latest 7 days, previous APY uses the 7 days before that.
        </p>
      </section>

      {error ? <section className="card">{error}</section> : null}

      <section className="card">
        <h2>Window Summary</h2>
        <p className="muted card-intro">
          Choose the APY lookback range and stale cutoff. Stale means the latest PPS point is older than the selected cutoff.
        </p>
        <label>
          Range:&nbsp;
          <select value={query.window} onChange={(event) => updateQuery({ window: event.target.value as WindowKey })}>
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
          </select>
        </label>
        <div className="inline-controls">
          <label>
            Stale Cutoff:&nbsp;
            <select
              value={query.staleThreshold}
              onChange={(event) => updateQuery({ stale_threshold: event.target.value as StaleThresholdKey })}
            >
              <option value="auto">Auto (2× APY range)</option>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
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
            Movers Limit:&nbsp;
            <select value={query.limit} onChange={(event) => updateQuery({ limit: Number(event.target.value) })}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
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
        </div>
        <KpiGrid
          items={[
            { label: "Eligible Vaults", value: String(data?.summary.vaults_eligible ?? "n/a") },
            { label: "With Change Data", value: String(data?.summary.vaults_with_change ?? "n/a") },
            { label: "Stale Vaults", value: String(data?.summary.stale_vaults ?? "n/a") },
            { label: "Total TVL", value: formatUsd(data?.summary.total_tvl_usd) },
            { label: "Tracked TVL", value: formatUsd(data?.summary.tracked_tvl_usd) },
            { label: "Average Delta", value: formatPct(data?.summary.avg_delta) },
          ]}
        />
      </section>

      <section className="card" id="freshness-panels">
        <h2>Trust Signals</h2>
        <p className="muted card-intro">
          These indicate whether the data stream is current enough for decision support. Current stale cutoff:{" "}
          {staleThresholdLabel(data?.filters?.stale_threshold ?? query.staleThreshold)}.
        </p>
        <KpiGrid
          items={[
            { label: "Latest PPS Age", value: formatHours(data?.freshness?.latest_pps_age_seconds) },
            { label: "Newest Metrics Age", value: formatHours(data?.freshness?.metrics_newest_age_seconds) },
            { label: "Global PPS Stale Ratio", value: formatPct(data?.freshness?.pps_stale_ratio) },
            { label: "Window Stale Ratio", value: formatPct(data?.freshness?.window_stale_ratio) },
            {
              label: "Kong Last Success",
              value: formatHours(data?.freshness?.ingestion_jobs?.kong_pps_metrics?.last_success_age_seconds),
            },
            {
              label: "yDaemon Last Success",
              value: formatHours(data?.freshness?.ingestion_jobs?.ydaemon_snapshot?.last_success_age_seconds),
            },
            { label: "Kong Running", value: data?.freshness?.ingestion_jobs?.kong_pps_metrics?.running ? "yes" : "no" },
            { label: "yDaemon Running", value: data?.freshness?.ingestion_jobs?.ydaemon_snapshot?.running ? "yes" : "no" },
          ]}
        />
      </section>

      <section className="card">
        <h2>Freshness by Chain</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${staleChainSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleChainSort, "chain");
                      setStaleChainSort(next);
                      updateQuery({ stale_chain_sort: next.key, stale_chain_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(staleChainSort, "chain")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleChainSort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleChainSort, "vaults");
                      setStaleChainSort(next);
                      updateQuery({ stale_chain_sort: next.key, stale_chain_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(staleChainSort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleChainSort.key === "stale_vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleChainSort, "stale_vaults");
                      setStaleChainSort(next);
                      updateQuery({ stale_chain_sort: next.key, stale_chain_dir: next.direction });
                    }}
                  >
                    Stale Vaults <span className="th-indicator">{sortIndicator(staleChainSort, "stale_vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleChainSort.key === "stale_ratio" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleChainSort, "stale_ratio");
                      setStaleChainSort(next);
                      updateQuery({ stale_chain_sort: next.key, stale_chain_dir: next.direction });
                    }}
                  >
                    Stale Ratio <span className="th-indicator">{sortIndicator(staleChainSort, "stale_ratio")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleChainSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleChainSort, "tvl");
                      setStaleChainSort(next);
                      updateQuery({ stale_chain_sort: next.key, stale_chain_dir: next.direction });
                    }}
                  >
                    Total TVL <span className="th-indicator">{sortIndicator(staleChainSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric tablet-hide analyst-only">
                  <button
                    className={`th-button ${staleChainSort.key === "stale_tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleChainSort, "stale_tvl");
                      setStaleChainSort(next);
                      updateQuery({ stale_chain_sort: next.key, stale_chain_dir: next.direction });
                    }}
                  >
                    Stale TVL <span className="th-indicator">{sortIndicator(staleChainSort, "stale_tvl")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {staleByChain.map((row) => (
                <tr key={`stale-chain-${row.chain_id}`}>
                  <td>{chainLabel(row.chain_id)}</td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{row.stale_vaults}</td>
                  <td className="is-numeric">{formatPct(row.stale_ratio)}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric tablet-hide analyst-only">{formatUsd(row.stale_tvl_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Freshness by Category</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${staleCategorySort.key === "category" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleCategorySort, "category");
                      setStaleCategorySort(next);
                      updateQuery({ stale_category_sort: next.key, stale_category_dir: next.direction });
                    }}
                  >
                    Category <span className="th-indicator">{sortIndicator(staleCategorySort, "category")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleCategorySort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleCategorySort, "vaults");
                      setStaleCategorySort(next);
                      updateQuery({ stale_category_sort: next.key, stale_category_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(staleCategorySort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleCategorySort.key === "stale_vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleCategorySort, "stale_vaults");
                      setStaleCategorySort(next);
                      updateQuery({ stale_category_sort: next.key, stale_category_dir: next.direction });
                    }}
                  >
                    Stale Vaults <span className="th-indicator">{sortIndicator(staleCategorySort, "stale_vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleCategorySort.key === "stale_ratio" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleCategorySort, "stale_ratio");
                      setStaleCategorySort(next);
                      updateQuery({ stale_category_sort: next.key, stale_category_dir: next.direction });
                    }}
                  >
                    Stale Ratio <span className="th-indicator">{sortIndicator(staleCategorySort, "stale_ratio")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${staleCategorySort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleCategorySort, "tvl");
                      setStaleCategorySort(next);
                      updateQuery({ stale_category_sort: next.key, stale_category_dir: next.direction });
                    }}
                  >
                    Total TVL <span className="th-indicator">{sortIndicator(staleCategorySort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric tablet-hide analyst-only">
                  <button
                    className={`th-button ${staleCategorySort.key === "stale_tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(staleCategorySort, "stale_tvl");
                      setStaleCategorySort(next);
                      updateQuery({ stale_category_sort: next.key, stale_category_dir: next.direction });
                    }}
                  >
                    Stale TVL <span className="th-indicator">{sortIndicator(staleCategorySort, "stale_tvl")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {staleByCategory.map((row) => (
                <tr key={`stale-cat-${row.category}`}>
                  <td>{row.category || "unknown"}</td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{row.stale_vaults}</td>
                  <td className="is-numeric">{formatPct(row.stale_ratio)}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric tablet-hide analyst-only">{formatUsd(row.stale_tvl_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Regime Mix</h2>
        <BarList
          title="Regime TVL Mix (Current Window)"
          items={regimeRows.map((row) => ({
            id: row.regime,
            label: regimeLabel(row.regime),
            value: row.tvl_usd,
            note: `${row.vaults} vaults`,
          }))}
          valueFormatter={(value) => formatUsd(value)}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${regimeSort.key === "regime" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(regimeSort, "regime");
                      setRegimeSort(next);
                      updateQuery({ regime_sort: next.key, regime_dir: next.direction });
                    }}
                  >
                    Regime <span className="th-indicator">{sortIndicator(regimeSort, "regime")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${regimeSort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(regimeSort, "vaults");
                      setRegimeSort(next);
                      updateQuery({ regime_sort: next.key, regime_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(regimeSort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${regimeSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(regimeSort, "tvl");
                      setRegimeSort(next);
                      updateQuery({ regime_sort: next.key, regime_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(regimeSort, "tvl")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {regimeRows.map((row) => (
                <tr key={row.regime}>
                  <td>
                    <Link href={`/regimes?universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}>
                      {regimeLabel(row.regime)}
                    </Link>
                  </td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <MoverTable
        title="Top Risers"
        rows={data?.movers.risers ?? []}
        universe={query.universe}
        minTvl={query.minTvl}
        minPoints={query.minPoints}
      />
      <MoverTable
        title="Top Fallers"
        rows={data?.movers.fallers ?? []}
        universe={query.universe}
        minTvl={query.minTvl}
        minPoints={query.minPoints}
      />
      <MoverTable
        title="Largest Absolute Changes"
        rows={data?.movers.largest_abs_delta ?? []}
        universe={query.universe}
        minTvl={query.minTvl}
        minPoints={query.minPoints}
      />
      <MoverTable
        title="Stalest Series"
        rows={data?.stale ?? []}
        universe={query.universe}
        minTvl={query.minTvl}
        minPoints={query.minPoints}
      />
    </main>
  );
}

export default function ChangesPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <ChangesPageContent />
    </Suspense>
  );
}
