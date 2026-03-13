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
      <span className="audience-label">View</span>
      <button
        type="button"
        className={mode === "guide" ? "is-active" : ""}
        aria-pressed={mode === "guide"}
        aria-label="Guide view: explanations visible and advanced columns hidden"
        title="Guide: explanations visible, advanced columns hidden"
        onClick={() => setMode("guide")}
      >
        Guide
      </button>
      <button
        type="button"
        className={mode === "analyst" ? "is-active" : ""}
        aria-pressed={mode === "analyst"}
        aria-label="Analyst view: advanced columns and denser comparisons"
        title="Analyst: advanced columns and denser comparisons"
        onClick={() => setMode("analyst")}
      >
        Analyst
      </button>
    </div>
  );
}
