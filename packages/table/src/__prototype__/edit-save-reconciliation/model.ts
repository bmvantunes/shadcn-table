import { Store } from "@tanstack/store";
import { createActor, createMachine } from "xstate";

export type PrototypeField = "price" | "quantity";
export type PrototypeMode = "immediate" | "batch";

export type PrototypeRow = {
  readonly id: string;
  readonly version: number;
  readonly price: number;
  readonly quantity: number;
};

type CellKey = `${string}:${PrototypeField}`;
type OperationStatus = "pending" | "waiting-source" | "rejected" | "complete";

type Draft = {
  readonly cellKey: CellKey;
  readonly rowId: string;
  readonly field: PrototypeField;
  readonly before: number;
  readonly after: number;
  readonly baseVersion: number;
};

type Conflict = {
  readonly cellKey: CellKey;
  readonly rowId: string;
  readonly field: PrototypeField;
  readonly base: number;
  readonly server: number | null;
  readonly mine: number;
};

type HistoryPatch = {
  readonly cellKey: CellKey;
  readonly rowId: string;
  readonly field: PrototypeField;
  readonly beforeState: {
    readonly draft: Draft | null;
    readonly conflict: Conflict | null;
  };
  readonly afterState: {
    readonly draft: Draft | null;
    readonly conflict: Conflict | null;
  };
};

type HistoryCommand = {
  readonly label: string;
  readonly patches: readonly HistoryPatch[];
};

type SubmittedRow = {
  readonly rowId: string;
  readonly baseRow: PrototypeRow;
  readonly expectedVersion: number;
  readonly changes: readonly {
    readonly cellKey: CellKey;
    readonly field: PrototypeField;
    readonly before: number;
    readonly after: number;
  }[];
};

type Operation = {
  readonly id: string;
  readonly mode: PrototypeMode;
  readonly status: OperationStatus;
  readonly rows: readonly SubmittedRow[];
  readonly outstandingCells: readonly CellKey[];
  readonly failure: string | null;
};

type AcceptedOverlay = {
  readonly cellKey: CellKey;
  readonly operationId: string;
  readonly rowId: string;
  readonly field: PrototypeField;
  readonly expectedVersion: number;
  readonly after: number;
};

type Memory = {
  readonly canonicalRows: Readonly<Record<string, PrototypeRow>>;
  readonly drafts: Readonly<Partial<Record<CellKey, Draft>>>;
  readonly conflicts: Readonly<Partial<Record<CellKey, Conflict>>>;
  readonly history: readonly HistoryCommand[];
  readonly future: readonly HistoryCommand[];
  readonly operations: Readonly<Record<string, Operation>>;
  readonly overlays: Readonly<Partial<Record<CellKey, AcceptedOverlay>>>;
  readonly cellOwners: Readonly<Partial<Record<CellKey, string>>>;
  readonly batchLock: string | null;
  readonly nextOperation: number;
  readonly eventLog: readonly string[];
};

export type PrototypeCommand =
  | {
      readonly type: "TOGGLE_MODE";
    }
  | {
      readonly type: "EDIT";
      readonly rowId: string;
      readonly field: PrototypeField;
      readonly value: number;
    }
  | {
      readonly type: "SAVE";
    }
  | {
      readonly type: "RESOLVE";
      readonly operationId: string;
    }
  | {
      readonly type: "REJECT";
      readonly operationId: string;
      readonly message: string;
    }
  | {
      readonly type: "LIVE_ROW";
      readonly row: PrototypeRow;
    }
  | {
      readonly type: "DELETE_ROW";
      readonly rowId: string;
    }
  | {
      readonly type: "RESOLVE_MINE";
      readonly rowId: string;
      readonly field: PrototypeField;
    }
  | {
      readonly type: "RESOLVE_SERVER";
      readonly rowId: string;
      readonly field: PrototypeField;
    }
  | {
      readonly type: "UNDO";
    }
  | {
      readonly type: "REDO";
    }
  | {
      readonly type: "RESET";
    };

