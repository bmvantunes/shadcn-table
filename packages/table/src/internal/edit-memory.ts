import { batch, Store } from "@tanstack/store";
import { assign, createActor, createMachine } from "xstate";

import type {
  BrunoTableCellEditChangeGesture,
  BrunoTableCellEditActivitySnapshot,
  BrunoTableCellEditDraftReviewSourceRow,
  BrunoTableCellEditRuntime,
  BrunoTableCellEditSaveChangeSet,
} from "./cell-edit";

type Listener = () => void;

export type BrunoTableEditMode = "immediate" | "batch";

export type BrunoTableEditModeSnapshot = Readonly<{
  readonly mode: BrunoTableEditMode;
  readonly canChange: boolean;
}>;

export type BrunoTableResetReviewSnapshot = Readonly<{
  readonly open: boolean;
  readonly pendingCount: number;
  readonly historyCount: number;
  readonly canResetAll: boolean;
}>;

export type BrunoTableEditSafetyStatusSnapshot = Readonly<{
  readonly pendingCount: number;
  readonly blockedCount: number;
  readonly validationCount: number;
  readonly conflictCount: number;
}>;

export type BrunoTableEditHotkeyAvailabilitySnapshot = Readonly<{
  readonly undo: boolean;
  readonly redo: boolean;
}>;

export type BrunoTableSaveFailureSnapshot = Readonly<{
  readonly count: number;
  readonly messages: readonly string[];
  readonly operations: readonly Readonly<{
    readonly operationId: string;
    readonly message: string;
    readonly rows: readonly Readonly<{
      readonly rowId: string;
      readonly expectedVersion: unknown;
      readonly cells: readonly Readonly<{
        readonly columnId: string;
        readonly field: string;
        readonly before: unknown;
        readonly after: unknown;
      }>[];
    }>[];
  }>[];
}>;

export type BrunoTableSaveWorkSnapshot = Readonly<{
  readonly pendingBatchCount: number;
  readonly awaitingBatchCount: number;
  readonly awaitingBatchRowCount: number;
  readonly pendingImmediateCount: number;
  readonly awaitingImmediateCount: number;
}>;

type EditWorkflowContext = Readonly<{
  readonly mode: BrunoTableEditMode;
  readonly activity: BrunoTableCellEditActivitySnapshot;
  readonly saveWorkActive: boolean;
  readonly retainedSaveOperationActive: boolean;
  readonly resetReviewOpen: boolean;
  readonly saveFailureDismissalVersion: number;
}>;

type EditWorkflowEvent =
  | Readonly<{ readonly type: "SET_MODE"; readonly mode: BrunoTableEditMode }>
  | Readonly<{
      readonly type: "SYNC_ACTIVITY";
      readonly activity: BrunoTableCellEditActivitySnapshot;
    }>
  | Readonly<{ readonly type: "SET_SAVE_WORK"; readonly active: boolean }>
  | Readonly<{ readonly type: "SET_RETAINED_SAVE_OPERATION"; readonly active: boolean }>
  | Readonly<{ readonly type: "OPEN_RESET_REVIEW" }>
  | Readonly<{ readonly type: "CLOSE_RESET_REVIEW" }>
  | Readonly<{ readonly type: "CONFIRM_RESET" }>
  | Readonly<{ readonly type: "DISMISS_SAVE_FAILURES" }>;

