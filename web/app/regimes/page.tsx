"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../lib/api";
import { chainLabel, compactChainLabel, formatPct, formatUsd, regimeLabel } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, TrendStrips, useInViewOnce } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type RegimeSummary = {
  regime: string;
  vaults: number;
  tvl_usd: number;
};

type RegimeMover = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  momentum_7d_30d: number | null;
  regime: string;
};

type RegimeResponse = {
  summary: RegimeSummary[];
  movers: RegimeMover[];
};

type TransitionRow = {
  previous_regime: string;
  current_regime: string;
  vaults: number;
  tvl_usd: number | null;
  avg_current_momentum: number | null;
  avg_previous_momentum: number | null;
};

type TransitionResponse = {
  summary?: {
    vaults_total?: number;
    changed_vaults?: number;
    changed_ratio?: number | null;
    tvl_total_usd?: number | null;
    changed_tvl_usd?: number | null;
    changed_tvl_ratio?: number | null;
  };
  matrix?: TransitionRow[];
  chain_breakdown?: Array<{
    chain_id: number;
    vaults: number;
    tvl_usd: number | null;
    changed_vaults: number;
    changed_tvl_usd: number | null;
    changed_ratio: number | null;
  }>;
};

type TransitionDailyRow = {
  day: string;
  changed_ratio?: number | null;
  changed_tvl_ratio?: number | null;
  momentum_spread?: number | null;
};

type TransitionDailyResponse = {
  rows?: TransitionDailyRow[];
  grouped?: {
    group_by?: "none" | "chain" | "category";
    rows?: Array<TransitionDailyRow & { group_key: string; tvl_total_usd?: number | null }>;
    latest?: Array<TransitionDailyRow & { group_key: string; tvl_total_usd?: number | null }>;
    series?: Record<string, Array<TransitionDailyRow & { group_key: string; tvl_total_usd?: number | null }>>;
  };
};

type RegimeSummarySortKey = "regime" | "vaults" | "tvl";
type RegimeMoverSortKey = "vault" | "chain" | "token" | "tvl" | "apy" | "momentum" | "regime";
type SplitSnapshotSortKey = "cohort" | "churn" | "churn_tvl" | "momentum" | "tvl";

const REGIME_ORDER = ["rising", "stable", "falling", "choppy"] as const;

function compactRegimeLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.toLowerCase();
  if (key === "rising") return "Rising";
  if (key === "falling") return "Falling";
  if (key === "stable") return "Stable";
  if (key === "choppy") return "Choppy";
  return value;
}

function regimeColor(value: string | null | undefined): [number, number, number] {
  const key = (value ?? "").toLowerCase();
  if (key === "rising") return [92, 145, 238];
  if (key === "stable") return [132, 170, 255];
  if (key === "falling") return [173, 116, 196];
  if (key === "choppy") return [104, 146, 190];
  return [114, 153, 206];
}

function regimeOrder(value: string): number {
  const key = value.toLowerCase();
  if (key === "rising") return 0;
  if (key === "stable") return 1;
  if (key === "choppy") return 2;
  if (key === "falling") return 3;
  return 4;
}

function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}

