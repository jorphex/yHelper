"use client";

import Link from "next/link";
import { chainLabel, formatPct, formatUsd, yearnVaultUrl } from "../lib/format";
import { ScatterPlot } from "../components/visuals";
import { TableWrap } from "../components/table-wrap";
import { TableSkeleton } from "../components/skeleton";
import { sortIndicator, toggleSort, type SortState } from "../lib/sort";
import { VaultLink } from "../components/vault-link";
import type { CrowdingRow, CrowdingSortKey, StructureQuery } from "./types";

export function CrowdingTab({
  isLoading,
  query,
  isCompactViewport,
  crowdingScatterRows,
  crowdedRows,
  uncrowdedRows,
  crowdingSort,
  setCrowdingSort,
  uncrowdedSort,
  setUncrowdedSort,
}: {
  isLoading: boolean;
  query: StructureQuery;
  isCompactViewport: boolean;
  crowdingScatterRows: CrowdingRow[];
  crowdedRows: CrowdingRow[];
  uncrowdedRows: CrowdingRow[];
  crowdingSort: SortState<CrowdingSortKey>;
  setCrowdingSort: (value: SortState<CrowdingSortKey>) => void;
  uncrowdedSort: SortState<CrowdingSortKey>;
  setUncrowdedSort: (value: SortState<CrowdingSortKey>) => void;
}) {
  return (
    <>
      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Realized APY vs TVL Map</h2>
        </div>
        <ScatterPlot
          title=""
          xLabel="Realized APY 30d"
          yLabel="TVL (USD)"
          points={crowdingScatterRows.map((row) => ({
            id: `${row.chain_id}:${row.vault_address}`,
            x: row.realized_apy_30d,
            y: row.tvl_usd,
            size: row.crowding_index,
            href: yearnVaultUrl(row.chain_id, row.vault_address),
            tone: (row.crowding_index ?? 0) >= 0 ? "negative" : "positive",
          }))}
          xFormatter={(value) => formatPct(value, 1)}
          yFormatter={(value) => formatUsd(value)}
        />
      </section>

      <section className="section" style={{ marginBottom: "48px" }}>
        <div className="card-header">
          <h2 className="card-title">Most Crowded</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "vault"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vault {sortIndicator(crowdingSort, "vault")}
                  </button>
                </th>
                <th>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(crowdingSort, "chain")}
                  </button>
                </th>
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "token"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Token {sortIndicator(crowdingSort, "token")}
                    </button>
                  </th>
                )}
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "category"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Category {sortIndicator(crowdingSort, "category")}
                    </button>
                  </th>
                )}
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(crowdingSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "apy"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Realized APY 30d {sortIndicator(crowdingSort, "apy")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "crowding"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Crowding {sortIndicator(crowdingSort, "crowding")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={isCompactViewport ? 5 : 7} />
              ) : (
                crowdedRows.slice(0, query.crowdingLimit).map((row) => (
                  <tr key={row.vault_address}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                    <td>
                      <Link href={`/explore?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                        {chainLabel(row.chain_id)}
                      </Link>
                    </td>
                    {!isCompactViewport && (
                      <td>
                        {row.token_symbol ? (
                          <Link href={`/explore?tab=venues&token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                            {row.token_symbol}
                          </Link>
                        ) : "n/a"}
                      </td>
                    )}
                    {!isCompactViewport && <td>{row.category || "n/a"}</td>}
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.realized_apy_30d)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
            </TableWrap>
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Least Crowded</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "vault"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Vault {sortIndicator(uncrowdedSort, "vault")}
                  </button>
                </th>
                <th>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "chain"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Chain {sortIndicator(uncrowdedSort, "chain")}
                  </button>
                </th>
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "token"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Token {sortIndicator(uncrowdedSort, "token")}
                    </button>
                  </th>
                )}
                {!isCompactViewport && (
                  <th>
                    <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "category"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                      Category {sortIndicator(uncrowdedSort, "category")}
                    </button>
                  </th>
                )}
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "tvl"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    TVL {sortIndicator(uncrowdedSort, "tvl")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "apy"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Realized APY 30d {sortIndicator(uncrowdedSort, "apy")}
                  </button>
                </th>
                <th style={{ textAlign: "right" }}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "crowding"))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}>
                    Crowding {sortIndicator(uncrowdedSort, "crowding")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={isCompactViewport ? 5 : 7} />
              ) : (
                uncrowdedRows.slice(0, query.crowdingLimit).map((row) => (
                  <tr key={row.vault_address}>
                    <td><VaultLink chainId={row.chain_id} vaultAddress={row.vault_address} symbol={row.symbol} /></td>
                    <td>
                      <Link href={`/explore?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                        {chainLabel(row.chain_id)}
                      </Link>
                    </td>
                    {!isCompactViewport && (
                      <td>
                        {row.token_symbol ? (
                          <Link href={`/explore?tab=venues&token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}`}>
                            {row.token_symbol}
                          </Link>
                        ) : "n/a"}
                      </td>
                    )}
                    {!isCompactViewport && <td>{row.category || "n/a"}</td>}
                    <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.realized_apy_30d)}</td>
                    <td style={{ textAlign: "right" }} className="data-value">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}
