import { describe, expect, it, vi } from "vitest";

import { BrunoTableCellEditRuntime } from "./cell-edit";
import { compileColumns } from "./compile-columns";
import { BrunoTableEditMemoryRuntime } from "./edit-memory";

describe("BrunoTable Edit Memory", () => {
  it("aggregates failures by operation and clears only the converged operation", () => {
    const memory = new BrunoTableEditMemoryRuntime();
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
        expectedVersion: 1n,
        cells: [
          {
            columnId: "COL_ID_VALUE",
            field: "value",
            before: "before",
            after: "after",
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
    memory.dispose();
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
          conflict: { server: "new server" },
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
