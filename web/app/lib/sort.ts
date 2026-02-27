export type SortDirection = "asc" | "desc";

export type SortState<K extends string> = {
  key: K;
  direction: SortDirection;
};

export type SortableValue = string | number | boolean | null | undefined;

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

function compareValues(a: SortableValue, b: SortableValue): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return collator.compare(String(a), String(b));
}

export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  getters: Record<K, (row: T) => SortableValue>,
): T[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  const getter = getters[sort.key];
  return [...rows].sort((left, right) => compareValues(getter(left), getter(right)) * dir);
}

export function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) {
    return { key, direction: "desc" };
  }
  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

export function sortIndicator<K extends string>(sort: SortState<K>, key: K): string {
  if (sort.key !== key) {
    return "↕";
  }
  return sort.direction === "asc" ? "↑" : "↓";
}

