import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReadonlyURLSearchParams } from "next/navigation";

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

export function queryInt(
  params: ReadonlyURLSearchParams,
  key: string,
  fallback: number,
  opts?: { min?: number; max?: number },
): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  if (opts?.min !== undefined && value < opts.min) return fallback;
  if (opts?.max !== undefined && value > opts.max) return fallback;
  return value;
}

export function queryFloat(
  params: ReadonlyURLSearchParams,
  key: string,
  fallback: number,
  opts?: { min?: number; max?: number },
): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  if (opts?.min !== undefined && value < opts.min) return fallback;
  if (opts?.max !== undefined && value > opts.max) return fallback;
  return value;
}

export function queryString(params: ReadonlyURLSearchParams, key: string, fallback = ""): string {
  const raw = params.get(key);
  return raw ? raw.trim() : fallback;
}

export function queryBool(params: ReadonlyURLSearchParams, key: string, fallback = false): boolean {
  const raw = params.get(key);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

export function replaceQuery(
  router: AppRouterInstance,
  pathname: string,
  params: ReadonlyURLSearchParams,
  updates: Record<string, string | number | null | undefined>,
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
  router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
}
