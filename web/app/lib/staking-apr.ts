import { formatPct } from "./format";

export type StakingAprState = {
  apr_state?: "ready" | "unavailable";
  styfi_base_apr?: number | null;
  styfi_max_apr?: number | null;
  styfix_current_apr?: number | null;
};

export function stakingAprRange(state?: StakingAprState | null): string {
  const base = state?.styfi_base_apr, max = state?.styfi_max_apr;
  if (state?.apr_state !== "ready" || base == null || max == null || !Number.isFinite(base) || !Number.isFinite(max) || max < base) return "Unavailable";
  return base === max ? formatPct(max, 2) : `${formatPct(base, 2).replace(/%$/, "")}–${formatPct(max, 2)}`;
}
