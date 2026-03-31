"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../lib/api";
import { chainLabel, compactChainLabel, formatHours, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, ScatterPlot, ShareMeter, TrendStrips } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { useChangesData } from "../hooks/use-changes-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type WindowKey = "24h" | "7d" | "30d";
type TrendGroupKey = "none" | "chain" | "category";
type TvlViewKey = "filtered" | "reference";

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

type DailyTrendRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
  riser_ratio?: number | null;
  faller_ratio?: number | null;
  bucket_high_ratio?: number | null;
};

type GroupedTrendRow = {
  day: string;
  group_key: string;
  total_tvl_usd?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
};

type StaleByChain = {
  chain_id: number;
  vaults: number;
  stale_vaults: number;
  stale_ratio: number;
  tvl_usd: number | null;
  stale_tvl_usd: number | null;
};


type MoverSortKey = "vault" | "chain" | "tvl" | "current" | "previous" | "delta" | "age";
type StaleSortKey = "chain" | "vaults" | "stale" | "ratio" | "tvl" | "stale_tvl";

function MoverTable({
  title,
  rows,
  universe,
  minTvl,
  minPoints,
  compact,
}: {
  title: string;
  rows: ChangeRow[];
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  compact: boolean;
}) {
  const [sort, setSort] = useState<SortState<MoverSortKey>>({
    key: title === "Stalest Series" ? "age" : "delta",
    direction: title === "Stalest Series" ? "desc" : "desc",
  });

  const sortedRows = sortRows(rows, sort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    current: (row) => row.safe_apy_window ?? Number.NEGATIVE_INFINITY,
    previous: (row) => row.safe_apy_prev_window ?? Number.NEGATIVE_INFINITY,
    delta: (row) => row.delta_apy ?? Number.NEGATIVE_INFINITY,
    age: (row) => row.age_seconds ?? Number.NEGATIVE_INFINITY,
  });

  return (
    <section className="card" style={{ marginBottom: "24px" }}>
      <h2 className="card-title">{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "vault"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Vault {sortIndicator(sort, "vault")}
                </button>
              </th>
              <th>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Chain {sortIndicator(sort, "chain")}
                </button>
              </th>
              <th style={{ textAlign: "right" }}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  TVL {sortIndicator(sort, "tvl")}
                </button>
              </th>
              <th style={{ textAlign: "right" }}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "current"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Current {sortIndicator(sort, "current")}
                </button>
              </th>
              <th style={{ textAlign: "right" }}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "previous"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Previous {sortIndicator(sort, "previous")}
                </button>
              </th>
              <th style={{ textAlign: "right" }}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "delta"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Delta {sortIndicator(sort, "delta")}
                </button>
              </th>
              <th style={{ textAlign: "right" }}>
                <button className="th-button" onClick={() => setSort(toggleSort(sort, "age"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  Age {sortIndicator(sort, "age")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={`${title}-${row.vault_address}`}>
                <td>
                  <VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} />
                </td>
                <td>
                  <Link href={`/explore?chain=${row.chain_id}&universe=${universe}&min_tvl=${minTvl}&min_points=${minPoints}`}>
                    {compactChainLabel(row.chain_id, compact)}
                  </Link>
                </td>
                <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_window)}</td>
                <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_prev_window)}</td>
                <td style={{ textAlign: "right", color: (row.delta_apy ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }} className="data-value">
                  {formatPct(row.delta_apy)}
                </td>
                <td style={{ textAlign: "right" }} className="data-value">{formatHours(row.age_seconds)}</td>
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
  const [trends, setTrends] = useState<DailyTrendRow[]>([]);
  const [chainTrendLatest, setChainTrendLatest] = useState<GroupedTrendRow[]>([]);
  const [categoryTrendLatest, setCategoryTrendLatest] = useState<GroupedTrendRow[]>([]);
  const [chainTrendSeries, setChainTrendSeries] = useState<Record<string, GroupedTrendRow[]>>({});
  const [categoryTrendSeries, setCategoryTrendSeries] = useState<Record<string, GroupedTrendRow[]>>({});
  const [trendError, setTrendError] = useState<string | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [staleSort, setStaleSort] = useState<SortState<StaleSortKey>>({ key: "ratio", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      window: queryChoice<WindowKey>(searchParams, "window", ["24h", "7d", "30d"] as const, "7d"),
      trendGroup: queryChoice<TrendGroupKey>(searchParams, "trend_group", ["none", "chain", "category"] as const, "none"),
      tvlView: queryChoice<TvlViewKey>(searchParams, "tvl_view", ["filtered", "reference"] as const, "filtered"),
      limit: queryInt(searchParams, "limit", 20, { min: 5, max: 80 }),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
    };
  }, [searchParams]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const { data, isLoading, error, refetch } = useChangesData({
    universe: query.universe,
    minTvl: query.minTvl,
    window: query.window,
    staleThreshold: "auto",
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const baseParams = new URLSearchParams({
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
        });
        const globalParams = new URLSearchParams(baseParams);
        globalParams.set("days", "90");
        const chainParams = new URLSearchParams(baseParams);
        chainParams.set("days", "90");
        chainParams.set("group_by", "chain");
        chainParams.set("group_limit", "10");
        const categoryParams = new URLSearchParams(baseParams);
        categoryParams.set("days", "90");
        categoryParams.set("group_by", "category");
        categoryParams.set("group_limit", "10");
        
        const requests = [
          fetch(apiUrl("/trends/daily", globalParams), { cache: "no-store" }),
          fetch(apiUrl("/trends/daily", chainParams), { cache: "no-store" }),
          fetch(apiUrl("/trends/daily", categoryParams), { cache: "no-store" }),
        ];

        const responses = await Promise.all(requests);
        if (!active) return;
        
        const [globalRes, chainRes, categoryRes] = responses;
        if (!globalRes.ok || !chainRes.ok || !categoryRes.ok) {
          setTrendError("Trends API error");
          return;
        }
        
        const [globalPayload, chainPayload, categoryPayload] = await Promise.all([
          globalRes.json(),
          chainRes.json(),
          categoryRes.json(),
        ]);
        
        if (!active) return;
        setTrends(globalPayload.rows || []);
        setChainTrendLatest(chainPayload.grouped?.latest?.filter((r: GroupedTrendRow) => r.group_key && r.group_key !== "unknown") || []);
        setCategoryTrendLatest(categoryPayload.grouped?.latest?.filter((r: GroupedTrendRow) => r.group_key && r.group_key !== "unknown") || []);
        setChainTrendSeries(chainPayload.grouped?.series || {});
        setCategoryTrendSeries(categoryPayload.grouped?.series || {});
        setTrendError(null);
      } catch (err) {
        if (active) setTrendError(`Trends load failed: ${String(err)}`);
      }
    };
    void load();
    return () => { active = false; };
  }, [query.universe, query.minTvl, query.minPoints]);

  const moverScatterRows = useMemo(() => {
    const index = new Map<string, ChangeRow>();
    const allRows = [
      ...(data?.movers?.risers ?? []),
      ...(data?.movers?.fallers ?? []),
      ...(data?.movers?.largest_abs_delta ?? []),
    ];
    for (const row of allRows) {
      const key = `${row.chain_id}:${row.vault_address}`;
      const existing = index.get(key);
      if (!existing || (row.tvl_usd ?? 0) > (existing.tvl_usd ?? 0)) {
        index.set(key, row);
      }
    }
    return [...index.values()]
      .sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0))
      .slice(0, isCompactViewport ? 56 : 80);
  }, [data?.movers, isCompactViewport]);

  const deltaBandItems = useMemo(() => {
    const bands = [
      { id: "gt5", label: "≥ +5%", min: 0.05, max: Infinity },
      { id: "gt1", label: "+1% to +5%", min: 0.01, max: 0.05 },
      { id: "mid", label: "-1% to +1%", min: -0.01, max: 0.01 },
      { id: "lt1", label: "-5% to -1%", min: -0.05, max: -0.01 },
      { id: "lt5", label: "≤ -5%", min: -Infinity, max: -0.05 },
    ].map((band) => ({ ...band, count: 0, tvl: 0 }));
    
    for (const row of moverScatterRows) {
      if (row.delta_apy === null || row.delta_apy === undefined) continue;
      const band = bands.find((b) => row.delta_apy! >= b.min && row.delta_apy! < b.max);
      if (!band) continue;
      band.count += 1;
      band.tvl += row.tvl_usd ?? 0;
    }
    return bands.map((band) => ({
      id: band.id,
      label: band.label,
      value: band.count,
      note: `${formatUsd(band.tvl)} TVL`,
    }));
  }, [moverScatterRows]);

  const trendSlice = useMemo(() => trends.slice(Math.max(0, trends.length - 60)), [trends]);
  
  const moverDriftTrendItems = useMemo(
    () => [
      {
        id: "riser-ratio",
        label: "Riser share",
        points: trendSlice.map((row) => row.riser_ratio),
        note: "Vaults with improving short-term APY",
      },
      {
        id: "faller-ratio",
        label: "Faller share",
        points: trendSlice.map((row) => row.faller_ratio),
        note: "Vaults with weakening short-term APY",
      },
      {
        id: "momentum",
        label: "Weighted momentum",
        points: trendSlice.map((row) => row.weighted_momentum_7d_30d),
        note: "TVL-weighted momentum baseline",
      },
    ],
    [trendSlice],
  );

  const weightedApyTrendItems = useMemo(
    () => [
      {
        id: "apy7",
        label: "APY 7d",
        points: trendSlice.map((row) => row.weighted_apy_7d),
        note: "Latest-week annualized yield",
      },
      {
        id: "apy30",
        label: "APY 30d",
        points: trendSlice.map((row) => row.weighted_apy_30d),
        note: "Primary comparison baseline",
      },
    ],
    [trendSlice],
  );

  const groupedApyTrendItems = useMemo(() => {
    if (query.trendGroup === "none") return [];
    const latest = query.trendGroup === "chain" ? chainTrendLatest : categoryTrendLatest;
    const series = query.trendGroup === "chain" ? chainTrendSeries : categoryTrendSeries;
    return latest
      .sort((a, b) => (b.total_tvl_usd ?? 0) - (a.total_tvl_usd ?? 0))
      .slice(0, 6)
      .map((row) => ({
        id: `group-${query.trendGroup}-${row.group_key}`,
        label: query.trendGroup === "chain" ? chainLabel(Number(row.group_key)) : row.group_key,
        points: (series[row.group_key] ?? []).map((p) => p.weighted_apy_30d),
        note: `APY ${formatPct(row.weighted_apy_30d)} • TVL ${formatUsd(row.total_tvl_usd)}`,
      }));
  }, [query.trendGroup, chainTrendLatest, categoryTrendLatest, chainTrendSeries, categoryTrendSeries]);

  const chainMomentumHeat = useMemo(
    () =>
      chainTrendLatest
        .sort((a, b) => (b.total_tvl_usd ?? 0) - (a.total_tvl_usd ?? 0))
        .slice(0, isCompactViewport ? 8 : 12)
        .map((row) => ({
          id: `chain-${row.group_key}`,
          label: chainLabel(Number(row.group_key)),
          value: row.weighted_momentum_7d_30d,
          note: `${formatUsd(row.total_tvl_usd)} • APY ${formatPct(row.weighted_apy_30d)}`,
        })),
    [chainTrendLatest, isCompactViewport],
  );

  const categoryMomentumHeat = useMemo(
    () =>
      categoryTrendLatest
        .sort((a, b) => (b.total_tvl_usd ?? 0) - (a.total_tvl_usd ?? 0))
        .slice(0, isCompactViewport ? 8 : 12)
        .map((row) => ({
          id: `cat-${row.group_key}`,
          label: row.group_key,
          value: row.weighted_momentum_7d_30d,
          note: `${formatUsd(row.total_tvl_usd)} • APY ${formatPct(row.weighted_apy_30d)}`,
        })),
    [categoryTrendLatest, isCompactViewport],
  );

  // Grouped momentum snapshot for latest day
  const groupedMomentumSnapshot = useMemo(() => {
    if (query.trendGroup === "none") return { chain: [], category: [] };
    const latest = query.trendGroup === "chain" ? chainTrendLatest : categoryTrendLatest;
    return {
      chain: query.trendGroup === "chain" ? latest : [],
      category: query.trendGroup === "category" ? latest : [],
    };
  }, [query.trendGroup, chainTrendLatest, categoryTrendLatest]);

  // Stale data calculations
  const staleByChain = data?.freshness?.stale_by_chain ?? [];
  const staleByCategory = data?.freshness?.stale_by_category ?? [];

  const staleChainRows = sortRows(staleByChain, staleSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.vaults,
    stale: (row) => row.stale_vaults,
    ratio: (row) => row.stale_ratio,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    stale_tvl: (row) => row.stale_tvl_usd ?? Number.NEGATIVE_INFINITY,
  });

  // Stale ratio heatmaps
  const staleChainHeatItems = useMemo(() => {
    return staleByChain
      .sort((a, b) => b.stale_ratio - a.stale_ratio)
      .slice(0, 10)
      .map((row) => ({
        id: `stale-chain-${row.chain_id}`,
        label: chainLabel(row.chain_id),
        value: row.stale_ratio,
        note: `${row.stale_vaults}/${row.vaults} vaults • ${formatUsd(row.tvl_usd)} TVL`,
      }));
  }, [staleByChain]);

  const staleCategoryHeatItems = useMemo(() => {
    return staleByCategory
      .sort((a, b) => b.stale_ratio - a.stale_ratio)
      .slice(0, 10)
      .map((row) => ({
        id: `stale-cat-${row.category}`,
        label: row.category,
        value: row.stale_ratio,
        note: `${row.stale_vaults}/${row.vaults} vaults • ${formatUsd(row.tvl_usd)} TVL`,
      }));
  }, [staleByCategory]);

  if (error && !data) {
    return (
      <div className="card" style={{ padding: "48px" }}>
        <h2>Changes data is temporarily unavailable</h2>
        <p>The change feed failed to load. Please try again later.</p>
        <button onClick={() => refetch()} className="button button-primary" style={{ marginTop: "16px" }}>
          Retry
        </button>
      </div>
    );
  }

  const summary = data?.summary;
  const eligibleVaults = summary?.vaults_eligible ?? 0;
  const comparedVaults = data?.freshness?.window_tracked_vaults ?? summary?.vaults_with_change ?? 0;
  const staleVaults = data?.freshness?.window_stale_vaults ?? summary?.stale_vaults ?? 0;
  const freshComparedVaults = Math.max(0, comparedVaults - staleVaults);
  const missingWindowVaults = Math.max(0, eligibleVaults - comparedVaults);

  // Yearn-aligned reference data
  const yearnAligned = data?.reference_tvl?.yearn_aligned_proxy;
  const filteredTvl = summary?.total_tvl_usd;
  const trackedTvl = summary?.tracked_tvl_usd;
  const yearnTvl = yearnAligned?.tvl_usd;
  const yearnVaults = yearnAligned?.vaults;
  const gap = yearnAligned?.comparison_to_filtered_universe?.gap_usd;
  const ratio = yearnAligned?.comparison_to_filtered_universe?.ratio;

  const vaultCoverageSegments = [
    {
      id: "fresh-window",
      label: "Fresh window",
      value: freshComparedVaults,
      note: eligibleVaults > 0 ? `${formatPct(freshComparedVaults / eligibleVaults, 0)} of eligible` : "Waiting...",
      tone: "positive" as const,
    },
    {
      id: "stale-window",
      label: "Stale window",
      value: staleVaults,
      note: eligibleVaults > 0 ? `${formatPct(staleVaults / eligibleVaults, 0)} beyond cutoff` : "...",
      tone: "warning" as const,
    },
    {
      id: "missing-window",
      label: "Missing window",
      value: missingWindowVaults,
      note: eligibleVaults > 0 ? `${formatPct(missingWindowVaults / eligibleVaults, 0)} no delta` : "...",
      tone: "muted" as const,
    },
  ];

  const tvlCoverageSegments = [
    {
      id: "fresh-tvl",
      label: "Fresh TVL",
      value: trackedTvl ?? 0,
      note: filteredTvl && trackedTvl ? `${formatPct(trackedTvl / filteredTvl, 0)} of filtered` : "...",
      tone: "positive" as const,
    },
    {
      id: "stale-tvl",
      label: "Stale TVL",
      value: (filteredTvl ?? 0) - (trackedTvl ?? 0),
      note: filteredTvl ? `${formatPct(((filteredTvl ?? 0) - (trackedTvl ?? 0)) / filteredTvl, 0)} beyond cutoff` : "...",
      tone: "warning" as const,
    },
  ];

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Changes
          <br />
          <em className="page-title-accent">Recent shifts</em>
        </h1>
        <p className="page-description">
          Track APY changes with freshness metrics and trend direction.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Window</span>
              <select
                value={query.window}
                onChange={(e) => updateQuery({ window: e.target.value as WindowKey })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value, min_tvl: null, min_points: null })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                {UNIVERSE_VALUES.map((v) => (
                  <option key={v} value={v}>{universeLabel(v)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min TVL</span>
              <input
                type="number"
                value={query.minTvl}
                onChange={(e) => updateQuery({ min_tvl: Number(e.target.value) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Trend View</span>
              <select
                value={query.trendGroup}
                onChange={(e) => updateQuery({ trend_group: e.target.value as TrendGroupKey })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="none">Global</option>
                <option value="chain">By Chain</option>
                <option value="category">By Category</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>TVL View</span>
              <select
                value={query.tvlView}
                onChange={(e) => updateQuery({ tvl_view: e.target.value as TvlViewKey })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="filtered">Filtered Universe</option>
                <option value="reference">Yearn Aligned</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Window Summary KPI Block */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Window Summary</h2>
        </div>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {Array(4).fill(null).map((_, i) => (
              <KpiGridSkeleton key={i} count={1} />
            ))}
          </div>
        ) : (
          <>
            {query.tvlView === "filtered" ? (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div className="kpi-card">
                  <div className="kpi-label">Filtered Universe TVL</div>
                  <div className="kpi-value">{formatUsd(filteredTvl)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Tracked TVL</div>
                  <div className="kpi-value">{formatUsd(trackedTvl)}</div>
                  <div className="kpi-hint">With delta available</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Eligible Vaults</div>
                  <div className="kpi-value">{summary?.vaults_eligible ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">With Change</div>
                  <div className="kpi-value">{summary?.vaults_with_change ?? "n/a"}</div>
                </div>
              </div>
            ) : (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div className="kpi-card">
                  <div className="kpi-label">Yearn-Aligned TVL</div>
                  <div className="kpi-value">{formatUsd(yearnTvl)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Yearn-Aligned Vaults</div>
                  <div className="kpi-value">{yearnVaults ?? "n/a"}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Filtered vs Yearn Gap</div>
                  <div className="kpi-value">{formatUsd(gap)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Filtered/Yearn Ratio</div>
                  <div className="kpi-value">{ratio ? ratio.toFixed(2) : "n/a"}</div>
                </div>
              </div>
            )}
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: "16px" }}>
              <div className="kpi-card">
                <div className="kpi-label">Avg Delta</div>
                <div className="kpi-value" style={{ color: (summary?.avg_delta ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {formatPct(summary?.avg_delta)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Fresh PPS Age</div>
                <div className="kpi-value">{formatHours(data?.freshness?.latest_pps_age_seconds)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Newest Metrics Age</div>
                <div className="kpi-value">{formatHours(data?.freshness?.metrics_newest_age_seconds)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Window Stale Ratio</div>
                <div className="kpi-value">{formatPct(data?.freshness?.window_stale_ratio)}</div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Coverage by Vaults and TVL */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Window Coverage</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <ShareMeter
            title="By Vaults"
            segments={vaultCoverageSegments}
            total={eligibleVaults}
            valueFormatter={(value) => (value === null || value === undefined ? "n/a" : Number(value).toLocaleString())}
            legend="Eligible vaults split by comparison freshness"
          />
          <ShareMeter
            title="By TVL"
            segments={tvlCoverageSegments}
            total={filteredTvl ?? 0}
            valueFormatter={(value) => formatUsd(value)}
            legend="Filtered TVL split by freshness"
          />
        </div>
      </section>

      {/* Stale-ratio heatmaps */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Stale Ratio Heatmaps</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <HeatGrid
            title="By Chain"
            items={staleChainHeatItems}
            valueFormatter={(value) => formatPct(value, 1)}
            legend="Stale vault ratio by chain"
          />
          <HeatGrid
            title="By Category"
            items={staleCategoryHeatItems}
            valueFormatter={(value) => formatPct(value, 1)}
            legend="Stale vault ratio by category"
          />
        </div>
      </section>

      {/* Grouped Momentum Snapshot (Latest Day) */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Grouped Momentum Snapshot (Latest Day)</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            TVL-weighted momentum by chain/category (7d APY minus 30d APY). Positive values indicate short-term strengthening.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <HeatGrid
            title="By Chain"
            items={chainMomentumHeat}
            valueFormatter={(value) => formatPct(value, 1)}
            legend="Cells are sorted by latest TVL. Notes show TVL and weighted APY 30d for context."
          />
          <HeatGrid
            title="By Category"
            items={categoryMomentumHeat}
            valueFormatter={(value) => formatPct(value, 1)}
            legend="Use this to compare category momentum drift independent of single-vault outliers."
          />
        </div>
      </section>

      {/* Freshness by Chain Table */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Freshness by Chain</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(staleSort, "chain")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "vaults"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(staleSort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "stale"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Stale {sortIndicator(staleSort, "stale")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "ratio"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Stale % {sortIndicator(staleSort, "ratio")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(staleSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "stale_tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Stale TVL {sortIndicator(staleSort, "stale_tvl")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={6} />
              ) : staleChainRows.map((row) => (
                <tr key={`stale-chain-${row.chain_id}`}>
                  <td>{chainLabel(row.chain_id)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.stale_vaults}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.stale_ratio)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.stale_tvl_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Movers */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Movers</h2>
        </div>
        
        {isLoading ? (
          <>
            <TableSkeleton rows={6} columns={7} />
            <TableSkeleton rows={6} columns={7} />
          </>
        ) : (
          <>
            <MoverTable
              title="Top Risers"
              rows={data?.movers?.risers ?? []}
              universe={query.universe}
              minTvl={query.minTvl}
              minPoints={query.minPoints}
              compact={isCompactViewport}
            />
            <MoverTable
              title="Top Fallers"
              rows={data?.movers?.fallers ?? []}
              universe={query.universe}
              minTvl={query.minTvl}
              minPoints={query.minPoints}
              compact={isCompactViewport}
            />
            <MoverTable
              title="Largest Absolute Changes"
              rows={data?.movers?.largest_abs_delta ?? []}
              universe={query.universe}
              minTvl={query.minTvl}
              minPoints={query.minPoints}
              compact={isCompactViewport}
            />
            <MoverTable
              title="Stalest Series"
              rows={data?.stale ?? []}
              universe={query.universe}
              minTvl={query.minTvl}
              minPoints={query.minPoints}
              compact={isCompactViewport}
            />
          </>
        )}
      </section>

      {/* Visualizations */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Trend Analysis</h2>
        </div>
        
        {trendError ? <div className="card" style={{ padding: "24px", marginBottom: "24px" }}>{trendError}</div> : null}
        
        <div style={{ display: "grid", gap: "24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <TrendStrips
              title="Riser/Faller Drift (60 Days)"
              items={moverDriftTrendItems}
              valueFormatter={(value) => formatPct(value, 1)}
              deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 1)}`}
              emptyText="Trend data unavailable"
            />
            <TrendStrips
              title={query.trendGroup === "none" ? "APY Trend" : `APY by ${query.trendGroup === "chain" ? "Chain" : "Category"}`}
              items={query.trendGroup === "none" ? weightedApyTrendItems : groupedApyTrendItems}
              valueFormatter={(value) => formatPct(value, 2)}
              deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
              emptyText="Trend data unavailable"
            />
          </div>
          
          <ScatterPlot
            title="Delta vs Current APY"
            xLabel="Delta"
            yLabel="Current APY"
            points={moverScatterRows.map((row) => ({
              id: `${row.chain_id}:${row.vault_address}`,
              x: row.delta_apy,
              y: row.safe_apy_window,
              size: row.tvl_usd,
              href: yearnVaultUrl(row.chain_id, row.vault_address),
              tone: (row.delta_apy ?? 0) >= 0 ? "positive" : "negative",
            }))}
            xFormatter={(value) => formatPct(value, 1)}
            yFormatter={(value) => formatPct(value, 1)}
          />
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <BarList
              title="Delta Distribution"
              items={deltaBandItems}
              valueFormatter={(value) => String(value ?? 0)}
            />
            <HeatGrid
              title="Momentum by Category"
              items={categoryMomentumHeat}
              valueFormatter={(value) => formatPct(value, 1)}
              legend="Compare category momentum drift"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function ChangesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <ChangesPageContent />
    </Suspense>
  );
}
