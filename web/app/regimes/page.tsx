"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { chainLabel, formatPct, formatUsd } from "../lib/format";
import { useRegimesData } from "../hooks/use-regimes-data";
import { KpiGridSkeleton, TableSkeleton } from "../components/skeleton";
import type { UniverseKind } from "../lib/universe";

function RegimesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => ({
    universe: (searchParams.get("universe") || "core") as UniverseKind,
    minTvl: Number(searchParams.get("min_tvl") || 1000000),
  }), [searchParams]);

  const { data, isLoading } = useRegimesData({
    universe: query.universe,
    minTvl: query.minTvl,
    minPoints: 45,
  });

  const regimes = data?.summary ?? [];
  const currentRegime = regimes[0]?.regime ?? "n/a";

  return (
    <div>
      <section className="page-header" style={{ borderBottom: "none" }}>
        <h1 className="page-title">
          Regimes.
          <br />
          <em className="page-title-accent">States. Behavior.</em>
        </h1>
        <p className="page-description">
          Follow rising, stable, falling, and choppy states. Understand recent yield behavior 
          and how cohorts are transitioning.
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
              <div className="kpi-label">Current Regime</div>
              <div className="kpi-value" style={{ textTransform: "capitalize" }}>{currentRegime}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rising</div>
              <div className="kpi-value" style={{ color: "var(--positive)" }}>
                {regimes.find((r) => r.regime === "rising")?.vaults ?? "n/a"}
              </div>
              <div className="kpi-hint">Vaults improving</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Stable</div>
              <div className="kpi-value">
                {regimes.find((r) => r.regime === "stable")?.vaults ?? "n/a"}
              </div>
              <div className="kpi-hint">Holding steady</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Falling</div>
              <div className="kpi-value" style={{ color: "var(--negative)" }}>
                {regimes.find((r) => r.regime === "falling")?.vaults ?? "n/a"}
              </div>
              <div className="kpi-hint">Vaults declining</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card-header">
          <h2 className="card-title">Regime Distribution</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Regime</th>
                <th style={{ textAlign: "right" }}>Vaults</th>
                <th style={{ textAlign: "right" }}>TVL</th>
                <th style={{ textAlign: "right" }}>Share</th>
                <th style={{ textAlign: "right" }}>Median APY</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rows={4} columns={5} />
              ) : regimes.map((row) => (
                <tr key={row.regime}>
                  <td style={{ textTransform: "capitalize" }}>{row.regime || "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{row.vaults ?? "n/a"}</td>
                  <td style={{ textAlign: "right" }} className="data-value">{formatUsd(row.tvl_usd)}</td>
                  <td style={{ textAlign: "right" }} className="data-value">-</td>
                  <td style={{ textAlign: "right" }} className="data-value">-</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function RegimesPage() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: "48px" }}>Loading...</div>}>
      <RegimesPageContent />
    </Suspense>
  );
}
