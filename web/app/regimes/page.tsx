"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd, regimeLabel, shortVaultLabel } from "../lib/format";
import { SortState, sortIndicator, sortRows, toggleSort } from "../lib/sort";
import { queryChoice, queryFloat, queryInt, replaceQuery } from "../lib/url";
import { BarList, KpiGrid } from "../components/visuals";
import { UniverseKind, universeDefaults, universeLabel, UNIVERSE_VALUES } from "../lib/universe";

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

type RegimeSummarySortKey = "regime" | "vaults" | "tvl";
type RegimeMoverSortKey = "vault" | "chain" | "token" | "tvl" | "apy" | "momentum" | "regime";

function RegimesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<RegimeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summarySort, setSummarySort] = useState<SortState<RegimeSummarySortKey>>({ key: "vaults", direction: "desc" });
  const [moverSort, setMoverSort] = useState<SortState<RegimeMoverSortKey>>({ key: "momentum", direction: "desc" });

  const query = useMemo(() => {
    const universe = queryChoice<UniverseKind>(searchParams, "universe", UNIVERSE_VALUES, "core");
    const defaults = universeDefaults(universe);
    return {
      universe,
      chain: queryInt(searchParams, "chain", 0, { min: 0 }),
      minTvl: queryFloat(searchParams, "min_tvl", defaults.minTvl, { min: 0 }),
      minPoints: queryInt(searchParams, "min_points", defaults.minPoints, { min: 0, max: 365 }),
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

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          universe: query.universe,
          limit: String(query.limit),
          min_tvl_usd: String(query.minTvl),
          min_points: String(query.minPoints),
        });
        if (query.chain > 0) params.set("chain_id", String(query.chain));
        const res = await fetch(`/api/regimes?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setError(`API error: ${res.status}`);
          return;
        }
        const payload = (await res.json()) as RegimeResponse;
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
  }, [query.universe, query.chain, query.minTvl, query.minPoints, query.limit]);

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

  return (
    <main className="container">
      <section className="hero">
        <h1>Regimes</h1>
        <p className="muted">
          Track whether vaults are improving, weakening, stable, or volatile using transparent rule thresholds.
        </p>
      </section>

      <section className="card explain-card">
        <h2>Read Me First</h2>
        <p className="muted card-intro">
          Regimes are rule-based: rising if momentum ≥ +1%, falling if momentum ≤ -1%, choppy if 30d volatility ≥ 20%, otherwise
          stable.
        </p>
        <p className="muted">This is descriptive, not predictive. It explains what recently happened in yield behavior.</p>
      </section>

      {error ? <section className="card">{error}</section> : null}

      <section className="card">
        <h2>Filters</h2>
        <p className="muted card-intro">Filters and sort are stored in URL query params for shareable views.</p>
        <div className="inline-controls">
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
            Chain:&nbsp;
            <select value={query.chain > 0 ? String(query.chain) : ""} onChange={(event) => updateQuery({ chain: event.target.value || null })}>
              <option value="">All</option>
              {availableChains.map((chainId) => (
                <option key={chainId} value={chainId}>
                  {chainLabel(chainId)}
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
            Movers Limit:&nbsp;
            <select value={query.limit} onChange={(event) => updateQuery({ limit: Number(event.target.value) })}>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={80}>80</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Regime Summary</h2>
        <p className="muted card-intro">Click column headers to sort by size, vault count, or regime name.</p>
        <div className="split-grid">
          <KpiGrid
            items={[
              { label: "Regimes Tracked", value: String(summaryRows.length) },
              {
                label: "Total Vaults",
                value: String(summaryRows.reduce((acc, row) => acc + row.vaults, 0)),
              },
              {
                label: "Total TVL",
                value: formatUsd(summaryRows.reduce((acc, row) => acc + Number(row.tvl_usd || 0), 0)),
              },
            ]}
          />
          <BarList
            title="Regime TVL Mix"
            items={summaryRows.map((row) => ({
              id: row.regime,
              label: regimeLabel(row.regime),
              value: row.tvl_usd,
              note: `${row.vaults} vaults`,
            }))}
            valueFormatter={(value) => formatUsd(value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${summarySort.key === "regime" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(summarySort, "regime");
                      setSummarySort(next);
                      updateQuery({ summary_sort: next.key, summary_dir: next.direction });
                    }}
                  >
                    Regime <span className="th-indicator">{sortIndicator(summarySort, "regime")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${summarySort.key === "vaults" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(summarySort, "vaults");
                      setSummarySort(next);
                      updateQuery({ summary_sort: next.key, summary_dir: next.direction });
                    }}
                  >
                    Vaults <span className="th-indicator">{sortIndicator(summarySort, "vaults")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${summarySort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(summarySort, "tvl");
                      setSummarySort(next);
                      updateQuery({ summary_sort: next.key, summary_dir: next.direction });
                    }}
                  >
                    Total TVL <span className="th-indicator">{sortIndicator(summarySort, "tvl")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.regime}>
                  <td>
                    <Link
                      href={`/changes?window=7d&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}&regime_sort=tvl&regime_dir=desc`}
                    >
                      {regimeLabel(row.regime)}
                    </Link>
                  </td>
                  <td className="is-numeric">{row.vaults}</td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Regime Movers</h2>
        <p className="muted card-intro">Sort by momentum to spot short-term shifts, or by TVL to focus on size.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className={`th-button ${moverSort.key === "vault" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "vault");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    Vault <span className="th-indicator">{sortIndicator(moverSort, "vault")}</span>
                  </button>
                </th>
                <th>
                  <button
                    className={`th-button ${moverSort.key === "chain" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "chain");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    Chain <span className="th-indicator">{sortIndicator(moverSort, "chain")}</span>
                  </button>
                </th>
                <th className="tablet-hide">
                  <button
                    className={`th-button ${moverSort.key === "token" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "token");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    Token <span className="th-indicator">{sortIndicator(moverSort, "token")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${moverSort.key === "tvl" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "tvl");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    TVL <span className="th-indicator">{sortIndicator(moverSort, "tvl")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${moverSort.key === "apy" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "apy");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    APY 30d <span className="th-indicator">{sortIndicator(moverSort, "apy")}</span>
                  </button>
                </th>
                <th className="is-numeric">
                  <button
                    className={`th-button ${moverSort.key === "momentum" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "momentum");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    Momentum <span className="th-indicator">{sortIndicator(moverSort, "momentum")}</span>
                  </button>
                </th>
                <th className="tablet-hide">
                  <button
                    className={`th-button ${moverSort.key === "regime" ? "is-active" : ""}`}
                    onClick={() => {
                      const next = toggleSort(moverSort, "regime");
                      setMoverSort(next);
                      updateQuery({ mover_sort: next.key, mover_dir: next.direction });
                    }}
                  >
                    Regime <span className="th-indicator">{sortIndicator(moverSort, "regime")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {moverRows.map((row) => (
                <tr key={row.vault_address}>
                  <td title={row.vault_address}>{shortVaultLabel(row.symbol, row.vault_address)}</td>
                  <td>
                    <Link
                      href={`/discover?chain=${row.chain_id}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                    >
                      {chainLabel(row.chain_id)}
                    </Link>
                  </td>
                  <td className="tablet-hide">
                    {row.token_symbol ? (
                      <Link
                        href={`/assets?token=${encodeURIComponent(row.token_symbol)}&universe=${query.universe}&min_tvl=${query.minTvl}&min_points=${query.minPoints}`}
                      >
                        {row.token_symbol}
                      </Link>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td className="is-numeric">{formatUsd(row.tvl_usd)}</td>
                  <td className="is-numeric">{formatPct(row.safe_apy_30d)}</td>
                  <td className="is-numeric">{formatPct(row.momentum_7d_30d)}</td>
                  <td className="tablet-hide">{regimeLabel(row.regime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function RegimesPage() {
  return (
    <Suspense fallback={<main className="container"><section className="card">Loading…</section></main>}>
      <RegimesPageContent />
    </Suspense>
  );
}
