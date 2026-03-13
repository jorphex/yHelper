import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import Link from "next/link";
import { AudienceToggle } from "./components/audience-toggle";
import { ChunkRecovery } from "./components/chunk-recovery";
import { FreshnessBadge } from "./components/freshness-badge";
import { NavLinks } from "./components/nav-links";
import { SOCIAL_IMAGE_VERSION } from "./lib/social-image-version";
import { SHELL_THEME_STYLE } from "./lib/shell-theme";

const siteUrlRaw = process.env.NEXT_PUBLIC_SITE_URL || "https://yhelper.app";
const siteUrl = siteUrlRaw.startsWith("http://") || siteUrlRaw.startsWith("https://") ? siteUrlRaw : `https://${siteUrlRaw}`;
const BG_TEXTURE_VERSION = process.env.NEXT_PUBLIC_BG_TEXTURE_VERSION || "20260304bg12";
const BG_TEXTURE_SRC = `/bg/grit-abstract-v1.webp?v=${BG_TEXTURE_VERSION}`;
const AUDIENCE_BOOTSTRAP = `(function(){try{var raw=window.localStorage.getItem("yhelper:audience-mode");var mode=raw==="analyst"?"analyst":"guide";document.documentElement.dataset.audience=mode;}catch(_e){document.documentElement.dataset.audience="guide";}})();`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "yHelper",
  description: "Yearn dashboard for vault discovery, yield shifts, and deeper composition, regime, and chain analysis.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "64x64" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "yHelper",
    title: "yHelper",
    description: "Yearn dashboard for vault discovery, yield shifts, and deeper composition, regime, and chain analysis.",
    images: [
      {
        url: `/opengraph-image?v=${SOCIAL_IMAGE_VERSION}`,
        width: 1200,
        height: 630,
        alt: `yHelper dashboard preview ${SOCIAL_IMAGE_VERSION}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "yHelper",
    description: "Yearn dashboard for vault discovery, yield shifts, and deeper composition, regime, and chain analysis.",
    images: [`/twitter-image?v=${SOCIAL_IMAGE_VERSION}`],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-audience="guide" style={SHELL_THEME_STYLE}>
      <head>
        <link rel="preload" as="image" href={BG_TEXTURE_SRC} />
        <script dangerouslySetInnerHTML={{ __html: AUDIENCE_BOOTSTRAP }} />
      </head>
      <body>
        <ChunkRecovery />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="site-header">
          <nav className="site-nav" aria-label="Primary">
            <div className="site-nav-top">
              <Link href="/" className="site-brand" aria-label="yHelper overview">
                <span className="site-brand-mark" aria-hidden="true">
                  yh
                </span>
                <span className="site-brand-copy">
                  <span className="site-brand-name">yHelper</span>
                  <span className="site-brand-tag">Yearn signal layer</span>
                </span>
              </Link>
              <div className="site-controls">
                <FreshnessBadge />
                <AudienceToggle />
              </div>
            </div>
            <div className="site-nav-bottom">
              <NavLinks />
            </div>
          </nav>
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
