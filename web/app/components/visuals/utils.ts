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
