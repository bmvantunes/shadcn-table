import { bench, describe } from "vite-plus/test";

import { compileColumns } from "./compile-columns";
import { BrunoTableGridRuntime } from "./grid-runtime";
import type { BrunoTableRuntimeValue } from "./runtime-value";

type DiagnosticSamples = {
  resize: number[];
  reorder: number[];
  reset: number[];
};

const columnCount = 240;
const referenceFrameBudgetMs = 8.33;
const benchmarkColumns = compileColumns(
  Array.from({ length: columnCount }, (_unused, index) => ({
    columnId: `COL_ID_BENCH_${String(index).padStart(3, "0")}`,
    field: "name" as const,
    headerName: `Benchmark ${String(index)}`,
    valueType: "text" as const,
    width: 120,
  })),
);
const benchmarkPublication = {
  status: "ready" as const,
  totalRows: 10_000,
  version: 1,
  hasCoherentRows: true,
};
const benchmarkOrder = [{ columnId: benchmarkColumns[0]!.columnId, direction: "asc" as const }];

function createRuntime(tableId: string): BrunoTableGridRuntime<BrunoTableRuntimeValue> {
  return new BrunoTableGridRuntime(
    benchmarkPublication,
    benchmarkColumns,
    {
      baselineFilters: [],
      baselineOrderBy: benchmarkOrder,
    },
    tableId,
  );
}

function createDirtyResetRuntime(index: number): BrunoTableGridRuntime<BrunoTableRuntimeValue> {
  const runtime = createRuntime(`TABLE_ID_BENCH_RESET_${String(index)}`);
  runtime.dispatchGridCommand({
    type: "column.resize.commit",
    columnId: benchmarkColumns[0]!.columnId,
    width: 320,
  });
  runtime.dispatchGridCommand({
    type: "column.visibility.commit",
    columnId: benchmarkColumns[1]!.columnId,
    visible: false,
  });
  runtime.dispatchGridCommand({
    type: "column.pin.commit",
    columnId: benchmarkColumns[2]!.columnId,
    pinned: "start",
  });
  return runtime;
}

function percentile99(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
}

describe("BrunoTable column management runtime benchmark (8.33 ms/120 Hz reference)", () => {
  const resizeRuntime = createRuntime("TABLE_ID_BENCH_RESIZE");
  const reorderRuntime = createRuntime("TABLE_ID_BENCH_REORDER");
  // Keep a larger pool than the requested sample count because Tinybench may execute one
  // additional calibration iteration even with warmup disabled. Every measured sample still
  // receives a previously dirtied runtime and therefore performs a real reset.
  const resetRuntimes = Array.from({ length: 256 }, (_unused, index) =>
    createDirtyResetRuntime(index),
  );
  let resizeIteration = 0;
  let reorderIteration = 0;
  let resetIteration = 0;

  bench(
    "commits resize work for 240 columns (compare p99 with 8.33 ms)",
    () => {
      const column = benchmarkColumns[resizeIteration++ % columnCount]!;
      resizeRuntime.dispatchGridCommand({
        type: "column.resize.commit",
        columnId: column.columnId,
        width: 80 + (resizeIteration % 800),
      });
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    "commits reorder work for 240 columns (compare p99 with 8.33 ms)",
    () => {
      const column = benchmarkColumns[reorderIteration++ % columnCount]!;
      reorderRuntime.dispatchGridCommand({
        type: "column.reorder.commit",
        columnId: column.columnId,
        targetIndex: (reorderIteration * 7) % columnCount,
        pinned: undefined,
      });
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    "resets a complete 240-column layout (compare p99 with 8.33 ms)",
    () => {
      const resetRuntime = resetRuntimes[resetIteration++ % resetRuntimes.length]!;
      resetRuntime.dispatchGridCommand({ type: "column.reset.layout" });
    },
    {
      iterations: 100,
      time: 0,
      warmupIterations: 0,
      warmupTime: 0,
    },
  );

  const diagnosticResizeRuntime = createRuntime("TABLE_ID_BENCH_DIAGNOSTIC_RESIZE");
  const diagnosticReorderRuntime = createRuntime("TABLE_ID_BENCH_DIAGNOSTIC_REORDER");
  const diagnosticResetRuntimes = Array.from({ length: 256 }, (_unused, index) =>
    createDirtyResetRuntime(10_000 + index),
  );
  const diagnosticSamples: DiagnosticSamples = {
    resize: [],
    reorder: [],
    reset: [],
  };
  let diagnosticIteration = 0;
  let diagnosticPrinted = false;

  bench(
    "diagnostic p99 comparison for 240-column commands (8.33 ms reference)",
    () => {
      const iteration = diagnosticIteration++;
      const resizeColumn = benchmarkColumns[iteration % columnCount]!;
      const resizeStartedAt = performance.now();
      diagnosticResizeRuntime.dispatchGridCommand({
        type: "column.resize.commit",
        columnId: resizeColumn.columnId,
        width: 80 + ((iteration + 1) % 800),
      });
      diagnosticSamples.resize.push(performance.now() - resizeStartedAt);

      const reorderColumn = benchmarkColumns[iteration % columnCount]!;
      const reorderStartedAt = performance.now();
      diagnosticReorderRuntime.dispatchGridCommand({
        type: "column.reorder.commit",
        columnId: reorderColumn.columnId,
        targetIndex: ((iteration + 1) * 7) % columnCount,
        pinned: undefined,
      });
      diagnosticSamples.reorder.push(performance.now() - reorderStartedAt);

      const resetStartedAt = performance.now();
      diagnosticResetRuntimes[iteration % diagnosticResetRuntimes.length]!.dispatchGridCommand({
        type: "column.reset.layout",
      });
      diagnosticSamples.reset.push(performance.now() - resetStartedAt);

      if (!diagnosticPrinted && diagnosticIteration >= 100) {
        diagnosticPrinted = true;
        const diagnosticP99Ms = {
          resize: percentile99(diagnosticSamples.resize),
          reorder: percentile99(diagnosticSamples.reorder),
          reset: percentile99(diagnosticSamples.reset),
        };
        process.stdout.write(
          `${JSON.stringify({
            benchmark: "BrunoTable column management runtime",
            referenceFrameBudgetMs,
            diagnosticP99Ms,
            diagnosticP99WithinReference: Object.fromEntries(
              Object.entries(diagnosticP99Ms).map(([kind, durationMs]) => [
                kind,
                durationMs <= referenceFrameBudgetMs,
              ]),
            ),
          })}\n`,
        );
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
