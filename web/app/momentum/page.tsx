"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, regimeLabel } from "../lib/format";
import { useChangesData, useTrendDailyData } from "../hooks/use-changes-data";
import { useRegimesData, useTransitionsData, useTransitionsDailyData } from "../hooks/use-regimes-data";
import { sortRows, type SortState } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { universeDefaults, UNIVERSE_VALUES } from "../lib/universe";
import { ChangesTab } from "./changes-tab";
import { RegimesTab } from "./regimes-tab";
import {
  REGIME_ORDER,
  type ChangeRow,
  type DailyTrendRow,
  type GroupedTrendRow,
  type MomentumQuery,
  type RegimeMoverSortKey,
  type RegimeSummarySortKey,
  type SplitSnapshotSortKey,
  type StaleSortKey,
  type StaleByChain,
  type TransitionDailyGrouped,
  type TransitionDailyRow,
} from "./types";

function MomentumPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<MomentumQuery["tab"]>("changes");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [staleSort, setStaleSort] = useState<SortState<StaleSortKey>>({ key: "ratio", direction: "desc" });
  const [summarySort, setSummarySort] = useState<SortState<RegimeSummarySortKey>>({ key: "vaults", direction: "desc" });
  const [regimeMoverSort, setRegimeMoverSort] = useState<SortState<RegimeMoverSortKey>>({ key: "momentum", direction: "desc" });
  const [splitSnapshotSort, setSplitSnapshotSort] = useState<SortState<SplitSnapshotSortKey>>({ key: "churn", direction: "desc" });

  const query = useMemo<MomentumQuery>(() => {
    const universe = queryChoice(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      window: queryChoice(searchParams, "window", ["24h", "7d", "30d"] as const, "7d"),
      trendGroup: queryChoice(searchParams, "trend_group", ["none", "chain", "category"] as const, "none"),
      tvlView: queryChoice(searchParams, "tvl_view", ["filtered", "reference"] as const, "filtered"),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      tab: (searchParams.get("tab") || "changes") as MomentumQuery["tab"],
      limit: queryInt(searchParams, "limit", 30, { min: 5, max: 300 }),
      chain: queryInt(searchParams, "chain", 0, { min: 0 }),
      transitionSplit: queryChoice(searchParams, "transition_split", ["none", "chain", "category"] as const, "none"),
      transitionDays: queryChoice(searchParams, "transition_days", ["60", "120", "180", "365"] as const, "120"),
      transitionMinCohortTvl: queryFloat(searchParams, "transition_min_cohort_tvl", 1000000, { min: 0 }),
    };
  }, [searchParams]);

  useEffect(() => {
    if (query.tab === "changes" || query.tab === "regimes") {
      setActiveTab(query.tab);
    }
  }, [query.tab]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const { data: changesData, isLoading: changesLoading, error: changesError, refetch: refetchChanges } = useChangesData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    window: query.window,
    staleThreshold: "auto",
  });
  const { data: trendGlobalData, error: trendGlobalError } = useTrendDailyData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    days: 90,
    enabled: activeTab === "changes",
  });
  const { data: trendChainData, error: trendChainError } = useTrendDailyData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    days: 90,
    groupBy: "chain",
    groupLimit: 10,
    enabled: activeTab === "changes",
  });
  const { data: trendCategoryData, error: trendCategoryError } = useTrendDailyData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    days: 90,
    groupBy: "category",
    groupLimit: 10,
    enabled: activeTab === "changes",
  });
  const { data: regimeData, error: regimeDataError, isLoading: regimeLoading } = useRegimesData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: query.limit,
    chainId: query.chain > 0 ? query.chain : null,
    enabled: activeTab === "regimes",
  });
  const { data: transitionData, error: transitionError } = useTransitionsData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    limit: Math.min(query.limit, 30),
    chainId: query.chain > 0 ? query.chain : null,
    enabled: activeTab === "regimes",
  });
  const { data: transitionsDailyData, error: transitionsDailyError } = useTransitionsDailyData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: query.minPoints,
    chainId: query.chain > 0 ? query.chain : null,
    days: Number(query.transitionDays),
    groupBy: query.transitionSplit,
    groupLimit: 8,
    enabled: activeTab === "regimes",
  });

  const trends = useMemo<DailyTrendRow[]>(() => trendGlobalData?.rows ?? [], [trendGlobalData?.rows]);
  const chainTrendLatest = useMemo<GroupedTrendRow[]>(
    () => (trendChainData?.grouped?.latest ?? []).filter((row) => row.group_key && row.group_key !== "unknown"),
    [trendChainData?.grouped?.latest],
  );
  const categoryTrendLatest = useMemo<GroupedTrendRow[]>(
    () => (trendCategoryData?.grouped?.latest ?? []).filter((row) => row.group_key && row.group_key !== "unknown"),
    [trendCategoryData?.grouped?.latest],
  );
  const chainTrendSeries = useMemo<Record<string, GroupedTrendRow[]>>(() => trendChainData?.grouped?.series ?? {}, [trendChainData?.grouped?.series]);
  const categoryTrendSeries = useMemo<Record<string, GroupedTrendRow[]>>(() => trendCategoryData?.grouped?.series ?? {}, [trendCategoryData?.grouped?.series]);
  const trendError = trendGlobalError || trendChainError || trendCategoryError ? "Trend data is temporarily unavailable." : null;

  const transitionDaily = useMemo<TransitionDailyRow[]>(
    () => (Array.isArray(transitionsDailyData?.rows) ? transitionsDailyData.rows : []),
    [transitionsDailyData?.rows],
  );
  const transitionDailyGrouped = (transitionsDailyData?.grouped ?? null) as TransitionDailyGrouped | null;
  const regimeError = regimeDataError || transitionError || transitionsDailyError ? "Regime data is temporarily unavailable." : null;

  const summary = changesData?.summary;
  const eligibleVaults = summary?.vaults_eligible ?? 0;
  const comparedVaults = changesData?.freshness?.window_tracked_vaults ?? summary?.vaults_with_change ?? 0;
  const staleVaults = changesData?.freshness?.window_stale_vaults ?? summary?.stale_vaults ?? 0;
  const freshComparedVaults = Math.max(0, comparedVaults - staleVaults);
  const missingWindowVaults = Math.max(0, eligibleVaults - comparedVaults);

  const yearnAligned = changesData?.reference_tvl?.yearn_aligned_proxy;
  const filteredTvl = summary?.total_tvl_usd;
  const trackedTvl = summary?.tracked_tvl_usd;
  const staleTrackedTvl = summary?.stale_tracked_tvl_usd ?? 0;
  const freshTrackedTvl = Math.max(0, (trackedTvl ?? 0) - staleTrackedTvl);
  const missingWindowTvl = Math.max(0, (filteredTvl ?? 0) - (trackedTvl ?? 0));
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
      value: freshTrackedTvl,
      note: filteredTvl ? `${formatPct(freshTrackedTvl / filteredTvl, 0)} of filtered` : "...",
      tone: "positive" as const,
    },
    {
      id: "stale-tvl",
      label: "Stale TVL",
      value: staleTrackedTvl,
      note: filteredTvl ? `${formatPct(staleTrackedTvl / filteredTvl, 0)} beyond cutoff` : "...",
      tone: "warning" as const,
    },
    {
      id: "missing-tvl",
      label: "Missing TVL",
      value: missingWindowTvl,
      note: filteredTvl ? `${formatPct(missingWindowTvl / filteredTvl, 0)} no delta` : "...",
      tone: "muted" as const,
    },
  ];

  const moverScatterRows = useMemo(() => {
    const index = new Map<string, ChangeRow>();
    const allRows = [
      ...(changesData?.movers?.risers ?? []),
      ...(changesData?.movers?.fallers ?? []),
      ...(changesData?.movers?.largest_abs_delta ?? []),
    ];
    for (const row of allRows) {
      const key = `${row.chain_id}:${row.vault_address}`;
      const existing = index.get(key);
      if (!existing || (row.tvl_usd ?? 0) > (existing.tvl_usd ?? 0)) {
        index.set(key, row);
      }
    }
    return [...index.values()].sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0)).slice(0, isCompactViewport ? 56 : 80);
  }, [changesData?.movers, isCompactViewport]);

  const deltaBandItems = useMemo(() => {
    const bands = [
      { id: "gt5", label: ">= +5%", min: 0.05, max: Infinity },
      { id: "gt1", label: "+1% to +5%", min: 0.01, max: 0.05 },
      { id: "mid", label: "-1% to +1%", min: -0.01, max: 0.01 },
      { id: "lt1", label: "-5% to -1%", min: -0.05, max: -0.01 },
      { id: "lt5", label: "<= -5%", min: -Infinity, max: -0.05 },
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

  const trendSlice = useMemo(() => trends.slice(Math.max(0, trends.length - 60)), [trends]);
  const moverDriftTrendItems = useMemo(
    () => [
      {
        id: "riser-ratio",
        label: "Riser share",
        points: trendSlice.map((row) => row.riser_ratio),
        note: "Vaults with improving short-term realized APY",
      },
      {
        id: "faller-ratio",
        label: "Faller share",
        points: trendSlice.map((row) => row.faller_ratio),
        note: "Vaults with weakening short-term realized APY",
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
        label: "Realized APY 7d",
        points: trendSlice.map((row) => row.weighted_apy_7d),
        note: "Latest-week realized annualized yield",
      },
      {
        id: "apy30",
        label: "Realized APY 30d",
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
        points: (series[row.group_key] ?? []).map((point) => point.weighted_apy_30d),
        note: `Realized APY 30d ${formatPct(row.weighted_apy_30d)} • TVL ${formatUsd(row.total_tvl_usd)}`,
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
          note: `${formatUsd(row.total_tvl_usd)} • Realized APY 30d ${formatPct(row.weighted_apy_30d)}`,
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
          note: `${formatUsd(row.total_tvl_usd)} • Realized APY 30d ${formatPct(row.weighted_apy_30d)}`,
        })),
    [categoryTrendLatest, isCompactViewport],
  );

  const staleByChain = useMemo<StaleByChain[]>(() => changesData?.freshness?.stale_by_chain ?? [], [changesData?.freshness?.stale_by_chain]);
  const staleByCategory = useMemo(() => changesData?.freshness?.stale_by_category ?? [], [changesData?.freshness?.stale_by_category]);
  const staleChainRows = sortRows(staleByChain, staleSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.vaults,
    stale: (row) => row.stale_vaults,
    ratio: (row) => row.stale_ratio,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    stale_tvl: (row) => row.stale_tvl_usd ?? Number.NEGATIVE_INFINITY,
  });
  const staleChainHeatItems = useMemo(
    () =>
      staleByChain
        .sort((a, b) => b.stale_ratio - a.stale_ratio)
        .slice(0, 10)
        .map((row) => ({
          id: `stale-chain-${row.chain_id}`,
          label: chainLabel(row.chain_id),
          value: row.stale_ratio,
          note: `${row.stale_vaults}/${row.vaults} vaults • ${formatUsd(row.tvl_usd)} TVL`,
        })),
    [staleByChain],
  );
  const staleCategoryHeatItems = useMemo(
    () =>
      staleByCategory
        .sort((a, b) => b.stale_ratio - a.stale_ratio)
        .slice(0, 10)
        .map((row) => ({
          id: `stale-cat-${row.category}`,
          label: row.category,
          value: row.stale_ratio,
          note: `${row.stale_vaults}/${row.vaults} vaults • ${formatUsd(row.tvl_usd)} TVL`,
        })),
    [staleByCategory],
  );

  const availableChains = useMemo(() => Array.from(new Set((regimeData?.movers ?? []).map((row) => row.chain_id))).sort((a, b) => a - b), [regimeData?.movers]);
  const summaryRows = sortRows(regimeData?.summary ?? [], summarySort, {
    regime: (row) => row.regime,
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd,
  });
  const regimeMoverRows = sortRows(regimeData?.movers ?? [], regimeMoverSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.realized_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    regime: (row) => row.regime,
  });
  const regimes = useMemo(() => {
    const byRegime = new Map((regimeData?.summary ?? []).map((row) => [row.regime, row]));
    return REGIME_ORDER.map((regime) => byRegime.get(regime) ?? { regime, vaults: 0, tvl_usd: 0 });
  }, [regimeData?.summary]);
  const dominantRegime = useMemo(
    () =>
      [...(regimeData?.summary ?? [])]
        .filter((row) => row.vaults > 0)
        .sort(
          (left, right) =>
            (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY)
            || right.vaults - left.vaults,
        )[0]?.regime ?? "n/a",
    [regimeData?.summary],
  );
  const totalRegimeTvl = useMemo(() => regimes.reduce((sum, row) => sum + (row.tvl_usd ?? 0), 0), [regimes]);

  const transitionHeat = useMemo(
    () =>
      (transitionData?.matrix ?? [])
        .slice()
        .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 16)
        .map((row) => ({
          id: `${row.previous_regime}->${row.current_regime}`,
          label: `${regimeLabel(row.previous_regime)} -> ${regimeLabel(row.current_regime)}`,
          value: row.tvl_usd,
          note: `${row.vaults} vaults • current momentum ${formatPct(row.avg_current_momentum)}`,
        })),
    [transitionData?.matrix],
  );
  const transitionTrendItems = useMemo(
    () => [
      {
        id: "changed-ratio",
        label: "Regime change ratio",
        points: transitionDaily.map((row) => row.changed_ratio),
        note: "Share of tracked vaults where current and previous regime differ.",
      },
      {
        id: "changed-tvl-ratio",
        label: "Regime churn TVL ratio",
        points: transitionDaily.map((row) => row.changed_tvl_ratio),
        note: "Share of TVL sitting in vaults that switched regime state.",
      },
      {
        id: "momentum-spread",
        label: "Momentum spread (current minus previous)",
        points: transitionDaily.map((row) => row.momentum_spread),
        note: "Positive means short-term regime pressure is strengthening vs prior baseline.",
      },
    ],
    [transitionDaily],
  );

  const groupedTransitionTrendItems = useMemo(() => {
    const series = transitionDailyGrouped?.series ?? {};
    const latest = transitionDailyGrouped?.latest ?? [];
    return [...latest]
      .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
      .sort((left, right) => (right.tvl_total_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_total_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, 6)
      .map((row) => ({
        id: `transition-group-${row.group_key}`,
        label: transitionDailyGrouped?.group_by === "chain" ? chainLabel(Number(row.group_key)) : row.group_key,
        points: (series[row.group_key] ?? []).map((point) => point.changed_ratio),
        note: `Latest churn ${formatPct(row.changed_ratio)} • TVL ${formatUsd(row.tvl_total_usd)}`,
      }));
  }, [transitionDailyGrouped, query.transitionMinCohortTvl]);

  const groupedDriftItems = useMemo(() => {
    const series = transitionDailyGrouped?.series ?? {};
    const groupType = transitionDailyGrouped?.group_by;
    const latestMap = new Map((transitionDailyGrouped?.latest ?? []).map((row) => [row.group_key, row]));
    return Object.entries(series)
      .map(([key, points]) => {
        const latestRow = latestMap.get(key);
        if (!latestRow || (latestRow.tvl_total_usd ?? 0) < query.transitionMinCohortTvl) return null;
        const latest = points[points.length - 1]?.changed_ratio;
        const previous = points.length > 1 ? points[points.length - 2]?.changed_ratio : null;
        if (latest === null || latest === undefined) return null;
        const delta = previous === null || previous === undefined ? 0 : latest - previous;
        return {
          id: `drift-${key}`,
          label: groupType === "chain" ? chainLabel(Number(key)) : key,
          value: delta,
          note: `Latest churn ${formatPct(latest)} • TVL ${formatUsd(points[points.length - 1]?.tvl_total_usd)}`,
        };
      })
      .filter((item): item is { id: string; label: string; value: number; note: string } => item !== null)
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
      .slice(0, 8);
  }, [transitionDailyGrouped, query.transitionMinCohortTvl]);

  const groupedLatestChurnHeat = useMemo(
    () =>
      [...(transitionDailyGrouped?.latest ?? [])]
        .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
        .sort((left, right) => (right.tvl_total_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_total_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 12)
        .map((row) => ({
          id: `latest-churn-${row.group_key}`,
          label: transitionDailyGrouped?.group_by === "chain" ? chainLabel(Number(row.group_key)) : row.group_key,
          value: row.changed_tvl_ratio,
          note: `Churn ${formatPct(row.changed_ratio)} • TVL ${formatUsd(row.tvl_total_usd)}`,
        })),
    [transitionDailyGrouped, query.transitionMinCohortTvl],
  );
  const groupedLatestChurnBars = useMemo(
    () =>
      [...(transitionDailyGrouped?.latest ?? [])]
        .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
        .sort((left, right) => (right.changed_ratio ?? Number.NEGATIVE_INFINITY) - (left.changed_ratio ?? Number.NEGATIVE_INFINITY))
        .slice(0, 10)
        .map((row) => ({
          id: `latest-churn-bar-${row.group_key}`,
          label: transitionDailyGrouped?.group_by === "chain" ? chainLabel(Number(row.group_key)) : row.group_key,
          value: row.changed_ratio,
          note: `TVL ${formatUsd(row.tvl_total_usd)} • Churn TVL ${formatPct(row.changed_tvl_ratio)}`,
        })),
    [transitionDailyGrouped, query.transitionMinCohortTvl],
  );
  const splitSnapshotRows = useMemo(() => {
    const latest = transitionDailyGrouped?.latest ?? [];
    const groupType = transitionDailyGrouped?.group_by;
    const normalized = latest
      .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
      .map((row) => ({
        group_key: row.group_key,
        cohort_label: groupType === "chain" ? chainLabel(Number(row.group_key)) : row.group_key,
        changed_ratio: row.changed_ratio ?? null,
        changed_tvl_ratio: row.changed_tvl_ratio ?? null,
        momentum_spread: row.momentum_spread ?? null,
        tvl_total_usd: row.tvl_total_usd ?? null,
      }));
    return sortRows(normalized, splitSnapshotSort, {
      cohort: (row) => row.cohort_label,
      churn: (row) => row.changed_ratio ?? Number.NEGATIVE_INFINITY,
      churn_tvl: (row) => row.changed_tvl_ratio ?? Number.NEGATIVE_INFINITY,
      momentum: (row) => row.momentum_spread ?? Number.NEGATIVE_INFINITY,
      tvl: (row) => row.tvl_total_usd ?? Number.NEGATIVE_INFINITY,
    });
  }, [transitionDailyGrouped, splitSnapshotSort, query.transitionMinCohortTvl]);

  if (changesError && !changesData) {
    return (
      <div className="card" style={{ padding: "48px" }}>
        <h2>Changes data is temporarily unavailable</h2>
        <p>The change feed failed to load. Please try again later.</p>
        <button onClick={() => refetchChanges()} className="button button-primary" style={{ marginTop: "16px" }}>
          Retry
        </button>
      </div>
    );
  }

  const setTab = (tab: MomentumQuery["tab"]) => {
    setActiveTab(tab);
    updateQuery({ tab });
  };

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Momentum
          <br />
          <em className="page-title-accent">Recent shifts</em>
        </h1>
        <p className="page-description">
          Track realized APY changes and regime transitions to time allocation decisions.
        </p>
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "16px" }}>
          <button onClick={() => setTab("changes")} className={`button ${activeTab === "changes" ? "button-primary" : "button-ghost"}`}>
            Changes
          </button>
          <button onClick={() => setTab("regimes")} className={`button ${activeTab === "regimes" ? "button-primary" : "button-ghost"}`}>
            Regimes
          </button>
        </div>
      </section>

      {activeTab === "changes" && (
        <ChangesTab
          query={query}
          updateQuery={updateQuery}
          changesLoading={changesLoading}
          summary={summary}
          freshness={changesData?.freshness}
          filteredTvl={filteredTvl}
          trackedTvl={trackedTvl}
          yearnTvl={yearnTvl}
          yearnVaults={yearnVaults}
          gap={gap}
          ratio={ratio}
          vaultCoverageSegments={vaultCoverageSegments}
          tvlCoverageSegments={tvlCoverageSegments}
          staleChainHeatItems={staleChainHeatItems}
          staleCategoryHeatItems={staleCategoryHeatItems}
          chainMomentumHeat={chainMomentumHeat}
          categoryMomentumHeat={categoryMomentumHeat}
          staleSort={staleSort}
          setStaleSort={setStaleSort}
          staleChainRows={staleChainRows}
          moverRisers={changesData?.movers?.risers ?? []}
          moverFallers={changesData?.movers?.fallers ?? []}
          moverLargestAbsDelta={changesData?.movers?.largest_abs_delta ?? []}
          moverStale={changesData?.stale ?? []}
          isCompactViewport={isCompactViewport}
          trendError={trendError}
          moverDriftTrendItems={moverDriftTrendItems}
          weightedApyTrendItems={weightedApyTrendItems}
          groupedApyTrendItems={groupedApyTrendItems}
          moverScatterRows={moverScatterRows}
          deltaBandItems={deltaBandItems}
        />
      )}

      {activeTab === "regimes" && (
        <RegimesTab
          query={query}
          updateQuery={updateQuery}
          availableChains={availableChains}
          regimeLoading={regimeLoading}
          summaryRows={summaryRows}
          dominantRegime={dominantRegime}
          regimes={regimes}
          totalRegimeTvl={totalRegimeTvl}
          summarySort={summarySort}
          setSummarySort={setSummarySort}
          regimeMoverRows={regimeMoverRows}
          regimeMoverSort={regimeMoverSort}
          setRegimeMoverSort={setRegimeMoverSort}
          isCompactViewport={isCompactViewport}
          transitionSummary={transitionData?.summary}
          transitionHeat={transitionHeat}
          groupedLatestChurnHeat={groupedLatestChurnHeat}
          groupedLatestChurnBars={groupedLatestChurnBars}
          transitionRows={transitionData?.matrix ?? []}
          transitionTrendItems={transitionTrendItems}
          groupedTransitionTrendItems={groupedTransitionTrendItems}
          groupedDriftItems={groupedDriftItems}
          splitSnapshotRows={splitSnapshotRows}
          splitSnapshotSort={splitSnapshotSort}
          setSplitSnapshotSort={setSplitSnapshotSort}
        />
      )}

      {activeTab === "regimes" && regimeError ? (
        <div className="card" style={{ padding: "24px", marginTop: "24px" }}>{regimeError}</div>
      ) : null}
    </div>
  );
}

export default function MomentumPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <MomentumPageContent />
    </Suspense>
  );
}
