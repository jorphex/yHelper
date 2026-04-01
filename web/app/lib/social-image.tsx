/* eslint-disable @next/next/no-img-element */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { internalApiUrl } from "./api";

export const alt = "yHelper dashboard preview";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

const publicPath = (...segments: string[]) => path.join(process.cwd(), "public", ...segments);

const regularFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Regular.ttf"));
const boldFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Bold.ttf"));
const previewBaseImagePromise = readFile(publicPath("social", "yhelper-preview-base.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);

type SocialPreviewResponse = {
  summary?: {
    active_vaults?: number | null;
    tracked_tvl_active_usd?: number | null;
  };
  highest_apy_vault?: {
    name?: string | null;
    symbol?: string | null;
    chain_id?: number | null;
    current_net_apy?: number | null;
    safe_apy_30d?: number | null;
  };
};

type OverviewResponse = {
  protocol_context?: {
    current_yearn?: {
      tvl_usd?: number | null;
      vaults?: number | null;
    } | null;
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

async function fetchJson<T>(pathName: string): Promise<T | null> {
  const normalizedPath = pathName.startsWith("/") ? pathName : `/${pathName}`;
  const candidates = [internalApiUrl(normalizedPath), `http://127.0.0.1:8000/api${normalizedPath}`];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        continue;
      }
      return (await response.json()) as T;
    } catch {
      continue;
    }
  }
  return null;
}

function usdCompact(value: number | null | undefined): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const absolute = Math.abs(value as number);
  const sign = (value as number) < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

function pct(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${((value as number) * 100).toFixed(digits)}%`;
}

function compactText(value: string | null | undefined, limit: number): string {
  const text = String(value || "").trim();
  if (!text) return "Syncing";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(3, limit - 1))}…`;
}

function chainLabel(chainId: number | null | undefined): string {
  switch (chainId) {
    case 1:
      return "Ethereum";
    case 10:
      return "Optimism";
    case 137:
      return "Polygon";
    case 8453:
      return "Base";
    case 42161:
      return "Arbitrum";
    case 747474:
      return "Katana";
    default:
      return "Unknown chain";
  }
}

export async function renderSocialImage() {
  const [social, overview, styfi, regularFontData, boldFontData, previewBaseImageSrc] = await Promise.all([
    fetchJson<SocialPreviewResponse>("/meta/social-preview"),
    fetchJson<OverviewResponse>("/overview"),
    fetchJson<StyfiResponse>("/styfi"),
    regularFontPromise,
    boldFontPromise,
    previewBaseImagePromise,
  ]);

  const summary = social?.summary || {};
  const protocol = overview?.protocol_context?.current_yearn || {};
  const highest = social?.highest_apy_vault || {};
  const styfiSummary = styfi?.summary || {};
  const rewardState = styfi?.current_reward_state || {};

  const activeVaultCount = summary.active_vaults ?? protocol.vaults;
  const styfiEpochValue = rewardState.epoch ?? styfiSummary.reward_epoch;

  const cards = [
    {
      value: usdCompact(summary.tracked_tvl_active_usd ?? protocol.tvl_usd),
      noteStrong: Number.isFinite(activeVaultCount) ? String(activeVaultCount) : "n/a",
      noteTail: "active vaults",
      valueStyle: { fontSize: 62, lineHeight: 0.9, letterSpacing: "-0.05em" },
    },
    {
      value: compactText(highest.name || highest.symbol, 14),
      noteStrong: pct(highest.current_net_apy ?? highest.safe_apy_30d, 1),
      noteTail: `APY · ${chainLabel(highest.chain_id)}`,
      valueStyle: { fontSize: 56, lineHeight: 0.92, letterSpacing: "-0.05em", maxWidth: 300 },
    },
    {
      value: pct(rewardState.styfi_current_apr, 1),
      noteStrong: `Epoch ${Number.isFinite(styfiEpochValue) ? String(styfiEpochValue) : "n/a"}`,
      noteTail: `${Number.isFinite(styfiSummary.combined_staked) ? (styfiSummary.combined_staked as number).toFixed(1) : "n/a"} staked`,
      valueStyle: { fontSize: 62, lineHeight: 0.9, letterSpacing: "-0.05em" },
    },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0a0a",
          color: "#faf8f3",
          fontFamily: "Aeonik",
          overflow: "hidden",
        }}
      >
        <img
          alt=""
          src={previewBaseImageSrc}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            padding: "48px 56px",
          }}
        >
          <div
            style={{
              display: "flex",
              flex: 1,
            }}
          />

          <div
            style={{
              display: "flex",
              gap: 22,
              alignItems: "stretch",
            }}
          >
            {cards.map((card, index) => (
              <div
                key={`${index}-${card.noteStrong}`}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  minHeight: 314,
                  padding: "24px 24px 22px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      color: "#faf8f3",
                      fontWeight: 700,
                      ...card.valueStyle,
                    }}
                  >
                    {card.value}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 16,
                      fontSize: 25,
                      lineHeight: 1.28,
                      color: "#d8cec0",
                    }}
                  >
                    <span
                      style={{
                        color: "#faf8f3",
                        fontWeight: 700,
                      }}
                    >
                      {card.noteStrong}
                    </span>
                    <span>{card.noteTail}</span>
                  </div>
                </div>
              </div>
            ))}
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
