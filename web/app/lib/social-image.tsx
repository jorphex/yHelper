/* eslint-disable @next/next/no-img-element */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { internalApiUrl } from "./api";

export const alt = "yHelper: Yearn yield, interpreted";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const publicPath = (...segments: string[]) => path.join(process.cwd(), "public", ...segments);
const regularFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Regular.ttf"));
const boldFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Bold.ttf"));
const backgroundImagePromise = readFile(publicPath("social", "yhelper-preview-bg-v2.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);
const headerImagePromise = readFile(publicPath("social", "yhelper-preview-base.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);

type Pulse = {
  data_state?: "ready" | "limited" | "delayed";
  freshness_window_hours?: number;
  latest_data_at?: string | null;
};

type Mover = {
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  realized_apy_window?: number | null;
  age_seconds?: number | null;
};

type Changes = { movers?: { risers?: Mover[]; fallers?: Mover[] } | null };

async function fetchJson<T>(pathName: string, query?: Record<string, string | number>): Promise<T | null> {
  const params = new URLSearchParams(Object.entries(query ?? {}).map(([key, value]) => [key, String(value)]));
  const suffix = params.size ? `?${params.toString()}` : "";
  for (const base of [internalApiUrl(pathName), `http://127.0.0.1:8000/api${pathName}`]) {
    try {
      const response = await fetch(`${base}${suffix}`, { cache: "no-store", headers: { accept: "application/json" } });
      if (response.ok) return await response.json() as T;
    } catch {
      // The durable preview below remains useful when live data is unavailable.
    }
  }
  return null;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function selectFreshMover(pulse: Pulse | null, changes: Changes | null): Mover | null {
  if (pulse?.data_state !== "ready") return null;
  const maxAge = (pulse.freshness_window_hours ?? 48) * 3_600;
  const candidates = [...(changes?.movers?.risers ?? []), ...(changes?.movers?.fallers ?? [])]
    .filter((mover) => finite(mover.delta_apy) && finite(mover.age_seconds) && mover.age_seconds <= maxAge);
  return candidates.sort((a, b) => Math.abs(b.delta_apy ?? 0) - Math.abs(a.delta_apy ?? 0))[0] ?? null;
}

function signedPoints(value: number): string {
  const points = value * 100;
  return `${points > 0 ? "+" : points < 0 ? "−" : ""}${Math.abs(points).toFixed(2)} pp`;
}

function ageLabel(seconds: number): string {
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))}m old`;
  return `${Math.max(1, Math.round(seconds / 3_600))}h old`;
}

export async function renderSocialImage() {
  const [pulseResponse, changes, regularFontData, boldFontData, backgroundSrc, headerSrc] = await Promise.all([
    fetchJson<{ pulse?: Pulse | null }>("/overview-pulse"),
    fetchJson<Changes>("/changes", { window: "7d", universe: "core", limit: 2 }),
    regularFontPromise,
    boldFontPromise,
    backgroundImagePromise,
    headerImagePromise,
  ]);
  const mover = selectFreshMover(pulseResponse?.pulse ?? null, changes);
  const moverName = String(mover?.symbol || mover?.token_symbol || "").trim();

  return new ImageResponse(
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden", background: "#0a0a0a", color: "#faf8f3", fontFamily: "Aeonik" }}>
      <img alt="" src={backgroundSrc} width={1200} height={630} style={{ position: "absolute", inset: 0, width: 1200, height: 630, objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: "radial-gradient(circle at 82% 12%, rgba(6,87,233,.11), transparent 40%)" }} />
      <div style={{ position: "relative", display: "flex", width: "100%", height: 210, overflow: "hidden" }}>
        <img alt="" src={headerSrc} width={1200} height={630} style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630 }} />
      </div>
      <div style={{ position: "relative", display: "flex", flex: 1, margin: "0 56px", borderTop: "1px solid rgba(255,255,255,.16)" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 690, justifyContent: "center", padding: "34px 46px 34px 0" }}>
          <div style={{ display: "flex", maxWidth: 610, fontSize: 58, fontWeight: 700, letterSpacing: "-.045em", lineHeight: 1.02 }}>Yearn yield, interpreted.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 398, justifyContent: "center", padding: "34px 0 34px 42px", borderLeft: "1px solid rgba(255,255,255,.10)" }}>
          {mover ? <div style={{ display: "flex", width: "100%", flexDirection: "column" }}>
            <div style={{ display: "flex", width: "100%", color: "#9b958c", fontSize: 22, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>7d yield change</div>
            <div style={{ display: "flex", width: "100%", marginTop: 18, fontSize: moverName.length > 17 ? 32 : 42, fontWeight: 700, letterSpacing: "-.035em", lineHeight: 1.05 }}>{moverName}</div>
            <div style={{ display: "flex", width: "100%", marginTop: 12, color: (mover.delta_apy ?? 0) >= 0 ? "#62d6a2" : "#ff887c", fontSize: 34, fontWeight: 700 }}>{signedPoints(mover.delta_apy ?? 0)}</div>
            <div style={{ display: "flex", width: "100%", marginTop: 14, color: "#9b958c", fontSize: 22, lineHeight: 1.3 }}>vs prior 7d · PPS {ageLabel(mover.age_seconds ?? 0)}</div>
          </div> : <div style={{ display: "flex", width: "100%", flexDirection: "column" }}>
            <div style={{ display: "flex", width: "100%", color: "#9b958c", fontSize: 22, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>No current 7d signal</div>
            <div style={{ display: "flex", width: "100%", flexDirection: "column", marginTop: 18, fontSize: 38, fontWeight: 700, letterSpacing: "-.035em", lineHeight: 1.08 }}>
              <span>Markets</span><span>Reports</span><span>stYFI</span>
            </div>
          </div>}
        </div>
      </div>
    </div>,
    { ...size, fonts: [
      { name: "Aeonik", data: regularFontData, style: "normal", weight: 400 },
      { name: "Aeonik", data: boldFontData, style: "normal", weight: 700 },
    ] },
  );
}
