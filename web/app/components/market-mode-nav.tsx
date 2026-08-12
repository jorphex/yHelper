"use client";

import Link from "next/link";

export type MarketMode = "changes" | "vaults" | "compare" | "structure";

const modes: Array<{ id: MarketMode; href: string; label: string }> = [
  { id: "changes", href: "/markets", label: "What changed" },
  { id: "vaults", href: "/explore?tab=vaults", label: "Vaults" },
  { id: "compare", href: "/explore?tab=compare", label: "Compare assets" },
  { id: "structure", href: "/explore?tab=structure", label: "Structure" },
];

export function MarketModeNav({ active }: { active: MarketMode }) {
  return (
    <nav className="tab-bar" aria-label="Market views">
      {modes.map((mode) => (
        <Link
          key={mode.id}
          href={mode.href}
          aria-current={active === mode.id ? "page" : undefined}
          className={`button ${active === mode.id ? "button-primary" : "button-ghost"}`}
        >
          {mode.label}
        </Link>
      ))}
    </nav>
  );
}
