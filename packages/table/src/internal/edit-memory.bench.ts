import { bench, describe } from "vite-plus/test";

import { BrunoTableCellEditRuntime, type BrunoTableCellEditDraftSnapshot } from "./cell-edit";
import { assertBrunoTableBenchmarkBudget } from "./benchmark-budget";
import { compileColumns } from "./compile-columns";

const referenceFrameBudgetMs = 8.33;
const warmupSampleCount = 2;
const measuredSampleCount = 100;
const gestureCellCount = 5_000;
const row = Object.freeze({ value: "server" });
const columns = compileColumns([
  {
    columnId: "COL_ID_VALUE",
    field: "value",
    headerName: "Value",
    valueType: "text",
    isEditable: ({ value }: { readonly value: string }) => value.length > 0,
  },
]);
const changes = Array.from(
  { length: gestureCellCount },
  (_unused, index): BrunoTableCellEditDraftSnapshot =>
    Object.freeze({
      rowId: `row-${String(index)}`,
      columnId: "COL_ID_VALUE",
      field: "value",
      baseRow: row,
      expectedVersion: index,
      base: "server",
      mine: `draft-${String(index)}`,
    }),
);
const firstChange = changes[0];
if (firstChange === undefined) throw new Error("Edit-memory benchmark gesture must be non-empty.");
const gesture: readonly [BrunoTableCellEditDraftSnapshot, ...BrunoTableCellEditDraftSnapshot[]] = [
  firstChange,
  ...changes.slice(1),
];

function createRuntime(onRowRead?: () => void): BrunoTableCellEditRuntime {
  const runtime = new BrunoTableCellEditRuntime({
    columns,
    getRow: () => {
      onRowRead?.();
      return row;
    },
  });
  runtime.setBatchHistoryEnabled(true);
  return runtime;
}

function recordBudgetSample(
  name: string,
  samples: number[],
  elapsedMs: number,
  warmups = warmupSampleCount,
): void {
  samples.push(elapsedMs);
  assertBrunoTableBenchmarkBudget(name, samples, {
    budgetMs: referenceFrameBudgetMs,
    measuredSampleCount,
    warmupSampleCount: warmups,
  });
}

