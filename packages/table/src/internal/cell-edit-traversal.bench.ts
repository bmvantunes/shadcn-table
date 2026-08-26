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
    editable: rowIndex === 0 || rowIndex === rowCount - 1,
  }),
);
const rowsById = new Map(rows.map((row) => [row.id, row]));
const stablePredicate = ({ row }: { readonly row: Row }) => row.editable;
const changedPredicate = ({ row }: { readonly row: Row }) => !row.editable;
const compilePredicateColumns = (firstPredicate = stablePredicate) =>
  compileColumns(
    Array.from({ length: columnCount }, (_unused, columnIndex) => ({
      columnId: `COL_ID_EDIT_${String(columnIndex).padStart(3, "0")}`,
      field: "editable" as const,
      headerName: `Editable ${String(columnIndex)}`,
      valueType: "boolean" as const,
      isEditable: columnIndex === 0 ? firstPredicate : stablePredicate,
    })),
  );
const columns = compilePredicateColumns();
const equivalentColumns = compilePredicateColumns();
const changedAuthorityColumns = compilePredicateColumns(changedPredicate);
const rowSpace = Object.freeze({
  totalRows: rowCount,
  getRowId: (rowIndex: number) => rows[rowIndex]?.id,
});
function createIndex(onPredicateEvaluation?: () => void) {
  const created = new BrunoTableCellEditTraversalIndex(
    (rowId) => rowsById.get(rowId),
    (_rowId: string, row: object, _column: CompiledFieldColumn) => {
      onPredicateEvaluation?.();
      return (row as Row).editable;
    },
  );
  created.reconcile(columns, rowSpace);
  return created;
}
const traversalIndex = createIndex();
let reconciliationPredicateEvaluations = 0;
const reconciliationIndex = createIndex(() => {
  reconciliationPredicateEvaluations += 1;
});
reconciliationPredicateEvaluations = 0;
let authorityPredicateEvaluations = 0;
const authorityIndex = createIndex(() => {
  authorityPredicateEvaluations += 1;
});
authorityPredicateEvaluations = 0;
const rangeIndex = createIndex();
const forwardRowIds = rows.map((row) => row.id);
const reverseRowIds = forwardRowIds.toReversed();
const forwardRowSpace = Object.freeze({
  totalRows: rowCount,
  getRowId: (rowIndex: number) => forwardRowIds[rowIndex],
});
const reverseRowSpace = Object.freeze({
  totalRows: rowCount,
  getRowId: (rowIndex: number) => reverseRowIds[rowIndex],
});
const verticalRange = Object.freeze({
  axis: "vertical" as const,
  columnId: columns[0]!.columnId,
  rowIds: Object.freeze(forwardRowIds),
});
const horizontalRange = Object.freeze({
  axis: "horizontal" as const,
  rowId: rows.at(-1)!.id,
  columnIds: Object.freeze(columns.map((column) => column.columnId)),
});

function percentile99(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
}

