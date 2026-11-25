"use client";

import { useEffect } from "react";

const LAST_RECOVERY_KEY = "yhelper:last-chunk-recovery-epoch";
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

function recover(reason: unknown) {
  if (!(reason instanceof Error) || reason.name !== "ChunkLoadError") return;
  const url = new URL(window.location.href);
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(LAST_RECOVERY_KEY));
    if (now - last <= RECOVERY_COOLDOWN_MS) return;
    sessionStorage.setItem(LAST_RECOVERY_KEY, String(now));
  } catch {
    // The URL also survives the reload if the browser blocks session storage.
    if (now - Number(url.searchParams.get("__reload")) <= RECOVERY_COOLDOWN_MS) return;
  }
  url.searchParams.set("__reload", String(now));
  window.location.replace(url);
}

export function ChunkRecovery() {
  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => recover(event.error);
    const onUnhandledRejection = (event: PromiseRejectionEvent) => recover(event.reason);

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