export type PrototypeSnapshot = {
  readonly workflow: string;
  readonly mode: PrototypeMode;
  readonly canonicalRows: readonly PrototypeRow[];
  readonly projectedRows: readonly PrototypeRow[];
  readonly drafts: readonly Draft[];
  readonly conflicts: readonly Conflict[];
  readonly operations: readonly Operation[];
  readonly overlays: readonly AcceptedOverlay[];
  readonly lockedCells: Readonly<Partial<Record<string, string>>>;
  readonly batchLock: string | null;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly eventLog: readonly string[];
};

export type PrototypeDispatchResult = {
  readonly accepted: boolean;
  readonly message: string;
};

export type EditSavePrototype = {
  readonly dispatch: (command: PrototypeCommand) => PrototypeDispatchResult;
  readonly snapshot: () => PrototypeSnapshot;
};

const workflowMachine = createMachine({
  id: "edit-save-prototype",
  initial: "immediate",
  states: {
    immediate: {
      on: {
        TOGGLE_BATCH: "batchClean",
      },
    },
    batchClean: {
      on: {
        TOGGLE_IMMEDIATE: "immediate",
        DRAFTED: "batchDirty",
      },
    },
    batchDirty: {
      on: {
        CLEANED: "batchClean",
        SAVE_STARTED: "batchSaving",
      },
    },
    batchSaving: {
      on: {
        SAVE_RESOLVED_WAITING: "batchWaitingSource",
        SAVE_RESOLVED_CONFIRMED: "batchClean",
        SAVE_REJECTED_DIRTY: "batchDirty",
        SAVE_REJECTED_CLEAN: "batchClean",
      },
    },
    batchWaitingSource: {
      on: {
        LIVE_CONFIRMED: "batchClean",
      },
    },
  },
});

const initialRows: Readonly<Record<string, PrototypeRow>> = {
  A: { id: "A", version: 1, price: 100, quantity: 10 },
  B: { id: "B", version: 1, price: 200, quantity: 20 },
};

function keyOf(rowId: string, field: PrototypeField): CellKey {
  return `${rowId}:${field}`;
}

function valueOf(row: PrototypeRow, field: PrototypeField): number {
  return row[field];
}

function withValue(row: PrototypeRow, field: PrototypeField, value: number): PrototypeRow {
  if (field === "price") {
    return { ...row, price: value };
  }
  return { ...row, quantity: value };
}

function valuesOf<TValue>(record: Readonly<Partial<Record<CellKey, TValue>>>): readonly TValue[] {
  return Object.values(record).filter((value): value is TValue => value !== undefined);
}

function appendEvent(memory: Memory, event: string): Memory {
  return {
    ...memory,
    eventLog: [...memory.eventLog, event].slice(-10),
  };
}

function withoutKey<TValue>(
  record: Readonly<Partial<Record<CellKey, TValue>>>,
  cellKey: CellKey,
): Readonly<Partial<Record<CellKey, TValue>>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== cellKey));
}

function pruneHistory(
  commands: readonly HistoryCommand[],
  cellKey: CellKey,
): readonly HistoryCommand[] {
  return commands
    .map((command) => ({
      ...command,
      patches: command.patches.filter((patch) => patch.cellKey !== cellKey),
    }))
    .filter((command) => command.patches.length > 0);
}

function operationCells(operation: Operation): readonly CellKey[] {
  return operation.rows.flatMap((row) => row.changes.map((change) => change.cellKey));
}

function operationRow(operation: Operation, rowId: string): SubmittedRow | undefined {
  return operation.rows.find((row) => row.rowId === rowId);
}

function releaseOperationRow(memory: Memory, operation: Operation, rowId: string): Memory {
  const submittedRow = operationRow(operation, rowId);
  if (submittedRow === undefined) {
    return memory;
  }

  let overlays = memory.overlays;
  let cellOwners = memory.cellOwners;
  const rowCells = submittedRow.changes.map((change) => change.cellKey);
  for (const cellKey of rowCells) {
    overlays = withoutKey(overlays, cellKey);
    if (cellOwners[cellKey] === operation.id) {
      cellOwners = withoutKey(cellOwners, cellKey);
    }
  }

  const outstandingCells = operation.outstandingCells.filter(
    (cellKey) => !rowCells.includes(cellKey),
  );
  const complete = outstandingCells.length === 0;
  return {
    ...memory,
    overlays,
    cellOwners,
    batchLock: complete && memory.batchLock === operation.id ? null : memory.batchLock,
    operations: {
      ...memory.operations,
      [operation.id]: {
        ...operation,
        status: complete ? "complete" : operation.status,
        outstandingCells,
      },
    },
  };
}

