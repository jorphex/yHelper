import { redirect } from "next/navigation";

export default function StructureRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tab" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else params.set(key, value);
  }
  params.set("tab", "structure");
  redirect(`/explore?${params.toString()}`);
}
