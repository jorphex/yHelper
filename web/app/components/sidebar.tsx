"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiUrl } from "../lib/api";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/explore", label: "Explore" },
  { href: "/structure", label: "Structure" },
  { href: "/momentum", label: "Momentum" },
  { href: "/styfi", label: "stYFI" },
];

const externalLinks = [
  { href: "https://powerglove.yearn.fi", label: "Powerglove" },
];

type OverviewNoteResponse = {
  summary?: string | null;
};

export function Sidebar() {
  const pathname = usePathname();
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchOverviewNote() {
      try {
        const res = await fetch(apiUrl("/overview-note"), { cache: "no-store" });
        if (!res.ok) {
          return;
        }
        const data: OverviewNoteResponse = await res.json();
        if (!cancelled) {
          setSummary(data.summary || null);
        }
      } catch {
        // Silently fail - box will be hidden
      }
    }
    fetchOverviewNote();
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Link href="/" className="sidebar-logo">
          yHelper
        </Link>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link ${pathname === item.href ? "is-active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {summary && (
        <div className="sidebar-note">
          <div className="sidebar-note-title">Summary</div>
          <div className="sidebar-note-content">{summary}</div>
        </div>
      )}

      <div className="sidebar-divider" />

      <nav className="sidebar-nav sidebar-external">
        {externalLinks.map((item) => (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-link sidebar-link-external"
          >
            {item.label}
            <span className="external-arrow" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4.5 9.5L9.5 4.5M9.5 4.5V8.5M9.5 4.5H5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </span>
          </a>
        ))}
      </nav>

    </aside>
  );
}