const INITIAL_MODE_SNAPSHOT: BrunoTableEditModeSnapshot = Object.freeze({
  mode: "immediate",
  canChange: true,
});
const CLOSED_RESET_REVIEW: BrunoTableResetReviewSnapshot = Object.freeze({
  open: false,
  pendingCount: 0,
  historyCount: 0,
  canResetAll: false,
});
const CLEAN_EDIT_SAFETY_STATUS: BrunoTableEditSafetyStatusSnapshot = Object.freeze({
  pendingCount: 0,
  blockedCount: 0,
  validationCount: 0,
  conflictCount: 0,
});
const NO_EDIT_HOTKEYS: BrunoTableEditHotkeyAvailabilitySnapshot = Object.freeze({
  undo: false,
  redo: false,
});
const NO_SAVE_FAILURES: BrunoTableSaveFailureSnapshot = Object.freeze({
  count: 0,
  messages: Object.freeze([]),
  operations: Object.freeze([]),
});
const NO_SAVE_WORK: BrunoTableSaveWorkSnapshot = Object.freeze({
  pendingBatchCount: 0,
  awaitingBatchCount: 0,
  awaitingBatchRowCount: 0,
  pendingImmediateCount: 0,
  awaitingImmediateCount: 0,
});
const CLEAN_CELL_EDIT_ACTIVITY: BrunoTableCellEditActivitySnapshot = Object.freeze({
  activeEditor: false,
  activeCandidatePending: false,
  reviewCount: 0,
  draftCount: 0,
  undoCount: 0,
  redoCount: 0,
  blockedCount: 0,
  validationCount: 0,
  conflictCount: 0,
});

function hasEditOwnedWork(activity: BrunoTableCellEditActivitySnapshot): boolean {
  return (
    activity.activeCandidatePending ||
    activity.draftCount > 0 ||
    activity.validationCount > 0 ||
    activity.conflictCount > 0 ||
    activity.undoCount > 0 ||
    activity.redoCount > 0
  );
}

function canChangeMode(context: EditWorkflowContext): boolean {
  const activity = context.activity;
  return (
    !context.retainedSaveOperationActive &&
    !context.saveWorkActive &&
    !activity.activeEditor &&
    !hasEditOwnedWork(activity)
  );
}

function canReset(context: EditWorkflowContext): boolean {
  return !context.saveWorkActive && hasEditOwnedWork(context.activity);
}

const brunoTableEditWorkflowMachine = createMachine({
  id: "brunoTableEditWorkflow",
  initial: "ready",
  types: {} as { context: EditWorkflowContext; events: EditWorkflowEvent },
  context: {
    mode: "immediate",
    activity: CLEAN_CELL_EDIT_ACTIVITY,
    saveWorkActive: false,
    retainedSaveOperationActive: false,
    resetReviewOpen: false,
    saveFailureDismissalVersion: 0,
  },
  states: {
    ready: {
      on: {
        SET_MODE: {
          guard: ({ context }) => canChangeMode(context),
          actions: assign({ mode: ({ event }) => event.mode }),
        },
        SYNC_ACTIVITY: {
          actions: assign({ activity: ({ event }) => event.activity }),
        },
        SET_SAVE_WORK: {
          actions: assign({
            saveWorkActive: ({ event }) => event.active,
            resetReviewOpen: ({ context, event }) =>
              event.active ? false : context.resetReviewOpen,
          }),
        },
        SET_RETAINED_SAVE_OPERATION: {
          actions: assign({
            retainedSaveOperationActive: ({ event }) => event.active,
          }),
        },
        OPEN_RESET_REVIEW: {
          guard: ({ context }) => canReset(context),
          actions: assign({ resetReviewOpen: true }),
        },
        CLOSE_RESET_REVIEW: {
          actions: assign({ resetReviewOpen: false }),
        },
        CONFIRM_RESET: {
          guard: ({ context }) => context.resetReviewOpen && canReset(context),
          actions: assign({ resetReviewOpen: false }),
        },
        DISMISS_SAVE_FAILURES: {
          actions: assign({
            saveFailureDismissalVersion: ({ context }) => context.saveFailureDismissalVersion + 1,
          }),
        },
      },
    },
  },
});

