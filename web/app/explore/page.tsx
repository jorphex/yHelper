import { Suspense } from "react";
import { VaultResearchView } from "./research-view";

export default function ExplorePage() {
  return <Suspense fallback={<div className="page-loading">Loading vaults…</div>}><VaultResearchView /></Suspense>;
}
