"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatHours, formatPct, formatUsd, regimeLabel, yearnVaultUrl } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, KpiGrid, ScatterPlot, TrendStrips } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

type WindowKey = "24h" | "7d" | "30d";
type StaleThresholdKey = "auto" | "24h" | "7d" | "30d";
type TrendGroupKey = "none" | "chain" | "category";

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
  reference_tvl?: {
    yearn_aligned_proxy?: {
      vaults?: number;
      tvl_usd?: number | null;
      criteria?: {
        active?: boolean;
        exclude_hidden?: boolean;
        exclude_retired?: boolean;
        kinds?: string[];
      };
      comparison_to_filtered_universe?: {
        filtered_total_tvl_usd?: number | null;
        gap_usd?: number | null;
        ratio?: number | null;
      };
    };
  };
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
type TvlView = "both" | "filtered" | "yearn";

type DailyTrendRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_apy_90d?: number | null;
  weighted_momentum_7d_30d?: number | null;
  riser_ratio?: number | null;
  faller_ratio?: number | null;
  bucket_high_ratio?: number | null;
};

type DailyTrendResponse = {
  rows?: DailyTrendRow[];
  grouped?: {
    group_by?: "none" | "chain" | "category";
    rows?: GroupedTrendRow[];
    latest?: GroupedTrendRow[];
    series?: Record<string, GroupedTrendRow[]>;
  };
};

type GroupedTrendRow = {
  day: string;
  group_key: string;
  vaults?: number;
  total_tvl_usd?: number | null;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_apy_90d?: number | null;
  weighted_momentum_7d_30d?: number | null;
};

function staleThresholdLabel(value: StaleThresholdKey): string {
  if (value === "auto") return "Auto (2× selected APY range)";
  return value;
}

function runningLabel(value: boolean | undefined): string {
  if (value === true) return "active";
  if (value === false) return "idle";
  return "n/a";
}

