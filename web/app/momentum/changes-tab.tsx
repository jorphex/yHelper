"use client";

import { chainLabel, formatHours, formatPct, formatPctSigned, formatUsd, yearnVaultUrl } from "../lib/format";
import { HeatGrid, ShareMeter, ScatterPlot, TrendStrips, BarList } from "../components/visuals";
import { TableWrap } from "../components/table-wrap";
import { VizSkeleton } from "../components/viz-skeleton";
import { sortIndicator, toggleSort, type SortState } from "../lib/sort";
import { universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { MoverTable } from "./components";
import type { ChangeRow, MomentumQuery, StaleByChain, StaleSortKey } from "./types";
import type { BarDatum, HeatCellDatum, MeterSegmentDatum, TrendStripDatum } from "../components/visuals/types";

type ChangesSummary = {
  vaults_eligible?: number;
  vaults_with_change?: number;
  avg_delta?: number | null;
  total_tvl_usd?: number | null;
  tracked_tvl_usd?: number | null;
};

type FreshnessSummary = {
  latest_pps_age_seconds?: number | null;
  metrics_newest_age_seconds?: number | null;
  window_stale_ratio?: number | null;
};

export function ChangesTab({
  query,
  updateQuery,
  changesLoading,
  summary,
  freshness,
  filteredTvl,
  trackedTvl,
  yearnTvl,
  yearnVaults,
  gap,
  ratio,
  vaultCoverageSegments,
  tvlCoverageSegments,
  staleChainHeatItems,
  staleCategoryHeatItems,
  chainMomentumHeat,
  categoryMomentumHeat,
  staleSort,
  setStaleSort,
  staleChainRows,
  moverRisers,
  moverFallers,
  moverLargestAbsDelta,
  moverStale,
  isCompactViewport,
  trendError,
  moverDriftTrendItems,
  weightedApyTrendItems,
  groupedApyTrendItems,
  moverScatterRows,
  deltaBandItems,
}: {
  query: MomentumQuery;
  updateQuery: (updates: Record<string, string | number | null | undefined>) => void;
  changesLoading: boolean;
  summary?: ChangesSummary;
  freshness?: FreshnessSummary;
  filteredTvl: number | null | undefined;
  trackedTvl: number | null | undefined;
  yearnTvl: number | null | undefined;
  yearnVaults: number | null | undefined;
  gap: number | null | undefined;
  ratio: number | null | undefined;
  vaultCoverageSegments: MeterSegmentDatum[];
  tvlCoverageSegments: MeterSegmentDatum[];
  staleChainHeatItems: HeatCellDatum[];
  staleCategoryHeatItems: HeatCellDatum[];
  chainMomentumHeat: HeatCellDatum[];
  categoryMomentumHeat: HeatCellDatum[];
  staleSort: SortState<StaleSortKey>;
  setStaleSort: (value: SortState<StaleSortKey>) => void;
  staleChainRows: StaleByChain[];
  moverRisers: ChangeRow[];
  moverFallers: ChangeRow[];
  moverLargestAbsDelta: ChangeRow[];
  moverStale: ChangeRow[];
  isCompactViewport: boolean;
  trendError: string | null;
  moverDriftTrendItems: TrendStripDatum[];
  weightedApyTrendItems: TrendStripDatum[];
  groupedApyTrendItems: TrendStripDatum[];
  moverScatterRows: ChangeRow[];
  deltaBandItems: BarDatum[];
}) {
  return (
    <>
      <section className="section section-md">
        <div className="card">
          <div className="filter-grid">
            <label>
              <span className="filter-label">Window</span>
              <select value={query.window} onChange={(e) => updateQuery({ window: e.target.value })} style={{ width: "100%", marginTop: "6px" }}>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <label>
              <span className="filter-label">Universe</span>
              <select value={query.universe} onChange={(e) => updateQuery({ universe: e.target.value })} style={{ width: "100%", marginTop: "6px" }}>
                {UNIVERSE_VALUES.map((value) => (
                  <option key={value} value={value}>{universeLabel(value)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="filter-label">Min TVL</span>
              <input type="number" value={query.minTvl} onChange={(e) => updateQuery({ min_tvl: Number(e.target.value) })} style={{ width: "100%", marginTop: "6px" }} />
            </label>
            <label>
              <span className="filter-label">Trend View</span>
              <select value={query.trendGroup} onChange={(e) => updateQuery({ trend_group: e.target.value })} style={{ width: "100%", marginTop: "6px" }}>
                <option value="none">Global</option>
                <option value="chain">By Chain</option>
                <option value="category">By Category</option>
              </select>
            </label>
            <label>
              <span className="filter-label">TVL View</span>
              <select value={query.tvlView} onChange={(e) => updateQuery({ tvl_view: e.target.value })} style={{ width: "100%", marginTop: "6px" }}>
                <option value="filtered">Filtered Universe</option>
                <option value="reference">Yearn Aligned</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="section section-lg">
        <div className="card-header">
          <h2 className="card-title">Window Summary</h2>
        </div>
        {changesLoading ? (
          <div className="kpi-grid kpi-grid-4">
            {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <>
            {query.tvlView === "filtered" ? (
              <div className="kpi-grid kpi-grid-4">
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
              <div className="kpi-grid kpi-grid-4">
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
                  <div className="kpi-value">{ratio !== null && ratio !== undefined ? ratio.toFixed(2) : "n/a"}</div>
                </div>
              </div>
            )}
            <div className="kpi-grid kpi-grid-4" style={{ marginTop: "16px" }}>
              <div className="kpi-card">
                <div className="kpi-label">Avg Delta</div>
                <div className={`kpi-value ${(summary?.avg_delta ?? 0) >= 0 ? "text-positive delta-positive" : "text-negative delta-negative"}`}>
                  {formatPctSigned(summary?.avg_delta)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Fresh PPS Age</div>
                <div className="kpi-value">{formatHours(freshness?.latest_pps_age_seconds)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Newest Metrics Age</div>
                <div className="kpi-value">{formatHours(freshness?.metrics_newest_age_seconds)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Window Stale Ratio</div>
                <div className="kpi-value">{formatPct(freshness?.window_stale_ratio)}</div>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="section section-lg">
        <div className="card-header">
          <h2 className="card-title">Window Coverage</h2>
        </div>
        <div className="cols-2">
          <ShareMeter
            title="By Vaults"
            segments={vaultCoverageSegments}
            total={summary?.vaults_eligible ?? 0}
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

      <section className="section section-lg">
        <div className="card-header">
          <h2 className="card-title">Stale Ratio Heatmaps</h2>
        </div>
        <div className="cols-2">
          <HeatGrid title="By Chain" items={staleChainHeatItems} valueFormatter={(value) => formatPct(value, 1)} legend="Stale vault ratio by chain" />
          <HeatGrid title="By Category" items={staleCategoryHeatItems} valueFormatter={(value) => formatPct(value, 1)} legend="Stale vault ratio by category" />
        </div>
      </section>

      <section className="section section-lg">
        <div className="card-header">
          <h2 className="card-title">Grouped Momentum Snapshot (Latest Day)</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            TVL-weighted momentum by chain/category (realized 7d APY minus realized 30d APY). Positive values indicate short-term strengthening.
          </p>
        </div>
        <div className="cols-2">
          <HeatGrid
            title="By Chain"
            items={chainMomentumHeat}
            valueFormatter={(value) => formatPct(value, 1)}
            legend="Cells are sorted by latest TVL. Notes show TVL and weighted realized APY 30d for context."
          />
          <HeatGrid
            title="By Category"
            items={categoryMomentumHeat}
            valueFormatter={(value) => formatPct(value, 1)}
            legend="Use this to compare category momentum drift independent of single-vault outliers."
          />
        </div>
      </section>

      <section className="section section-lg">
        <div className="card-header">
          <h2 className="card-title">Freshness by Chain</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th aria-sort={staleSort.key === "chain" ? (staleSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(staleSort, "chain")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }} aria-sort={staleSort.key === "vaults" ? (staleSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "vaults"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults {sortIndicator(staleSort, "vaults")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }} aria-sort={staleSort.key === "stale" ? (staleSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "stale"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Stale {sortIndicator(staleSort, "stale")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }} aria-sort={staleSort.key === "ratio" ? (staleSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "ratio"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Stale % {sortIndicator(staleSort, "ratio")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }} aria-sort={staleSort.key === "tvl" ? (staleSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setStaleSort(toggleSort(staleSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(staleSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }} aria-sort={staleSort.key === "stale_tvl" ? (staleSort.direction === "asc" ? "ascending" : "descending") : "none"}>
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
            </TableWrap>
      </section>

      <section className="section section-lg">
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
            <MoverTable title="Top Risers" rows={moverRisers} universe={query.universe} minTvl={query.minTvl} minPoints={query.minPoints} compact={isCompactViewport} />
            <MoverTable title="Top Fallers" rows={moverFallers} universe={query.universe} minTvl={query.minTvl} minPoints={query.minPoints} compact={isCompactViewport} />
            <MoverTable title="Largest Absolute Changes" rows={moverLargestAbsDelta} universe={query.universe} minTvl={query.minTvl} minPoints={query.minPoints} compact={isCompactViewport} />
          </>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Trend Analysis</h2>
        </div>
        {trendError ? <div className="card" style={{ padding: "24px", marginBottom: "24px" }}>{trendError}</div> : null}
        {changesLoading ? (
        <div style={{ display: "grid", gap: "24px" }}>
          <div className="cols-2">
            <VizSkeleton variant="trend" />
            <VizSkeleton variant="trend" />
          </div>
          <VizSkeleton />
          <div className="cols-2">
            <VizSkeleton variant="bars" />
            <VizSkeleton />
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "24px" }}>
          <div className="cols-2">
            <TrendStrips
              title="Riser/Faller Drift (60 Days)"
              items={moverDriftTrendItems}
              valueFormatter={(value) => formatPct(value, 1)}
              deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 1)}`}
              emptyText="Trend data unavailable"
            />
            <TrendStrips
              title={query.trendGroup === "none" ? "Realized APY Trend" : `Realized APY by ${query.trendGroup === "chain" ? "Chain" : "Category"}`}
              items={query.trendGroup === "none" ? weightedApyTrendItems : groupedApyTrendItems}
              valueFormatter={(value) => formatPct(value, 2)}
              deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
              emptyText="Trend data unavailable"
            />
          </div>
          <ScatterPlot
            title="Delta vs Current Realized APY"
            xLabel="Delta"
            yLabel="Current Realized APY"
            points={moverScatterRows.map((row) => ({
              id: `${row.chain_id}:${row.vault_address}`,
              x: row.delta_apy,
              y: row.realized_apy_window,
              size: row.tvl_usd,
              href: yearnVaultUrl(row.chain_id, row.vault_address),
              tone: (row.delta_apy ?? 0) >= 0 ? "positive" : "negative",
            }))}
            xFormatter={(value) => formatPct(value, 1)}
            yFormatter={(value) => formatPct(value, 1)}
          />
          <div className="cols-2">
            <BarList title="Delta Distribution" items={deltaBandItems} valueFormatter={(value) => String(value ?? 0)} />
            <HeatGrid title="Momentum by Category" items={categoryMomentumHeat} valueFormatter={(value) => formatPct(value, 1)} legend="Compare category momentum drift" />
          </div>
        </div>
      )}
      </section>
    </>
  );
}
