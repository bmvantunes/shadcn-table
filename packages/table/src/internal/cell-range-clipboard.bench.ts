import { afterAll, bench, describe } from "vite-plus/test";

import {
  BrunoTableCellRangeRuntime,
  captureBrunoTableClipboardSnapshot,
  createBrunoTableCellRangeStructure,
  serializeBrunoTableClipboardSnapshot,
  type BrunoTableClipboardTarget,
} from "./cell-range-clipboard";

const referenceFrameBudgetMs = 8.33;
const copyResponsivenessBudgetMs = 50;
const residentRows = 10_000;
const logicalColumns = 240;
const rowIds = Object.freeze(
  Array.from({ length: residentRows }, (_unused, index) => `ROW_${String(index)}`),
);
const columnIds = Object.freeze(
  Array.from({ length: logicalColumns }, (_unused, index) => `COL_ID_${String(index)}`),
);
const structure = createBrunoTableCellRangeStructure(rowIds, columnIds);
const range = new BrunoTableCellRangeRuntime("TABLE_ID_CELL_RANGE_BENCH");
range.replace({ rowId: rowIds[0]!, columnId: columnIds[0]! }, structure);
let publications = 0;
range.subscribe(() => {
  publications += 1;
});
const valuePublicationDurationsMs: number[] = [];
const extensionDurationsMs: number[] = [];
const snapshotDurationsMs: number[] = [];
const largeSpanMembershipDurationsMs: number[] = [];
const largeSpanRows = Object.freeze(
  Array.from({ length: 100_000 }, (_unused, index) => `LARGE_ROW_${String(index)}`),
);
const largeSpanStructure = createBrunoTableCellRangeStructure(largeSpanRows, [columnIds[0]!]);
const largeSpanRange = new BrunoTableCellRangeRuntime("TABLE_ID_CELL_RANGE_MEMBERSHIP_BENCH");
largeSpanRange.replace({ rowId: largeSpanRows[0]!, columnId: columnIds[0]! }, largeSpanStructure);
largeSpanRange.extend(
  { rowId: largeSpanRows.at(-1)!, columnId: columnIds[0]! },
  largeSpanStructure,
  "vertical",
);

describe("BrunoTable Cell Range benchmark (8.33 ms/120 Hz reference)", () => {
  afterAll(() => {
    const valuePublicationP99Ms = percentile99(valuePublicationDurationsMs);
    const extensionP99Ms = percentile99(extensionDurationsMs);
    const snapshotP99Ms = percentile99(snapshotDurationsMs);
    const largeSpanMembershipP99Ms = percentile99(largeSpanMembershipDurationsMs);
    process.stdout.write(
      `${JSON.stringify({
        benchmark: "BrunoTable Cell Range and atomic Copy",
        residentRows,
        logicalColumns,
        publications,
        valuePublicationP99Ms,
        extensionP99Ms,
        snapshotP99Ms,
        largeSpanMembershipP99Ms,
        referenceFrameBudgetMs,
        copyResponsivenessBudgetMs,
      })}\n`,
    );
    if (publications !== extensionDurationsMs.length) {
      throw new Error("Value-only reconciliation published Cell Range state.");
    }
    if (
      valuePublicationP99Ms > referenceFrameBudgetMs ||
      extensionP99Ms > referenceFrameBudgetMs ||
      largeSpanMembershipP99Ms > referenceFrameBudgetMs
    ) {
      throw new Error("Cell Range hot-path work exceeded the 120 Hz reference frame budget.");
    }
    if (snapshotP99Ms > copyResponsivenessBudgetMs) {
      throw new Error("Cell Range immutable Copy exceeded its responsiveness budget.");
    }
  });

  bench(
    "retains the exact range for value-only publications without notifications",
    () => {
      const startedAt = performance.now();
      range.reconcile(structure);
      valuePublicationDurationsMs.push(performance.now() - startedAt);
    },
    { iterations: 100, time: 0, warmupIterations: 10, warmupTime: 0 },
  );

  bench(
    "decorates 400 mounted cells across a 100,000-row span with constant-time membership",
    () => {
      const startedAt = performance.now();
      for (let mountedIndex = 0; mountedIndex < 400; mountedIndex += 1) {
        const rowId = largeSpanRows[mountedIndex * 250];
        if (rowId === undefined || !largeSpanRange.isCellSelected(rowId, columnIds[0]!)) {
          throw new Error("Expected every sampled mounted cell to remain selected.");
        }
      }
      largeSpanMembershipDurationsMs.push(performance.now() - startedAt);
    },
    { iterations: 100, time: 0, warmupIterations: 10, warmupTime: 0 },
  );

  let destination = residentRows - 1;
  bench(
    "projects one vertical gesture over 10,000 identities with one publication",
    () => {
      range.replace({ rowId: rowIds[0]!, columnId: columnIds[0]! }, structure);
      publications -= 1;
      const startedAt = performance.now();
      range.extend({ rowId: rowIds[destination]!, columnId: columnIds[0]! }, structure, "vertical");
      extensionDurationsMs.push(performance.now() - startedAt);
      destination = destination === residentRows - 1 ? residentRows - 2 : residentRows - 1;
    },
    { iterations: 100, time: 0, warmupIterations: 10, warmupTime: 0 },
  );

  const copyTarget: BrunoTableClipboardTarget = {
    axis: "vertical",
    rowIds: [rowIds[0]!, ...rowIds.slice(1)],
    columnIds: [columnIds[0]!],
  };
  bench(
    "captures and serializes one immutable 10,000-cell vertical Clipboard Snapshot",
    () => {
      const startedAt = performance.now();
      const snapshot = captureBrunoTableClipboardSnapshot(copyTarget, ({ rowId }) => ({
        value: BigInt(rowId.slice("ROW_".length)) + 9_007_199_254_740_993n,
        formatCanonicalText: String,
      }));
      if (snapshot === undefined) throw new Error("Expected a complete Clipboard Snapshot.");
      serializeBrunoTableClipboardSnapshot(snapshot);
      snapshotDurationsMs.push(performance.now() - startedAt);
    },
    { iterations: 100, time: 0, warmupIterations: 10, warmupTime: 0 },
  );
});

function percentile99(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
}
