import { batch, Store } from "@tanstack/store";
import { assign, createActor, createMachine } from "xstate";

import type {
  BrunoTableCellEditChangeGesture,
  BrunoTableCellEditActivitySnapshot,
  BrunoTableCellEditConflictResolution,
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

export type BrunoTableSparseEditReviewSnapshot = Readonly<{
  readonly open: boolean;
  readonly count: number;
}>;

export type BrunoTableConflictReviewResolutionSnapshot = Readonly<{
  readonly id: string;
  readonly resolution: "mine" | "server";
  readonly reviewedServer: unknown;
  readonly reviewedServerVersion: unknown;
}>;

export type BrunoTableConflictReviewSnapshot = BrunoTableSparseEditReviewSnapshot &
  Readonly<{
    readonly resolutionCount: number;
    readonly saving: boolean;
  }>;

export type BrunoTableEditSafetyStatusSnapshot = Readonly<{
  readonly pendingCount: number;
  readonly blockedCount: number;
  readonly validationCount: number;
  readonly conflictCount: number;
}>;

export type BrunoTableEditSummarySnapshot = Readonly<{
  readonly pendingCount: number;
  readonly validationCount: number;
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
      readonly cells: readonly Readonly<{
        readonly columnId: string;
        readonly field: string;
      }>[];
    }>[];
  }>[];
}>;

