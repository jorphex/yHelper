"use client";

import { useSearchParams } from "next/navigation";
import { VaultResearchView } from "../explore/research-view";
import { ChangesView } from "../momentum/view";

export function MarketsViews() {
  const searchParams = useSearchParams();
  return searchParams.get("view") === "changes" ? <ChangesView /> : <VaultResearchView />;
}
