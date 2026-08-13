"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { EmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { LockerRewards } from "../components/ylocker-rewards";
import { useReportData } from "../hooks/use-report-data";
import {
  chainLabel,
  explorerAddressUrl,
  explorerTxUrl,
  formatUtcDateTime,
  yearnVaultUrl,
} from "../lib/format";
import { queryInt, queryString, replaceQuery } from "../lib/url";

const HISTORY_DAYS = 90;

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
  return `${negative ? "-" : ""}${head[0]}.${head.slice(1)}e${digits.length - 1}`;
}

function formatTokenAmount(value: string | null | undefined, decimals: number | null | undefined): string {
  if (!value?.trim()) return "n/a";
  const raw = value.trim();
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return raw;
  if (digits === "0") return "0";
  if (decimals == null || !Number.isInteger(decimals) || decimals < 0) return compactRawAmount(value);
  const padded = digits.padStart(decimals + 1, "0");
  const split = Math.max(padded.length - decimals, 1);
  const whole = padded.slice(0, split).replace(/^0+(?=\d)/, "") || "0";
  const fraction = padded.slice(split).replace(/0+$/, "");
  const shownFraction = fraction.length > 6 ? `${fraction.slice(0, 6)}…` : fraction;
  const shownWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${shownWhole}${shownFraction ? `.${shownFraction}` : ""}`;
}

function amountWithUnit(
  value: string | null | undefined,
  unit: string | null | undefined,
  decimals: number | null | undefined,
): string {
  const amount = formatTokenAmount(value, decimals);
  return unit?.trim() && amount !== "n/a" ? `${amount} ${unit.trim()}` : amount;
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "n/a";
  return `${value.slice(0, 8)}…${value.slice(-5)}`;
}

function compactTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date).replace(",", " ·") + " UTC";
}

function hasAmount(value: string | null | undefined): boolean {
  return Boolean(value?.trim() && !/^0+$/.test(value.trim()));
}

function signedResult(
  gain: string | null | undefined,
  loss: string | null | undefined,
  unit: string | null | undefined,
  decimals: number | null | undefined,
): string {
  try {
    const net = BigInt(gain?.trim() || "0") - BigInt(loss?.trim() || "0");
    const formatted = amountWithUnit(net.toString(), unit, decimals);
    return net > 0n ? `+${formatted}` : formatted;
  } catch {
    return "n/a";
  }
}

function VaultReportsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => ({
    chainId: searchParams.get("chain_id") ? queryInt(searchParams, "chain_id", 0, { min: 1 }) : null,
    vaultAddress: queryString(searchParams, "vault_address", ""),
    limit: queryInt(searchParams, "limit", 25, { min: 1, max: 200 }),
    meaningfulOnly: searchParams.get("all") !== "1",
  }), [searchParams]);

  const { data, isLoading, error, refetch } = useReportData({
    days: HISTORY_DAYS,
    chainId: query.chainId,
    vaultAddress: query.vaultAddress || null,
    limit: query.limit,
    meaningfulOnly: query.meaningfulOnly,
  });
  const [vaultDraft, setVaultDraft] = useState(query.vaultAddress);
  const [compact, setCompact] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  useEffect(() => setVaultDraft(query.vaultAddress), [query.vaultAddress]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => setMobileExpanded(false), [query.chainId, query.meaningfulOnly, query.vaultAddress]);

  const chainOptions = useMemo(() => (data?.available_chains ?? [])
    .map((row) => ({ id: row.chain_id, label: row.chain_label || chainLabel(row.chain_id) }))
    .sort((left, right) => left.label.localeCompare(right.label)), [data?.available_chains]);
  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);
  const recentRows = data?.recent ?? [];
  const visibleRecentRows = compact && !mobileExpanded ? recentRows.slice(0, 10) : recentRows;

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  return (
    <>
      <section className="section section-md" aria-label="Report filters">
        <div className="card"><div className="filter-grid">
        <label>
          <span className="filter-label">Chain</span>
          <select className="filter-control" value={query.chainId ?? ""} onChange={(event) => updateQuery({ chain_id: event.target.value || null })}>
            <option value="">All chains</option>
            {chainOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span className="filter-label">Report scope</span>
          <select
            className="filter-control"
            value={query.meaningfulOnly ? "meaningful" : "all"}
            onChange={(event) => updateQuery({ all: event.target.value === "all" ? 1 : null })}
          >
            <option value="meaningful">Results, fees, or refunds</option>
            <option value="all">All accounting updates</option>
          </select>
        </label>
        <label>
          <span className="filter-label">Vault address (optional)</span>
          <input
            type="text"
            className="filter-control"
            value={vaultDraft}
            placeholder="0x…"
            onChange={(event) => setVaultDraft(event.target.value)}
            onBlur={() => updateQuery({ vault_address: vaultDraft.trim() || null })}
            onKeyDown={(event) => {
              if (event.key === "Enter") updateQuery({ vault_address: vaultDraft.trim() || null });
            }}
          />
        </label>
        </div></div>
        {query.vaultAddress ? <p className="section-note active-filter-note">Showing one vault: <span className="data-value">{data?.recent?.[0]?.vault_symbol || shortAddress(query.vaultAddress)}</span> <button className="button-reset table-filter-action" onClick={() => updateQuery({ vault_address: null })}>Clear vault filter</button></p> : null}
      </section>

      {isLoading && !data ? <p className="section section-md muted">Loading reports…</p> : (
        <section className="section section-md"><p className="section-note">
          Last 24 hours: <strong>{data?.trailing_24h?.report_count ?? 0}</strong> reports from{" "}
          <strong>{data?.trailing_24h?.vault_count ?? 0}</strong> vaults and{" "}
          <strong>{data?.trailing_24h?.strategy_count ?? 0}</strong> strategies. Amounts are shown in each vault&apos;s
          asset, not converted to USD.
        </p></section>
      )}

      <section className="section">
        <div className="card-header">
          <div>
            <h2 className="card-title">Recent strategy reports</h2>
            <p className="card-subtitle">Newest first · last {HISTORY_DAYS} days</p>
          </div>
        </div>
        {!isLoading && (data?.recent?.length ?? 0) === 0 ? (
          <EmptyState title="No matching reports" description="Try another chain or vault, or show all accounting updates." />
        ) : (
          <TableWrap className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr>
                <th>Time</th><th>Vault</th><th>Strategy</th>{query.meaningfulOnly ? null : <th>Type</th>}
                <th className="numeric">Result</th><th className="numeric">Fees / refund</th><th className="numeric">Debt after</th>
              </tr></thead>
              <tbody>{isLoading && !data ? <TableSkeleton rows={8} columns={query.meaningfulOnly ? 6 : 7} /> : visibleRecentRows.map((row) => {
                const vaultUrl = yearnVaultUrl(row.chain_id, row.vault_address);
                const strategyUrl = explorerAddressUrl(row.chain_id, row.strategy_address);
                const txUrl = explorerTxUrl(row.chain_id, row.tx_hash);
                return (
                  <tr key={`${row.chain_id}-${row.tx_hash}-${row.log_index}`}>
                    <td data-label="Time">{txUrl ? <a className="external-link report-link report-link-utility" href={txUrl} target="_blank" rel="noreferrer" title={formatUtcDateTime(row.block_time)}>{compactTimestamp(row.block_time)}</a> : compactTimestamp(row.block_time)}</td>
                    <td data-label="Vault">
                      <a className="external-link report-link report-link-entity report-link-vault" href={vaultUrl} target="_blank" rel="noreferrer">{row.vault_symbol || shortAddress(row.vault_address)}</a>
                      <div className="muted">{chainLabel(row.chain_id)} · {row.token_symbol || "asset"} · <button className="button-reset table-filter-action report-filter-action" aria-label={`Show only reports for ${row.vault_symbol || row.vault_address}`} onClick={() => updateQuery({ vault_address: row.vault_address })}>Only this vault</button></div>
                    </td>
                    <td data-label="Strategy">
                      {strategyUrl ? <a className={`external-link report-link report-link-entity report-link-strategy ${row.strategy_name ? "" : "report-link-address"}`.trim()} href={strategyUrl} target="_blank" rel="noreferrer">{row.strategy_name || shortAddress(row.strategy_address)}</a> : row.strategy_name || shortAddress(row.strategy_address)}
                    </td>
                    {query.meaningfulOnly ? null : <td data-label="Type">{row.report_type === "realized_result" ? "Realized result" : "Accounting update"}</td>}
                    <td data-label="Result" className={`numeric report-result ${hasAmount(row.loss) ? "text-negative" : hasAmount(row.gain) ? "text-positive" : ""}`.trim()}>{signedResult(row.gain, row.loss, row.token_symbol, row.token_decimals)}</td>
                    <td data-label="Fees / refund" className="numeric">
                      {hasAmount(row.fee_assets) ? <div>{amountWithUnit(row.fee_assets, row.token_symbol, row.token_decimals)} fee</div> : null}
                      {hasAmount(row.refund_assets) ? <div className="muted">{amountWithUnit(row.refund_assets, row.token_symbol, row.token_decimals)} refund</div> : null}
                      {!hasAmount(row.fee_assets) && !hasAmount(row.refund_assets) ? "None" : null}
                    </td>
                    <td data-label="Debt after" className="numeric">{amountWithUnit(row.debt_after, row.token_symbol, row.token_decimals)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </TableWrap>
        )}
        {!isLoading && compact && recentRows.length > 10 ? <button className="button button-ghost section-sm" onClick={() => setMobileExpanded((value) => !value)}>{mobileExpanded ? "Show 10 recent reports" : `Show all ${recentRows.length} reports`}</button> : null}
        {!isLoading && !compact && (recentRows.length >= 25 || query.limit > 25) ? <button className="button button-ghost section-sm" onClick={() => updateQuery({ limit: query.limit > 25 ? 25 : 50 })}>{query.limit > 25 ? "Show fewer" : "Show 50 recent reports"}</button> : null}
      </section>
    </>
  );
}

function ReportsPageContent() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "lockers" ? "lockers" : "vaults";
  return (
    <>
      <header className="page-header reports-page-header">
        <div>
          <h1 className="page-title">Reports<br /><em className="page-title-accent">{view === "lockers" ? "Locker rewards" : "Vault reports"}</em></h1>
          <p className="page-description">{view === "lockers"
            ? "Weekly yCRV and yYB rewards."
            : "A clear view of recent vault activity."}</p>
        </div>
        <nav className="reports-view-nav" aria-label="Reports">
          <Link href="/reports?view=vaults" className={`reports-view-link ${view === "vaults" ? "is-active" : ""}`.trim()} aria-current={view === "vaults" ? "page" : undefined}>Vault reports</Link>
          <Link href="/reports?view=lockers" className={`reports-view-link ${view === "lockers" ? "is-active" : ""}`.trim()} aria-current={view === "lockers" ? "page" : undefined}>Locker rewards</Link>
        </nav>
      </header>
      {view === "lockers" ? <LockerRewards /> : <VaultReportsContent />}
    </>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<div className="page-loading">Loading reports…</div>}><ReportsPageContent /></Suspense>;
}
