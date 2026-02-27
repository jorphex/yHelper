"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatHours, formatPct } from "../lib/format";

type FreshnessResponse = {
  latest_pps_age_seconds?: number | null;
  pps_stale_ratio?: number | null;
  alerts?: Record<string, { is_firing?: boolean }>;
};

type BadgeState = {
  tone: "ok" | "warn" | "bad" | "unknown";
  label: string;
  detail: string;
  ageSeconds: number | null;
  staleRatio: number | null;
};

const REFRESH_MS = 60_000;

function deriveBadgeState(data: FreshnessResponse | null): BadgeState {
  if (!data) {
    return {
      tone: "unknown",
      label: "Checking",
      detail: "Fetching freshness data.",
      ageSeconds: null,
      staleRatio: null,
    };
  }
  const firing = Object.values(data.alerts ?? {}).some((alert) => alert.is_firing);
  const age = data.latest_pps_age_seconds ?? null;
  const staleRatio = data.pps_stale_ratio ?? null;
  if (firing) {
    return {
      tone: "bad",
      label: "Alert",
      detail: "Ingestion alert is firing; data can be stale.",
      ageSeconds: age,
      staleRatio,
    };
  }
  if (age === null) {
    return {
      tone: "unknown",
      label: "Unknown",
      detail: "No PPS timestamp available yet.",
      ageSeconds: age,
      staleRatio,
    };
  }
  if (age > 6 * 3600 || (staleRatio !== null && staleRatio >= 0.2)) {
    return {
      tone: "warn",
      label: "Delayed",
      detail: "Freshness is degraded; verify trust metrics before acting.",
      ageSeconds: age,
      staleRatio,
    };
  }
  return {
    tone: "ok",
    label: "Fresh",
    detail: "Data freshness is within normal bounds.",
    ageSeconds: age,
    staleRatio,
  };
}

export function FreshnessBadge() {
  const [payload, setPayload] = useState<FreshnessResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/meta/freshness?threshold=24h", { cache: "no-store" });
        if (!res.ok || !active) return;
        const next = (await res.json()) as FreshnessResponse;
        setPayload(next);
      } catch {
        if (!active) return;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const badge = deriveBadgeState(payload);
  const href = "/changes?window=24h&stale_threshold=24h#freshness-panels";
  const staleText = badge.staleRatio === null ? null : formatPct(badge.staleRatio, 0);
  const detail = `${badge.detail} Latest PPS age: ${formatHours(badge.ageSeconds)}. 24h stale ratio: ${staleText ?? "n/a"}.`;

  return (
    <Link
      href={href}
      className={`freshness-badge is-${badge.tone}`}
      title={detail}
      aria-label={`Data freshness ${badge.label}. Open freshness diagnostics.`}
    >
      <span className="freshness-dot" aria-hidden />
      <span className="freshness-label">Data: {badge.label}</span>
      <span className="freshness-age">{formatHours(badge.ageSeconds)}</span>
      {staleText ? <span className="freshness-meta">{staleText} stale</span> : null}
    </Link>
  );
}
