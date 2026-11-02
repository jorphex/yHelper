import type { Metadata } from "next";
import { Suspense } from "react";
import { VaultDetail } from "../../../vault-detail";

export const metadata: Metadata = { title: "Vault performance", description: "Yearn vault yield, share price and TVL history." };

export default function VaultPage({ params }: { params: { chainId: string; address: string } }) {
  return <Suspense fallback={<div className="page-loading">Loading vault…</div>}><VaultDetail chainId={Number(params.chainId)} address={params.address} /></Suspense>;
}