describe("BrunoTable sparse edit-memory benchmark (8.33 ms/120 Hz reference)", () => {
  const applySamples: number[] = [];
  const undoSamples: number[] = [];
  const redoSamples: number[] = [];
  const runtime = createRuntime();
  let rowReads = 0;
  const reconciliationRuntime = createRuntime(() => {
    rowReads += 1;
  });
  if (!reconciliationRuntime.applyAcceptedDraftGesture(gesture)) {
    throw new Error("The reconciliation fixture was not accepted.");
  }

  bench(
    "applies, undoes, and redoes one 5,000-cell gesture as one bounded sparse command",
    () => {
      runtime.resetAllDrafts();
      let startedAt = performance.now();
      if (!runtime.applyAcceptedDraftGesture(gesture)) {
        throw new Error("The 5,000-cell gesture was not accepted.");
      }
      recordBudgetSample("5,000-cell gesture apply", applySamples, performance.now() - startedAt);
      if (runtime.getActivitySnapshot().draftCount !== gestureCellCount) {
        throw new Error("The accepted gesture did not publish every sparse draft.");
      }

      startedAt = performance.now();
      if (!runtime.undoBatchDraft()) throw new Error("The gesture did not undo atomically.");
      recordBudgetSample("5,000-cell gesture undo", undoSamples, performance.now() - startedAt);
      if (runtime.getActivitySnapshot().draftCount !== 0) {
        throw new Error("Undo retained partial gesture state.");
      }

      startedAt = performance.now();
      if (!runtime.redoBatchDraft()) throw new Error("The gesture did not redo atomically.");
      recordBudgetSample("5,000-cell gesture redo", redoSamples, performance.now() - startedAt);
      if (runtime.getActivitySnapshot().draftCount !== gestureCellCount) {
        throw new Error("Redo restored partial gesture state.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 2, warmupTime: 0 },
  );

  const preciseReconciliationSamples: number[] = [];
  bench(
    "reconciles one precise source Row Identity without materializing Reset Review",
    () => {
      const previousRowReads = rowReads;
      const startedAt = performance.now();
      reconciliationRuntime.reconcileSourceRows(new Set(["row-2500"]));
      recordBudgetSample(
        "one-row sparse draft reconciliation",
        preciseReconciliationSamples,
        performance.now() - startedAt,
      );
      if (reconciliationRuntime.getActivitySnapshot().draftCount !== gestureCellCount) {
        throw new Error("Precise reconciliation changed unrelated sparse drafts.");
      }
      if (rowReads - previousRowReads !== 1) {
        throw new Error("Precise reconciliation read outside its one indexed dirty cell.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 2, warmupTime: 0 },
  );

  const unknownReconciliationSamples: number[] = [];
  bench(
    "reconciles 5,000 sparse drafts after an unknown source publication",
    () => {
      const startedAt = performance.now();
      reconciliationRuntime.reconcileSourceRows(undefined);
      recordBudgetSample(
        "unknown sparse draft reconciliation",
        unknownReconciliationSamples,
        performance.now() - startedAt,
      );
      if (reconciliationRuntime.getActivitySnapshot().draftCount !== gestureCellCount) {
        throw new Error("Unknown reconciliation lost divergent sparse drafts.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 2, warmupTime: 0 },
  );

  const historySourceRows = new Map<string, Readonly<{ readonly value: string }>>();
  for (let index = 0; index < gestureCellCount; index += 1) {
    historySourceRows.set(
      `row-${String(index)}`,
      Object.freeze({ value: `history-99-${String(index)}` }),
    );
  }
  const historyReconciliationRuntime = new BrunoTableCellEditRuntime({
    columns,
    getRow: (rowId) => historySourceRows.get(rowId),
  });
  historyReconciliationRuntime.setBatchHistoryEnabled(true);
  for (let commandIndex = 0; commandIndex < 100; commandIndex += 1) {
    const commandChanges = gesture.map((draft, cellIndex) =>
      Object.freeze({
        ...draft,
        mine: `history-${String(commandIndex)}-${String(cellIndex)}`,
      }),
    );
    const firstCommandChange = commandChanges[0];
    if (firstCommandChange === undefined) {
      throw new Error("The retained-history fixture command must be non-empty.");
    }
    const commandGesture: readonly [
      BrunoTableCellEditDraftSnapshot,
      ...BrunoTableCellEditDraftSnapshot[],
    ] = [firstCommandChange, ...commandChanges.slice(1)];
    if (!historyReconciliationRuntime.applyAcceptedDraftGesture(commandGesture)) {
      throw new Error("The retained-history fixture command was not accepted.");
    }
  }
  const retainedHistorySamples: number[] = [];
  let retainedHistoryTargetIndex = 0;
  bench(
    "prunes one converged Cell Identity from 100 retained 5,000-cell commands",
    () => {
      const targetIndex = retainedHistoryTargetIndex;
      retainedHistoryTargetIndex += 1;
      const previousDraftCount = historyReconciliationRuntime.getActivitySnapshot().draftCount;
      const startedAt = performance.now();
      historyReconciliationRuntime.reconcileSourceRows(new Set([`row-${String(targetIndex)}`]));
      const elapsedMs = performance.now() - startedAt;
      recordBudgetSample(
        "one-cell retained-history convergence",
        retainedHistorySamples,
        elapsedMs,
        0,
      );
      if (
        historyReconciliationRuntime.getActivitySnapshot().draftCount !==
        previousDraftCount - 1
      ) {
        throw new Error("One-cell convergence changed unrelated retained drafts.");
      }
    },
    { iterations: 100, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
