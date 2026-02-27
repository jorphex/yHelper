import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import Link from "next/link";
import { AudienceToggle } from "./components/audience-toggle";
import { FreshnessBadge } from "./components/freshness-badge";

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
        <header className="site-header">
          <nav className="site-nav">
            <div className="site-nav-links">
              <Link href="/">Overview</Link>
              <Link href="/discover">Discover</Link>
              <Link href="/assets">Assets</Link>
              <Link href="/composition">Composition</Link>
              <Link href="/changes">Changes</Link>
              <Link href="/regimes">Regimes</Link>
              <Link href="/chains">Chains</Link>
            </div>
            <div className="site-controls">
              <FreshnessBadge />
              <AudienceToggle />
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