function reconcileWaitingOperation(memory: Memory, operation: Operation, rowId: string): Memory {
  const submittedRow = operationRow(operation, rowId);
  if (submittedRow === undefined) {
    return memory;
  }

  const canonical = memory.canonicalRows[rowId];
  if (canonical === undefined || canonical.version !== submittedRow.expectedVersion) {
    return releaseOperationRow(memory, operation, rowId);
  }

  let overlays = memory.overlays;
  let outstandingCells = operation.outstandingCells;
  for (const change of submittedRow.changes) {
    if (valueOf(canonical, change.field) === change.after) {
      overlays = withoutKey(overlays, change.cellKey);
      outstandingCells = outstandingCells.filter((cellKey) => cellKey !== change.cellKey);
    }
  }

  const rowStillOutstanding = submittedRow.changes.some((change) =>
    outstandingCells.includes(change.cellKey),
  );
  let cellOwners = memory.cellOwners;
  if (!rowStillOutstanding) {
    for (const change of submittedRow.changes) {
      if (cellOwners[change.cellKey] === operation.id) {
        cellOwners = withoutKey(cellOwners, change.cellKey);
      }
    }
  }

  const complete = outstandingCells.length === 0;
  return {
    ...memory,
    overlays,
    cellOwners,
    batchLock: complete && memory.batchLock === operation.id ? null : memory.batchLock,
    operations: {
      ...memory.operations,
      [operation.id]: {
        ...operation,
        status: complete ? "complete" : operation.status,
        outstandingCells,
      },
    },
  };
}

function reconcileRejectedOperation(memory: Memory, operation: Operation): Memory {
  let outstandingCells = operation.outstandingCells;
  for (const row of operation.rows) {
    const canonical = memory.canonicalRows[row.rowId];
    if (canonical === undefined) {
      continue;
    }
    for (const change of row.changes) {
      if (valueOf(canonical, change.field) === change.after) {
        outstandingCells = outstandingCells.filter((cellKey) => cellKey !== change.cellKey);
      }
    }
  }

  if (outstandingCells.length === operation.outstandingCells.length) {
    return memory;
  }

  const complete = outstandingCells.length === 0;
  return {
    ...memory,
    operations: {
      ...memory.operations,
      [operation.id]: {
        ...operation,
        status: complete ? "complete" : "rejected",
        outstandingCells,
        failure: complete ? null : operation.failure,
      },
    },
  };
}

function reconcileDrafts(memory: Memory, rowId: string): Memory {
  let next = memory;
  const canonical = next.canonicalRows[rowId];
  for (const draft of valuesOf(next.drafts).filter((candidate) => candidate.rowId === rowId)) {
    if (canonical === undefined) {
      next = {
        ...next,
        conflicts: {
          ...next.conflicts,
          [draft.cellKey]: {
            cellKey: draft.cellKey,
            rowId: draft.rowId,
            field: draft.field,
            base: draft.before,
            server: null,
            mine: draft.after,
          },
        },
      };
      continue;
    }

    const server = valueOf(canonical, draft.field);
    if (server === draft.after) {
      next = {
        ...next,
        drafts: withoutKey(next.drafts, draft.cellKey),
        conflicts: withoutKey(next.conflicts, draft.cellKey),
        history: pruneHistory(next.history, draft.cellKey),
        future: pruneHistory(next.future, draft.cellKey),
      };
    } else if (server !== draft.before) {
      next = {
        ...next,
        conflicts: {
          ...next.conflicts,
          [draft.cellKey]: {
            cellKey: draft.cellKey,
            rowId: draft.rowId,
            field: draft.field,
            base: draft.before,
            server,
            mine: draft.after,
          },
        },
      };
    } else {
      next = {
        ...next,
        conflicts: withoutKey(next.conflicts, draft.cellKey),
      };
    }
  }
  return next;
}

