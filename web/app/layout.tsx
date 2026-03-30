import "./globals-editorial.css";
import type { Metadata, Viewport } from "next";
import { ReactNode, Suspense } from "react";
import { Sidebar } from "./components/sidebar";
import { ChunkRecovery } from "./components/chunk-recovery";
import { Providers } from "./providers";
import { SOCIAL_IMAGE_VERSION } from "./lib/social-image-version";

const siteUrlRaw = process.env.NEXT_PUBLIC_SITE_URL || "https://yhelper.app";
const siteUrl = siteUrlRaw.startsWith("http://") || siteUrlRaw.startsWith("https://") ? siteUrlRaw : `https://${siteUrlRaw}`;
const SOCIAL_PREVIEW_SRC = `/social/yhelper-preview-${SOCIAL_IMAGE_VERSION}.png`;
const SOCIAL_PREVIEW_URL = `${siteUrl}${SOCIAL_PREVIEW_SRC}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "yHelper - Yearn Vault Analytics",
  description: "Elegant analytics for Yearn vault discovery, yield shifts, and strategic decisions.",
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
    title: "yHelper - Yearn Vault Analytics",
    description: "Elegant analytics for Yearn vault discovery, yield shifts, and strategic decisions.",
    images: [
      {
        url: SOCIAL_PREVIEW_URL,
        width: 1200,
        height: 630,
        alt: `yHelper dashboard preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "yHelper - Yearn Vault Analytics",
    description: "Elegant analytics for Yearn vault discovery, yield shifts, and strategic decisions.",
    images: [SOCIAL_PREVIEW_URL],
  },
  other: {
    "og:image:secure_url": SOCIAL_PREVIEW_URL,
    "twitter:image:src": SOCIAL_PREVIEW_URL,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

// Ambient background component (preserved film grain + haze)
function AmbientBackground() {
  return (
    <>
      <div className="ambient-bg" aria-hidden="true">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-orb ambient-orb-3" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />
    </>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AmbientBackground />
        <ChunkRecovery />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        
        <div className="app-shell">
          <Sidebar />
          
          <main id="main-content" className="main-content animate-fade-in-up" tabIndex={-1}>
            <Providers>
              <div className="content-area">
                <Suspense fallback={null}>
                  {children}
                </Suspense>
              </div>
            </Providers>
          </main>
        </div>
      </body>
    </html>
  );
}
