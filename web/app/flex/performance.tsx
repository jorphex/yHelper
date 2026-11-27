"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { TableWrap } from "../components/table-wrap";
import { FLEX_PERIODS, useFlexActivity, useFlexPerformance, type FlexPerformanceResponse, type FlexPerformanceRow, type FlexPeriod } from "../hooks/use-flex-data";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const eventDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const amount = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 });
const value = (amount: number | null) => amount === null ? "Unavailable" : usd.format(amount);
const pnl = (amount: number | null) => amount === null ? "Unavailable" : `${amount > 0 ? "+" : ""}${usd.format(amount)}`;

function PositionEvents({ market, id, period }: { market: string; id: string; period: FlexPerformanceResponse["period"] }) {
  const activity = useFlexActivity({ market_address: market, trove_id: id, after_block: period.start_block, through_block: period.end_block });
  const events = activity.data?.pages.flatMap(page => page.rows) ?? [];
  if (activity.isLoading) return <p role="status">Loading position events…</p>;
  if (activity.isError && !events.length) return <button type="button" className="button button-ghost" onClick={() => activity.refetch()}>Retry position events</button>;
  if (!events.length) return <p>No position events in this period.</p>;
  return <>
    <ul aria-label="Position events in period">{events.map(event => <li key={`${event.tx_hash}:${event.log_index}`}>
      <Link className="report-link" href={`https://etherscan.io/tx/${event.tx_hash}`} target="_blank" rel="noreferrer">{event.event.replaceAll("_", " ")}</Link>
      {" · "}<time dateTime={event.block_time}>{eventDate.format(new Date(event.block_time))} UTC</time>
    </li>)}</ul>
    {activity.hasNextPage ? <button type="button" className="button button-ghost" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>{activity.isFetchingNextPage ? "Loading events…" : "Show older position events"}</button> : null}
  </>;
}

function PerformanceRow({ row, period, href, valueLabel }: {
  row: FlexPerformanceRow;
  period: FlexPerformanceResponse["period"];
  href: string;
  valueLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const id = row.position_id;
  const label = id && `Trove ${id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id}`;
  const trove = row.trove;
  return <>
    <tr>
      <td data-label="Market / position">
        <Link className="report-link" href={href}>{row.market_label}</Link>
        {label && trove ? <button type="button" className="flex-trove-toggle" title={`Trove ${id}`} aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setOpen(current => !current)}>{label} · {trove.status}</button>
          : label ? <span className="flex-performance-position" title={`Trove ${id}`}>{label}</span> : null}
        {row.issue ? <span className="flex-performance-position">{row.issue}</span> : null}
      </td>
      <td className="numeric data-value" data-label={valueLabel}>{value(row.end_value_usd)}</td>
      <td className="numeric data-value" data-label="P&L" title={row.is_complete ? `Starting value ${value(row.start_value_usd)}; net funding ${value(row.net_funding_usd)}` : row.issue || undefined}>{pnl(row.pnl_usd)}</td>
    </tr>
    {open && trove && id ? <tr id={detailId} className="flex-trove-details"><td colSpan={3}>
      <dl>
        <div><dt>Opened</dt><dd><time dateTime={trove.opened_at}>{eventDate.format(new Date(trove.opened_at))} UTC</time></dd></div>
        {trove.exited_at ? <div><dt>Exited</dt><dd><time dateTime={trove.exited_at}>{eventDate.format(new Date(trove.exited_at))} UTC</time></dd></div> : null}
        <div><dt>Starting equity</dt><dd>{value(row.start_value_usd)}</dd></div>
        <div><dt>Net funding</dt><dd>{value(row.net_funding_usd)}</dd></div>
        <div><dt>Interest</dt><dd>{amount.format(trove.interest)} {trove.borrow_token_symbol}</dd></div>
        <div><dt>Upfront fees</dt><dd>{amount.format(trove.upfront_fees)} {trove.borrow_token_symbol}</dd></div>
      </dl>
      <PositionEvents market={row.market_address} id={id} period={period} />
    </td></tr> : null}
  </>;
}

