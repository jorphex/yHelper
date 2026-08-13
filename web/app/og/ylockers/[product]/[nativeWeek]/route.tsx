import { NextResponse } from "next/server";
import { internalApiUrl } from "../../../../lib/api";
import { renderYlockerCycleImage, YlockerCycleImageData } from "../../../../lib/ylocker-cycle-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CycleResponse = { cycle?: YlockerCycleImageData };

export async function GET(_request: Request, { params }: { params: { product: string; nativeWeek: string } }) {
  if (!/^(ycrv|yyb)$/.test(params.product) || !/^\d+$/.test(params.nativeWeek)) {
    return NextResponse.json({ detail: "Image not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  let source: Response;
  try {
    source = await fetch(internalApiUrl(`/ylockers/rewards/${params.product}/cycles/${params.nativeWeek}`), { cache: "no-store" });
  } catch {
    return NextResponse.json({ detail: "Image source unavailable" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } });
  }
  if (!source.ok) {
    const status = source.status === 409 ? 409 : source.status === 404 ? 404 : 503;
    return NextResponse.json({ detail: status === 409 ? "Cycle is not finalized" : "Image not available" }, { status, headers: { "cache-control": "no-store", ...(status >= 500 || status === 409 ? { "retry-after": "60" } : {}) } });
  }
  const payload = await source.json() as CycleResponse;
  if (!payload.cycle) {
    return NextResponse.json({ detail: "Image source unavailable" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } });
  }
  const response = await renderYlockerCycleImage(payload.cycle);
  response.headers.set("content-type", "image/png");
  response.headers.set("cache-control", "public, max-age=31536000, immutable");
  response.headers.set("content-disposition", "inline");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
