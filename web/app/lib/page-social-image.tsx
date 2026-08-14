import { ImageResponse } from "next/og";
import { SocialImageFrame, socialImageAssets, socialImageFonts, socialImageSize } from "./social-image-frame";

export const pageSocialCopy = {
  overview: { label: "Overview", promise: "Yearn, at a glance." },
  markets: { label: "Markets", promise: "Explore Yearn vaults by market." },
  reports: { label: "Reports", promise: "Follow vault activity and locker rewards." },
  styfi: { label: "stYFI", promise: "Follow the stYFI lending position." },
  flex: { label: "Flex Markets", promise: "Ethereum lending." },
} as const;

export type PageSocialSurface = keyof typeof pageSocialCopy;

export async function renderPageSocialImage(surface: PageSocialSurface) {
  const assets = await socialImageAssets();
  const copy = pageSocialCopy[surface];
  return new ImageResponse(
    <SocialImageFrame assets={assets}>
      <div style={{ position: "relative", display: "flex", flex: 1, margin: "0 56px", borderTop: "1px solid rgba(255,255,255,.16)" }}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", justifyContent: "center", padding: "34px 0" }}>
          <div style={{ display: "flex", color: "#9b958c", fontSize: 26, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>{copy.label}</div>
          <div style={{ display: "flex", maxWidth: 900, marginTop: 22, fontSize: 68, fontWeight: 700, letterSpacing: "-.045em", lineHeight: 1.02 }}>{copy.promise}</div>
        </div>
      </div>
    </SocialImageFrame>,
    { ...socialImageSize, fonts: socialImageFonts(assets) },
  );
}
