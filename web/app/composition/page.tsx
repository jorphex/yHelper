"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatPct, formatUsd } from "../lib/format";
import { useCompositionData } from "../hooks/use-composition-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import type { UniverseKind } from "../lib/universe";

function CompositionPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
  }), [searchParams]);

  const { data, isLoading } = useCompositionData({
    universe: query.universe,
    minTvl: query.minTvl,
  });

  const composition = data?.categories ?? [];

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Composition.
          <br />
          <em className="page-title-accent">Allocation. Mix.</em>
        </h1>
        <p className="page-description">
          Check chain, category, and token concentration before sizing risk in the filtered universe.
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
              <div className="kpi-value">{formatUsd(data?.summary?.total_tvl_usd)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Vaults</div>
              <div className="kpi-value">{data?.summary?.vaults ?? "n/a"}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg APY</div>
              <div className="kpi-value">{formatPct(data?.summary?.avg_safe_apy_30d)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Categories</div>
              <div className="kpi-value">{data?.categories?.length ?? "n/a"}</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Composition by Category</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: "right" }}>Vaults</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Share</th>
                <th style={{ textAlign: "right" }}>Median APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={5} />
              ) : composition.map((row) => (
                <tr key={row.category}>
                  <td>{row.category || "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.share_tvl)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatPct(row.weighted_safe_apy_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function CompositionPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <CompositionPageContent />
    </Suspense>
  );
}
