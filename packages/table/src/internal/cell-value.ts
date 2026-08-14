import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableRuntimeValue } from "./runtime-value";

interface RuntimeRowObject {
  readonly [key: string]: BrunoTableRuntimeValue;
}

export function readCompiledColumnValue<TRow>(
  column: CompiledColumn,
  row: TRow,
): BrunoTableRuntimeValue {
  if (column.kind === "field") return readField(row, column.field);

  const dependencies = Object.fromEntries(
    column.fields.map((field) => [field, readField(row, field)] as const),
  );
  const valueGetter = column.valueGetter;
  return valueGetter({ row: dependencies });
}

function readField<TRow>(row: TRow, field: string): BrunoTableRuntimeValue {
  if (row === null || row === undefined) {
    throw new TypeError("BrunoTable cannot read a column field from a nullish row.");
  }
  const objectRow: RuntimeRowObject = Object(row);
  return objectRow[field];
}