function RegimeFlowSankey({
  title,
  rows,
}: {
  title: string;
  rows: TransitionRow[];
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const validRows = rows
    .filter((row) => row.tvl_usd !== null && row.tvl_usd !== undefined && Number.isFinite(row.tvl_usd) && Number(row.tvl_usd) > 0)
    .sort((left, right) => Number(right.tvl_usd) - Number(left.tvl_usd))
    .slice(0, 20);
  const regimes = Array.from(
    new Set(validRows.flatMap((row) => [row.previous_regime, row.current_regime]).filter(Boolean)),
  ).sort((a, b) => regimeOrder(a) - regimeOrder(b));
  if (validRows.length === 0 || regimes.length === 0) {
    return (
      <section className="regime-sankey-panel">
        {title ? <h3>{title}</h3> : null}
        <p style={{ color: "var(--text-secondary)" }}>No transition flows available.</p>
      </section>
    );
  }
  const width = 720;
  const height = 268;
  const xLeft = 112;
  const xRight = width - 112;
  const laneTop = 60;
  const laneBottom = height - 38;
  const laneHeight = laneBottom - laneTop;
  const laneStep = regimes.length > 1 ? laneHeight / (regimes.length - 1) : laneHeight / 2;
  const yPos = new Map(regimes.map((key, index) => [key, laneTop + index * laneStep]));
  const maxFlow = Math.max(...validRows.map((row) => Number(row.tvl_usd)));
  const incomingByRegime = new Map<string, number>();
  const outgoingByRegime = new Map<string, number>();
  for (const row of validRows) {
    outgoingByRegime.set(row.previous_regime, (outgoingByRegime.get(row.previous_regime) ?? 0) + Number(row.tvl_usd));
    incomingByRegime.set(row.current_regime, (incomingByRegime.get(row.current_regime) ?? 0) + Number(row.tvl_usd));
  }

  return (
    <section ref={ref} className={`regime-sankey-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      {title ? <h3>{title}</h3> : null}
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: "100%", height: "auto" }}>
          {validRows.map((row) => {
            const y1 = yPos.get(row.previous_regime) ?? laneTop;
            const y2 = yPos.get(row.current_regime) ?? laneTop;
            const value = Number(row.tvl_usd);
            const strokeWidth = 1.4 + (value / maxFlow) * 7.2;
            const intensity = Math.max(0, Math.min(1, value / maxFlow));
            const [prevR, prevG, prevB] = regimeColor(row.previous_regime);
            const [currR, currG, currB] = regimeColor(row.current_regime);
            const strokeR = Math.round((prevR + currR) / 2);
            const strokeG = Math.round((prevG + currG) / 2);
            const strokeB = Math.round((prevB + currB) / 2);
            const stroke = `rgba(${strokeR}, ${strokeG}, ${strokeB}, ${0.26 + intensity * 0.5})`;
            const c1x = xLeft + (xRight - xLeft) * 0.34;
            const c2x = xLeft + (xRight - xLeft) * 0.66;
            const path = `M${xLeft},${y1} C${c1x},${y1} ${c2x},${y2} ${xRight},${y2}`;
            return (
              <g key={`${row.previous_regime}-${row.current_regime}-${row.vaults}`} className="sankey-flow">
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  pathLength={1}
                >
                  <title>
                    {`${compactRegimeLabel(row.previous_regime)} → ${compactRegimeLabel(row.current_regime)}\nTVL ${formatUsd(row.tvl_usd)}\nVaults ${row.vaults}`}
                  </title>
                </path>
              </g>
            );
          })}
          {regimes.map((regime) => {
            const y = yPos.get(regime) ?? laneTop;
            const outValue = outgoingByRegime.get(regime) ?? 0;
            const inValue = incomingByRegime.get(regime) ?? 0;
            const [r, g, b] = regimeColor(regime);
            const fill = `rgba(${r}, ${g}, ${b}, 0.24)`;
            const stroke = `rgba(${Math.min(255, r + 36)}, ${Math.min(255, g + 36)}, ${Math.min(255, b + 36)}, 0.78)`;
            return (
              <g key={`left-${regime}`}>
                <rect x={8} y={y - 15} width={104} height={30} rx={6} fill={fill} stroke={stroke} />
                <text x={14} y={y + 0.5} className="sankey-label" dominantBaseline="central" style={{ fontSize: "12px", fill: "var(--text-primary)" }}>{compactRegimeLabel(regime)}</text>
                <text x={106} y={y + 0.5} className="sankey-value" textAnchor="end" dominantBaseline="central" style={{ fontSize: "11px", fill: "var(--text-secondary)" }}>{formatUsdCompact(outValue)}</text>
                <rect x={width - 112} y={y - 15} width={104} height={30} rx={6} fill={fill} stroke={stroke} />
                <text x={width - 106} y={y + 0.5} className="sankey-label" dominantBaseline="central" style={{ fontSize: "12px", fill: "var(--text-primary)" }}>{compactRegimeLabel(regime)}</text>
                <text x={width - 14} y={y + 0.5} className="sankey-value" textAnchor="end" dominantBaseline="central" style={{ fontSize: "11px", fill: "var(--text-secondary)" }}>{formatUsdCompact(inValue)}</text>
              </g>
            );
          })}
          <text x={8} y={18} className="sankey-axis-label" style={{ fontSize: "11px", fill: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Previous Regime</text>
          <text x={width - 8} y={18} className="sankey-axis-label" textAnchor="end" style={{ fontSize: "11px", fill: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Current Regime</text>
        </svg>
      </div>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "12px" }}>Stroke width scales by transitioned TVL; labels show total outgoing vs incoming TVL per regime.</p>
    </section>
  );
}

function RegimesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<RegimeResponse | null>(null);
  const [transitionData, setTransitionData] = useState<TransitionResponse | null>(null);
  const [transitionDaily, setTransitionDaily] = useState<TransitionDailyRow[]>([]);
  const [transitionDailyGrouped, setTransitionDailyGrouped] = useState<TransitionDailyResponse["grouped"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [summarySort, setSummarySort] = useState<SortState<RegimeSummarySortKey>>({ key: "vaults", direction: "desc" });
  const [moverSort, setMoverSort] = useState<SortState<RegimeMoverSortKey>>({ key: "momentum", direction: "desc" });
  const [splitSnapshotSort, setSplitSnapshotSort] = useState<SortState<SplitSnapshotSortKey>>({ key: "churn", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      chain: queryInt(searchParams, "chain", 0, { min: 0 }),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      transitionSplit: queryChoice(searchParams, "transition_split", ["none", "chain", "category"] as const, "none"),
      transitionDays: queryChoice(searchParams, "transition_days", ["60", "120", "180", "365"] as const, "120"),
      transitionMinCohortTvl: queryFloat(searchParams, "transition_min_cohort_tvl", 1000000, { min: 0 }),
      limit: queryInt(searchParams, "limit", 30, { min: 5, max: 300 }),
      summarySort: queryChoice<RegimeSummarySortKey>(
        searchParams,
        "summary_sort",
        ["regime", "vaults", "tvl"] as const,
        "vaults",
      ),
      summaryDir: queryChoice(searchParams, "summary_dir", ["asc", "desc"] as const, "desc"),
      moverSort: queryChoice<RegimeMoverSortKey>(
        searchParams,
        "mover_sort",
        ["vault", "chain", "token", "tvl", "apy", "momentum", "regime"] as const,
        "momentum",
      ),
      moverDir: queryChoice(searchParams, "mover_dir", ["asc", "desc"] as const, "desc"),
    };
  }, [searchParams]);

  useEffect(() => {
    setSummarySort({ key: query.summarySort, direction: query.summaryDir });
    setMoverSort({ key: query.moverSort, direction: query.moverDir });
  }, [query.summarySort, query.summaryDir, query.moverSort, query.moverDir]);

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
    const run = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          limit: String(query.limit),
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
        });
        if (query.chain > 0) params.set("chain_id", String(query.chain));
        const transitionsParams = new URLSearchParams(params);
        transitionsParams.set("limit", String(Math.min(query.limit, 30)));
        const dailyParams = new URLSearchParams(params);
        dailyParams.set("days", query.transitionDays);
        dailyParams.set("group_by", query.transitionSplit);
        dailyParams.set("group_limit", "8");
        const [regimesRes, transitionsRes, transitionsDailyRes] = await Promise.all([
          fetch(apiUrl("/regimes", params), { cache: "no-store" }),
          fetch(apiUrl("/regimes/transitions", transitionsParams), { cache: "no-store" }),
          fetch(apiUrl("/regimes/transitions/daily", dailyParams), { cache: "no-store" }),
        ]);
        if (!regimesRes.ok || !transitionsRes.ok || !transitionsDailyRes.ok) {
          const status = !regimesRes.ok ? regimesRes.status : !transitionsRes.ok ? transitionsRes.status : transitionsDailyRes.status;
          if (active) setError(`API error: ${status}`);
          return;
        }
        const [payload, transitionsPayload, transitionsDailyPayload] = (await Promise.all([
          regimesRes.json(),
          transitionsRes.json(),
          transitionsDailyRes.json(),
        ])) as [RegimeResponse, TransitionResponse, TransitionDailyResponse];
        if (active) {
          setData(payload);
          setTransitionData(transitionsPayload);
          setTransitionDaily(Array.isArray(transitionsDailyPayload.rows) ? transitionsDailyPayload.rows : []);
          setTransitionDailyGrouped(transitionsDailyPayload.grouped ?? null);
          setError(null);
        }
      } catch (err) {
        if (active) setError(`Load failed: ${String(err)}`);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [
    query.universe,
    query.chain,
    query.minTvl,
    query.minPoints,
    query.limit,
    query.transitionSplit,
    query.transitionDays,
  ]);

  const summaryRows = sortRows(data?.summary ?? [], summarySort, {
    regime: (row) => row.regime,
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd,
  });

  const moverRows = sortRows(data?.movers ?? [], moverSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    regime: (row) => row.regime,
  });

  const availableChains = useMemo(
    () => Array.from(new Set((data?.movers ?? []).map((row) => row.chain_id))).sort((a, b) => a - b),
    [data?.movers],
  );

  const regimes = useMemo(() => {
    const summary = data?.summary ?? [];
    const byRegime = new Map(summary.map((row) => [row.regime, row]));
    return REGIME_ORDER.map((regime) => byRegime.get(regime) ?? { regime, vaults: 0, tvl_usd: 0 });
  }, [data?.summary]);

  const currentRegime = regimes.find((row) => row.vaults > 0)?.regime ?? "n/a";
  const totalRegimeTvl = useMemo(
    () => regimes.reduce((sum, row) => sum + (row.tvl_usd ?? 0), 0),
    [regimes],
  );

  const transitionHeat = useMemo(
    () =>
      (transitionData?.matrix ?? [])
        .slice()
        .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, 16)
        .map((row) => ({
          id: `${row.previous_regime}->${row.current_regime}`,
          label: `${regimeLabel(row.previous_regime)} → ${regimeLabel(row.current_regime)}`,
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
    const ranked = [...latest]
      .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
      .sort((left, right) => (right.tvl_total_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_total_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, 6);
    return ranked.map((row) => {
      const key = row.group_key;
      const label =
        transitionDailyGrouped?.group_by === "chain"
          ? chainLabel(Number(key))
          : key;
      return {
        id: `transition-group-${key}`,
        label,
        points: (series[key] ?? []).map((point) => point.changed_ratio),
        note: `Latest churn ${formatPct(row.changed_ratio)} • TVL ${formatUsd(row.tvl_total_usd)}`,
      };
    });
  }, [transitionDailyGrouped, query.transitionMinCohortTvl]);

  const groupedDriftItems = useMemo(() => {
    const series = transitionDailyGrouped?.series ?? {};
    const groupType = transitionDailyGrouped?.group_by;
    const latestMap = new Map((transitionDailyGrouped?.latest ?? []).map((row) => [row.group_key, row]));
    const rows = Object.entries(series)
      .map(([key, points]) => {
        const latestRow = latestMap.get(key);
        if (!latestRow || (latestRow.tvl_total_usd ?? 0) < query.transitionMinCohortTvl) return null;
        const latest = points[points.length - 1]?.changed_ratio;
        const previous = points.length > 1 ? points[points.length - 2]?.changed_ratio : null;
        if (latest === null || latest === undefined) return null;
        const delta = previous === null || previous === undefined ? 0 : latest - previous;
        const label = groupType === "chain" ? chainLabel(Number(key)) : key;
        const tvl = points[points.length - 1]?.tvl_total_usd;
        return {
          id: `drift-${key}`,
          label,
          value: delta,
          note: `Latest churn ${formatPct(latest)} • TVL ${formatUsd(tvl)}`,
        };
      })
      .filter((item): item is { id: string; label: string; value: number; note: string } => item !== null)
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
      .slice(0, 8);
    return rows;
  }, [transitionDailyGrouped, query.transitionMinCohortTvl]);

  const groupedLatestChurnHeat = useMemo(() => {
    const latest = transitionDailyGrouped?.latest ?? [];
    const groupType = transitionDailyGrouped?.group_by;
    return [...latest]
      .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
      .sort((left, right) => (right.tvl_total_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_total_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, 12)
      .map((row) => {
        const key = row.group_key;
        return {
          id: `latest-churn-${key}`,
          label: groupType === "chain" ? chainLabel(Number(key)) : key,
          value: row.changed_tvl_ratio,
          note: `Churn ${formatPct(row.changed_ratio)} • TVL ${formatUsd(row.tvl_total_usd)}`,
        };
      });
  }, [transitionDailyGrouped, query.transitionMinCohortTvl]);

  const groupedLatestChurnBars = useMemo(() => {
    const latest = transitionDailyGrouped?.latest ?? [];
    const groupType = transitionDailyGrouped?.group_by;
    return [...latest]
      .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
      .sort((left, right) => (right.changed_ratio ?? Number.NEGATIVE_INFINITY) - (left.changed_ratio ?? Number.NEGATIVE_INFINITY))
      .slice(0, 10)
      .map((row) => {
        const key = row.group_key;
        return {
          id: `latest-churn-bar-${key}`,
          label: groupType === "chain" ? chainLabel(Number(key)) : key,
          value: row.changed_ratio,
          note: `TVL ${formatUsd(row.tvl_total_usd)} • Churn TVL ${formatPct(row.changed_tvl_ratio)}`,
        };
      });
  }, [transitionDailyGrouped, query.transitionMinCohortTvl]);

  const splitSnapshotRows = useMemo(() => {
    const latest = transitionDailyGrouped?.latest ?? [];
    const groupType = transitionDailyGrouped?.group_by;
    const normalized = latest
      .filter((row) => (row.tvl_total_usd ?? 0) >= query.transitionMinCohortTvl)
      .map((row) => {
      const key = row.group_key;
      const label = groupType === "chain" ? chainLabel(Number(key)) : key;
      return {
        group_key: key,
        cohort_label: label,
        changed_ratio: row.changed_ratio ?? null,
        changed_tvl_ratio: row.changed_tvl_ratio ?? null,
        momentum_spread: row.momentum_spread ?? null,
        tvl_total_usd: row.tvl_total_usd ?? null,
      };
    });
    return sortRows(normalized, splitSnapshotSort, {
      cohort: (row) => row.cohort_label,
      churn: (row) => row.changed_ratio ?? Number.NEGATIVE_INFINITY,
      churn_tvl: (row) => row.changed_tvl_ratio ?? Number.NEGATIVE_INFINITY,
      momentum: (row) => row.momentum_spread ?? Number.NEGATIVE_INFINITY,
      tvl: (row) => row.tvl_total_usd ?? Number.NEGATIVE_INFINITY,
    });
  }, [transitionDailyGrouped, splitSnapshotSort, query.transitionMinCohortTvl]);

  if (error && !data) {
    return (
      <div className="card" style={{ padding: "48px" }}>
        <h2>Regime analysis is temporarily unavailable</h2>
        <p>The regime feed failed to load. Please try again later.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Regimes.
          <br />
          <em className="page-title-accent">States. Behavior.</em>
        </h1>
        <p className="page-description">
          Follow rising, stable, falling, and choppy states. Understand recent yield behavior 
          and how cohorts are transitioning.
        </p>
      </section>

      {/* Filters */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Universe</span>
              <select
                value={query.universe}
                onChange={(e) => updateQuery({ universe: e.target.value, min_tvl: null, min_points: null })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                {UNIVERSE_VALUES.map((value) => (
                  <option key={value} value={value}>{universeLabel(value)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Chain</span>
              <select
                value={query.chain > 0 ? String(query.chain) : ""}
                onChange={(e) => updateQuery({ chain: e.target.value || null })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="">All</option>
                {availableChains.map((chainId) => (
                  <option key={chainId} value={chainId}>{chainLabel(chainId)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min TVL (USD)</span>
              <input
                type="number"
                min={0}
                value={query.minTvl}
                onChange={(e) => updateQuery({ min_tvl: Number(e.target.value || 0) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min Points</span>
              <input
                type="number"
                min={0}
                max={365}
                value={query.minPoints}
                onChange={(e) => updateQuery({ min_points: Number(e.target.value || 0) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* Transition Analysis Controls */}
      <section className="section" style={{ marginBottom: "32px" }}>
        <div className="card" style={{ background: "var(--surface-secondary)" }}>
          <h3 style={{ fontSize: "14px", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)" }}>Transition Analysis</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Movers Limit</span>
              <select
                value={query.limit}
                onChange={(e) => updateQuery({ limit: Number(e.target.value) })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={80}>80</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Transition Split</span>
              <select
                value={query.transitionSplit}
                onChange={(e) => updateQuery({ transition_split: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="none">Global</option>
                <option value="chain">By Chain</option>
                <option value="category">By Category</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Transition Window</span>
              <select
                value={query.transitionDays}
                onChange={(e) => updateQuery({ transition_days: e.target.value })}
                style={{ width: "100%", marginTop: "6px" }}
              >
                <option value="60">60d</option>
                <option value="120">120d</option>
                <option value="180">180d</option>
                <option value="365">365d</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Min Cohort TVL (USD)</span>
              <input
                type="number"
                min={0}
                value={query.transitionMinCohortTvl}
                onChange={(e) => updateQuery({ transition_min_cohort_tvl: Number(e.target.value || 0) })}
                style={{ width: "100%", marginTop: "6px" }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* KPI Grid */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
            {Array(6).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Regimes Tracked</div>
              <div className="kpi-value">{summaryRows.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total Vaults</div>
              <div className="kpi-value">{summaryRows.reduce((acc, row) => acc + row.vaults, 0)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Current Regime</div>
              <div className="kpi-value" style={{ textTransform: "capitalize" }}>
                {currentRegime}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rising</div>
              <div className="kpi-value" style={{ color: "var(--positive)" }}>
                {regimes.find((r) => r.regime === "rising")?.vaults ?? 0}
              </div>
              <div className="kpi-hint">Vaults improving</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Stable</div>
              <div className="kpi-value">
                {regimes.find((r) => r.regime === "stable")?.vaults ?? 0}
              </div>
              <div className="kpi-hint">Holding steady</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Falling</div>
              <div className="kpi-value" style={{ color: "var(--negative)" }}>
                {regimes.find((r) => r.regime === "falling")?.vaults ?? 0}
              </div>
              <div className="kpi-hint">Vaults declining</div>
            </div>
          </div>
        )}
      </section>

      {/* Regime Distribution with TVL Mix Bar Chart */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Regime Distribution</h2>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "48px" }}>
          <HeatGrid
            title="By Regime"
            items={regimes.map((row) => ({
              id: row.regime,
              label: row.regime.charAt(0).toUpperCase() + row.regime.slice(1),
              value: row.vaults,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(v) => String(v ?? "n/a")}
          />
          <BarList
            title="Regime TVL Mix"
            items={summaryRows.map((row) => ({
              id: row.regime,
              label: compactRegimeLabel(row.regime),
              value: row.tvl_usd,
              note: `${row.vaults} vaults`,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
        </div>

        {/* Regime Summary Table with Sorting */}
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(summarySort, "regime");
                      setSummarySort(next);
                      updateQuery({ summary_sort: next.key, summary_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Regime <span>{sortIndicator(summarySort, "regime")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(summarySort, "vaults");
                      setSummarySort(next);
                      updateQuery({ summary_sort: next.key, summary_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Vaults <span>{sortIndicator(summarySort, "vaults")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(summarySort, "tvl");
                      setSummarySort(next);
                      updateQuery({ summary_sort: next.key, summary_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    TVL <span>{sortIndicator(summarySort, "tvl")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>TVL Share</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={4} columns={4} />
              ) : summaryRows.map((row) => (
                <tr key={row.regime}>
                  <td style={{ textTransform: "capitalize" }}>
                    <Link href={`/changes?window=7d&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}>
                      {compactRegimeLabel(row.regime)}
                    </Link>
                  </td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">
                    {totalRegimeTvl > 0 ? formatPct((row.tvl_usd ?? 0) / totalRegimeTvl) : "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Current Regime Movers with Richer Columns and Sorting */}
        <div className="card-header">
          <h2 className="card-title">Current Regime Movers</h2>
        </div>
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(moverSort, "vault");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Vault <span>{sortIndicator(moverSort, "vault")}</span>
                  </button>
                </th>
                <th>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(moverSort, "chain");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Chain <span>{sortIndicator(moverSort, "chain")}</span>
                  </button>
                </th>
                {!isCompactViewport && (
                  <th>
                    <button
                      className="th-button"
                      onClick={() => {
                        const next = toggleSort(moverSort, "token");
                        setMoverSort(next);
                        updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                    >
                      Token <span>{sortIndicator(moverSort, "token")}</span>
                    </button>
                  </th>
                )}
                <th style={{ textAlign: "right" }}>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(moverSort, "tvl");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    TVL <span>{sortIndicator(moverSort, "tvl")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(moverSort, "apy");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    APY 30d <span>{sortIndicator(moverSort, "apy")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button
                    className="th-button"
                    onClick={() => {
                      const next = toggleSort(moverSort, "momentum");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                  >
                    Momentum <span>{sortIndicator(moverSort, "momentum")}</span>
                  </button>
                </th>
                {!isCompactViewport && (
                  <th style={{ textAlign: "right" }}>
                    <button
                      className="th-button"
                      onClick={() => {
                        const next = toggleSort(moverSort, "regime");
                        setMoverSort(next);
                        updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                    >
                      Regime <span>{sortIndicator(moverSort, "regime")}</span>
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={isCompactViewport ? 6 : 8} />
              ) : moverRows.slice(0, query.limit).map((row) => (
                <tr key={row.vault_address}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td title={chainLabel(row.chain_id)}>
                    <Link href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}>
                      {compactChainLabel(row.chain_id, isCompactViewport)}
                    </Link>
                  </td>
                  {!isCompactViewport && (
                    <td>
                      {row.token_symbol ? (
                        <Link href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}>
                          {row.token_symbol}
                        </Link>
                      ) : (
                        "n/a"
                      )}
                    </td>
                  )}
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.momentum_7d_30d)}</td>
                  {!isCompactViewport && (
                    <td style={{ textAlign: "right" }} className="data-value" title={compactRegimeLabel(row.regime)}>{compactRegimeLabel(row.regime)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Transition Analysis Section */}
        <div className="card-header">
          <h2 className="card-title">Transition Analysis</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            Compare current short-term regime (7d vs 30d APY) with prior baseline (30d vs 90d APY).
          </p>
        </div>

        {/* Transition KPIs */}
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "24px" }}>
          <div className="kpi-card">
            <div className="kpi-label">Vaults Tracked</div>
            <div className="kpi-value">{transitionData?.summary?.vaults_total ?? "n/a"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Changed Vaults</div>
            <div className="kpi-value">{transitionData?.summary?.changed_vaults ?? "n/a"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Changed Ratio</div>
            <div className="kpi-value">{formatPct(transitionData?.summary?.changed_ratio)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Changed TVL</div>
            <div className="kpi-value">{formatUsd(transitionData?.summary?.changed_tvl_usd)}</div>
          </div>
        </div>

        {/* Transition Matrix Heatmap */}
        <div style={{ marginBottom: "48px" }}>
          {query.transitionSplit === "none" ? (
            <HeatGrid
              title="Transition Matrix"
              items={transitionHeat}
              valueFormatter={(value) => formatUsd(value)}
              legend="Higher intensity means more TVL moved between regime states."
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              <HeatGrid
                title={`Latest Churn TVL Share by ${query.transitionSplit === "chain" ? "Chain" : "Category"}`}
                items={groupedLatestChurnHeat}
                valueFormatter={(value) => formatPct(value, 2)}
                legend="Each cell is latest-day churn TVL ratio."
              />
              <BarList
                title={`${query.transitionSplit === "chain" ? "Chains" : "Categories"} with Highest Latest Churn`}
                items={groupedLatestChurnBars}
                valueFormatter={(value) => formatPct(value, 2)}
              />
            </div>
          )}
        </div>

        {/* Transition Flow Sankey */}
        <div className="card-header">
          <h2 className="card-title">Transition Flow</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            Visual flow of where TVL moved between prior and current regime states.
          </p>
        </div>
        <div style={{ marginBottom: "48px" }}>
          <RegimeFlowSankey title="" rows={transitionData?.matrix ?? []} />
        </div>

        {/* Transition Trend Strips */}
        <div className="card-header">
          <h2 className="card-title">Transition Trends ({query.transitionDays} Days)</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            Daily trend separates one-day noise from sustained regime churn.
          </p>
        </div>
        <div style={{ marginBottom: "48px" }}>
          <TrendStrips
            title=""
            items={transitionTrendItems}
            valueFormatter={(value) => formatPct(value, 2)}
            deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
            columns={3}
            emptyText="Transition trend is unavailable for this filter."
          />
        </div>

        {/* Split Churn Views */}
        {query.transitionSplit !== "none" && (
          <>
            <div className="card-header">
              <h2 className="card-title">Churn by {query.transitionSplit === "chain" ? "Chain" : "Category"}</h2>
            </div>
            <div style={{ marginBottom: "24px" }}>
              <TrendStrips
                title={`Top 6 by Latest TVL`}
                items={groupedTransitionTrendItems}
                valueFormatter={(value) => formatPct(value, 2)}
                deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
                emptyText="Grouped transition churn trend is unavailable."
              />
            </div>

            {/* Churn Drift Leaderboard */}
            <div className="card-header">
              <h2 className="card-title">Churn Drift Leaderboard</h2>
            </div>
            <div style={{ marginBottom: "48px" }}>
              <BarList
                title={`${query.transitionSplit === "chain" ? "Chains" : "Categories"} by Drift`}
                items={groupedDriftItems}
                valueFormatter={(value) => formatPct(value, 2)}
                emptyText="Not enough grouped history yet for drift ranking."
              />
            </div>

            {/* Latest Cohort Snapshot Table */}
            <div className="card-header">
              <h2 className="card-title">Latest {query.transitionSplit === "chain" ? "Chain" : "Category"} Snapshot</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
                Sortable latest-day cohort metrics for quick comparison.
              </p>
            </div>
            <div className="table-wrap" style={{ marginBottom: "48px" }}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <button
                        className="th-button"
                        onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "cohort"))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        Cohort <span>{sortIndicator(splitSnapshotSort, "cohort")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button
                        className="th-button"
                        onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "churn"))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        Churn % <span>{sortIndicator(splitSnapshotSort, "churn")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button
                        className="th-button"
                        onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "churn_tvl"))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        Churn TVL % <span>{sortIndicator(splitSnapshotSort, "churn_tvl")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button
                        className="th-button"
                        onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "momentum"))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        Momentum <span>{sortIndicator(splitSnapshotSort, "momentum")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button
                        className="th-button"
                        onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "tvl"))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
                      >
                        TVL <span>{sortIndicator(splitSnapshotSort, "tvl")}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {splitSnapshotRows.map((row) => (
                    <tr key={`split-latest-${row.group_key}`}>
                      <td>{row.cohort_label}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.changed_ratio, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.changed_tvl_ratio, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.momentum_spread, 2)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_total_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function RegimesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <RegimesPageContent />
    </Suspense>
  );
}
