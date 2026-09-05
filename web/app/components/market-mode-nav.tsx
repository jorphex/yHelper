"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export type MarketMode = "changes" | "vaults" | "structure";

const modes: Array<{ id: MarketMode; label: string }> = [
  { id: "vaults", label: "Find a vault" },
  { id: "changes", label: "Yield changes" },
  { id: "structure", label: "Composition" },
];

export function MarketModeNav({ active }: { active: MarketMode }) {
  const searchParams = useSearchParams();
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const hrefs = useMemo(() => {
    const shared = new URLSearchParams();
    const universe = searchParams.get("universe");
    const market = searchParams.get("market");
    if (universe) shared.set("universe", universe);
    if (market) shared.set("market", market);
    return new Map(modes.map((mode) => {
      const params = new URLSearchParams(shared);
      params.set("view", mode.id);
      if (mode.id === "vaults") {
        const chain = searchParams.get("chain");
        if (chain) params.set("chain", chain);
      }
      if (mode.id === "changes") {
        const window = searchParams.get("window");
        if (window) params.set("window", window);
      }
      return [mode.id, `/markets?${params.toString()}`];
    }));
  }, [searchParams]);

  const updateOverflow = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const lastLink = nav.querySelector<HTMLAnchorElement>("a:last-of-type");
    const contentRight = lastLink ? lastLink.offsetLeft + lastLink.offsetWidth : nav.scrollWidth;
    setOverflow({
      start: nav.scrollLeft > 1,
      end: contentRight - nav.scrollLeft - nav.clientWidth > 1,
    });
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    const activeLink = activeRef.current;
    if (!nav || !activeLink) return;

    if (nav.scrollWidth <= nav.clientWidth + 1) {
      nav.scrollLeft = 0;
    } else {
      // Keep the selected view fully visible when the labels genuinely overflow.
      activeLink.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
    }
    updateOverflow();
  }, [active, updateOverflow]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    updateOverflow();
    nav.addEventListener("scroll", updateOverflow, { passive: true });
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(nav);
    return () => {
      nav.removeEventListener("scroll", updateOverflow);
      observer.disconnect();
    };
  }, [updateOverflow]);

  return (
    <nav
      ref={navRef}
      className="market-mode-nav"
      aria-label="Vault research views"
      data-scrollable={overflow.start || overflow.end ? "true" : "false"}
      data-overflow-start={overflow.start ? "true" : "false"}
      data-overflow-end={overflow.end ? "true" : "false"}
    >
      {modes.map((mode) => (
        <Link
          key={mode.id}
          href={hrefs.get(mode.id) || "/markets"}
          ref={active === mode.id ? activeRef : undefined}
          aria-current={active === mode.id ? "page" : undefined}
          className={`market-mode-link ${active === mode.id ? "is-active" : ""}`.trim()}
        >
          {mode.label}
        </Link>
      ))}
    </nav>
  );
}
