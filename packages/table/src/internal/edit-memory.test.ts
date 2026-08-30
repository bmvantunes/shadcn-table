import { afterEach, describe, expect, it, vi } from "vitest";

import { BrunoTableCellEditRuntime } from "./cell-edit";
import { compileColumns } from "./compile-columns";
import { BrunoTableEditMemoryRuntime } from "./edit-memory";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe("BrunoTable Edit Memory", () => {
  it("keeps Conflict Review closed while another cell editor is active", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    const rows = new Map<string, Row>([
      ["row-1", Object.freeze({ id: "row-1", value: "base-1", revision: 1n })],
      ["row-2", Object.freeze({ id: "row-2", value: "base-2", revision: 1n })],
    ]);
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => rows.get(rowId),
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    disposers.push(
      memory.connectCellEdit(cellEdit),
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );
    const conflictedRow = rows.get("row-1")!;
    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: conflictedRow.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: conflictedRow,
          expectedVersion: conflictedRow.revision,
          base: conflictedRow.value,
          mine: "mine",
          conflict: { server: "server", serverVersion: 2n },
        },
      ]),
    ).toBe(true);
    expect(cellEdit.start("row-2", "COL_ID_VALUE")).toBe(true);

    expect(memory.openConflictReview()).toBe(false);
    expect(memory.getConflictReviewSnapshot().open).toBe(false);

    cellEdit.cancel();
    expect(memory.openConflictReview()).toBe(true);
  });

  it("finalizes an all-Server Batch review without discarding its undo history", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    let row: Row = Object.freeze({ id: "row-1", value: "base", revision: 1n });
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    disposers.push(
      memory.connectCellEdit(cellEdit),
      memory.registerSaveCommand(() => undefined),
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );
    expect(memory.requestMode("batch")).toBe(true);
    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: row,
          expectedVersion: row.revision,
          base: row.value,
          mine: "mine",
        },
      ]),
    ).toBe(true);
    row = Object.freeze({ ...row, value: "server", revision: 2n });
    cellEdit.reconcileSourceRows(new Set([row.id]));
    expect(memory.openConflictReview()).toBe(true);
    const id = cellEdit.getDraftReviewSnapshot()[0]!.id;
    expect(memory.resolveConflictRows([id], "server")).toBe(true);
    expect(cellEdit.getActivitySnapshot()).toMatchObject({
      conflictCount: 0,
      draftCount: 0,
      undoCount: 2,
    });

    expect(memory.saveConflictReview()).toBe(true);
    expect(memory.getConflictReviewSnapshot().open).toBe(false);

    row = Object.freeze({ ...row, revision: 3n });
    cellEdit.reconcileSourceRows(new Set([row.id]));
    expect(cellEdit.getActivitySnapshot()).toMatchObject({ conflictCount: 0, undoCount: 2 });
    expect(memory.undo()).toBe(true);
    expect(cellEdit.getActivitySnapshot()).toMatchObject({ conflictCount: 1, draftCount: 1 });
  });

  it("accepts a fresh conflict choice after retained evidence is invalidated", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    let row: Row = Object.freeze({ id: "row-1", value: "base", revision: 1n });
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    disposers.push(
      memory.connectCellEdit(cellEdit),
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );
    expect(memory.requestMode("batch")).toBe(true);
    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: row,
          expectedVersion: row.revision,
          base: row.value,
          mine: "mine",
          conflict: { server: "server-1", serverVersion: 2n },
        },
      ]),
    ).toBe(true);
    row = Object.freeze({ ...row, value: "server-1", revision: 2n });
    cellEdit.reconcileSourceRows(new Set([row.id]));
    expect(memory.openConflictReview()).toBe(true);
    const id = cellEdit.getDraftReviewSnapshot()[0]?.id;
    expect(id).toBeDefined();
    expect(memory.resolveConflictRows([id!], "mine")).toBe(true);
    expect(memory.getConflictResolutionSnapshot(id!)).toMatchObject({ resolution: "mine" });

    row = Object.freeze({ ...row, value: "server-2" });
    cellEdit.reconcileSourceRows(new Set([row.id]));
    expect(memory.getConflictResolutionSnapshot(id!)).toBeUndefined();
    expect(memory.resolveConflictRows([id!], "mine")).toBe(true);
    expect(memory.getConflictResolutionSnapshot(id!)).toMatchObject({ resolution: "mine" });
  });

  it("retains a Mine acknowledgement while its authoritative row is absent", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    let row: Row | undefined = Object.freeze({
      id: "row-1",
      value: "base",
      revision: 1n,
    });
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    disposers.push(
      memory.connectCellEdit(cellEdit),
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );
    expect(memory.requestMode("batch")).toBe(true);
    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: "row-1",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: row!,
          expectedVersion: 1n,
          base: "base",
          mine: "mine",
        },
      ]),
    ).toBe(true);
    row = Object.freeze({ id: "row-1", value: "server", revision: 3n });
    cellEdit.reconcileSourceRows(new Set(["row-1"]));
    expect(memory.openConflictReview()).toBe(true);
    const id = cellEdit.getDraftReviewSnapshot()[0]!.id;
    expect(memory.resolveConflictRows([id], "mine")).toBe(true);

    row = undefined;
    cellEdit.reconcileSourceRows(undefined);
    expect(memory.getConflictResolutionSnapshot(id)).toMatchObject({ resolution: "mine" });

    row = Object.freeze({ id: "row-1", value: "server", revision: 2n });
    cellEdit.reconcileSourceRows(undefined);
    expect(memory.getConflictResolutionSnapshot(id)).toBeUndefined();
    expect(cellEdit.getActivitySnapshot().conflictCount).toBe(1);
    expect(memory.resolveConflictRows([id], "mine")).toBe(true);
    row = Object.freeze({ id: "row-1", value: "mine", revision: 4n });
    cellEdit.reconcileSourceRows(new Set(["row-1"]));
    expect(cellEdit.getRetainedResolutionPublicationSnapshot()).toContain(id);
    expect(cellEdit.isDraftConflictEvidenceCurrent(id, "mine", "server", 2n)).toBe(false);
    expect(cellEdit.isConflictResolutionLocallyUndone(id, "server", 2n)).toBe(false);
    expect(cellEdit.isConflictResolutionTemporarilyDiscarded(id)).toBe(false);
    expect(cellEdit.hasRetainedConflictResolution(id)).toBe(false);
    expect(memory.getConflictResolutionSnapshot(id)).toBeUndefined();
    expect(cellEdit.getActivitySnapshot().conflictCount).toBe(0);
    expect(memory.getConflictReviewRowsSnapshot()).toHaveLength(0);
  });

  it("closes an Immediate Server review while its row is absent and reopens on return", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    let row: Row | undefined = Object.freeze({ id: "row-1", value: "base", revision: 1n });
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    disposers.push(
      memory.connectCellEdit(cellEdit),
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );
    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: "row-1",
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: row!,
          expectedVersion: 1n,
          base: "base",
          mine: "mine",
        },
      ]),
    ).toBe(true);
    row = Object.freeze({ id: "row-1", value: "server", revision: 2n });
    cellEdit.reconcileSourceRows(new Set(["row-1"]));
    expect(memory.openConflictReview()).toBe(true);
    const id = cellEdit.getDraftReviewSnapshot()[0]!.id;
    expect(memory.resolveConflictRows([id], "server")).toBe(true);

    row = undefined;
    cellEdit.reconcileSourceRows(new Set(["row-1"]));
    memory.closeConflictReview();
    expect(memory.getConflictReviewSnapshot().open).toBe(false);
    expect(memory.getConflictResolutionSnapshot(id)).toMatchObject({ resolution: "server" });

    row = Object.freeze({ id: "row-1", value: "server", revision: 3n });
    cellEdit.reconcileSourceRows(new Set(["row-1"]));
    expect(cellEdit.getActivitySnapshot().conflictCount).toBe(1);
  });

  it("reconciles only the authoritative subset when an Immediate Server review closes", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    const rows = new Map<string, Row>([
      ["row-1", Object.freeze({ id: "row-1", value: "base-1", revision: 1n })],
      ["row-2", Object.freeze({ id: "row-2", value: "base-2", revision: 1n })],
    ]);
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => rows.get(rowId),
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    disposers.push(
      memory.connectCellEdit(cellEdit),
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );
    const [firstRow, secondRow] = [...rows.values()] as [Row, Row];
    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: firstRow.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: firstRow,
          expectedVersion: firstRow.revision,
          base: firstRow.value,
          mine: `mine-${firstRow.id}`,
        },
        {
          rowId: secondRow.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: secondRow,
          expectedVersion: secondRow.revision,
          base: secondRow.value,
          mine: `mine-${secondRow.id}`,
        },
      ]),
    ).toBe(true);
    rows.set("row-1", Object.freeze({ id: "row-1", value: "server-1", revision: 2n }));
    rows.set("row-2", Object.freeze({ id: "row-2", value: "server-2", revision: 2n }));
    cellEdit.reconcileSourceRows(undefined);
    expect(memory.openConflictReview()).toBe(true);
    const idsByRow = new Map(
      cellEdit.getDraftReviewSnapshot().map((row) => [row.rowId, row.id] as const),
    );
    const firstId = idsByRow.get("row-1")!;
    const secondId = idsByRow.get("row-2")!;
    expect(memory.resolveConflictRows([firstId, secondId], "server")).toBe(true);

    rows.delete("row-2");
    cellEdit.reconcileSourceRows(new Set(["row-2"]));
    memory.closeConflictReview();

    expect(memory.getConflictReviewSnapshot().open).toBe(false);
    expect(memory.getConflictResolutionSnapshot(firstId)).toBeUndefined();
    expect(memory.getConflictResolutionSnapshot(secondId)).toMatchObject({
      resolution: "server",
    });
    expect(cellEdit.getActivitySnapshot().conflictCount).toBe(1);

    rows.set("row-2", Object.freeze({ id: "row-2", value: "server-2", revision: 3n }));
    cellEdit.reconcileSourceRows(new Set(["row-2"]));
    expect(memory.getConflictResolutionSnapshot(secondId)).toBeUndefined();
    expect(cellEdit.getActivitySnapshot().conflictCount).toBe(2);
  });

  it.each(["mine", "server"] as const)(
    "reconciles an undone %s resolution after the source returns to the safe base",
    (resolution) => {
      type Row = Readonly<{
        readonly id: string;
        readonly value: string;
        readonly revision: bigint;
      }>;
      let row: Row = Object.freeze({ id: "row-1", value: "base", revision: 1n });
      const columns = compileColumns([
        {
          columnId: "COL_ID_VALUE",
          field: "value",
          headerName: "Value",
          valueType: "text",
          isEditable: true,
        },
      ]);
      const cellEdit = new BrunoTableCellEditRuntime({
        columns,
        getRow: () => row,
        getRowVersion: (candidate) => (candidate as Row).revision,
      });
      const memory = new BrunoTableEditMemoryRuntime();
      cellEdit.activate();
      memory.activate();
      disposers.push(
        memory.connectCellEdit(cellEdit),
        () => memory.dispose(),
        () => cellEdit.dispose(),
      );
      expect(memory.requestMode("batch")).toBe(true);
      expect(
        cellEdit.applyAcceptedDraftGesture([
          {
            rowId: row.id,
            columnId: "COL_ID_VALUE",
            field: "value",
            baseRow: row,
            expectedVersion: row.revision,
            base: row.value,
            mine: "mine",
          },
        ]),
      ).toBe(true);
      row = Object.freeze({ ...row, value: "server", revision: 2n });
      cellEdit.reconcileSourceRows(new Set([row.id]));
      expect(memory.openConflictReview()).toBe(true);
      const id = cellEdit.getDraftReviewSnapshot()[0]!.id;
      expect(memory.resolveConflictRows([id], resolution)).toBe(true);
      memory.closeConflictReview();
      expect(memory.undo()).toBe(true);
      expect(cellEdit.getActivitySnapshot().conflictCount).toBe(1);

      row = Object.freeze({ ...row, value: "base", revision: 3n });
      cellEdit.reconcileSourceRows(new Set([row.id]));
      expect(cellEdit.getActivitySnapshot()).toMatchObject({
        draftCount: 1,
        conflictCount: 0,
        redoCount: 0,
      });
    },
  );

  it("releases the narrow draft-review subscription when either sparse review closes", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    disposers.push(() => vi.unstubAllGlobals());
    type Row = Readonly<{
      readonly id: string;
      readonly value: string;
      readonly editable: boolean;
      readonly revision: bigint;
    }>;
    let row: Row = Object.freeze({
      id: "row-1",
      value: "base",
      editable: true,
      revision: 1n,
    });
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: ({ row: candidate }: { readonly row: Row }) => candidate.editable,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as Row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    const getDraftReviewSubscriberCount = (): number =>
      (
        cellEdit as unknown as {
          readonly draftReviewSubscriberCount: number;
        }
      ).draftReviewSubscriberCount;
    const getConflictResolutionStoreCount = (): number =>
      (
        memory as unknown as {
          readonly conflictResolutionStores: ReadonlyMap<string, unknown>;
        }
      ).conflictResolutionStores.size;
    cellEdit.activate();
    memory.activate();
    const disconnect = memory.connectCellEdit(cellEdit);
    disposers.push(
      disconnect,
      () => memory.dispose(),
      () => cellEdit.dispose(),
    );

    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: row,
          expectedVersion: row.revision,
          base: "base",
          mine: "mine",
          conflict: { server: "server", serverVersion: 2n },
        },
      ]),
    ).toBe(true);
    row = Object.freeze({ ...row, value: "server", editable: false, revision: 2n });
    cellEdit.reconcileSourceRows(new Set([row.id]));
    expect(cellEdit.getActivitySnapshot()).toMatchObject({ conflictCount: 1, blockedCount: 1 });

    expect(getDraftReviewSubscriberCount()).toBe(0);
    expect(memory.openConflictReview()).toBe(true);
    expect(getDraftReviewSubscriberCount()).toBe(1);
    const conflictId = cellEdit.getDraftReviewSnapshot()[0]?.id;
    expect(conflictId).toBeDefined();
    memory.getConflictResolutionSnapshot(conflictId!);
    expect(getConflictResolutionStoreCount()).toBe(1);
    memory.closeConflictReview();
    expect(getDraftReviewSubscriberCount()).toBe(0);
    expect(getConflictResolutionStoreCount()).toBe(0);

    expect(memory.openBlockedReview()).toBe(true);
    expect(getDraftReviewSubscriberCount()).toBe(1);
    memory.closeBlockedReview();
    expect(getDraftReviewSubscriberCount()).toBe(0);
  });

  it("reports an awaiting Batch operation even when no rows remain", () => {
    const memory = new BrunoTableEditMemoryRuntime();
    disposers.push(() => memory.dispose());
    memory.activate();
    const release = memory.beginSaveWork("batch:1", "batch");
    disposers.push(release);

    memory.setSaveWorkAwaitingSource("batch:1", 0);

    expect(memory.getSaveWorkSnapshot()).toEqual({
      pendingBatchCount: 0,
      awaitingBatchCount: 1,
      awaitingBatchRowCount: 0,
      pendingImmediateCount: 0,
      awaitingImmediateCount: 0,
    });
  });

  it("aggregates failures by operation and clears only the converged operation", () => {
    const memory = new BrunoTableEditMemoryRuntime();
    disposers.push(() => memory.dispose());
    memory.activate();
    const changeSet = [
      {
        rowId: "row-1",
        baseRow: { id: "row-1", value: "before" },
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "before",
            after: "after",
          },
        ],
      },
    ] as const;
    const rows = [
      {
        rowId: "row-1",
        cells: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
          },
        ],
      },
    ];

    memory.recordSaveFailure("operation-1", new Error("First failed."), changeSet);
    memory.recordSaveFailure("operation-2", new Error("Second failed."), changeSet);
    expect(memory.getSaveFailureSnapshot()).toEqual({
      count: 2,
      messages: ["First failed.", "Second failed."],
      operations: [
        { operationId: "operation-1", message: "First failed.", rows },
        { operationId: "operation-2", message: "Second failed.", rows },
      ],
    });

    memory.clearSaveFailure("operation-1");
    expect(memory.getSaveFailureSnapshot()).toEqual({
      count: 1,
      messages: ["Second failed."],
      operations: [{ operationId: "operation-2", message: "Second failed.", rows }],
    });

    memory.dismissSaveFailures();
    expect(memory.getSaveFailureSnapshot()).toEqual({ count: 0, messages: [], operations: [] });
  });

  it("normalizes non-Error rejection reasons without reading unsafe explanation protocols", () => {
    const memory = new BrunoTableEditMemoryRuntime();
    disposers.push(() => memory.dispose());
    memory.activate();
    const changeSet = [
      {
        rowId: "row-1",
        baseRow: { id: "row-1", value: "before" },
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "before",
            after: "after",
          },
        ],
      },
    ] as const;
    const throwingMessage = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwingMessage, "message", {
      get: () => {
        throw new Error("Do not expose this getter failure.");
      },
    });

    memory.recordSaveFailure("operation-string", "  String rejection.  ", changeSet);
    memory.recordSaveFailure("operation-object", { message: "Object rejection." }, changeSet);
    memory.recordSaveFailure("operation-throwing", throwingMessage, changeSet);

    expect(
      memory.getSaveFailureSnapshot().operations.map((operation) => operation.message),
    ).toEqual([
      "The save could not be confirmed.",
      "The save could not be confirmed.",
      "The save could not be confirmed.",
    ]);
  });

  it("retains only rendered identity evidence for rejected-operation details", () => {
    const memory = new BrunoTableEditMemoryRuntime();
    disposers.push(() => memory.dispose());
    memory.activate();
    memory.recordSaveFailure("operation-1", new Error("Save failed."), [
      {
        rowId: "row-1",
        baseRow: { id: "row-1" },
        expectedVersion: { opaque: "version" },
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: { arbitrary: "before" },
            after: { arbitrary: "after" },
          },
        ],
      },
    ]);

    expect(memory.getSaveFailureSnapshot().operations).toEqual([
      {
        operationId: "operation-1",
        message: "Save failed.",
        rows: [
          {
            rowId: "row-1",
            cells: [{ columnId: "COL_ID_VALUE", field: "value" }],
          },
        ],
      },
    ]);
  });

  it("prunes rejected details by Cell Identity without waking the compact summary", () => {
    const memory = new BrunoTableEditMemoryRuntime();
    disposers.push(() => memory.dispose());
    memory.activate();
    const summaryListener = vi.fn();
    const detailListener = vi.fn();
    disposers.push(
      memory.subscribeSaveFailureSummary(summaryListener),
      memory.subscribeSaveFailure(detailListener),
    );
    memory.recordSaveFailure("operation-1", new Error("Save failed."), [
      {
        rowId: "row-1",
        baseRow: { id: "row-1", value: "before-1" },
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "before-1",
            after: "after-1",
          },
        ],
      },
      {
        rowId: "row-2",
        baseRow: { id: "row-2", value: "before-2" },
        expectedVersion: 1n,
        changes: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "before-2",
            after: "after-2",
          },
        ],
      },
    ]);
    const before = memory.getSaveFailureSnapshot();
    expect(memory.getSaveFailureSnapshot()).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.operations)).toBe(true);
    expect(Object.isFrozen(before.operations[0]?.rows)).toBe(true);
    expect(Object.isFrozen(before.operations[0]?.rows[0]?.cells)).toBe(true);
    summaryListener.mockClear();
    detailListener.mockClear();

    memory.removeSaveFailureCells("operation-1", [{ rowId: "row-1", columnId: "COL_ID_VALUE" }]);

    expect(summaryListener).not.toHaveBeenCalled();
    expect(detailListener).toHaveBeenCalledTimes(1);
    const after = memory.getSaveFailureSnapshot();
    expect(after).not.toBe(before);
    expect(before.operations[0]?.rows).toHaveLength(2);
    expect(after.operations[0]?.rows).toEqual([
      {
        rowId: "row-2",
        cells: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
          },
        ],
      },
    ]);
  });

  it("publishes only compact changed footer projections and keeps Save command-owned", () => {
    type Row = Readonly<{ readonly id: string; readonly value: string; readonly revision: bigint }>;
    let row: Row = Object.freeze({ id: "row-1", value: "server", revision: 1n });
    const columns = compileColumns([
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
      },
    ]);
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: (candidate) => (candidate as typeof row).revision,
    });
    const memory = new BrunoTableEditMemoryRuntime();
    cellEdit.activate();
    memory.activate();
    const disconnect = memory.connectCellEdit(cellEdit);
    const modeListener = vi.fn();
    const statusListener = vi.fn();
    const resetListener = vi.fn();
    const saveListener = vi.fn();
    const unsubscribers = [
      memory.subscribeMode(modeListener),
      memory.subscribeSafetyStatus(statusListener),
      memory.subscribeCanReset(resetListener),
      memory.subscribeCanSave(saveListener),
    ];

    cellEdit.reconcileSourceRows(undefined);
    expect(modeListener).not.toHaveBeenCalled();
    expect(statusListener).not.toHaveBeenCalled();
    expect(resetListener).not.toHaveBeenCalled();
    expect(saveListener).not.toHaveBeenCalled();

    expect(memory.requestMode("batch")).toBe(true);
    expect(modeListener).toHaveBeenCalledOnce();
    expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
    expect(cellEdit.commit("draft")).toBe(true);
    expect(statusListener).toHaveBeenCalledOnce();
    expect(resetListener).toHaveBeenCalledOnce();
    expect(memory.getCanSaveSnapshot()).toBe(false);

    const save = vi.fn();
    const unregisterSave = memory.registerSaveCommand(save);
    expect(memory.getCanSaveSnapshot()).toBe(true);
    memory.setSaveOperationCapacityAvailable(false);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    expect(memory.requestSave()).toBe(false);
    expect(cellEdit.getActivitySnapshot().draftCount).toBe(1);
    expect(save).not.toHaveBeenCalled();
    memory.setSaveOperationCapacityAvailable(true);
    expect(memory.getCanSaveSnapshot()).toBe(true);
    memory.setSavePreflightAvailable(false);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    memory.setSavePreflightAvailable(true);
    expect(memory.getCanSaveSnapshot()).toBe(true);
    const releaseSaveWork = memory.beginSaveWork();
    expect(memory.getModeSnapshot().canChange).toBe(false);
    expect(memory.getCanResetSnapshot()).toBe(false);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    expect(memory.requestSave()).toBe(false);
    expect(memory.undo()).toBe(false);
    expect(memory.redo()).toBe(false);
    expect(memory.openResetReview()).toBe(false);
    releaseSaveWork();
    expect(memory.getCanResetSnapshot()).toBe(true);
    expect(memory.getCanSaveSnapshot()).toBe(true);
    expect(memory.requestSave()).toBe(true);
    expect(save).toHaveBeenCalledOnce();

    expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    cellEdit.updateActiveCandidate("pending", false);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    expect(cellEdit.cancel()).toBe(true);
    expect(memory.getCanSaveSnapshot()).toBe(true);

    expect(
      cellEdit.applyAcceptedDraftGesture([
        {
          rowId: row.id,
          columnId: "COL_ID_VALUE",
          field: "value",
          baseRow: row,
          expectedVersion: row.revision,
          base: "server",
          mine: "conflicted draft",
          conflict: { server: "new server", serverVersion: 2n },
        },
      ]),
    ).toBe(true);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    const openConflictReview = vi.fn();
    const unregisterConflictReview = memory.registerConflictReviewCommand(openConflictReview);
    expect(memory.getCanSaveSnapshot()).toBe(true);
    expect(memory.requestSave()).toBe(true);
    expect(openConflictReview).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();

    expect(memory.getCanResetSnapshot()).toBe(true);
    expect(memory.getCanSaveSnapshot()).toBe(true);
    expect(memory.getHotkeyAvailabilitySnapshot()).toMatchObject({ undo: true });
    memory.dispose();
    expect(memory.getCanResetSnapshot()).toBe(false);
    expect(memory.getCanSaveSnapshot()).toBe(false);
    expect(memory.getHotkeyAvailabilitySnapshot()).toEqual({ undo: false, redo: false });

    modeListener.mockClear();
    statusListener.mockClear();
    resetListener.mockClear();
    saveListener.mockClear();
    row = Object.freeze({ id: "row-1", value: "server", revision: 2n });
    cellEdit.reconcileSourceRows(new Set([row.id]));
    expect(modeListener).not.toHaveBeenCalled();
    expect(statusListener).not.toHaveBeenCalled();
    expect(resetListener).not.toHaveBeenCalled();
    expect(saveListener).not.toHaveBeenCalled();

    unregisterSave();
    unregisterConflictReview();
    for (const unsubscribe of unsubscribers) unsubscribe();
    disconnect();
    cellEdit.dispose();
  });
});
