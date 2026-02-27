export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  100: "Gnosis",
  137: "Polygon",
  146: "Sonic",
  250: "Fantom",
  252: "Fraxtal",
  324: "zkSync Era",
  8453: "Base",
  42161: "Arbitrum",
  43114: "Avalanche",
  59144: "Linea",
  81457: "Blast",
  534352: "Scroll",
  747474: "Katana",
};

export function chainLabel(chainId: number | null | undefined): string {
  if (chainId === null || chainId === undefined) {
    return "Unknown chain";
  }
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatHours(seconds: number | null | undefined, digits = 1): string {
  if (seconds === null || seconds === undefined) {
    return "n/a";
  }
  return `${(seconds / 3600).toFixed(digits)}h`;
}

export function shortVaultLabel(symbol: string | null | undefined, address: string): string {
  if (symbol && symbol.trim().length > 0) {
    return symbol.trim();
  }
  return address.slice(0, 10);
}

export function regimeLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const key = value.toLowerCase();
  if (key === "rising") return "Rising (recent yield improving)";
  if (key === "falling") return "Falling (recent yield weakening)";
  if (key === "stable") return "Stable (small trend, lower volatility)";
  if (key === "choppy") return "Choppy (high volatility)";
  return value;
}
