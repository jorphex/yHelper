export function vaultDetailUrl(chainId: number, address: string, returnTo: string): string {
  const query = new URLSearchParams({ from: returnTo });
  return `/markets/vault/${chainId}/${address.toLowerCase()}?${query}`;
}

export function vaultReturnUrl(raw: string | null): string {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return "/markets?view=vaults";
  try {
    const url = new URL(raw, "https://yhelper.invalid");
    if (url.origin === "https://yhelper.invalid" && ["/markets", "/explore"].includes(url.pathname)) {
      return url.pathname + url.search;
    }
  } catch { /* Keep malformed return URLs inside vault research. */ }
  return "/markets?view=vaults";
}
