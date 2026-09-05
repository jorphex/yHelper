import ExplorePage from "../explore/page";
import MomentumPage from "../momentum/page";
import { redirect } from "next/navigation";

export default function MarketsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const view = Array.isArray(searchParams.view) ? searchParams.view[0] : searchParams.view;
  const legacyCompare = view === "compare" || (!view && searchParams.tab === "venues");
  const legacyAssetFilter = searchParams.token !== undefined;
  if (legacyCompare || legacyAssetFilter) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "view" || key === "tab" || key === "token" || value === undefined) continue;
      params.set(key, Array.isArray(value) ? value[0] : value);
    }
    params.set("view", "vaults");
    redirect(`/markets?${params.toString()}`);
  }
  return view === "changes" ? <MomentumPage /> : <ExplorePage />;
}
