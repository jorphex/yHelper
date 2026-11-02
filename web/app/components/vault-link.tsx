import { shortVaultLabel, yearnVaultUrl } from "../lib/format";
import Link from "next/link";
import { vaultDetailUrl } from "../lib/vault-navigation";

export function ExternalArrow({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "inline-block", marginLeft: "3px", verticalAlign: "text-bottom", opacity: 0.6 }}
    >
      <path d="M3.5 8.5L8.5 3.5M5.25 3.5H8.5V6.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VaultLink({
  chainId,
  vaultAddress,
  symbol,
  returnTo,
}: {
  chainId: number;
  vaultAddress: string;
  symbol: string | null | undefined;
  returnTo?: string;
}) {
  if (returnTo) {
    return <Link href={vaultDetailUrl(chainId, vaultAddress, returnTo)} className="vault-link" title={vaultAddress}
      aria-label={`View ${shortVaultLabel(symbol, vaultAddress)} performance`}>{shortVaultLabel(symbol, vaultAddress)}</Link>;
  }
  return (
    <a
      href={yearnVaultUrl(chainId, vaultAddress)}
      target="_blank"
      rel="noopener noreferrer"
      className="vault-link"
      title={vaultAddress}
      aria-label={`Open ${shortVaultLabel(symbol, vaultAddress)} on Yearn`}
    >
      {shortVaultLabel(symbol, vaultAddress)}
      <ExternalArrow />
    </a>
  );
}
