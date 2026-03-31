import { contentType, renderSocialImage, size } from "../lib/social-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const response = await renderSocialImage();
  response.headers.set("content-type", contentType);
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("x-image-width", String(size.width));
  response.headers.set("x-image-height", String(size.height));
  return response;
}
