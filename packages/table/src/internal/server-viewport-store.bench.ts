import { afterAll, bench, describe } from "vite-plus/test";

import { BrunoTableServerViewportStore } from "./server-viewport-store";
import { compileColumns } from "./compile-columns";
import { BrunoTableServerRowPipelineAdapter } from "./server-source-adapter";

const referenceFrameBudgetMs = 8.33;
const virtualRowCount = 1_000_000;
const windowSize = 60;
const warmupIterations = 10;

function assertP99FrameBudget(label: string, samples: readonly number[]): void {
  const measured = samples.slice(warmupIterations).toSorted((left, right) => left - right);
  const p99 = measured[Math.max(0, Math.ceil(measured.length * 0.99) - 1)];
  if (p99 === undefined || p99 > referenceFrameBudgetMs) {
    throw new Error(
      `${label} p99 exceeded ${String(referenceFrameBudgetMs)} ms: ${String(p99)} ms.`,
    );
  }
}

const durationsMs: number[] = [];
const store = new BrunoTableServerViewportStore<Readonly<{ value: number }>>();
const generation = store.beginGeneration({ firstRow: 0, lastRow: windowSize - 1 });
store.setRowCount(generation, virtualRowCount, true);
let iteration = 0;

describe("BrunoTable sparse Server viewport benchmark (8.33 ms/120 Hz reference)", () => {
  afterAll(() => {
    assertP99FrameBudget("Sparse Server window publication", durationsMs);
  });

  bench(
    "moves and publishes a realistic sparse window inside a million-row logical space",
    () => {
      iteration += 1;
      const firstRow = (iteration * 7919) % (virtualRowCount - windowSize);
      const lastRow = firstRow + windowSize - 1;
      const rows: Record<number, Readonly<{ value: number }>> = {};
      const keys: Record<number, string> = {};
      for (let index = firstRow; index <= lastRow; index += 1) {
        rows[index] = Object.freeze({ value: index });
        keys[index] = `server-row-${String(index)}`;
      }
      const startedAt = performance.now();
      store.setRequiredRange(generation, { firstRow, lastRow });
      store.setRowData(generation, rows, keys);
      durationsMs.push(performance.now() - startedAt);
      if (store.getSnapshot().rowSpace.totalRows !== virtualRowCount) {
        throw new Error("Sparse publication changed the authoritative logical row count.");
      }
      if (store.getSnapshot().rowSpace.loadedRows > windowSize) {
        throw new Error("Sparse publication retained rows outside the active window.");
      }
    },
    { iterations: 100, time: 0, warmupIterations, warmupTime: 0 },
  );
});

const adapterDurationsMs: number[] = [];
const adapterColumns = compileColumns([
  {
    columnId: "COL_ID_VALUE",
    field: "value",
    headerName: "Value",
    valueType: "number",
  },
]);
let adapterSink:
  | Readonly<{
      readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
      readonly setRowData: (
        rows: Readonly<Record<number, Readonly<{ value: number }>>>,
        keys: Readonly<Record<number, string>>,
      ) => void;
    }>
  | undefined;
let setWindowCalls = 0;
let replaceCalls = 0;
let publicationNotifications = 0;
const adapter = new BrunoTableServerRowPipelineAdapter<Readonly<{ value: number }>>(
  adapterColumns,
  undefined,
  [],
  [{ columnId: "COL_ID_VALUE", direction: "asc" }],
);
const adapterViewport = {
  replace(request: Readonly<{ readonly sink: NonNullable<typeof adapterSink> }>) {
    replaceCalls += 1;
    adapterSink = request.sink;
    return {
      setWindow: () => {
        setWindowCalls += 1;
      },
      release: () => undefined,
    };
  },
};
adapter.subscribePublication(() => {
  publicationNotifications += 1;
});
adapter.reconcileSource({
  viewport: adapterViewport,
  completeRawSelect: ["value"],
  totalRows: 0,
  version: 0,
  status: "ready",
});
adapter.replace(adapterViewport, {
  generation: 0,
  navigationMode: "reconcile",
  filters: [],
  quickFilter: "",
  orderBy: [{ columnId: "COL_ID_VALUE", direction: "asc" }],
});
adapterSink!.setRowCount(virtualRowCount, true);
let adapterIteration = 0;

