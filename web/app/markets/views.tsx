"use client";

import { useSearchParams } from "next/navigation";
import ExplorePage from "../explore/page";
import MomentumPage from "../momentum/page";

export function MarketsViews() {
  const searchParams = useSearchParams();
  return searchParams.get("view") === "changes" ? <MomentumPage /> : <ExplorePage />;
}
