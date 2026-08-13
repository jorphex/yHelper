import { NextResponse } from "next/server";
import { pageSocialCopy, PageSocialSurface, renderPageSocialImage } from "../../lib/page-social-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { surface: string } }) {
  if (!(params.surface in pageSocialCopy)) {
    return NextResponse.json({ detail: "Image not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const response = await renderPageSocialImage(params.surface as PageSocialSurface);
  response.headers.set("content-type", "image/png");
  response.headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
