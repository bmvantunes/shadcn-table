import { afterAll, bench, describe } from "vite-plus/test";

import { compileColumns, type CompiledFieldColumn } from "./compile-columns";
import { BrunoTableCellEditTraversalIndex } from "./cell-edit-traversal";

const referenceFrameBudgetMs = 8.33;
const rowCount = 5_000;
const columnCount = 150;
type Row = Readonly<{ readonly id: string; readonly editable: boolean }>;
const rows = Array.from(
  { length: rowCount },
  (_unused, rowIndex): Row => ({
    id: `row-${String(rowIndex)}`,
    editable: rowIndex === rowCount - 1,
  }),
);
const rowsById = new Map(rows.map((row) => [row.id, row]));
const columns = compileColumns(
  Array.from({ length: columnCount }, (_unused, columnIndex) => ({
    columnId: `COL_ID_EDIT_${String(columnIndex).padStart(3, "0")}`,
    field: "editable" as const,
    headerName: `Editable ${String(columnIndex)}`,
    valueType: "boolean" as const,
    isEditable: ({ row }: { readonly row: Row }) => row.editable,
  })),
);
const rowSpace = Object.freeze({
  totalRows: rowCount,
  getRowId: (rowIndex: number) => rows[rowIndex]?.id,
});
const index = new BrunoTableCellEditTraversalIndex(
  (rowId) => rowsById.get(rowId),
  () => 0,
  (_rowId: string, row: object, _column: CompiledFieldColumn) => (row as Row).editable,
);
index.reconcile(columns, rowSpace);

function percentile99(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
}

describe("BrunoTable editable traversal index benchmark (8.33 ms/120 Hz reference)", () => {
  const samples: number[] = [];

  afterAll(() => {
    const traversalP99Ms = percentile99(samples);
    if (samples.length !== 100 || traversalP99Ms > referenceFrameBudgetMs) {
      throw new Error("The editable traversal index missed its sample count or frame budget.");
    }
    console.log(
      JSON.stringify({
        benchmark: "BrunoTable exact editable traversal index",
        referenceFrameBudgetMs,
        rowCount,
        columnCount,
        traversalP99Ms,
        traversalP99WithinReference: traversalP99Ms <= referenceFrameBudgetMs,
      }),
    );
  });

  bench(
    "finds far forward, reverse, and terminal destinations across 750,000 predicate cells",
    () => {
      const startedAt = performance.now();
      const forward = index.find(0, columns[0]!.columnId, 1);
      const reverse = index.find(rowCount - 1, columns.at(-1)!.columnId, -1);
      const terminal = index.find(rowCount - 1, columns.at(-1)!.columnId, 1);
      samples.push(performance.now() - startedAt);
      if (
        forward?.rowIndex !== rowCount - 1 ||
        reverse?.rowIndex !== rowCount - 1 ||
        terminal !== undefined
      ) {
        throw new Error("Unexpected editable traversal result.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
