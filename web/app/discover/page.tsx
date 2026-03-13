"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../lib/api";
import { chainLabel, compactCategoryLabel, compactChainLabel, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { queryBool, queryChoice, queryFloat, queryInt, queryString, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, KpiGrid, ScatterPlot, TrendStrips, useInViewOnce } from "../components/visuals";
import { PageTopPanel } from "../components/page-top-panel";
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
  coverage?: {
    visible_vaults?: number;
    with_metrics?: number;
    missing_metrics?: number;
    low_points?: number;
    missing_or_low_points?: number;
    coverage_ratio?: number | null;
    visible_tvl_usd?: number | null;
    with_metrics_tvl_usd?: number | null;
  };
  risk_mix?: Array<{ risk_level: string; vaults: number; tvl_usd: number | null }>;
  rows: DiscoverRow[];
};

type DiscoverApiSort = "quality" | "tvl" | "apy_7d" | "apy_30d" | "momentum" | "consistency";

type DailyTrendRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_apy_90d?: number | null;
  weighted_momentum_7d_30d?: number | null;
  bucket_neg_ratio?: number | null;
  bucket_low_ratio?: number | null;
  bucket_mid_ratio?: number | null;
  bucket_high_ratio?: number | null;
  riser_ratio?: number | null;
  faller_ratio?: number | null;
};

type DailyTrendResponse = {
  rows?: DailyTrendRow[];
  grouped?: {
    group_by?: "none" | "chain" | "category";
    latest?: Array<
      DailyTrendRow & {
        group_key: string;
        total_tvl_usd?: number | null;
      }
    >;
    series?: Record<
      string,
      Array<
        DailyTrendRow & {
          group_key: string;
          total_tvl_usd?: number | null;
        }
      >
    >;
  };
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asFiniteInt(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

function formatFixed(value: unknown, digits = 2): string {
  const parsed = asFiniteNumber(value);
  if (parsed === null) return "n/a";
  return parsed.toFixed(digits);
}

function formatUsdCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizeSummary(raw: unknown): DiscoverResponse["summary"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as Record<string, unknown>;
  return {
    vaults: asFiniteInt(entry.vaults) ?? undefined,
    chains: asFiniteInt(entry.chains) ?? undefined,
    tokens: asFiniteInt(entry.tokens) ?? undefined,
    categories: asFiniteInt(entry.categories) ?? undefined,
    total_tvl_usd: asFiniteNumber(entry.total_tvl_usd),
    avg_safe_apy_30d: asFiniteNumber(entry.avg_safe_apy_30d),
    median_safe_apy_30d: asFiniteNumber(entry.median_safe_apy_30d),
    tvl_weighted_safe_apy_30d: asFiniteNumber(entry.tvl_weighted_safe_apy_30d),
    avg_momentum_7d_30d: asFiniteNumber(entry.avg_momentum_7d_30d),
    median_momentum_7d_30d: asFiniteNumber(entry.median_momentum_7d_30d),
    avg_consistency_score: asFiniteNumber(entry.avg_consistency_score),
    avg_feature_score: asFiniteNumber(entry.avg_feature_score),
    retired_vaults: asFiniteInt(entry.retired_vaults) ?? undefined,
    highlighted_vaults: asFiniteInt(entry.highlighted_vaults) ?? undefined,
    migration_ready_vaults: asFiniteInt(entry.migration_ready_vaults) ?? undefined,
    avg_strategies_per_vault: asFiniteNumber(entry.avg_strategies_per_vault),
    apy_negative_vaults: asFiniteInt(entry.apy_negative_vaults) ?? undefined,
    apy_low_vaults: asFiniteInt(entry.apy_low_vaults) ?? undefined,
    apy_mid_vaults: asFiniteInt(entry.apy_mid_vaults) ?? undefined,
    apy_high_vaults: asFiniteInt(entry.apy_high_vaults) ?? undefined,
  };
}

function normalizeCoverage(raw: unknown): DiscoverResponse["coverage"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as Record<string, unknown>;
  return {
    visible_vaults: asFiniteInt(entry.visible_vaults) ?? undefined,
    with_metrics: asFiniteInt(entry.with_metrics) ?? undefined,
    missing_metrics: asFiniteInt(entry.missing_metrics) ?? undefined,
    low_points: asFiniteInt(entry.low_points) ?? undefined,
    missing_or_low_points: asFiniteInt(entry.missing_or_low_points) ?? undefined,
    coverage_ratio: asFiniteNumber(entry.coverage_ratio),
    visible_tvl_usd: asFiniteNumber(entry.visible_tvl_usd),
    with_metrics_tvl_usd: asFiniteNumber(entry.with_metrics_tvl_usd),
  };
}

function normalizeDiscoverRow(raw: unknown): DiscoverRow | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DiscoverRow>;
  if (typeof candidate.vault_address !== "string" || candidate.vault_address.length === 0) return null;
  if (typeof candidate.chain_id !== "number" || !Number.isFinite(candidate.chain_id)) return null;
  return {
    vault_address: candidate.vault_address,
    chain_id: candidate.chain_id,
    symbol: typeof candidate.symbol === "string" ? candidate.symbol : null,
    token_symbol: typeof candidate.token_symbol === "string" ? candidate.token_symbol : null,
    category: typeof candidate.category === "string" ? candidate.category : null,
    tvl_usd: typeof candidate.tvl_usd === "number" && Number.isFinite(candidate.tvl_usd) ? candidate.tvl_usd : null,
    safe_apy_30d:
      typeof candidate.safe_apy_30d === "number" && Number.isFinite(candidate.safe_apy_30d) ? candidate.safe_apy_30d : null,
    momentum_7d_30d:
      typeof candidate.momentum_7d_30d === "number" && Number.isFinite(candidate.momentum_7d_30d)
        ? candidate.momentum_7d_30d
        : null,
    consistency_score:
      typeof candidate.consistency_score === "number" && Number.isFinite(candidate.consistency_score)
        ? candidate.consistency_score
        : null,
    risk_level: typeof candidate.risk_level === "string" ? candidate.risk_level : null,
    is_retired: Boolean(candidate.is_retired),
    is_highlighted: Boolean(candidate.is_highlighted),
    migration_available: Boolean(candidate.migration_available),
    strategies_count:
      typeof candidate.strategies_count === "number" && Number.isFinite(candidate.strategies_count)
        ? candidate.strategies_count
        : 0,
    regime: typeof candidate.regime === "string" && candidate.regime.length > 0 ? candidate.regime : "unknown",
  };
}

function normalizeRiskMix(raw: unknown): Array<{ risk_level: string; vaults: number; tvl_usd: number | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry) => ({
      risk_level: typeof entry.risk_level === "string" && entry.risk_level.length > 0 ? entry.risk_level : "unknown",
      vaults: typeof entry.vaults === "number" && Number.isFinite(entry.vaults) ? entry.vaults : 0,
      tvl_usd: typeof entry.tvl_usd === "number" && Number.isFinite(entry.tvl_usd) ? entry.tvl_usd : null,
    }));
}

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

