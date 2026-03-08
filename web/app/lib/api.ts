type ApiQueryValue = string | number | boolean | null | undefined;
type ApiQuery = URLSearchParams | Record<string, ApiQueryValue>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function ensureAbsoluteUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return trimTrailingSlash(raw);
  if (raw.startsWith("/")) return trimTrailingSlash(raw);
  return `https://${trimTrailingSlash(raw)}`;
}

function normalizeApiPath(path: string): string {
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

function toSearchParams(query?: ApiQuery): URLSearchParams | null {
  if (!query) return null;
  if (query instanceof URLSearchParams) return query;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  return params;
}

function appendQuery(url: string, query?: ApiQuery): string {
  const params = toSearchParams(query);
  if (!params || [...params.keys()].length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${params.toString()}`;
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = ensureAbsoluteUrl(base);
  const normalizedPath = normalizeApiPath(path);
  if (normalizedBase === "") return normalizedPath;
  if (normalizedBase.startsWith("/")) {
    return `${normalizedBase}${normalizedPath}`;
  }
  return `${normalizedBase}${normalizedPath}`;
}

const PUBLIC_API_BASE = ensureAbsoluteUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "/api");
const INTERNAL_API_BASE = ensureAbsoluteUrl(process.env.YHELPER_API_INTERNAL_URL || "http://yhelper-api:8000");
const PUBLIC_SITE_BASE = ensureAbsoluteUrl(process.env.NEXT_PUBLIC_SITE_URL || "https://yhelper.app");

export function apiUrl(path: string, query?: ApiQuery): string {
  return appendQuery(joinUrl(PUBLIC_API_BASE, path), query);
}

export function internalApiUrl(path: string, query?: ApiQuery): string {
  return appendQuery(joinUrl(INTERNAL_API_BASE, `/api${normalizeApiPath(path)}`), query);
}

export function publicSiteApiUrl(path: string, query?: ApiQuery): string {
  return appendQuery(joinUrl(PUBLIC_SITE_BASE, `/api${normalizeApiPath(path)}`), query);
}
