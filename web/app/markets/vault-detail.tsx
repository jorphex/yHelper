"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalArrow } from "../components/vault-link";
import { VaultSourceNote } from "../components/source-notes";
import { useVaultHistory } from "../hooks/use-vault-history";
import { chainLabel, formatPct, formatUsd, formatUsdCompact, shortVaultLabel, yearnVaultUrl } from "../lib/format";
import { vaultReturnUrl } from "../lib/vault-navigation";
import { VaultChart } from "./vault-chart";

const utcDate = (timestamp: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(timestamp * 1000);

export function VaultDetail({ chainId, address }: { chainId: number; address: string }) {
  const search = useSearchParams();
  const back = vaultReturnUrl(search.get("from"));
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, dataUpdatedAt, isLoading, isFetching, error, refetch } = useVaultHistory(chainId, address);
  const [retryWait, setRetryWait] = useState(0);
  useEffect(() => {
    const until = dataUpdatedAt + (data?.retry_after_seconds ?? 0) * 1000;
    const remaining = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setRetryWait(remaining());
    if (!remaining()) return;
    const timer = setInterval(() => {
      const wait = remaining();
      setRetryWait(wait);
      if (!wait) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [dataUpdatedAt, data?.retry_after_seconds]);
  const valid = Number.isInteger(chainId) && chainId > 0 && /^0x[0-9a-fA-F]{40}$/.test(address);
  const latestPps = data?.points.filter(point => point.pps !== null).at(-1);
  const latestTvl = data?.points.filter(point => point.tvl_usd !== null).at(-1);
  const backLabel = new URL(back, "https://yhelper.invalid").searchParams.get("view") === "changes" ? "Yield changes" : "Vaults";
  const missing = !valid || (error instanceof Error && error.message.includes("404"));
  const title = data ? shortVaultLabel(data.vault.symbol, address) : isLoading ? "Vault performance" : shortVaultLabel(null, address);
  const historyNotes = [
    data?.history_delayed || data?.history_state === "delayed" ? "History is delayed." : null,
    data?.pps_source === "stored" ? "Using stored share prices." : null,
    data?.pps_source === "cached" || data?.tvl_source === "cached" ? "Using cached history." : null,
    data?.pps_source === "unavailable" ? "Share price history unavailable." : null,
    data?.tvl_source === "unavailable" ? "TVL history unavailable." : null,
    error && data ? "History refresh failed." : null,
  ].filter(Boolean).join(" ");
  const retryLabel = isFetching ? "Retrying…" : retryWait ? `Retry in ${retryWait}s` : "Retry";

  return <div className="vault-detail">
    <Link href={back} className="vault-back">← {backLabel}</Link>
    <header className="vault-heading">
      <div>
        <p className="vault-eyebrow">{chainLabel(chainId)}{data?.vault.token_symbol ? ` · ${data.vault.token_symbol}` : ""}</p>
        <h1 className="page-title">{title}</h1>
        {data?.vault.name && data.vault.name !== data.vault.symbol ? <p className="vault-subtitle">{data.vault.name}</p> : null}
      </div>
      {data ? <a className="button button-secondary vault-yearn-link" href={yearnVaultUrl(chainId, address)} target="_blank" rel="noopener noreferrer">Open in Yearn <ExternalArrow size={12} /></a> : null}
    </header>
    {missing || (error && !data) ? <section className="vault-history-empty" role="status">
      <h2>{missing ? "Vault not found" : "Vault history is unavailable"}</h2>
      <p className="muted">{missing ? "Choose a vault from the comparison table." : "Try again in a moment."}</p>
      {!missing ? <button className="button button-secondary" disabled={isFetching} onClick={() => refetch()}>{retryLabel}</button> : null}
    </section> : <>
      <dl className="vault-metrics" aria-label="Vault snapshot">
        <div><dt>Estimated APY</dt><dd>{isLoading ? "—" : formatPct(data?.vault.est_apy)}</dd></div>
        <div><dt>7d realized APY <span className="vault-metric-date">{latestPps ? `· ${utcDate(latestPps.timestamp)}` : ""}</span></dt><dd>{isLoading ? "—" : formatPct(latestPps?.apy_7d)}</dd></div>
        <div><dt>TVL <span className="vault-metric-date">{latestTvl ? `· ${utcDate(latestTvl.timestamp)}` : ""}</span></dt><dd>{isLoading ? "—" : <><span className="vault-tvl-full">{formatUsd(latestTvl?.tvl_usd)}</span><span className="vault-tvl-compact">{formatUsdCompact(latestTvl?.tvl_usd)}</span></>}</dd></div>
      </dl>
      <VaultSourceNote source={data?.source_freshness} />
      <section className="vault-performance" aria-labelledby="vault-performance-title">
        <div className="vault-performance-heading">
          <h2 id="vault-performance-title">Performance</h2>
          <div className="range-tabs vault-periods" role="group" aria-label="History period">
            {([7, 30, 90] as const).map(period => <button key={period} type="button" className={`range-tab${days === period ? " is-active" : ""}`} aria-pressed={days === period} onClick={() => setDays(period)}>{period}d</button>)}
          </div>
        </div>
        {isLoading ? <div className="vault-chart-loading" role="status"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /><span className="sr-only">Loading vault history…</span></div> : data?.points.length ? <VaultChart points={data.points} days={days} asset={data.vault.token_symbol} /> : <div className="vault-history-empty">No daily history available yet.</div>}
      </section>
      {data ? <footer className="vault-history-note">
        <span>Daily samples · UTC{latestPps ? ` · PPS through ${utcDate(latestPps.timestamp)}` : ""}</span>
        <a href="https://github.com/yearn/kong/blob/master/docs/outputs.md" target="_blank" rel="noopener noreferrer">Source: Kong<ExternalArrow size={12} /></a>
        {historyNotes ? <span role="status">{historyNotes} <button className="vault-text-button" disabled={isFetching || retryWait > 0} onClick={() => refetch()}>{retryLabel}</button></span> : null}
      </footer> : null}
    </>}
  </div>;
}
