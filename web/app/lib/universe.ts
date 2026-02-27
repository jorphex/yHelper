export type UniverseKind = "core" | "extended" | "raw";

export const UNIVERSE_VALUES: readonly UniverseKind[] = ["core", "extended", "raw"] as const;

export function universeDefaults(universe: UniverseKind): { minTvl: number; minPoints: number } {
  if (universe === "core") return { minTvl: 1_000_000, minPoints: 45 };
  if (universe === "extended") return { minTvl: 250_000, minPoints: 20 };
  return { minTvl: 0, minPoints: 0 };
}

export function universeLabel(universe: UniverseKind): string {
  if (universe === "core") return "Core (high signal, ranked)";
  if (universe === "extended") return "Extended (broader, ranked)";
  return "Raw (all eligible)";
}