function confidenceBand(score: number): string {
  if (score >= 80) return "High";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Watch";
  return "Low";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
        Click columns to sort by signal, size, or data staleness. Dense mode adds token/category and previous-APY context columns.
      </p>
      <div className="table-wrap">
        <table className="changes-mover-table">
          <thead>
            <tr>
              <th className="col-vault">
                <button className={`th-button ${sort.key === "vault" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "vault"))}>
                  Vault <span className="th-indicator">{sortIndicator(sort, "vault")}</span>
                </button>
              </th>
              <th className="col-chain">
                <button className={`th-button ${sort.key === "chain" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "chain"))}>
                  Chain <span className="th-indicator">{sortIndicator(sort, "chain")}</span>
                </button>
              </th>
              <th className="tablet-hide analyst-only col-token">
                <button className={`th-button ${sort.key === "token" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "token"))}>
                  Token <span className="th-indicator">{sortIndicator(sort, "token")}</span>
                </button>
              </th>
              <th className="mobile-hide analyst-only col-category">
                <button
                  className={`th-button ${sort.key === "category" ? "is-active" : ""}`}
                  onClick={() => setSort((current) => toggleSort(current, "category"))}
                >
                  Category <span className="th-indicator">{sortIndicator(sort, "category")}</span>
                </button>
              </th>
              <th className="is-numeric col-tvl">
                <button className={`th-button ${sort.key === "tvl" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "tvl"))}>
                  TVL <span className="th-indicator">{sortIndicator(sort, "tvl")}</span>
                </button>
              </th>
              <th className="is-numeric col-current">
                <button
                  className={`th-button ${sort.key === "current" ? "is-active" : ""}`}
                  onClick={() => setSort((current) => toggleSort(current, "current"))}
                >
                  Current APY <span className="th-indicator">{sortIndicator(sort, "current")}</span>
                </button>
              </th>
              <th className="is-numeric mobile-hide analyst-only col-previous">
                <button
                  className={`th-button ${sort.key === "previous" ? "is-active" : ""}`}
                  onClick={() => setSort((current) => toggleSort(current, "previous"))}
                >
                  Previous APY <span className="th-indicator">{sortIndicator(sort, "previous")}</span>
                </button>
              </th>
              <th className="is-numeric col-delta">
                <button className={`th-button ${sort.key === "delta" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "delta"))}>
                  Delta <span className="th-indicator">{sortIndicator(sort, "delta")}</span>
                </button>
              </th>
              <th className="is-numeric col-age">
                <button className={`th-button ${sort.key === "age" ? "is-active" : ""}`} onClick={() => setSort((current) => toggleSort(current, "age"))}>
                  Data Age <span className="th-indicator">{sortIndicator(sort, "age")}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
              {sortedRows.map((row) => (
                <tr key={`${title}-${row.vault_address}`}>
                  <td className="col-vault"><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td className="col-chain">
                    <Link href={`/discover?chain=${row.chain_id}&universe=${universe}&min_tvl=${minTvl}&min_points=${minPoints}`}>
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="tablet-hide analyst-only col-token">
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
                <td className="mobile-hide analyst-only col-category">{row.category || "unknown"}</td>
                <td className="is-numeric col-tvl">{formatUsd(row.tvl_usd)}</td>
                <td className="is-numeric col-current">{formatPct(row.safe_apy_window)}</td>
                <td className="is-numeric mobile-hide analyst-only col-previous">{formatPct(row.safe_apy_prev_window)}</td>
                <td className="is-numeric col-delta">{formatPct(row.delta_apy)}</td>
                <td className="is-numeric col-age">{formatHours(row.age_seconds)}</td>
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
  const [trends, setTrends] = useState<DailyTrendRow[]>([]);
  const [chainTrendLatest, setChainTrendLatest] = useState<GroupedTrendRow[]>([]);
  const [categoryTrendLatest, setCategoryTrendLatest] = useState<GroupedTrendRow[]>([]);
  const [chainTrendSeries, setChainTrendSeries] = useState<Record<string, GroupedTrendRow[]>>({});
  const [categoryTrendSeries, setCategoryTrendSeries] = useState<Record<string, GroupedTrendRow[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [staleChainSort, setStaleChainSort] = useState<SortState<StaleChainSortKey>>({
    key: "stale_ratio",
    direction: "desc",
  });
  const [staleCategorySort, setStaleCategorySort] = useState<SortState<StaleCategorySortKey>>({
    key: "stale_ratio",
    direction: "desc",
  });
  const [regimeSort, setRegimeSort] = useState<SortState<RegimeSortKey>>({ key: "tvl", direction: "desc" });
  const [isCompactViewport, setIsCompactViewport] = useState(false);

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
      trendGroup: queryChoice<TrendGroupKey>(searchParams, "trend_group", ["none", "chain", "category"] as const, "none"),
      tvlView: queryChoice<TvlView>(searchParams, "tvl_view", ["both", "filtered", "yearn"] as const, "both"),
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

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

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
        const requests: Array<Promise<Response>> = [fetch(`/api/trends/daily?${globalParams.toString()}`, { cache: "no-store" })];
        const fetchChainGrouped = query.trendGroup === "chain";
        const fetchCategoryGrouped = query.trendGroup === "category";

        if (fetchChainGrouped) {
          const chainParams = new URLSearchParams(baseParams);
          chainParams.set("days", "90");
          chainParams.set("group_by", "chain");
          chainParams.set("group_limit", "10");
          requests.push(fetch(`/api/trends/daily?${chainParams.toString()}`, { cache: "no-store" }));
        }
        if (fetchCategoryGrouped) {
          const categoryParams = new URLSearchParams(baseParams);
          categoryParams.set("days", "90");
          categoryParams.set("group_by", "category");
          categoryParams.set("group_limit", "10");
          requests.push(fetch(`/api/trends/daily?${categoryParams.toString()}`, { cache: "no-store" }));
        }

        const responses = await Promise.all(requests);
        const firstFailure = responses.find((response) => !response.ok);
        if (firstFailure) {
          const status = firstFailure.status;
          if (active) setTrendError(`Trends API error: ${status}`);
          return;
        }

        const payloads = (await Promise.all(responses.map((response) => response.json()))) as DailyTrendResponse[];
        const globalPayload = payloads[0];
        const chainPayload = fetchChainGrouped ? payloads[1] : null;
        const categoryPayload = fetchCategoryGrouped ? payloads[fetchChainGrouped ? 2 : 1] : null;
        if (!active) return;
        setTrends(Array.isArray(globalPayload.rows) ? globalPayload.rows : []);
        const chainLatest = Array.isArray(chainPayload?.grouped?.latest) ? chainPayload.grouped.latest : [];
        const categoryLatest = Array.isArray(categoryPayload?.grouped?.latest) ? categoryPayload.grouped.latest : [];
        const chainSeries =
          query.trendGroup === "chain" && chainPayload?.grouped?.series && typeof chainPayload.grouped.series === "object"
            ? chainPayload.grouped.series
            : {};
        const categorySeries =
          query.trendGroup === "category" && categoryPayload?.grouped?.series && typeof categoryPayload.grouped.series === "object"
            ? categoryPayload.grouped.series
            : {};
        setChainTrendLatest(chainLatest.filter((row) => row.group_key && row.group_key !== "unknown"));
        setCategoryTrendLatest(categoryLatest.filter((row) => row.group_key && row.group_key !== "unknown"));
        setChainTrendSeries(chainSeries);
        setCategoryTrendSeries(categorySeries);
        setTrendError(null);
      } catch (err) {
        if (active) setTrendError(`Trends load failed: ${String(err)}`);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [query.universe, query.minTvl, query.minPoints, query.trendGroup]);

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
      .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, isCompactViewport ? 56 : 80);
  }, [data?.movers, isCompactViewport]);
  const staleChainHeat = useMemo(
    () =>
      [...(data?.freshness?.stale_by_chain ?? [])]
        .sort((left, right) => (right.stale_ratio ?? Number.NEGATIVE_INFINITY) - (left.stale_ratio ?? Number.NEGATIVE_INFINITY))
        .slice(0, isCompactViewport ? 8 : 12)
        .map((row) => ({
          id: String(row.chain_id),
          label: chainLabel(row.chain_id),
          value: row.stale_ratio,
          note: `${row.stale_vaults}/${row.vaults} stale • ${formatUsd(row.stale_tvl_usd ?? 0)}`,
        })),
    [data?.freshness?.stale_by_chain, isCompactViewport],
  );
  const staleCategoryHeat = useMemo(
    () =>
      [...(data?.freshness?.stale_by_category ?? [])]
        .sort((left, right) => (right.stale_ratio ?? Number.NEGATIVE_INFINITY) - (left.stale_ratio ?? Number.NEGATIVE_INFINITY))
        .slice(0, isCompactViewport ? 8 : 12)
        .map((row) => ({
          id: row.category || "unknown",
          label: row.category || "unknown",
          value: row.stale_ratio,
          note: `${row.stale_vaults}/${row.vaults} stale • ${formatUsd(row.stale_tvl_usd ?? 0)}`,
        })),
    [data?.freshness?.stale_by_category, isCompactViewport],
  );
  const deltaBandItems = useMemo(() => {
    const bands = [
      { id: "lt5", label: "≤ -5.0 percentage points", min: Number.NEGATIVE_INFINITY, max: -0.05 },
      { id: "lt1", label: "-5.0 to -1.0 percentage points", min: -0.05, max: -0.01 },
      { id: "mid", label: "-1.0 to +1.0 percentage points", min: -0.01, max: 0.01 },
      { id: "gt1", label: "+1.0 to +5.0 percentage points", min: 0.01, max: 0.05 },
      { id: "gt5", label: "≥ +5.0 percentage points", min: 0.05, max: Number.POSITIVE_INFINITY },
    ].map((band) => ({ ...band, count: 0, tvl: 0 }));
    for (const row of moverScatterRows) {
      if (row.delta_apy === null || row.delta_apy === undefined) continue;
      const band = bands.find((candidate) => row.delta_apy! >= candidate.min && row.delta_apy! < candidate.max);
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
  const summaryKpiItems = [
    { label: "Eligible Vaults", value: String(data?.summary.vaults_eligible ?? "n/a") },
    { label: "With Change Data", value: String(data?.summary.vaults_with_change ?? "n/a") },
    { label: "Stale Vaults", value: String(data?.summary.stale_vaults ?? "n/a") },
    ...(query.tvlView !== "yearn"
      ? [
          {
            label: "Total TVL (Filtered Universe)",
            value: formatUsd(data?.summary.total_tvl_usd),
            hint: "Sum of yDaemon vault TVL in current filters",
          },
          {
            label: "Tracked TVL (With Delta)",
            value: formatUsd(data?.summary.tracked_tvl_usd),
            hint: "Subset with both current and previous APY windows",
          },
        ]
      : []),
    ...(query.tvlView !== "filtered"
      ? [
          {
            label: "Yearn-Aligned TVL (Proxy)",
            value: formatUsd(data?.reference_tvl?.yearn_aligned_proxy?.tvl_usd),
            hint: "Active + non-hidden + non-retired + multi/single strategy kinds",
          },
          {
            label: "Yearn-Aligned Vaults",
            value: String(data?.reference_tvl?.yearn_aligned_proxy?.vaults ?? "n/a"),
          },
          {
            label: "Filtered vs Yearn Gap",
            value: formatUsd(data?.reference_tvl?.yearn_aligned_proxy?.comparison_to_filtered_universe?.gap_usd),
          },
          {
            label: "Filtered / Yearn Ratio",
            value: formatPct(data?.reference_tvl?.yearn_aligned_proxy?.comparison_to_filtered_universe?.ratio, 2),
          },
        ]
      : []),
    { label: "Average Delta", value: formatPct(data?.summary.avg_delta) },
  ];
  const trendSlice = useMemo(() => trends.slice(Math.max(0, trends.length - 60)), [trends]);
  const moverDriftTrendItems = useMemo(
    () => [
      {
        id: "riser-ratio",
        label: "Riser share (APY 7d > APY 30d)",
        points: trendSlice.map((row) => row.riser_ratio),
        note: "Share of eligible vaults with improving short-term APY",
      },
      {
        id: "faller-ratio",
        label: "Faller share (APY 7d < APY 30d)",
        points: trendSlice.map((row) => row.faller_ratio),
        note: "Share of eligible vaults with weakening short-term APY",
      },
      {
        id: "momentum",
        label: "Weighted momentum (7d minus 30d APY)",
        points: trendSlice.map((row) => row.weighted_momentum_7d_30d),
        note: "TVL-weighted momentum baseline used by the Changes page",
      },
      {
        id: "high-apy-share",
        label: "High APY share (15%+)",
        points: trendSlice.map((row) => row.bucket_high_ratio),
        note: "Share of vaults in the highest APY bucket",
      },
    ],
    [trendSlice],
  );
  const weightedApyTrendItems = useMemo(
    () => [
      {
        id: "apy7",
        label: "Weighted APY 7d",
        points: trendSlice.map((row) => row.weighted_apy_7d),
        note: "Latest-week annualized yield trend",
      },
      {
        id: "apy30",
        label: "Weighted APY 30d",
        points: trendSlice.map((row) => row.weighted_apy_30d),
        note: "Primary comparison baseline for delta changes",
      },
      {
        id: "apy90",
        label: "Weighted APY 90d",
        points: trendSlice.map((row) => row.weighted_apy_90d),
        note: "Longer-run annualized yield trend",
      },
    ],
    [trendSlice],
  );
  const groupedApyTrendItems = useMemo(() => {
    if (query.trendGroup === "none") return [];
    const latest = query.trendGroup === "chain" ? chainTrendLatest : categoryTrendLatest;
    const series = query.trendGroup === "chain" ? chainTrendSeries : categoryTrendSeries;
    const ranked = [...latest]
      .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, 6);
    return ranked.map((row) => {
      const key = row.group_key;
      const label = query.trendGroup === "chain" ? chainLabel(Number(key)) : key;
      return {
        id: `group-apy-${query.trendGroup}-${key}`,
        label,
        points: (series[key] ?? []).map((point) => point.weighted_apy_30d),
        note: `Latest APY 30d ${formatPct(row.weighted_apy_30d)} • TVL ${formatUsd(row.total_tvl_usd)}`,
      };
    });
  }, [query.trendGroup, chainTrendLatest, categoryTrendLatest, chainTrendSeries, categoryTrendSeries]);
  const chainMomentumHeat = useMemo(
    () =>
      chainTrendLatest
        .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, isCompactViewport ? 8 : 12)
        .map((row) => ({
          id: `chain-${row.group_key}`,
          label: chainLabel(Number(row.group_key)),
          value: row.weighted_momentum_7d_30d,
          note: `${formatUsd(row.total_tvl_usd)} • APY30 ${formatPct(row.weighted_apy_30d)}`,
        })),
    [chainTrendLatest, isCompactViewport],
  );
  const categoryMomentumHeat = useMemo(
    () =>
      categoryTrendLatest
        .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, isCompactViewport ? 8 : 12)
        .map((row) => ({
          id: `cat-${row.group_key}`,
          label: row.group_key,
          value: row.weighted_momentum_7d_30d,
          note: `${formatUsd(row.total_tvl_usd)} • APY30 ${formatPct(row.weighted_apy_30d)}`,
        })),
    [categoryTrendLatest, isCompactViewport],
  );
  const windowCoverage = useMemo(() => {
    const eligible = data?.summary.vaults_eligible ?? 0;
    const withChange = data?.summary.vaults_with_change ?? 0;
    if (eligible <= 0) return 0;
    return withChange / eligible;
  }, [data?.summary.vaults_eligible, data?.summary.vaults_with_change]);
  const freshnessPenalty = useMemo(() => {
    const stale = data?.freshness?.window_stale_ratio;
    const latestAgeHours = (data?.freshness?.latest_pps_age_seconds ?? 0) / 3600;
    const staleRatio = stale ?? data?.freshness?.pps_stale_ratio ?? 0;
    return Math.min(1, staleRatio * 1.25) * 45 + Math.min(24, latestAgeHours) * 1.25;
  }, [data?.freshness?.window_stale_ratio, data?.freshness?.pps_stale_ratio, data?.freshness?.latest_pps_age_seconds]);
  const windowConfidence = clampScore(windowCoverage * 70 + 30 - freshnessPenalty);
  const deltaConfidence = clampScore(
    Math.min(1, moverScatterRows.length / 40) * 60 + Math.min(1, windowCoverage) * 25 + 15 - Math.min(22, freshnessPenalty * 0.5),
  );
  const freshnessConfidence = clampScore(
    100 -
      Math.min(70, (data?.freshness?.window_stale_ratio ?? data?.freshness?.pps_stale_ratio ?? 0) * 130) -
      Math.min(20, ((data?.freshness?.latest_pps_age_seconds ?? 0) / 3600) * 1.5) -
      Math.min(10, ((data?.freshness?.metrics_newest_age_seconds ?? 0) / 3600) * 1.0),
  );

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
      {trendError ? <section className="card">{trendError}</section> : null}

      <section className="card">
        <h2>Window Summary</h2>
        <p className="muted card-intro">
          Choose the APY lookback range and stale cutoff. Stale means the latest PPS point is older than the selected cutoff.
        </p>
        <p className="muted confidence-line">
          Confidence: <strong>{windowConfidence}/100 ({confidenceBand(windowConfidence)})</strong> based on vault coverage and freshness.
        </p>
        <label>
          Range:&nbsp;
          <select value={query.window} onChange={(event) => updateQuery({ window: event.target.value as WindowKey })}>
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
          </select>
        </label>
        <div className="inline-controls controls-tight">
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
            TVL View:&nbsp;
            <select value={query.tvlView} onChange={(event) => updateQuery({ tvl_view: event.target.value as TvlView })}>
              <option value="both">Both (Filtered + Yearn Proxy)</option>
              <option value="filtered">Filtered Universe Only</option>
              <option value="yearn">Yearn-Aligned Proxy Only</option>
            </select>
          </label>
          <label>
            Trend View:&nbsp;
            <select value={query.trendGroup} onChange={(event) => updateQuery({ trend_group: event.target.value as TrendGroupKey })}>
              <option value="none">Global</option>
              <option value="chain">By Chain</option>
              <option value="category">By Category</option>
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
          <label className="field-compact">
            Min TVL (USD):&nbsp;
            <input
              type="number"
              min={0}
              value={query.minTvl}
              onChange={(event) => updateQuery({ min_tvl: Number(event.target.value || 0) })}
            />
          </label>
          <label className="field-compact">
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
        <KpiGrid items={summaryKpiItems} />
        <p className="muted">
          TVL View controls the scope shown above: dashboard-filtered totals from yDaemon, Yearn-aligned proxy scope, or both.
        </p>
      </section>

      <section className="card" id="freshness-panels">
        <h2>Trust Signals</h2>
        <p className="muted card-intro">
          These indicate whether the data stream is current enough for decision support. Current stale cutoff:{" "}
          {staleThresholdLabel(data?.filters?.stale_threshold ?? query.staleThreshold)}.
        </p>
        <p className="muted">
          Stale vault means its latest PPS data point is older than the selected cutoff. Stale ratio means stale vaults divided by
          tracked vaults. Job status <strong>idle</strong> is normal between scheduled runs; check Last Success age for actual
          health.
        </p>
        <p className="muted confidence-line">
          Confidence: <strong>{freshnessConfidence}/100 ({confidenceBand(freshnessConfidence)})</strong> for operational freshness.
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
            { label: "Kong Job Status", value: runningLabel(data?.freshness?.ingestion_jobs?.kong_pps_metrics?.running) },
            { label: "yDaemon Job Status", value: runningLabel(data?.freshness?.ingestion_jobs?.ydaemon_snapshot?.running) },
          ]}
        />
      </section>

      <section className="card changes-visuals-card">
        <h2>Delta Visuals and Freshness Heatmaps</h2>
        <p className="muted card-intro">
          Delta bands use percentage points (for example, +2.0 means APY rose by two points versus the previous window).
        </p>
        <p className="muted confidence-line">
          Confidence: <strong>{deltaConfidence}/100 ({confidenceBand(deltaConfidence)})</strong> from mover sample size + freshness.
        </p>
        <div className="changes-trend-grid">
          <TrendStrips
            title="Riser/Faller Drift (Last 60 Days)"
            items={moverDriftTrendItems}
            valueFormatter={(value) => formatPct(value, 1)}
            deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 1)}`}
            emptyText="Riser/faller drift unavailable for this filter."
          />
          <TrendStrips
            title={
              query.trendGroup === "none"
                ? "Weighted APY Trend (7d / 30d / 90d)"
                : `Weighted APY 30d Trend (${query.trendGroup === "chain" ? "By Chain" : "By Category"})`
            }
            items={query.trendGroup === "none" ? weightedApyTrendItems : groupedApyTrendItems}
            valueFormatter={(value) => formatPct(value, 2)}
            deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
            emptyText={
              query.trendGroup === "none"
                ? "Weighted APY trend unavailable for this filter."
                : "Grouped APY trend unavailable for this filter."
            }
          />
        </div>
        <p className="muted">
          Each strip is daily. Right-most value is latest, and the signed delta is day-over-day change for that metric.
        </p>
        <div className="changes-delta-layout">
          <div className="changes-delta-left">
            <ScatterPlot
              title="Delta vs Current APY (Top Movers)"
              xLabel="Delta (percentage points)"
              yLabel="Current APY (percent)"
              points={moverScatterRows.map((row) => ({
                id: `${row.chain_id}:${row.vault_address}`,
                x: row.delta_apy,
                y: row.safe_apy_window,
                size: row.tvl_usd,
                href: yearnVaultUrl(row.chain_id, row.vault_address),
                tooltip:
                  `${row.symbol || row.vault_address}\n${chainLabel(row.chain_id)}\n` +
                  `Current APY: ${formatPct(row.safe_apy_window)}\nPrevious APY: ${formatPct(row.safe_apy_prev_window)}\n` +
                  `Delta: ${formatPct(row.delta_apy)}\nTVL: ${formatUsd(row.tvl_usd)}`,
                tone: row.delta_apy !== null && row.delta_apy !== undefined ? (row.delta_apy >= 0 ? "positive" : "negative") : "neutral",
              }))}
              xFormatter={(value) => formatPct(value, 1)}
              yFormatter={(value) => formatPct(value, 1)}
              emptyText="No mover rows yet for this filter."
            />
            <HeatGrid title="Stale Ratio Heatmap by Chain" items={staleChainHeat} valueFormatter={(value) => formatPct(value)} />
          </div>
          <div className="stack changes-delta-side">
            <BarList
              title="Delta Distribution (Top Movers)"
              items={deltaBandItems}
              valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
            />
            <HeatGrid title="Stale Ratio Heatmap by Category" items={staleCategoryHeat} valueFormatter={(value) => formatPct(value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Grouped Momentum Snapshot (Latest Day)</h2>
        <p className="muted card-intro">
          TVL-weighted momentum by chain/category (7d APY minus 30d APY). Positive values indicate short-term strengthening.
        </p>
        <div className="changes-stale-grid">
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