export type BrunoTableSaveFailureSummarySnapshot = Readonly<{
  readonly count: number;
  readonly messages: readonly string[];
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
  readonly conflictReviewOpen: boolean;
  readonly blockedReviewOpen: boolean;
  readonly conflictReviewResolutions: ReadonlyMap<
    string,
    BrunoTableConflictReviewResolutionSnapshot
  >;
  readonly conflictReviewSaving: boolean;
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
  | Readonly<{ readonly type: "OPEN_CONFLICT_REVIEW" }>
  | Readonly<{ readonly type: "CLOSE_CONFLICT_REVIEW" }>
  | Readonly<{ readonly type: "OPEN_BLOCKED_REVIEW" }>
  | Readonly<{ readonly type: "CLOSE_BLOCKED_REVIEW" }>
  | Readonly<{
      readonly type: "RECORD_CONFLICT_RESOLUTIONS";
      readonly resolutions: readonly BrunoTableConflictReviewResolutionSnapshot[];
    }>
  | Readonly<{ readonly type: "INVALIDATE_CONFLICT_RESOLUTIONS"; readonly ids: readonly string[] }>
  | Readonly<{ readonly type: "SET_CONFLICT_REVIEW_SAVING"; readonly active: boolean }>
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
const CLOSED_SPARSE_EDIT_REVIEW: BrunoTableSparseEditReviewSnapshot = Object.freeze({
  open: false,
  count: 0,
});
const CLOSED_CONFLICT_REVIEW: BrunoTableConflictReviewSnapshot = Object.freeze({
  open: false,
  count: 0,
  resolutionCount: 0,
  saving: false,
});
const CLEAN_EDIT_SAFETY_STATUS: BrunoTableEditSafetyStatusSnapshot = Object.freeze({
  pendingCount: 0,
  blockedCount: 0,
  validationCount: 0,
  conflictCount: 0,
});
const CLEAN_EDIT_SUMMARY: BrunoTableEditSummarySnapshot = Object.freeze({
  pendingCount: 0,
  validationCount: 0,
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
const NO_SAVE_FAILURE_SUMMARY: BrunoTableSaveFailureSummarySnapshot = Object.freeze({
  count: 0,
  messages: Object.freeze([]),
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
    conflictReviewOpen: false,
    blockedReviewOpen: false,
    conflictReviewResolutions: new Map<string, BrunoTableConflictReviewResolutionSnapshot>(),
    conflictReviewSaving: false,
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
          actions: assign({
            resetReviewOpen: true,
            conflictReviewOpen: false,
            blockedReviewOpen: false,
          }),
        },
        CLOSE_RESET_REVIEW: {
          actions: assign({ resetReviewOpen: false }),
        },
        CONFIRM_RESET: {
          guard: ({ context }) => context.resetReviewOpen && canReset(context),
          actions: assign({ resetReviewOpen: false }),
        },
        OPEN_CONFLICT_REVIEW: {
          guard: ({ context }) => context.activity.conflictCount > 0,
          actions: assign({
            resetReviewOpen: false,
            conflictReviewOpen: true,
            blockedReviewOpen: false,
            conflictReviewResolutions: () => new Map(),
            conflictReviewSaving: false,
          }),
        },
        CLOSE_CONFLICT_REVIEW: {
          guard: ({ context }) => !context.conflictReviewSaving,
          actions: assign({
            conflictReviewOpen: false,
            conflictReviewResolutions: () => new Map(),
            conflictReviewSaving: false,
          }),
        },
        OPEN_BLOCKED_REVIEW: {
          guard: ({ context }) => context.activity.blockedCount > 0,
          actions: assign({
            resetReviewOpen: false,
            conflictReviewOpen: false,
            blockedReviewOpen: true,
          }),
        },
        CLOSE_BLOCKED_REVIEW: {
          actions: assign({ blockedReviewOpen: false }),
        },
        RECORD_CONFLICT_RESOLUTIONS: {
          guard: ({ context }) => context.conflictReviewOpen && !context.conflictReviewSaving,
          actions: assign({
            conflictReviewResolutions: ({ context, event }) => {
              const resolutions = new Map(context.conflictReviewResolutions);
              for (const resolution of event.resolutions)
                resolutions.set(resolution.id, resolution);
              return resolutions;
            },
          }),
        },
        INVALIDATE_CONFLICT_RESOLUTIONS: {
          actions: assign({
            conflictReviewResolutions: ({ context, event }) => {
              const resolutions = new Map(context.conflictReviewResolutions);
              for (const id of event.ids) resolutions.delete(id);
              return resolutions;
            },
          }),
        },
        SET_CONFLICT_REVIEW_SAVING: {
          guard: ({ context, event }) =>
            !event.active || (context.conflictReviewOpen && context.activity.conflictCount === 0),
          actions: assign({ conflictReviewSaving: ({ event }) => event.active }),
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
  private readonly conflictCountStore = new Store(0);
  private readonly blockedCountStore = new Store(0);
  private readonly editSummaryStore = new Store<BrunoTableEditSummarySnapshot>(CLEAN_EDIT_SUMMARY);
  private readonly canResetStore = new Store(false);
  private readonly canSaveStore = new Store(false);
  private readonly hotkeyAvailabilityStore = new Store<BrunoTableEditHotkeyAvailabilitySnapshot>(
    NO_EDIT_HOTKEYS,
  );
  private readonly saveFailureSummaryStore = new Store<BrunoTableSaveFailureSummarySnapshot>(
    NO_SAVE_FAILURE_SUMMARY,
  );
  private readonly saveFailureDetailVersionStore = new Store(0);
  private saveFailureSnapshot: BrunoTableSaveFailureSnapshot = NO_SAVE_FAILURES;
  private saveFailureSnapshotDirty = false;
  private readonly saveWorkStore = new Store<BrunoTableSaveWorkSnapshot>(NO_SAVE_WORK);
  private readonly saveFailures = new Map<
    string,
    Readonly<{
      readonly message: string;
      readonly rowsById: Map<
        string,
        Readonly<{
          readonly cellsByColumnId: Map<
            string,
            BrunoTableSaveFailureSnapshot["operations"][number]["rows"][number]["cells"][number]
          >;
        }>
      >;
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
  private readonly conflictReviewStore = new Store<BrunoTableConflictReviewSnapshot>(
    CLOSED_CONFLICT_REVIEW,
  );
  private readonly conflictReviewRowsStore = new Store<
    readonly BrunoTableCellEditDraftReviewSourceRow[]
  >(Object.freeze([]));
  private readonly conflictResolutionStores = new Map<
    string,
    Store<BrunoTableConflictReviewResolutionSnapshot | undefined>
  >();
  private readonly blockedReviewStore = new Store<BrunoTableSparseEditReviewSnapshot>(
    CLOSED_SPARSE_EDIT_REVIEW,
  );
  private readonly blockedReviewRowsStore = new Store<
    readonly BrunoTableCellEditDraftReviewSourceRow[]
  >(Object.freeze([]));
  private cellEdit: BrunoTableCellEditRuntime | undefined;
  private saveCommand: (() => void) | undefined;
  private immediateSaveCommand: ((changes: BrunoTableCellEditChangeGesture) => void) | undefined;
  private conflictReviewCommand: (() => void) | undefined;
  private gridFocusCommand: (() => void) | undefined;
  private gridOwnerDocument: (() => Document | undefined) | undefined;
  private resetFocusFrame: number | undefined;
  private reviewFocusFrame: number | undefined;
  private reviewFocusFrameWindow: Window | undefined;
  private reviewFocusReturn: HTMLElement | undefined;
  private reviewFocusFallbackSelector: string | undefined;
  private reviewFocusDocument: Document | undefined;
  private reviewFocusWindow: Window | undefined;
  private unsubscribeDraftReview: (() => void) | undefined;
  private readonly resetControls = new Set<Element>();
  private readonly unregisterResetControls = new Map<Element, () => void>();
  private cellEditActivity: BrunoTableCellEditActivitySnapshot = CLEAN_CELL_EDIT_ACTIVITY;
  private saveOperationCapacityAvailable = true;
  private savePreflightAvailable = true;
  private conflictReviewSaveRequested = false;
  private conflictReviewSaveOperationId: string | undefined;
  private readonly conflictReviewSourcesById = new Map<
    string,
    BrunoTableCellEditDraftReviewSourceRow
  >();
  private readonly conflictResolutionInProgressIds = new Set<string>();

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
    this.conflictReviewSaveRequested = false;
    this.conflictReviewSaveOperationId = undefined;
    this.saveCommand = undefined;
    this.immediateSaveCommand = undefined;
    this.conflictReviewCommand = undefined;
    this.gridFocusCommand = undefined;
    this.gridOwnerDocument = undefined;
    this.cellEdit = undefined;
    if (this.resetFocusFrame !== undefined) cancelAnimationFrame(this.resetFocusFrame);
    this.resetFocusFrame = undefined;
    if (this.reviewFocusFrame !== undefined) {
      this.reviewFocusFrameWindow?.cancelAnimationFrame(this.reviewFocusFrame);
    }
    this.reviewFocusFrame = undefined;
    this.reviewFocusFrameWindow = undefined;
    this.reviewFocusReturn = undefined;
    this.reviewFocusFallbackSelector = undefined;
    this.reviewFocusDocument = undefined;
    this.reviewFocusWindow = undefined;
    this.modeStore.setState(() => INITIAL_MODE_SNAPSHOT);
    this.reconcileCellEditActivity(CLEAN_CELL_EDIT_ACTIVITY);
    this.canResetStore.setState(() => false);
    this.canSaveStore.setState(() => false);
    this.hotkeyAvailabilityStore.setState(() => NO_EDIT_HOTKEYS);
    this.saveFailureSummaryStore.setState(() => NO_SAVE_FAILURE_SUMMARY);
    this.saveFailureDetailVersionStore.setState(() => 0);
    this.saveFailureSnapshot = NO_SAVE_FAILURES;
    this.saveFailureSnapshotDirty = false;
    this.saveWorkStore.setState(() => NO_SAVE_WORK);
    this.saveFailures.clear();
    this.saveWorkByOperation.clear();
    this.publishedSaveFailureDismissalVersion = 0;
    this.resetReviewStore.setState(() => CLOSED_RESET_REVIEW);
    this.conflictReviewStore.setState(() => CLOSED_CONFLICT_REVIEW);
    this.blockedReviewStore.setState(() => CLOSED_SPARSE_EDIT_REVIEW);
    this.unsubscribeDraftReview?.();
    this.unsubscribeDraftReview = undefined;
    for (const unregister of this.unregisterResetControls.values()) unregister();
    this.unregisterResetControls.clear();
    this.resetControls.clear();
    this.resetReviewRowsStore.setState(() => Object.freeze([]));
    this.conflictReviewRowsStore.setState(() => Object.freeze([]));
    this.conflictReviewSourcesById.clear();
    this.conflictResolutionInProgressIds.clear();
    this.clearConflictResolutionStores();
    this.blockedReviewRowsStore.setState(() => Object.freeze([]));
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
      this.conflictReviewRowsStore.setState(() => Object.freeze([]));
      this.blockedReviewRowsStore.setState(() => Object.freeze([]));
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

  public readonly getConflictCountSnapshot = (): number => this.conflictCountStore.get();

  public readonly subscribeConflictCount = (listener: Listener): (() => void) => {
    const subscription = this.conflictCountStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getBlockedCountSnapshot = (): number => this.blockedCountStore.get();

  public readonly subscribeBlockedCount = (listener: Listener): (() => void) => {
    const subscription = this.blockedCountStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getEditSummarySnapshot = (): BrunoTableEditSummarySnapshot =>
    this.editSummaryStore.get();

  public readonly subscribeEditSummary = (listener: Listener): (() => void) => {
    const subscription = this.editSummaryStore.subscribe(listener);
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

  public readonly getSaveFailureSummarySnapshot = (): BrunoTableSaveFailureSummarySnapshot =>
    this.saveFailureSummaryStore.get();

  public readonly getSaveFailureSnapshot = (): BrunoTableSaveFailureSnapshot => {
    if (this.saveFailureSnapshotDirty) this.materializeSaveFailureSnapshot();
    return this.saveFailureSnapshot;
  };

  public readonly getSaveWorkSnapshot = (): BrunoTableSaveWorkSnapshot => this.saveWorkStore.get();

  public readonly subscribeSaveWork = (listener: Listener): (() => void) => {
    const subscription = this.saveWorkStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly subscribeSaveFailure = (listener: Listener): (() => void) => {
    const subscription = this.saveFailureDetailVersionStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly subscribeSaveFailureSummary = (listener: Listener): (() => void) => {
    const subscription = this.saveFailureSummaryStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly recordSaveFailure = (
    operationId: string,
    reason: unknown,
    changeSet: BrunoTableCellEditSaveChangeSet,
  ): void => {
    let explanation = "The save could not be confirmed.";
    try {
      const isError =
        reason instanceof Error || Object.prototype.toString.call(reason) === "[object Error]";
      const message = isError ? Reflect.get(reason as object, "message") : undefined;
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
        rowsById: new Map(
          changeSet.map((row) => [
            row.rowId,
            Object.freeze({
              cellsByColumnId: new Map(
                row.changes.map((change) => [
                  change.columnId,
                  Object.freeze({
                    columnId: change.columnId,
                    field: change.field,
                  }),
                ]),
              ),
            }),
          ]),
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

  public readonly removeSaveFailureCells = (
    operationId: string,
    cells: readonly Readonly<{ readonly rowId: string; readonly columnId: string }>[],
  ): void => {
    const failure = this.saveFailures.get(operationId);
    if (failure === undefined || cells.length === 0) return;
    let changed = false;
    for (const cell of cells) {
      const row = failure.rowsById.get(cell.rowId);
      if (row === undefined || !row.cellsByColumnId.delete(cell.columnId)) continue;
      changed = true;
      if (row.cellsByColumnId.size === 0) failure.rowsById.delete(cell.rowId);
    }
    if (!changed) return;
    if (failure.rowsById.size === 0) {
      this.clearSaveFailure(operationId);
      return;
    }
    this.publishSaveFailureDetails();
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
    if (kind === "batch" && operationId !== undefined && this.conflictReviewSaveRequested) {
      this.conflictReviewSaveRequested = false;
      this.conflictReviewSaveOperationId = operationId;
    }
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

  public readonly rejectSaveWorkAdmission = (operationId: string): void => {
    if (this.conflictReviewSaveOperationId !== operationId) return;
    this.conflictReviewSaveOperationId = undefined;
    this.conflictReviewSaveRequested = true;
    this.actor.send({ type: "SET_CONFLICT_REVIEW_SAVING", active: false });
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

  public readonly registerGridFocusCommand = (
    command: () => void,
    getOwnerDocument?: () => Document | undefined,
  ): (() => void) => {
    this.gridFocusCommand = command;
    this.gridOwnerDocument = getOwnerDocument;
    return () => {
      if (this.gridFocusCommand === command) {
        this.gridFocusCommand = undefined;
        this.gridOwnerDocument = undefined;
      }
    };
  };

  public readonly requestGridFocus = (): void => {
    this.scheduleGridFocus();
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

  public readonly getConflictReviewSnapshot = (): BrunoTableConflictReviewSnapshot =>
    this.conflictReviewStore.get();

  public readonly subscribeConflictReview = (listener: Listener): (() => void) => {
    const subscription = this.conflictReviewStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getConflictReviewRowsSnapshot =
    (): readonly BrunoTableCellEditDraftReviewSourceRow[] => this.conflictReviewRowsStore.get();

  public readonly subscribeConflictReviewRows = (listener: Listener): (() => void) => {
    const subscription = this.conflictReviewRowsStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly openConflictReview = (focusReturn?: EventTarget | null): boolean => {
    this.captureReviewFocus(focusReturn);
    this.actor.send({ type: "OPEN_CONFLICT_REVIEW" });
    if (!this.actor.getSnapshot().context.conflictReviewOpen) {
      this.reviewFocusReturn = undefined;
      return false;
    }
    this.subscribeToDraftReview();
    this.publishSparseReviewRows();
    return true;
  };

  public readonly closeConflictReview = (): void => {
    if (this.conflictReviewStore.get().saving) return;
    if (!this.conflictReviewStore.get().open) return;
    this.actor.send({ type: "CLOSE_CONFLICT_REVIEW" });
    this.conflictReviewSourcesById.clear();
    this.conflictReviewRowsStore.setState(() => Object.freeze([]));
    this.clearConflictResolutionStores();
    this.releaseDraftReviewSubscriptionWhenClosed();
    this.scheduleReviewFocus();
  };

  public readonly getConflictResolutionSnapshot = (
    id: string,
  ): BrunoTableConflictReviewResolutionSnapshot | undefined =>
    this.getConflictResolutionStore(id).get();

  public readonly subscribeConflictResolution = (id: string, listener: Listener): (() => void) => {
    const subscription = this.getConflictResolutionStore(id).subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly resolveConflictRows = (
    ids: readonly [string, ...string[]],
    resolution: "mine" | "server",
  ): boolean => {
    if (!this.conflictReviewStore.get().open || this.cellEdit === undefined) return false;
    const records = ids.flatMap((id) => {
      const row = this.conflictReviewSourcesById.get(id);
      const conflict = row?.getSnapshot().conflict;
      return row === undefined || conflict === undefined
        ? []
        : [
            Object.freeze({
              id,
              resolution,
              reviewedServer: conflict.server,
              reviewedServerVersion: conflict.serverVersion,
            }),
          ];
    });
    if (records.length !== ids.length) return false;
    const [first, ...rest] = records;
    for (const id of ids) this.conflictResolutionInProgressIds.add(id);
    if (
      first === undefined ||
      !this.cellEdit.resolveDraftConflicts(
        Object.freeze([first, ...rest]) as readonly [
          BrunoTableCellEditConflictResolution,
          ...BrunoTableCellEditConflictResolution[],
        ],
      )
    ) {
      for (const id of ids) this.conflictResolutionInProgressIds.delete(id);
      this.publishSparseReviewRows();
      return false;
    }
    this.actor.send({ type: "RECORD_CONFLICT_RESOLUTIONS", resolutions: records });
    for (const id of ids) this.conflictResolutionInProgressIds.delete(id);
    this.publishSparseReviewRows();
    return true;
  };

  public readonly saveConflictReview = (): boolean => {
    const snapshot = this.conflictReviewStore.get();
    if (
      !snapshot.open ||
      snapshot.count > 0 ||
      snapshot.resolutionCount === 0 ||
      snapshot.saving ||
      this.saveCommand === undefined
    ) {
      return false;
    }
    if (this.cellEditActivity.draftCount === 0) {
      this.closeConflictReview();
      return true;
    }
    this.actor.send({ type: "SET_CONFLICT_REVIEW_SAVING", active: true });
    this.conflictReviewSaveRequested = true;
    this.saveCommand();
    if (this.conflictReviewSaveRequested) {
      this.conflictReviewSaveRequested = false;
      this.actor.send({ type: "SET_CONFLICT_REVIEW_SAVING", active: false });
      return false;
    }
    return true;
  };

  public readonly resolveConflictReviewSave = (operationId: string): void => {
    if (this.conflictReviewSaveOperationId !== operationId) return;
    this.conflictReviewSaveOperationId = undefined;
    this.actor.send({ type: "SET_CONFLICT_REVIEW_SAVING", active: false });
    this.closeConflictReview();
  };

  public readonly rejectConflictReviewSave = (operationId: string): void => {
    if (this.conflictReviewSaveOperationId === operationId) {
      this.conflictReviewSaveOperationId = undefined;
      this.actor.send({ type: "SET_CONFLICT_REVIEW_SAVING", active: false });
    }
  };

  public readonly getBlockedReviewSnapshot = (): BrunoTableSparseEditReviewSnapshot =>
    this.blockedReviewStore.get();

  public readonly subscribeBlockedReview = (listener: Listener): (() => void) => {
    const subscription = this.blockedReviewStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getBlockedReviewRowsSnapshot =
    (): readonly BrunoTableCellEditDraftReviewSourceRow[] => this.blockedReviewRowsStore.get();

  public readonly subscribeBlockedReviewRows = (listener: Listener): (() => void) => {
    const subscription = this.blockedReviewRowsStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly openBlockedReview = (focusReturn?: EventTarget | null): boolean => {
    this.captureReviewFocus(focusReturn);
    this.actor.send({ type: "OPEN_BLOCKED_REVIEW" });
    if (!this.actor.getSnapshot().context.blockedReviewOpen) {
      this.reviewFocusReturn = undefined;
      return false;
    }
    this.subscribeToDraftReview();
    this.publishSparseReviewRows();
    return true;
  };

  public readonly closeBlockedReview = (): void => {
    if (!this.blockedReviewStore.get().open) return;
    this.actor.send({ type: "CLOSE_BLOCKED_REVIEW" });
    this.releaseDraftReviewSubscriptionWhenClosed();
    this.scheduleReviewFocus();
  };

  public readonly discardBlockedChanges = (ids: readonly [string, ...string[]]): boolean => {
    if (!this.blockedReviewStore.get().open || this.cellEdit === undefined) return false;
    return this.cellEdit.discardBlockedDrafts(ids);
  };

  public readonly undo = (): boolean =>
    !this.actor.getSnapshot().context.saveWorkActive &&
    this.modeStore.get().mode === "batch" &&
    this.cellEdit?.undoBatchDraft() === true;

  public readonly redo = (): boolean =>
    !this.actor.getSnapshot().context.saveWorkActive &&
    this.modeStore.get().mode === "batch" &&
    this.cellEdit?.redoBatchDraft() === true;

  private readonly getConflictResolutionStore = (
    id: string,
  ): Store<BrunoTableConflictReviewResolutionSnapshot | undefined> => {
    const existing = this.conflictResolutionStores.get(id);
    if (existing !== undefined) return existing;
    const created = new Store(this.actor.getSnapshot().context.conflictReviewResolutions.get(id));
    this.conflictResolutionStores.set(id, created);
    return created;
  };

  private readonly clearConflictResolutionStores = (): void => {
    for (const store of this.conflictResolutionStores.values()) {
      if (store.get() !== undefined) store.setState(() => undefined);
    }
    this.conflictResolutionStores.clear();
  };

  private readonly publishWorkflow = (): void => {
    batch(() => {
      const context = this.actor.getSnapshot().context;
      if (context.saveFailureDismissalVersion !== this.publishedSaveFailureDismissalVersion) {
        this.publishedSaveFailureDismissalVersion = context.saveFailureDismissalVersion;
        this.saveFailures.clear();
        this.publishSaveFailures();
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
        this.resetReviewRowsStore.setState(() => Object.freeze([]));
      }
      const previousConflictReview = this.conflictReviewStore.get();
      const nextConflictReview = Object.freeze({
        open: context.conflictReviewOpen,
        count: context.activity.conflictCount,
        resolutionCount: context.conflictReviewResolutions.size,
        saving: context.conflictReviewSaving,
      });
      if (
        previousConflictReview.open !== nextConflictReview.open ||
        previousConflictReview.count !== nextConflictReview.count ||
        previousConflictReview.resolutionCount !== nextConflictReview.resolutionCount ||
        previousConflictReview.saving !== nextConflictReview.saving
      ) {
        this.conflictReviewStore.setState(() => nextConflictReview);
      }
      for (const [id, store] of this.conflictResolutionStores) {
        const resolution = context.conflictReviewResolutions.get(id);
        if (store.get() !== resolution) store.setState(() => resolution);
      }
      const previousBlockedReview = this.blockedReviewStore.get();
      const nextBlockedReview = Object.freeze({
        open: context.blockedReviewOpen,
        count: context.activity.blockedCount,
      });
      if (
        previousBlockedReview.open !== nextBlockedReview.open ||
        previousBlockedReview.count !== nextBlockedReview.count
      ) {
        this.blockedReviewStore.setState(() => nextBlockedReview);
      }
      if (!context.conflictReviewOpen) {
        this.conflictReviewRowsStore.setState(() => Object.freeze([]));
      }
      if (!context.blockedReviewOpen) {
        this.blockedReviewRowsStore.setState(() => Object.freeze([]));
      }
      this.releaseDraftReviewSubscriptionWhenClosed();
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
      if (this.conflictCountStore.get() !== activity.conflictCount) {
        this.conflictCountStore.setState(() => activity.conflictCount);
      }
      if (this.blockedCountStore.get() !== activity.blockedCount) {
        this.blockedCountStore.setState(() => activity.blockedCount);
      }
      const previousSummary = this.editSummaryStore.get();
      if (
        previousSummary.pendingCount !== activity.reviewCount ||
        previousSummary.validationCount !== activity.validationCount
      ) {
        this.editSummaryStore.setState(() =>
          Object.freeze({
            pendingCount: activity.reviewCount,
            validationCount: activity.validationCount,
          }),
        );
      }
      this.publishSparseReviewRows();
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
    const reconcile = (): void => {
      if (this.resetReviewStore.get().open) {
        this.resetReviewRowsStore.setState(() => runtime.getDraftReviewSourceSnapshot());
      }
      this.publishSparseReviewRows();
    };
    this.unsubscribeDraftReview = runtime.subscribeDraftReview(reconcile);
    reconcile();
  };

  private readonly publishSparseReviewRows = (): void => {
    if (this.cellEdit === undefined || this.unsubscribeDraftReview === undefined) return;
    const runtime = this.cellEdit;
    const rows = runtime.getDraftReviewSourceSnapshot();
    if (this.conflictReviewStore.get().open) {
      const activeConflictIds = new Set<string>();
      for (const row of rows) {
        if (row.getSnapshot().conflict === undefined) continue;
        activeConflictIds.add(row.id);
        this.conflictReviewSourcesById.set(row.id, row);
      }

      let context = this.actor.getSnapshot().context;
      const invalidResolutionIds = [...context.conflictReviewResolutions].flatMap(
        ([id, resolution]) => {
          const conflict = this.conflictReviewSourcesById.get(id)?.getSnapshot().conflict;
          return conflict !== undefined &&
            !runtime.isDraftConflictEvidenceCurrent(
              id,
              resolution.reviewedServer,
              resolution.reviewedServerVersion,
            )
            ? [id]
            : [];
        },
      );
      if (invalidResolutionIds.length > 0) {
        this.actor.send({
          type: "INVALIDATE_CONFLICT_RESOLUTIONS",
          ids: Object.freeze(invalidResolutionIds),
        });
        context = this.actor.getSnapshot().context;
      }

      for (const id of this.conflictReviewSourcesById.keys()) {
        if (
          !activeConflictIds.has(id) &&
          !context.conflictReviewResolutions.has(id) &&
          !this.conflictResolutionInProgressIds.has(id)
        ) {
          this.conflictReviewSourcesById.delete(id);
        }
      }
      this.conflictReviewRowsStore.setState(() =>
        Object.freeze([...this.conflictReviewSourcesById.values()]),
      );
    }
    if (this.blockedReviewStore.get().open) {
      this.blockedReviewRowsStore.setState(() =>
        Object.freeze(rows.filter((row) => row.getSnapshot().blockedReason !== undefined)),
      );
    }
  };

  private readonly releaseDraftReviewSubscriptionWhenClosed = (): void => {
    const context = this.actor.getSnapshot().context;
    if (context.resetReviewOpen || context.conflictReviewOpen || context.blockedReviewOpen) return;
    this.unsubscribeDraftReview?.();
    this.unsubscribeDraftReview = undefined;
  };

  private readonly scheduleGridFocus = (): void => {
    if (this.resetFocusFrame !== undefined) cancelAnimationFrame(this.resetFocusFrame);
    this.resetFocusFrame = requestAnimationFrame(() => {
      this.resetFocusFrame = undefined;
      this.gridFocusCommand?.();
    });
  };

  private readonly captureReviewFocus = (preferred?: EventTarget | null): void => {
    const preferredDocument = (preferred as Node | null | undefined)?.ownerDocument;
    const ownerDocument =
      preferredDocument ??
      this.gridOwnerDocument?.() ??
      (typeof document === "undefined" ? undefined : document);
    const ownerWindow = ownerDocument?.defaultView ?? undefined;
    const HTMLElementConstructor = ownerWindow?.HTMLElement;
    const candidate = preferred ?? ownerDocument?.activeElement;
    this.reviewFocusReturn =
      HTMLElementConstructor !== undefined && candidate instanceof HTMLElementConstructor
        ? (candidate as HTMLElement)
        : undefined;
    const focusKey = this.reviewFocusReturn?.dataset["brunoTableReviewFocus"];
    this.reviewFocusFallbackSelector =
      focusKey === "conflict" || focusKey === "blocked"
        ? `[data-bruno-table-review-focus="${focusKey}"]`
        : undefined;
    this.reviewFocusDocument = ownerDocument;
    this.reviewFocusWindow = ownerWindow;
  };

  private readonly scheduleReviewFocus = (): void => {
    if (this.reviewFocusFrame !== undefined) {
      this.reviewFocusFrameWindow?.cancelAnimationFrame(this.reviewFocusFrame);
    }
    const target = this.reviewFocusReturn;
    const fallbackSelector = this.reviewFocusFallbackSelector;
    const ownerDocument = this.reviewFocusDocument;
    const ownerWindow = this.reviewFocusWindow;
    this.reviewFocusReturn = undefined;
    this.reviewFocusFallbackSelector = undefined;
    this.reviewFocusDocument = undefined;
    this.reviewFocusWindow = undefined;
    if (ownerWindow === undefined) {
      this.gridFocusCommand?.();
      return;
    }
    this.reviewFocusFrameWindow = ownerWindow;
    this.reviewFocusFrame = ownerWindow.requestAnimationFrame(() => {
      this.reviewFocusFrame = ownerWindow.requestAnimationFrame(() => {
        this.reviewFocusFrame = undefined;
        this.reviewFocusFrameWindow = undefined;
        if (target?.isConnected) target.focus();
        else {
          const fallback =
            fallbackSelector === undefined
              ? undefined
              : ownerDocument?.querySelector<HTMLElement>(fallbackSelector);
          if (fallback?.isConnected) fallback.focus();
          else this.gridFocusCommand?.();
        }
      });
    });
  };

  private readonly publishSaveFailures = (): void => {
    if (this.saveFailures.size === 0) {
      this.saveFailureSummaryStore.setState(() => NO_SAVE_FAILURE_SUMMARY);
      this.saveFailureSnapshot = NO_SAVE_FAILURES;
      this.saveFailureSnapshotDirty = false;
      this.saveFailureDetailVersionStore.setState((version) => version + 1);
      return;
    }
    this.saveFailureSummaryStore.setState(() =>
      Object.freeze({
        count: this.saveFailures.size,
        messages: Object.freeze([
          ...new Set([...this.saveFailures.values()].map((failure) => failure.message)),
        ]),
      }),
    );
    this.publishSaveFailureDetails();
  };

  private readonly publishSaveFailureDetails = (): void => {
    this.saveFailureSnapshotDirty = true;
    this.saveFailureDetailVersionStore.setState((version) => version + 1);
  };

  private readonly materializeSaveFailureSnapshot = (): void => {
    this.saveFailureSnapshot = Object.freeze({
      count: this.saveFailures.size,
      messages: this.saveFailureSummaryStore.get().messages,
      operations: Object.freeze(
        [...this.saveFailures].map(([operationId, failure]) =>
          Object.freeze({
            operationId,
            message: failure.message,
            rows: Object.freeze(
              [...failure.rowsById].map(([rowId, row]) =>
                Object.freeze({
                  rowId,
                  cells: Object.freeze([...row.cellsByColumnId.values()]),
                }),
              ),
            ),
          }),
        ),
      ),
    });
    this.saveFailureSnapshotDirty = false;
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
