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

const CHAIN_COMPACT_NAMES: Record<number, string> = {
  1: "ETH",
  10: "OP",
  56: "BNB",
  100: "Gnosis",
  137: "Polygon",
  146: "Sonic",
  250: "Fantom",
  252: "Fraxtal",
  324: "zkSync",
  8453: "Base",
  42161: "Arbitrum",
  43114: "Avalanche",
  59144: "Linea",
  81457: "Blast",
  534352: "Scroll",
  747474: "Katana",
};

export function compactChainLabel(chainId: number | null | undefined, compact = false): string {
  const label = chainLabel(chainId);
  if (!compact) return label;
  if (chainId === null || chainId === undefined) return label;
  return CHAIN_COMPACT_NAMES[chainId] ?? label;
}

export function formatPct(value: number | null | undefined, digits = 2, isLoading = false): string {
  if (isLoading) {
    return "—";
  }
  if (value === null || value === undefined) {
    return "n/a";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number | null | undefined, digits = 0, isLoading = false): string {
  if (isLoading) {
    return "—";
  }
  if (value === null || value === undefined) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatHours(seconds: number | null | undefined, digits = 1, isLoading = false): string {
  if (isLoading) {
    return "—";
  }
  if (seconds === null || seconds === undefined) {
    return "n/a";
  }
  return `${(seconds / 3600).toFixed(digits)}h`;
}

const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatUtcDateTime(value: Date | number | string | null | undefined, isLoading = false): string {
  if (isLoading) {
    return "—";
  }
  if (value === null || value === undefined) {
    return "n/a";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return `${UTC_DATE_TIME_FORMATTER.format(date)} UTC`;
}

export function shortVaultLabel(symbol: string | null | undefined, address: string): string {
  if (symbol && symbol.trim().length > 0) {
    return symbol.trim();
  }
  return address.slice(0, 10);
}

export function yearnVaultUrl(chainId: number, address: string): string {
  return `https://yearn.fi/vaults/${chainId}/${encodeURIComponent(address)}`;
}

const CHAIN_EXPLORER_BASES: Record<number, string> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  100: "https://gnosisscan.io",
  137: "https://polygonscan.com",
  146: "https://sonicscan.org",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  747474: "https://katanascan.com",
};

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = CHAIN_EXPLORER_BASES[chainId];
  if (!base) return null;
  return `${base}/address/${encodeURIComponent(address)}`;
}

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = CHAIN_EXPLORER_BASES[chainId];
  if (!base) return null;
  return `${base}/tx/${encodeURIComponent(txHash)}`;
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

export function compactCategoryLabel(value: string | null | undefined, compact = false): string {
  if (!value || value.trim().length === 0) return "unknown";
  const label = value.trim();
  if (!compact) return label;
  const key = label.toLowerCase();
  if (key === "stablecoin") return "Stable";
  if (key === "volatile") return "Vol.";
  if (key === "liquid staking") return "LST";
  if (key === "restaking") return "Restk.";
  if (label.length <= 7) return label;
  return `${label.slice(0, 6)}…`;
}
