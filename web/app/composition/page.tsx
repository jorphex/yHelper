"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, HeatGrid, KpiGrid, ScatterPlot, useInViewOnce } from "../components/visuals";
import { PageTopPanel } from "../components/page-top-panel";
import { VaultLink } from "../components/vault-link";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

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
  momentum_7d_30d: number | null;
  consistency_score: number | null;
  crowding_index: number | null;
};

type CompositionResponse = {
  summary: {
    vaults: number;
    total_tvl_usd: number | null;
    avg_safe_apy_30d: number | null;
  };
  concentration: {
    chain_hhi: number | null;
    category_hhi: number | null;
    token_hhi: number | null;
  };
  chains: BreakdownRow[];
  categories: BreakdownRow[];
  tokens: BreakdownRow[];
  crowding: {
    most_crowded: CrowdingRow[];
    least_crowded: CrowdingRow[];
  };
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
  const width = 980;
  const height = 126;
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
    { key: "chain", label: "Chain", color: "rgba(var(--accent-rgb), 0.78)", rows: topChains, text: (row: BreakdownRow) => chainLabel(row.chain_id) },
    { key: "category", label: "Category", color: "rgba(var(--accent-teal-rgb), 0.7)", rows: topCategories, text: (row: BreakdownRow) => row.category || "unknown" },
    { key: "token", label: "Token", color: "rgba(var(--accent-purple-rgb), 0.72)", rows: topTokens, text: (row: BreakdownRow) => row.token_symbol || "unknown" },
  ];
  const validGroups = groups.filter((group) => group.rows.length > 0);
  if (validGroups.length === 0) {
    return (
      <section className="viz-panel composition-treemap-viz">
        <h3>{title}</h3>
        <p className="muted">No composition rows available.</p>
      </section>
    );
  }
  const laneGap = 7;
  const laneHeight = (height - 12 - (validGroups.length - 1) * laneGap) / validGroups.length;

  return (
    <section ref={ref} className={`viz-panel composition-treemap-viz ${isInView ? "is-in-view" : ""}`.trim()}>
      <h3>{title}</h3>
      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {validGroups.map((group, groupIndex) => {
            const y = 6 + groupIndex * (laneHeight + laneGap);
            const total = group.rows.reduce((acc, row) => acc + Number(row.tvl_usd ?? 0), 0);
            const labelOffset = 72;
            const laneWidth = width - labelOffset - 8;
            const scaledWidths = group.rows.map((row) => {
              const value = Number(row.tvl_usd ?? 0);
              return total > 0 ? (value / total) * laneWidth : 0;
            });
            let x = 0;
            return (
              <g key={group.key} className={`treemap-group treemap-group-${group.key}`}>
                <text x={2} y={y + laneHeight / 2 + 0.5} className="treemap-group-label" dominantBaseline="central">
                  {group.label}
                </text>
                {group.rows.map((row, rowIndex) => {
                  const targetWidth = scaledWidths[rowIndex] ?? 0;
                  const w = rowIndex === group.rows.length - 1 ? Math.max(0, laneWidth - x) : Math.max(0, targetWidth);
                  const rectX = labelOffset + x;
                  x += w;
                  const name = group.text(row);
                  const maxChars = Math.max(0, Math.floor((w - 10) / 6.2));
                  const compactName = maxChars > 0 ? (name.length > maxChars ? `${name.slice(0, Math.max(2, maxChars - 1))}…` : name) : "";
                  return (
                    <g key={`${group.key}-${name}`} className="treemap-cell">
                      <rect
                        x={rectX}
                        y={y}
                        width={w}
                        height={laneHeight}
                        fill={group.color}
                        opacity={0.85}
                        stroke="var(--line-3)"
                        className="treemap-cell-rect"
                        style={{ "--treemap-delay": `${Math.min(rowIndex, 10) * 0.02}s` } as CSSProperties}
                      />
                      {w >= 58 && compactName ? (
                        <text x={rectX + 5} y={y + Math.min(16, laneHeight - 6)} className="treemap-cell-label">
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
      <p className="muted viz-legend">Treemap lanes show top TVL contributors by chain, category, and token for quick concentration scanning.</p>
    </section>
  );
}

function CompositionPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<CompositionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      categorySort: queryChoice<CategorySortKey>(
        searchParams,
        "category_sort",
        ["category", "vaults", "tvl", "share", "apy"] as const,
        "tvl",
      ),
      categoryDir: queryChoice(searchParams, "category_dir", ["asc", "desc"] as const, "desc"),
      tokenSort: queryChoice<TokenSortKey>(searchParams, "token_sort", ["token", "vaults", "tvl", "share", "apy"] as const, "tvl"),
      tokenDir: queryChoice(searchParams, "token_dir", ["asc", "desc"] as const, "desc"),
      crowdedSort: queryChoice<CrowdingSortKey>(
        searchParams,
        "crowded_sort",
        ["vault", "chain", "token", "category", "tvl", "apy", "crowding"] as const,
        "crowding",
      ),
      crowdedDir: queryChoice(searchParams, "crowded_dir", ["asc", "desc"] as const, "desc"),
      uncrowdedSort: queryChoice<CrowdingSortKey>(
        searchParams,
        "uncrowded_sort",
        ["vault", "chain", "token", "category", "tvl", "apy", "crowding"] as const,
        "crowding",
      ),
      uncrowdedDir: queryChoice(searchParams, "uncrowded_dir", ["asc", "desc"] as const, "asc"),
    };
  }, [searchParams]);

  useEffect(() => {
    setChainSort({ key: query.chainSort, direction: query.chainDir });
    setCategorySort({ key: query.categorySort, direction: query.categoryDir });
    setTokenSort({ key: query.tokenSort, direction: query.tokenDir });
    setCrowdedSort({ key: query.crowdedSort, direction: query.crowdedDir });
    setUncrowdedSort({ key: query.uncrowdedSort, direction: query.uncrowdedDir });
  }, [
    query.chainSort,
    query.chainDir,
    query.categorySort,
    query.categoryDir,
    query.tokenSort,
    query.tokenDir,
    query.crowdedSort,
    query.crowdedDir,
    query.uncrowdedSort,
    query.uncrowdedDir,
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
          universe: query.universe,
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
          top_n: String(query.topN),
          crowding_limit: String(query.crowdingLimit),
        });
        const res = await fetch(`/api/composition?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as CompositionResponse;
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
  }, [query.universe, query.minTvl, query.minPoints, query.topN, query.crowdingLimit]);

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
  const concentrationHeatItems = useMemo(() => {
    const topChains = [...(data?.chains ?? [])]
      .sort((left, right) => (right.share_tvl ?? Number.NEGATIVE_INFINITY) - (left.share_tvl ?? Number.NEGATIVE_INFINITY))
      .slice(0, 4)
      .map((row) => ({
        id: `chain-${row.chain_id}`,
        label: `${chainLabel(row.chain_id)} (chain)`,
        value: row.share_tvl,
        note: `${formatUsd(row.tvl_usd)} TVL`,
      }));
    const topCategories = [...(data?.categories ?? [])]
      .sort((left, right) => (right.share_tvl ?? Number.NEGATIVE_INFINITY) - (left.share_tvl ?? Number.NEGATIVE_INFINITY))
      .slice(0, 4)
      .map((row) => ({
        id: `category-${row.category || "unknown"}`,
        label: `${row.category || "unknown"} (category)`,
        value: row.share_tvl,
        note: `${formatUsd(row.tvl_usd)} TVL`,
      }));
    const topTokens = [...(data?.tokens ?? [])]
      .sort((left, right) => (right.share_tvl ?? Number.NEGATIVE_INFINITY) - (left.share_tvl ?? Number.NEGATIVE_INFINITY))
      .slice(0, 4)
      .map((row) => ({
        id: `token-${row.token_symbol || "unknown"}`,
        label: `${row.token_symbol || "unknown"} (token)`,
        value: row.share_tvl,
        note: `${formatUsd(row.tvl_usd)} TVL`,
      }));
    return [...topChains, ...topCategories, ...topTokens];
  }, [data?.categories, data?.chains, data?.tokens]);
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

  return (
    <main className="container">
      <section className="hero">
        <h1>Composition</h1>
        <p className="muted">Map where TVL concentrates and which vaults look crowded or under-owned.</p>
      </section>

      <PageTopPanel
        intro={
          <>
            <p className="muted card-intro">
              Crowding index compares normalized size against normalized yield. Higher values imply vaults that are large for their
              current yield.
            </p>
            <p className="muted">
              HHI runs from near 0 when spread out toward 1 when concentrated. It helps detect concentration risk by chain,
              category, and token.
            </p>
          </>
        }
        filtersIntro={<p className="muted card-intro">Composition controls are URL-backed for reproducible views.</p>}
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
            <label>
              Top Groups:&nbsp;
              <select value={query.topN} onChange={(event) => updateQuery({ top_n: Number(event.target.value) })}>
                <option value={10}>10</option>
                <option value={12}>12</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </label>
            <label>
              Crowding Rows:&nbsp;
              <select
                value={query.crowdingLimit}
                onChange={(event) => updateQuery({ crowding_limit: Number(event.target.value) })}
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={40}>40</option>
              </select>
            </label>
          </div>
        }
      />

      {error ? <section className="card">{error}</section> : null}

      <section className="card composition-visuals-card">
        <h2>Summary</h2>
        <p className="muted card-intro">HHI concentration runs from near 0 (diversified) toward 1 (highly concentrated).</p>
        <div className="split-grid composition-visual-grid">
          <KpiGrid
            items={[
              { label: "Eligible Vaults", value: String(data?.summary.vaults ?? "n/a") },
              { label: "Average APY 30d", value: formatPct(data?.summary.avg_safe_apy_30d) },
              { label: "Universe Chain HHI", value: data?.concentration.chain_hhi?.toFixed(3) ?? "n/a" },
              { label: "Universe Category HHI", value: data?.concentration.category_hhi?.toFixed(3) ?? "n/a" },
              { label: "Universe Token HHI", value: data?.concentration.token_hhi?.toFixed(3) ?? "n/a" },
            ]}
          />
          <BarList
            title="Top Chains by TVL Share"
            items={chainRows.slice(0, 8).map((row) => ({
              id: `chain-${row.chain_id}`,
              label: chainLabel(row.chain_id),
              value: row.share_tvl,
              note: formatUsd(row.tvl_usd),
            }))}
            valueFormatter={(value) => formatPct(value)}
          />
        </div>
        <div className="composition-treemap-panel">
          <TvlTreemap title="TVL Treemap (Chain → Category → Token Lens)" chains={chainRows} categories={categoryRows} tokens={tokenRows} />
        </div>
      </section>

      <section className="card analyst-only">
        <h2>Crowding Visuals</h2>
        <p className="muted card-intro">
          Scatter highlights APY versus size, while the heatmap shows where TVL share is concentrated in this filtered universe.
        </p>
        <div className="split-grid composition-crowding-grid">
          <ScatterPlot
            className="composition-main-scatter"
            title="APY vs TVL Map (Crowding Context)"
            xLabel="APY over last 30 days (percent)"
            yLabel="TVL in USD"
            points={crowdingScatterRows.map((row) => ({
              id: `${row.chain_id}:${row.vault_address}`,
              x: row.safe_apy_30d,
              y: row.tvl_usd,
              size: row.crowding_index,
              href: yearnVaultUrl(row.chain_id, row.vault_address),
              tooltip:
                `${row.symbol || row.vault_address}\n${chainLabel(row.chain_id)}\n` +
                `APY 30d: ${formatPct(row.safe_apy_30d)}\nTVL: ${formatUsd(row.tvl_usd)}\nCrowding: ${row.crowding_index?.toFixed(2) ?? "n/a"}`,
              tone:
                row.crowding_index !== null && row.crowding_index !== undefined
                  ? row.crowding_index >= 0
                    ? "negative"
                    : "positive"
                  : "neutral",
            }))}
            xFormatter={(value) => formatPct(value, 1)}
            yFormatter={(value) => formatUsdCompact(value)}
            emptyText="No crowding points for this filter."
          />
          <div className="stack">
            <HeatGrid
              title="Concentration Heatmap (Top Shares)"
              items={concentrationHeatItems}
              valueFormatter={(value) => formatPct(value)}
              legend="Heat value is TVL share. Higher-intensity cells indicate stronger concentration by chain, category, or token segment."
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Chain Concentration</h2>
        <p className="muted card-intro">Click headers to sort by share, TVL, or weighted APY.</p>
        <div className="table-wrap">
          <table className="composition-summary-table">
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${chainSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(chainSort, "chain");
                      setChainSort(next);
                      updateQuery({ chain_sort: next.key, chain_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(chainSort, "chain")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${chainSort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(chainSort, "vaults");
                      setChainSort(next);
                      updateQuery({ chain_sort: next.key, chain_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(chainSort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${chainSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(chainSort, "tvl");
                      setChainSort(next);
                      updateQuery({ chain_sort: next.key, chain_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(chainSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${chainSort.key === "share" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(chainSort, "share");
                      setChainSort(next);
                      updateQuery({ chain_sort: next.key, chain_dir: next.direction });
                    }}
                  >
                    TVL Share <span className="th-indicator">{sortIndicator(chainSort, "share")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${chainSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(chainSort, "apy");
                      setChainSort(next);
                      updateQuery({ chain_sort: next.key, chain_dir: next.direction });
                    }}
                  >
                    Weighted APY 30d <span className="th-indicator">{sortIndicator(chainSort, "apy")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {chainRows.map((row) => (
                <tr key={`chain-${row.chain_id}`}>
                  <td>
                    <Link
                      href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.share_tvl)}</td>
                  <td className="is-numeric">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Category Concentration</h2>
        <div className="table-wrap">
          <table className="composition-summary-table">
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${categorySort.key === "category" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(categorySort, "category");
                      setCategorySort(next);
                      updateQuery({ category_sort: next.key, category_dir: next.direction });
                    }}
                  >
                    Category <span className="th-indicator">{sortIndicator(categorySort, "category")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${categorySort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(categorySort, "vaults");
                      setCategorySort(next);
                      updateQuery({ category_sort: next.key, category_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(categorySort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${categorySort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(categorySort, "tvl");
                      setCategorySort(next);
                      updateQuery({ category_sort: next.key, category_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(categorySort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${categorySort.key === "share" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(categorySort, "share");
                      setCategorySort(next);
                      updateQuery({ category_sort: next.key, category_dir: next.direction });
                    }}
                  >
                    TVL Share <span className="th-indicator">{sortIndicator(categorySort, "share")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${categorySort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(categorySort, "apy");
                      setCategorySort(next);
                      updateQuery({ category_sort: next.key, category_dir: next.direction });
                    }}
                  >
                    Weighted APY 30d <span className="th-indicator">{sortIndicator(categorySort, "apy")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => (
                <tr key={`category-${row.category}`}>
                  <td>
                    {row.category ? (
                      <Link
                        href={`/discover?category=${encodeURIComponent(row.category)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      >
                        {row.category}
                      </Link>
                    ) : (
                      "unknown"
                    )}
                  </td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.share_tvl)}</td>
                  <td className="is-numeric">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyst-only">
        <h2>Top Tokens by TVL</h2>
        <div className="table-wrap">
          <table className="composition-summary-table">
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${tokenSort.key === "token" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "token");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Token <span className="th-indicator">{sortIndicator(tokenSort, "token")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "vaults");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(tokenSort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "tvl");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(tokenSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "share" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "share");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    TVL Share <span className="th-indicator">{sortIndicator(tokenSort, "share")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${tokenSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(tokenSort, "apy");
                      setTokenSort(next);
                      updateQuery({ token_sort: next.key, token_dir: next.direction });
                    }}
                  >
                    Weighted APY 30d <span className="th-indicator">{sortIndicator(tokenSort, "apy")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokenRows.map((row) => (
                <tr key={`token-${row.token_symbol}`}>
                  <td>
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      >
                        {row.token_symbol}
                      </Link>
                    ) : (
                      "unknown"
                    )}
                  </td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.share_tvl)}</td>
                  <td className="is-numeric">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Most Crowded</h2>
        <p className="muted">High TVL relative to APY versus peers in the same filtered universe.</p>
        <div className="table-wrap">
          <table className="composition-crowding-table">
            <thead>
              <tr>
                <th className="col-vault">
                  <button
                    className={`th-button ${crowdedSort.key === "vault" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "vault");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    Vault <span className="th-indicator">{sortIndicator(crowdedSort, "vault")}</span>
                  </button>
                </th>
                <th className="col-chain">
                  <button
                    className={`th-button ${crowdedSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "chain");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(crowdedSort, "chain")}</span>
                  </button>
                </th>
                <th className="col-token">
                  <button
                    className={`th-button ${crowdedSort.key === "token" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "token");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    Token <span className="th-indicator">{sortIndicator(crowdedSort, "token")}</span>
                  </button>
                </th>
                <th className="tablet-hide col-category">
                  <button
                    className={`th-button ${crowdedSort.key === "category" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "category");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    Category <span className="th-indicator">{sortIndicator(crowdedSort, "category")}</span>
                  </button>
                </th>
                <th className="is-numeric col-tvl">
                  <button
                    className={`th-button ${crowdedSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "tvl");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(crowdedSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric col-apy">
                  <button
                    className={`th-button ${crowdedSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "apy");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    APY 30d <span className="th-indicator">{sortIndicator(crowdedSort, "apy")}</span>
                  </button>
                </th>
                <th className="is-numeric col-crowding">
                  <button
                    className={`th-button ${crowdedSort.key === "crowding" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(crowdedSort, "crowding");
                      setCrowdedSort(next);
                      updateQuery({ crowded_sort: next.key, crowded_dir: next.direction });
                    }}
                  >
                    Crowding <span className="th-indicator">{sortIndicator(crowdedSort, "crowding")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {crowdedRows.map((row) => (
                <tr key={`crowded-${row.vault_address}`}>
                  <td className="col-vault"><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td className="col-chain">
                    <Link
                      href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="col-token">
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      >
                        {row.token_symbol}
                      </Link>
                    ) : (
                      "unknown"
                    )}
                  </td>
                  <td className="tablet-hide col-category">{row.category || "unknown"}</td>
                  <td className="is-numeric col-tvl">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric col-apy">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric col-crowding">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyst-only">
        <h2>Least Crowded</h2>
        <p className="muted">Lower TVL relative to APY versus peers in the same filtered universe.</p>
        <div className="table-wrap">
          <table className="composition-crowding-table">
            <thead>
              <tr>
                <th className="col-vault">
                  <button
                    className={`th-button ${uncrowdedSort.key === "vault" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "vault");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    Vault <span className="th-indicator">{sortIndicator(uncrowdedSort, "vault")}</span>
                  </button>
                </th>
                <th className="col-chain">
                  <button
                    className={`th-button ${uncrowdedSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "chain");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(uncrowdedSort, "chain")}</span>
                  </button>
                </th>
                <th className="col-token">
                  <button
                    className={`th-button ${uncrowdedSort.key === "token" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "token");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    Token <span className="th-indicator">{sortIndicator(uncrowdedSort, "token")}</span>
                  </button>
                </th>
                <th className="tablet-hide col-category">
                  <button
                    className={`th-button ${uncrowdedSort.key === "category" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "category");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    Category <span className="th-indicator">{sortIndicator(uncrowdedSort, "category")}</span>
                  </button>
                </th>
                <th className="is-numeric col-tvl">
                  <button
                    className={`th-button ${uncrowdedSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "tvl");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(uncrowdedSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric col-apy">
                  <button
                    className={`th-button ${uncrowdedSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "apy");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    APY 30d <span className="th-indicator">{sortIndicator(uncrowdedSort, "apy")}</span>
                  </button>
                </th>
                <th className="is-numeric col-crowding">
                  <button
                    className={`th-button ${uncrowdedSort.key === "crowding" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(uncrowdedSort, "crowding");
                      setUncrowdedSort(next);
                      updateQuery({ uncrowded_sort: next.key, uncrowded_dir: next.direction });
                    }}
                  >
                    Crowding <span className="th-indicator">{sortIndicator(uncrowdedSort, "crowding")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {uncrowdedRows.map((row) => (
                <tr key={`uncrowded-${row.vault_address}`}>
                  <td className="col-vault"><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                  <td className="col-chain">
                    <Link
                      href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="col-token">
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      >
                        {row.token_symbol}
                      </Link>
                    ) : (
                      "unknown"
                    )}
                  </td>
                  <td className="tablet-hide col-category">{row.category || "unknown"}</td>
                  <td className="is-numeric col-tvl">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric col-apy">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric col-crowding">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function CompositionPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <CompositionPageContent />
    </Suspense>
  );
}
