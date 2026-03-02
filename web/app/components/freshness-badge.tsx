"use client";

import { useEffect, useState } from "react";
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
const DELAY_AGE_SECONDS = 24 * 3600;
const DELAY_STALE_RATIO = 0.2;

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
  if (age > DELAY_AGE_SECONDS || (staleRatio !== null && staleRatio >= DELAY_STALE_RATIO)) {
    return {
      tone: "warn",
      label: "Delayed",
      detail: "Freshness is degraded (latest PPS older than 24h or 24h stale ratio is 20%+).",
      ageSeconds: age,
      staleRatio,
    };
  }
  return {
    tone: "ok",
    label: "Fresh",
    detail: "Data freshness is within 24h age and below 20% 24h stale ratio.",
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
  const staleText = badge.staleRatio === null ? null : formatPct(badge.staleRatio, 0);
  const detail = `${badge.detail} Latest PPS age: ${formatHours(badge.ageSeconds)}. 24h stale ratio: ${staleText ?? "n/a"}.`;

  return (
    <div className={`freshness-badge is-${badge.tone}`} title={detail} aria-label={`Data freshness ${badge.label}.`} role="status">
      <span className="freshness-dot" aria-hidden />
      <span className="freshness-label">Data: {badge.label}</span>
      <span className="freshness-age">{formatHours(badge.ageSeconds)}</span>
      {staleText ? <span className="freshness-meta">{staleText} stale</span> : null}
    </div>
  );
}
