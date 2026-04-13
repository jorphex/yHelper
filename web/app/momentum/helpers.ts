export function compactRegimeLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.toLowerCase();
  if (key === "rising") return "Rising";
  if (key === "falling") return "Falling";
  if (key === "stable") return "Stable";
  if (key === "choppy") return "Choppy";
  return value;
}

export function regimeColor(value: string | null | undefined): [number, number, number] {
  const key = (value ?? "").toLowerCase();
  if (key === "rising") return [92, 145, 238];
  if (key === "stable") return [132, 170, 255];
  if (key === "falling") return [173, 116, 196];
  if (key === "choppy") return [104, 146, 190];
  return [114, 153, 206];
}

export function regimeOrder(value: string): number {
  const key = value.toLowerCase();
  if (key === "rising") return 0;
  if (key === "stable") return 1;
  if (key === "choppy") return 2;
  if (key === "falling") return 3;
  return 4;
}

export function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}