export class BrunoTableEditMemoryRuntime {
  private actor = createActor(brunoTableEditWorkflowMachine);
  private actorActive = false;
  private activeSaveWorkCount = 0;
  private activeRetainedSaveOperationCount = 0;
  private readonly modeStore = new Store<BrunoTableEditModeSnapshot>(INITIAL_MODE_SNAPSHOT);
  private readonly safetyStatusStore = new Store<BrunoTableEditSafetyStatusSnapshot>(
    CLEAN_EDIT_SAFETY_STATUS,
  );
  private readonly canResetStore = new Store(false);
  private readonly canSaveStore = new Store(false);
  private readonly hotkeyAvailabilityStore = new Store<BrunoTableEditHotkeyAvailabilitySnapshot>(
    NO_EDIT_HOTKEYS,
  );
  private readonly saveFailureStore = new Store<BrunoTableSaveFailureSnapshot>(NO_SAVE_FAILURES);
  private readonly saveWorkStore = new Store<BrunoTableSaveWorkSnapshot>(NO_SAVE_WORK);
  private readonly saveFailures = new Map<
    string,
    Readonly<{
      readonly message: string;
      readonly rows: BrunoTableSaveFailureSnapshot["operations"][number]["rows"];
    }>
  >();
  private readonly saveWorkByOperation = new Map<
    string,
    Readonly<{
      readonly kind: "batch" | "immediate";
      readonly phase: "pending" | "awaiting-source";
      readonly remainingRows: number;
    }>
  >();
  private publishedSaveFailureDismissalVersion = 0;
  private readonly resetReviewStore = new Store<BrunoTableResetReviewSnapshot>(CLOSED_RESET_REVIEW);
  private readonly resetReviewRowsStore = new Store<
    readonly BrunoTableCellEditDraftReviewSourceRow[]
  >(Object.freeze([]));
  private cellEdit: BrunoTableCellEditRuntime | undefined;
  private saveCommand: (() => void) | undefined;
  private immediateSaveCommand: ((changes: BrunoTableCellEditChangeGesture) => void) | undefined;
  private conflictReviewCommand: (() => void) | undefined;
  private gridFocusCommand: (() => void) | undefined;
  private resetFocusFrame: number | undefined;
  private unsubscribeDraftReview: (() => void) | undefined;
  private readonly resetControls = new Set<Element>();
  private readonly unregisterResetControls = new Map<Element, () => void>();
  private cellEditActivity: BrunoTableCellEditActivitySnapshot = CLEAN_CELL_EDIT_ACTIVITY;
  private saveOperationCapacityAvailable = true;
  private savePreflightAvailable = true;

  public readonly activate = (): void => {
    if (this.actorActive) return;
    if (this.actor.getSnapshot().status === "stopped") {
      this.actor = createActor(brunoTableEditWorkflowMachine);
    }
    this.actor.subscribe(() => this.publishWorkflow());
    this.actor.start();
    this.actorActive = true;
    this.actor.send({ type: "SYNC_ACTIVITY", activity: this.cellEditActivity });
  };

  public readonly dispose = (): void => {
    if (!this.actorActive) return;
    this.actor.stop();
    this.actorActive = false;
    this.activeSaveWorkCount = 0;
    this.activeRetainedSaveOperationCount = 0;
    this.saveOperationCapacityAvailable = true;
    this.savePreflightAvailable = true;
    this.saveCommand = undefined;
    this.immediateSaveCommand = undefined;
    this.conflictReviewCommand = undefined;
    this.gridFocusCommand = undefined;
    this.cellEdit = undefined;
    if (this.resetFocusFrame !== undefined) cancelAnimationFrame(this.resetFocusFrame);
    this.resetFocusFrame = undefined;
    this.modeStore.setState(() => INITIAL_MODE_SNAPSHOT);
    this.reconcileCellEditActivity(CLEAN_CELL_EDIT_ACTIVITY);
    this.canResetStore.setState(() => false);
    this.canSaveStore.setState(() => false);
    this.hotkeyAvailabilityStore.setState(() => NO_EDIT_HOTKEYS);
    this.saveFailureStore.setState(() => NO_SAVE_FAILURES);
    this.saveWorkStore.setState(() => NO_SAVE_WORK);
    this.saveFailures.clear();
    this.saveWorkByOperation.clear();
    this.publishedSaveFailureDismissalVersion = 0;
    this.resetReviewStore.setState(() => CLOSED_RESET_REVIEW);
    this.unsubscribeDraftReview?.();
    this.unsubscribeDraftReview = undefined;
    for (const unregister of this.unregisterResetControls.values()) unregister();
    this.unregisterResetControls.clear();
    this.resetControls.clear();
    this.resetReviewRowsStore.setState(() => Object.freeze([]));
  };

