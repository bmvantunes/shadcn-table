import { afterEach, describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { BrunoTableCellEditRuntime } from "./cell-edit";
import { BrunoTableEditMemoryRuntime } from "./edit-memory";
import { BrunoTableSaveOperationRuntime } from "./save-operations";

type Row = Readonly<{
  readonly id: string;
  readonly value: string;
  readonly revision: bigint;
}>;

const row: Row = Object.freeze({ id: "row-1", value: "server", revision: 1n });
const columns = compileColumns([
  {
    columnId: "COL_ID_VALUE",
    field: "value",
    headerName: "Value",
    valueType: "text",
    isEditable: true,
  },
]);
const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe("BrunoTableSaveOperationRuntime", () => {
  it("backpressures Immediate edits at capacity and reopens admission after reconciliation", async () => {
    const pendingRows = new Map<string, Row>(
      Array.from({ length: 129 }, (_, index) => {
        const id = `row-${String(index)}`;
        return [id, Object.freeze({ id, value: "server", revision: 1n })];
      }),
    );
    let editMemory!: BrunoTableEditMemoryRuntime;
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: (rowId) => pendingRows.get(rowId),
      getRowVersion: (candidate) => (candidate as Row).revision,
      onCommit: (change) => editMemory.requestImmediateSave([change]),
      onCommitGesture: (changes) => editMemory.requestImmediateSave(changes),
    });
    editMemory = new BrunoTableEditMemoryRuntime();
    const saveOperations = new BrunoTableSaveOperationRuntime(cellEdit, editMemory);
    const resolvePending: Array<() => void> = [];
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePending.push(resolve);
        }),
    );
    cellEdit.activate();
    editMemory.activate();
    disposers.push(
      () => cellEdit.dispose(),
      () => editMemory.dispose(),
      saveOperations.activate(),
      editMemory.connectCellEdit(cellEdit),
      saveOperations.setHandler(handler),
    );

    for (let index = 0; index < 128; index += 1) {
      const rowId = `row-${String(index)}`;
      expect(cellEdit.start(rowId, "COL_ID_VALUE")).toBe(true);
      expect(cellEdit.commit(`submitted-${String(index)}`)).toBe(true);
    }

    expect(handler).toHaveBeenCalledTimes(128);
    expect(saveOperations.getRetainedOperationCount()).toBe(128);
    expect(saveOperations.getRetainedChangeSetCount()).toBe(128);
    expect(cellEdit.start("row-128", "COL_ID_VALUE")).toBe(false);
    expect(cellEdit.getCellSnapshot("row-128", "COL_ID_VALUE")).toEqual({
      active: false,
      hasDraft: false,
    });

    pendingRows.set("row-0", Object.freeze({ id: "row-0", value: "submitted-0", revision: 2n }));
    resolvePending[0]!();
    await vi.waitFor(
      () => {
        cellEdit.reconcileSourceRows(new Set(["row-0"]));
        expect(saveOperations.getRetainedOperationCount()).toBe(127);
      },
      { interval: 1 },
    );
    expect(saveOperations.getRetainedChangeSetCount()).toBe(127);

    expect(cellEdit.start("row-128", "COL_ID_VALUE")).toBe(true);
    expect(cellEdit.commit("submitted-128")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(129);
    expect(saveOperations.getRetainedOperationCount()).toBe(128);
  });

  it("releases the submitted change set while awaiting live source confirmation", async () => {
    let editMemory!: BrunoTableEditMemoryRuntime;
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: () => row.revision,
      onCommit: (change) => editMemory.requestImmediateSave([change]),
      onCommitGesture: (changes) => editMemory.requestImmediateSave(changes),
    });
    editMemory = new BrunoTableEditMemoryRuntime();
    const saveOperations = new BrunoTableSaveOperationRuntime(cellEdit, editMemory);
    cellEdit.activate();
    editMemory.activate();
    disposers.push(
      () => cellEdit.dispose(),
      () => editMemory.dispose(),
      saveOperations.activate(),
      editMemory.connectCellEdit(cellEdit),
      saveOperations.setHandler(() => Promise.resolve()),
    );

    expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
    expect(cellEdit.commit("submitted")).toBe(true);
    await vi.waitFor(
      () => {
        expect(cellEdit.getAcceptedOverlayCountForOperation("immediate:1")).toBe(1);
      },
      { interval: 1 },
    );

    expect(saveOperations.getRetainedOperationCount()).toBe(1);
    expect(saveOperations.getRetainedChangeSetCount()).toBe(0);
  });

  it("rejects non-thenable results and hostile then accessors through the ordinary workflow", async () => {
    const runInvalidHandler = async (handler: () => never): Promise<string> => {
      let editMemory!: BrunoTableEditMemoryRuntime;
      const cellEdit = new BrunoTableCellEditRuntime({
        columns,
        getRow: () => row,
        getRowVersion: () => row.revision,
        onCommit: (change) => editMemory.requestImmediateSave([change]),
        onCommitGesture: (changes) => editMemory.requestImmediateSave(changes),
      });
      editMemory = new BrunoTableEditMemoryRuntime();
      const saveOperations = new BrunoTableSaveOperationRuntime(cellEdit, editMemory);
      cellEdit.activate();
      editMemory.activate();
      disposers.push(
        () => cellEdit.dispose(),
        () => editMemory.dispose(),
        saveOperations.activate(),
        editMemory.connectCellEdit(cellEdit),
        saveOperations.setHandler(handler),
      );

      expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
      expect(cellEdit.commit("submitted")).toBe(true);
      await vi.waitFor(
        () => {
          expect(editMemory.getSaveFailureSnapshot().count).toBe(1);
        },
        { interval: 1 },
      );
      expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
      cellEdit.cancel();
      return editMemory.getSaveFailureSnapshot().operations[0]!.message;
    };

    await expect(runInvalidHandler(() => 42 as never)).resolves.toBe(
      "BrunoTable onSaveEdits must return a PromiseLike<void>.",
    );
    const hostile = new Proxy(Object.create(null) as object, {
      get: (_target, property) => {
        if (property === "then") throw new Error("Hostile then accessor.");
        return undefined;
      },
    });
    await expect(runInvalidHandler(() => hostile as never)).resolves.toBe("Hostile then accessor.");
  });

  it("bounds rejected workflows without consuming pending-operation capacity", async () => {
    let editMemory!: BrunoTableEditMemoryRuntime;
    const cellEdit = new BrunoTableCellEditRuntime({
      columns,
      getRow: () => row,
      getRowVersion: () => row.revision,
      onCommit: (change) => {
        editMemory.requestImmediateSave([change]);
      },
      onCommitGesture: (changes) => {
        editMemory.requestImmediateSave(changes);
      },
    });
    editMemory = new BrunoTableEditMemoryRuntime();
    const saveOperations = new BrunoTableSaveOperationRuntime(cellEdit, editMemory);
    const handler = vi.fn(() => Promise.reject(new Error("Not confirmed.")));
    cellEdit.activate();
    editMemory.activate();
    disposers.push(
      () => cellEdit.dispose(),
      () => editMemory.dispose(),
      saveOperations.activate(),
      editMemory.connectCellEdit(cellEdit),
      saveOperations.setHandler(handler),
    );
    for (let index = 0; index < 129; index += 1) {
      expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
      expect(cellEdit.commit("submitted")).toBe(true);
      await vi.waitFor(
        () => {
          expect(handler).toHaveBeenCalledTimes(index + 1);
          expect(saveOperations.getRetainedChangeSetCount()).toBe(0);
        },
        { interval: 1 },
      );
    }

    expect(editMemory.getSaveFailureSnapshot().count).toBe(128);
    expect(saveOperations.getRetainedOperationCount()).toBe(128);
    expect(saveOperations.getRetainedChangeSetCount()).toBe(0);
    expect(cellEdit.start(row.id, "COL_ID_VALUE")).toBe(true);
  });
});