function compactRiskCellLabel(
  row: Pick<DiscoverRow, "risk_level" | "strategies_count" | "migration_available" | "is_highlighted" | "is_retired">,
  compact: boolean,
): string {
  if (!compact) {
    return `${riskLevelLabel(row.risk_level)}${row.strategies_count > 0 ? ` · ${row.strategies_count} strat` : ""}${row.migration_available ? " · Migr" : ""}${row.is_highlighted ? " · High" : ""}${row.is_retired ? " · Ret" : ""}`;
  }
  const base =
    row.risk_level === null || row.risk_level === undefined || row.risk_level === "" || row.risk_level === "unknown"
      ? "Unk."
      : row.risk_level === "-1"
        ? "U"
        : row.risk_level;
  const parts = [base];
  if (row.strategies_count > 0) parts.push(`${row.strategies_count}s`);
  if (row.migration_available) parts.push("M");
  if (row.is_highlighted) parts.push("H");
  if (row.is_retired) parts.push("R");
  return parts.join(" · ");
}

function compactRegimeLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.toLowerCase();
  if (key === "rising") return "Rising";
  if (key === "falling") return "Falling";
  if (key === "stable") return "Stable";
  if (key === "choppy") return "Choppy";
  return value;
}

function DiscoverRidgeline({
  title,
  series,
}: {
  title: string;
  series: Array<{ id: string; label: string; values: number[]; note: string }>;
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const ridgelinePalette = [
    { stroke: "var(--viz-line-2)", fill: "rgba(var(--accent-rgb), 0.24)" },
    { stroke: "var(--viz-line-5)", fill: "rgba(var(--accent-teal-rgb), 0.22)" },
    { stroke: "var(--viz-line-4)", fill: "rgba(var(--accent-purple-rgb), 0.22)" },
    { stroke: "var(--viz-line-3)", fill: "rgba(var(--accent-2-rgb), 0.2)" },
  ];
  const valid = series.filter((row) => row.values.length >= 4).slice(0, 6);
  if (valid.length === 0) {
    return (
      <section className="viz-panel discover-ridgeline-panel">
        <h3>{title}</h3>
        <p className="muted">Need more APY samples for distribution curves.</p>
      </section>
    );
  }
  const width = 920;
  const rowH = valid.length >= 5 ? 28 : 32;
  const maxLabelChars = valid.reduce((acc, row) => Math.max(acc, row.label.length), 0);
  const maxNoteChars = valid.reduce((acc, row) => Math.max(acc, row.note.length), 0);
  const chartLeft = Math.round(width * Math.max(0.102, Math.min(0.172, 0.036 + maxLabelChars * 0.0072)));
  const chartRight = Math.round(width * Math.max(0.104, Math.min(0.188, 0.048 + maxNoteChars * 0.0068)));
  const chartWidth = Math.max(220, width - chartLeft - chartRight);
  const peakHeight = Math.max(8, Math.min(11, rowH * 0.38));
  const height = 8 + valid.length * rowH + 16;
  const bins = Math.max(14, Math.min(20, Math.round(chartWidth / 48)));
  const allValues = valid.flatMap((row) => row.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(0.0001, max - min);

  return (
    <section ref={ref} className={`viz-panel discover-ridgeline-panel ${isInView ? "is-in-view" : ""}`.trim()}>
      <h3>{title}</h3>
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {valid.map((row, idx) => {
            const tone = ridgelinePalette[idx % ridgelinePalette.length];
            const yBase = 8 + idx * rowH + peakHeight + 3;
            const counts = new Array<number>(bins).fill(0);
            for (const value of row.values) {
              const bucket = Math.max(0, Math.min(bins - 1, Math.floor(((value - min) / span) * bins)));
              counts[bucket] += 1;
            }
            const maxCount = Math.max(1, ...counts);
            const pathTop = counts
              .map((count, bIdx) => {
                const x = chartLeft + (bIdx / (bins - 1)) * chartWidth;
                const y = yBase - (count / maxCount) * peakHeight;
                return `${bIdx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ");
            const pathBottom = counts
              .map((_, bIdx) => {
                const rev = bins - 1 - bIdx;
                const x = chartLeft + (rev / (bins - 1)) * chartWidth;
                return `L${x.toFixed(2)},${yBase.toFixed(2)}`;
              })
              .join(" ");
            return (
              <g key={row.id}>
                <title>{`${row.label}\n${row.note}\nAPY range ${formatPct(min, 1)} to ${formatPct(max, 1)}`}</title>
                <path d={`${pathTop} ${pathBottom} Z`} fill={tone.fill} stroke={tone.stroke} strokeWidth={0.9} className="ridgeline-curve" />
                <text x={8} y={yBase - 0.5} className="ridgeline-label" dominantBaseline="central">{row.label}</text>
                <text x={width - 8} y={yBase - 0.5} className="ridgeline-note" textAnchor="end" dominantBaseline="central">{row.note}</text>
              </g>
            );
          })}
          <line x1={chartLeft} x2={width - chartRight} y1={height - 12} y2={height - 12} className="viz-axis" />
          <text x={chartLeft} y={height - 2} className="ridgeline-axis">{formatPct(min, 1)}</text>
          <text x={width - chartRight} y={height - 2} className="ridgeline-axis" textAnchor="end">{formatPct(max, 1)}</text>
        </svg>
      </div>
      <p className="muted viz-legend">Ridgelines show APY shape by chain. Taller peaks mean more vaults at that APY zone.</p>
    </section>
  );
}

function DiscoverPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [trends, setTrends] = useState<DailyTrendRow[]>([]);
  const [trendGrouped, setTrendGrouped] = useState<DailyTrendResponse["grouped"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const query = useMemo(() => {
    const serverSort = queryChoice<DiscoverApiSort>(
      searchParams,
      "api_sort",
      ["quality", "tvl", "apy_7d", "apy_30d", "momentum", "consistency"] as const,
      "quality",
    );
    const serverDir = queryChoice(searchParams, "api_dir", ["asc", "desc"] as const, "desc");
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
      migrationOnly: queryBool(searchParams, "migration_only", false),
      highlightedOnly: queryBool(searchParams, "highlighted_only", false),
      trendGroup: queryChoice(searchParams, "trend_group", ["none", "chain", "category"] as const, "none"),
      serverSort,
      serverDir,
    };
  }, [searchParams]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

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
        if (query.migrationOnly) params.set("migration_only", "true");
        if (query.highlightedOnly) params.set("highlighted_only", "true");
        const res = await fetch(apiUrl("/discover", params), { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const raw = (await res.json()) as Partial<DiscoverResponse>;
        const normalizedRows = Array.isArray(raw.rows) ? raw.rows.map(normalizeDiscoverRow).filter((row): row is DiscoverRow => row !== null) : [];
        const paginationRaw = raw.pagination;
        const safePagination =
          paginationRaw && typeof paginationRaw === "object"
            ? {
                total:
                  typeof paginationRaw.total === "number" && Number.isFinite(paginationRaw.total)
                    ? paginationRaw.total
                    : normalizedRows.length,
                limit:
                  typeof paginationRaw.limit === "number" && Number.isFinite(paginationRaw.limit)
                    ? paginationRaw.limit
                    : query.limit,
                offset:
                  typeof paginationRaw.offset === "number" && Number.isFinite(paginationRaw.offset)
                    ? paginationRaw.offset
                    : 0,
              }
            : { total: normalizedRows.length, limit: query.limit, offset: 0 };
        const payload: DiscoverResponse = {
          pagination: safePagination,
          rows: normalizedRows,
          summary: normalizeSummary(raw.summary),
          coverage: normalizeCoverage(raw.coverage),
          risk_mix: normalizeRiskMix(raw.risk_mix),
        };
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

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          days: "90",
        });
        if (query.chain) params.set("chain_id", String(query.chain));
        params.set("group_by", query.trendGroup);
        if (query.trendGroup !== "none") params.set("group_limit", "8");
        const res = await fetch(apiUrl("/trends/daily", params), { cache: "no-store" });
        if (!res.ok) {
          if (active) setTrendError(`Trends API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as DailyTrendResponse;
        if (!active) return;
        setTrends(Array.isArray(payload.rows) ? payload.rows : []);
        setTrendGrouped(payload.grouped ?? null);
        setTrendError(null);
      } catch (err) {
        if (active) setTrendError(`Trends load failed: ${String(err)}`);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [query.universe, query.minTvl, query.minPoints, query.chain, query.trendGroup]);

  const rows = data?.rows ?? [];
  const dataRows = useMemo(() => data?.rows ?? [], [data?.rows]);

  const availableChains = useMemo(
    () => Array.from(new Set(dataRows.map((row) => row.chain_id))).sort((a, b) => a - b),
    [dataRows],
  );
  const availableCategories = useMemo(
    () => Array.from(new Set(dataRows.map((row) => row.category).filter((value): value is string => Boolean(value)))).sort(),
    [dataRows],
  );
  const availableTokens = useMemo(
    () => Array.from(new Set(dataRows.map((row) => row.token_symbol).filter((value): value is string => Boolean(value)))).sort(),
    [dataRows],
  );
  const scatterRows = useMemo(
    () =>
      [...dataRows]
        .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
        .slice(0, isCompactViewport ? 70 : 120),
    [dataRows, isCompactViewport],
  );
  const chainRidgelineSeries = useMemo(() => {
    const groups = new Map<number, { values: number[]; tvl: number }>();
    for (const row of dataRows) {
      if (row.safe_apy_30d === null || row.safe_apy_30d === undefined || !Number.isFinite(row.safe_apy_30d)) continue;
      const entry = groups.get(row.chain_id) ?? { values: [], tvl: 0 };
      entry.values.push(Number(row.safe_apy_30d));
      entry.tvl += Number(row.tvl_usd ?? 0);
      groups.set(row.chain_id, entry);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].tvl - a[1].tvl)
      .slice(0, 4)
      .map(([chainId, entry]) => ({
        id: `ridge-${chainId}`,
        label: chainLabel(chainId),
        values: entry.values,
        note: `${entry.values.length}v ${formatUsdCompact(entry.tvl)}`,
      }));
  }, [dataRows]);
  const chainMomentumHeat = useMemo(() => {
    const byChain = new Map<number, { tvl: number; weightedMomentum: number; weightedApy: number; vaults: number }>();
    for (const row of dataRows) {
      const tvl = row.tvl_usd ?? 0;
      const momentum = row.momentum_7d_30d ?? 0;
      const apy = row.safe_apy_30d ?? 0;
      const existing = byChain.get(row.chain_id) ?? { tvl: 0, weightedMomentum: 0, weightedApy: 0, vaults: 0 };
      existing.vaults += 1;
      existing.tvl += tvl;
      if (Number.isFinite(momentum)) {
        existing.weightedMomentum += momentum * tvl;
      }
      if (Number.isFinite(apy)) {
        existing.weightedApy += apy * tvl;
      }
      byChain.set(row.chain_id, existing);
    }
    return [...byChain.entries()]
      .map(([chainId, entry]) => {
        const weight = entry.tvl > 0 ? entry.tvl : 1;
        return {
          id: String(chainId),
          label: chainLabel(chainId),
          value: entry.weightedMomentum / weight,
          note: `${formatUsd(entry.tvl)} TVL • APY ${formatPct(entry.weightedApy / weight)}`,
        };
      })
      .sort((left, right) => {
        const leftValue = left.value ?? Number.NEGATIVE_INFINITY;
        const rightValue = right.value ?? Number.NEGATIVE_INFINITY;
        return rightValue - leftValue;
      })
      .slice(0, isCompactViewport ? 8 : 12);
  }, [dataRows, isCompactViewport]);
  const tokenSpreadHeat = useMemo(() => {
    const byToken = new Map<string, { tvl: number; apys: number[]; venues: number }>();
    for (const row of dataRows) {
      if (!row.token_symbol) continue;
      const existing = byToken.get(row.token_symbol) ?? { tvl: 0, apys: [], venues: 0 };
      existing.venues += 1;
      existing.tvl += row.tvl_usd ?? 0;
      if (row.safe_apy_30d !== null && row.safe_apy_30d !== undefined && Number.isFinite(row.safe_apy_30d)) {
        existing.apys.push(row.safe_apy_30d);
      }
      byToken.set(row.token_symbol, existing);
    }
    return [...byToken.entries()]
      .map(([token, entry]) => {
        if (entry.apys.length < 2) return null;
        const min = Math.min(...entry.apys);
        const max = Math.max(...entry.apys);
        return {
          id: token,
          label: token,
          value: max - min,
          note: `${entry.venues} venues • ${formatUsd(entry.tvl)} TVL`,
          tvl: entry.tvl,
        };
      })
      .filter((item): item is { id: string; label: string; value: number; note: string; tvl: number } => item !== null)
      .sort((left, right) => right.tvl - left.tvl)
      .slice(0, isCompactViewport ? 8 : 12)
      .map(({ id, label, value, note }) => ({ id, label, value, note }));
  }, [dataRows, isCompactViewport]);
  const momentumQuadrantHeat = useMemo(() => {
    const apyValues = dataRows
      .map((row) => row.safe_apy_30d)
      .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value))
      .sort((a, b) => a - b);
    const medianApy = apyValues.length > 0 ? apyValues[Math.floor(apyValues.length / 2)] : 0;
    const bins = new Map<
      string,
      { label: string; count: number; tvl: number; note: string; order: number }
    >([
      ["hi_up", { label: "High APY + Positive Momentum", count: 0, tvl: 0, note: "Yield high and still improving", order: 0 }],
      ["lo_up", { label: "Low APY + Positive Momentum", count: 0, tvl: 0, note: "Yield still low but improving", order: 1 }],
      ["hi_down", { label: "High APY + Negative Momentum", count: 0, tvl: 0, note: "Yield high but cooling", order: 2 }],
      ["lo_down", { label: "Low APY + Negative Momentum", count: 0, tvl: 0, note: "Yield low and weakening", order: 3 }],
    ]);
    for (const row of dataRows) {
      if (row.safe_apy_30d === null || row.safe_apy_30d === undefined) continue;
      if (row.momentum_7d_30d === null || row.momentum_7d_30d === undefined) continue;
      const hi = row.safe_apy_30d >= medianApy;
      const up = row.momentum_7d_30d >= 0;
      const key = hi ? (up ? "hi_up" : "hi_down") : up ? "lo_up" : "lo_down";
      const item = bins.get(key);
      if (!item) continue;
      item.count += 1;
      item.tvl += row.tvl_usd ?? 0;
    }
    return [...bins.entries()]
      .sort((left, right) => left[1].order - right[1].order)
      .map(([id, item]) => ({
        id,
        label: item.label,
        value: item.count,
        note: `${item.note} • ${formatUsd(item.tvl)} TVL`,
      }));
  }, [dataRows]);
  const trendSlice = useMemo(() => trends.slice(Math.max(0, trends.length - 60)), [trends]);
  const apyBucketTrendItems = useMemo(
    () => [
      {
        id: "neg",
        label: "Negative APY share",
        points: trendSlice.map((row) => row.bucket_neg_ratio),
        note: "Share of eligible vaults with APY below 0%",
      },
      {
        id: "low",
        label: "Low APY share (0-5%)",
        points: trendSlice.map((row) => row.bucket_low_ratio),
        note: "Share of vaults in the 0% to <5% APY bucket",
      },
      {
        id: "mid",
        label: "Mid APY share (5-15%)",
        points: trendSlice.map((row) => row.bucket_mid_ratio),
        note: "Share of vaults in the 5% to <15% APY bucket",
      },
      {
        id: "high",
        label: "High APY share (15%+)",
        points: trendSlice.map((row) => row.bucket_high_ratio),
        note: "Share of vaults at 15% APY or above",
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
        note: "TVL-weighted protocol APY using the latest 7-day window",
      },
      {
        id: "apy30",
        label: "Weighted APY 30d",
        points: trendSlice.map((row) => row.weighted_apy_30d),
        note: "TVL-weighted APY baseline used for bucket labels",
      },
      {
        id: "apy90",
        label: "Weighted APY 90d",
        points: trendSlice.map((row) => row.weighted_apy_90d),
        note: "Longer-run APY context for trend direction",
      },
    ],
    [trendSlice],
  );
  const groupedWeightedApyTrendItems = useMemo(() => {
    const latest = trendGrouped?.latest ?? [];
    const series = trendGrouped?.series ?? {};
    const groupBy = trendGrouped?.group_by ?? "none";
    const ranked = [...latest]
      .filter((row) => row.group_key && row.group_key !== "unknown")
      .sort((left, right) => (right.total_tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.total_tvl_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, 6);
    return ranked.map((row) => {
      const key = row.group_key;
      const label = groupBy === "chain" ? chainLabel(Number(key)) : key;
      return {
        id: `group-apy-${key}`,
        label,
        points: (series[key] ?? []).map((entry) => entry.weighted_apy_30d),
        note: `Latest APY 30d ${formatPct(row.weighted_apy_30d)} • TVL ${formatUsd(row.total_tvl_usd)}`,
      };
    });
  }, [trendGrouped]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  return (
    <main className="container">
      <section className="hero">
        <h1>Discover</h1>
        <p className="muted">
          Scan yield opportunities with filters for size, data quality, and trend direction.
        </p>
      </section>

      <PageTopPanel
        intro={
          <>
            <p className="muted card-intro">
              APY here is an estimate from Price Per Share history, not a guaranteed forward rate. Momentum means 7-day APY minus
              30-day APY, so positive momentum means yield improved recently.
            </p>
            <p className="muted">
              Lifecycle flags come from yDaemon metadata: highlighted means promoted, migration ready means a newer vault target
              exists, and retired means legacy or phasing out.
            </p>
          </>
        }
        filtersIntro={<p className="muted card-intro">All controls are encoded in the URL, so this exact view is shareable.</p>}
        filters={
          <div className="inline-controls controls-tight">
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
              Sort:&nbsp;
              <select value={query.serverSort} onChange={(event) => updateQuery({ api_sort: event.target.value })}>
                <option value="quality">Quality</option>
                <option value="tvl">TVL</option>
                <option value="apy_30d">APY 30d</option>
                <option value="momentum">Momentum</option>
                <option value="consistency">Consistency</option>
              </select>
            </label>
            <label>
              Direction:&nbsp;
              <select value={query.serverDir} onChange={(event) => updateQuery({ api_dir: event.target.value })}>
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
          </div>
        }
        secondaryFilters={
          <div className="inline-controls controls-tight">
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
              Trend View:&nbsp;
              <select value={query.trendGroup} onChange={(event) => updateQuery({ trend_group: event.target.value })}>
                <option value="none">Global</option>
                <option value="chain">By Chain</option>
                <option value="category">By Category</option>
              </select>
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
          </div>
        }
        secondaryFiltersTitle="Segmentation Filters"
      />

      {error ? <section className="card">{error}</section> : null}
      {trendError ? <section className="card">{trendError}</section> : null}

      {!error && !data?.rows?.length ? (
        <section className="card">
          <h2>No Vaults Match This Filter Yet</h2>
          <p className="muted card-intro">
            This usually means current filters are too strict for the latest ingestion cycle, not that the protocol has no vaults.
          </p>
          <p className="muted">
            Try lowering <strong>Min TVL</strong>, lowering <strong>Min Points</strong>, or changing <strong>Universe</strong>.
            If most cards still show n/a after that, wait for the next ingestion cycle.
          </p>
        </section>
      ) : null}

      <section className="card discover-universe-card">
        <h2>Universe Snapshot</h2>
        <p className="muted card-intro">
          Current size and quality profile for the filtered vault universe. Coverage below separates vaults with enough PPS history
          from visible vaults that are still missing or too thin for APY scoring.
        </p>
        <div className="discover-universe-layout">
          <div className="discover-kpis">
          <KpiGrid
            items={[
              { label: "Vaults", value: String(data?.summary?.vaults ?? data?.pagination.total ?? "n/a") },
              { label: "Chains", value: String(data?.summary?.chains ?? "n/a") },
              { label: "Tokens", value: String(data?.summary?.tokens ?? "n/a") },
              { label: "Median APY", value: formatPct(data?.summary?.median_safe_apy_30d) },
              {
                label: "Metric Coverage",
                value: formatPct(data?.coverage?.coverage_ratio, 0),
                hint:
                  data?.coverage?.with_metrics !== undefined && data?.coverage?.visible_vaults !== undefined
                    ? `${data.coverage.with_metrics}/${data.coverage.visible_vaults} visible vaults scoreable`
                    : "Visible vaults with enough PPS history for APY",
              },
              {
                label: "Avg Momentum",
                value: formatPct(data?.summary?.avg_momentum_7d_30d),
                hint: "7d APY minus 30d APY; positive means improving",
              },
              {
                label: "Avg Consistency",
                value: formatPct(data?.summary?.avg_consistency_score),
                hint: "Higher means steadier yield behavior",
              },
              {
                label: "Avg Strategies",
                value: formatFixed(data?.summary?.avg_strategies_per_vault, 2),
                hint: "Average number of strategy slots per vault",
              },
              { label: "Migration Ready", value: String(data?.summary?.migration_ready_vaults ?? "n/a") },
              { label: "Highlighted", value: String(data?.summary?.highlighted_vaults ?? "n/a") },
              {
                label: "Needs More History",
                value: String(data?.coverage?.missing_or_low_points ?? "n/a"),
                hint: "Visible vaults missing metrics or still below the point threshold",
              },
            ]}
          />
          </div>
          <div className="discover-mix-grid">
            <BarList
              title="APY Bucket Count"
              items={[
                { id: "neg", label: "Negative APY", value: data?.summary?.apy_negative_vaults ?? null },
                { id: "low", label: "0% to <5%", value: data?.summary?.apy_low_vaults ?? null },
                { id: "mid", label: "5% to <15%", value: data?.summary?.apy_mid_vaults ?? null },
                { id: "high", label: "15% and above", value: data?.summary?.apy_high_vaults ?? null },
                {
                  id: "unknown",
                  label: "Unknown / thin history",
                  value: data?.coverage?.missing_or_low_points ?? null,
                  note: "Visible vaults missing metrics or still below the point threshold",
                },
              ]}
              valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
              emptyText="No APY bucket counts for this filter yet."
            />
            <div className="analyst-only">
              <BarList
                title="Risk Level Mix (TVL)"
                items={(data?.risk_mix ?? []).map((row) => ({
                  id: String(row.risk_level),
                  label: riskLevelLabel(row.risk_level),
                  value: row.tvl_usd,
                  note: `${row.vaults} vaults`,
                }))}
                valueFormatter={(value) => formatUsd(value)}
                emptyText="No risk mix for this filter yet."
              />
            </div>
          </div>
        </div>
        <p className="muted card-intro">
          Unknown APY means the vault is visible in scope but still missing enough PPS history to score. Regime mix is shown on the
          Regimes page to avoid duplicated charts.
        </p>
      </section>

      <section className="card discover-analytics-card">
        <h2>Yield Structure and Trend Maps</h2>
        <p className="muted card-intro">
          Visual view of yield level, momentum direction, and concentration patterns in the current filtered universe.
        </p>
        <div className="discover-visual-grid">
          <ScatterPlot
            className="discover-main-scatter"
            title="APY vs Momentum Map (Top TVL Vaults)"
            xLabel="Momentum (percentage points: 7-day APY minus 30-day APY)"
            yLabel="APY over last 30 days (percent)"
            points={scatterRows.map((row) => ({
              id: row.vault_address,
              x: row.momentum_7d_30d,
              y: row.safe_apy_30d,
              size: row.tvl_usd,
              href: yearnVaultUrl(row.chain_id, row.vault_address),
              tooltip:
                `${row.symbol || row.vault_address}\n${chainLabel(row.chain_id)}\n` +
                `APY 30d: ${formatPct(row.safe_apy_30d)}\nMomentum: ${formatPct(row.momentum_7d_30d)}\nTVL: ${formatUsd(row.tvl_usd)}`,
              tone:
                row.momentum_7d_30d !== null && row.momentum_7d_30d !== undefined
                  ? row.momentum_7d_30d >= 0
                    ? "positive"
                    : "negative"
                  : "neutral",
            }))}
            xFormatter={(value) => formatPct(value, 1)}
            yFormatter={(value) => formatPct(value, 1)}
          />
          <div className="discover-quadrants-grid">
            <HeatGrid
              title="Yield-Momentum Quadrants"
              items={momentumQuadrantHeat}
              valueFormatter={(value) => (value === null || value === undefined ? "n/a" : value.toLocaleString("en-US"))}
            />
            <HeatGrid
              title="Token APY Dispersion Heatmap"
              items={tokenSpreadHeat}
              valueFormatter={(value) => formatPct(value)}
              emptyText="Need at least two venues per token to compute APY spread."
            />
          </div>
          <div className="discover-chain-heatmap analyst-only">
            <HeatGrid
              title="Chain Momentum Heatmap"
              items={chainMomentumHeat}
              valueFormatter={(value) => formatPct(value)}
              emptyText="No chain momentum values for this filter yet."
            />
          </div>
          <div className="discover-trend-card analyst-only">
            <TrendStrips
              title="APY Bucket Drift (Last 60 Days)"
              items={apyBucketTrendItems}
              valueFormatter={(value) => formatPct(value, 1)}
              deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 1)}`}
              emptyText="Trend rows unavailable for this filter."
            />
          </div>
          <div className="discover-trend-card analyst-only">
            <TrendStrips
              title={
                query.trendGroup === "none"
                  ? "Weighted APY Trend (7d / 30d / 90d)"
                  : `Weighted APY 30d Trend (${query.trendGroup === "chain" ? "By Chain" : "By Category"})`
              }
              items={query.trendGroup === "none" ? weightedApyTrendItems : groupedWeightedApyTrendItems}
              valueFormatter={(value) => formatPct(value, 2)}
              deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
              emptyText={
                query.trendGroup === "none"
                  ? "Weighted APY trend unavailable for this filter."
                  : "Grouped APY trend unavailable for this filter."
              }
            />
          </div>
          <div className="discover-ridgeline analyst-only">
            <DiscoverRidgeline title="APY Distribution Ridgelines (Top Chains by TVL)" series={chainRidgelineSeries} />
          </div>
        </div>
        <p className="muted discover-analytics-note">Delta compares the latest point against the previous day.</p>
      </section>

      <section className="card">
        <h2>Vault Universe</h2>
        <p className="muted card-intro">
          Filtered vaults with enough TVL and data history to reduce noisy outliers. Sort order follows the API sort controls above.
          Switch to Pro mode for extra context columns. Rows:{" "}
          {data?.pagination.total ?? "loading..."}
        </p>
        <div className="table-wrap">
          <table className="discover-table">
            <thead>
              <tr>
                <th className="col-vault">Vault</th>
                <th className="col-chain">Chain</th>
                <th className="col-token">Token</th>
                <th className="analyst-only col-category">Category</th>
                <th className="is-numeric col-tvl">TVL</th>
                <th className="is-numeric col-apy">APY 30d</th>
                <th className="is-numeric col-momentum">Momentum</th>
                <th className="is-numeric tablet-hide analyst-only col-consistency">Consistency</th>
                <th className="tablet-hide analyst-only col-risk">Risk</th>
                <th className="analyst-only col-regime">Regime</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.vault_address}>
                  <td className="col-vault"><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td className="col-chain" title={chainLabel(row.chain_id)}>
                    <Link
                      href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      scroll={false}
                    >
                      {compactChainLabel(row.chain_id, isCompactViewport)}
                    </Link>
                  </td>
                  <td className="col-token">
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                        title="Open token venues in Assets"
                      >
                        {row.token_symbol} ↗
                      </Link>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td className="analyst-only col-category" title={row.category || "n/a"}>
                    {compactCategoryLabel(row.category, isCompactViewport)}
                  </td>
                  <td className="is-numeric col-tvl">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric col-apy">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric col-momentum">{formatPct(row.momentum_7d_30d)}</td>
                  <td className="is-numeric tablet-hide analyst-only col-consistency">{formatPct(row.consistency_score)}</td>
                  <td
                    className="tablet-hide analyst-only col-risk"
                    title={`${riskLevelLabel(row.risk_level)}${row.strategies_count > 0 ? ` · ${row.strategies_count} strat` : ""}${row.migration_available ? " · Migr" : ""}${row.is_highlighted ? " · High" : ""}${row.is_retired ? " · Ret" : ""}`}
                  >
                    {compactRiskCellLabel(row, isCompactViewport)}
                  </td>
                  <td className="analyst-only col-regime" title={compactRegimeLabel(row.regime)}>{compactRegimeLabel(row.regime)}</td>
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
