"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { flexCopy } from "../flex/copy";

const researchPaths = ["/markets", "/momentum", "/explore", "/structure"];
const navItems = [
  { href: "/", label: "Home" },
  { href: "/styfi", label: "stYFI" },
  { href: "/flex", label: flexCopy.nav.label },
  { href: "/reports", label: "Rewards & reports", paths: ["/reports", "/harvests"] },
  { href: "/markets", label: "Vault research", paths: researchPaths },
];
const externalLinks = [{ href: "https://powerglove.yearn.fi", label: "Powerglove" }];

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
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

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
        {navItems.map((item) => {
          const active = item.paths ? item.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) : pathname === item.href;
          return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`sidebar-link ${active ? "is-active" : ""}`}
          >
            {item.label}
          </Link>
          );
        })}
      </nav>

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
