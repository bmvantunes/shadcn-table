import { batch, Store } from "@tanstack/store";
import { assign, createActor, createMachine } from "xstate";

import type {
  BrunoTableCellEditActivitySnapshot,
  BrunoTableCellEditDraftReviewSourceRow,
  BrunoTableCellEditRuntime,
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
  readonly canResetAll: boolean;
}>;

export type BrunoTableEditSafetyStatusSnapshot = Readonly<{
  readonly pendingCount: number;
  readonly blockedCount: number;
  readonly validationCount: number;
  readonly conflictCount: number;
}>;

type EditWorkflowContext = Readonly<{
  readonly mode: BrunoTableEditMode;
  readonly activity: BrunoTableCellEditActivitySnapshot;
  readonly saveWorkActive: boolean;
  readonly resetReviewOpen: boolean;
}>;

type EditWorkflowEvent =
  | Readonly<{ readonly type: "SET_MODE"; readonly mode: BrunoTableEditMode }>
  | Readonly<{
      readonly type: "SYNC_ACTIVITY";
      readonly activity: BrunoTableCellEditActivitySnapshot;
    }>
  | Readonly<{ readonly type: "SET_SAVE_WORK"; readonly active: boolean }>
  | Readonly<{ readonly type: "OPEN_RESET_REVIEW" }>
  | Readonly<{ readonly type: "CLOSE_RESET_REVIEW" }>
  | Readonly<{ readonly type: "CONFIRM_RESET" }>;

const INITIAL_MODE_SNAPSHOT: BrunoTableEditModeSnapshot = Object.freeze({
  mode: "immediate",
  canChange: true,
});
const CLOSED_RESET_REVIEW: BrunoTableResetReviewSnapshot = Object.freeze({
  open: false,
  pendingCount: 0,
  canResetAll: false,
});
const CLEAN_EDIT_SAFETY_STATUS: BrunoTableEditSafetyStatusSnapshot = Object.freeze({
  pendingCount: 0,
  blockedCount: 0,
  validationCount: 0,
  conflictCount: 0,
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
  return !context.saveWorkActive && !activity.activeEditor && !hasEditOwnedWork(activity);
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
    resetReviewOpen: false,
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
      },
    },
  },
});

export class BrunoTableEditMemoryRuntime {
  private actor = createActor(brunoTableEditWorkflowMachine);
  private actorActive = false;
  private readonly modeStore = new Store<BrunoTableEditModeSnapshot>(INITIAL_MODE_SNAPSHOT);
  private readonly safetyStatusStore = new Store<BrunoTableEditSafetyStatusSnapshot>(
    CLEAN_EDIT_SAFETY_STATUS,
  );
  private readonly canResetStore = new Store(false);
  private readonly canSaveStore = new Store(false);
  private readonly resetReviewStore = new Store<BrunoTableResetReviewSnapshot>(CLOSED_RESET_REVIEW);
  private readonly resetReviewRowsStore = new Store<
    readonly BrunoTableCellEditDraftReviewSourceRow[]
  >(Object.freeze([]));
  private cellEdit: BrunoTableCellEditRuntime | undefined;
  private saveCommand: (() => void) | undefined;
  private conflictReviewCommand: (() => void) | undefined;
  private gridFocusCommand: (() => void) | undefined;
  private resetFocusFrame: number | undefined;
  private unsubscribeDraftReview: (() => void) | undefined;
  private readonly resetControls = new Set<Element>();
  private readonly unregisterResetControls = new Map<Element, () => void>();
  private cellEditActivity: BrunoTableCellEditActivitySnapshot = CLEAN_CELL_EDIT_ACTIVITY;

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
    this.saveCommand = undefined;
    this.conflictReviewCommand = undefined;
    this.gridFocusCommand = undefined;
    if (this.resetFocusFrame !== undefined) cancelAnimationFrame(this.resetFocusFrame);
    this.resetFocusFrame = undefined;
    this.modeStore.setState(() => INITIAL_MODE_SNAPSHOT);
    this.reconcileCellEditActivity({
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
    const reconcile = (): void => this.reconcileCellEditActivity(runtime.getActivitySnapshot());
    reconcile();
    const unsubscribe = runtime.subscribeActivity(reconcile);
    return () => {
      unsubscribe();
      for (const unregister of this.unregisterResetControls.values()) unregister();
      this.unregisterResetControls.clear();
      this.unsubscribeDraftReview?.();
      this.unsubscribeDraftReview = undefined;
      if (this.cellEdit === runtime) this.cellEdit = undefined;
      this.reconcileCellEditActivity({
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
      this.resetReviewRowsStore.setState(() => Object.freeze([]));
    };
  };

  public readonly registerResetControl = (element: HTMLButtonElement): (() => void) => {
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

  public readonly setSaveWorkActive = (active: boolean): void => {
    this.actor.send({ type: "SET_SAVE_WORK", active });
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
  };

  public readonly confirmResetAllChanges = (): boolean => {
    if (!this.resetReviewStore.get().open || this.cellEdit === undefined) return false;
    this.actor.send({ type: "CONFIRM_RESET" });
    if (this.actor.getSnapshot().context.resetReviewOpen) return false;
    this.cellEdit.resetAllDrafts();
    this.unsubscribeDraftReview?.();
    this.unsubscribeDraftReview = undefined;
    this.resetReviewStore.setState(() => CLOSED_RESET_REVIEW);
    if (this.resetFocusFrame !== undefined) cancelAnimationFrame(this.resetFocusFrame);
    this.resetFocusFrame = requestAnimationFrame(() => {
      this.resetFocusFrame = undefined;
      this.gridFocusCommand?.();
    });
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
        canResetAll,
      });
      if (
        previousReview.open !== nextReview.open ||
        previousReview.pendingCount !== nextReview.pendingCount ||
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
        previousStatus.pendingCount !== activity.draftCount ||
        previousStatus.blockedCount !== activity.blockedCount ||
        previousStatus.validationCount !== activity.validationCount ||
        previousStatus.conflictCount !== activity.conflictCount
      ) {
        this.safetyStatusStore.setState(() =>
          Object.freeze({
            pendingCount: activity.draftCount,
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
      mode === "batch" &&
      draftCount > 0 &&
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
}
