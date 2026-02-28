"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Overview" },
  { href: "/discover", label: "Discover" },
  { href: "/assets", label: "Assets" },
  { href: "/composition", label: "Composition" },
  { href: "/changes", label: "Changes" },
  { href: "/regimes", label: "Regimes" },
  { href: "/chains", label: "Chains" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="site-nav-links" aria-label="Primary">
      {NAV_LINKS.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined} className={isActive ? "is-active" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
