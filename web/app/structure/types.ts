export type BreakdownRow = {
  chain_id?: number;
  category?: string;
  token_symbol?: string;
  vaults: number;
  tvl_usd: number | null;
  share_tvl?: number | null;
  weighted_realized_apy_30d?: number | null;
};
