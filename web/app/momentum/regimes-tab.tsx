"use client";

import Link from "next/link";
import { chainLabel, compactChainLabel, formatPct, formatUsd } from "../lib/format";
import { BarList, HeatGrid, TrendStrips } from "../components/visuals";
import { TableWrap } from "../components/table-wrap";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { sortIndicator, toggleSort, type SortState } from "../lib/sort";
import { universeLabel, UNIVERSE_VALUES } from "../lib/universe";
import { VaultLink } from "../components/vault-link";
import { RegimeFlowSankey } from "./components";
import { compactRegimeLabel } from "./helpers";
import type {
  MomentumQuery,
  RegimeMover,
  RegimeMoverSortKey,
  RegimeSummary,
  RegimeSummarySortKey,
  SplitSnapshotRow,
  SplitSnapshotSortKey,
  TransitionRow,
  TransitionSummary,
} from "./types";
import type { BarDatum, HeatCellDatum, TrendStripDatum } from "../components/visuals/types";

export function RegimesTab({
  query,
  updateQuery,
  availableChains,
  regimeLoading,
  summaryRows,
  dominantRegime,
  regimes,
  totalRegimeTvl,
  summarySort,
  setSummarySort,
  regimeMoverRows,
  regimeMoverSort,
  setRegimeMoverSort,
  isCompactViewport,
  transitionSummary,
  transitionHeat,
  groupedLatestChurnHeat,
  groupedLatestChurnBars,
  transitionRows,
  transitionTrendItems,
  groupedTransitionTrendItems,
  groupedDriftItems,
  splitSnapshotRows,
  splitSnapshotSort,
  setSplitSnapshotSort,
}: {
  query: MomentumQuery;
  updateQuery: (updates: Record<string, string | number | null | undefined>) => void;
  availableChains: number[];
  regimeLoading: boolean;
  summaryRows: RegimeSummary[];
  dominantRegime: string;
  regimes: RegimeSummary[];
  totalRegimeTvl: number;
  summarySort: SortState<RegimeSummarySortKey>;
  setSummarySort: (value: SortState<RegimeSummarySortKey>) => void;
  regimeMoverRows: RegimeMover[];
  regimeMoverSort: SortState<RegimeMoverSortKey>;
  setRegimeMoverSort: (value: SortState<RegimeMoverSortKey>) => void;
  isCompactViewport: boolean;
  transitionSummary?: TransitionSummary;
  transitionHeat: HeatCellDatum[];
  groupedLatestChurnHeat: HeatCellDatum[];
  groupedLatestChurnBars: BarDatum[];
  transitionRows: TransitionRow[];
  transitionTrendItems: TrendStripDatum[];
  groupedTransitionTrendItems: TrendStripDatum[];
  groupedDriftItems: BarDatum[];
  splitSnapshotRows: SplitSnapshotRow[];
  splitSnapshotSort: SortState<SplitSnapshotSortKey>;
  setSplitSnapshotSort: (value: SortState<SplitSnapshotSortKey>) => void;
}) {
  return (
    <>
      <section className="section section-md">
        <div className="card">
          <div className="filter-grid">
            <label>
              <span className="filter-label">Universe</span>
              <select value={query.universe} onChange={(e) => updateQuery({ universe: e.target.value, min_tvl: null, min_points: null })} style={{ width: "100%", marginTop: "6px" }}>
                {UNIVERSE_VALUES.map((value) => (
                  <option key={value} value={value}>{universeLabel(value)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="filter-label">Chain</span>
              <select value={query.chain > 0 ? String(query.chain) : ""} onChange={(e) => updateQuery({ chain: e.target.value || null })} style={{ width: "100%", marginTop: "6px" }}>
                <option value="">All</option>
                {availableChains.map((chainId) => (
                  <option key={chainId} value={chainId}>{chainLabel(chainId)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="filter-label">Min TVL (USD)</span>
              <input type="number" min={0} value={query.minTvl} onChange={(e) => updateQuery({ min_tvl: Number(e.target.value || 0) })} style={{ width: "100%", marginTop: "6px" }} />
            </label>
            <label>
              <span className="filter-label">Min Points</span>
              <input type="number" min={0} max={365} value={query.minPoints} onChange={(e) => updateQuery({ min_points: Number(e.target.value || 0) })} style={{ width: "100%", marginTop: "6px" }} />
            </label>
          </div>
        </div>
      </section>

      <section className="section section-md">
        <div className="card" style={{ background: "var(--bg-elevated)" }}>
          <h3 style={{ fontSize: "14px", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)" }}>Transition Analysis</h3>
          <div className="filter-grid">
            <label>
              <span className="filter-label">Movers Limit</span>
              <select value={query.limit} onChange={(e) => updateQuery({ limit: Number(e.target.value) })} style={{ width: "100%", marginTop: "6px" }}>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={80}>80</option>
              </select>
            </label>
            <label>
              <span className="filter-label">Transition Split</span>
              <select value={query.transitionSplit} onChange={(e) => updateQuery({ transition_split: e.target.value })} style={{ width: "100%", marginTop: "6px" }}>
                <option value="none">Global</option>
                <option value="chain">By Chain</option>
                <option value="category">By Category</option>
              </select>
            </label>
            <label>
              <span className="filter-label">Transition Window</span>
              <select value={query.transitionDays} onChange={(e) => updateQuery({ transition_days: e.target.value })} style={{ width: "100%", marginTop: "6px" }}>
                <option value="60">60d</option>
                <option value="120">120d</option>
                <option value="180">180d</option>
                <option value="365">365d</option>
              </select>
            </label>
            <label>
              <span className="filter-label">Min Cohort TVL (USD)</span>
              <input type="number" min={0} value={query.transitionMinCohortTvl} onChange={(e) => updateQuery({ transition_min_cohort_tvl: Number(e.target.value || 0) })} style={{ width: "100%", marginTop: "6px" }} />
            </label>
          </div>
        </div>
      </section>

      <section className="section section-lg">
        {regimeLoading ? (
          <div className="kpi-grid kpi-grid-6">
            {Array(6).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid kpi-grid-6">
            <div className="kpi-card">
              <div className="kpi-label">Regimes Tracked</div>
              <div className="kpi-value">{summaryRows.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total Vaults</div>
              <div className="kpi-value">{summaryRows.reduce((acc, row) => acc + row.vaults, 0)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Dominant Regime</div>
              <div className="kpi-value" style={{ textTransform: "capitalize" }}>{dominantRegime}</div>
              <div className="kpi-hint">Largest TVL share</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rising</div>
              <div className="kpi-value" style={{ color: "var(--positive)" }}>{regimes.find((row) => row.regime === "rising")?.vaults ?? 0}</div>
              <div className="kpi-hint">Vaults improving</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Stable</div>
              <div className="kpi-value">{regimes.find((row) => row.regime === "stable")?.vaults ?? 0}</div>
              <div className="kpi-hint">Holding steady</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Falling</div>
              <div className="kpi-value" style={{ color: "var(--negative)" }}>{regimes.find((row) => row.regime === "falling")?.vaults ?? 0}</div>
              <div className="kpi-hint">Vaults declining</div>
            </div>
          </div>
        )}
      </section>

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

        <TableWrap style={{ marginBottom: "48px" }}>
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setSummarySort(toggleSort(summarySort, "regime"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Regime <span>{sortIndicator(summarySort, "regime")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setSummarySort(toggleSort(summarySort, "vaults"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vaults <span>{sortIndicator(summarySort, "vaults")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setSummarySort(toggleSort(summarySort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
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
            </TableWrap>

        <div className="card-header">
          <h2 className="card-title">Current Regime Movers</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "vault"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vault <span>{sortIndicator(regimeMoverSort, "vault")}</span>
                  </button>
                </th>
                <th>
                  <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain <span>{sortIndicator(regimeMoverSort, "chain")}</span>
                  </button>
                </th>
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "token"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Token <span>{sortIndicator(regimeMoverSort, "token")}</span>
                    </button>
                  </th>
                )}
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL <span>{sortIndicator(regimeMoverSort, "tvl")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "apy"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Realized APY 30d <span>{sortIndicator(regimeMoverSort, "apy")}</span>
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "momentum"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Momentum <span>{sortIndicator(regimeMoverSort, "momentum")}</span>
                  </button>
                </th>
                {!isCompactViewport && (
                  <th style={{ textAlign: "right" }}>
                    <button className="th-button" onClick={() => setRegimeMoverSort(toggleSort(regimeMoverSort, "regime"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
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
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.realized_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.momentum_7d_30d)}</td>
                  {!isCompactViewport && <td style={{ textAlign: "right" }} className="data-value" title={compactRegimeLabel(row.regime)}>{compactRegimeLabel(row.regime)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>

        <div className="card-header">
          <h2 className="card-title">Transition Analysis</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            Compare current short-term regime (realized 7d vs realized 30d APY) with prior baseline (realized 30d vs realized 90d APY).
          </p>
        </div>

        <div className="kpi-grid kpi-grid-4 section-sm">
          <div className="kpi-card">
            <div className="kpi-label">Vaults Tracked</div>
            <div className="kpi-value">{transitionSummary?.vaults_total ?? "n/a"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Changed Vaults</div>
            <div className="kpi-value">{transitionSummary?.changed_vaults ?? "n/a"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Changed Ratio</div>
            <div className="kpi-value">{formatPct(transitionSummary?.changed_ratio)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Changed TVL</div>
            <div className="kpi-value">{formatUsd(transitionSummary?.changed_tvl_usd)}</div>
          </div>
        </div>

        <div style={{ marginBottom: "48px" }}>
          {query.transitionSplit === "none" ? (
            <HeatGrid title="Transition Matrix" items={transitionHeat} valueFormatter={(value) => formatUsd(value)} legend="Higher intensity means more TVL moved between regime states." />
          ) : (
            <div className="cols-2">
              <HeatGrid
                title={`Latest Churn TVL Share by ${query.transitionSplit === "chain" ? "Chain" : "Category"}`}
                items={groupedLatestChurnHeat}
                valueFormatter={(value) => formatPct(value, 2)}
                legend="Each cell is latest-day churn TVL ratio."
              />
              <BarList title={`${query.transitionSplit === "chain" ? "Chains" : "Categories"} with Highest Latest Churn`} items={groupedLatestChurnBars} valueFormatter={(value) => formatPct(value, 2)} />
            </div>
          )}
        </div>

        <div className="card-header">
          <h2 className="card-title">Transition Flow</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
            Visual flow of where TVL moved between prior and current regime states.
          </p>
        </div>
        <div style={{ marginBottom: "48px" }}>
          <RegimeFlowSankey title="" rows={transitionRows} />
        </div>

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

        {query.transitionSplit !== "none" && (
          <>
            <div className="card-header">
              <h2 className="card-title">Churn by {query.transitionSplit === "chain" ? "Chain" : "Category"}</h2>
            </div>
            <div style={{ marginBottom: "24px" }}>
              <TrendStrips
                title="Top 6 by Latest TVL"
                items={groupedTransitionTrendItems}
                valueFormatter={(value) => formatPct(value, 2)}
                deltaFormatter={(value) => `${value >= 0 ? "+" : ""}${formatPct(value, 2)}`}
                emptyText="Grouped transition churn trend is unavailable."
              />
            </div>

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

            <div className="card-header">
              <h2 className="card-title">Latest {query.transitionSplit === "chain" ? "Chain" : "Category"} Snapshot</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "8px" }}>
                Sortable latest-day cohort metrics for quick comparison.
              </p>
            </div>
            <TableWrap style={{ marginBottom: "48px" }}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <button className="th-button" onClick={() => setSplitSnapshotSort(toggleSort(splitSnapshotSort, "cohort"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Cohort <span>{sortIndicator(splitSnapshotSort, "cohort")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => setSplitSnapshotSort(toggleSort(splitSnapshotSort, "churn"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Churn % <span>{sortIndicator(splitSnapshotSort, "churn")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => setSplitSnapshotSort(toggleSort(splitSnapshotSort, "churn_tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Churn TVL % <span>{sortIndicator(splitSnapshotSort, "churn_tvl")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => setSplitSnapshotSort(toggleSort(splitSnapshotSort, "momentum"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        Momentum <span>{sortIndicator(splitSnapshotSort, "momentum")}</span>
                      </button>
                    </th>
                    <th style={{ textAlign: "right" }}>
                      <button className="th-button" onClick={() => setSplitSnapshotSort(toggleSort(splitSnapshotSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
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
            </TableWrap>
          </>
        )}
      </section>
    </>
  );
}
