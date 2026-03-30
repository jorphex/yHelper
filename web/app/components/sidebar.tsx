"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/styfi", label: "stYFI" },
  { href: "/discover", label: "Discover" },
  { href: "/assets", label: "Assets" },
  { href: "/composition", label: "Composition" },
  { href: "/changes", label: "Changes" },
  { href: "/regimes", label: "Regimes" },
  { href: "/chains", label: "Chains" },
];

export function Sidebar() {
  const pathname = usePathname();

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

      <div className="sidebar-footer">
        <div className="freshness-badge">
          <span className="freshness-dot" />
          <span className="freshness-label">Live data</span>
        </div>
      </div>
    </aside>
  );
}