  public readonly connectCellEdit = (runtime: BrunoTableCellEditRuntime): (() => void) => {
    this.cellEdit = runtime;
    for (const element of this.resetControls) {
      this.unregisterResetControls.set(element, runtime.registerResetControl(element));
    }
    runtime.setBatchHistoryEnabled(this.modeStore.get().mode === "batch");
    const reconcile = (): void => {
      if (this.cellEdit === runtime) {
        this.reconcileCellEditActivity(runtime.getActivitySnapshot());
      }
    };
    reconcile();
    const unsubscribe = runtime.subscribeActivity(reconcile);
    return () => {
      unsubscribe();
      for (const unregister of this.unregisterResetControls.values()) unregister();
      this.unregisterResetControls.clear();
      this.unsubscribeDraftReview?.();
      this.unsubscribeDraftReview = undefined;
      if (this.cellEdit === runtime) this.cellEdit = undefined;
      this.reconcileCellEditActivity(CLEAN_CELL_EDIT_ACTIVITY);
      this.resetReviewRowsStore.setState(() => Object.freeze([]));
    };
  };

  public readonly registerResetControl = (element: Element): (() => void) => {
    this.resetControls.add(element);
    if (this.cellEdit !== undefined) {
      this.unregisterResetControls.set(element, this.cellEdit.registerResetControl(element));
    }
    return () => {
      this.unregisterResetControls.get(element)?.();
      this.unregisterResetControls.delete(element);
      this.resetControls.delete(element);
    };
  };

  public readonly getModeSnapshot = (): BrunoTableEditModeSnapshot => this.modeStore.get();