function projectedRows(memory: Memory): readonly PrototypeRow[] {
  const rows = Object.values(memory.canonicalRows).map((row) => {
    let projected = row;
    for (const operation of Object.values(memory.operations)) {
      if (operation.status !== "pending") {
        continue;
      }
      const submittedRow = operationRow(operation, row.id);
      if (submittedRow === undefined) {
        continue;
      }
      for (const change of submittedRow.changes) {
        projected = withValue(projected, change.field, change.after);
      }
    }
    for (const overlay of valuesOf(memory.overlays).filter(
      (candidate) => candidate.rowId === row.id,
    )) {
      projected = withValue(projected, overlay.field, overlay.after);
    }
    for (const draft of valuesOf(memory.drafts).filter((candidate) => candidate.rowId === row.id)) {
      projected = withValue(projected, draft.field, draft.after);
    }
    return projected;
  });
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

export function createEditSavePrototype(): EditSavePrototype {
  const workflow = createActor(workflowMachine).start();
  const memory = new Store<Memory>({
    canonicalRows: initialRows,
    drafts: {},
    conflicts: {},
    history: [],
    future: [],
    operations: {},
    overlays: {},
    cellOwners: {},
    batchLock: null,
    nextOperation: 1,
    eventLog: ["Prototype started in Immediate mode"],
  });

  const workflowName = (): string => {
    const current = workflow.getSnapshot();
    if (current.matches("immediate")) return "immediate";
    if (current.matches("batchClean")) return "batchClean";
    if (current.matches("batchDirty")) return "batchDirty";
    if (current.matches("batchSaving")) return "batchSaving";
    if (current.matches("batchWaitingSource")) return "batchWaitingSource";
    return "unknown";
  };
  const mode = (): PrototypeMode => (workflowName() === "immediate" ? "immediate" : "batch");

  const commit = (next: Memory): void => {
    memory.setState(() => next);
  };

  const result = (accepted: boolean, message: string): PrototypeDispatchResult => ({
    accepted,
    message,
  });

  const edit = (rowId: string, field: PrototypeField, value: number): PrototypeDispatchResult => {
    const current = memory.state;
    const row = current.canonicalRows[rowId];
    if (row === undefined) {
      return result(false, `Row ${rowId} is not in the complete Client Source.`);
    }
    const cellKey = keyOf(rowId, field);
    if (current.batchLock !== null) {
      return result(false, `Batch operation ${current.batchLock} owns the edit mutation lock.`);
    }
    if (current.cellOwners[cellKey] !== undefined) {
      return result(false, `Cell ${cellKey} is owned by ${current.cellOwners[cellKey]}.`);
    }

    if (mode() === "immediate") {
      const before = valueOf(row, field);
      if (before === value) {
        return result(false, "The candidate already equals the canonical value.");
      }
      const operationId = `OP_${current.nextOperation}`;
      const operation: Operation = {
        id: operationId,
        mode: "immediate",
        status: "pending",
        rows: [
          {
            rowId,
            baseRow: row,
            expectedVersion: row.version,
            changes: [{ cellKey, field, before, after: value }],
          },
        ],
        outstandingCells: [cellKey],
        failure: null,
      };
      commit(
        appendEvent(
          {
            ...current,
            operations: { ...current.operations, [operationId]: operation },
            cellOwners: { ...current.cellOwners, [cellKey]: operationId },
            nextOperation: current.nextOperation + 1,
          },
          `${operationId} started Immediate ${cellKey}: ${before} → ${value}`,
        ),
      );
      return result(true, `${operationId} is pending; only ${cellKey} is locked.`);
    }

    const existing = current.drafts[cellKey];
    const projectedBefore = existing?.after ?? valueOf(row, field);
    if (projectedBefore === value) {
      return result(false, "The candidate already equals the projected value.");
    }
    const base = existing?.before ?? valueOf(row, field);
    const baseVersion = existing?.baseVersion ?? row.version;
    const nextDraft: Draft | null =
      value === base ? null : { cellKey, rowId, field, before: base, after: value, baseVersion };
    const drafts =
      nextDraft === null
        ? withoutKey(current.drafts, cellKey)
        : {
            ...current.drafts,
            [cellKey]: nextDraft,
          };
    const next = appendEvent(
      {
        ...current,
        drafts,
        conflicts: withoutKey(current.conflicts, cellKey),
        history: [
          ...current.history,
          {
            label: `Edit ${cellKey}`,
            patches: [
              {
                cellKey,
                rowId,
                field,
                beforeState: {
                  draft: existing ?? null,
                  conflict: current.conflicts[cellKey] ?? null,
                },
                afterState: { draft: nextDraft, conflict: null },
              },
            ],
          },
        ],
        future: [],
      },
      `Batch draft ${cellKey}: ${projectedBefore} → ${value}`,
    );
    commit(next);
    if (valuesOf(drafts).length === 0) {
      workflow.send({ type: "CLEANED" });
    } else if (workflowName() === "batchClean") {
      workflow.send({ type: "DRAFTED" });
    }
    return result(true, `Batch now has ${valuesOf(drafts).length} net draft(s).`);
  };

  const toggleMode = (): PrototypeDispatchResult => {
    const current = memory.state;
    const active = Object.values(current.operations).some(
      (operation) => operation.status === "pending" || operation.status === "waiting-source",
    );
    if (
      active ||
      valuesOf(current.drafts).length > 0 ||
      valuesOf(current.conflicts).length > 0 ||
      current.history.length > 0 ||
      current.future.length > 0 ||
      current.batchLock !== null
    ) {
      return result(false, "Mode switching is blocked while edit-owned work is active.");
    }
    if (mode() === "immediate") {
      workflow.send({ type: "TOGGLE_BATCH" });
    } else {
      workflow.send({ type: "TOGGLE_IMMEDIATE" });
    }
    commit(appendEvent(current, `Mode changed to ${mode()}`));
    return result(true, `Mode is now ${mode()}.`);
  };

  const save = (): PrototypeDispatchResult => {
    if (mode() !== "batch" || workflowName() !== "batchDirty") {
      return result(false, "Batch Save requires the batchDirty workflow state.");
    }
    let current = memory.state;
    for (const rowId of new Set(valuesOf(current.drafts).map((draft) => draft.rowId))) {
      current = reconcileDrafts(current, rowId);
    }
    if (valuesOf(current.conflicts).length > 0) {
      commit(appendEvent(current, "Batch Save entered Conflict Review"));
      return result(false, "Resolve every conflict before Save can invoke the application.");
    }
    const drafts = valuesOf(current.drafts);
    if (drafts.length === 0) {
      commit(appendEvent(current, "Batch drafts already converged; no Save Operation created"));
      workflow.send({ type: "CLEANED" });
      return result(false, "The live source already matches every draft.");
    }

    const submittedRows: SubmittedRow[] = [];
    for (const rowId of new Set(drafts.map((draft) => draft.rowId))) {
      const row = current.canonicalRows[rowId];
      if (row === undefined) {
        return result(false, `Row ${rowId} disappeared; its change is blocked.`);
      }
      const rowDrafts = drafts.filter((draft) => draft.rowId === rowId);
      if (rowDrafts.some((draft) => valueOf(row, draft.field) !== draft.before)) {
        current = reconcileDrafts(current, rowId);
        commit(appendEvent(current, `Batch Save found a conflict in row ${rowId}`));
        return result(false, `Row ${rowId} diverged on an edited field.`);
      }
      submittedRows.push({
        rowId,
        baseRow: row,
        expectedVersion: row.version,
        changes: rowDrafts.map((draft) => ({
          cellKey: draft.cellKey,
          field: draft.field,
          before: valueOf(row, draft.field),
          after: draft.after,
        })),
      });
    }

    const operationId = `OP_${current.nextOperation}`;
    const operation: Operation = {
      id: operationId,
      mode: "batch",
      status: "pending",
      rows: submittedRows,
      outstandingCells: submittedRows.flatMap((row) => row.changes.map((change) => change.cellKey)),
      failure: null,
    };
    commit(
      appendEvent(
        {
          ...current,
          operations: { ...current.operations, [operationId]: operation },
          batchLock: operationId,
          nextOperation: current.nextOperation + 1,
        },
        `${operationId} started atomic Batch Save (${operation.outstandingCells.length} cells)`,
      ),
    );
    workflow.send({ type: "SAVE_STARTED" });
    return result(true, `${operationId} is pending with the table-wide edit mutation lock.`);
  };

  const resolve = (operationId: string): PrototypeDispatchResult => {
    const current = memory.state;
    const operation = current.operations[operationId];
    if (operation === undefined || operation.status !== "pending") {
      return result(false, `${operationId} is not a pending operation.`);
    }

    let next: Memory = {
      ...current,
      drafts: operation.mode === "batch" ? {} : current.drafts,
      conflicts: operation.mode === "batch" ? {} : current.conflicts,
      history: operation.mode === "batch" ? [] : current.history,
      future: operation.mode === "batch" ? [] : current.future,
      operations: {
        ...current.operations,
        [operationId]: { ...operation, status: "waiting-source", failure: null },
      },
    };

    for (const row of operation.rows) {
      const canonical = next.canonicalRows[row.rowId];
      if (canonical === undefined || canonical.version !== row.expectedVersion) {
        next = releaseOperationRow(next, next.operations[operationId] ?? operation, row.rowId);
        continue;
      }
      for (const change of row.changes) {
        if (valueOf(canonical, change.field) !== change.after) {
          next = {
            ...next,
            overlays: {
              ...next.overlays,
              [change.cellKey]: {
                cellKey: change.cellKey,
                operationId,
                rowId: row.rowId,
                field: change.field,
                expectedVersion: row.expectedVersion,
                after: change.after,
              },
            },
          };
        }
      }
      next = reconcileWaitingOperation(next, next.operations[operationId] ?? operation, row.rowId);
    }

    const settled = next.operations[operationId] ?? operation;
    next = appendEvent(
      next,
      settled.status === "complete"
        ? `${operationId} resolved and was already live-confirmed`
        : `${operationId} resolved; Accepted Overlays await live confirmation`,
    );
    commit(next);
    if (operation.mode === "batch") {
      workflow.send({
        type: settled.status === "complete" ? "SAVE_RESOLVED_CONFIRMED" : "SAVE_RESOLVED_WAITING",
      });
    }
    return result(
      true,
      settled.status === "complete"
        ? `${operationId} completed immediately from authoritative live evidence.`
        : `${operationId} was accepted and is waiting without a timeout.`,
    );
  };

  const reject = (operationId: string, message: string): PrototypeDispatchResult => {
    const current = memory.state;
    const operation = current.operations[operationId];
    if (operation === undefined || operation.status !== "pending") {
      return result(false, `${operationId} is not a pending operation.`);
    }
    let cellOwners = current.cellOwners;
    if (operation.mode === "immediate") {
      for (const cellKey of operationCells(operation)) {
        if (cellOwners[cellKey] === operationId) {
          cellOwners = withoutKey(cellOwners, cellKey);
        }
      }
    }
    let next: Memory = {
      ...current,
      cellOwners,
      batchLock: current.batchLock === operationId ? null : current.batchLock,
      operations: {
        ...current.operations,
        [operationId]: { ...operation, status: "rejected", failure: message },
      },
    };
    next = reconcileRejectedOperation(next, next.operations[operationId] ?? operation);
    const rejected = next.operations[operationId] ?? operation;
    next = appendEvent(
      next,
      rejected.status === "complete"
        ? `${operationId} rejected, but the live source had already converged`
        : `${operationId} rejected: ${message}`,
    );
    commit(next);
    if (operation.mode === "batch") {
      workflow.send({
        type: valuesOf(next.drafts).length === 0 ? "SAVE_REJECTED_CLEAN" : "SAVE_REJECTED_DIRTY",
      });
    }
    return result(
      true,
      rejected.status === "complete"
        ? "Live convergence superseded the ambiguous rejection."
        : `${operationId} failed without an automatic retry.`,
    );
  };

  const publishRow = (row: PrototypeRow): PrototypeDispatchResult => {
    let next: Memory = {
      ...memory.state,
      canonicalRows: { ...memory.state.canonicalRows, [row.id]: row },
    };
    next = reconcileDrafts(next, row.id);
    for (const operation of Object.values(next.operations)) {
      if (operation.status === "waiting-source") {
        next = reconcileWaitingOperation(next, next.operations[operation.id] ?? operation, row.id);
      } else if (operation.status === "rejected") {
        next = reconcileRejectedOperation(next, next.operations[operation.id] ?? operation);
      }
    }
    next = appendEvent(next, `Live row ${row.id} published at opaque version ${row.version}`);
    commit(next);
    if (workflowName() === "batchWaitingSource" && next.batchLock === null) {
      workflow.send({ type: "LIVE_CONFIRMED" });
    } else if (workflowName() === "batchDirty" && valuesOf(next.drafts).length === 0) {
      workflow.send({ type: "CLEANED" });
    }
    return result(true, `Canonical row ${row.id} is now version ${row.version}.`);
  };

  const deleteRow = (rowId: string): PrototypeDispatchResult => {
    const current = memory.state;
    if (current.canonicalRows[rowId] === undefined) {
      return result(false, `Row ${rowId} is already absent.`);
    }
    const canonicalRows = Object.fromEntries(
      Object.entries(current.canonicalRows).filter(([id]) => id !== rowId),
    );
    let next: Memory = { ...current, canonicalRows };
    next = reconcileDrafts(next, rowId);
    for (const operation of Object.values(next.operations)) {
      if (operation.status === "waiting-source") {
        next = reconcileWaitingOperation(next, next.operations[operation.id] ?? operation, rowId);
      }
    }
    next = appendEvent(next, `Live source authoritatively removed row ${rowId}`);
    commit(next);
    if (workflowName() === "batchWaitingSource" && next.batchLock === null) {
      workflow.send({ type: "LIVE_CONFIRMED" });
    }
    return result(true, `Row ${rowId} is absent from the complete source.`);
  };

  const resolveConflict = (
    rowId: string,
    field: PrototypeField,
    choice: "mine" | "server",
  ): PrototypeDispatchResult => {
    const current = memory.state;
    const cellKey = keyOf(rowId, field);
    const conflict = current.conflicts[cellKey];
    const draft = current.drafts[cellKey];
    if (conflict === undefined || draft === undefined) {
      return result(false, `${cellKey} has no conflict.`);
    }
    if (choice === "server") {
      const next = appendEvent(
        {
          ...current,
          drafts: withoutKey(current.drafts, cellKey),
          conflicts: withoutKey(current.conflicts, cellKey),
          history: [
            ...current.history,
            {
              label: `Resolve ${cellKey} with Server`,
              patches: [
                {
                  cellKey,
                  rowId,
                  field,
                  beforeState: { draft, conflict },
                  afterState: { draft: null, conflict: null },
                },
              ],
            },
          ],
          future: [],
        },
        `Conflict ${cellKey} resolved with Server`,
      );
      commit(next);
      if (valuesOf(next.drafts).length === 0) {
        workflow.send({ type: "CLEANED" });
      }
      return result(true, `${cellKey} now follows Server.`);
    }
    const row = current.canonicalRows[rowId];
    if (row === undefined) {
      return result(false, "Mine cannot be rebased while the source row is missing.");
    }
    const server = valueOf(row, field);
    const rebasedDraft: Draft = {
      ...draft,
      before: server,
      baseVersion: row.version,
    };
    commit(
      appendEvent(
        {
          ...current,
          drafts: {
            ...current.drafts,
            [cellKey]: rebasedDraft,
          },
          conflicts: withoutKey(current.conflicts, cellKey),
          history: [
            ...current.history,
            {
              label: `Resolve ${cellKey} with Mine`,
              patches: [
                {
                  cellKey,
                  rowId,
                  field,
                  beforeState: { draft, conflict },
                  afterState: { draft: rebasedDraft, conflict: null },
                },
              ],
            },
          ],
          future: [],
        },
        `Conflict ${cellKey} resolved with Mine and rebased to version ${row.version}`,
      ),
    );
    return result(true, `${cellKey} keeps Mine against the latest Base.`);
  };

  const replay = (direction: "undo" | "redo"): PrototypeDispatchResult => {
    const current = memory.state;
    if (mode() !== "batch" || current.batchLock !== null) {
      return result(false, "Undo/redo is available only in an unlocked current Batch.");
    }
    const source = direction === "undo" ? current.history : current.future;
    const command = source.at(-1);
    if (command === undefined) {
      return result(false, `Nothing to ${direction}.`);
    }

    let drafts = current.drafts;
    let conflicts = current.conflicts;
    const affectedRows = new Set<string>();
    for (const patch of command.patches) {
      const cellState = direction === "undo" ? patch.beforeState : patch.afterState;
      affectedRows.add(patch.rowId);
      if (cellState.draft === null) {
        drafts = withoutKey(drafts, patch.cellKey);
      } else {
        drafts = { ...drafts, [patch.cellKey]: cellState.draft };
      }
      if (cellState.conflict === null) {
        conflicts = withoutKey(conflicts, patch.cellKey);
      } else {
        conflicts = { ...conflicts, [patch.cellKey]: cellState.conflict };
      }
    }

    const history =
      direction === "undo" ? current.history.slice(0, -1) : [...current.history, command];
    const future =
      direction === "undo" ? [...current.future, command] : current.future.slice(0, -1);
    let next: Memory = { ...current, drafts, conflicts, history, future };
    for (const rowId of affectedRows) {
      next = reconcileDrafts(next, rowId);
    }
    next = appendEvent(next, `${direction === "undo" ? "Undid" : "Redid"} ${command.label}`);
    commit(next);
    if (valuesOf(drafts).length === 0) {
      workflow.send({ type: "CLEANED" });
    } else if (workflowName() === "batchClean") {
      workflow.send({ type: "DRAFTED" });
    }
    return result(true, `${command.label} ${direction} completed.`);
  };

  const reset = (): PrototypeDispatchResult => {
    const current = memory.state;
    if (mode() !== "batch" || current.batchLock !== null) {
      return result(false, "Reset is available only in an unlocked Batch.");
    }
    const next = appendEvent(
      { ...current, drafts: {}, conflicts: {}, history: [], future: [] },
      "Reset discarded current Batch edit-owned state",
    );
    commit(next);
    if (workflowName() === "batchDirty") {
      workflow.send({ type: "CLEANED" });
    }
    return result(true, "Current Batch state was reset to the live source.");
  };

  const dispatch = (command: PrototypeCommand): PrototypeDispatchResult => {
    switch (command.type) {
      case "TOGGLE_MODE":
        return toggleMode();
      case "EDIT":
        return edit(command.rowId, command.field, command.value);
      case "SAVE":
        return save();
      case "RESOLVE":
        return resolve(command.operationId);
      case "REJECT":
        return reject(command.operationId, command.message);
      case "LIVE_ROW":
        return publishRow(command.row);
      case "DELETE_ROW":
        return deleteRow(command.rowId);
      case "RESOLVE_MINE":
        return resolveConflict(command.rowId, command.field, "mine");
      case "RESOLVE_SERVER":
        return resolveConflict(command.rowId, command.field, "server");
      case "UNDO":
        return replay("undo");
      case "REDO":
        return replay("redo");
      case "RESET":
        return reset();
    }
  };

  const snapshot = (): PrototypeSnapshot => {
    const current = memory.state;
    return {
      workflow: workflowName(),
      mode: mode(),
      canonicalRows: Object.values(current.canonicalRows).sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      projectedRows: projectedRows(current),
      drafts: valuesOf(current.drafts),
      conflicts: valuesOf(current.conflicts),
      operations: Object.values(current.operations),
      overlays: valuesOf(current.overlays),
      lockedCells: current.cellOwners,
      batchLock: current.batchLock,
      undoDepth: current.history.length,
      redoDepth: current.future.length,
      eventLog: current.eventLog,
    };
  };

  return { dispatch, snapshot };
}
