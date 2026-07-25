/* eslint-disable @next/next/no-img-element */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { internalApiUrl } from "./api";

export const alt = "yHelper live Yearn market preview";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

const publicPath = (...segments: string[]) => path.join(process.cwd(), "public", ...segments);

const regularFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Regular.ttf"));
const boldFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Bold.ttf"));
const backgroundImagePromise = readFile(publicPath("social", "yhelper-preview-bg-v2.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);
const previewHeaderImagePromise = readFile(publicPath("social", "yhelper-preview-base.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);

type OverviewResponse = {
  protocol?: { tvl_usd?: number | null } | null;
};

type ChangeMover = {
  symbol?: string | null;
  token_symbol?: string | null;
  delta_apy?: number | null;
  realized_apy_window?: number | null;
};

type ChangesResponse = {
  movers?: {
    risers?: ChangeMover[];
    fallers?: ChangeMover[];
  } | null;
};

type StyfiResponse = {
  summary?: {
    reward_epoch?: number | null;
    combined_staked?: number | null;
  };
  current_reward_state?: {
    styfi_current_apr?: number | null;
    epoch?: number | null;
  };
};

type SocialCard = {
  label: string;
  value: string;
  note: string;
  valueSize: number;
};

async function fetchJson<T>(pathName: string, query?: Record<string, string | number>): Promise<T | null> {
  const normalizedPath = pathName.startsWith("/") ? pathName : `/${pathName}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    params.set(key, String(value));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const candidates = [
    `${internalApiUrl(normalizedPath)}${suffix}`,
    `http://127.0.0.1:8000/api${normalizedPath}${suffix}`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      return (await response.json()) as T;
    } catch {
      continue;
    }
  }
  return null;
}

function usdCompact(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "n/a";
  const absolute = Math.abs(value as number);
  const sign = (value as number) < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

function pct(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${((value as number) * 100).toFixed(digits)}%`;
}

function signedPercentagePoints(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "n/a";
  const points = (value as number) * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(2)} pp`;
}

function compactText(value: string | null | undefined, limit: number): string {
  const text = String(value || "").trim();
  if (!text) return "Syncing";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(3, limit - 1))}…`;
}

function participatingYfi(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "n/a YFI participating";
  return `${(value as number).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} YFI participating`;
}

function selectMover(changes: ChangesResponse | null): {
  label: string;
  mover: ChangeMover | null;
} {
  const riser = changes?.movers?.risers?.[0];
  if (riser) return { label: "Strongest 7d riser", mover: riser };
  const faller = changes?.movers?.fallers?.[0];
  if (faller) return { label: "Largest 7d faller", mover: faller };
  return { label: "7d realized yield", mover: null };
}

export function buildSocialCards(
  overview: OverviewResponse | null,
  changes: ChangesResponse | null,
  styfi: StyfiResponse | null,
): SocialCard[] {
  const protocol = overview?.protocol ?? {};
  const styfiSummary = styfi?.summary ?? {};
  const rewardState = styfi?.current_reward_state ?? {};
  const styfiEpoch = rewardState.epoch ?? styfiSummary.reward_epoch;
  const { label: moverLabel, mover } = selectMover(changes);
  const moverName = compactText(mover?.symbol || mover?.token_symbol, 16);
  const moverNote = mover
    ? `${signedPercentagePoints(mover.delta_apy)} · ${pct(mover.realized_apy_window, 2)} realized APY`
    : "Core vault comparison is syncing";

  return [
    {
      label: "Yearn TVL",
      value: usdCompact(protocol.tvl_usd),
      note: "Combined Yearn protocols",
      valueSize: 58,
    },
    {
      label: moverLabel,
      value: moverName,
      note: moverNote,
      valueSize: moverName.length > 11 ? 40 : 48,
    },
    {
      label: "stYFI APR",
      value: pct(rewardState.styfi_current_apr, 1),
      note: `Epoch ${Number.isFinite(styfiEpoch) ? String(styfiEpoch) : "n/a"} · ${participatingYfi(
        styfiSummary.combined_staked,
      )}`,
      valueSize: 58,
    },
  ];
}

export async function renderSocialImage() {
  const [overview, changes, styfi, regularFontData, boldFontData, backgroundImageSrc, previewHeaderImageSrc] =
    await Promise.all([
    fetchJson<OverviewResponse>("/meta/protocol-context"),
    fetchJson<ChangesResponse>("/changes", { window: "7d", universe: "core", limit: 1 }),
    fetchJson<StyfiResponse>("/styfi"),
    regularFontPromise,
    boldFontPromise,
    backgroundImagePromise,
    previewHeaderImagePromise,
  ]);
  const cards = buildSocialCards(overview, changes, styfi);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0a0a",
          color: "#faf8f3",
          fontFamily: "Aeonik",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
          }}
        >
          <img
            alt=""
            src={backgroundImageSrc}
            width={1200}
            height={630}
            style={{
              position: "absolute",
              inset: 0,
              width: 1200,
              height: 630,
              objectFit: "cover",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              backgroundImage:
                "radial-gradient(circle at 84% 10%, rgba(6, 87, 233, 0.10), transparent 38%), radial-gradient(circle at 10% 88%, rgba(45, 212, 191, 0.035), transparent 32%)",
            }}
          />
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            width: "100%",
            height: 224,
            overflow: "hidden",
          }}
        >
          <img
            alt=""
            src={previewHeaderImageSrc}
            width={1200}
            height={630}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 1200,
              height: 630,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 56,
              bottom: 24,
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              color: "#d8cec0",
              fontSize: 27,
              lineHeight: 1,
            }}
          >
            <span>See where Yearn yield</span>
            <span style={{ color: "#367cff" }}>is moving</span>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            margin: "0 56px",
            borderTop: "1px solid rgba(255,255,255,0.16)",
          }}
        >
          <div style={{ display: "flex", flex: 1 }}>
            {cards.map((card, index) => (
              <div
                key={card.label}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-start",
                  minWidth: 0,
                  padding: index === 0 ? "30px 28px 26px 0" : "30px 28px 26px",
                  borderLeft: index > 0 ? "1px solid rgba(255,255,255,0.10)" : "0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    color: "#9b958c",
                    fontSize: 18,
                    fontWeight: 400,
                    letterSpacing: "0.08em",
                    lineHeight: 1.2,
                    height: 22,
                    textTransform: card.label === "stYFI APR" ? "none" : "uppercase",
                  }}
                >
                  {card.label}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 72,
                    marginTop: 20,
                    color: "#faf8f3",
                    fontSize: card.valueSize,
                    fontWeight: 700,
                    letterSpacing: "-0.045em",
                    lineHeight: 0.94,
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.value}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    minHeight: 56,
                    marginTop: 14,
                    color: "#c9c1b7",
                    fontSize: 22,
                    lineHeight: 1.25,
                  }}
                >
                  {card.note}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 52,
              borderTop: "1px solid rgba(255,255,255,0.10)",
              color: "#85817a",
              fontSize: 16,
              letterSpacing: "0.035em",
            }}
          >
            <span>Yearn vault discovery · realized-yield changes · stYFI</span>
            <span>yhelper.app</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Aeonik",
          data: regularFontData,
          style: "normal",
          weight: 400,
        },
        {
          name: "Aeonik",
          data: boldFontData,
          style: "normal",
          weight: 700,
        },
      ],
    },
  );
}
