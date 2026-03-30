"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, compactChainLabel, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, ScatterPlot, useInViewOnce } from "../components/visuals";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { useCompositionData } from "../hooks/use-composition-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";

type BreakdownRow = {
  chain_id?: number;
  category?: string;
  token_symbol?: string;
  vaults: number;
  tvl_usd: number | null;
  share_tvl?: number | null;
  weighted_safe_apy_30d?: number | null;
};

type CrowdingRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  safe_apy_30d: number | null;
  crowding_index: number | null;
};

type ChainSortKey = "chain" | "vaults" | "tvl" | "share" | "apy";
type CategorySortKey = "category" | "vaults" | "tvl" | "share" | "apy";
type TokenSortKey = "token" | "vaults" | "tvl" | "share" | "apy";
type CrowdingSortKey = "vault" | "chain" | "token" | "category" | "tvl" | "apy" | "crowding";

function formatUsdCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function TvlTreemap({
  title,
  chains,
  categories,
  tokens,
}: {
  title: string;
  chains: BreakdownRow[];
  categories: BreakdownRow[];
  tokens: BreakdownRow[];
}) {
  const { ref, isInView } = useInViewOnce<HTMLElement>();
  const width = 820;
  const height = 168;
  const topChains = [...chains]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
    .slice(0, 6);
  const topCategories = [...categories]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
    .slice(0, 6);
  const topTokens = [...tokens]
    .filter((row) => (row.tvl_usd ?? 0) > 0)
    .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
    .slice(0, 8);
  const groups = [
    { key: "chain", label: "Chain", color: "rgba(100, 150, 255, 0.78)", rows: topChains, text: (row: BreakdownRow) => chainLabel(row.chain_id) },
    { key: "category", label: "Category", color: "rgba(100, 200, 180, 0.7)", rows: topCategories, text: (row: BreakdownRow) => row.category || "unknown" },
    { key: "token", label: "Token", color: "rgba(180, 120, 220, 0.72)", rows: topTokens, text: (row: BreakdownRow) => row.token_symbol || "unknown" },
  ];
  const validGroups = groups.filter((group) => group.rows.length > 0);
  if (validGroups.length === 0) {
    return (
      <section style={{ padding: "24px" }}>
        <h3>{title}</h3>
        <p style={{ color: "var(--text-secondary)" }}>No composition rows available.</p>
      </section>
    );
  }
  const laneGap = Math.max(7, Math.round(height * 0.04));
  const laneHeight = (height - 12 - (validGroups.length - 1) * laneGap) / validGroups.length;

  return (
    <section ref={ref} style={{ padding: "24px", opacity: isInView ? 1 : 0.9, transition: "opacity 0.3s" }}>
      <h3 className="card-title">{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: "100%", minWidth: "600px", height: "auto" }}>
          {validGroups.map((group, groupIndex) => {
            const y = 5 + groupIndex * (laneHeight + laneGap);
            const total = group.rows.reduce((acc, row) => acc + Number(row.tvl_usd ?? 0), 0);
            const labelOffset = Math.max(68, Math.min(98, Math.round(width * 0.095)));
            const laneWidth = width - labelOffset - 8;
            const scaledWidths = group.rows.map((row) => {
              const value = Number(row.tvl_usd ?? 0);
              return total > 0 ? (value / total) * laneWidth : 0;
            });
            let x = 0;
            return (
              <g key={group.key}>
                <text x={2} y={y + laneHeight / 2 + 0.5} style={{ fontSize: "11px", fill: "var(--text-secondary)" }} dominantBaseline="central">
                  {group.label}
                </text>
                {group.rows.map((row, rowIndex) => {
                  const targetWidth = scaledWidths[rowIndex] ?? 0;
                  const w = rowIndex === group.rows.length - 1 ? Math.max(0, laneWidth - x) : Math.max(0, targetWidth);
                  const rectX = labelOffset + x;
                  x += w;
                  const name = group.text(row);
                  const maxChars = Math.max(0, Math.floor((w - 10) / 5.8));
                  const compactName = maxChars > 0 ? (name.length > maxChars ? `${name.slice(0, Math.max(2, maxChars - 1))}…` : name) : "";
                  return (
                    <g key={`${group.key}-${name}`}>
                      <rect
                        x={rectX}
                        y={y}
                        width={w}
                        height={laneHeight}
                        fill={group.color}
                        opacity={0.85}
                        stroke="var(--border)"
                        style={{ transition: "all 0.2s" } as CSSProperties}
                      />
                      {w >= 54 && compactName ? (
                        <text x={rectX + 5} y={y + Math.min(18, laneHeight - 6)} style={{ fontSize: "10px", fill: "var(--text-primary)" }}>
                          {compactName}
                        </text>
                      ) : null}
                      <title>{`${group.label}: ${name}\nTVL: ${formatUsd(row.tvl_usd)}\nShare: ${formatPct(row.share_tvl, 1)}`}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "12px" }}>
        Treemap lanes show top TVL contributors by chain, category, and token.
      </p>
    </section>
  );
}

function CompositionPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [chainSort, setChainSort] = useState<SortState<ChainSortKey>>({ key: "tvl", direction: "desc" });
  const [categorySort, setCategorySort] = useState<SortState<CategorySortKey>>({ key: "tvl", direction: "desc" });
  const [tokenSort, setTokenSort] = useState<SortState<TokenSortKey>>({ key: "tvl", direction: "desc" });
  const [crowdedSort, setCrowdedSort] = useState<SortState<CrowdingSortKey>>({ key: "crowding", direction: "desc" });
  const [uncrowdedSort, setUncrowdedSort] = useState<SortState<CrowdingSortKey>>({ key: "crowding", direction: "asc" });
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
      topN: queryInt(searchParams, "top_n", 12, { min: 3, max: 50 }),
      crowdingLimit: queryInt(searchParams, "crowding_limit", 15, { min: 5, max: 80 }),
      chainSort: queryChoice<ChainSortKey>(searchParams, "chain_sort", ["chain", "vaults", "tvl", "share", "apy"] as const, "tvl"),
      chainDir: queryChoice(searchParams, "chain_dir", ["asc", "desc"] as const, "desc"),
      categorySort: queryChoice<CategorySortKey>(searchParams, "category_sort", ["category", "vaults", "tvl", "share", "apy"] as const, "tvl"),
      categoryDir: queryChoice(searchParams, "category_dir", ["asc", "desc"] as const, "desc"),
      tokenSort: queryChoice<TokenSortKey>(searchParams, "token_sort", ["token", "vaults", "tvl", "share", "apy"] as const, "tvl"),
      tokenDir: queryChoice(searchParams, "token_dir", ["asc", "desc"] as const, "desc"),
      crowdedSort: queryChoice<CrowdingSortKey>(searchParams, "crowded_sort", ["vault", "chain", "token", "category", "tvl", "apy", "crowding"] as const, "crowding"),
      crowdedDir: queryChoice(searchParams, "crowded_dir", ["asc", "desc"] as const, "desc"),
      uncrowdedSort: queryChoice<CrowdingSortKey>(searchParams, "uncrowded_sort", ["vault", "chain", "token", "category", "tvl", "apy", "crowding"] as const, "crowding"),
      uncrowdedDir: queryChoice(searchParams, "uncrowded_dir", ["asc", "desc"] as const, "asc"),
    };
  }, [searchParams]);

  useEffect(() => {
    setChainSort({ key: query.chainSort, direction: query.chainDir });
    setCategorySort({ key: query.categorySort, direction: query.categoryDir });
    setTokenSort({ key: query.tokenSort, direction: query.tokenDir });
    setCrowdedSort({ key: query.crowdedSort, direction: query.crowdedDir });
    setUncrowdedSort({ key: query.uncrowdedSort, direction: query.uncrowdedDir });
  }, [query]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsCompactViewport(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const { data, isLoading, error } = useCompositionData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const chainRows = sortRows(data?.chains ?? [], chainSort, {
    chain: (row) => chainLabel(row.chain_id),
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    share: (row) => row.share_tvl ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });

  const categoryRows = sortRows(data?.categories ?? [], categorySort, {
    category: (row) => row.category ?? "",
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    share: (row) => row.share_tvl ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });

  const tokenRows = sortRows(data?.tokens ?? [], tokenSort, {
    token: (row) => row.token_symbol ?? "",
    vaults: (row) => row.vaults,
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    share: (row) => row.share_tvl ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.weighted_safe_apy_30d ?? Number.NEGATIVE_INFINITY,
  });

  const crowdedRows = sortRows(data?.crowding.most_crowded ?? [], crowdedSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    crowding: (row) => row.crowding_index ?? Number.NEGATIVE_INFINITY,
  });

  const uncrowdedRows = sortRows(data?.crowding.least_crowded ?? [], uncrowdedSort, {
    vault: (row) => row.symbol ?? row.vault_address,
    chain: (row) => chainLabel(row.chain_id),
    token: (row) => row.token_symbol ?? "",
    category: (row) => row.category ?? "",
    tvl: (row) => row.tvl_usd ?? Number.NEGATIVE_INFINITY,
    apy: (row) => row.safe_apy_30d ?? Number.NEGATIVE_INFINITY,
    crowding: (row) => row.crowding_index ?? Number.NEGATIVE_INFINITY,
  });

  const crowdingScatterRows = useMemo(() => {
    const index = new Map<string, CrowdingRow>();
    for (const row of [...(data?.crowding.most_crowded ?? []), ...(data?.crowding.least_crowded ?? [])]) {
      const key = `${row.chain_id}:${row.vault_address}`;
      const existing = index.get(key);
      if (!existing || (row.tvl_usd ?? 0) > (existing.tvl_usd ?? 0)) {
        index.set(key, row);
      }
    }
    return [...index.values()]
      .sort((left, right) => (right.tvl_usd ?? Number.NEGATIVE_INFINITY) - (left.tvl_usd ?? Number.NEGATIVE_INFINITY))
      .slice(0, isCompactViewport ? 60 : 100);
  }, [data?.crowding.least_crowded, data?.crowding.most_crowded, isCompactViewport]);

  if (error && !data) {
    return (
      <div className="card" style={{ padding: "48px" }}>
        <h2>Composition data is temporarily unavailable</h2>
        <p>The concentration feed failed to load.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Composition.
          <br />
          <em className="page-title-accent">Concentration lens.</em>
        </h1>
        <p className="page-description">
          Map where TVL concentrates and which vaults are crowded or under-densed.
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
                {UNIVERSE_VALUES.map((v) => (
                  <option key={v} value={v}>{universeLabel(v)}</option>
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
            <label>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Top Groups</span>
              <select value={query.topN} onChange={(e) => updateQuery({ top_n: Number(e.target.value) })} style={{ width: "100%", marginTop: "6px" }}>
                <option value={10}>10</option>
                <option value={12}>12</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Summary KPIs */}
      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {Array(5).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Vaults</div>
              <div className="kpi-value">{data?.summary.vaults ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Average APY 30d</div>
              <div className="kpi-value">{formatPct(data?.summary.avg_safe_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chain HHI</div>
              <div className="kpi-value">{data?.concentration.chain_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Category HHI</div>
              <div className="kpi-value">{data?.concentration.category_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Token HHI</div>
              <div className="kpi-value">{data?.concentration.token_hhi?.toFixed(3) ?? "n/a"}</div>
            </div>
          </div>
        )}
      </section>

      {/* TVL Treemap */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <TvlTreemap 
          title="TVL Treemap (Chain → Category → Token Lens)" 
          chains={chainRows} 
          categories={categoryRows} 
          tokens={tokenRows} 
        />
      </section>

      {/* APY vs TVL Scatter Plot */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">APY vs TVL Map (Crowding Context)</h2>
        </div>
        <ScatterPlot
          title=""
          xLabel="APY 30d"
          yLabel="TVL (USD)"
          points={crowdingScatterRows.map((row) => ({
            id: `${row.chain_id}:${row.vault_address}`,
            x: row.safe_apy_30d,
            y: row.tvl_usd,
            size: row.crowding_index,
            href: yearnVaultUrl(row.chain_id, row.vault_address),
            tone: (row.crowding_index ?? 0) >= 0 ? "negative" : "positive",
          }))}
          xFormatter={(value) => formatPct(value, 1)}
          yFormatter={(value) => formatUsd(value)}
        />
      </section>

      {/* Chain Concentration Table with Sorting */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Chain Concentration</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(chainSort, "chain"); setChainSort(next); updateQuery({ chain_sort: next.key, chain_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(chainSort, "chain")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(chainSort, "vaults"); setChainSort(next); updateQuery({ chain_sort: next.key, chain_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(chainSort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(chainSort, "tvl"); setChainSort(next); updateQuery({ chain_sort: next.key, chain_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(chainSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(chainSort, "share"); setChainSort(next); updateQuery({ chain_sort: next.key, chain_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Share {sortIndicator(chainSort, "share")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(chainSort, "apy"); setChainSort(next); updateQuery({ chain_sort: next.key, chain_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    APY {sortIndicator(chainSort, "apy")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : chainRows.map((row) => (
                <tr key={row.chain_id}>
                  <td>
                    <Link href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Category Concentration Table with Sorting */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Category Concentration</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(categorySort, "category"); setCategorySort(next); updateQuery({ category_sort: next.key, category_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Category {sortIndicator(categorySort, "category")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(categorySort, "vaults"); setCategorySort(next); updateQuery({ category_sort: next.key, category_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(categorySort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(categorySort, "tvl"); setCategorySort(next); updateQuery({ category_sort: next.key, category_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(categorySort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(categorySort, "share"); setCategorySort(next); updateQuery({ category_sort: next.key, category_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Share {sortIndicator(categorySort, "share")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(categorySort, "apy"); setCategorySort(next); updateQuery({ category_sort: next.key, category_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    APY {sortIndicator(categorySort, "apy")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : categoryRows.map((row) => (
                <tr key={row.category}>
                  <td>
                    {row.category ? (
                      <Link href={`/discover?category=${encodeURIComponent(row.category)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                        {row.category}
                      </Link>
                    ) : "Unknown"}
                  </td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top Tokens Table with Sorting */}
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Top Tokens by TVL</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(tokenSort, "token"); setTokenSort(next); updateQuery({ token_sort: next.key, token_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Token {sortIndicator(tokenSort, "token")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(tokenSort, "vaults"); setTokenSort(next); updateQuery({ token_sort: next.key, token_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(tokenSort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(tokenSort, "tvl"); setTokenSort(next); updateQuery({ token_sort: next.key, token_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(tokenSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(tokenSort, "share"); setTokenSort(next); updateQuery({ token_sort: next.key, token_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Share {sortIndicator(tokenSort, "share")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(tokenSort, "apy"); setTokenSort(next); updateQuery({ token_sort: next.key, token_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    APY {sortIndicator(tokenSort, "apy")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : tokenRows.slice(0, query.topN).map((row) => (
                <tr key={row.token_symbol}>
                  <td>
                    {row.token_symbol ? (
                      <Link href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                        {row.token_symbol}
                      </Link>
                    ) : "Unknown"}
                  </td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Crowding Tables with Token and Category columns */}
      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Most Crowded</h2>
        </div>
        <div className="table-wrap" style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "vault"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vault {sortIndicator(crowdedSort, "vault")}
                  </button>
                </th>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "chain"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(crowdedSort, "chain")}
                  </button>
                </th>
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "token"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Token {sortIndicator(crowdedSort, "token")}
                    </button>
                  </th>
                )}
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "category"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Category {sortIndicator(crowdedSort, "category")}
                    </button>
                  </th>
                )}
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "tvl"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(crowdedSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "apy"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    APY {sortIndicator(crowdedSort, "apy")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(crowdedSort, "crowding"); setCrowdedSort(next); updateQuery({ crowded_sort: next.key, crowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Crowding {sortIndicator(crowdedSort, "crowding")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={isCompactViewport ? 5 : 7} />
              ) : crowdedRows.slice(0, query.crowdingLimit).map((row) => (
                <tr key={row.vault_address}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td>
                    <Link href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  {!isCompactViewport && (
                    <td>
                      {row.token_symbol ? (
                        <Link href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                          {row.token_symbol}
                        </Link>
                      ) : "n/a"}
                    </td>
                  )}
                  {!isCompactViewport && <td>{row.category || "n/a"}</td>}
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-header">
          <h2 className="card-title">Least Crowded</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "vault"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vault {sortIndicator(uncrowdedSort, "vault")}
                  </button>
                </th>
                <th>
                  <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "chain"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(uncrowdedSort, "chain")}
                  </button>
                </th>
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "token"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Token {sortIndicator(uncrowdedSort, "token")}
                    </button>
                  </th>
                )}
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "category"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Category {sortIndicator(uncrowdedSort, "category")}
                    </button>
                  </th>
                )}
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "tvl"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(uncrowdedSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "apy"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    APY {sortIndicator(uncrowdedSort, "apy")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => { const next = toggleSort(uncrowdedSort, "crowding"); setUncrowdedSort(next); updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction }); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Crowding {sortIndicator(uncrowdedSort, "crowding")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={isCompactViewport ? 5 : 7} />
              ) : uncrowdedRows.slice(0, query.crowdingLimit).map((row) => (
                <tr key={row.vault_address}>
                  <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td>
                    <Link href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  {!isCompactViewport && (
                    <td>
                      {row.token_symbol ? (
                        <Link href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                          {row.token_symbol}
                        </Link>
                      ) : "n/a"}
                    </td>
                  )}
                  {!isCompactViewport && <td>{row.category || "n/a"}</td>}
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.safe_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function CompositionPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <CompositionPageContent />
    </Suspense>
  );
}
