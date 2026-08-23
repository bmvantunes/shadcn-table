export function brunoTableTestSemanticQueryKey(candidate: unknown): unknown {
  return JSON.stringify(candidate, (key, value: unknown) => {
    if (typeof value === "bigint") return `${value}n`;
    if (key === "select" && Array.isArray(value)) {
      return value.toSorted((left, right) => String(left).localeCompare(String(right)));
    }
    return value;
  });
}
