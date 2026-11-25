import type { ReadonlyURLSearchParams } from "next/navigation";
import { queryChoice } from "./url";

export const UNIVERSE_VALUES = ["core", "raw"] as const;
export type UniverseKind = typeof UNIVERSE_VALUES[number];
export type MarketKind = "all" | "stablecoins" | "eth" | "bitcoin" | "other";

export const MARKET_VALUES: readonly MarketKind[] = ["all", "stablecoins", "eth", "bitcoin", "other"] as const;

export function marketScope(params: ReadonlyURLSearchParams) {
  const universe = queryChoice(params, "universe", UNIVERSE_VALUES, "core");
  const limits = universe === "core" ? { minTvl: 1_000_000, minPoints: 45 } : { minTvl: 0, minPoints: 0 };
  return { universe, market: queryChoice(params, "market", MARKET_VALUES, "all"), ...limits };
}

export function universeLabel(universe: UniverseKind): string {
  return universe === "core" ? "Established ($1m+ TVL)" : "All tracked vaults";
}

export function marketLabel(market: MarketKind): string {
  if (market === "stablecoins") return "Stablecoins";
  if (market === "eth") return "ETH";
  if (market === "bitcoin") return "Bitcoin";
  if (market === "other") return "Other assets";
  return "All markets";
}
