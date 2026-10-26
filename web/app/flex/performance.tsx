"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { TableWrap } from "../components/table-wrap";
import { useFlexPerformance } from "../hooks/use-flex-data";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const value = (amount: number | null) => amount === null ? "Unavailable" : usd.format(amount);
const pnl = (amount: number | null) => amount === null ? "Unavailable" : `${amount > 0 ? "+" : ""}${usd.format(amount)}`;

export function FlexPerformance({ days, onDays }: { days: 7 | 30 | 90; onDays: (days: 7 | 30 | 90) => void }) {
  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [side, setSide] = useState<"borrowers" | "lenders">("borrowers");
  const [market, setMarket] = useState("");
  const query = useFlexPerformance(address, days, !editing);
  const data = !editing ? query.data : undefined;
  const source = data?.[side];
  const markets = Array.from(new Map((source?.rows || []).map(row => [row.market_address, row.market_label])).entries());
  const rows = source?.rows.filter(row => !market || row.market_address === market) || [];
  const complete = rows.every(row => row.is_complete);
  const performance = source && market ? {
    ...source, rows, positions: rows.length, covered_positions: rows.filter(row => row.is_complete).length,
    pnl_usd: complete ? rows.reduce((sum, row) => sum + (row.pnl_usd || 0), 0) : null,
    end_value_usd: complete ? rows.reduce((sum, row) => sum + (row.end_value_usd || 0), 0) : null,
  } : source;
  const incomplete = performance?.pnl_usd === null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = draft.trim().toLowerCase();
    if (candidate && !/^0x[0-9a-f]{40}$/.test(candidate)) {
      setError("Enter a valid Ethereum address.");
      return;
    }
    setError("");
    setAddress(candidate || null);
    setMarket("");
    setEditing(false);
  }
  function overview() {
    setDraft("");
    setAddress(null);
    setEditing(false);
    setError("");
    setMarket("");
  }
  return <section className="section section-lg flex-performance" aria-labelledby="flex-performance-title">
    <div className="flex-performance-heading">
      <div><h2 className="card-title" id="flex-performance-title">Performance</h2>
        <p className="card-description">{address && !editing ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Active Flex markets"}</p>
      </div>
      <div className="flex-range-tabs" role="group" aria-label="Performance period">
        {([7, 30, 90] as const).map(period => <button type="button" key={period} className={`flex-range-tab ${days === period ? "is-active" : ""}`} aria-pressed={days === period} aria-label={`${period}-day performance`} onClick={() => onDays(period)}>{period}D</button>)}
      </div>
    </div>
    <form className="flex-performance-form" onSubmit={submit}>
      <label htmlFor="flex-performance-address">Address</label>
      <input id="flex-performance-address" className="input" value={draft} placeholder="0x… (optional)" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? "flex-performance-error" : undefined} onChange={event => { setDraft(event.target.value); setEditing(true); setError(""); }} />
      <button type="submit" className="button button-ghost">View P&amp;L</button>
      {address || editing ? <button type="button" className="button button-ghost" onClick={overview}>Overview</button> : null}
    </form>
    {error ? <p className="flex-performance-error" id="flex-performance-error" role="alert">{error}</p> : null}
    <div className="flex-range-tabs flex-performance-sides" role="group" aria-label="Performance side">
      {([['borrowers', 'Borrowing'], ['lenders', 'Lending']] as const).map(([key, label]) => <button type="button" key={key} className={`flex-range-tab ${side === key ? "is-active" : ""}`} aria-pressed={side === key} onClick={() => { setSide(key); setMarket(""); }}>{label}</button>)}
    </div>
    {markets.length > 1 ? <label className="flex-performance-filter">Market<select aria-label="Performance market" value={market} onChange={event => setMarket(event.target.value)}><option value="">All markets</option>{markets.map(([address, label]) => <option key={address} value={address}>{label}</option>)}</select></label> : null}
    <div aria-live="polite" aria-busy={query.isFetching && !editing}>
      {editing && !error ? <p className="muted">Submit to view this address.</p> : null}
      {!editing && query.isLoading ? <p className="muted">Calculating from indexed history…</p> : null}
      {!editing && query.isError ? <div className="flex-performance-unavailable"><p>Performance is temporarily unavailable.</p><button type="button" className="button button-ghost" onClick={() => query.refetch()}>Retry</button></div> : null}
      {data && performance ? <>
        <dl className="flex-performance-totals">
          <div><dt>{side === "borrowers" ? "Borrower P&L" : address ? "Lender P&L" : "Lender pool P&L"}</dt><dd data-testid="performance-total">{incomplete ? "Incomplete coverage" : pnl(performance.pnl_usd)}</dd></div>
          <div><dt>{side === "borrowers" ? "Net equity" : "Reported value"}</dt><dd>{value(performance.end_value_usd)}</dd></div>
          <div><dt>Coverage</dt><dd>{performance.covered_positions}/{performance.positions} {side === "borrowers" ? performance.positions === 1 ? "trove" : "troves" : performance.positions === 1 ? "market" : "markets"}</dd></div>
        </dl>
        {performance.rows.length ? <TableWrap className="flex-performance-rows"><table className="decision-table flex-performance-table" aria-label={`${side === "borrowers" ? "Borrower" : "Lender"} performance`}>
          <thead><tr><th>Market / position</th><th className="numeric">{side === "borrowers" ? "Net equity" : "Value"}</th><th className="numeric">P&amp;L</th></tr></thead>
          <tbody>{performance.rows.map(row => <tr key={`${row.market_address}:${row.position_id || row.kind}`}>
            <td data-label="Market / position"><Link className="report-link" href={`/flex?market=${row.market_address}`}>{row.market_label}</Link>
              {row.position_id ? <span className="flex-performance-position" title={`Trove ${row.position_id}`}>Trove {row.position_id.length > 14 ? `${row.position_id.slice(0,6)}…${row.position_id.slice(-6)}` : row.position_id}</span> : null}
              {row.issue ? <span className="flex-performance-position">{row.issue}</span> : null}
            </td>
            <td className="numeric data-value" data-label={side === "borrowers" ? "Net equity" : "Value"}>{value(row.end_value_usd)}</td>
            <td className="numeric data-value" data-label="P&L" title={row.is_complete ? `Starting value ${value(row.start_value_usd)}; net funding ${value(row.net_funding_usd)}` : row.issue || undefined}>{pnl(row.pnl_usd)}</td>
          </tr>)}</tbody>
        </table></TableWrap> : <p className="muted">{side === "borrowers" ? "No borrower positions in this period." : "No lender positions in this period."}</p>}
        <p className="section-note">{date.format(new Date(data.period.start_at))}–{date.format(new Date(data.period.end_at))} UTC{data.freshness.data_state === "delayed" ? " · Updates delayed" : ""}. USD change net of funding. Excludes gas and swap costs.</p>
        {side === "lenders" ? <p className="section-note">{address ? "Reported share value; excludes unreported interest." : "Reported pool value includes fee-recipient shares; excludes unreported interest."}</p> : null}
      </> : null}
    </div>
  </section>;
}
