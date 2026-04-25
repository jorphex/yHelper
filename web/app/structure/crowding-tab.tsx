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
      <section className="section section-lg">
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

      <section className="section section-lg">
        <div className="card-header">
          <h2 className="card-title">Most Crowded</h2>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th aria-sort={crowdingSort.key === "vault" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "vault"))}>
                    Vault {sortIndicator(crowdingSort, "vault")}
                  </button>
                </th>
                <th aria-sort={crowdingSort.key === "chain" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "chain"))}>
                    Chain {sortIndicator(crowdingSort, "chain")}
                  </button>
                </th>
                {!isCompactViewport && (
                  <th aria-sort={crowdingSort.key === "token" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "token"))}>
                      Token {sortIndicator(crowdingSort, "token")}
                    </button>
                  </th>
                )}
                {!isCompactViewport && (
                  <th aria-sort={crowdingSort.key === "category" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "category"))}>
                      Category {sortIndicator(crowdingSort, "category")}
                    </button>
                  </th>
                )}
                <th className="numeric" aria-sort={crowdingSort.key === "tvl" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "tvl"))}>
                    TVL {sortIndicator(crowdingSort, "tvl")}
                  </button>
                </th>
                <th className="numeric" aria-sort={crowdingSort.key === "apy" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "apy"))}>
                    Realized APY 30d {sortIndicator(crowdingSort, "apy")}
                  </button>
                </th>
                <th className="numeric" aria-sort={crowdingSort.key === "crowding" ? (crowdingSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setCrowdingSort(toggleSort(crowdingSort, "crowding"))}>
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
                    <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                    <td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td>
                    <td className="data-value numeric">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
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
                <th aria-sort={uncrowdedSort.key === "vault" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "vault"))}>
                    Vault {sortIndicator(uncrowdedSort, "vault")}
                  </button>
                </th>
                <th aria-sort={uncrowdedSort.key === "chain" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "chain"))}>
                    Chain {sortIndicator(uncrowdedSort, "chain")}
                  </button>
                </th>
                {!isCompactViewport && (
                  <th aria-sort={uncrowdedSort.key === "token" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "token"))}>
                      Token {sortIndicator(uncrowdedSort, "token")}
                    </button>
                  </th>
                )}
                {!isCompactViewport && (
                  <th aria-sort={uncrowdedSort.key === "category" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "category"))}>
                      Category {sortIndicator(uncrowdedSort, "category")}
                    </button>
                  </th>
                )}
                <th className="numeric" aria-sort={uncrowdedSort.key === "tvl" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "tvl"))}>
                    TVL {sortIndicator(uncrowdedSort, "tvl")}
                  </button>
                </th>
                <th className="numeric" aria-sort={uncrowdedSort.key === "apy" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "apy"))}>
                    Realized APY 30d {sortIndicator(uncrowdedSort, "apy")}
                  </button>
                </th>
                <th className="numeric" aria-sort={uncrowdedSort.key === "crowding" ? (uncrowdedSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="th-button" onClick={() => setUncrowdedSort(toggleSort(uncrowdedSort, "crowding"))}>
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
                    <td className="data-value numeric">{formatUsd(row.tvl_usd)}</td>
                    <td className="data-value numeric">{formatPct(row.realized_apy_30d)}</td>
                    <td className="data-value numeric">{row.crowding_index?.toFixed(2) ?? "n/a"}</td>
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
