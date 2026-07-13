export type UniverseKind = "core" | "extended" | "raw";
export type MarketKind = "all" | "stablecoins" | "eth" | "bitcoin" | "other";

export const UNIVERSE_VALUES: readonly UniverseKind[] = ["core", "raw"] as const;
export const MARKET_VALUES: readonly MarketKind[] = ["all", "stablecoins", "eth", "bitcoin", "other"] as const;

export function universeDefaults(universe: UniverseKind): { minTvl: number; minPoints: number } {
  if (universe === "core") return { minTvl: 1_000_000, minPoints: 45 };
  if (universe === "extended") return { minTvl: 250_000, minPoints: 20 };
  return { minTvl: 0, minPoints: 0 };
}

export function universeLabel(universe: UniverseKind): string {
  if (universe === "core") return "Established ($1m+ TVL)";
  if (universe === "extended") return "Broader ($250k+ TVL)";
  return "All comparable vaults";
}

export function marketLabel(market: MarketKind): string {
  if (market === "stablecoins") return "Stablecoins";
  if (market === "eth") return "ETH";
  if (market === "bitcoin") return "Bitcoin";
  if (market === "other") return "Other assets";
  return "All markets";
}
