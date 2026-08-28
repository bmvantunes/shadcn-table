import { afterEach, describe, expect, it, vi } from "vitest";
import * as BigDecimal from "effect/BigDecimal";

import { BrunoTableSelectColumn } from "../column-helpers";
import { BrunoTableBigDecimalValueType } from "../effect";
import type { BrunoTableColumns, BrunoTableValueType } from "../public-types";
import {
  BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH,
  BrunoTableCellEditRuntime as BrunoTableCellEditRuntimeBase,
  isBrunoTableCellEditDraftReviewSourceRow,
  type BrunoTableCellEditChangeGesture,
  type BrunoTableCellEditDraftSnapshot,
  type BrunoTableCellEditSaveChangeSet,
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

  it("retains the exact authored value for draft-removal history convergence", () => {
    let current: Row = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    current = Object.freeze({ ...row, score: 6 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.start("row-1", "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("6")).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBeUndefined();

    current = row;
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row-1", "COL_ID_SCORE")).toBe(7);
  });

  it("prunes undo-only return-to-base history after authoritative convergence", () => {
    let current: Row = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("4")).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 0, undoCount: 2 });

    current = Object.freeze({ ...row, score: 4 });
    runtime.reconcileSourceRows(new Set([row.id]));

    expect(runtime.getActivitySnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(runtime.undoBatchDraft()).toBe(false);
  });

  it("prunes undo convergence when unrelated redo history exists", () => {
    const rowA = Object.freeze({ ...row, id: "row-a" });
    const rowB = Object.freeze({ ...row, id: "row-b" });
    const liveRows = new Map<string, Row>([
      [rowA.id, rowA],
      [rowB.id, rowB],
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => liveRows.get(rowId),
    });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(rowA.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(rowA.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("4")).toBe(true);
    expect(runtime.start(rowB.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ undoCount: 2, redoCount: 1 });

    liveRows.set(rowA.id, Object.freeze({ ...rowA, score: 4 }));
    runtime.reconcileSourceRows(new Set([rowA.id]));

    expect(runtime.getActivitySnapshot()).toMatchObject({ undoCount: 0, redoCount: 1 });
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot(rowB.id, "COL_ID_SCORE")).toBe(8);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(false);
    expect(runtime.getDraftSnapshot(rowA.id, "COL_ID_SCORE")).toBeUndefined();
  });

  it("rebases an open session when its admitted draft converges authoritatively", () => {
    const admitted = Object.freeze({ ...row, score: 4 });
    const converged = Object.freeze({ ...row, score: 7 });
    let current: Row = admitted;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate === converged ? 2n : 1n),
    });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate("8", false);

    current = converged;
    runtime.reconcileSourceRows(new Set([row.id]));
    runtime.reconcileActiveRow(new Set([row.id]));
    expect(runtime.commit("8")).toBe(true);

    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        baseRow: converged,
        expectedVersion: 2n,
        base: 7,
        mine: 8,
      },
    ]);
  });

  it("blocks a converged open session until Row Version rebasing succeeds", () => {
    const admitted = Object.freeze({ ...row, score: 4 });
    const converged = Object.freeze({ ...row, score: 7 });
    let current: Row = admitted;
    let extractorAvailable = true;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => {
        if (!extractorAvailable) throw new Error("Row Version unavailable");
        return candidate === converged ? 2n : 1n;
      },
    });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate("8", false);

    current = converged;
    extractorAvailable = false;
    runtime.reconcileSourceRows(new Set([row.id]));
    runtime.reconcileActiveRow(new Set([row.id]));
    expect(runtime.commit("8")).toBe(false);
    expect(runtime.getActiveCandidateSnapshot()).toMatchObject({ rawText: "8" });
    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: expect.stringContaining("Row Version"),
    });

    extractorAvailable = true;
    runtime.reconcileActiveRow(new Set([row.id]));
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { baseRow: converged, expectedVersion: 2n, base: 7, mine: 8 },
    ]);
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

  it("prunes redo history when the source reaches the chronologically latest Mine", () => {
    let current: Row = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot()).toMatchObject({ redoCount: 2 });

    current = Object.freeze({ ...row, score: 8 });
    runtime.reconcileSourceRows(new Set([row.id]));

    expect(runtime.getActivitySnapshot()).toMatchObject({ redoCount: 0 });
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

  it("publishes coherent candidate activity and Reset Review evidence in one batch", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    const unsubscribeReview = runtime.subscribeDraftReview(vi.fn());
    const observedCandidateText: Array<string | undefined> = [];
    const unsubscribeActivity = runtime.subscribeActivity(() => {
      observedCandidateText.push(runtime.getDraftReviewSnapshot()[0]?.candidateText);
    });

    runtime.updateActiveCandidate("7", false);

    expect(observedCandidateText).toEqual(["7"]);
    unsubscribeActivity();
    unsubscribeReview();
  });

  it("refreshes observed Reset Review rows after compatible presentation changes", () => {
    type TextRow = Readonly<{ readonly id: string; readonly value: string }>;
    const source: TextRow = Object.freeze({ id: "row", value: "server" });
    const makeColumns = (headerName: string) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName,
          valueType: "text",
          isEditable: true,
          valueFormatter: ({ value }: { readonly value: string }) => `${headerName}:${value}`,
        },
      ] satisfies BrunoTableColumns<TextRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns("Before"),
      getRow: () => source,
    });
    expect(runtime.start(source.id, "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("mine")).toBe(true);
    const membershipListener = vi.fn();
    const unsubscribe = runtime.subscribeDraftReview(membershipListener);

    runtime.reconcileColumns(makeColumns("After"));

    expect(membershipListener).toHaveBeenCalledOnce();
    expect(runtime.getDraftReviewSourceSnapshot()[0]?.columnLabel).toBe("After");
    expect(runtime.getDraftReviewSourceSnapshot()[0]?.getSnapshot().column.headerName).toBe(
      "After",
    );
    unsubscribe();
  });

  it("publishes one traversal invalidation for a multi-draft column reconcile", () => {
    const liveRows = new Map<string, Row>([
      ["row-a", Object.freeze({ ...row, id: "row-a" })],
      ["row-b", Object.freeze({ ...row, id: "row-b" })],
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => liveRows.get(rowId),
    });
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
    const listener = vi.fn();
    runtime.subscribeTraversalInvalidation(listener);

    runtime.reconcileColumns(columns.filter((column) => column.columnId !== "COL_ID_SCORE"));

    expect(listener).toHaveBeenCalledOnce();
  });

  it("publishes one traversal invalidation when resetting multiple drafts", () => {
    const liveRows = new Map<string, Row>([
      ["row-a", Object.freeze({ ...row, id: "row-a" })],
      ["row-b", Object.freeze({ ...row, id: "row-b" })],
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => liveRows.get(rowId),
    });
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
    const listener = vi.fn();
    runtime.subscribeTraversalInvalidation(listener);

    expect(runtime.resetAllDrafts()).toBe(2);

    expect(listener).toHaveBeenCalledOnce();
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

  it("bulk-prunes converged cells while preserving one divergent history patch", () => {
    const liveRows = new Map<string, Row>();
    const changes = Array.from({ length: 34 }, (_, index) => {
      const rowId = `row-${String(index)}`;
      const baseRow = Object.freeze({ ...row, id: rowId });
      liveRows.set(rowId, baseRow);
      return {
        rowId,
        columnId: "COL_ID_SCORE",
        field: "score" as const,
        baseRow,
        expectedVersion: 1n,
        base: 4,
        mine: index < 33 ? 7 : 8,
      };
    });
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => liveRows.get(rowId),
    });
    runtime.setBatchHistoryEnabled(true);
    const firstChange = changes[0];
    if (firstChange === undefined) throw new Error("Expected a non-empty bulk gesture.");
    expect(runtime.applyAcceptedDraftGesture([firstChange, ...changes.slice(1)])).toBe(true);
    for (let index = 0; index < 33; index += 1) {
      const rowId = `row-${String(index)}`;
      liveRows.set(rowId, Object.freeze({ ...row, id: rowId, score: 7 }));
    }

    runtime.reconcileSourceRows(undefined);

    expect(runtime.getActivitySnapshot()).toMatchObject({ draftCount: 1, undoCount: 1 });
    expect(runtime.getRetainedDraftDependencyCellCount()).toBe(1);
    for (let index = 0; index < 33; index += 1) {
      expect(runtime.getDraftSnapshot(`row-${String(index)}`, "COL_ID_SCORE")).toBeUndefined();
    }
    expect(runtime.getDraftSnapshot("row-33", "COL_ID_SCORE")).toBe(8);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getRetainedDraftDependencyCellCount()).toBe(1);
    expect(runtime.redoBatchDraft()).toBe(true);
    for (let index = 0; index < 33; index += 1) {
      expect(runtime.getDraftSnapshot(`row-${String(index)}`, "COL_ID_SCORE")).toBeUndefined();
    }
    expect(runtime.getDraftSnapshot("row-33", "COL_ID_SCORE")).toBe(8);
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

  it("releases unmounted cell stores after temporary save presentation ends", () => {
    vi.useFakeTimers();
    try {
      const changeSet = [
        {
          rowId: row.id,
          baseRow: row,
          expectedVersion: row.quantity,
          changes: [
            {
              columnId: "COL_ID_SCORE",
              field: "score",
              before: row.score,
              after: 7,
            },
          ],
        },
      ] as const;

      let acceptedRow = row;
      const accepted = new BrunoTableCellEditRuntime({
        columns,
        getRow: () => acceptedRow,
        getRowVersion: (candidate) => (candidate as Row).quantity,
      });
      const unsubscribeAccepted = accepted.subscribeCell(row.id, "COL_ID_SCORE", () => undefined);
      expect(accepted.beginSaveOperation("accepted", changeSet, false)).toBe(true);
      accepted.acceptSave("accepted", changeSet, false);
      acceptedRow = Object.freeze({ ...row, score: 7 });
      accepted.reconcileSourceRows(new Set([row.id]));
      unsubscribeAccepted();
      expect(accepted.getRetainedCellStoreCount()).toBe(1);
      vi.advanceTimersByTime(2_000);
      expect(accepted.getRetainedCellStoreCount()).toBe(0);

      const immediate = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
      const unsubscribeImmediate = immediate.subscribeCell(row.id, "COL_ID_SCORE", () => undefined);
      immediate.rejectSave("immediate", changeSet, true);
      unsubscribeImmediate();
      expect(immediate.getRetainedCellStoreCount()).toBe(1);
      vi.advanceTimersByTime(5_000);
      expect(immediate.getRetainedCellStoreCount()).toBe(0);

      let batchRow = row;
      const rejectedBatch = new BrunoTableCellEditRuntime({
        columns,
        getRow: () => batchRow,
      });
      const unsubscribeBatch = rejectedBatch.subscribeCell(row.id, "COL_ID_SCORE", () => undefined);
      rejectedBatch.rejectSave("batch", changeSet, false);
      unsubscribeBatch();
      expect(rejectedBatch.getRetainedCellStoreCount()).toBe(1);
      batchRow = Object.freeze({ ...row, score: 7 });
      rejectedBatch.reconcileSourceRows(new Set([row.id]));
      expect(rejectedBatch.getRetainedCellStoreCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
    expect(capabilityRuntime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("draft");
    expect(capabilityRuntime.getDraftReviewSnapshot()).toMatchObject([
      { mine: "draft", blockedReason: "This cell is no longer editable." },
    ]);

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

  it("retains Batch history while static column editability is revoked and restored", () => {
    const liveRow = { value: "source" };
    const compileTextColumns = (isEditable: boolean) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable,
        },
      ]);
    const getRow = vi.fn(() => liveRow);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileTextColumns(true),
      getRow,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("draft")).toBe(true);

    const memoryBeforeEquivalentRecompile = runtime.getDraftMemorySnapshot();
    const activity = vi.fn();
    const cell = vi.fn();
    const traversal = vi.fn();
    const unsubscribers = [
      runtime.subscribeActivity(activity),
      runtime.subscribeCell("row", "COL_ID_VALUE", cell),
      runtime.subscribeTraversalInvalidation(traversal),
    ];
    getRow.mockClear();
    runtime.reconcileColumns(compileTextColumns(true));
    expect(runtime.getDraftMemorySnapshot()).toBe(memoryBeforeEquivalentRecompile);
    expect(getRow).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
    expect(cell).not.toHaveBeenCalled();
    expect(traversal).not.toHaveBeenCalled();

    runtime.reconcileColumns(compileTextColumns(false));
    expect(getRow).toHaveBeenCalledOnce();
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("draft");
    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 1,
      undoCount: 1,
      blockedCount: 1,
    });

    runtime.reconcileColumns(compileTextColumns(true));
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { mine: "draft", blockedReason: undefined },
    ]);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("draft");
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("retains compatible Batch history across decoder and blank-policy recompiles", () => {
    type OptionalTextRow = Readonly<{ readonly value: string | null | undefined }>;
    const liveRow: OptionalTextRow = { value: "source" };
    const decoder = (input: unknown) =>
      typeof input === "string"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected text." } as const);
    const compileTextColumns = (decodeRuntime: typeof decoder, blankValue: null | undefined) => {
      const valueType: BrunoTableValueType<string> = {
        codecId: "test/history-recompile",
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: Object.is,
        compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: String,
        encodePersisted: String,
        decodePersisted: decodeRuntime,
      };
      return compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType,
          isEditable: true,
          blankValue,
        },
      ] satisfies BrunoTableColumns<OptionalTextRow>);
    };

    for (const replacement of [
      compileTextColumns((input) => decoder(input), undefined),
      compileTextColumns(decoder, null),
    ]) {
      const runtime = new BrunoTableCellEditRuntime({
        columns: compileTextColumns(decoder, undefined),
        getRow: () => liveRow,
      });
      runtime.setBatchHistoryEnabled(true);
      expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("draft")).toBe(true);

      runtime.reconcileColumns(replacement);
      expect(runtime.getActivitySnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
      expect(runtime.undoBatchDraft()).toBe(true);
      expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBeUndefined();
      expect(runtime.redoBatchDraft()).toBe(true);
      expect(runtime.getDraftSnapshot("row", "COL_ID_VALUE")).toBe("draft");
      runtime.dispose();
    }
  });

  it("migrates complete Conflict evidence through compatible column semantics", () => {
    type ConflictRow = Readonly<{ readonly value: string }>;
    const liveRow: ConflictRow = { value: "source-a" };
    const makeColumns = (suffix: "a" | "b") => {
      const decodeRuntime = (input: unknown) =>
        typeof input === "string"
          ? ({
              _tag: "Success",
              value: `${input.replace(/-[ab]$/, "")}-${suffix}`,
            } as const)
          : ({ _tag: "Failure", message: "Expected text." } as const);
      const valueType: BrunoTableValueType<string> = {
        codecId: `test/conflict-migration-${suffix}`,
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: Object.is,
        compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: String,
        encodePersisted: String,
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
      ] satisfies BrunoTableColumns<ConflictRow>);
    };
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns("a"),
      getRow: () => liveRow,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "row",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: liveRow,
          expectedVersion: 1,
          base: "base-a",
          mine: "mine-a",
          conflict: { server: "server-a", resolution: "mine" },
        },
      ]),
    ).toBe(true);

    runtime.reconcileColumns(makeColumns("b"));
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        base: "base-b",
        mine: "mine-b",
        conflict: { server: "server-b", resolution: "mine" },
      },
    ]);
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        base: "base-b",
        mine: "mine-b",
        conflict: { server: "server-b", resolution: "mine" },
      },
    ]);
  });

  it("prunes semantic convergence from current and redo-only history on column recompile", () => {
    type CanonicalRow = Readonly<{ readonly value: string }>;
    const liveRow: CanonicalRow = { value: "A" };
    const makeColumns = (canonicalize: boolean) => {
      const decodeRuntime = (input: unknown) =>
        typeof input === "string"
          ? ({ _tag: "Success", value: canonicalize ? input.toLowerCase() : input } as const)
          : ({ _tag: "Failure", message: "Expected text." } as const);
      const valueType: BrunoTableValueType<string> = {
        codecId: canonicalize ? "test/lowercase" : "test/identity",
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: Object.is,
        compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: String,
        encodePersisted: String,
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

    for (const undoBeforeRecompile of [false, true]) {
      const runtime = new BrunoTableCellEditRuntime({
        columns: makeColumns(false),
        getRow: () => liveRow,
      });
      runtime.setBatchHistoryEnabled(true);
      expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
      expect(runtime.commit("a")).toBe(true);
      if (undoBeforeRecompile) expect(runtime.undoBatchDraft()).toBe(true);
      const cell = vi.fn();
      const traversal = vi.fn();
      const unsubscribeCell = runtime.subscribeCell("row", "COL_ID_VALUE", cell);
      const unsubscribeTraversal = runtime.subscribeTraversalInvalidation(traversal);

      runtime.reconcileColumns(makeColumns(true));

      expect(runtime.getDraftReviewSnapshot()).toHaveLength(0);
      expect(runtime.getActivitySnapshot()).toMatchObject({
        draftCount: 0,
        undoCount: 0,
        redoCount: 0,
      });
      expect(runtime.undoBatchDraft()).toBe(false);
      expect(runtime.redoBatchDraft()).toBe(false);
      if (undoBeforeRecompile) {
        expect(cell).not.toHaveBeenCalled();
        expect(traversal).not.toHaveBeenCalled();
      } else {
        expect(cell).toHaveBeenCalledOnce();
        expect(traversal).toHaveBeenCalledOnce();
      }
      unsubscribeCell();
      unsubscribeTraversal();
      runtime.dispose();
    }
  });

  it("prunes a draft that becomes semantically equal to its Base on column recompile", () => {
    type CanonicalRow = Readonly<{ readonly value: string }>;
    const liveRow: CanonicalRow = { value: "B" };
    const decodeRuntime = (input: unknown) =>
      typeof input === "string"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected text." } as const);
    const makeColumns = (caseInsensitive: boolean) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: {
            codecId: "test/base-equivalence-convergence",
            codecVersion: 1,
            filterFamily: "text",
            editorFamily: "text",
            cellAlign: "start",
            editorLayout: "inline",
            defaultWidth: 120,
            decodeRuntime,
            equivalent: caseInsensitive
              ? (left: string, right: string) => left.toLowerCase() === right.toLowerCase()
              : Object.is,
            compare: (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1),
            formatCanonicalText: String,
            parseCanonicalText: (text: string) => ({ _tag: "Success", value: text }) as const,
            formatDisplay: String,
            encodePersisted: String,
            decodePersisted: decodeRuntime,
          },
          isEditable: true,
        },
      ] satisfies BrunoTableColumns<CanonicalRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns(false),
      getRow: () => liveRow,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "row",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: { value: "A" },
          expectedVersion: 1,
          base: "A",
          mine: "a",
        },
      ]),
    ).toBe(true);

    runtime.reconcileColumns(makeColumns(true));

    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 0,
      undoCount: 0,
      redoCount: 0,
    });
    expect(runtime.getDraftReviewSnapshot()).toHaveLength(0);
    expect(runtime.undoBatchDraft()).toBe(false);
    runtime.dispose();
  });

  it("publishes equivalence-only redo convergence and removes its retained dependency", () => {
    type CanonicalRow = Readonly<{ readonly value: string }>;
    const rows = new Map<string, CanonicalRow>([
      ["drop", { value: "B" }],
      ["keep", { value: "source" }],
    ]);
    const decodeRuntime = (input: unknown) =>
      typeof input === "string"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected text." } as const);
    const makeColumns = (caseInsensitive: boolean) => {
      const valueType: BrunoTableValueType<string> = {
        codecId: "test/equivalence-only-convergence",
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: caseInsensitive
          ? (left, right) => left.toLowerCase() === right.toLowerCase()
          : Object.is,
        compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: String,
        encodePersisted: String,
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
    const getRow = vi.fn((rowId: string) => rows.get(rowId));
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns(false),
      getRow,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "drop",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: { value: "A" },
          expectedVersion: 1,
          base: "A",
          mine: "a",
        },
        {
          rowId: "keep",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: rows.get("keep")!,
          expectedVersion: 1,
          base: "source",
          mine: "draft",
        },
      ]),
    ).toBe(true);
    expect(runtime.undoBatchDraft()).toBe(true);
    const cell = vi.fn();
    const traversal = vi.fn();
    const unsubscribers = [
      runtime.subscribeCell("drop", "COL_ID_VALUE", cell),
      runtime.subscribeTraversalInvalidation(traversal),
    ];

    runtime.reconcileColumns(makeColumns(true));

    expect(runtime.getActivitySnapshot()).toMatchObject({ redoCount: 1 });
    expect(cell).not.toHaveBeenCalled();
    expect(traversal).not.toHaveBeenCalled();
    getRow.mockClear();
    runtime.reconcileSourceRows(new Set(["drop"]));
    expect(getRow).not.toHaveBeenCalled();
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("drop", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.getDraftSnapshot("keep", "COL_ID_VALUE")).toBe("draft");
    for (const unsubscribe of unsubscribers) unsubscribe();

    const singleRuntime = new BrunoTableCellEditRuntime({
      columns: makeColumns(false),
      getRow: () => rows.get("drop"),
    });
    singleRuntime.setBatchHistoryEnabled(true);
    expect(
      singleRuntime.applyAcceptedDraftGesture([
        {
          rowId: "drop",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: { value: "A" },
          expectedVersion: 1,
          base: "A",
          mine: "a",
        },
      ]),
    ).toBe(true);
    expect(singleRuntime.undoBatchDraft()).toBe(true);
    const activity = vi.fn();
    const singleCell = vi.fn();
    const singleTraversal = vi.fn();
    const singleUnsubscribers = [
      singleRuntime.subscribeActivity(activity),
      singleRuntime.subscribeCell("drop", "COL_ID_VALUE", singleCell),
      singleRuntime.subscribeTraversalInvalidation(singleTraversal),
    ];
    singleRuntime.reconcileColumns(makeColumns(true));
    expect(singleRuntime.getActivitySnapshot()).toMatchObject({ redoCount: 0 });
    expect(singleRuntime.redoBatchDraft()).toBe(false);
    expect(activity).toHaveBeenCalledOnce();
    expect(singleCell).not.toHaveBeenCalled();
    expect(singleTraversal).not.toHaveBeenCalled();
    for (const unsubscribe of singleUnsubscribers) unsubscribe();
  });

  it("partially migrates one multi-cell command with one coherent publication", () => {
    type MigrationRow = Readonly<{ readonly value: string }>;
    const rows = new Map<string, MigrationRow>([
      ["drop", { value: "source-drop-a" }],
      ["keep", { value: "source-keep-a" }],
    ]);
    const makeColumns = (migrate: boolean) => {
      const decodeRuntime = (input: unknown) => {
        if (typeof input !== "string" || (migrate && input.startsWith("reject"))) {
          return { _tag: "Failure", message: "Rejected." } as const;
        }
        return {
          _tag: "Success",
          value: migrate ? `${input.replace(/-[ab]$/, "")}-b` : input,
        } as const;
      };
      const valueType: BrunoTableValueType<string> = {
        codecId: migrate ? "test/partial-b" : "test/partial-a",
        codecVersion: 1,
        filterFamily: "text",
        editorFamily: "text",
        cellAlign: "start",
        editorLayout: "inline",
        defaultWidth: 120,
        decodeRuntime,
        equivalent: Object.is,
        compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
        formatDisplay: String,
        encodePersisted: String,
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
      ] satisfies BrunoTableColumns<MigrationRow>);
    };
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns(false),
      getRow: (rowId) => rows.get(rowId),
    });
    runtime.setBatchHistoryEnabled(true);
    expect(
      runtime.applyAcceptedDraftGesture([
        {
          rowId: "drop",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: rows.get("drop")!,
          expectedVersion: 1,
          base: "base-drop-a",
          mine: "mine-drop-a",
          conflict: { server: "reject-a" },
        },
        {
          rowId: "keep",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: rows.get("keep")!,
          expectedVersion: 1,
          base: "base-keep-a",
          mine: "mine-keep-a",
        },
      ]),
    ).toBe(true);
    runtime.getDraftReviewSnapshot();
    const activity = vi.fn();
    const review = vi.fn();
    const traversal = vi.fn();
    const droppedCell = vi.fn();
    const keptCell = vi.fn();
    const unsubscribers = [
      runtime.subscribeActivity(activity),
      runtime.subscribeDraftReview(review),
      runtime.subscribeTraversalInvalidation(traversal),
      runtime.subscribeCell("drop", "COL_ID_VALUE", droppedCell),
      runtime.subscribeCell("keep", "COL_ID_VALUE", keptCell),
    ];

    runtime.reconcileColumns(makeColumns(true));

    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { rowId: "keep", base: "base-keep-b", mine: "mine-keep-b" },
    ]);
    expect(activity).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
    expect(traversal).toHaveBeenCalledOnce();
    expect(droppedCell).toHaveBeenCalledOnce();
    expect(keptCell).toHaveBeenCalledOnce();
    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("drop", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.getDraftSnapshot("keep", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getDraftSnapshot("drop", "COL_ID_VALUE")).toBeUndefined();
    expect(runtime.getDraftSnapshot("keep", "COL_ID_VALUE")).toBe("mine-keep-b");
    for (const unsubscribe of unsubscribers) unsubscribe();
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

  it("drops a draft when a replacement runtime decoder throws", () => {
    type CanonicalRow = Readonly<{ readonly value: string }>;
    const makeColumns = (throws: boolean) => {
      const decodeRuntime = (input: unknown) => {
        if (throws) throw new Error("consumer decoder escaped");
        return { _tag: "Success", value: String(input) } as const;
      };
      return compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: {
            codecId: throws ? "test/throwing-decoder" : "test/stable-decoder",
            codecVersion: 1,
            filterFamily: "text",
            editorFamily: "text",
            cellAlign: "start",
            editorLayout: "inline",
            defaultWidth: 120,
            decodeRuntime,
            equivalent: Object.is,
            compare: () => 0 as const,
            formatCanonicalText: String,
            parseCanonicalText: (text: string) => ({ _tag: "Success", value: text }) as const,
            formatDisplay: String,
            encodePersisted: String,
            decodePersisted: decodeRuntime,
          },
          isEditable: true,
        },
      ] satisfies BrunoTableColumns<CanonicalRow>);
    };
    const source: CanonicalRow = { value: "base" };
    const runtime = new BrunoTableCellEditRuntime({
      columns: makeColumns(false),
      getRow: () => source,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    expect(runtime.commit("mine")).toBe(true);

    expect(() => runtime.reconcileColumns(makeColumns(true))).not.toThrow();
    expect(runtime.getDraftReviewSnapshot()).toHaveLength(0);
  });

  it("reuses retained invalid-candidate evidence while Reset Review is observed", () => {
    type ValidatedRow = Readonly<{ readonly value: number }>;
    const validate = vi.fn(({ value }: { readonly value: number }) =>
      value <= 10 ? undefined : "Too large.",
    );
    const validatedColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: true,
        validate,
      },
    ] satisfies BrunoTableColumns<ValidatedRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: validatedColumns,
      getRow: () => ({ value: 4 }),
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("11", false);
    expect(runtime.commit("11")).toBe(false);
    expect(validate).toHaveBeenCalledOnce();

    const unsubscribe = runtime.subscribeDraftReview(vi.fn());

    expect(validate).toHaveBeenCalledOnce();
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { candidateText: "11", candidateInvalid: true, status: "Too large." },
    ]);
    unsubscribe();
  });

  it("projects retained native-invalid and source-blocking candidate evidence", () => {
    type CandidateRow = Readonly<{ readonly value: number }>;
    let current: CandidateRow | undefined = { value: 4 };
    const validate = vi.fn(() => undefined);
    const candidateColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: ({ value }: { readonly value: number }) => value >= 0,
        validate,
      },
    ] satisfies BrunoTableColumns<CandidateRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: candidateColumns,
      getRow: () => current,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    runtime.updateActiveCandidate("not-a-number", true);
    const unsubscribe = runtime.subscribeDraftReview(vi.fn());

    expect(validate).not.toHaveBeenCalled();
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      {
        candidateText: "not-a-number",
        candidateInvalid: true,
        status: "Enter a valid number.",
      },
    ]);

    current = undefined;
    runtime.reconcileActiveRow(new Set(["row"]));
    expect(runtime.getActivitySnapshot()).toMatchObject({ blockedCount: 1 });
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { status: "This row was removed from the server. Changes cannot be saved." },
    ]);

    current = { value: -1 };
    runtime.reconcileActiveRow(new Set(["row"]));
    expect(runtime.getActivitySnapshot()).toMatchObject({ blockedCount: 1 });
    expect(runtime.getDraftReviewSnapshot()).toMatchObject([
      { status: "This cell is no longer editable." },
    ]);
    expect(validate).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not publish untouched permission loss as candidate work", () => {
    type CandidateRow = Readonly<{ readonly value: number }>;
    let current: CandidateRow = { value: 4 };
    const candidateColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: ({ value }: { readonly value: number }) => value >= 0,
      },
    ] satisfies BrunoTableColumns<CandidateRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: candidateColumns,
      getRow: () => current,
    });
    expect(runtime.start("row", "COL_ID_VALUE")).toBe(true);
    const unsubscribe = runtime.subscribeDraftReview(vi.fn());

    current = { value: -1 };
    runtime.reconcileActiveRow(new Set(["row"]));

    expect(runtime.getSessionSnapshot()).toMatchObject({
      kind: "editing",
      invalidMessage: "This cell is no longer editable.",
    });
    expect(runtime.getActivitySnapshot()).toMatchObject({
      activeEditor: true,
      activeCandidatePending: false,
      reviewCount: 0,
      blockedCount: 0,
    });
    expect(runtime.getDraftReviewSnapshot()).toHaveLength(0);
    unsubscribe();
  });

  it("does not double-count a blocked draft and active candidate for the same cell", () => {
    let current: Row | undefined = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    runtime.updateActiveCandidate("8", false);

    current = undefined;
    runtime.reconcileSourceRows(new Set([row.id]));
    runtime.reconcileActiveRow(new Set([row.id]));

    expect(runtime.getActivitySnapshot()).toMatchObject({ blockedCount: 1, reviewCount: 1 });
  });

  it("preserves an undefined canonical value in an Accepted Overlay", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    let unsubscribe = (): void => undefined;

    try {
      vi.useFakeTimers();
      unsubscribe = runtime.subscribeCell(row.id, "COL_ID_SCORE", () => undefined);
      runtime.acceptSave(
        "operation-1",
        [
          {
            rowId: row.id,
            baseRow: row,
            expectedVersion: 1n,
            changes: [
              {
                columnId: "COL_ID_SCORE",
                field: "score",
                before: row.score,
                after: undefined,
              },
            ],
          },
        ],
        false,
      );

      expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE")).toEqual({
        active: false,
        hasDraft: false,
        hasAcceptedOverlay: true,
        saveSucceeded: true,
        acceptedOverlay: undefined,
      });
      vi.advanceTimersByTime(1_999);
      expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveSucceeded).toBe(true);
      vi.advanceTimersByTime(1);
      expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveSucceeded).toBeUndefined();
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it("invalidates only Immediate operation rows in predicate traversal", () => {
    type SaveRow = Readonly<{
      readonly id: string;
      readonly value: string;
      readonly revision: bigint;
    }>;
    const saveRows = new Map<string, SaveRow>([
      ["row-a", { id: "row-a", value: "source", revision: 1n }],
      ["row-b", { id: "row-b", value: "source", revision: 1n }],
      ["row-c", { id: "row-c", value: "source", revision: 1n }],
    ]);
    const rowReads: string[] = [];
    const saveColumns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: ({ value }: { readonly value: string }) => value.length > 0,
      },
    ] satisfies BrunoTableColumns<SaveRow>);
    const runtime = new BrunoTableCellEditRuntime({
      columns: saveColumns,
      getRow: (rowId) => {
        rowReads.push(rowId);
        return saveRows.get(rowId);
      },
      getRowVersion: (candidate) => (candidate as SaveRow).revision,
    });
    const rowIds = [...saveRows.keys()];
    const rowSpace = {
      totalRows: rowIds.length,
      getRowId: (rowIndex: number) => rowIds[rowIndex],
    };
    runtime.reconcileTraversal(saveColumns, rowSpace);
    const drainTraversal = () => {
      runtime.reconcileTraversal(saveColumns, rowSpace);
      for (let index = 0; !runtime.isTraversalReady() && index < 10; index += 1) {
        runtime.buildTraversalSlice();
      }
      expect(runtime.isTraversalReady()).toBe(true);
    };
    drainTraversal();
    rowReads.length = 0;
    const baseRow = saveRows.get("row-a")!;
    const changeSet: BrunoTableCellEditSaveChangeSet = [
      {
        rowId: "row-a",
        baseRow,
        expectedVersion: baseRow.revision,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "source",
            after: "saved",
          },
        ],
      },
    ];

    expect(runtime.beginSaveOperation("immediate-row", changeSet, false)).toBe(true);
    drainTraversal();
    expect(rowReads).toEqual(["row-a"]);

    runtime.acceptSave("immediate-row", changeSet, false);
    saveRows.set("row-a", { id: "row-a", value: "saved", revision: 2n });
    runtime.reconcileSourceRows(new Set(["row-a"]));
    rowReads.length = 0;
    drainTraversal();
    expect(rowReads).toEqual(["row-a"]);
  });

  it("retains rejected operation evidence until that operation fully converges", () => {
    let current = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    const activityBeforeRejection = runtime.getActivitySnapshot();
    const changeSet = runtime.createBatchSaveChangeSet();
    expect(changeSet).toBeDefined();

    runtime.rejectSave("operation-1", changeSet!, false);
    expect(runtime.hasRejectedOperation("operation-1")).toBe(true);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE")).toMatchObject({
      hasDraft: true,
      draft: 7,
      saveFailed: true,
    });
    expect(runtime.getActivitySnapshot()).toEqual(activityBeforeRejection);

    current = Object.freeze({ ...row, score: 7 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.hasRejectedOperation("operation-1")).toBe(false);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE")).toEqual({
      active: false,
      hasDraft: false,
    });
  });

  it("retains an Accepted Overlay across a non-authoritative source gap", () => {
    let current: Row | undefined = row;
    let authoritative = true;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate as Row).quantity,
      isSourceAuthoritative: () => authoritative,
    });
    const changeSet = [
      {
        rowId: row.id,
        baseRow: row,
        expectedVersion: row.quantity,
        changes: [
          {
            columnId: "COL_ID_SCORE",
            field: "score",
            before: row.score,
            after: 7,
          },
        ],
      },
    ] as const;

    expect(runtime.beginSaveOperation("operation-loading", changeSet, false)).toBe(true);
    authoritative = false;
    current = undefined;
    runtime.acceptSave("operation-loading", changeSet, false);
    expect(runtime.getAcceptedOverlayCountForOperation("operation-loading")).toBe(1);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE")).toMatchObject({
      hasAcceptedOverlay: true,
      acceptedOverlay: 7,
      savePending: true,
    });

    authoritative = true;
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-loading")).toBe(0);
  });

  it("reconciles an Accepted Overlay with its captured Row Version extractor", () => {
    let current = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    const changeSet = [
      {
        rowId: row.id,
        baseRow: row,
        expectedVersion: row.quantity,
        changes: [
          {
            columnId: "COL_ID_SCORE",
            field: "score",
            before: row.score,
            after: 7,
          },
        ],
      },
    ] as const;

    expect(runtime.beginSaveOperation("operation-version-domain", changeSet, false)).toBe(true);
    runtime.setRowVersionExtractor(() => 999n);
    runtime.acceptSave("operation-version-domain", changeSet, false);
    expect(runtime.getAcceptedOverlayCountForOperation("operation-version-domain")).toBe(1);

    current = Object.freeze({ ...row, quantity: 2n });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-version-domain")).toBe(0);
  });

  it("turns rejected Batch source divergence into reversible conflict evidence", () => {
    let current = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    const changeSet = runtime.createBatchSaveChangeSet();
    expect(changeSet).toBeDefined();
    runtime.rejectSave("operation-diverged", changeSet!, false);

    current = Object.freeze({ ...row, score: 5 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getActivitySnapshot().conflictCount).toBe(1);
    expect(runtime.getDraftReviewSnapshot()[0]).toMatchObject({
      base: row.score,
      mine: 7,
      serverNow: 5,
      conflict: { server: 5 },
    });

    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot().conflictCount).toBe(0);
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot().conflictCount).toBe(1);
    expect(runtime.getDraftReviewSnapshot()[0]).toMatchObject({ conflict: { server: 5 } });
  });

  it("preserves undefined server values in rejected Batch conflict history", () => {
    type OptionalRow = Readonly<{
      readonly id: string;
      readonly optional: string | undefined;
      readonly version: bigint;
    }>;
    const optionalValueType: BrunoTableValueType<string | undefined, "equality", "text"> = {
      codecId: "test/rejected-batch-undefined",
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
      parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
      formatDisplay: (value) => value ?? "undefined",
      encodePersisted: (value) => value ?? null,
      decodePersisted: (input) =>
        typeof input === "string" || input === null
          ? { _tag: "Success", value: input ?? undefined }
          : { _tag: "Failure", message: "Expected persisted optional text." },
    };
    const initial: OptionalRow = { id: "optional", optional: "source", version: 1n };
    let current = initial;
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
      getRow: () => current,
      getRowVersion: (candidate) => (candidate as OptionalRow).version,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(initial.id, "COL_ID_OPTIONAL")).toBe(true);
    expect(runtime.commit("mine")).toBe(true);
    const changeSet = runtime.createBatchSaveChangeSet();
    expect(changeSet).toBeDefined();
    runtime.rejectSave("operation-undefined", changeSet!, false);

    current = Object.freeze({ ...initial, optional: undefined, version: 2n });
    runtime.reconcileSourceRows(new Set([initial.id]));
    expect(runtime.getActivitySnapshot().conflictCount).toBe(1);
    expect(runtime.getDraftReviewSnapshot()[0]?.conflict).toStrictEqual({ server: undefined });

    expect(runtime.undoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot().conflictCount).toBe(0);
    expect(runtime.redoBatchDraft()).toBe(true);
    expect(runtime.getActivitySnapshot().conflictCount).toBe(1);
    expect(runtime.getDraftReviewSnapshot()[0]?.conflict).toStrictEqual({ server: undefined });
  });

  it("prunes rejected cells independently while retaining the operation remainder", () => {
    let current = row;
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => current });
    const changeSet = [
      {
        rowId: row.id,
        baseRow: row,
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_QUANTITY",
            field: "quantity",
            before: row.quantity,
            after: row.quantity + 1n,
          },
          {
            columnId: "COL_ID_SCORE",
            field: "score",
            before: row.score,
            after: 7,
          },
        ],
      },
    ] as const;

    runtime.rejectSave("operation-partial", changeSet, false);
    current = Object.freeze({ ...row, quantity: row.quantity + 1n });
    runtime.reconcileSourceRows(new Set([row.id]));

    expect(runtime.hasRejectedOperation("operation-partial")).toBe(true);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_QUANTITY").saveFailed).toBeUndefined();
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBe(true);

    current = Object.freeze({ ...current, score: 7 });
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.hasRejectedOperation("operation-partial")).toBe(false);
  });

  it("supersedes a rejected Batch operation when its draft is corrected", () => {
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    const changeSet = runtime.createBatchSaveChangeSet();
    expect(changeSet).toBeDefined();
    runtime.rejectSave("operation-corrected", changeSet!, false);
    expect(runtime.hasRejectedOperation("operation-corrected")).toBe(true);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBe(true);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);

    expect(runtime.hasRejectedOperation("operation-corrected")).toBe(false);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE")).toMatchObject({
      hasDraft: true,
      draft: 8,
    });
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBeUndefined();
  });

  it("retains untouched rejected Batch cells after a partial correction", () => {
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.commit(String(row.quantity + 1n))).toBe(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    const changeSet = runtime.createBatchSaveChangeSet();
    expect(changeSet).toBeDefined();
    runtime.rejectSave("operation-partial-correction", changeSet!, false);

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);
    expect(runtime.hasRejectedOperation("operation-partial-correction")).toBe(true);
    expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBeUndefined();
    expect(runtime.getCellSnapshot(row.id, "COL_ID_QUANTITY").saveFailed).toBe(true);

    expect(runtime.start(row.id, "COL_ID_QUANTITY")).toBe(true);
    expect(runtime.commit(String(row.quantity + 2n))).toBe(true);
    expect(runtime.hasRejectedOperation("operation-partial-correction")).toBe(false);
  });

  it("reconciles save evidence with the submitted value equivalence authority", () => {
    type TextRow = Readonly<{ readonly id: string; readonly value: string }>;
    const source: TextRow = { id: "text", value: "foo" };
    const compileTextColumns = (caseInsensitive: boolean) => {
      const valueType: BrunoTableValueType<string> = {
        codecId: "test/submitted-equivalence",
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
        equivalent: caseInsensitive
          ? (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase()
          : Object.is,
        compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
        formatCanonicalText: String,
        parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
        formatDisplay: String,
        encodePersisted: String,
        decodePersisted: (input) =>
          typeof input === "string"
            ? { _tag: "Success", value: input }
            : { _tag: "Failure", message: "Expected persisted text." },
      };
      return compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType,
          isEditable: true,
        },
      ]);
    };
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileTextColumns(false),
      getRow: () => source,
    });
    const changeSet = [
      {
        rowId: source.id,
        baseRow: source,
        expectedVersion: undefined,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "foo",
            after: "FOO",
          },
        ],
      },
    ] as const;

    expect(runtime.beginSaveOperation("operation-equivalence", changeSet, false)).toBe(true);
    runtime.acceptSave("operation-equivalence", changeSet, false);
    expect(runtime.getAcceptedOverlayCountForOperation("operation-equivalence")).toBe(1);

    runtime.reconcileColumns(compileTextColumns(true));
    runtime.reconcileSourceRows(new Set([source.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-equivalence")).toBe(1);
  });

  it("reconciles save evidence with the submitted field authority", () => {
    type FieldSwapRow = Readonly<{
      readonly id: string;
      readonly original: string;
      readonly replacement: string;
    }>;
    let source: FieldSwapRow = {
      id: "field-swap",
      original: "before",
      replacement: "saved",
    };
    const compileField = (field: "original" | "replacement") =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field,
          headerName: "Value",
          valueType: "text",
          isEditable: true,
        },
      ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileField("original"),
      getRow: () => source,
    });
    const changeSet = [
      {
        rowId: source.id,
        baseRow: source,
        expectedVersion: undefined,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "original",
            before: "before",
            after: "saved",
          },
        ],
      },
    ] as const;

    expect(runtime.beginSaveOperation("operation-field", changeSet, false)).toBe(true);
    runtime.acceptSave("operation-field", changeSet, false);
    runtime.reconcileColumns(compileField("replacement"));
    runtime.reconcileSourceRows(new Set([source.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-field")).toBe(1);

    source = { ...source, original: "saved" };
    runtime.reconcileSourceRows(new Set([source.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-field")).toBe(0);
  });

  it("reconciles save evidence with the submitted decoder authority", () => {
    type DecoderRow = Readonly<{ readonly id: string; readonly value: string }>;
    let source: DecoderRow = { id: "decoder", value: "before" };
    const createValueType = (constantSavedDecoder: boolean): BrunoTableValueType<string> => ({
      codecId: constantSavedDecoder ? "test/replacement-decoder" : "test/submitted-decoder",
      codecVersion: 1,
      filterFamily: "text",
      editorFamily: "text",
      cellAlign: "start",
      editorLayout: "inline",
      defaultWidth: 120,
      decodeRuntime: (input) =>
        typeof input === "string"
          ? { _tag: "Success", value: constantSavedDecoder ? "saved" : input }
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
          : { _tag: "Failure", message: "Expected persisted text." },
    });
    const compileDecoder = (constantSavedDecoder: boolean) =>
      compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: createValueType(constantSavedDecoder),
          isEditable: true,
        },
      ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns: compileDecoder(false),
      getRow: () => source,
    });
    const changeSet = [
      {
        rowId: source.id,
        baseRow: source,
        expectedVersion: undefined,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "before",
            after: "saved",
          },
        ],
      },
    ] as const;

    expect(runtime.beginSaveOperation("operation-decoder", changeSet, false)).toBe(true);
    runtime.acceptSave("operation-decoder", changeSet, false);
    runtime.reconcileColumns(compileDecoder(true));
    runtime.reconcileSourceRows(new Set([source.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-decoder")).toBe(1);

    source = { ...source, value: "saved" };
    runtime.reconcileSourceRows(new Set([source.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-decoder")).toBe(0);
  });

  it("keeps Immediate candidates and save preflight closed while the source is non-authoritative", () => {
    let authoritative = true;
    const onCommit = vi.fn();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      isSourceAuthoritative: () => authoritative,
      onCommit,
    });

    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    authoritative = false;
    expect(runtime.commit("7")).toBe(false);
    expect(runtime.getSessionSnapshot().kind).toBe("editing");
    expect(runtime.getDraftSnapshot(row.id, "COL_ID_SCORE")).toBeUndefined();
    expect(onCommit).not.toHaveBeenCalled();

    authoritative = true;
    expect(runtime.commit("7")).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    const gesture = [onCommit.mock.calls[0]![0]] as BrunoTableCellEditChangeGesture;
    authoritative = false;
    expect(runtime.createImmediateSaveChangeSet(gesture)).toBeUndefined();
    expect(runtime.createBatchSaveChangeSet()).toBeUndefined();

    const onCommitGesture = vi.fn();
    const gestureRuntime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      isSourceAuthoritative: () => false,
      onCommitGesture,
    });
    expect(
      gestureRuntime.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_SCORE",
          field: "score",
          baseRow: row,
          expectedVersion: row.quantity,
          base: row.score,
          mine: 7,
        },
      ]),
    ).toBe(false);
    expect(gestureRuntime.getDraftSnapshot(row.id, "COL_ID_SCORE")).toBeUndefined();
    expect(onCommitGesture).not.toHaveBeenCalled();
  });

  it("expires staggered rejected-cell success flashes independently", () => {
    let unsubscribeA = (): void => undefined;
    let unsubscribeB = (): void => undefined;
    const rows = new Map<string, Row>([
      ["row-a", Object.freeze({ ...row, id: "row-a" })],
      ["row-b", Object.freeze({ ...row, id: "row-b" })],
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => rows.get(rowId),
    });
    const changeSet = Object.freeze(
      [...rows].map(([rowId, baseRow]) =>
        Object.freeze({
          rowId,
          baseRow,
          expectedVersion: 1n,
          changes: Object.freeze([
            Object.freeze({
              columnId: "COL_ID_SCORE",
              field: "score",
              before: baseRow.score,
              after: 7,
            }),
          ]),
        }),
      ),
    ) as BrunoTableCellEditSaveChangeSet;

    try {
      vi.useFakeTimers();
      unsubscribeA = runtime.subscribeCell("row-a", "COL_ID_SCORE", () => undefined);
      unsubscribeB = runtime.subscribeCell("row-b", "COL_ID_SCORE", () => undefined);
      runtime.rejectSave("operation-staggered", changeSet, false);
      rows.set("row-a", Object.freeze({ ...row, id: "row-a", score: 7 }));
      runtime.reconcileSourceRows(new Set(["row-a"]));
      expect(runtime.getCellSnapshot("row-a", "COL_ID_SCORE").saveSucceeded).toBe(true);

      vi.advanceTimersByTime(1_500);
      rows.set("row-b", Object.freeze({ ...row, id: "row-b", score: 7 }));
      runtime.reconcileSourceRows(new Set(["row-b"]));
      expect(runtime.getCellSnapshot("row-b", "COL_ID_SCORE").saveSucceeded).toBe(true);

      vi.advanceTimersByTime(500);
      expect(runtime.getCellSnapshot("row-a", "COL_ID_SCORE").saveSucceeded).toBeUndefined();
      expect(runtime.getCellSnapshot("row-b", "COL_ID_SCORE").saveSucceeded).toBe(true);
      vi.advanceTimersByTime(1_500);
      expect(runtime.getCellSnapshot("row-b", "COL_ID_SCORE").saveSucceeded).toBeUndefined();
    } finally {
      unsubscribeA();
      unsubscribeB();
      vi.useRealTimers();
    }
  });

  it("bounds Immediate rejection presentation to five seconds without dropping evidence", () => {
    vi.useFakeTimers();
    try {
      const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
      const changeSet = [
        {
          rowId: row.id,
          baseRow: row,
          expectedVersion: 1n,
          changes: [
            {
              columnId: "COL_ID_SCORE",
              field: "score",
              before: row.score,
              after: 7,
            },
          ],
        },
      ] as const;

      runtime.rejectSave("operation-timeout", changeSet, true);
      expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBe(true);
      vi.advanceTimersByTime(4_999);
      expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBe(true);
      vi.advanceTimersByTime(1);
      expect(runtime.getCellSnapshot(row.id, "COL_ID_SCORE").saveFailed).toBeUndefined();
      expect(runtime.hasRejectedOperation("operation-timeout")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds rejected operation evidence to the latest 128 operations", () => {
    const runtime = new BrunoTableCellEditRuntime({ columns, getRow: () => row });
    for (let index = 0; index < 129; index += 1) {
      runtime.rejectSave(
        `operation-${String(index)}`,
        [
          {
            rowId: row.id,
            baseRow: row,
            expectedVersion: 1n,
            changes: [
              {
                columnId: "COL_ID_SCORE",
                field: "score",
                before: row.score,
                after: index + 20,
              },
            ],
          },
        ],
        false,
      );
    }

    expect(runtime.hasRejectedOperation("operation-0")).toBe(false);
    expect(runtime.hasRejectedOperation("operation-1")).toBe(true);
    expect(runtime.hasRejectedOperation("operation-128")).toBe(true);
  });

  it("releases the oldest unmounted cell store when rejected evidence is evicted", () => {
    const rows = new Map<string, Row>(
      Array.from({ length: 129 }, (_, index) => {
        const id = `row-${String(index)}`;
        return [id, Object.freeze({ ...row, id })];
      }),
    );
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => rows.get(rowId),
    });

    for (let index = 0; index < 129; index += 1) {
      const rowId = `row-${String(index)}`;
      const current = rows.get(rowId)!;
      const unsubscribe = runtime.subscribeCell(rowId, "COL_ID_SCORE", () => undefined);
      runtime.rejectSave(
        `operation-${String(index)}`,
        [
          {
            rowId,
            baseRow: current,
            expectedVersion: current.quantity,
            changes: [
              {
                columnId: "COL_ID_SCORE",
                field: "score",
                before: current.score,
                after: index + 20,
              },
            ],
          },
        ],
        false,
      );
      unsubscribe();
    }

    expect(runtime.hasRejectedOperation("operation-0")).toBe(false);
    expect(runtime.getRetainedCellStoreCount()).toBe(128);
  });

  it("safely rebases an unchanged edited field onto the latest row and Row Version", () => {
    let current = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);

    current = Object.freeze({ ...row, quantity: row.quantity + 1n });
    expect(runtime.createBatchSaveChangeSet()).toEqual([
      {
        rowId: row.id,
        baseRow: current,
        expectedVersion: current.quantity,
        changes: [
          {
            columnId: "COL_ID_SCORE",
            field: "score",
            before: row.score,
            after: 7,
          },
        ],
      },
    ]);
  });

  it("groups a Batch Save Change Set by stable Row Identity", () => {
    const second = Object.freeze({ ...row, id: "row-2", score: 5 });
    const byId = new Map([
      [row.id, row],
      [second.id, second],
    ]);
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => byId.get(rowId),
      getRowVersion: (candidate) => (candidate as Row).quantity,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);
    expect(runtime.start(second.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("8")).toBe(true);

    const changeSet = runtime.createBatchSaveChangeSet();
    expect(changeSet?.map((rowChange) => rowChange.rowId)).toEqual([row.id, second.id]);
    expect(changeSet?.map((rowChange) => rowChange.changes.length)).toEqual([1, 1]);
  });

  it("yields Accepted Overlays on Row Version difference and disappearance", () => {
    let current: Row | undefined = row;
    let version = 1n;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: () => version,
    });
    const changeSet = [
      {
        rowId: row.id,
        baseRow: row,
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_SCORE",
            field: "score",
            before: row.score,
            after: 7,
          },
        ],
      },
    ] as const;

    runtime.acceptSave("operation-version", changeSet, false);
    version = 2n;
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-version")).toBe(0);

    runtime.acceptSave("operation-disappearance", changeSet, false);
    current = undefined;
    runtime.reconcileSourceRows(new Set([row.id]));
    expect(runtime.getAcceptedOverlayCountForOperation("operation-disappearance")).toBe(0);
  });

  it("refuses a fresh Save preflight and records a conflict when an edited Base diverges", () => {
    let current = row;
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => current,
      getRowVersion: () => 1n,
    });
    runtime.setBatchHistoryEnabled(true);
    expect(runtime.start(row.id, "COL_ID_SCORE")).toBe(true);
    expect(runtime.commit("7")).toBe(true);

    current = Object.freeze({ ...row, score: 5 });
    expect(runtime.createBatchSaveChangeSet()).toBeUndefined();
    expect(runtime.getActivitySnapshot()).toMatchObject({
      draftCount: 1,
      conflictCount: 1,
      undoCount: 1,
    });
  });

  it("publishes one atomic Immediate operation for a multi-cell accepted gesture", () => {
    const onCommitGesture = vi.fn();
    const runtime = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: () => 1n,
      onCommitGesture,
    });
    const gesture = [
      {
        rowId: row.id,
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        baseRow: row,
        expectedVersion: 1n,
        base: row.quantity,
        mine: row.quantity + 1n,
      },
      {
        rowId: row.id,
        columnId: "COL_ID_SCORE",
        field: "score",
        baseRow: row,
        expectedVersion: 1n,
        base: row.score,
        mine: 7,
      },
    ] as const;

    expect(runtime.applyAcceptedDraftGesture(gesture)).toBe(true);
    expect(onCommitGesture).toHaveBeenCalledOnce();
    const committed = onCommitGesture.mock.calls[0]![0];
    expect(runtime.createImmediateSaveChangeSet(committed)).toEqual([
      {
        rowId: row.id,
        baseRow: row,
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_QUANTITY",
            field: "quantity",
            before: row.quantity,
            after: row.quantity + 1n,
          },
          {
            columnId: "COL_ID_SCORE",
            field: "score",
            before: row.score,
            after: 7,
          },
        ],
      },
    ]);
  });
});
