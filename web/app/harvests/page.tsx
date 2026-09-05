"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { EmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { LockerRewards } from "../components/ylocker-rewards";
import { useDiscoverData } from "../hooks/use-discover-data";
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

function formatTokenAmount(value: string | null | undefined, decimals: number | null | undefined, exact = false): string {
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
  const firstNonzero = fraction.search(/[1-9]/);
  const precision = whole === "0" ? Math.max(4, firstNonzero + 3) : 4;
  const shownFraction = exact ? fraction : fraction.length > precision ? `${fraction.slice(0, precision)}…` : fraction;
  const shownWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${shownWhole}${shownFraction ? `.${shownFraction}` : ""}`;
}

function amountWithUnit(
  value: string | null | undefined,
  unit: string | null | undefined,
  decimals: number | null | undefined,
  exact = false,
): string {
  const amount = formatTokenAmount(value, decimals, exact);
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
  const catalog = useDiscoverData({ universe: "raw", market: "all", minTvl: 0, minPoints: 0, limit: 250, sort: "tvl", dir: "desc", allRows: true });
  const [searchError, setSearchError] = useState("");
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
  const applyVaultSearch = () => {
    const draft = vaultDraft.trim();
    if (!draft) { setSearchError(""); updateQuery({ vault_address: null }); return; }
    if (/^0x[a-fA-F0-9]{40}$/.test(draft)) { setSearchError(""); updateQuery({ vault_address: draft.toLowerCase() }); return; }
    const matches = (catalog.data?.rows ?? []).filter((row) => row.symbol?.toLowerCase() === draft.toLowerCase() && (!query.chainId || row.chain_id === query.chainId));
    if (matches.length === 1) {
      setSearchError("");
      setVaultDraft(matches[0].vault_address);
      updateQuery({ vault_address: matches[0].vault_address, chain_id: matches[0].chain_id });
    } else setSearchError(catalog.isLoading ? "Vault names are loading. You can also enter a full address." : "Select a vault from the list or enter its full address.");
  };
  const recentRows = data?.recent ?? [];
  const visibleRecentRows = compact && !mobileExpanded ? recentRows.slice(0, 10) : recentRows;

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  return (
    <>
      <section className="section section-md" aria-label="Report filters">
        <form onSubmit={(event) => { event.preventDefault(); applyVaultSearch(); }} className="report-search">
          <label htmlFor="report-vault-search" className="filter-label">Find a vault by name or address</label>
          <div className="report-search-controls"><input id="report-vault-search" type="search" className="filter-control" value={vaultDraft} list="report-vault-options" placeholder="Try yvUSD or 0x…" aria-describedby={searchError ? "report-search-error" : undefined} aria-invalid={Boolean(searchError)} onChange={(event) => { setVaultDraft(event.target.value); setSearchError(""); }} /><button className="button button-secondary" type="submit">Find</button></div>
          <datalist id="report-vault-options">{(catalog.data?.rows ?? []).filter((row) => !query.chainId || row.chain_id === query.chainId).map((row) => <option key={`${row.chain_id}:${row.vault_address}`} value={row.vault_address} label={`${row.symbol || "Vault"} · ${chainLabel(row.chain_id)}`} />)}</datalist>
          {searchError ? <p id="report-search-error" role="alert" className="explanation">{searchError}</p> : null}
        </form>
        <section className="detail-section report-filters"><h2 className="detail-title">Filter reports{query.chainId ? ` · ${chainLabel(query.chainId)}` : ""}{!query.meaningfulOnly ? " · all accounting updates" : ""}</h2><div className="detail-body"><div className="filter-grid">
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

        </div></div></section>
        {query.vaultAddress ? <p className="section-note active-filter-note">Showing one vault: <span className="data-value">{data?.recent?.[0]?.vault_symbol || shortAddress(query.vaultAddress)}</span> <button className="button-reset table-filter-action" onClick={() => updateQuery({ vault_address: null })}>Clear vault filter</button></p> : null}
      </section>

      <section className="section">
        <div className="card-header">
          <div>
            <h2 className="card-title">Reported results</h2>
            <p className="card-subtitle">Newest first · last {HISTORY_DAYS} days</p>
            <p className="explanation">Result = gain − loss, in the vault&apos;s asset. This is a strategy result, not your personal return.</p>
            {isLoading && !data ? <p className="section-note muted">Loading reports…</p> : (
              <p className="section-note">
                Last 24 hours: <strong>{data?.trailing_24h?.report_count ?? 0}</strong> reports from{" "}
                <strong>{data?.trailing_24h?.vault_count ?? 0}</strong> vaults and{" "}
                <strong>{data?.trailing_24h?.strategy_count ?? 0}</strong> strategies.
              </p>
            )}
          </div>
        </div>
        {!isLoading && (data?.recent?.length ?? 0) === 0 ? (
          <EmptyState title="No matching reports" description="Try another chain or vault, or show all accounting updates." />
        ) : (
          <TableWrap className="reports-table-wrap">
            <table className="reports-table" aria-label="Vault strategy reports">
              <thead><tr><th>Time</th><th>Vault</th><th className="numeric">Reported result</th><th>Strategy</th><th className="numeric">Fees / refund</th><th className="numeric">Debt after</th></tr></thead>
              <tbody>{isLoading && !data ? <TableSkeleton rows={8} columns={6} /> : visibleRecentRows.map((row) => {
                const vaultUrl = yearnVaultUrl(row.chain_id, row.vault_address);
                const strategyUrl = explorerAddressUrl(row.chain_id, row.strategy_address);
                const txUrl = explorerTxUrl(row.chain_id, row.tx_hash);
                return (
                  <tr key={`${row.chain_id}-${row.tx_hash}-${row.log_index}`}>
                    <td data-label="Time">{txUrl ? <a className="external-link report-link report-link-utility" href={txUrl} target="_blank" rel="noreferrer" title={formatUtcDateTime(row.block_time)} aria-label={`View transaction ${row.tx_hash}`}>{compactTimestamp(row.block_time)}</a> : compactTimestamp(row.block_time)}</td>
                    <td data-label="Vault">
                      <a className="external-link report-link report-link-entity report-link-vault" href={vaultUrl} target="_blank" rel="noreferrer">{row.vault_symbol || shortAddress(row.vault_address)}</a>
                      <div className="muted">{chainLabel(row.chain_id)} · {row.token_symbol || "asset"} · <button className="button-reset table-filter-action report-filter-action" aria-label={`Show only reports for ${row.vault_symbol || row.vault_address}`} onClick={() => updateQuery({ vault_address: row.vault_address })}>Only this vault</button></div>
                    </td>
                    <td data-label="Reported result" className={`numeric report-result ${signedResult(row.gain, row.loss, row.token_symbol, row.token_decimals).startsWith("-") ? "text-negative" : signedResult(row.gain, row.loss, row.token_symbol, row.token_decimals).startsWith("+") ? "text-positive" : ""}`}>{signedResult(row.gain, row.loss, row.token_symbol, row.token_decimals)}<div className="muted report-exact">Gain: {amountWithUnit(row.gain, row.token_symbol, row.token_decimals, true)}</div><div className="muted report-exact">Loss: {amountWithUnit(row.loss, row.token_symbol, row.token_decimals, true)}</div></td>
                    <td data-label="Strategy">{strategyUrl ? <a href={strategyUrl} target="_blank" rel="noreferrer" title={row.strategy_address}>{row.strategy_name || shortAddress(row.strategy_address)}</a> : row.strategy_name || shortAddress(row.strategy_address)}<div className="muted">{row.report_type === "realized_result" ? "Realized result" : "Accounting update"}</div></td>
                    <td data-label="Fees / refund" className="numeric report-exact"><div>{amountWithUnit(row.fee_assets, row.token_symbol, row.token_decimals, true)} fee</div><div className="muted">{amountWithUnit(row.refund_assets, row.token_symbol, row.token_decimals, true)} refund</div></td>
                    <td data-label="Debt after" className="numeric report-exact">{amountWithUnit(row.debt_after, row.token_symbol, row.token_decimals, true)}</td>
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
          <h1 className="page-title">Rewards & reports<br /><em className="page-title-accent">{view === "lockers" ? "Locker rewards" : "Vault reports"}</em></h1>
          <p className="page-description">{view === "lockers"
            ? "Weekly yCRV and yYB rewards."
            : "Vault gains, losses, and accounting updates."}</p>
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