describe("BrunoTable Server adapter publication benchmark", () => {
  afterAll(() => {
    assertP99FrameBudget("Server adapter 20 Hz publication", adapterDurationsMs);
    if (replaceCalls !== 1 || setWindowCalls !== adapterIteration) {
      throw new Error("Server adapter replaced a semantic generation during window-only work.");
    }
    if (publicationNotifications > adapterIteration * 2 + 2) {
      throw new Error("Server adapter exceeded the bounded coherent publication count.");
    }
  });

  bench(
    "moves, reveals, and accepts 20 Hz-style sparse source batches",
    () => {
      adapterIteration += 1;
      const firstRow = (adapterIteration * 6151) % (virtualRowCount - windowSize);
      const rows: Record<number, Readonly<{ value: number }>> = {};
      const keys: Record<number, string> = {};
      for (let index = firstRow; index < firstRow + windowSize; index += 1) {
        rows[index] = Object.freeze({ value: index });
        keys[index] = `adapter-row-${String(index)}`;
      }
      const startedAt = performance.now();
      adapter.setRequiredRange(firstRow, firstRow + windowSize);
      adapterSink!.setRowData(rows, keys);
      adapterDurationsMs.push(performance.now() - startedAt);
      const rowSpace = adapter.getPublication().rowSpace;
      if (rowSpace === undefined || rowSpace.loadedRows > windowSize) {
        throw new Error("Server adapter exceeded its bounded sparse window.");
      }
    },
    { iterations: 100, time: 0, warmupIterations, warmupTime: 0 },
  );
});

const equivalenceColumnCount = 40;
const equivalenceColumns = compileColumns(
  Array.from({ length: equivalenceColumnCount }, (_, index) => ({
    columnId: `COL_ID_VALUE_${String(index)}`,
    field: `value${String(index)}`,
    headerName: `Value ${String(index)}`,
    valueType: "number" as const,
  })),
);
type EquivalenceRow = Readonly<Record<string, number>>;
let equivalenceSink:
  | Readonly<{
      readonly setRowData: (
        rows: Readonly<Record<number, EquivalenceRow>>,
        keys: Readonly<Record<number, string>>,
      ) => void;
    }>
  | undefined;
const equivalenceAdapter = new BrunoTableServerRowPipelineAdapter<EquivalenceRow>(
  equivalenceColumns,
  undefined,
  [],
  [{ columnId: "COL_ID_VALUE_0", direction: "asc" }],
);
const equivalenceViewport = {
  replace(request: Readonly<{ readonly sink: NonNullable<typeof equivalenceSink> }>) {
    equivalenceSink = request.sink;
    return { setWindow: () => undefined, release: () => undefined };
  },
};
equivalenceAdapter.reconcileSource({
  viewport: equivalenceViewport,
  completeRawSelect: [
    "value0",
    ...Array.from(
      { length: equivalenceColumnCount - 1 },
      (_, index) => `value${String(index + 1)}`,
    ),
  ],
  totalRows: 0,
  version: 0,
  status: "ready",
});
equivalenceAdapter.replace(equivalenceViewport, {
  generation: 0,
  navigationMode: "reconcile",
  filters: [],
  quickFilter: "",
  orderBy: [{ columnId: "COL_ID_VALUE_0", direction: "asc" }],
});
const equivalenceKeys: Record<number, string> = {};
const firstEquivalenceRows: Record<number, EquivalenceRow> = {};
for (let rowIndex = 0; rowIndex < windowSize; rowIndex += 1) {
  equivalenceKeys[rowIndex] = `equivalent-row-${String(rowIndex)}`;
  firstEquivalenceRows[rowIndex] = Object.freeze(
    Object.fromEntries(
      Array.from({ length: equivalenceColumnCount }, (_, columnIndex) => [
        `value${String(columnIndex)}`,
        rowIndex * equivalenceColumnCount + columnIndex,
      ]),
    ),
  );
}
equivalenceAdapter.setRequiredRange(0, windowSize);
equivalenceSink!.setRowData(firstEquivalenceRows, equivalenceKeys);
const retainedEquivalenceRows = Object.freeze(
  Object.fromEntries(
    Object.values(equivalenceKeys).map((rowId) => [
      rowId,
      equivalenceAdapter.getPublication().rowSpace!.getRow(rowId),
    ]),
  ),
);
for (const rowId of Object.values(equivalenceKeys)) {
  if (retainedEquivalenceRows[rowId] === undefined) {
    throw new Error(`Equivalence benchmark setup did not admit row ${rowId}.`);
  }
}
const equivalenceDurationsMs: number[] = [];

describe("BrunoTable Server repeated equivalent publication benchmark", () => {
  afterAll(() => {
    assertP99FrameBudget("Server equivalent-row publication", equivalenceDurationsMs);
  });

  bench(
    "retains references for fresh equivalent 40-column rows at 20 Hz-style cadence",
    () => {
      const freshRows: Record<number, EquivalenceRow> = {};
      for (let rowIndex = 0; rowIndex < windowSize; rowIndex += 1) {
        freshRows[rowIndex] = Object.freeze({ ...firstEquivalenceRows[rowIndex]! });
      }
      const startedAt = performance.now();
      equivalenceSink!.setRowData(freshRows, equivalenceKeys);
      equivalenceDurationsMs.push(performance.now() - startedAt);
      const rowSpace = equivalenceAdapter.getPublication().rowSpace!;
      for (const rowId of Object.values(equivalenceKeys)) {
        if (rowSpace.getRow(rowId) !== retainedEquivalenceRows[rowId]) {
          throw new Error("Equivalent source delivery replaced a stable row reference.");
        }
      }
    },
    { iterations: 100, time: 0, warmupIterations, warmupTime: 0 },
  );
});
