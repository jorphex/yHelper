"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useChainsData } from "../hooks/use-chains-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import type { UniverseKind } from "../lib/universe";

function ChainsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
  }), [searchParams]);

  const { data, isLoading } = useChainsData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const chains = data?.rows ?? [];
  const summary = {
    total_tvl_usd: data?.rows?.reduce((sum, r) => sum + (r.total_tvl_usd || 0), 0) || null,
    chains: data?.rows?.length ?? 0,
    top_chain_id: data?.rows?.[0]?.chain_id ?? null,
  };

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Chains.
          <br />
          <em className="page-title-accent">Network view.</em>
        </h1>
        <p className="page-description">
          Compare chain scale, weighted yield, and coverage quality from the same filtered universe.
        </p>
      </section>

      <section className="section" style={{ marginBottom: "48px" }}>
        {isLoading ? (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {Array(4).fill(null).map((_, i) => <KpiGridSkeleton key={i} count={1} />)}
          </div>
        ) : (
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-label">Total TVL</div>
              <div className="kpi-value">{formatUsd(summary?.total_tvl_usd)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Chains</div>
              <div className="kpi-value">{summary?.chains ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Top Chain</div>
              <div className="kpi-value" style={{ fontSize: "20px" }}>
                {chainLabel(summary?.top_chain_id)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Vaults</div>
              <div className="kpi-value">{chains?.reduce((sum, r) => sum + (r.active_vaults || 0), 0) ?? "n/a"}</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Chain Comparison</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chain</th>
                <th style={{ textAlign: "right" }}>Vaults</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Share</th>
                <th style={{ textAlign: "right" }}>Weighted APY</th>
                <th style={{ textAlign: "right" }}>Median APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={6} />
              ) : chains.map((row: { chain_id?: number; vaults?: number; tvl_usd?: number; tvl_share?: number; weighted_safe_apy_30d?: number; median_safe_apy_30d?: number }) => (
                <tr key={row.chain_id}>
                  <td>{chainLabel(row.chain_id)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.tvl_share)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.median_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ChainsPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <ChainsPageContent />
    </Suspense>
  );
}
