import { ImageResponse } from "next/og";
import { flexCopy } from "../flex/copy";
import { internalApiUrl } from "./api";
import { SocialImageFrame, socialImageAssets, socialImageFonts, socialImageSize } from "./social-image-frame";

export const pageSocialCopy = {
  overview: { label: "Overview", promise: "Yearn, at a glance." },
  markets: { label: "Markets", promise: "Explore Yearn vaults by market." },
  reports: { label: "Reports", promise: "Follow vault activity and locker rewards." },
  styfi: { label: "stYFI", promise: "Follow the stYFI lending position." },
  flex: { label: "Flex Markets", promise: "Ethereum lending" },
} as const;

export type PageSocialSurface = keyof typeof pageSocialCopy;

type FlexMarketSummary = {
  freshness?: {
    data_state?: "ready" | "delayed" | "unavailable";
  };
  summary?: {
    deposits_usd?: number | null;
    markets?: {
      active?: number;
    };
  };
};

async function flexActiveDeposits(): Promise<number | null> {
  const query = { status: "active" };
  const urls = [
    internalApiUrl("/flex/markets", query),
    `http://127.0.0.1:8000/api/flex/markets?${new URLSearchParams(query)}`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) continue;
      const data = await response.json() as FlexMarketSummary;
      const deposits = data.summary?.deposits_usd;
      if (data.freshness?.data_state === "ready" && (data.summary?.markets?.active ?? 0) > 0 && typeof deposits === "number" && Number.isFinite(deposits) && deposits >= 0) {
        return deposits;
      }
    } catch {
      // The durable Flex identity remains useful when live data is unavailable.
    }
  }
  return null;
}

function compactUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${Math.round(value / 100_000_000) / 10}B`;
  if (value >= 1_000_000) return `$${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

export async function renderPageSocialImage(surface: PageSocialSurface) {
  const [assets, deposits] = await Promise.all([
    socialImageAssets(),
    surface === "flex" ? flexActiveDeposits() : Promise.resolve(null),
  ]);
  const copy = pageSocialCopy[surface];
  const hasFlexSignal = surface === "flex" && deposits !== null;
  return new ImageResponse(
    <SocialImageFrame assets={assets}>
      <div style={{ position: "relative", display: "flex", flex: 1, margin: "0 56px", borderTop: "1px solid rgba(255,255,255,.16)" }}>
        <div style={{ display: "flex", flexDirection: "column", width: hasFlexSignal ? 690 : "100%", justifyContent: "center", padding: hasFlexSignal ? "34px 46px 34px 0" : "34px 0" }}>
          <div style={{ display: "flex", color: "#9b958c", fontSize: 26, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>{copy.label}</div>
          <div style={{ display: "flex", maxWidth: hasFlexSignal ? 610 : 900, marginTop: 22, fontSize: hasFlexSignal ? 58 : 68, fontWeight: 700, letterSpacing: "-.045em", lineHeight: 1.02 }}>{copy.promise}</div>
        </div>
        {hasFlexSignal ? <div style={{ display: "flex", flexDirection: "column", width: 398, justifyContent: "center", padding: "34px 0 34px 42px", borderLeft: "1px solid rgba(255,255,255,.10)" }}>
          <div style={{ display: "flex", color: "#9b958c", fontSize: 22, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>{flexCopy.social.activeDeposits}</div>
          <div style={{ display: "flex", marginTop: 18, fontSize: 58, fontWeight: 700, letterSpacing: "-.04em", lineHeight: 1 }}>{compactUsd(deposits)}</div>
        </div> : null}
      </div>
    </SocialImageFrame>,
    { ...socialImageSize, fonts: socialImageFonts(assets) },
  );
}
