"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateIndicator = () => {
      const active = container.querySelector<HTMLAnchorElement>("a.is-active");
      if (!active) return;
      container.style.setProperty("--nav-active-x", `${active.offsetLeft}px`);
      container.style.setProperty("--nav-active-w", `${active.offsetWidth}px`);
      container.dataset.ready = "true";
    };
    updateIndicator();
    const resizeObserver = new ResizeObserver(() => updateIndicator());
    resizeObserver.observe(container);
    const links = container.querySelectorAll("a");
    links.forEach((link) => resizeObserver.observe(link));
    container.addEventListener("scroll", updateIndicator, { passive: true });
    window.addEventListener("resize", updateIndicator);
    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", updateIndicator);
      window.removeEventListener("resize", updateIndicator);
    };
  }, [pathname]);

  return (
    <div ref={containerRef} className="site-nav-links" aria-label="Primary">
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
