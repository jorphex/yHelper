"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, compactChainLabel, formatPct, formatUsd } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, replaceQuery } from "../lib/url";
import { PageTopPanel } from "../components/page-top-panel";
import { BarList, KpiGrid } from "../components/visuals";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { useChainsData } from "../hooks/use-chains-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type ChainRow = {
  chain_id: number;
  active_vaults: number;
  with_metrics: number;
  total_tvl_usd: number | null;
  weighted_apy_30d: number | null;
  avg_momentum_7d_30d: number | null;
  avg_consistency: number | null;
};

type ChainsResponse = {
  summary?: {
    chains?: number;
    total_tvl_usd?: number;
    active_vaults?: number;
    with_metrics?: number;
    metrics_coverage_ratio?: number | null;
    tvl_weighted_apy_30d?: number | null;
    median_chain_apy_30d?: number | null;
    tvl_hhi?: number | null;
    top_chain_id?: number | null;
    top_chain_tvl_share?: number | null;
  };
  rows: ChainRow[];
};

type ChainSortKey = "chain" | "active" | "metrics" | "tvl" | "apy" | "momentum" | "consistency";

function ChainsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [sort, setSort] = useState<SortState<ChainSortKey>>({ key: "tvl", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      sort: queryChoice<ChainSortKey>(
        searchParams,
        "sort",
        ["chain", "active", "metrics", "tvl", "apy", "momentum", "consistency"] as const,
        "tvl",
      ),
      dir: queryChoice(searchParams, "dir", ["asc", "desc"] as const, "desc"),
    };
  }, [searchParams]);

  // React Query data fetching
  const { data, isLoading, error } = useChainsData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  useEffect(() => {
    setSort({ key: query.sort, direction: query.dir });
  }, [query.sort, query.dir]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const rows = sortRows(data?.rows ?? [], sort, {
    chain: (row) => chainLabel(row.chain_id),
    active: (row) => row.active_vaults,
    metrics: (row) => row.with_metrics,
    tvl: (row) => row.total_tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.avg_momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    consistency: (row) => row.avg_consistency ?? Number.NEGATIVE_INFINITY,
  });
  const topByTvlRows = useMemo(
    () =>
      [...(data?.rows ?? [])]
        .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 8),
    [data?.rows],
  );

  if (error && !data) {
    return (
      <main className="container route-page">
        <section className="card section-card status-card status-card-error">
          <h2>Chain rollups are temporarily unavailable</h2>
          <p className="card-intro">The chain snapshot failed before any rollup rows loaded, so the route is holding back the KPI and table stack until the data feed recovers.</p>
          <p className="muted">Retry after the next ingestion cycle or reopen the route once the API is healthy again.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="container route-page">
      <section className="hero hero-chains">
        <p className="hero-kicker">Network lens</p>
        <h1>Chains</h1>
        <p className="muted">
          Compare chain scale, weighted yield, and coverage quality from the same filtered universe.
        </p>
      </section>

      <PageTopPanel
        introTitle="Readout Method"
        filtersTitle="Scope Controls"
        tone="chains"
        intro={
          <>
            <p className="muted card-intro">
              Weighted APY is TVL-weighted, so larger vaults carry more influence in each chain score.
            </p>
            <p className="muted">Use this page when the question is chain context, not individual vault rank.</p>
          </>
        }
        filtersIntro={<p className="muted card-intro">These controls live in the URL, so chain views stay shareable.</p>}
        filters={
          <div className="inline-controls controls-tight">
            <label>
              Universe:&nbsp;
              <select value={query.universe} onChange={(event) => updateQuery({ universe: event.target.value, min_tvl: null })}>
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
          </div>
        }
      />

      <section className="card section-card summary-card">
        <h2>Chain Universe Snapshot</h2>
        <p className="muted card-intro">At-a-glance totals for the current filter set.</p>
        {isLoading ? (
          <KpiGridSkeleton count={6} />
        ) : (
          <div className="split-grid chains-snapshot-layout">
            <div>
              <div className="chains-snapshot-kpis">
                <KpiGrid
                  items={[
                    { label: "Chains", value: String(data?.summary?.chains ?? "n/a") },
                    { label: "Active Vaults", value: String(data?.summary?.active_vaults ?? "n/a") },
                    { label: "With Metrics", value: String(data?.summary?.with_metrics ?? "n/a") },
                    { label: "Coverage Ratio", value: formatPct(data?.summary?.metrics_coverage_ratio) },
                    { label: "Median Chain APY", value: formatPct(data?.summary?.median_chain_apy_30d) },
                    {
                      label: "Top Chain Share",
                      value: formatPct(data?.summary?.top_chain_tvl_share),
                      hint:
                        data?.summary?.top_chain_id !== null && data?.summary?.top_chain_id !== undefined
                          ? chainLabel(data.summary.top_chain_id)
                          : undefined,
                    },
                  ]}
                />
              </div>
            </div>
            <BarList
              title="TVL by Chain"
              items={topByTvlRows.map((row) => ({
                id: String(row.chain_id),
                label: chainLabel(row.chain_id),
                value: row.total_tvl_usd,
                note: `APY ${formatPct(row.weighted_apy_30d)}`,
              }))}
              valueFormatter={(value) => formatUsd(value)}
            />
          </div>
        )}
        <p className="muted card-intro">Weighted metrics use TVL weights across the filtered vaults. Click any header to sort.</p>
        {isLoading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : (
          <div className="table-wrap chains-rollup-wrap">
            <table className="chains-rollup-table">
              <thead>
                <tr>
                  <th className="col-chain">
                    <button
                      className={`th-button ${sort.key === "chain" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "chain");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      Chain <span className="th-indicator">{sortIndicator(sort, "chain")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-active">
                    <button
                      className={`th-button ${sort.key === "active" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "active");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      Active Vaults <span className="th-indicator">{sortIndicator(sort, "active")}</span>
                    </button>
                  </th>
                  <th className="is-numeric tablet-hide analyst-only col-metrics">
                    <button
                      className={`th-button ${sort.key === "metrics" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "metrics");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      With Metrics <span className="th-indicator">{sortIndicator(sort, "metrics")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-tvl">
                    <button
                      className={`th-button ${sort.key === "tvl" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "tvl");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      Total TVL <span className="th-indicator">{sortIndicator(sort, "tvl")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-apy">
                    <button
                      className={`th-button ${sort.key === "apy" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "apy");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      Weighted APY 30d <span className="th-indicator">{sortIndicator(sort, "apy")}</span>
                    </button>
                  </th>
                  <th className="is-numeric col-momentum">
                    <button
                      className={`th-button ${sort.key === "momentum" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "momentum");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      Avg Momentum <span className="th-indicator">{sortIndicator(sort, "momentum")}</span>
                    </button>
                  </th>
                  <th className="is-numeric tablet-hide analyst-only col-consistency">
                    <button
                      className={`th-button ${sort.key === "consistency" ? "is-active" : ""}`}
                      onClick={() => {
                        const next = toggleSort(sort, "consistency");
                        setSort(next);
                        updateQuery({ sort: next.key, dir: next.direction });
                      }}
                    >
                      Avg Consistency <span className="th-indicator">{sortIndicator(sort, "consistency")}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.chain_id}>
                    <td className="col-chain" title={chainLabel(row.chain_id)}>
                      <Link href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                        {compactChainLabel(row.chain_id, isCompactViewport)}
                      </Link>
                    </td>
                    <td className="is-numeric col-active">{row.active_vaults}</td>
                    <td className="is-numeric tablet-hide analyst-only col-metrics">{row.with_metrics}</td>
                    <td className="is-numeric col-tvl">{formatUsd(row.total_tvl_usd)}</td>
                    <td className="is-numeric col-apy">{formatPct(row.weighted_apy_30d)}</td>
                    <td className="is-numeric col-momentum">{formatPct(row.avg_momentum_7d_30d)}</td>
                    <td className="is-numeric tablet-hide analyst-only col-consistency">{formatPct(row.avg_consistency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default function ChainsPage() {
  return (
    <Suspense fallback={<main className="container route-page"><section className="card">Loading…</section></main>}>
      <ChainsPageContent />
    </Suspense>
  );
}
