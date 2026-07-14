"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataLoadError } from "../components/error-state";
import { EmptyState } from "../components/empty-state";
import { TableSkeleton } from "../components/skeleton";
import { TableWrap } from "../components/table-wrap";
import { useHarvestData } from "../hooks/use-harvest-data";
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

function ReportsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => ({
    chainId: searchParams.get("chain_id") ? queryInt(searchParams, "chain_id", 0, { min: 1 }) : null,
    vaultAddress: queryString(searchParams, "vault_address", ""),
    limit: queryInt(searchParams, "limit", 25, { min: 1, max: 200 }),
    meaningfulOnly: searchParams.get("all") !== "1",
  }), [searchParams]);

  const { data, isLoading, error, refetch } = useHarvestData({
    days: HISTORY_DAYS,
    chainId: query.chainId,
    vaultAddress: query.vaultAddress || null,
    limit: query.limit,
    meaningfulOnly: query.meaningfulOnly,
  });
  const { data: chainData } = useHarvestData({
    days: HISTORY_DAYS,
    limit: 1,
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

  const chainOptions = useMemo(() => (chainData?.chain_rollups ?? [])
    .map((row) => ({ id: row.chain_id, label: row.chain_label || chainLabel(row.chain_id) }))
    .sort((left, right) => left.label.localeCompare(right.label)), [chainData?.chain_rollups]);
  const updateQuery = (updates: Record<string, string | number | null | undefined>) =>
    replaceQuery(router, pathname, searchParams, updates);
  const recentRows = data?.recent ?? [];
  const visibleRecentRows = compact && !mobileExpanded ? recentRows.slice(0, 10) : recentRows;

  if (error && !data) return <DataLoadError onRetry={() => refetch()} />;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Vault reports</h1>
          <p className="page-description">
            Strategy accounting updates emitted by Yearn vaults. The default view keeps reports that realized a gain,
            loss, fee, or refund; use all updates when you need the complete ledger trail.
          </p>
        </div>
      </header>

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
            <option value="meaningful">Realized results</option>
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
      </section>

      {isLoading && !data ? <p className="section section-md muted">Loading report scope…</p> : (
        <section className="section section-md"><p className="section-note">
          Last 24 hours: <strong>{data?.trailing_24h?.harvest_count ?? 0}</strong> reports from{" "}
          <strong>{data?.trailing_24h?.vault_count ?? 0}</strong> vaults and{" "}
          <strong>{data?.trailing_24h?.strategy_count ?? 0}</strong> strategies. Amounts use each vault&apos;s
          underlying asset and are not USD-normalized.
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
          <EmptyState title="No matching reports" description="Try another chain, vault, or include all accounting updates." />
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
                    <td data-label="Time">{txUrl ? <a className="external-link" href={txUrl} target="_blank" rel="noreferrer">{formatUtcDateTime(row.block_time)}</a> : formatUtcDateTime(row.block_time)}</td>
                    <td data-label="Vault">
                      <a className="external-link" href={vaultUrl} target="_blank" rel="noreferrer">{row.vault_symbol || shortAddress(row.vault_address)}</a>
                      <div className="muted">{chainLabel(row.chain_id)} · {row.token_symbol || "asset"} · <button className="button-reset table-filter-action" aria-label={`Filter reports to ${row.vault_symbol || row.vault_address}`} onClick={() => updateQuery({ vault_address: row.vault_address })}>Filter</button></div>
                    </td>
                    <td data-label="Strategy">
                      {strategyUrl ? <a className="external-link" href={strategyUrl} target="_blank" rel="noreferrer">{row.strategy_name || shortAddress(row.strategy_address)}</a> : row.strategy_name || shortAddress(row.strategy_address)}
                    </td>
                    {query.meaningfulOnly ? null : <td data-label="Type">{row.report_type === "realized_result" ? "Realized result" : "Accounting update"}</td>}
                    <td data-label="Result" className={`numeric ${hasAmount(row.loss) ? "text-negative" : hasAmount(row.gain) ? "text-positive" : ""}`.trim()}>{signedResult(row.gain, row.loss, row.token_symbol, row.token_decimals)}</td>
                    <td data-label="Fees / refund" className="numeric">
                      {hasAmount(row.fee_assets) ? <div>{amountWithUnit(row.fee_assets, row.token_symbol, row.token_decimals)} fee</div> : null}
                      {hasAmount(row.refund_assets) ? <div className="muted">{amountWithUnit(row.refund_assets, row.token_symbol, row.token_decimals)} refund</div> : null}
                      {!hasAmount(row.fee_assets) && !hasAmount(row.refund_assets) ? "—" : null}
                    </td>
                    <td data-label="Debt after" className="numeric">{amountWithUnit(row.debt_after, row.token_symbol, row.token_decimals)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </TableWrap>
        )}
        {!isLoading && compact && recentRows.length > 10 ? <button className="button button-ghost section-sm" onClick={() => setMobileExpanded((value) => !value)}>{mobileExpanded ? "Show 10 recent reports" : `Show all ${recentRows.length} loaded reports`}</button> : null}
        {!isLoading && !compact && (recentRows.length >= 25 || query.limit > 25) ? <button className="button button-ghost section-sm" onClick={() => updateQuery({ limit: query.limit > 25 ? 25 : 50 })}>{query.limit > 25 ? "Show fewer" : "Show 50 recent reports"}</button> : null}
      </section>
    </>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<div className="page-loading">Loading vault reports…</div>}><ReportsPageContent /></Suspense>;
}
