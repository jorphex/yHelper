import { shortVaultLabel, yearnVaultUrl } from "../lib/format";

export function VaultLink({
  chainId,
  vaultAddress,
  symbol,
}: {
  chainId: number;
  vaultAddress: string;
  symbol: string | null | undefined;
}) {
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
    </a>
  );
}
