import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const FORCE_HTTPS_HOST = "yhelper.seul.one";

function visitorScheme(request: NextRequest): "http" | "https" | null {
  const cfVisitor = request.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme === "http" || parsed.scheme === "https") {
        return parsed.scheme;
      }
    } catch {
      // ignore parse errors and continue to fallback headers
    }
  }

  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first === "http" || first === "https") {
      return first;
    }
  }
  return null;
}

function requestHost(request: NextRequest): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const raw = (forwardedHost || request.headers.get("host") || "").trim().toLowerCase();
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;
  const withoutPort = first.includes(":") ? first.split(":")[0] : first;
  return withoutPort || null;
}

export function middleware(request: NextRequest) {
  const host = requestHost(request);
  if (host !== FORCE_HTTPS_HOST) {
    return NextResponse.next();
  }

  const scheme = visitorScheme(request);
  if (scheme === "http") {
    const secureUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${FORCE_HTTPS_HOST}`);
    return NextResponse.redirect(secureUrl, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