describe("BrunoTable editable traversal index benchmark (8.33 ms/120 Hz reference)", () => {
  const samples: number[] = [];
  const reconciliationSamples: number[] = [];
  const rangeSamples: number[] = [];
  const horizontalRangeSamples: number[] = [];
  const equivalentAuthoritySamples: number[] = [];
  const changedAuthoritySamples: number[] = [];

  afterAll(() => {
    const assertSamples = (name: string, values: readonly number[]): number => {
      if (values.length === 0) return 0;
      const p99Ms = percentile99(values);
      if (values.length !== 100 || p99Ms > referenceFrameBudgetMs) {
        throw new Error(
          `${name} produced ${String(values.length)} samples with p99 ${String(p99Ms)} ms.`,
        );
      }
      return p99Ms;
    };
    const traversalP99Ms = assertSamples("far traversal", samples);
    const reconciliationP99Ms = assertSamples("projection reconciliation", reconciliationSamples);
    const rangeP99Ms = assertSamples("vertical range traversal", rangeSamples);
    const horizontalRangeP99Ms = assertSamples(
      "horizontal range traversal",
      horizontalRangeSamples,
    );
    const equivalentAuthorityP99Ms = assertSamples(
      "equivalent predicate-authority reconciliation",
      equivalentAuthoritySamples,
    );
    const changedAuthorityP99Ms = assertSamples(
      "changed predicate-authority reconciliation",
      changedAuthoritySamples,
    );
    console.log(
      JSON.stringify({
        benchmark: "BrunoTable exact editable traversal index",
        referenceFrameBudgetMs,
        rowCount,
        columnCount,
        traversalP99Ms,
        reconciliationP99Ms,
        rangeP99Ms,
        horizontalRangeP99Ms,
        equivalentAuthorityP99Ms,
        changedAuthorityP99Ms,
        traversalP99WithinReference: traversalP99Ms <= referenceFrameBudgetMs,
      }),
    );
  });

  bench(
    "finds far forward, reverse, and terminal destinations across 750,000 predicate cells",
    () => {
      const startedAt = performance.now();
      const forward = traversalIndex.find(0, columns.at(-1)!.columnId, 1);
      const reverse = traversalIndex.find(rowCount - 1, columns[0]!.columnId, -1);
      const terminal = traversalIndex.find(rowCount - 1, columns.at(-1)!.columnId, 1);
      samples.push(performance.now() - startedAt);
      if (forward?.rowIndex !== rowCount - 1 || reverse?.rowIndex !== 0 || terminal !== undefined) {
        throw new Error("Unexpected editable traversal result.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    "reconciles an equivalent 5,000 by 150 recompile without predicate callbacks",
    () => {
      authorityPredicateEvaluations = 0;
      const startedAt = performance.now();
      authorityIndex.reconcile(equivalentColumns, forwardRowSpace);
      equivalentAuthoritySamples.push(performance.now() - startedAt);
      if (authorityPredicateEvaluations !== 0) {
        throw new Error("Equivalent predicate authority revisited cached evidence.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  let changedAuthority = false;
  bench(
    "reevaluates only one 5,000-row predicate after its authority changes",
    () => {
      authorityPredicateEvaluations = 0;
      const startedAt = performance.now();
      authorityIndex.reconcile(
        changedAuthority ? equivalentColumns : changedAuthorityColumns,
        forwardRowSpace,
      );
      changedAuthoritySamples.push(performance.now() - startedAt);
      changedAuthority = !changedAuthority;
      if (authorityPredicateEvaluations !== rowCount) {
        throw new Error("Changed predicate authority did not perform bounded row work.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  let reversed = false;
  bench(
    "remaps a sorted or filtered 5,000-row projection without revisiting 750,000 predicates",
    () => {
      reconciliationPredicateEvaluations = 0;
      const startedAt = performance.now();
      reconciliationIndex.reconcileRows(undefined);
      reconciliationIndex.reconcile(columns, reversed ? forwardRowSpace : reverseRowSpace);
      reconciliationSamples.push(performance.now() - startedAt);
      reversed = !reversed;
      if (reconciliationPredicateEvaluations !== 0) {
        throw new Error("Projection remapping revisited cached predicate evidence.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  rangeIndex.reconcile(columns, forwardRowSpace);
  rangeIndex.findRange(verticalRange, rows.at(-1)!.id, columns[0]!.columnId, 1);
  bench(
    "cycles a cached 5,000-row vertical editable range exactly",
    () => {
      const startedAt = performance.now();
      const destination = rangeIndex.findRange(
        verticalRange,
        rows.at(-1)!.id,
        columns[0]!.columnId,
        1,
      );
      rangeSamples.push(performance.now() - startedAt);
      if (destination?.rowId !== rows[0]!.id) {
        throw new Error("Unexpected vertical range traversal result.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    "cycles a 150-column horizontal editable range exactly",
    () => {
      const startedAt = performance.now();
      const destination = rangeIndex.findRange(
        horizontalRange,
        rows.at(-1)!.id,
        columns[0]!.columnId,
        1,
      );
      horizontalRangeSamples.push(performance.now() - startedAt);
      if (destination?.columnId !== columns[1]!.columnId) {
        throw new Error("Unexpected horizontal range traversal result.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
