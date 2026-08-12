import ExplorePage from "../explore/page";
import MomentumPage from "../momentum/page";

export default function MarketsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const view = Array.isArray(searchParams.view) ? searchParams.view[0] : searchParams.view;
  return view === "vaults" || view === "compare" || view === "structure"
    ? <ExplorePage />
    : <MomentumPage />;
}
