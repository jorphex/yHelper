"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Overview" },
  { href: "/explore", label: "Explore" },
  { href: "/harvests", label: "Harvests" },
  { href: "/structure", label: "Structure" },
  { href: "/momentum", label: "Momentum" },
  { href: "/styfi", label: "stYFI" },
];

export function NavLinks() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateIndicator = () => {
      const active = container.querySelector<HTMLAnchorElement>("a.is-active");
      if (!active) return;
      if (container.scrollWidth > container.clientWidth + 4) {
        active.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
      }
      container.style.setProperty("--nav-active-x", `${active.offsetLeft}px`);
      container.style.setProperty("--nav-active-y", `${active.offsetTop}px`);
      container.style.setProperty("--nav-active-w", `${active.offsetWidth}px`);
      container.style.setProperty("--nav-active-h", `${active.offsetHeight}px`);
      container.dataset.ready = "true";
    };
    updateIndicator();
    const frame = window.requestAnimationFrame(updateIndicator);
    const resizeObserver = new ResizeObserver(() => updateIndicator());
    resizeObserver.observe(container);
    const links = container.querySelectorAll("a");
    links.forEach((link) => resizeObserver.observe(link));
    container.addEventListener("scroll", updateIndicator, { passive: true });
    window.addEventListener("resize", updateIndicator);
    return () => {
      window.cancelAnimationFrame(frame);
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
