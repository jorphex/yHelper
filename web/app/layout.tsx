import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { AudienceToggle } from "./components/audience-toggle";
import { ChunkRecovery } from "./components/chunk-recovery";
import { FreshnessBadge } from "./components/freshness-badge";
import { NavLinks } from "./components/nav-links";

export const metadata: Metadata = {
  title: "yHelper Dashboard",
  description: "Public Yearn dashboard for vault discovery, regimes, composition, and change monitoring."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
