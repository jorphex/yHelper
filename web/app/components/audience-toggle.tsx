"use client";

import { useEffect, useState } from "react";

type AudienceMode = "guide" | "analyst";

const STORAGE_KEY = "yhelper:audience-mode";

function applyAudienceMode(mode: AudienceMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.audience = mode;
}

export function AudienceToggle() {
  const [mode, setMode] = useState<AudienceMode>("guide");

  useEffect(() => {
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
    applyAudienceMode("guide");
  }, []);

  useEffect(() => {
    applyAudienceMode(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // no-op: best effort persistence only
    }
  }, [mode]);

  return (
    <div className="audience-toggle" role="group" aria-label="Audience mode">
      <span className="audience-label">Mode</span>
      <button
        type="button"
        className={mode === "guide" ? "is-active" : ""}
        aria-pressed={mode === "guide"}
        onClick={() => setMode("guide")}
      >
        Guide
      </button>
      <button
        type="button"
        className={mode === "analyst" ? "is-active" : ""}
        aria-pressed={mode === "analyst"}
        onClick={() => setMode("analyst")}
      >
        Analyst
      </button>
    </div>
  );
}
