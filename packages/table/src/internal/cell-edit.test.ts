import { afterEach, describe, expect, it, vi } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableSelectColumn } from "../column-helpers";
import { BrunoTableBigDecimalValueType } from "../effect";
import type { BrunoTableColumns, BrunoTableValueType } from "../public-types";
import {
  BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH,
  BrunoTableCellEditRuntime as BrunoTableCellEditRuntimeBase,
  isBrunoTableCellEditDraftReviewSourceRow,
  type BrunoTableCellEditDraftSnapshot,
} from "./cell-edit";
import { compileColumns } from "./compile-columns";

type Row = Readonly<{
  readonly id: string;
  readonly quantity: bigint;
  readonly score: number;
}>;

const row: Row = { id: "row-1", quantity: 9_007_199_254_740_993n, score: 4 };
const columns = compileColumns([
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
    isEditable: true,
  },
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
    isEditable: ({ value }: { readonly value: number }) => value >= 0,
    validate: ({ value }: { readonly value: number }) =>
      value <= 10 ? undefined : "Score must be at most 10.",
  },
]);

const runtimes = new Set<BrunoTableCellEditRuntimeBase>();

class BrunoTableCellEditRuntime extends BrunoTableCellEditRuntimeBase {
  public constructor(options: ConstructorParameters<typeof BrunoTableCellEditRuntimeBase>[0]) {
    super(options);
    const disposeBase = this.dispose;
    Object.defineProperty(this, "dispose", {
      configurable: true,
      value: () => {
        runtimes.delete(this);
        disposeBase();
      },
    });
    runtimes.add(this);
    this.activate();
  }
}

afterEach(() => {
  for (const runtime of runtimes) runtime.dispose();
  runtimes.clear();
});

