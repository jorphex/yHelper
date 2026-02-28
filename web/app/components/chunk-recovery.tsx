"use client";

import { useEffect } from "react";

const LAST_RECOVERY_KEY = "yhelper:last-chunk-recovery-epoch";
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

function readErrorText(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  if (typeof reason === "string") {
    return reason;
  }
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function isChunkOrBundleLoadError(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("chunkloaderror") ||
    normalized.includes("loading chunk") ||
    normalized.includes("failed to fetch dynamically imported module") ||
    normalized.includes("loading css chunk") ||
    normalized.includes("failed to load script")
  );
}

function shouldAttemptRecovery(): boolean {
  try {
    const raw = window.sessionStorage.getItem(LAST_RECOVERY_KEY);
    if (!raw) return true;
    const ts = Number.parseInt(raw, 10);
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts > RECOVERY_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markRecoveryAttempt(): void {
  try {
    window.sessionStorage.setItem(LAST_RECOVERY_KEY, String(Date.now()));
  } catch {
    // best effort only
  }
}

function recoverWithCacheBustedReload(): void {
  if (!shouldAttemptRecovery()) return;
  markRecoveryAttempt();
  const url = new URL(window.location.href);
  url.searchParams.set("__reload", String(Date.now()));
  window.location.replace(url.toString());
}

export function ChunkRecovery() {
  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      const text = readErrorText(event.error ?? event.message);
      if (isChunkOrBundleLoadError(text)) {
        recoverWithCacheBustedReload();
      }
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const text = readErrorText(event.reason);
      if (isChunkOrBundleLoadError(text)) {
        recoverWithCacheBustedReload();
      }
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
