import type { ReadonlyURLSearchParams, useRouter } from "next/navigation";

export function queryChoice<T extends string>(
  params: ReadonlyURLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = params.get(key);
  if (!raw) return fallback;
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function queryInt<Fallback extends number | null>(
  params: ReadonlyURLSearchParams,
  key: string,
  fallback: Fallback,
  opts?: { min?: number; max?: number },
): number | Fallback {
  const raw = params.get(key)?.trim();
  if (!raw || !/^[+-]?\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return fallback;
  if (opts?.min !== undefined && value < opts.min) return fallback;
  if (opts?.max !== undefined && value > opts.max) return fallback;
  return value;
}

export function queryString(params: ReadonlyURLSearchParams, key: string, fallback = ""): string {
  const raw = params.get(key);
  return raw ? raw.trim() : fallback;
}

export function replaceQuery(
  pathname: string,
  params: ReadonlyURLSearchParams,
  updates: Record<string, string | number | null | undefined>,
  router?: ReturnType<typeof useRouter>,
): void {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      next.delete(key);
      continue;
    }
    next.set(key, String(value));
  }
  const query = next.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  if (router) router.replace(href, { scroll: false });
  else window.history.replaceState(null, "", href);
}