describe("BrunoTable Cell Edit Session", () => {
  it("records bounded Batch draft history and retains redo intent at zero drafts", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 1,
      undoCount: 1,
      redoCount: 0,
    });

    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBeUndefined();
    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 0,
      undoCount: 0,
      redoCount: 1,
    });

    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 1,
      undoCount: 1,
      redoCount: 0,
    });
  });

  it("retains exact Base, Mine, row, field, and Row Version evidence per sparse draft", () => {
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: () => 17n,
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        rowId: "row-1",
        columnId: "COL_ID_SCORE",
        field: "score",
        baseRow: row,
        expectedVersion: 17n,
        base: 4,
        mine: 7,
      },
    ]);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        rowId: "row-1",
        columnId: "COL_ID_SCORE",
        field: "score",
        baseRow: row,
        expectedVersion: 17n,
        base: 4,
        mine: 8,
      },
    ]);
  });

  it("keeps the immutable admission Base and Row Version across live source replacement", () => {
    const admitted = Object.freeze({ ...row, score: 4 });
    let current: Row = admitted;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate === admitted ? 1n : 2n),
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    current = Object.freeze({ ...row, score: 6 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { baseRow: admitted, expectedVersion: 1n, base: 4, serverNow: 6, mine: 8 },
    ]);
  });

  it("prunes redo-only convergence and revalidates missing-row history before replay", () => {
    let current: Row | undefined = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    current = Object.freeze({ ...row, score: 7 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getActivitySnapshot()).toMatchObject({ redoCount: 0 });
    expect(runtime.redoBatchDraft()).toBe(false);

    current = row;
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);
    current = undefined;
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { mine: 8, blockedReason: expect.stringContaining("removed") },
    ]);
    current = row;
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([{ mine: 8, blockedReason: undefined }]);
  });

  it("keeps the latest Mine when the source publishes an older history value", () => {
    let current: Row = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);

    current = Object.freeze({ ...row, score: 7 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getDraftSnapshot(row.id, "COL_ID_SCORE")).toBe(8);
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 1, undoCount: 2 });
  });

  it("reconciles redo-only evidence on an unknown source publication", () => {
    let current: Row = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    current = Object.freeze({ ...row, score: 7 });
    runtime.reconcileSourceRows(undefined);

    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 0, redoCount: 0 });
    expect(runtime.redoBatchDraft()).toBe(false);
  });

  it("does not record a Batch command for distinct but semantically equivalent Mine values", () => {
    type ObjectRow = Readonly<{ readonly id: string; readonly value: Readonly<{ id: string }> }>;
    const objectRow: ObjectRow = Object.freeze({ id: "object-row", value: { id: "base" } });
    const objectValueType: BrunoTableValueType<Readonly<{ id: string }>> = {
      codecId: "test/object-equivalence",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "object" && input !== null && "id" in input
          ? { _tag: "Success", value: { id: String(input.id) } }
          : { _tag: "Failure", message: "Expected object." },
      equivalent: (left, right) => left.id === right.id,
      compare: (left, right) => (left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
      formatCanonicalText: (value) => value.id,
      parseCanonicalText: (text) => ({ _tag: "Success", value: { id: text } }),
      formatDisplay: (value) => value.id,
      encodePersisted: (value) => value.id,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: { id: input } }
          : { _tag: "Failure", message: "Expected string." },
    };
    const objectColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: objectValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: objectColumns,
      getRow: () => objectRow,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: objectRow.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: objectRow,
          expectedVersion: 1n,
          base: objectRow.value,
          mine: { id: "mine" },
        },
      ]),
    ).toBe(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: objectRow.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: objectRow,
          expectedVersion: 1n,
          base: objectRow.value,
          mine: { id: "mine" },
        },
      ]),
    ).toBe(false);
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 1, undoCount: 1 });
  });

  it("materializes live Reset Review rows only while the review is observed", () => {
    const getRow = vi.fn(() => row);
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    getRow.mockClear();
    expect(runtime.commit("7")).toBe(true);
    expect(getRow).not.toHaveBeenCalled();

    const reviewSubscriber = vi.fn();
    const unsubscribe = runtime.subscribeDraftReview(reviewSubscriber);
    expect(getRow).toHaveBeenCalledOnce();
    expect(runtime.getDraftReviewSnapshot()).toHaveLength(1);

    unsubscribe();
    expect(runtime.getDraftReviewSnapshot()).toHaveLength(1);
    expect(getRow).toHaveBeenCalledTimes(2);
  });

  it("publishes live Reset Review updates only to the affected row projection", () => {
    const liveRows = new Map<string, Row>([
      ["row-a", Object.freeze({ ...row, id: "row-a" })],
      ["row-b", Object.freeze({ ...row, id: "row-b" })],
    ]);
    const getRow = vi.fn((rowId: string) => liveRows.get(rowId));
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow });
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "row-a",
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: liveRows.get("row-a")!,
          expectedVersion: 1n,
          base: 4,
          mine: 7,
        },
        {
          rowId: "row-b",
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: liveRows.get("row-b")!,
          expectedVersion: 1n,
          base: 4,
          mine: 8,
        },
      ]),
    ).toBe(true);
    const membershipListener = vi.fn();
    const unsubscribeMembership = runtime.subscribeDraftReview(membershipListener);
    const [rowA, rowB] = runtime.getDraftReviewSourceSnapshot();
    if (rowA === undefined || rowB === undefined) throw new Error("Expected two review rows.");
    expect(isBrunoTableCellEditDraftReviewSourceRow(rowA)).toBe(true);
    expect(
      isBrunoTableCellEditDraftReviewSourceRow({
        kind: "bruno-table-cell-edit-draft-review-source",
        getSnapshot: rowA.getSnapshot,
        subscribe: rowA.subscribe,
      }),
    ).toBe(false);
    expect(
      isBrunoTableCellEditDraftReviewSourceRow(
        new Proxy(
          {},
          {
            get: () => {
              throw new Error("consumer getter must not run");
            },
          },
        ),
      ),
    ).toBe(false);
    const rowAListener = vi.fn();
    const rowBListener = vi.fn();
    const unsubscribeRowA = rowA.subscribe(rowAListener);
    const unsubscribeRowB = rowB.subscribe(rowBListener);
    getRow.mockClear();

    liveRows.set("row-a", Object.freeze({ ...row, id: "row-a", score: 5 }));
    runtime.reconcileSourceRows(new Set(["row-a"]));

    expect(getRow).toHaveBeenCalledOnce();
    expect(membershipListener).not.toHaveBeenCalled();
    expect(rowAListener).toHaveBeenCalledOnce();
    expect(rowBListener).not.toHaveBeenCalled();
    expect(rowA.getSnapshot()).toMatchObject({ serverNow: 5, mine: 7 });

    unsubscribeRowA();
    unsubscribeRowB();
    unsubscribeMembership();
  });

  it("bounds Batch history without copying the complete draft store", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);
    for (let offset = 1n; offset <= 105n; offset += 1n) {
      expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
      expect(runtime.commit(String(row.quantity + offset))).toBe(true);
    }
    expect(runtime.getActivitySnapshot()).toMatchObject({ undoCount: 100, redoCount: 0 });
  });

  it("records one reversible sparse history command for a 500-cell accepted gesture", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);
    const traversalInvalidation = vi.fn();
    runtime.subscribeTraversalInvalidation(traversalInvalidation);
    const changes = Array.from(
      { length: 500 },
      (_unused, index): BrunoTableCellEditDraftSnapshot =>
        Object.freeze({
          rowId: `row-${String(index)}`,
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: row,
          expectedVersion: BigInt(index),
          base: 4,
          mine: 7,
        }),
    );
    const first = changes[0];
    if (first === undefined) throw new Error("Gesture fixture must be non-empty.");
    const gesture: readonly [
      BrunoTableCellEditDraftSnapshot,
      ...BrunoTableCellEditDraftSnapshot[],
    ] = [first, ...changes.slice(1)];

    expect(runtime.applyAcceptedDraftGesture(gesture)).toBe(true);
    expect(traversalInvalidation).toHaveBeenCalledOnce();
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 500, undoCount: 1 });
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(traversalInvalidation).toHaveBeenCalledTimes(2);
    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 0,
      undoCount: 0,
      redoCount: 1,
    });
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(traversalInvalidation).toHaveBeenCalledTimes(3);
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 500, undoCount: 1 });
  });

  it("rejects duplicate Cell Identities without creating phantom Batch history", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);
    const draft = {
      rowId: row.id,
      columnId: "COL_ID_SCORE",
      field: "score",
      baseRow: row,
      expectedVersion: 1n,
      base: 4,
      mine: 7,
    } as const;
    expect(runtime.applyAcceptedDraftGesture([draft])).toBe(true);
    const before = runtime.getDraftMemorySnapshot();

    expect(
      runtime.applyAcceptedDraftGesture([
        { ...draft, mine: 8 },
        { ...draft, mine: 7 },
      ]),
    ).toBe(false);
    expect(runtime.getDraftMemorySnapshot()).toBe(before);
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 1, undoCount: 1 });
  });

  it("reverses complete validation and conflict evidence as one sparse cell state", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: row,
          expectedVersion: 1n,
          base: 4,
          mine: 7,
          validationMessage: "Retained validation evidence",
          conflict: { server: 6, resolution: "mine" },
        },
      ]),
    ).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ validationCount: 1, conflictCount: 1 });
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        validationMessage: "Retained validation evidence",
        conflict: { server: 6, resolution: "mine" },
        status: "Retained validation evidence",
      },
    ]);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ validationCount: 0, conflictCount: 0 });
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ validationCount: 1, conflictCount: 1 });
  });

  it("clears stale validation and conflict evidence when Mine changes", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: row,
          expectedVersion: 1n,
          base: 4,
          mine: 7,
          validationMessage: "Old validation evidence",
          conflict: { server: 6, resolution: "mine" },
        },
      ]),
    ).toBe(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ validationCount: 0, conflictCount: 0 });
    const corrected = runtime.getDraftReviewSnapshot()[0];
    expect(corrected).toMatchObject({ mine: 8 });
    expect(Object.hasOwn(corrected!, "validationMessage")).toBe(false);
    expect(Object.hasOwn(corrected!, "conflict")).toBe(false);

    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        mine: 7,
        validationMessage: "Old validation evidence",
        conflict: { server: 6, resolution: "mine" },
      },
    ]);
  });

  it("bounds the reverse dependency index to retained draft and history evidence", () => {
    const rows = new Map<string, Row>();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => rows.get(rowId),
    });
    runtime.setBatchHistoryEnabled(true);

    for (let index = 0; index < 105; index += 1) {
      const current = Object.freeze({ ...row, id: `row-${String(index)}` });
      rows.set(current.id, current);
      expect(runtime.start(current.id, "COL_ID_SCORE")).toBe(true);
      expect(runtime.commit("7")).toBe(true);
      expect(runtime.undoBatchDraft()).toBe(true);
    }

    expect(runtime.getRetainedDraftDependencyCellCount()).toBe(1);
  });

  it("prunes only a converged cell from a multi-cell history command", () => {
    const liveRows = new Map<string, Row>([
      ["row-a", Object.freeze({ ...row, id: "row-a" })],
      ["row-b", Object.freeze({ ...row, id: "row-b" })],
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => liveRows.get(rowId),
    });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "row-a",
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: liveRows.get("row-a")!,
          expectedVersion: 1n,
          base: 4,
          mine: 7,
        },
        {
          rowId: "row-b",
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: liveRows.get("row-b")!,
          expectedVersion: 1n,
          base: 4,
          mine: 8,
        },
      ]),
    ).toBe(true);
    liveRows.set("row-a", Object.freeze({ ...row, id: "row-a", score: 7 }));
    runtime.reconcileSourceRows(new Set(["row-a"]));
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 1, undoCount: 1 });
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row-a", "COL_ID_SCORE")).toBeUndefined();
    expect(runtime.getDraftSnapshot("row-b", "COL_ID_SCORE")).toBeUndefined();
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row-a", "COL_ID_SCORE")).toBeUndefined();
    expect(runtime.getDraftSnapshot("row-b", "COL_ID_SCORE")).toBe(8);
  });

  it("prunes redo evidence when its compiled column authority disappears", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    runtime.reconcileColumns(columns.filter((column) => column.columnId !== "COL_ID_SCORE"));
    expect(runtime.getActivitySnapshot()).toMatchObject({ redoCount: 0 });
    expect(runtime.redoBatchDraft()).toBe(false);
  });

  it("seeds current-value editing from the canonical source value and rejects unreadable cells", () => {
    const commit = vi.fn();
    const normalizedValueType: BrunoTableValueType<string> = {
      codecId: "test/normalized-edit-source",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input.trim().toUpperCase() }
          : { _tag: "Failure", message: "Expected text." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected text." },
    };
    const normalizedColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: normalizedValueType,
        isEditable: ({ value }: { readonly value: string }) => value === "SOURCE",
      },
    ]);
    const normalizedRuntime = new BrunoTableCellEditRuntime({
      columns: normalizedColumns,
      getRow: () => ({ value: "  source  " }),
      onCommit: commit,
    });

    expect(normalizedRuntime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(normalizedRuntime.getSessionSnapshot()).toMatchObject({ initialText: "SOURCE" });
    expect(normalizedRuntime.commit("SOURCE")).toBe(true);
    expect(normalizedRuntime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();

    const unreadable = Object.defineProperty({}, "value", {
      get: () => {
        throw new Error("unreadable");
      },
    });
    const unreadableRuntime = new BrunoTableCellEditRuntime({
      columns: normalizedColumns,
      getRow: () => unreadable,
    });
    let admitted: boolean | undefined;
    expect(() => {
      admitted = unreadableRuntime.start("row", "COL_ID_VALUE");
    }).not.toThrow();
    expect(admitted).toBe(false);
  });

  it("retains invalid raw input and commits exact typed values only after one gate", () => {
    const commit = vi.fn();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => (rowId === row.id ? row : undefined),
      onCommit: commit,
    });

    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      initialText: "9007199254740993",
    });
    expect(runtime.commit("9007199254740993.5")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "Expected signed base-10 integer digits.",
    });
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_QUANTITY")).toBe(undefined);
    expect(commit).not.toHaveBeenCalled();

    expect(runtime.commit("9007199254740995")).toBe(true);
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_QUANTITY")).toBe(9_007_199_254_740_995n);
    expect(commit).toHaveBeenCalledWith({
      rowId: "row-1",
      columnId: "COL_ID_QUANTITY",
      field: "quantity",
      before: 9_007_199_254_740_993n,
      after: 9_007_199_254_740_995n,
    });
  });

  it("runs synchronous validation at commit and Escape restores the pre-session draft", () => {
    const commit = vi.fn();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      onCommit: commit,
    });
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("11")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: "Score must be at most 10.",
    });
    expect(runtime.cancel()).toBe(true);
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(undefined);
    expect(commit).not.toHaveBeenCalled();

    expect(runtime.start("row-1", "COL_ID_SCORE", "replace", "7")).toBe(true);
    expect(runtime.getSessionSnapshot()).toMatchObject({ initialText: "7" });
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.getSessionSnapshot()).toMatchObject({ initialText: "7" });
    expect(runtime.cancel()).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
  });

  it("bounds untrusted candidates and admits native Number validity through the actor gate", () => {
    const validate = vi.fn();
    const guardedColumns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
        isEditable: true,
        validate,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({ columns: guardedColumns, getRow: () => row });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate(
      "1".repeat(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 100),
      false,
    );
    expect(runtime.getActiveCandidateSnapshot().rawText).toHaveLength(
      BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1,
    );
    expect(runtime.commit("1".repeat(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1))).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: `Enter at most ${String(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH)} characters.`,
    });
    expect(validate).not.toHaveBeenCalled();
    expect(runtime.commit("4", true)).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Enter a valid number." });
    expect(validate).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("publishes only the affected cell projection instead of waking the matrix", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    const quantitySubscriber = vi.fn();
    const scoreSubscriber = vi.fn();
    const unsubscribeQuantity = runtime.subscribeCell(
      "row-1",
      "COL_ID_QUANTITY",
      quantitySubscriber,
    );
    const unsubscribeScore = runtime.subscribeCell("row-1", "COL_ID_SCORE", scoreSubscriber);

    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(quantitySubscriber).toHaveBeenCalledTimes(1);
    expect(scoreSubscriber).not.toHaveBeenCalled();
    expect(runtime.commit("9007199254740995")).toBe(true);
    expect(quantitySubscriber).toHaveBeenCalledTimes(2);
    expect(scoreSubscriber).not.toHaveBeenCalled();

    unsubscribeQuantity();
    unsubscribeScore();
    runtime.dispose();
  });

  it("publishes draft presence independently from an undefined draft value", () => {
    type OptionalRow = Readonly<{ readonly id: string; readonly optional: string | undefined }>;
    const optionalValueType: BrunoTableValueType<string | undefined, "equality", "text"> = {
      codecId: "test/undefined",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 100,
      decodeRuntime: (input) =>
        typeof input === "string" || input === undefined
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected optional text." },
      equivalent: Object.is,
      compare: (left, right) => (Object.is(left, right) ? 0 : left === undefined ? -1 : 1),
      formatCanonicalText: (value) => value ?? "undefined",
      parseCanonicalText: () => ({ _tag: "Success", value: undefined }),
      formatDisplay: (value) => value ?? "undefined",
      encodePersisted: () => null,
      decodePersisted: () => ({ _tag: "Success", value: undefined }),
    };
    const optionalRow: OptionalRow = { id: "optional", optional: "source" };
    const optionalColumns = compileColumns([
      {
        columnId: "COL_ID_OPTIONAL",
        field: "optional",
        headerName: "Optional",
        valueType: optionalValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: optionalColumns,
      getRow: () => optionalRow,
    });
    const subscriber = vi.fn();
    const unsubscribe = runtime.subscribeCell("optional", "COL_ID_OPTIONAL", subscriber);

    expect(runtime.start("optional", "COL_ID_OPTIONAL")).toBe(true);
    expect(runtime.commit("undefined")).toBe(true);
    const projection = runtime.getCellSnapshot("optional", "COL_ID_OPTIONAL");
    expect(projection).toMatchObject({ active: false, hasDraft: true, draft: undefined });
    expect(Object.hasOwn(projection, "draft")).toBe(true);
    expect(subscriber).toHaveBeenCalledTimes(2);

    unsubscribe();
    runtime.dispose();
  });

  it("invalidates predicate traversal from the store-owned draft revision", () => {
    const draftColumns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "quantity",
        headerName: "Start",
        valueType: "bigint",
        isEditable: true,
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
        isEditable: ({ value }: { readonly value: number }) => value < 5,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({ columns: draftColumns, getRow: () => row });
    const traversalInvalidation = vi.fn();
    const unsubscribeTraversal = runtime.subscribeTraversalInvalidation(traversalInvalidation);
    runtime.reconcileTraversal(draftColumns, {
      totalRows: 1,
      getRowId: (rowIndex) => (rowIndex === 0 ? row.id : undefined),
    });

    expect(runtime.findTraversalDestination(0, "COL_ID_START", 1)?.columnId).toBe("COL_ID_SCORE");
    const range = Object.freeze({
      axis: "horizontal" as const,
      rowId: row.id,
      columnIds: Object.freeze(["COL_ID_START", "COL_ID_SCORE"]),
    });
    expect(runtime.findRangeTraversalDestination(range, row.id, "COL_ID_START", 1)?.columnId).toBe(
      "COL_ID_SCORE",
    );
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(traversalInvalidation).toHaveBeenCalledOnce();
    expect(runtime.findTraversalDestination(0, "COL_ID_START", 1)).toBeUndefined();
    expect(runtime.findRangeTraversalDestination(range, row.id, "COL_ID_START", 1)).toBeUndefined();
    runtime.reconcileTraversalRows(undefined);
    expect(traversalInvalidation).toHaveBeenCalledTimes(2);
    unsubscribeTraversal();
    runtime.dispose();
  });

  it("publishes actor-owned invalid, accepted, and cancel decisions coherently", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    const sessionObservations: Array<readonly [string, boolean]> = [];
    const cellObservations: Array<readonly [boolean, string]> = [];
    const unsubscribeSession = runtime.subscribeSession(() => {
      sessionObservations.push([
        runtime.getSessionSnapshot().kind,
        runtime.getCellSnapshot("row-1", "COL_ID_SCORE").active,
      ]);
    });
    const unsubscribeCell = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => {
      cellObservations.push([
        runtime.getCellSnapshot("row-1", "COL_ID_SCORE").active,
        runtime.getSessionSnapshot().kind,
      ]);
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(sessionObservations).toEqual([["editing", true]]);
    expect(cellObservations).toEqual([[true, "editing"]]);
    expect(runtime.commit("11")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "Score must be at most 10.",
    });
    expect(runtime.getCellSnapshot("row-1", "COL_ID_SCORE").active).toBe(true);
    expect(runtime.commit("6")).toBe(true);
    expect(sessionObservations.at(-1)).toEqual(["idle", false]);
    expect(cellObservations.at(-1)).toEqual([false, "idle"]);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.cancel()).toBe(true);
    expect(sessionObservations.at(-1)).toEqual(["idle", false]);
    expect(cellObservations.at(-1)).toEqual([false, "idle"]);

    unsubscribeCell();
    unsubscribeSession();
    runtime.dispose();
  });

  it("applies actor-produced draft patches to store-owned memory in one observable batch", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    const initialDraftMemory = runtime.getDraftMemorySnapshot();
    const observations: Array<readonly [string, number, unknown]> = [];
    const unsubscribe = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => {
      observations.push([
        runtime.getSessionSnapshot().kind,
        runtime.getDraftMemorySnapshot().size,
        runtime.getCellSnapshot("row-1", "COL_ID_SCORE").draft,
      ]);
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("11")).toBe(false);
    expect(runtime.getDraftMemorySnapshot()).toBe(initialDraftMemory);
    expect(runtime.commit("6")).toBe(true);
    expect(runtime.getDraftMemorySnapshot()).not.toBe(initialDraftMemory);
    expect(observations.at(-1)).toEqual(["idle", 1, 6]);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("4")).toBe(true);
    expect(observations.at(-1)).toEqual(["idle", 0, undefined]);

    unsubscribe();
    runtime.dispose();
  });

  it("keeps snapshot reads observational and bounds stores to live subscriptions or the editor", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    for (let index = 0; index < 1_000; index += 1) {
      runtime.getCellSnapshot(`row-${String(index)}`, "COL_ID_SCORE");
    }
    expect(runtime.getRetainedCellStoreCount()).toBe(0);

    const unsubscribe = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => undefined);
    expect(runtime.getRetainedCellStoreCount()).toBe(1);
    unsubscribe();
    expect(runtime.getRetainedCellStoreCount()).toBe(0);

    const unsubscribeActive = runtime.subscribeCell("row-1", "COL_ID_SCORE", () => undefined);
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.getRetainedCellStoreCount()).toBe(1);
    unsubscribeActive();
    expect(runtime.getRetainedCellStoreCount()).toBe(1);
    expect(runtime.cancel()).toBe(true);
    expect(runtime.getRetainedCellStoreCount()).toBe(0);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("6")).toBe(true);
    const first = runtime.getCellSnapshot("row-1", "COL_ID_SCORE");
    expect(runtime.getCellSnapshot("row-1", "COL_ID_SCORE")).toBe(first);
    expect(first).toMatchObject({ active: false, hasDraft: true, draft: 6 });
    expect(runtime.getRetainedCellStoreCount()).toBe(0);
    runtime.dispose();
  });

  it("preserves the optional Effect BigDecimal domain without number coercion", () => {
    const before = BigDecimal.fromStringUnsafe("12345678901234567890.00000000000000000001");
    const decimalRow = { id: "decimal", amount: before };
    const decimalColumns = compileColumns([
      {
        columnId: "COL_ID_AMOUNT",
        field: "amount",
        headerName: "Amount",
        valueType: BrunoTableBigDecimalValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: decimalColumns,
      getRow: () => decimalRow,
    });

    expect(runtime.start("decimal", "COL_ID_AMOUNT")).toBe(true);
    expect(runtime.commit("12345678901234567890.00000000000000000002")).toBe(true);
    const draft = runtime.getDraftSnapshot("decimal", "COL_ID_AMOUNT") as BigDecimal.BigDecimal;
    expect(
      BigDecimal.equals(
        draft,
        BigDecimal.fromStringUnsafe("12345678901234567890.00000000000000000002"),
      ),
    ).toBe(true);
  });

  it("resolves explicit nullish blank representations before scalar parsing", () => {
    type NullableRow = Readonly<{
      readonly id: string;
      readonly nullable: number | null;
      readonly optional: number | undefined;
      readonly required: number;
    }>;
    const nullableRow: NullableRow = {
      id: "nullable",
      nullable: 5,
      optional: 6,
      required: 7,
    };
    const nullableColumns = compileColumns([
      {
        columnId: "COL_ID_NULLABLE",
        field: "nullable",
        headerName: "Nullable",
        valueType: "number",
        isEditable: true,
        blankValue: null,
      },
      {
        columnId: "COL_ID_OPTIONAL",
        field: "optional",
        headerName: "Optional",
        valueType: "number",
        isEditable: true,
        blankValue: undefined,
      },
      {
        columnId: "COL_ID_REQUIRED",
        field: "required",
        headerName: "Required",
        valueType: "number",
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<NullableRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: nullableColumns,
      getRow: () => nullableRow,
    });

    expect(runtime.start("nullable", "COL_ID_NULLABLE")).toBe(true);
    expect(runtime.commit("")).toBe(true);
    expect(runtime.getDraftSnapshot("nullable", "COL_ID_NULLABLE")).toBe(null);
    expect(runtime.start("nullable", "COL_ID_OPTIONAL")).toBe(true);
    expect(runtime.commit("")).toBe(true);
    expect(runtime.getCellSnapshot("nullable", "COL_ID_OPTIONAL")).toMatchObject({
      hasDraft: true,
      draft: undefined,
    });
    expect(runtime.start("nullable", "COL_ID_REQUIRED")).toBe(true);
    expect(runtime.commit("")).toBe(false);
    expect(runtime.getDraftSnapshot("nullable", "COL_ID_REQUIRED")).toBeUndefined();
  });

  it("preserves the explicit null versus undefined edit representation", () => {
    type AmbiguousRow = Readonly<{
      readonly id: string;
      readonly value: number | null | undefined;
    }>;
    let ambiguousRow: AmbiguousRow = { id: "ambiguous", value: undefined };
    const nullColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: true,
        blankValue: null,
      },
    ] satisfies BrunoTableColumns<AmbiguousRow>);
    const nullRuntime = new BrunoTableCellEditRuntime({
      columns: nullColumns,
      getRow: () => ambiguousRow,
    });

    expect(nullRuntime.start("ambiguous", "COL_ID_VALUE")).toBe(true);
    expect(nullRuntime.commit("")).toBe(true);
    expect(nullRuntime.getCellSnapshot("ambiguous", "COL_ID_VALUE")).toMatchObject({
      hasDraft: true,
      draft: null,
    });

    ambiguousRow = { id: "ambiguous", value: null };
    const undefinedColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: true,
        blankValue: undefined,
      },
    ] satisfies BrunoTableColumns<AmbiguousRow>);
    const undefinedRuntime = new BrunoTableCellEditRuntime({
      columns: undefinedColumns,
      getRow: () => ambiguousRow,
    });

    expect(undefinedRuntime.start("ambiguous", "COL_ID_VALUE")).toBe(true);
    expect(undefinedRuntime.commit("")).toBe(true);
    expect(undefinedRuntime.getCellSnapshot("ambiguous", "COL_ID_VALUE")).toMatchObject({
      hasDraft: true,
      draft: undefined,
    });
  });

  it("keeps Select and Boolean blank intent distinct from exact scalar values", () => {
    type ChoiceRow = Readonly<{
      readonly id: string;
      readonly flag: boolean | null;
      readonly nullableChoice: "" | "ready" | null;
      readonly requiredChoice: "" | "ready";
    }>;
    const choiceRow: ChoiceRow = {
      id: "choice",
      flag: null,
      nullableChoice: null,
      requiredChoice: "ready",
    };
    const choiceColumns = compileColumns([
      {
        columnId: "COL_ID_FLAG",
        field: "flag",
        headerName: "Flag",
        valueType: "boolean",
        isEditable: true,
        blankValue: null,
      },
      BrunoTableSelectColumn({
        columnId: "COL_ID_NULLABLE_CHOICE",
        field: "nullableChoice",
        headerName: "Nullable choice",
        options: ["", "ready"],
        isEditable: true,
        blankValue: null,
      }),
      BrunoTableSelectColumn({
        columnId: "COL_ID_REQUIRED_CHOICE",
        field: "requiredChoice",
        headerName: "Required choice",
        options: ["", "ready"],
        isEditable: true,
      }),
    ] satisfies BrunoTableColumns<ChoiceRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: choiceColumns,
      getRow: () => choiceRow,
    });

    expect(runtime.start("choice", "COL_ID_FLAG")).toBe(true);
    expect(runtime.getActiveCandidateSnapshot()).toMatchObject({ kind: "blank" });
    expect(runtime.commit("false", false, "scalar")).toBe(true);
    expect(runtime.getDraftSnapshot("choice", "COL_ID_FLAG")).toBe(false);

    expect(runtime.start("choice", "COL_ID_NULLABLE_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "scalar")).toBe(true);
    expect(runtime.getDraftSnapshot("choice", "COL_ID_NULLABLE_CHOICE")).toBe("");
    expect(runtime.start("choice", "COL_ID_NULLABLE_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "blank")).toBe(true);
    expect(runtime.getCellSnapshot("choice", "COL_ID_NULLABLE_CHOICE")).toMatchObject({
      hasDraft: false,
    });

    expect(runtime.start("choice", "COL_ID_REQUIRED_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "scalar")).toBe(true);
    expect(runtime.getDraftSnapshot("choice", "COL_ID_REQUIRED_CHOICE")).toBe("");
    expect(runtime.start("choice", "COL_ID_REQUIRED_CHOICE")).toBe(true);
    expect(runtime.commit("", false, "blank")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Enter a value." });
  });

  it("rejects policy-free blank input before a custom numeric text parser can coerce zero", () => {
    const parseCanonicalText = vi.fn((text: string) => ({
      _tag: "Success" as const,
      value: BigInt(text),
    }));
    const numericTextValueType: BrunoTableValueType<bigint, "numeric", "text"> = {
      codecId: "test/numeric-text",
      codecVersion: 1,
      filterFamily: "numeric",
      editorFamily: "text",
      cellAlign: "end",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "bigint"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected bigint." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText,
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: BigInt(input) }
          : { _tag: "Failure", message: "Expected string." },
    };
    const customColumns = compileColumns([
      {
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
        valueType: numericTextValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({ columns: customColumns, getRow: () => row });

    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.commit("")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Enter a value." });
    expect(parseCanonicalText).not.toHaveBeenCalled();
  });

  it("contains throwing and malformed custom parsers as recoverable invalid candidates", () => {
    let parserMode: "throw" | "malformed" | "wrong-domain" = "throw";
    const customValueType: BrunoTableValueType<string> = {
      codecId: "test/throwing-editor-parser",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected string." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: () => {
        if (parserMode === "malformed") return { nope: true } as never;
        if (parserMode === "wrong-domain") return { _tag: "Success", value: 1n } as never;
        throw new Error("parser escaped");
      },
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected string." },
    };
    const parserRow = { id: "parser", value: "before" };
    const parserColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: customValueType,
        isEditable: true,
      },
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: parserColumns,
      getRow: () => parserRow,
    });

    expect(runtime.start("parser", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("candidate", false);
    expect(runtime.commit("candidate")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "BrunoTable Value Type parseCanonicalText failed.",
    });
    expect(runtime.getActiveCandidateSnapshot()).toMatchObject({
      kind: "scalar",
      rawText: "candidate",
    });

    parserMode = "malformed";
    expect(runtime.commit("still candidate")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: "BrunoTable Value Type parseCanonicalText failed.",
    });
    parserMode = "wrong-domain";
    expect(runtime.commit("wrong domain")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({ invalidMessage: "Expected string." });
    expect(runtime.getDraftSnapshot("parser", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.cancel()).toBe(true);
  });

  it("contains hostile edit equality for both before and live-source comparisons", () => {
    for (const failureAt of [1, 2] as const) {
      let equalityCalls = 0;
      const valueType: BrunoTableValueType<string> = {
        codecId: `test/hostile-edit-equality-${String(failureAt)}`,
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime: (input) =>
          typeof input === "string"
            ? { _tag: "Success", value: input }
            : { _tag: "Failure", message: "Expected text." },
        equivalent: () => {
          equalityCalls += 1;
          if (equalityCalls === failureAt) throw new Error("equality escaped");
          return false;
        },
        compare: () => 0,
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
        formatDisplay: String,
        encodePersisted: String,
        decodePersisted: (input) => ({ _tag: "Success", value: String(input) }),
      };
      const liveRow = { value: "source" };
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileColumns([
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            headerName: "Value",
            valueType,
            isEditable: true,
          },
        ]),
        getRow: () => liveRow,
      });

      expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("candidate")).toBe(false);
      expect(runtime.getSessionSnapshot()).toMatchObject({
        kind: "editing",
        invalidMessage: "The value is invalid.",
      });
      expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    }
  });

  it("keeps candidate ownership while XState reconciles a live Row Identity tombstone", () => {
    let liveRow: Row | undefined = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => liveRow,
    });

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate("7", false);
    liveRow = { ...row, score: 5 };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing", rowMissing: false });
    expect(runtime.getActiveCandidateSnapshot()).toEqual({
      kind: "scalar",
      rawText: "7",
      nativeInvalid: false,
    });

    liveRow = undefined;
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing", rowMissing: true });
    expect(runtime.commit("7")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      rowMissing: true,
    });
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");

    liveRow = { ...row, score: 6 };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing", rowMissing: false });
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
  });

  it("captures one immutable draft command reader while later drafts publish", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("5")).toBe(true);
    const firstCommand = runtime.captureDraftCommandReader();

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("6")).toBe(true);

    expect(firstCommand("row-1", "COL_ID_SCORE")).toEqual({
      hasDraft: true,
      value: 5,
    });
    expect(runtime.captureDraftCommandReader()("row-1", "COL_ID_SCORE")).toEqual({
      hasDraft: true,
      value: 6,
    });
  });

  it("preserves compatible drafts across recompiles and prunes a changed value domain", () => {
    const compileTextColumns = () =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
        },
      ]);
    const textColumns = compileTextColumns();
    const liveRow = { id: "row", value: "source" };
    const runtime = new BrunoTableCellEditRuntime({ columns: textColumns, getRow: () => liveRow });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("draft")).toBe(true);

    runtime.reconcileColumns(compileTextColumns());
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("draft");

    runtime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "other",
          headerName: "Other",
          valueType: "text",
          isEditable: true,
        },
      ]),
    );
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    const capabilityRuntime = new BrunoTableCellEditRuntime({
      columns: textColumns,
      getRow: () => liveRow,
    });
    expect(capabilityRuntime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(capabilityRuntime.commit("draft")).toBe(true);
    capabilityRuntime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: false,
        },
      ]),
    );
    expect(capabilityRuntime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    runtime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "number",
          isEditable: true,
        },
      ]),
    );
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
  });

  it("preserves nullish blank drafts only across an unchanged explicit blank policy", () => {
    type NullableRow = Readonly<{
      readonly id: string;
      readonly value: number | null | undefined;
    }>;
    const liveRow: NullableRow = { id: "nullable", value: 1 };
    const customNumberValueType = (): BrunoTableValueType<number> => ({
      codecId: "test/non-null-number",
      codecVersion: 1,
      filterFamily: "numeric",
      editorFamily: "number",
      cellAlign: "end",
      editorLayout: "inline",
      defaultWidth: 100,
      decodeRuntime: (input) =>
        typeof input === "number"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected a non-null number." },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: (text) => ({ _tag: "Success", value: Number(text) }),
      formatDisplay: String,
      encodePersisted: (value) => value,
      decodePersisted: (input) =>
        typeof input === "number"
          ? { _tag: "Success", value: input }
          : { _tag: "Failure", message: "Expected a persisted number." },
    });
    const compileNullableColumns = (blankValue: null | undefined) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: customNumberValueType(),
          isEditable: true,
          blankValue,
        },
      ] satisfies BrunoTableColumns<NullableRow>);

    for (const blankValue of [null, undefined] as const) {
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileNullableColumns(blankValue),
        getRow: () => liveRow,
      });
      expect(runtime.start("nullable", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("", false, "blank")).toBe(true);
      expect(runtime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: true,
        draft: blankValue,
      });

      runtime.reconcileColumns(compileNullableColumns(blankValue));
      expect(runtime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: true,
        draft: blankValue,
      });
      expect(runtime.captureDraftCommandReader()("nullable", "COL_ID_VALUE")).toEqual({
        hasDraft: true,
        value: blankValue,
      });

      runtime.reconcileColumns(compileNullableColumns(blankValue === null ? undefined : null));
      expect(runtime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: false,
      });
      runtime.dispose();

      const removedPolicyRuntime = new BrunoTableCellEditRuntime({
        columns: compileNullableColumns(blankValue),
        getRow: () => liveRow,
      });
      expect(removedPolicyRuntime.start("nullable", "COL_ID_VALUE")).toBe(true);
      expect(removedPolicyRuntime.commit("", false, "blank")).toBe(true);
      removedPolicyRuntime.reconcileColumns(
        compileColumns([
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            headerName: "Value",
            valueType: customNumberValueType(),
            isEditable: false,
          },
        ] satisfies BrunoTableColumns<NullableRow>),
      );
      expect(removedPolicyRuntime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
        hasDraft: false,
      });
      removedPolicyRuntime.dispose();
    }

    const compileBuiltInColumns = (blankValue: null | undefined) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "number",
          isEditable: true,
          blankValue,
        },
      ] satisfies BrunoTableColumns<NullableRow>);
    const stableAuthorityRuntime = new BrunoTableCellEditRuntime({
      columns: compileBuiltInColumns(null),
      getRow: () => liveRow,
    });
    expect(stableAuthorityRuntime.start("nullable", "COL_ID_VALUE")).toBe(true);
    expect(stableAuthorityRuntime.commit("", false, "blank")).toBe(true);
    stableAuthorityRuntime.reconcileColumns(compileBuiltInColumns(null));
    expect(stableAuthorityRuntime.getDraftSnapshot("nullable", "COL_ID_VALUE")).toBe(null);
    stableAuthorityRuntime.reconcileColumns(compileBuiltInColumns(undefined));
    expect(stableAuthorityRuntime.getCellSnapshot("nullable", "COL_ID_VALUE")).toMatchObject({
      hasDraft: false,
    });
    stableAuthorityRuntime.dispose();
  });

  it("prunes drafts when a recompiled runtime decoder throws or returns malformed evidence", () => {
    const compileTextColumns = () =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
        },
      ]);
    const liveRow = { value: "source" };
    const hostileValueType = (mode: "throw" | "malformed"): BrunoTableValueType<string> => ({
      codecId: `test/hostile-recompile-${mode}`,
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: () => {
        if (mode === "throw") throw new Error("decoder escaped");
        return { nope: true } as never;
      },
      equivalent: Object.is,
      compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
      formatCanonicalText: String,
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: String,
      encodePersisted: String,
      decodePersisted: (input) => ({ _tag: "Success", value: String(input) }),
    });

    for (const mode of ["throw", "malformed"] as const) {
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileTextColumns(),
        getRow: () => liveRow,
      });
      expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("draft")).toBe(true);

      expect(() =>
        runtime.reconcileColumns(
          compileColumns([
            {
              columnId: "COL_ID_VALUE",
              field: "value",
              headerName: "Value",
              valueType: hostileValueType(mode),
              isEditable: true,
            },
          ]),
        ),
      ).not.toThrow();
      expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    }
  });

  it("rebinds an active invalid session across an equivalent column recompile", () => {
    const compileValidatedColumns = () =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
          validate: ({ value }: { readonly value: string }) =>
            value === "invalid" ? "Invalid value." : undefined,
        },
      ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileValidatedColumns(),
      getRow: () => ({ value: "source" }),
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("invalid", false);
    expect(runtime.commit("invalid")).toBe(false);

    runtime.reconcileColumns(compileValidatedColumns());

    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      columnId: "COL_ID_VALUE",
      invalidMessage: "Invalid value.",
    });
    expect(runtime.getActiveCandidateSnapshot()).toEqual({
      kind: "scalar",
      rawText: "invalid",
      nativeInvalid: false,
    });
  });

  it("cancels active candidates before an edit-facing column recompile can reinterpret them", () => {
    type OptionalRow = Readonly<{ readonly value: string | null | undefined }>;
    const decodeRuntime = (input: unknown) =>
      typeof input === "string" || input == null
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected nullable text." } as const);
    const formatCanonicalText = (value: string | null | undefined) => value ?? "";
    const parseText = (text: string) => ({ _tag: "Success", value: text }) as const;
    const parseUpper = (text: string) => ({ _tag: "Success", value: text.toUpperCase() }) as const;
    const valueType = (
      parseCanonicalText: typeof parseText,
      editorFamily: "text" | "number" = "text",
    ) => ({
      codecId: "test/active-session-authority",
      codecVersion: 1,
      filterFamily: "equality",
      editorFamily,
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime,
      equivalent: Object.is,
      compare: () => 0 as const,
      formatCanonicalText,
      parseCanonicalText,
      formatDisplay: formatCanonicalText,
      encodePersisted: (value: string | null | undefined) => value ?? null,
      decodePersisted: decodeRuntime,
    });
    const compileOptional = (blankValue: null | undefined, parseCanonicalText = parseText) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: valueType(parseCanonicalText),
          isEditable: true,
          blankValue,
        },
      ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileOptional(null),
      getRow: (): OptionalRow => ({ value: null }),
    });

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("", false, "blank");
    runtime.reconcileColumns(compileOptional(undefined));
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("candidate", false);
    runtime.reconcileColumns(compileOptional(undefined, parseUpper));
    expect(runtime.getSessionSnapshot()).toEqual({ kind: "idle" });

    const familyRuntime = new BrunoTableCellEditRuntime({
      columns: compileOptional(undefined),
      getRow: (): OptionalRow => ({ value: "source" }),
    });
    expect(familyRuntime.start("row", "COL_ID_VALUE")).toBe(true);
    familyRuntime.reconcileColumns(
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: valueType(parseText, "number"),
          isEditable: true,
          blankValue: undefined,
        },
      ]),
    );
    expect(familyRuntime.getSessionSnapshot()).toEqual({ kind: "idle" });

    type SelectRow = Readonly<{ readonly choice: "a" | "b" | "c" }>;
    const compileSelect = (changed: boolean) =>
      changed
        ? compileColumns([
            BrunoTableSelectColumn({
              columnId: "COL_ID_CHOICE",
              field: "choice",
              headerName: "Choice",
              options: ["a", "c", "b"],
              isEditable: true,
            }),
          ] satisfies BrunoTableColumns<SelectRow>)
        : compileColumns([
            BrunoTableSelectColumn({
              columnId: "COL_ID_CHOICE",
              field: "choice",
              headerName: "Choice",
              options: ["a", "b", "c"],
              isEditable: true,
            }),
          ] satisfies BrunoTableColumns<SelectRow>);
    const selectRuntime = new BrunoTableCellEditRuntime({
      columns: compileSelect(false),
      getRow: (): SelectRow => ({ choice: "a" }),
    });
    expect(selectRuntime.start("row", "COL_ID_CHOICE")).toBe(true);
    selectRuntime.updateActiveCandidate("a", false);
    selectRuntime.reconcileColumns(compileSelect(false));
    expect(selectRuntime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      columnId: "COL_ID_CHOICE",
    });
    expect(selectRuntime.getActiveCandidateSnapshot()).toMatchObject({ rawText: "a" });
    selectRuntime.reconcileColumns(compileSelect(true));
    expect(selectRuntime.getSessionSnapshot()).toEqual({ kind: "idle" });

    type ToggleRow = Readonly<{ readonly toggle: "N" | "Y" }>;
    const decodeToggle = (input: unknown) =>
      input === "N" || input === "Y"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected N or Y." } as const);
    const formatToggle = (value: "N" | "Y") => value;
    const parseToggle = (text: string) => decodeToggle(text);
    const compileToggle = (booleanEditorValues: readonly ["N" | "Y", "N" | "Y"]) =>
      compileColumns([
        {
          columnId: "COL_ID_TOGGLE",
          field: "toggle",
          headerName: "Toggle",
          valueType: {
            codecId: "test/toggle-session-authority",
            codecVersion: 1,
            filterFamily: "equality",
            editorFamily: "boolean",
            booleanEditorValues,
            cellAlign: "center",
            editorLayout: "center",
            defaultWidth: 88,
            decodeRuntime: decodeToggle,
            equivalent: Object.is,
            compare: () => 0 as const,
            formatCanonicalText: formatToggle,
            parseCanonicalText: parseToggle,
            formatDisplay: formatToggle,
            encodePersisted: formatToggle,
            decodePersisted: decodeToggle,
          },
          isEditable: true,
        },
      ] satisfies BrunoTableColumns<ToggleRow>);
    const toggleRuntime = new BrunoTableCellEditRuntime({
      columns: compileToggle(["N", "Y"]),
      getRow: (): ToggleRow => ({ toggle: "N" }),
    });
    expect(toggleRuntime.start("row", "COL_ID_TOGGLE")).toBe(true);
    toggleRuntime.reconcileColumns(compileToggle(["N", "Y"]));
    expect(toggleRuntime.getSessionSnapshot()).toMatchObject({ kind: "editing" });
    toggleRuntime.reconcileColumns(compileToggle(["Y", "N"]));
    expect(toggleRuntime.getSessionSnapshot()).toEqual({ kind: "idle" });
  });

  it("blocks an active commit while dynamic edit permission is denied and recovers in place", () => {
    type PermissionRow = Readonly<{ readonly value: string; readonly allowed: boolean }>;
    let liveRow: PermissionRow = { value: "source", allowed: true };
    const compilePermissionColumns = (
      predicate: (context: { readonly row: PermissionRow; readonly value: string }) => boolean,
    ) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: predicate,
        },
      ]);
    const sourcePolicy = vi.fn(
      ({ row: candidateRow, value }: { readonly row: PermissionRow; readonly value: string }) =>
        candidateRow.allowed && value !== "locked",
    );
    const runtime = new BrunoTableCellEditRuntime({
      columns: compilePermissionColumns(sourcePolicy),
      getRow: () => liveRow,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("candidate", false);

    const sessionSubscriber = vi.fn();
    const unsubscribe = runtime.subscribeSession(sessionSubscriber);
    sourcePolicy.mockClear();
    runtime.reconcileActiveRow(new Set(["unrelated"]));
    expect(sourcePolicy).not.toHaveBeenCalled();
    expect(sessionSubscriber).not.toHaveBeenCalled();

    liveRow = { value: "locked", allowed: true };
    runtime.reconcileActiveRow(new Set(["row"]));
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "This cell is no longer editable.",
    });
    expect(runtime.commit("candidate")).toBe(false);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    liveRow = { value: "source", allowed: true };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({ kind: "editing" });
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");

    runtime.reconcileColumns(compilePermissionColumns(() => false));
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "This cell is no longer editable.",
    });
    runtime.reconcileColumns(
      compilePermissionColumns(() => {
        throw new Error("policy failed");
      }),
    );
    expect(runtime.commit("candidate")).toBe(false);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();

    runtime.reconcileColumns(compilePermissionColumns(() => true));
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");
    expect(runtime.commit("candidate")).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("candidate");

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.reconcileColumns(compilePermissionColumns(({ value }) => value === "candidate"));
    liveRow = { value: "locked", allowed: true };
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).not.toHaveProperty("invalidMessage");
    unsubscribe();
  });

  it("clears a row-missing overlay on identity return and reveals prior validation", () => {
    let liveRow: Row | undefined = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => liveRow });
    expect(runtime.start("row-1", "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.commit("not-an-integer")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      invalidMessage: "Expected signed base-10 integer digits.",
    });

    liveRow = undefined;
    runtime.reconcileActiveRow();
    expect(runtime.commit("not-an-integer")).toBe(false);
    expect(runtime.getSessionSnapshot()).toMatchObject({
      rowMissing: true,
      invalidMessage: "Expected signed base-10 integer digits.",
    });

    liveRow = row;
    runtime.reconcileActiveRow();
    expect(runtime.getSessionSnapshot()).toMatchObject({
      rowMissing: false,
      invalidMessage: "Expected signed base-10 integer digits.",
    });
  });

  it("does not create a draft for an untouched candidate after a live source change", () => {
    type TextRow = Readonly<{ readonly value: string }>;
    let liveRow: TextRow = { value: "A" };
    const onCommit = vi.fn();
    const textColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<TextRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: textColumns,
      getRow: () => liveRow,
      onCommit,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    liveRow = { value: "B" };
    runtime.reconcileActiveRow(new Set(["row"]));
    expect(runtime.commit("A")).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    expect(onCommit).not.toHaveBeenCalled();

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("C")).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("C");
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("records a draft-backed revert to the canonical source value", () => {
    type TextRow = Readonly<{ readonly value: string }>;
    const liveRow: TextRow = { value: "A" };
    const onCommit = vi.fn();
    const textColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<TextRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: textColumns,
      getRow: () => liveRow,
      onCommit,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("C")).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("C");
    onCommit.mockClear();

    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("A")).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    expect(onCommit).toHaveBeenCalledWith({
      rowId: "row",
      columnId: "COL_ID_VALUE",
      field: "value",
      before: "C",
      after: "A",
    });
  });

  it("rejects Boolean editor admission when the canonical value is outside its mapping", () => {
    type ToggleRow = Readonly<{ readonly toggle: "M" | "N" | "Y" }>;
    let liveRow: ToggleRow = { toggle: "M" };
    const decodeToggle = (input: unknown) =>
      input === "M" || input === "N" || input === "Y"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected M, N, or Y." } as const);
    const toggleColumns = compileColumns([
      {
        columnId: "COL_ID_TOGGLE",
        field: "toggle",
        headerName: "Toggle",
        valueType: {
          codecId: "test/three-state-toggle",
          codecVersion: 1,
          filterFamily: "equality",
          editorFamily: "boolean",
          booleanEditorValues: ["N", "Y"],
          cellAlign: "center",
          editorLayout: "center",
          defaultWidth: 88,
          decodeRuntime: decodeToggle,
          equivalent: Object.is,
          compare: () => 0 as const,
          formatCanonicalText: (value: ToggleRow["toggle"]) => value,
          parseCanonicalText: decodeToggle,
          formatDisplay: (value: ToggleRow["toggle"]) => value,
          encodePersisted: (value: ToggleRow["toggle"]) => value,
          decodePersisted: decodeToggle,
        },
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<ToggleRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: toggleColumns,
      getRow: () => liveRow,
    });
    expect(runtime.start("row", "COL_ID_TOGGLE")).toBe(false);
    liveRow = { toggle: "N" };
    expect(runtime.start("row", "COL_ID_TOGGLE")).toBe(true);
    liveRow = { toggle: "M" };
    runtime.reconcileActiveRow(new Set(["row"]));
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "This cell is no longer editable.",
    });
  });

  it("skips unmapped Boolean values during traversal and reconciles live mapping changes", () => {
    type ToggleRow = Readonly<{ readonly id: string; readonly toggle: "M" | "N" | "Y" }>;
    const decodeToggle = (input: unknown) =>
      input === "M" || input === "N" || input === "Y"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected M, N, or Y." } as const);
    const formatToggle = (value: ToggleRow["toggle"]) => value;
    const makeColumns = (
      booleanEditorValues: readonly [ToggleRow["toggle"], ToggleRow["toggle"]],
    ) =>
      compileColumns([
        {
          columnId: "COL_ID_TOGGLE",
          field: "toggle",
          headerName: "Toggle",
          valueType: {
            codecId: "test/traversal-three-state-toggle",
            codecVersion: 1,
            filterFamily: "equality",
            editorFamily: "boolean",
            booleanEditorValues,
            cellAlign: "center",
            editorLayout: "center",
            defaultWidth: 88,
            decodeRuntime: decodeToggle,
            equivalent: Object.is,
            compare: () => 0 as const,
            formatCanonicalText: formatToggle,
            parseCanonicalText: decodeToggle,
            formatDisplay: formatToggle,
            encodePersisted: formatToggle,
            decodePersisted: decodeToggle,
          },
          isEditable: true,
        },
      ] satisfies BrunoTableColumns<ToggleRow>);
    const rows = new Map<string, ToggleRow>([
      ["mapped-start", { id: "mapped-start", toggle: "N" }],
      ["unmapped", { id: "unmapped", toggle: "M" }],
      ["mapped-end", { id: "mapped-end", toggle: "Y" }],
    ]);
    const columns = makeColumns(["N", "Y"]);
    const rowIds = [...rows.keys()];
    const rowSpace = {
      totalRows: rowIds.length,
      getRowId: (rowIndex: number) => rowIds[rowIndex],
    };
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => rows.get(rowId),
    });
    expect(runtime.isEditable("mapped-start", "COL_ID_TOGGLE")).toBe(true);
    expect(runtime.isEditable("unmapped", "COL_ID_TOGGLE")).toBe(false);
    expect(runtime.isEditable("mapped-end", "COL_ID_TOGGLE")).toBe(true);
    runtime.reconcileTraversal(columns, rowSpace);
    expect(runtime.findTraversalDestination(0, "COL_ID_TOGGLE", 1)?.rowId).toBe("mapped-end");
    expect(runtime.findTraversalDestination(2, "COL_ID_TOGGLE", -1)?.rowId).toBe("mapped-start");

    rows.set("unmapped", { id: "unmapped", toggle: "N" });
    runtime.reconcileTraversalRows(new Set(["unmapped"]));
    expect(runtime.findTraversalDestination(0, "COL_ID_TOGGLE", 1)?.rowId).toBe("unmapped");

    rows.set("unmapped", { id: "unmapped", toggle: "M" });
    runtime.reconcileTraversalRows(new Set(["unmapped"]));
    const remappedColumns = makeColumns(["M", "Y"]);
    runtime.reconcileColumns(remappedColumns);
    runtime.reconcileTraversal(remappedColumns, rowSpace);
    expect(runtime.findTraversalDestination(0, "COL_ID_TOGGLE", 1)?.rowId).toBe("unmapped");
  });

  it("rotates canonical source caches when decoder authority changes", () => {
    type CanonicalRow = Readonly<{ readonly value: string }>;
    type Decoder = (
      input: unknown,
    ) => Readonly<{ readonly _tag: "Success"; readonly value: string }>;
    const row: CanonicalRow = { value: "raw" };
    const decodeA = vi.fn<Decoder>(() => ({ _tag: "Success", value: "allow" }));
    const decodeB = vi.fn<Decoder>(() => ({ _tag: "Success", value: "deny" }));
    const makeColumns = (decodeRuntime: Decoder) => {
      const valueType: BrunoTableValueType<string> = {
        codecId: "test/cache-generation",
        codecVersion: 1,
        filterFamily: "equality",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: Object.is,
        compare: () => 0 as const,
        formatCanonicalText: (value) => value,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: (value) => value,
        encodePersisted: (value) => value,
        decodePersisted: decodeRuntime,
      };
      return compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType,
          isEditable: ({ value }: { readonly value: string }) => value === "allow",
        },
      ] satisfies BrunoTableColumns<CanonicalRow>);
    };
    const columnsA = makeColumns(decodeA);
    const runtime = new BrunoTableCellEditRuntime({ columns: columnsA, getRow: () => row });
    expect(runtime.isEditable("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.isEditable("row", "COL_ID_VALUE")).toBe(true);
    expect(decodeA).toHaveBeenCalledOnce();

    runtime.reconcileColumns(makeColumns(decodeB));
    expect(runtime.isEditable("row", "COL_ID_VALUE")).toBe(false);
    expect(decodeB).toHaveBeenCalledOnce();

    runtime.reconcileColumns(columnsA);
    expect(runtime.isEditable("row", "COL_ID_VALUE")).toBe(true);
    expect(decodeA).toHaveBeenCalledTimes(2);
  });

  it("re-decodes both Base and Mine when decoder authority changes", () => {
    type CanonicalRow = Readonly<{ readonly value: string }>;
    const makeColumns = (suffix: string, rejectBase = false) => {
      const decodeRuntime = (input: unknown) =>
        rejectBase && String(input).startsWith("base")
          ? ({ _tag: "Failure", message: "rejected" } as const)
          : ({
              _tag: "Success",
              value: `${String(input).replace(/-[ab]$/, "")}-${suffix}`,
            } as const);
      const valueType: BrunoTableValueType<string> = {
        codecId: `test/redecode-${suffix}`,
        codecVersion: 1,
        filterFamily: "equality",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: Object.is,
        compare: () => 0 as const,
        formatCanonicalText: (value) => value,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: (value) => value,
        encodePersisted: (value) => value,
        decodePersisted: decodeRuntime,
      };
      return compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType,
          isEditable: true,
        },
      ] satisfies BrunoTableColumns<CanonicalRow>);
    };
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns("a"),
      getRow: () => ({ value: "server-a" }),
    });
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "row",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: { value: "base-a" },
          expectedVersion: 1,
          base: "base-a",
          mine: "mine-a",
        },
      ]),
    ).toBe(true);

    runtime.reconcileColumns(makeColumns("b"));
    expect(runtime.getDraftReviewSnapshot()[0]).toMatchObject({ base: "base-b", mine: "mine-b" });

    runtime.reconcileColumns(makeColumns("c", true));
    expect(runtime.getDraftReviewSnapshot()).toHaveLength(0);
  });
});
