import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { AudienceToggle } from "./components/audience-toggle";
import { ChunkRecovery } from "./components/chunk-recovery";
import { FreshnessBadge } from "./components/freshness-badge";
import { NavLinks } from "./components/nav-links";

const siteUrlRaw = process.env.NEXT_PUBLIC_SITE_URL || "https://yhelper.app";
const siteUrl = siteUrlRaw.startsWith("http://") || siteUrlRaw.startsWith("https://") ? siteUrlRaw : `https://${siteUrlRaw}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "yHelper",
  description: "Yearn dashboard for vault discovery, yield shifts, and deeper composition, regime, and chain analysis.",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "yHelper",
    title: "yHelper",
    description: "Yearn dashboard for vault discovery, yield shifts, and deeper composition, regime, and chain analysis.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "yHelper dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "yHelper",
    description: "Yearn dashboard for vault discovery, yield shifts, and deeper composition, regime, and chain analysis.",
    images: ["/twitter-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-audience="guide">
      <body>
        <ChunkRecovery />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="site-header">
          <nav className="site-nav">
            <NavLinks />
            <div className="site-controls">
              <FreshnessBadge />
              <AudienceToggle />
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
