import { formatUtcDateTime } from "../lib/format";

export type SourceFreshness = {
  state: "ready" | "delayed" | "unknown";
  refreshed_at?: string | null;
};

export type StakingSourceState = {
  source_state?: "ready" | "delayed" | "unknown";
  yfi_price_state?: "ready" | "delayed" | "unknown";
};

export function VaultSourceNote({ source }: { source?: SourceFreshness | null }) {
  if (!source || source.state === "ready") return null;
  return <p className="section-note" role="status">{source.state === "delayed"
    ? `Vault data delayed${source.refreshed_at ? `. Last source update ${formatUtcDateTime(source.refreshed_at)}` : "."}`
    : "Vault source update time unavailable."}</p>;
}

export function StakingSourceNote({ state }: { state?: StakingSourceState | null }) {
  const message = state?.source_state === "delayed" ? "Reward data is delayed."
    : state?.source_state === "unknown" ? "Reward update time unavailable."
    : state?.yfi_price_state === "delayed" ? "APR uses a delayed YFI price."
    : state?.yfi_price_state === "unknown" ? "YFI price update time unavailable." : null;
  return message ? <p className="section-note" role="status">{message}</p> : null;
}
