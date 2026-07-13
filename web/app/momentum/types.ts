export type WindowKey = "24h" | "7d" | "30d";
export type MoverSortKey = "vault" | "chain" | "tvl" | "current" | "previous" | "delta";

export type ChangeRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  market?: string | null;
  tvl_usd: number | null;
  realized_apy_window: number | null;
  realized_apy_prev_window: number | null;
  delta_apy: number | null;
  age_seconds: number | null;
};

export type DailyTrendRow = {
  day: string;
  weighted_apy_7d?: number | null;
  weighted_apy_30d?: number | null;
  weighted_momentum_7d_30d?: number | null;
  riser_ratio?: number | null;
  faller_ratio?: number | null;
};
