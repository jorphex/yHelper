type ApiQueryValue = string | number | boolean | null | undefined;
type ApiQuery = URLSearchParams | Record<string, ApiQueryValue>;

function normalizeBase(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  return /^(?:https?:\/)?\//.test(raw) ? base : `https://${base}`;
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
  const params = toSearchParams(query)?.toString();
  return params ? `${url}${url.includes("?") ? "&" : "?"}${params}` : url;
}

const PUBLIC_API_BASE = normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL || "/api");
const INTERNAL_API_BASE = normalizeBase(process.env.YHELPER_API_INTERNAL_URL || "http://yhelper-api:8000");

export function apiUrl(path: string, query?: ApiQuery): string {
  return appendQuery(`${PUBLIC_API_BASE}${normalizeApiPath(path)}`, query);
}

export function internalApiUrl(path: string, query?: ApiQuery): string {
  return appendQuery(`${INTERNAL_API_BASE}/api${normalizeApiPath(path)}`, query);
}
