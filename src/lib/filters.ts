export type JournalFilters = {
  query: string;
  years: number[];
  tags: string[];
};

function unique<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function readFilters(params: URLSearchParams): JournalFilters {
  return {
    query: params.get("q") ?? "",
    years: unique(
      (params.get("year") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
    tags: unique(
      (params.get("tag") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export function sameList<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