export function FlexPerformance({ days, onDays, marketHref }: {
  days: FlexPeriod;
  onDays: (days: FlexPeriod) => void;
  marketHref: (address: string) => string;
}) {
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
  const selectedMarket = markets.some(([address]) => address === market) ? market : "";
  useEffect(() => {
    if (source && market !== selectedMarket) setMarket(selectedMarket);
  }, [source, market, selectedMarket]);
  const rows = source?.rows.filter(row => !selectedMarket || row.market_address === selectedMarket) || [];
  const complete = rows.every(row => row.is_complete);
  const performance = source && selectedMarket ? {
    ...source, rows, positions: rows.length, covered_positions: rows.filter(row => row.is_complete).length,
    pnl_usd: complete ? rows.reduce((sum, row) => sum + (row.pnl_usd || 0), 0) : null,
    end_value_usd: complete ? rows.reduce((sum, row) => sum + (row.end_value_usd || 0), 0) : null,
  } : source;
  const incomplete = performance?.pnl_usd === null;
  const valueLabel = side === "borrowers" ? "Net equity" : "Value";
  const walletBorrowing = Boolean(address) && side === "borrowers";
  const splitAvailable = walletBorrowing && performance?.rows.every(row => row.is_complete && row.trove);
  let openPnl = 0, realizedPnl = 0;
  if (splitAvailable && performance) {
    for (const row of performance.rows) {
      if (row.trove?.exited_at) realizedPnl += row.pnl_usd ?? 0;
      else openPnl += row.pnl_usd ?? 0;
    }
  }
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
    <div className="flex-section-heading">
      <div><h2 className="card-title" id="flex-performance-title">Performance</h2>
        <p className="card-description">{address && !editing ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Active Flex markets"}{query.isPlaceholderData ? " · Updating…" : ""}</p>
      </div>
      <div className="flex-range-tabs" role="group" aria-label="Performance period">
        {FLEX_PERIODS.map(period => <button type="button" key={period} className={`flex-range-tab ${days === period ? "is-active" : ""}`} aria-pressed={days === period} aria-label={`${period}-day performance`} onClick={() => onDays(period)}>{period}D</button>)}
      </div>
    </div>
    <form className="flex-performance-form" onSubmit={submit}>
      <label className="flex-performance-address">Address
        <input type="text" value={draft} placeholder="0x… (optional)" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? "flex-performance-error" : undefined} onChange={event => { setDraft(event.target.value); setEditing(true); setError(""); }} />
      </label>
      <button type="submit" className="button button-secondary">View P&amp;L</button>
      {address || editing ? <button type="button" className="button button-ghost" onClick={overview}>Overview</button> : null}
    </form>
    {error ? <p className="flex-performance-error" id="flex-performance-error" role="alert">{error}</p> : null}
    <div className="flex-performance-toolbar">
      <div className="flex-range-tabs" role="group" aria-label="Performance side">
        {([['borrowers', 'Borrowing'], ['lenders', 'Lending']] as const).map(([key, label]) => <button type="button" key={key} className={`flex-range-tab ${side === key ? "is-active" : ""}`} aria-pressed={side === key} onClick={() => { setSide(key); setMarket(""); }}>{label}</button>)}
      </div>
      {markets.length > 1 ? <label className="flex-filter">Market<select aria-label="Performance market" value={selectedMarket} onChange={event => setMarket(event.target.value)}><option value="">All markets</option>{markets.map(([address, label]) => <option key={address} value={address}>{label}</option>)}</select></label> : null}
    </div>
    <div aria-live="polite" aria-busy={query.isFetching && !editing}>
      {editing && !error ? <p className="muted">Submit to view this address.</p> : null}
      {!editing && query.isLoading ? <p className="muted">Calculating from indexed history…</p> : null}
      {!editing && query.isError ? <div className="flex-performance-unavailable"><p>Performance is temporarily unavailable.</p><button type="button" className="button button-ghost" onClick={() => query.refetch()}>Retry</button></div> : null}
      {data && performance ? <>
        <dl className={`flex-performance-totals${walletBorrowing ? " flex-wallet-totals" : ""}`}>
          <div><dt>{side === "borrowers" ? "Trove P&L · USD" : address ? "Lender P&L · USD" : "Lender pool P&L · USD"}</dt><dd data-testid="performance-total">{incomplete ? "Incomplete coverage" : pnl(performance.pnl_usd)}</dd></div>
          <div><dt>{side === "borrowers" ? "Net equity" : "Reported value"}</dt><dd>{value(performance.end_value_usd)}</dd></div>
          <div><dt>Coverage</dt><dd>{performance.covered_positions}/{performance.positions} {side === "borrowers" ? performance.positions === 1 ? "trove" : "troves" : performance.positions === 1 ? "market" : "markets"}</dd></div>
          {walletBorrowing ? <>
            <div><dt>Open positions’ P&amp;L</dt><dd>{pnl(splitAvailable ? openPnl : null)}</dd></div>
            <div><dt>Realized on exited positions</dt><dd>{pnl(splitAvailable ? realizedPnl : null)}</dd></div>
          </> : null}
        </dl>
        {performance.rows.length ? <TableWrap className="flex-performance-rows"><table className="decision-table flex-performance-table" aria-label={`${side === "borrowers" ? "Borrower" : "Lender"} performance`}>
          <thead><tr><th>Market / position</th><th className="numeric">{valueLabel}</th><th className="numeric">P&amp;L</th></tr></thead>
          <tbody>{performance.rows.map(row => <PerformanceRow key={`${row.market_address}:${row.position_id || row.kind}`} row={row} period={data.period} href={marketHref(row.market_address)} valueLabel={valueLabel} />)}</tbody>
        </table></TableWrap> : <p className="muted">{side === "borrowers" ? "No borrower positions in this period." : "No lender positions in this period."}</p>}
        <p className="section-note">{date.format(new Date(data.period.start_at))}–{date.format(new Date(data.period.end_at))} UTC{data.freshness.data_state === "delayed" ? " · Updates delayed" : ""}. USD change net of funding. Excludes gas and swap costs.</p>
        <p className="section-note">{side === "borrowers" ? "Interest and fees included; auction funding differences excluded." : address ? "Reported share value; excludes unreported interest." : "Reported pool value includes fee-recipient shares; excludes unreported interest."}</p>
      </> : null}
    </div>
  </section>;
}