  public readonly subscribeMode = (listener: Listener): (() => void) => {
    const subscription = this.modeStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly requestMode = (mode: BrunoTableEditMode): boolean => {
    const current = this.modeStore.get();
    if (!current.canChange) return false;
    if (current.mode === mode) return true;
    this.actor.send({ type: "SET_MODE", mode });
    return this.modeStore.get().mode === mode;
  };

  public readonly getSafetyStatusSnapshot = (): BrunoTableEditSafetyStatusSnapshot =>
    this.safetyStatusStore.get();

  public readonly subscribeSafetyStatus = (listener: Listener): (() => void) => {
    const subscription = this.safetyStatusStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getCanResetSnapshot = (): boolean => this.canResetStore.get();

  public readonly subscribeCanReset = (listener: Listener): (() => void) => {
    const subscription = this.canResetStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getCanSaveSnapshot = (): boolean => this.canSaveStore.get();

  public readonly subscribeCanSave = (listener: Listener): (() => void) => {
    const subscription = this.canSaveStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getHotkeyAvailabilitySnapshot = (): BrunoTableEditHotkeyAvailabilitySnapshot =>
    this.hotkeyAvailabilityStore.get();

  public readonly getSaveFailureSnapshot = (): BrunoTableSaveFailureSnapshot =>
    this.saveFailureStore.get();

  public readonly getSaveWorkSnapshot = (): BrunoTableSaveWorkSnapshot => this.saveWorkStore.get();

  public readonly subscribeSaveWork = (listener: Listener): (() => void) => {
    const subscription = this.saveWorkStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly subscribeSaveFailure = (listener: Listener): (() => void) => {
    const subscription = this.saveFailureStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly recordSaveFailure = (
    operationId: string,
    reason: unknown,
    changeSet: BrunoTableCellEditSaveChangeSet,
  ): void => {
    let explanation = "The save could not be confirmed.";
    try {
      const message = reason instanceof Error ? reason.message : undefined;
      if (typeof message === "string" && message.trim().length > 0) {
        explanation = message.trim().slice(0, 500);
      }
    } catch {
      explanation = "The save could not be confirmed.";
    }
    this.saveFailures.set(
      operationId,
      Object.freeze({
        message: explanation,
        rows: Object.freeze(
          changeSet.map((row) =>
            Object.freeze({
              rowId: row.rowId,
              expectedVersion: row.expectedVersion,
              cells: Object.freeze(
                row.changes.map((change) =>
                  Object.freeze({
                    columnId: change.columnId,
                    field: change.field,
                    before: change.before,
                    after: change.after,
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    );
    while (this.saveFailures.size > 128) {
      const oldest = this.saveFailures.keys().next().value;
      if (oldest === undefined) break;
      this.saveFailures.delete(oldest);
    }
    this.publishSaveFailures();
  };

  public readonly clearSaveFailure = (operationId: string): void => {
    if (!this.saveFailures.delete(operationId)) return;
    this.publishSaveFailures();
  };

  public readonly retainSaveFailureCells = (
    operationId: string,
    cells: readonly Readonly<{ readonly rowId: string; readonly columnId: string }>[],
  ): void => {
    const failure = this.saveFailures.get(operationId);
    if (failure === undefined) return;
    const retainedByRow = new Map<string, Set<string>>();
    for (const cell of cells) {
      const columns = retainedByRow.get(cell.rowId) ?? new Set<string>();
      columns.add(cell.columnId);
      retainedByRow.set(cell.rowId, columns);
    }
    const rows = failure.rows.flatMap((row) => {
      const columns = retainedByRow.get(row.rowId);
      if (columns === undefined) return [];
      const retainedCells = row.cells.filter((cell) => columns.has(cell.columnId));
      return retainedCells.length === 0
        ? []
        : retainedCells.length === row.cells.length
          ? [row]
          : [Object.freeze({ ...row, cells: Object.freeze(retainedCells) })];
    });
    if (
      rows.length === failure.rows.length &&
      rows.every((row, index) => row === failure.rows[index])
    ) {
      return;
    }
    if (rows.length === 0) {
      this.clearSaveFailure(operationId);
      return;
    }
    this.saveFailures.set(operationId, Object.freeze({ ...failure, rows: Object.freeze(rows) }));
    this.publishSaveFailures();
  };

  public readonly dismissSaveFailures = (): void => {
    if (this.saveFailures.size === 0) return;
    this.actor.send({ type: "DISMISS_SAVE_FAILURES" });
  };

  public readonly subscribeHotkeyAvailability = (listener: Listener): (() => void) => {
    const subscription = this.hotkeyAvailabilityStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly registerSaveCommand = (command: () => void): (() => void) => {
    this.saveCommand = command;
    this.publishCanSave(
      this.modeStore.get().mode,
      this.cellEditActivity.draftCount,
      this.cellEditActivity.blockedCount,
    );
    return () => {
      if (this.saveCommand !== command) return;
      this.saveCommand = undefined;
      this.publishCanSave(
        this.modeStore.get().mode,
        this.cellEditActivity.draftCount,
        this.cellEditActivity.blockedCount,
      );
    };
  };

  public readonly registerImmediateSaveCommand = (
    command: (changes: BrunoTableCellEditChangeGesture) => void,
  ): (() => void) => {
    this.immediateSaveCommand = command;
    return () => {
      if (this.immediateSaveCommand === command) this.immediateSaveCommand = undefined;
    };
  };

  public readonly requestImmediateSave = (changes: BrunoTableCellEditChangeGesture): boolean => {
    if (
      !this.saveOperationCapacityAvailable ||
      !this.savePreflightAvailable ||
      this.modeStore.get().mode !== "immediate" ||
      this.immediateSaveCommand === undefined
    ) {
      return false;
    }
    this.immediateSaveCommand(changes);
    return true;
  };

  public readonly setSaveOperationCapacityAvailable = (available: boolean): void => {
    if (this.saveOperationCapacityAvailable === available) return;
    this.saveOperationCapacityAvailable = available;
    this.publishCanSave(
      this.modeStore.get().mode,
      this.cellEditActivity.draftCount,
      this.cellEditActivity.blockedCount,
    );
  };

  public readonly setSavePreflightAvailable = (available: boolean): void => {
    if (this.savePreflightAvailable === available) return;
    this.savePreflightAvailable = available;
    this.publishCanSave(
      this.modeStore.get().mode,
      this.cellEditActivity.draftCount,
      this.cellEditActivity.blockedCount,
    );
  };

  public readonly registerConflictReviewCommand = (command: () => void): (() => void) => {
    this.conflictReviewCommand = command;
    this.publishCanSave(
      this.modeStore.get().mode,
      this.cellEditActivity.draftCount,
      this.cellEditActivity.blockedCount,
    );
    return () => {
      if (this.conflictReviewCommand !== command) return;
      this.conflictReviewCommand = undefined;
      this.publishCanSave(
        this.modeStore.get().mode,
        this.cellEditActivity.draftCount,
        this.cellEditActivity.blockedCount,
      );
    };
  };

  public readonly requestSave = (): boolean => {
    if (!this.canSaveStore.get()) return false;
    if (this.cellEditActivity.conflictCount > 0) {
      if (this.conflictReviewCommand === undefined) return false;
      this.conflictReviewCommand();
      return true;
    }
    if (this.saveCommand === undefined) return false;
    this.saveCommand();
    return true;
  };

  public readonly beginSaveWork = (
    operationId?: string,
    kind: "batch" | "immediate" = "immediate",
  ): (() => void) => {
    this.activeSaveWorkCount += 1;
    if (operationId !== undefined) {
      this.saveWorkByOperation.set(
        operationId,
        Object.freeze({ kind, phase: "pending", remainingRows: 0 }),
      );
      this.publishSaveWork();
    }
    if (this.activeSaveWorkCount === 1) this.actor.send({ type: "SET_SAVE_WORK", active: true });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeSaveWorkCount = Math.max(0, this.activeSaveWorkCount - 1);
      if (operationId !== undefined && this.saveWorkByOperation.delete(operationId)) {
        this.publishSaveWork();
      }
      if (this.activeSaveWorkCount === 0 && this.actorActive) {
        this.actor.send({ type: "SET_SAVE_WORK", active: false });
      }
    };
  };

  public readonly beginRetainedSaveOperation = (): (() => void) => {
    this.activeRetainedSaveOperationCount += 1;
    if (this.activeRetainedSaveOperationCount === 1) {
      this.actor.send({ type: "SET_RETAINED_SAVE_OPERATION", active: true });
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeRetainedSaveOperationCount = Math.max(
        0,
        this.activeRetainedSaveOperationCount - 1,
      );
      if (this.activeRetainedSaveOperationCount === 0 && this.actorActive) {
        this.actor.send({ type: "SET_RETAINED_SAVE_OPERATION", active: false });
      }
    };
  };

  public readonly setSaveWorkAwaitingSource = (
    operationId: string,
    remainingRows: number,
  ): void => {
    const operation = this.saveWorkByOperation.get(operationId);
    if (operation === undefined) return;
    this.saveWorkByOperation.set(
      operationId,
      Object.freeze({
        kind: operation.kind,
        phase: "awaiting-source",
        remainingRows: Math.max(0, remainingRows),
      }),
    );
    this.publishSaveWork();
  };

  public readonly registerGridFocusCommand = (command: () => void): (() => void) => {
    this.gridFocusCommand = command;
    return () => {
      if (this.gridFocusCommand === command) this.gridFocusCommand = undefined;
    };
  };

  public readonly getResetReviewSnapshot = (): BrunoTableResetReviewSnapshot =>
    this.resetReviewStore.get();

  public readonly subscribeResetReview = (listener: Listener): (() => void) => {
    const subscription = this.resetReviewStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getResetReviewRowsSnapshot =
    (): readonly BrunoTableCellEditDraftReviewSourceRow[] => this.resetReviewRowsStore.get();

  public readonly subscribeResetReviewRows = (listener: Listener): (() => void) => {
    const subscription = this.resetReviewRowsStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly openResetReview = (): boolean => {
    this.actor.send({ type: "OPEN_RESET_REVIEW" });
    if (!this.actor.getSnapshot().context.resetReviewOpen) return false;
    this.subscribeToDraftReview();
    return true;
  };

  public readonly closeResetReview = (): void => {
    const previous = this.resetReviewStore.get();
    if (!previous.open) return;
    this.actor.send({ type: "CLOSE_RESET_REVIEW" });
    this.unsubscribeDraftReview?.();
    this.unsubscribeDraftReview = undefined;
    this.resetReviewRowsStore.setState(() => Object.freeze([]));
    if (!this.canResetStore.get()) this.scheduleGridFocus();
  };

  public readonly confirmResetAllChanges = (): boolean => {
    if (!this.resetReviewStore.get().open || this.cellEdit === undefined) return false;
    this.actor.send({ type: "CONFIRM_RESET" });
    if (this.actor.getSnapshot().context.resetReviewOpen) return false;
    this.cellEdit.resetAllDrafts();
    this.unsubscribeDraftReview?.();
    this.unsubscribeDraftReview = undefined;
    this.resetReviewStore.setState(() => CLOSED_RESET_REVIEW);
    this.scheduleGridFocus();
    return true;
  };

  public readonly undo = (): boolean =>
    !this.actor.getSnapshot().context.saveWorkActive &&
    this.modeStore.get().mode === "batch" &&
    this.cellEdit?.undoBatchDraft() === true;

  public readonly redo = (): boolean =>
    !this.actor.getSnapshot().context.saveWorkActive &&
    this.modeStore.get().mode === "batch" &&
    this.cellEdit?.redoBatchDraft() === true;

  private readonly publishWorkflow = (): void => {
    batch(() => {
      const context = this.actor.getSnapshot().context;
      if (context.saveFailureDismissalVersion !== this.publishedSaveFailureDismissalVersion) {
        this.publishedSaveFailureDismissalVersion = context.saveFailureDismissalVersion;
        this.saveFailures.clear();
        this.saveFailureStore.setState(() => NO_SAVE_FAILURES);
      }
      const mode = context.mode;
      const previous = this.modeStore.get();
      const canChange = canChangeMode(context);
      if (previous.mode !== mode || previous.canChange !== canChange) {
        this.modeStore.setState(() => Object.freeze({ mode, canChange }));
        if (previous.mode !== mode) this.cellEdit?.setBatchHistoryEnabled(mode === "batch");
      }
      const canResetAll = canReset(context);
      const previousReview = this.resetReviewStore.get();
      const nextReview = Object.freeze({
        open: context.resetReviewOpen,
        pendingCount: context.activity.reviewCount,
        historyCount: context.activity.undoCount + context.activity.redoCount,
        canResetAll,
      });
      if (
        previousReview.open !== nextReview.open ||
        previousReview.pendingCount !== nextReview.pendingCount ||
        previousReview.historyCount !== nextReview.historyCount ||
        previousReview.canResetAll !== nextReview.canResetAll
      ) {
        this.resetReviewStore.setState(() => nextReview);
      }
      if (previousReview.open && !nextReview.open) {
        this.unsubscribeDraftReview?.();
        this.unsubscribeDraftReview = undefined;
        this.resetReviewRowsStore.setState(() => Object.freeze([]));
      }
      if (this.canResetStore.get() !== canResetAll) {
        this.canResetStore.setState(() => canResetAll);
      }
      this.publishCanSave(mode, context.activity.draftCount, context.activity.blockedCount);
      const hotkeys = Object.freeze({
        undo:
          mode === "batch" &&
          !context.saveWorkActive &&
          !context.activity.activeEditor &&
          context.activity.undoCount > 0,
        redo:
          mode === "batch" &&
          !context.saveWorkActive &&
          !context.activity.activeEditor &&
          context.activity.redoCount > 0,
      });
      const previousHotkeys = this.hotkeyAvailabilityStore.get();
      if (previousHotkeys.undo !== hotkeys.undo || previousHotkeys.redo !== hotkeys.redo) {
        this.hotkeyAvailabilityStore.setState(() => hotkeys);
      }
    });
  };

  private readonly reconcileCellEditActivity = (
    activity: BrunoTableCellEditActivitySnapshot,
  ): void => {
    batch(() => {
      this.cellEditActivity = activity;
      if (this.actorActive) this.actor.send({ type: "SYNC_ACTIVITY", activity });
      const previousStatus = this.safetyStatusStore.get();
      if (
        previousStatus.pendingCount !== activity.reviewCount ||
        previousStatus.blockedCount !== activity.blockedCount ||
        previousStatus.validationCount !== activity.validationCount ||
        previousStatus.conflictCount !== activity.conflictCount
      ) {
        this.safetyStatusStore.setState(() =>
          Object.freeze({
            pendingCount: activity.reviewCount,
            blockedCount: activity.blockedCount,
            validationCount: activity.validationCount,
            conflictCount: activity.conflictCount,
          }),
        );
      }
    });
  };

  private readonly publishCanSave = (
    mode: BrunoTableEditMode,
    draftCount: number,
    blockedCount = this.cellEditActivity.blockedCount,
  ): void => {
    const canSave =
      (this.cellEditActivity.conflictCount > 0
        ? this.conflictReviewCommand !== undefined
        : this.saveCommand !== undefined) &&
      !this.actor.getSnapshot().context.saveWorkActive &&
      this.saveOperationCapacityAvailable &&
      this.savePreflightAvailable &&
      mode === "batch" &&
      draftCount > 0 &&
      !this.cellEditActivity.activeEditor &&
      !this.cellEditActivity.activeCandidatePending &&
      blockedCount === 0 &&
      this.cellEditActivity.validationCount === 0;
    if (this.canSaveStore.get() !== canSave) this.canSaveStore.setState(() => canSave);
  };

  private readonly subscribeToDraftReview = (): void => {
    if (this.unsubscribeDraftReview !== undefined || this.cellEdit === undefined) return;
    const runtime = this.cellEdit;
    const reconcile = (): void =>
      this.resetReviewRowsStore.setState(() => runtime.getDraftReviewSourceSnapshot());
    this.unsubscribeDraftReview = runtime.subscribeDraftReview(reconcile);
    reconcile();
  };

  private readonly scheduleGridFocus = (): void => {
    if (this.resetFocusFrame !== undefined) cancelAnimationFrame(this.resetFocusFrame);
    this.resetFocusFrame = requestAnimationFrame(() => {
      this.resetFocusFrame = undefined;
      this.gridFocusCommand?.();
    });
  };

  private readonly publishSaveFailures = (): void => {
    if (this.saveFailures.size === 0) {
      this.saveFailureStore.setState(() => NO_SAVE_FAILURES);
      return;
    }
    this.saveFailureStore.setState(() =>
      Object.freeze({
        count: this.saveFailures.size,
        messages: Object.freeze([
          ...new Set([...this.saveFailures.values()].map((failure) => failure.message)),
        ]),
        operations: Object.freeze(
          [...this.saveFailures].map(([operationId, failure]) =>
            Object.freeze({ operationId, message: failure.message, rows: failure.rows }),
          ),
        ),
      }),
    );
  };

  private readonly publishSaveWork = (): void => {
    let pendingBatchCount = 0;
    let awaitingBatchCount = 0;
    let awaitingBatchRowCount = 0;
    let pendingImmediateCount = 0;
    let awaitingImmediateCount = 0;
    for (const operation of this.saveWorkByOperation.values()) {
      if (operation.kind === "batch") {
        if (operation.phase === "pending") pendingBatchCount += 1;
        else {
          awaitingBatchCount += 1;
          awaitingBatchRowCount += operation.remainingRows;
        }
      } else if (operation.phase === "pending") pendingImmediateCount += 1;
      else awaitingImmediateCount += 1;
    }
    const previous = this.saveWorkStore.get();
    if (
      previous.pendingBatchCount === pendingBatchCount &&
      previous.awaitingBatchCount === awaitingBatchCount &&
      previous.awaitingBatchRowCount === awaitingBatchRowCount &&
      previous.pendingImmediateCount === pendingImmediateCount &&
      previous.awaitingImmediateCount === awaitingImmediateCount
    ) {
      return;
    }
    this.saveWorkStore.setState(() =>
      Object.freeze({
        pendingBatchCount,
        awaitingBatchCount,
        awaitingBatchRowCount,
        pendingImmediateCount,
        awaitingImmediateCount,
      }),
    );
  };
}
