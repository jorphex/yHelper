"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/api";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/explore", label: "Explore" },
  { href: "/momentum", label: "Momentum" },
  { href: "/harvests", label: "Reports" },
  { href: "/styfi", label: "stYFI" },
];

const externalLinks = [
  { href: "https://powerglove.yearn.fi", label: "Powerglove" },
];

type YieldPulse = {
  trend: "improving" | "softening" | "steady";
  data_state: "ready" | "limited" | "delayed";
  latest_7d_apy: number;
  change_7d: number;
  directional_tvl_ratio: number | null;
  coverage_ratio: number | null;
  fresh_tvl_ratio: number | null;
  freshness_window_hours: number;
  eligible_vaults: number;
  comparable_vaults: number;
  latest_data_at: string | null;
};

type OverviewPulseResponse = {
  pulse?: YieldPulse | null;
};

function formatPulsePercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPercentagePointChange(value: number): string {
  const points = value * 100;
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(2)} pp`;
}

function formatUpdatedAt(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  if (ageHours < 1) return "Updated less than 1h ago";
  if (ageHours < 24) return `Updated ${Math.round(ageHours)}h ago`;
  const ageDays = Math.max(1, Math.round(ageHours / 24));
  return `Updated ${ageDays}d ago`;
}

function pulseHeadline(pulse: YieldPulse): string {
  if (pulse.data_state === "limited") return "7d comparison is limited";
  if (pulse.data_state === "delayed") return "7d yield data is delayed";
  if (pulse.trend === "improving") return "7d realized yield improved";
  if (pulse.trend === "softening") return "7d realized yield softened";
  return "7d realized yield held steady";
}

function pulseBreadth(pulse: YieldPulse): string {
  if (pulse.data_state === "limited") {
    const coverage = pulse.coverage_ratio === null ? "An unknown share" : `${Math.round(pulse.coverage_ratio * 100)}%`;
    return `${coverage} of core TVL has comparable windows.`;
  }
  if (pulse.data_state === "delayed") {
    const fresh = pulse.fresh_tvl_ratio === null ? "An unknown share" : `${Math.round(pulse.fresh_tvl_ratio * 100)}%`;
    return `${fresh} of comparable TVL updated within ${pulse.freshness_window_hours}h.`;
  }
  if (pulse.directional_tvl_ratio !== null && pulse.directional_tvl_ratio >= 0.6) {
    const verb = pulse.trend === "improving" ? "improved" : pulse.trend === "softening" ? "softened" : "held steady";
    return `${Math.round(pulse.directional_tvl_ratio * 100)}% of comparable TVL ${verb}.`;
  }
  return "Direction was mixed across comparable vaults.";
}

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
  const [pulse, setPulse] = useState<YieldPulse | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pulseUpdatedAt = pulse ? formatUpdatedAt(pulse.latest_data_at) : null;

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function fetchOverviewPulse() {
      try {
        const res = await fetch(apiUrl("/overview-pulse"), { cache: "no-store" });
        if (!res.ok) {
          return;
        }
        const data: OverviewPulseResponse = await res.json();
        if (!cancelled) {
          setPulse(data.pulse || null);
        }
      } catch {
        // Silently fail - box will be hidden
      }
    }
    fetchOverviewPulse();
    return () => { cancelled = true; };
  }, []);

  // Focus trap for mobile sidebar
  useEffect(() => {
    if (!isOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const focusableSelectors = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = [
      toggleRef.current,
      ...Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelectors)),
    ].filter((item): item is HTMLElement => item !== null);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Keep the visible close control inside the focus loop.
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

      <nav className="sidebar-nav" aria-label="Primary">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            className={`sidebar-link ${pathname === item.href ? "is-active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {pulse && (
        <section className="sidebar-note" aria-labelledby="yield-pulse-title">
          <div className="sidebar-note-title" id="yield-pulse-title">Yield pulse</div>
          <div className="sidebar-pulse-headline">{pulseHeadline(pulse)}</div>
          <div className="sidebar-pulse-value">{formatPulsePercent(pulse.latest_7d_apy)}</div>
          <div className="sidebar-pulse-label">TVL-weighted 7d realized APY</div>
          <div className={`sidebar-pulse-change tone-${pulse.trend}`}>
            {formatPercentagePointChange(pulse.change_7d)} vs preceding 7d
          </div>
          <div className="sidebar-pulse-breadth">{pulseBreadth(pulse)}</div>
          <div className="sidebar-pulse-meta">
            {pulse.comparable_vaults}/{pulse.eligible_vaults} eligible vaults · {pulse.coverage_ratio === null ? "n/a" : `${Math.round(pulse.coverage_ratio * 100)}%`} TVL coverage
          </div>
          {pulseUpdatedAt ? <div className="sidebar-pulse-meta">{pulseUpdatedAt}</div> : null}
          <Link href="/momentum" className="sidebar-pulse-link">Open Momentum</Link>
        </section>
      )}

      <div className="sidebar-divider" />

      <nav className="sidebar-nav sidebar-external" aria-label="Related">
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
