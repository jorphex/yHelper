"use client";

import { useEffect, useState } from "react";

type AudienceMode = "guide" | "analyst";

const STORAGE_KEY = "yhelper:audience-mode";

function applyAudienceMode(mode: AudienceMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.audience = mode;
}

export function AudienceToggle() {
  const [mode, setMode] = useState<AudienceMode | null>(null);

  useEffect(() => {
    const documentMode = document.documentElement.dataset.audience === "analyst" ? "analyst" : "guide";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "guide" || stored === "analyst") {
        setMode(stored);
        applyAudienceMode(stored);
        return;
      }
    } catch {
      // no-op: fallback to default mode
    }
    setMode(documentMode);
    applyAudienceMode(documentMode);
  }, []);

  useEffect(() => {
    if (!mode) return;
    applyAudienceMode(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // no-op: best effort persistence only
    }
  }, [mode]);

  return (
    <div className="audience-toggle" role="group" aria-label="View mode">
      <span className="audience-label">Mode</span>
      <button
        type="button"
        className={mode === "guide" ? "is-active" : ""}
        aria-pressed={mode === "guide"}
        aria-label="Noob mode: shows explanations and hides advanced columns"
        title="Noob: explanations visible, advanced columns hidden"
        onClick={() => setMode("guide")}
      >
        Noob
      </button>
      <button
        type="button"
        className={mode === "analyst" ? "is-active" : ""}
        aria-pressed={mode === "analyst"}
        aria-label="Pro mode: compact layout with advanced columns"
        title="Pro: compact layout with advanced columns"
        onClick={() => setMode("analyst")}
      >
        Pro
      </button>
    </div>
  );
}
