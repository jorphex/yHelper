const TREND_STROKE_COLORS = [
  "var(--viz-line-1)",
  "var(--viz-line-2)",
  "var(--viz-line-3)",
  "var(--viz-line-4)",
  "var(--viz-line-5)",
];

const TREND_STROKE_CUSTOM: Record<string, string> = {
  styfi: "#0657E9",
  styfix: "#0657E9",
  combined: "#0657E9",
};

const REGIME_ORDER: Record<string, number> = {
  rising: 0,
  improving: 0,
  stable: 1,
  plateau: 1,
  falling: 2,
  declining: 2,
  choppy: 3,
  uncertain: 3,
  unknown: 4,
};

export function finiteValues(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
}

export function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5;
  return (value - min) / (max - min);
}

export function pickTrendStroke(id: string, index: number): string {
  if (TREND_STROKE_CUSTOM[id]) return TREND_STROKE_CUSTOM[id];

  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TREND_STROKE_COLORS[(hash + index) % TREND_STROKE_COLORS.length];
}

export function regimeOrder(regime: string): number {
  return REGIME_ORDER[regime?.toLowerCase()] ?? 99;
}

export function regimeColor(regime: string): [number, number, number] {
  const tone = regime?.toLowerCase() || "unknown";
  if (tone === "rising" || tone === "improving") return [34, 197, 94];
  if (tone === "stable" || tone === "plateau") return [250, 204, 21];
  if (tone === "falling" || tone === "declining") return [239, 68, 68];
  if (tone === "choppy" || tone === "uncertain") return [168, 85, 247];
  return [148, 163, 184];
}

export function compactRegimeLabel(regime: string): string {
  const map: Record<string, string> = {
    rising: "Rising",
    improving: "Rising",
    stable: "Stable",
    plateau: "Stable",
    falling: "Falling",
    declining: "Falling",
    choppy: "Choppy",
    uncertain: "Choppy",
    unknown: "Unknown",
  };
  return map[regime?.toLowerCase()] || regime || "Unknown";
}
