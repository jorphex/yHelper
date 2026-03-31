"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../lib/api";
import { chainLabel, compactChainLabel, formatHours, formatPct, formatUsd, regimeLabel, yearnVaultUrl } from "../lib/format";
import { useChangesData } from "../hooks/use-changes-data";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, ScatterPlot, ShareMeter, TrendStrips, useInViewOnce } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type TabKey = "changes" | "regimes";
type WindowKey = "24h" | "7d" | "30d";
type TrendGroupKey = "none" | "chain" | "category";
type TvlViewKey = "filtered" | "reference";
type MoverSortKey = "vault" | "chain" | "tvl" | "current" | "previous" | "delta" | "age";

// Change row types
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

type StaleByCategory = {
  category: string;
  vaults: number;
  stale_vaults: number;
  stale_ratio: number;
  tvl_usd: number | null;
  stale_tvl_usd: number | null;
};

// Regime types
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
type StaleSortKey = "chain" | "vaults" | "stale" | "ratio" | "tvl" | "stale_tvl";
type StaleCatSortKey = "category" | "vaults" | "stale" | "ratio" | "tvl" | "stale_tvl";

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

function MomentumPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("changes");

  // Trend analysis state
  const [trends, setTrends] = useState<DailyTrendRow[]>([]);
  const [chainTrendLatest, setChainTrendLatest] = useState<GroupedTrendRow[]>([]);
  const [categoryTrendLatest, setCategoryTrendLatest] = useState<GroupedTrendRow[]>([]);
  const [chainTrendSeries, setChainTrendSeries] = useState<Record<string, GroupedTrendRow[]>>({});
  const [categoryTrendSeries, setCategoryTrendSeries] = useState<Record<string, GroupedTrendRow[]>>({});
  const [trendError, setTrendError] = useState<string | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [staleSort, setStaleSort] = useState<SortState<StaleSortKey>>({ key: "ratio", direction: "desc" });
  const [staleCatSort, setStaleCatSort] = useState<SortState<StaleCatSortKey>>({ key: "ratio", direction: "desc" });

  // Regime state
  const [regimeData, setRegimeData] = useState<RegimeResponse | null>(null);
  const [transitionData, setTransitionData] = useState<TransitionResponse | null>(null);
  const [transitionDaily, setTransitionDaily] = useState<TransitionDailyRow[]>([]);
  const [transitionDailyGrouped, setTransitionDailyGrouped] = useState<TransitionDailyResponse["grouped"] | null>(null);
  const [regimeError, setRegimeError] = useState<string | null>(null);
  const [regimeLoading, setRegimeLoading] = useState(false);
  const [summarySort, setSummarySort] = useState<SortState<RegimeSummarySortKey>>({ key: "vaults", direction: "desc" });
  const [regimeMoverSort, setRegimeMoverSort] = useState<SortState<RegimeMoverSortKey>>({ key: "momentum", direction: "desc" });
  const [splitSnapshotSort, setSplitSnapshotSort] = useState<SortState<SplitSnapshotSortKey>>({ key: "churn", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      window: queryChoice<WindowKey>(searchParams, "window", ["24h", "7d", "30d"] as const, "7d"),
      trendGroup: queryChoice<TrendGroupKey>(searchParams, "trend_group", ["none", "chain", "category"] as const, "none"),
      tvlView: queryChoice<TvlViewKey>(searchParams, "tvl_view", ["filtered", "reference"] as const, "filtered"),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      tab: (searchParams.get("tab") || "changes") as TabKey,
      limit: queryInt(searchParams, "limit", 30, { min: 5, max: 300 }),
      // Regime-specific params
      chain: queryInt(searchParams, "chain", 0, { min: 0 }),
      transitionSplit: queryChoice(searchParams, "transition_split", ["none", "chain", "category"] as const, "none"),
      transitionDays: queryChoice(searchParams, "transition_days", ["60", "120", "180", "365"] as const, "120"),
      transitionMinCohortTvl: queryFloat(searchParams, "transition_min_cohort_tvl", 1000000, { min: 0 }),
    };
  }, [searchParams]);

  useMemo(() => {
    if (query.tab && ["changes", "regimes"].includes(query.tab)) {
      setActiveTab(query.tab);
    }
  }, [query.tab]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    updateQuery({ tab });
  };

  // Changes data
  const { data: changesData, isLoading: changesLoading, error: changesError, refetch: refetchChanges } = useChangesData({
    universe: query.universe,
    minTvl: query.minTvl,
    window: query.window,
    staleThreshold: "auto",
  });

  // Trend data fetching
  useEffect(() => {
    if (activeTab !== "changes") return;
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
  }, [activeTab, query.universe, query.minTvl, query.minPoints]);

  // Regime data fetching
  useEffect(() => {
    if (activeTab !== "regimes") return;
    let active = true;
    const run = async () => {
      setRegimeLoading(true);
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
          if (active) setRegimeError(`API error: ${status}`);
          return;
        }
        const [payload, transitionsPayload, transitionsDailyPayload] = (await Promise.all([
          regimesRes.json(),
          transitionsRes.json(),
          transitionsDailyRes.json(),
        ])) as [RegimeResponse, TransitionResponse, TransitionDailyResponse];
        if (active) {
          setRegimeData(payload);
          setTransitionData(transitionsPayload);
          setTransitionDaily(Array.isArray(transitionsDailyPayload.rows) ? transitionsDailyPayload.rows : []);
          setTransitionDailyGrouped(transitionsDailyPayload.grouped ?? null);
          setRegimeError(null);
        }
      } catch (err) {
        if (active) setRegimeError(`Load failed: ${String(err)}`);
      } finally {
        if (active) setRegimeLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [activeTab, query.universe, query.chain, query.minTvl, query.minPoints, query.limit, query.transitionSplit, query.transitionDays]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Changes computed data
  const summary = changesData?.summary;
  const eligibleVaults = summary?.vaults_eligible ?? 0;
  const comparedVaults = changesData?.freshness?.window_tracked_vaults ?? summary?.vaults_with_change ?? 0;
  const staleVaults = changesData?.freshness?.window_stale_vaults ?? summary?.stale_vaults ?? 0;
  const freshComparedVaults = Math.max(0, comparedVaults - staleVaults);
  const missingWindowVaults = Math.max(0, eligibleVaults - comparedVaults);

  // Yearn-aligned reference data
  const yearnAligned = changesData?.reference_tvl?.yearn_aligned_proxy;
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
    return [...index.values()]
      .sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0))
      .slice(0, isCompactViewport ? 56 : 80);
  }, [changesData?.movers, isCompactViewport]);

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

  // Stale data calculations
  const staleByChain: StaleByChain[] = changesData?.freshness?.stale_by_chain ?? [];
  const staleByCategory: StaleByCategory[] = changesData?.freshness?.stale_by_category ?? [];

  const staleChainRows = sortRows(staleByChain, staleSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.vaults,
    stale: (row) => row.stale_vaults,
    ratio: (row) => row.stale_ratio,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    stale_tvl: (row) => row.stale_tvl_usd ?? Number.NEGATIVE_INFINITY,
  });

  const staleCategoryRows = sortRows(staleByCategory, staleCatSort, {
    category: (row) => row.category,
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

  // Regime computed data
  const availableChains = useMemo(
    () => Array.from(new Set((regimeData?.movers ?? []).map((row) => row.chain_id))).sort((a, b) => a - b),
    [regimeData?.movers],
  );

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
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    momentum: (row) => row.momentum_7d_30d ?? Number.NEGATIVE_INFINITY,
    regime: (row) => row.regime,
  });

  const regimes = useMemo(() => {
    const summary = regimeData?.summary ?? [];
    const byRegime = new Map(summary.map((row) => [row.regime, row]));
    return REGIME_ORDER.map((regime) => byRegime.get(regime) ?? { regime, vaults: 0, tvl_usd: 0 });
  }, [regimeData?.summary]);

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

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Momentum
          <br />
          <em className="page-title-accent">Recent shifts</em>
        </h1>
        <p className="page-description">
          Track APY changes and regime transitions to time allocation decisions.
        </p>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "16px" }}>
          <button
            onClick={() => setTab("changes")}
            className={`button ${activeTab === "changes" ? "button-primary" : "button-ghost"}`}
          >
            Changes
          </button>
          <button
            onClick={() => setTab("regimes")}
            className={`button ${activeTab === "regimes" ? "button-primary" : "button-ghost"}`}
          >
            Regimes
          </button>
        </div>
      </section>

      {/* CHANGES TAB */}
      {activeTab === "changes" && (
        <>
          {/* Filters */}
          <section className="section" style={{ marginBottom: "32px" }}>
            <div className="card">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
                <label>
                  <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Window</span>
                  <select
                    value={query.window}
                    onChange={(e) => updateQuery({ window: e.target.value })}
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
                    onChange={(e) => updateQuery({ universe: e.target.value })}
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
                    onChange={(e) => updateQuery({ trend_group: e.target.value })}
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
                    onChange={(e) => updateQuery({ tvl_view: e.target.value })}
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
            {changesLoading ? (
              <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
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
                    <div className="kpi-value">{formatHours(changesData?.freshness?.latest_pps_age_seconds)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Newest Metrics Age</div>
                    <div className="kpi-value">{formatHours(changesData?.freshness?.metrics_newest_age_seconds)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Window Stale Ratio</div>
                    <div className="kpi-value">{formatPct(changesData?.freshness?.window_stale_ratio)}</div>
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
                  {changesLoading ? (
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
          <section className="section" style={{ marginBottom: "48px" }}>
            <div className="card-header">
              <h2 className="card-title">Movers</h2>
            </div>
            {changesLoading ? (
              <>
                <TableSkeleton rows={6} columns={7} />
                <TableSkeleton rows={6} columns={7} />
              </>
            ) : (
              <>
                <MoverTable
                  title="Top Risers"
                  rows={changesData?.movers?.risers ?? []}
                  universe={query.universe}
                  minTvl={query.minTvl}
                  minPoints={query.minPoints}
                  compact={isCompactViewport}
                />
                <MoverTable
                  title="Top Fallers"
                  rows={changesData?.movers?.fallers ?? []}
                  universe={query.universe}
                  minTvl={query.minTvl}
                  minPoints={query.minPoints}
                  compact={isCompactViewport}
                />
                <MoverTable
                  title="Largest Absolute Changes"
                  rows={changesData?.movers?.largest_abs_delta ?? []}
                  universe={query.universe}
                  minTvl={query.minTvl}
                  minPoints={query.minPoints}
                  compact={isCompactViewport}
                />
                <MoverTable
                  title="Stalest Series"
                  rows={changesData?.stale ?? []}
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
        </>
      )}

      {/* REGIMES TAB */}
      {activeTab === "regimes" && (
        <>
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

          {/* Transition Controls */}
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

          {/* Regime KPIs */}
          <section className="section" style={{ marginBottom: "48px" }}>
            {regimeLoading ? (
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
                  <div className="kpi-value" style={{ textTransform: "capitalize" }}>{currentRegime}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Rising</div>
                  <div className="kpi-value" style={{ color: "var(--positive)" }}>{regimes.find((r) => r.regime === "rising")?.vaults ?? 0}</div>
                  <div className="kpi-hint">Vaults improving</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Stable</div>
                  <div className="kpi-value">{regimes.find((r) => r.regime === "stable")?.vaults ?? 0}</div>
                  <div className="kpi-hint">Holding steady</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Falling</div>
                  <div className="kpi-value" style={{ color: "var(--negative)" }}>{regimes.find((r) => r.regime === "falling")?.vaults ?? 0}</div>
                  <div className="kpi-hint">Vaults declining</div>
                </div>
              </div>
            )}
          </section>

          {/* Regime Distribution */}
          <section className="section">
            <div className="card-header">
              <h2 className="card-title">Regime Distribution</h2>
            </div>
            <div style={{ marginBottom: "48px" }}>
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

            {/* Regime Summary Table */}
            <div className="table-wrap" style={{ marginBottom: "48px" }}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <button className="th-button" onClick={() => { const next = toggleSort(summarySort, "regime"); setSummarySort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Regime <span>{sortIndicator(summarySort, "regime")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => { const next = toggleSort(summarySort, "vaults"); setSummarySort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Vaults <span>{sortIndicator(summarySort, "vaults")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => { const next = toggleSort(summarySort, "tvl"); setSummarySort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        TVL <span>{sortIndicator(summarySort, "tvl")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>TVL Share</th>
                  </tr>
                </thead>
                <tbody>
                  {regimeLoading ? (
                    <TableSkeleton rows={4} columns={4} />
                  ) : summaryRows.map((row) => (
                    <tr key={row.regime}>
                      <td style={{ textTransform: "capitalize" }}>{compactRegimeLabel(row.regime)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{totalRegimeTvl > 0 ? formatPct((row.tvl_usd ?? 0) / totalRegimeTvl) : "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Current Regime Movers */}
            <div className="card-header">
              <h2 className="card-title">Current Regime Movers</h2>
            </div>
            <div className="table-wrap" style={{ marginBottom: "48px" }}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "vault"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Vault <span>{sortIndicator(regimeMoverSort, "vault")}</span>
                      </button>
                    </th>
                    <th>
                      <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "chain"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Chain <span>{sortIndicator(regimeMoverSort, "chain")}</span>
                      </button>
                    </th>
                    {!isCompactViewport && (
                      <th>
                        <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "token"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                          Token <span>{sortIndicator(regimeMoverSort, "token")}</span>
                        </button>
                      </th>
                    )}
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "tvl"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        TVL <span>{sortIndicator(regimeMoverSort, "tvl")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "apy"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        APY 30d <span>{sortIndicator(regimeMoverSort, "apy")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "momentum"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Momentum <span>{sortIndicator(regimeMoverSort, "momentum")}</span>
                      </button>
                    </th>
                    {!isCompactViewport && (
                      <th style={{ textAlign: "right" }}>
                        <button className="th-button" onClick={() => { const next = toggleSort(regimeMoverSort, "regime"); setRegimeMoverSort(next); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                          Regime <span>{sortIndicator(regimeMoverSort, "regime")}</span>
                        </button>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {regimeLoading ? (
                    <TableSkeleton rows={5} columns={isCompactViewport ? 6 : 8} />
                  ) : regimeMoverRows.slice(0, query.limit).map((row) => (
                    <tr key={row.vault_address}>
                      <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                      <td title={chainLabel(row.chain_id)}>
                        <Link href={`/explore?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}>
                          {compactChainLabel(row.chain_id, isCompactViewport)}
                        </Link>
                      </td>
                      {!isCompactViewport && (
                        <td>
                          {row.token_symbol ? (
                            <Link href={`/explore?tab=venues&token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}>
                              {row.token_symbol}
                            </Link>
                          ) : "n/a"}
                        </td>
                      )}
                      <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                      <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.momentum_7d_30d)}</td>
                      {!isCompactViewport && <td style={{ textAlign: "right" }} className="data-value" title={compactRegimeLabel(row.regime)}>{compactRegimeLabel(row.regime)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Transition Analysis */}
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

            {/* Transition Matrix */}
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

            {/* Transition Trends */}
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
                          <button className="th-button" onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "cohort"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                            Cohort <span>{sortIndicator(splitSnapshotSort, "cohort")}</span>
                          </button>
                        </th>
                        <th style={{ textAlign: "right" }}>
                          <button className="th-button" onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "churn"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                            Churn % <span>{sortIndicator(splitSnapshotSort, "churn")}</span>
                          </button>
                        </th>
                        <th style={{ textAlign: "right" }}>
                          <button className="th-button" onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "churn_tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                            Churn TVL % <span>{sortIndicator(splitSnapshotSort, "churn_tvl")}</span>
                          </button>
                        </th>
                        <th style={{ textAlign: "right" }}>
                          <button className="th-button" onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "momentum"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                            Momentum <span>{sortIndicator(splitSnapshotSort, "momentum")}</span>
                          </button>
                        </th>
                        <th style={{ textAlign: "right" }}>
                          <button className="th-button" onClick={() => setSplitSnapshotSort((current) => toggleSort(current, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
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
        </>
      )}
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
