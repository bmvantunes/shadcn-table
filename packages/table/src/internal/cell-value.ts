import type { CompiledColumn } from "./compile-columns";

export function readCompiledColumnValue(column: CompiledColumn, row: unknown): unknown {
  const record = asRecord(row);
  if (column.kind === "field") return record[column.field];

  const dependencies = Object.fromEntries(
    column.fields.map((field) => [field, record[field]] as const),
  );
  return Reflect.apply(column.valueGetter, undefined, [{ row: dependencies }]);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("BrunoTable Client Source rows must be object records.");
  }
  return value as Record<string, unknown>;
}
