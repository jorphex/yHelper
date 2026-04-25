"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { EmptyState } from "../components/empty-state";
import { KpiGrid, BarList } from "../components/visuals";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { useHarvestData, type HarvestResponse } from "../hooks/use-harvest-data";
import { chainLabel, explorerAddressUrl, explorerTxUrl, formatUtcDateTime, yearnVaultUrl } from "../lib/format";
import { queryInt, queryString, replaceQuery } from "../lib/url";

const HARVEST_HISTORY_DAYS = 90;

function compactRawAmount(value: string | null | undefined): string {
  if (!value) return "n/a";
  const raw = value.trim();
  if (!raw || raw === "0") return "0";
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return raw;
  if (digits.length <= 12) {
    return `${negative ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }
  const head = digits.slice(0, 3);
  const exponent = digits.length - 1;
  return `${negative ? "-" : ""}${head[0]}.${head.slice(1)}e${exponent}`;
}

function formatTokenAmount(
  value: string | null | undefined,
  decimals: number | null | undefined,
): string {
  if (!value) return "n/a";
  const raw = value.trim();
  if (!raw) return "n/a";
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return value;
  if (digits === "0") return "0";
  if (decimals === null || decimals === undefined || !Number.isInteger(decimals) || decimals < 0) {
    return compactRawAmount(value);
  }
  const padded = digits.padStart(decimals + 1, "0");
  const splitIndex = Math.max(padded.length - decimals, 1);
  const whole = padded.slice(0, splitIndex).replace(/^0+(?=\d)/, "") || "0";
  const fraction = padded.slice(splitIndex).replace(/0+$/, "");
  const displayFraction = fraction.length > 6 ? `${fraction.slice(0, 6)}…` : fraction;
  const wholeWithCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${displayFraction ? `${wholeWithCommas}.${displayFraction}` : wholeWithCommas}`;
}

function shortHash(value: string): string {
  if (!value) return "n/a";
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function amountWithUnit(
  value: string | null | undefined,
  unit: string | null | undefined,
  decimals: number | null | undefined,
): string {
  const amount = formatTokenAmount(value, decimals);
  if (!unit || unit.trim().length === 0 || amount === "n/a") return amount;
  return `${amount} ${unit.trim()}`;
}

function dayLabelParts(dayUtc: string): { month: string; day: string } {
  const date = new Date(`${dayUtc}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { month: dayUtc, day: "" };
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date),
    day: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(date),
  };
}

function DailyMatrix({
  rows,
}: {
  rows: NonNullable<HarvestResponse>["daily_by_chain"];
}) {
  const matrixDays = useMemo(() => {
    const unique = Array.from(new Set((rows ?? []).map((row) => row.day_utc))).filter(Boolean).sort();
    return unique.slice(-14);
  }, [rows]);

  const chains = useMemo(() => {
    const grouped = new Map<number, { chain_id: number; chain_label: string; points: Map<string, number> }>();
    for (const row of rows ?? []) {
      const current = grouped.get(row.chain_id) ?? {
        chain_id: row.chain_id,
        chain_label: row.chain_label || chainLabel(row.chain_id),
        points: new Map<string, number>(),
      };
      current.points.set(row.day_utc, row.harvest_count);
      grouped.set(row.chain_id, current);
    }
    return Array.from(grouped.values()).sort((left, right) => left.chain_label.localeCompare(right.chain_label));
  }, [rows]);

  const maxValue = useMemo(() => {
    let current = 0;
    for (const row of rows ?? []) current = Math.max(current, row.harvest_count);
    return current;
  }, [rows]);

  if (!rows || rows.length === 0 || matrixDays.length === 0 || chains.length === 0) {
    return (
      <div className="panel-empty muted">
        No daily harvest activity is available for this filter yet.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(82px, 104px) repeat(14, minmax(24px, 1fr))",
          gap: "6px",
          alignItems: "center",
          fontSize: "11px",
          color: "var(--text-tertiary)",
        }}
      >
        <div />
        {matrixDays.map((day) => {
          const label = dayLabelParts(day);
          return (
            <div key={day} style={{ textAlign: "center", lineHeight: 1.1 }}>
              <div>{label.month}</div>
              <div>{label.day}</div>
            </div>
          );
        })}
      </div>
      {chains.map((chain) => (
        <div
          key={chain.chain_id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(82px, 104px) repeat(14, minmax(24px, 1fr))",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{chain.chain_label}</div>
          {matrixDays.map((day) => {
            const label = dayLabelParts(day);
            const value = chain.points.get(day) ?? 0;
            const intensity = maxValue > 0 ? value / maxValue : 0;
            const fillAlpha = value > 0 ? 0.14 + intensity * 0.72 : 0.05;
            return (
              <div
                key={`${chain.chain_id}-${day}`}
                title={`${chain.chain_label} • ${label.month} ${label.day} • ${value} harvests`}
                style={{
                  minHeight: "28px",
                  borderRadius: "8px",
                  border: value > 0
                    ? `1px solid rgba(var(--accent-rgb), ${Math.min(0.28 + intensity * 0.42, 0.66)})`
                    : "1px solid color-mix(in oklab, var(--border-subtle) 88%, var(--accent) 12%)",
                  background: value > 0 ? `rgba(var(--accent-rgb), ${fillAlpha.toFixed(3)})` : "var(--bg-elevated)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: "11px",
                  color: value > 0 ? "white" : "var(--text-tertiary)",
                }}
              >
                {value > 0 ? value : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HarvestsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    chainId: searchParams.get("chain_id") ? queryInt(searchParams, "chain_id", 0, { min: 1 }) : null,
    vaultAddress: queryString(searchParams, "vault_address", ""),
    limit: queryInt(searchParams, "limit", 50, { min: 1, max: 200 }),
  }), [searchParams]);

  const { data, isLoading, error, refetch } = useHarvestData({
    days: HARVEST_HISTORY_DAYS,
    chainId: query.chainId,
    vaultAddress: query.vaultAddress || null,
    limit: query.limit,
  });
  const [vaultDraft, setVaultDraft] = useState(query.vaultAddress);

  useEffect(() => {
    setVaultDraft(query.vaultAddress);
  }, [query.vaultAddress]);

  const chainOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const row of data?.chain_rollups ?? []) byId.set(row.chain_id, row.chain_label || chainLabel(row.chain_id));
    for (const row of data?.daily_by_chain ?? []) byId.set(row.chain_id, row.chain_label || chainLabel(row.chain_id));
    return Array.from(byId.entries())
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([chain_id, label]) => ({ chain_id, label }));
  }, [data?.chain_rollups, data?.daily_by_chain]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);

  const applyVaultFilter = () => {
    updateQuery({ vault_address: vaultDraft.trim() || null });
  };

  const kpiItems = useMemo(() => [
    { label: data?.metric?.headline_label || "Vault Harvests (24h)", value: String(data?.trailing_24h?.harvest_count ?? 0) },
    { label: "Reporting Vaults (24h)", value: String(data?.trailing_24h?.vault_count ?? 0) },
    { label: "Reporting Strategies (24h)", value: String(data?.trailing_24h?.strategy_count ?? 0) },
    { label: "Chains In Window", value: String(data?.chain_rollups?.length ?? 0), hint: data?.metric?.history_window_label || `Last ${HARVEST_HISTORY_DAYS}d` },
  ], [data]);

  const chainBarItems = useMemo(() =>
    (data?.chain_rollups ?? []).map((row) => ({
      id: String(row.chain_id),
      label: row.chain_label || chainLabel(row.chain_id),
      value: row.harvest_count,
      note: row.last_harvest_at ? `Last report ${formatUtcDateTime(row.last_harvest_at)}` : "No recent report",
    })),
  [data?.chain_rollups]);

  const backfillNote = data?.last_run?.status === "running" && (data?.recent?.length ?? 0) === 0;

  if (error && !data) {
    return <DataLoadError onRetry={() => refetch()} />;
  }

  return (
    <div>
      <section className="page-header page-header-no-border">
        <h1 className="page-title">
          Harvests
          <br />
          <em className="page-title-accent">Vault report flow</em>
        </h1>
        <p className="page-description">
          Track vault-level strategy reports across chains, then narrow the event stream down to a single vault when you want exact gain, loss, and fee rows.
        </p>
      </section>

      <section className="section section-sm">
        <div className="card">
          <div className="filter-bar">
            <label style={{ width: "160px", maxWidth: "100%", flexShrink: 0 }}>
              <span className="filter-label">Chain</span>
              <select
                value={query.chainId ?? ""}
                onChange={(event) => updateQuery({ chain_id: event.target.value ? Number(event.target.value) : null })}
                className="filter-control"
              >
                <option value="">All chains</option>
                {chainOptions.map((option) => (
                  <option key={option.chain_id} value={option.chain_id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={{ flex: "1 1 280px", maxWidth: "100%" }}>
              <span className="filter-label">Vault Filter</span>
              <div className="input-composite">
                <input
                  value={vaultDraft}
                  onChange={(event) => setVaultDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyVaultFilter();
                  }}
                  placeholder="Paste a vault address"
                  spellCheck={false}
                />
                <button
                  className="button button-ghost"
                  onClick={applyVaultFilter}
                  style={{ borderRadius: "10px", alignSelf: "stretch", height: "100%" }}
                >
                  Apply
                </button>
              </div>
            </label>
            {(query.chainId || query.vaultAddress) ? (
              <div style={{ display: "flex", alignItems: "end" }}>
                <button className="button button-ghost" onClick={() => updateQuery({ chain_id: null, vault_address: null })}>
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>

          {backfillNote ? (
            <div className="info-banner">
              Initial backfill is still moving through older harvest rows, so shorter windows can stay empty until the scan reaches recent blocks.
            </div>
          ) : null}
        </div>
      </section>

      <div className="section-divider" />

      <section className="section section-sm">
        <div className="kpi-grid">
          {isLoading && !data ? <KpiGridSkeleton count={4} /> : <KpiGrid items={kpiItems} />}
        </div>
      </section>

      <div className="section-divider" />

      <div className="cols-responsive-2">
        <section className="card">
          <h2 className="card-title">Chain Split</h2>
          <p className="card-description">
            Bars and numbers show total harvest reports per chain for the selected window.
          </p>
          {isLoading && !data ? (
            <div className="panel-empty muted">Loading chain rollups…</div>
          ) : (
            <BarList
              title=""
              items={chainBarItems}
              valueFormatter={(value) => `${value ?? 0}`}
              emptyText="No chain activity in this window yet."
            />
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Daily Activity</h2>
          <p className="card-description">
            Last 14 daily buckets for the selected scope. Each cell shows the report count, and brighter blue means more reports landed that day.
          </p>
          {isLoading && !data ? (
            <div className="panel-empty muted">Loading daily activity…</div>
          ) : (
            <DailyMatrix rows={data?.daily_by_chain ?? []} />
          )}
        </section>
      </div>

      <section className="section">
        <div className="card-header">
          <div>
            <h2 className="card-title">Recent Reports</h2>
            <p className="card-description">
              Showing the latest {query.limit} rows. Gain and fee values are raw underlying-asset units from the report event.
            </p>
          </div>
        </div>

        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Chain</th>
                <th>Vault</th>
                <th>Strategy</th>
                <th>Gain</th>
                <th>Fees</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <TableSkeleton rows={6} columns={6} />
              ) : (data?.recent?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No harvest rows"
                      description="No harvest reports match the current filter. Try clearing the vault filter or selecting a different chain."
                      icon="data"
                    />
                  </td>
                </tr>
              ) : (
                data?.recent?.map((row) => (
                  <tr key={`${row.tx_hash}-${row.vault_address}`}>
                    <td className="nowrap">
                      <div className="cell-stack">
                        <span>{formatUtcDateTime(row.block_time)}</span>
                        {explorerTxUrl(row.chain_id, row.tx_hash) ? (
                          <a
                            href={explorerTxUrl(row.chain_id, row.tx_hash)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="external-link-inline text-xs"
                          >
                            {shortHash(row.tx_hash)}
                          </a>
                        ) : (
                          <span className="text-xs text-tertiary">{shortHash(row.tx_hash)}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {row.chain_label || chainLabel(row.chain_id)}
                    </td>
                    <td>
                      <div className="cell-stack">
                        <a
                          href={yearnVaultUrl(row.chain_id, row.vault_address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link-inline font-semibold"
                        >
                          {row.vault_symbol || shortHash(row.vault_address)}
                        </a>
                        {explorerAddressUrl(row.chain_id, row.vault_address) ? (
                          <a
                            href={explorerAddressUrl(row.chain_id, row.vault_address)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="external-link-inline text-xs"
                          >
                            {shortHash(row.vault_address)}
                          </a>
                        ) : (
                          <span className="text-xs text-tertiary">{shortHash(row.vault_address)}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {explorerAddressUrl(row.chain_id, row.strategy_address) ? (
                        <a
                          href={explorerAddressUrl(row.chain_id, row.strategy_address)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link-inline"
                        >
                          {shortHash(row.strategy_address)}
                        </a>
                      ) : (
                        shortHash(row.strategy_address)
                      )}
                    </td>
                    <td className="data-value">
                      {amountWithUnit(row.gain, row.token_symbol, row.token_decimals)}
                    </td>
                    <td className="data-value">
                      {amountWithUnit(row.fee_assets, row.token_symbol, row.token_decimals)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </div>
  );
}

export default function HarvestsPage() {
  return (
    <Suspense fallback={<div className="panel-empty muted">Loading harvest view…</div>}>
      <HarvestsPageContent />
    </Suspense>
  );
}
