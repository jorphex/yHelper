/* eslint-disable @next/next/no-img-element */

import { readFile } from "node:fs/promises";
import path from "node:path";

const publicPath = (...segments: string[]) => path.join(process.cwd(), "public", ...segments);

const regularFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Regular.ttf"));
const boldFontPromise = readFile(publicPath("fonts", "yearn", "Aeonik-Bold.ttf"));
const backgroundImagePromise = readFile(publicPath("social", "yhelper-preview-bg-v2.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);
const headerImagePromise = readFile(publicPath("social", "yhelper-preview-base.png")).then(
  (file) => `data:image/png;base64,${file.toString("base64")}`,
);

export const socialImageSize = { width: 1200, height: 630 };

export async function socialImageAssets() {
  const [regularFontData, boldFontData, backgroundSrc, headerSrc] = await Promise.all([
    regularFontPromise,
    boldFontPromise,
    backgroundImagePromise,
    headerImagePromise,
  ]);
  return { regularFontData, boldFontData, backgroundSrc, headerSrc };
}

export function socialImageFonts(assets: Awaited<ReturnType<typeof socialImageAssets>>) {
  return [
    { name: "Aeonik", data: assets.regularFontData, style: "normal" as const, weight: 400 as const },
    { name: "Aeonik", data: assets.boldFontData, style: "normal" as const, weight: 700 as const },
  ];
}

export function SocialImageFrame({
  assets,
  children,
}: {
  assets: Awaited<ReturnType<typeof socialImageAssets>>;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden", background: "#0a0a0a", color: "#faf8f3", fontFamily: "Aeonik" }}>
      <img alt="" src={assets.backgroundSrc} width={1200} height={630} style={{ position: "absolute", inset: 0, width: 1200, height: 630, objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: "radial-gradient(circle at 82% 12%, rgba(6,87,233,.11), transparent 40%)" }} />
      <div style={{ position: "relative", display: "flex", flexShrink: 0, width: "100%", height: 210, overflow: "hidden" }}>
        <img alt="" src={assets.headerSrc} width={1200} height={630} style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630 }} />
      </div>
      {children}
    </div>
  );
}
