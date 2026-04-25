"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/api";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/explore", label: "Explore" },
  { href: "/harvests", label: "Harvests" },
  { href: "/structure", label: "Structure" },
  { href: "/momentum", label: "Momentum" },
  { href: "/styfi", label: "stYFI" },
];

const externalLinks = [
  { href: "https://powerglove.yearn.fi", label: "Powerglove" },
];

type OverviewNoteResponse = {
  summary?: string | null;
  mentioned_vault?: {
    symbol: string;
    href: string;
  } | null;
};

function ExternalLinkIcon() {
  return (
    <span className="external-arrow" aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "text-bottom", marginLeft: 4, opacity: 0.72 }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.5 8.5L8.5 3.5M5.25 3.5H8.5V6.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [mentionedVault, setMentionedVault] = useState<OverviewNoteResponse["mentioned_vault"]>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

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
          setMentionedVault(data.mentioned_vault || null);
        }
      } catch {
        // Silently fail - box will be hidden
      }
    }
    fetchOverviewNote();
    return () => { cancelled = true; };
  }, []);

  // Focus trap for mobile sidebar
  useEffect(() => {
    if (!isOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const focusableSelectors = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelectors));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Focus first element when opening
    first?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || focusables.length === 0) return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="sidebar-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={isOpen}
        aria-controls="sidebar-nav"
      >
        <MenuIcon open={isOpen} />
      </button>
      {isOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => {
            setIsOpen(false);
            toggleRef.current?.focus();
          }}
          aria-hidden="true"
        />
      )}
      <aside ref={sidebarRef} className={`sidebar ${isOpen ? "is-open" : ""}`} id="sidebar-nav">
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
          <div className="sidebar-note-content">
            {mentionedVault && summary.includes(mentionedVault.symbol) ? (
              <>
                {summary.slice(0, summary.indexOf(mentionedVault.symbol))}
                <a
                  href={mentionedVault.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="external-link text-accent"
                >
                  {mentionedVault.symbol}
                  <ExternalLinkIcon />
                </a>
                {summary.slice(summary.indexOf(mentionedVault.symbol) + mentionedVault.symbol.length)}
              </>
            ) : (
              summary
            )}
          </div>
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
            <ExternalLinkIcon />
          </a>
        ))}
      </nav>

    </aside>
    </>
  );
}
