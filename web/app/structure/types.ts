import type { UniverseKind } from "../lib/universe";

export type TabKey = "overview" | "chains" | "crowding";
export type ChainSortKey = "chain" | "vaults" | "with_realized_apy" | "tvl" | "apy" | "momentum" | "consistency";
export type CategorySortKey = "category" | "vaults" | "tvl" | "share" | "apy";
export type TokenSortKey = "token" | "vaults" | "tvl" | "share" | "apy";
export type CrowdingSortKey = "vault" | "chain" | "token" | "category" | "tvl" | "apy" | "crowding";

export type BreakdownRow = {
  chain_id?: number;
  category?: string;
  token_symbol?: string;
  vaults: number;
  tvl_usd: number | null;
  share_tvl?: number | null;
  weighted_realized_apy_30d?: number | null;
};

export type CrowdingRow = {
  vault_address: string;
  chain_id: number;
  symbol: string | null;
  token_symbol: string | null;
  category: string | null;
  tvl_usd: number | null;
  realized_apy_30d: number | null;
  crowding_index: number | null;
};

export type StructureQuery = {
  universe: UniverseKind;
  minTvl: number;
  minPoints: number;
  tab: TabKey;
  topN: number;
  crowdingLimit: number;
};
