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
const yearnLogoPromise = readFile(publicPath("yearn-logo.svg"), "utf-8").then((svg) => svg.replaceAll("#0657F9", "#F5F1EA"));

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

type StyfiResponse = {
  summary?: {
    reward_epoch?: number | null;
    combined_staked?: number | null;
  };
  current_reward_state?: {
    styfi_current_apr?: number | null;
  };
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
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
  const [social, styfi, regularFontData, boldFontData, yearnLogoSvg] = await Promise.all([
    fetchJson<SocialPreviewResponse>("/meta/social-preview"),
    fetchJson<StyfiResponse>("/styfi"),
    regularFontPromise,
    boldFontPromise,
    yearnLogoPromise,
  ]);

  const summary = social?.summary || {};
  const highest = social?.highest_apy_vault || {};
  const styfiSummary = styfi?.summary || {};
  const rewardState = styfi?.current_reward_state || {};

  const trackedTvl = usdCompact(summary.tracked_tvl_active_usd);
  const activeVaults = Number.isFinite(summary.active_vaults) ? String(summary.active_vaults) : "n/a";
  const highestName = compactText(highest.name || highest.symbol, 16);
  const highestApy = pct(highest.current_net_apy ?? highest.safe_apy_30d, 1);
  const highestChain = chainLabel(highest.chain_id);
  const styfiApr = pct(rewardState.styfi_current_apr, 1);
  const styfiEpoch = Number.isFinite(styfiSummary.reward_epoch) ? String(styfiSummary.reward_epoch) : "n/a";
  const combinedStaked =
    Number.isFinite(styfiSummary.combined_staked) ? `${(styfiSummary.combined_staked as number).toFixed(1)}` : "n/a";
  const yearnLogoSrc = `data:image/svg+xml;base64,${Buffer.from(yearnLogoSvg).toString("base64")}`;

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
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 84% 4%, rgba(6, 87, 233, 0.24), transparent 32%), radial-gradient(circle at 12% 90%, rgba(94, 231, 223, 0.11), transparent 26%), radial-gradient(circle at 86% 56%, rgba(196, 168, 255, 0.10), transparent 24%)",
          }}
        />

        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.045,
            backgroundImage:
              "linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "4px 4px, 4px 4px",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "48px 56px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 84,
                lineHeight: 0.92,
                letterSpacing: "-0.06em",
                fontWeight: 700,
                color: "#f5f1ea",
              }}
            >
              yHelper
            </div>

            <img
              alt=""
              src={yearnLogoSrc}
              style={{
                width: 300,
                height: "auto",
                objectFit: "contain",
                opacity: 0.97,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 22,
              alignItems: "stretch",
            }}
          >
            {[
              {
                label: "Tracked Scope TVL",
                value: trackedTvl,
                noteStrong: activeVaults,
                noteTail: "active vaults",
                valueStyle: { fontSize: 66, lineHeight: 0.9, letterSpacing: "-0.055em" },
              },
              {
                label: "Highest Yielding Vault",
                value: highestName,
                noteStrong: highestApy,
                noteTail: `APY · ${highestChain}`,
                valueStyle: { fontSize: 58, lineHeight: 0.92, letterSpacing: "-0.05em", maxWidth: 300 },
              },
              {
                label: "stYFI APR",
                value: styfiApr,
                noteStrong: `Epoch ${styfiEpoch}`,
                noteTail: `${combinedStaked} staked`,
                valueStyle: { fontSize: 66, lineHeight: 0.9, letterSpacing: "-0.055em" },
              },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: 224,
                  padding: "22px 22px 20px",
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 26,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                    fontWeight: 700,
                    color: "#d8cec0",
                  }}
                >
                  {card.label}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
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
                      fontSize: 28,
                      lineHeight: 1.2,
                      letterSpacing: "0.01em",
                      color: "#d8cec0",
                    }}
                  >
                    <span style={{ color: "#faf8f3", fontWeight: 700 }}>{card.noteStrong}</span>
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
