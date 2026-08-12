"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";

export type MarketMode = "changes" | "vaults" | "compare" | "structure";

const modes: Array<{ id: MarketMode; label: string }> = [
  { id: "changes", label: "What changed" },
  { id: "vaults", label: "Vaults" },
  { id: "compare", label: "Compare assets" },
  { id: "structure", label: "Composition" },
];

export function MarketModeNav({ active }: { active: MarketMode }) {
  const searchParams = useSearchParams();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const hrefs = useMemo(() => {
    const shared = new URLSearchParams();
    const universe = searchParams.get("universe");
    const market = searchParams.get("market");
    if (universe) shared.set("universe", universe);
    if (market) shared.set("market", market);
    return new Map(modes.map((mode) => {
      const params = new URLSearchParams(shared);
      params.set("view", mode.id);
      if (mode.id === "compare") {
        params.delete("market");
        const token = searchParams.get("token");
        if (token) params.set("token", token);
      }
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

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <nav className="market-mode-nav" aria-label="Market views">
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
