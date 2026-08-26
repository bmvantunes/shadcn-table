import { batch, Store } from "@tanstack/store";
import { assign, createActor, createMachine } from "xstate";

import type { CompiledColumn, CompiledFieldColumn } from "./compile-columns";
import {
  BrunoTableCellEditTraversalIndex,
  type BrunoTableCellEditTraversalDestination,
  type BrunoTableCellEditTraversalRange,
  type BrunoTableCellEditTraversalRowSpace,
} from "./cell-edit-traversal";

type Listener = () => void;

export type BrunoTableCellEditChange = Readonly<{
  readonly rowId: string;
  readonly columnId: string;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}>;

type ActiveSession = Readonly<{
  readonly rowId: string;
  readonly column: CompiledFieldColumn;
  readonly row: object;
  readonly before: unknown;
  readonly beforeFromDraft: boolean;
  readonly initialText: string;
  readonly selectInitialText: boolean;
  readonly rowMissing: boolean;
  readonly invalidMessage?: string;
  readonly permissionMessage?: string;
}>;

type DraftEntry = Readonly<{
  readonly value: unknown;
  readonly projection: BrunoTableCellEditProjection;
}>;

type DraftPatch =
  | Readonly<{ readonly kind: "remove"; readonly cellKey: string }>
  | Readonly<{ readonly kind: "set"; readonly cellKey: string; readonly value: unknown }>;

type CommitEvaluation =
  | Readonly<{
      readonly kind: "invalid";
      readonly message: string;
      readonly reason?: "permission" | "rowMissing";
    }>
  | Readonly<{
      readonly kind: "accepted";
      readonly cellKey: string;
      readonly value: unknown;
      readonly removeDraft: boolean;
      readonly change?: BrunoTableCellEditChange;
    }>;

type CellEditContext = Readonly<{
  readonly session: ActiveSession | undefined;
  readonly draftPatch: DraftPatch | undefined;
  readonly affectedCellKeys: readonly string[];
  readonly evaluation: CommitEvaluation | undefined;
  readonly acceptedChange: BrunoTableCellEditChange | undefined;
}>;
type CellEditEvent =
  | Readonly<{
      readonly type: "START";
      readonly rowId: string;
      readonly column: CompiledColumn | undefined;
      readonly row: unknown;
      readonly hasDraft: boolean;
      readonly draftValue: unknown;
      readonly mode: "current" | "replace";
      readonly producedText: string;
    }>
  | Readonly<{
      readonly type: "COMMIT";
      readonly rawText: string;
      readonly nativeInvalid: boolean;
      readonly intent: "scalar" | "blank";
    }>
  | Readonly<{ readonly type: "CANCEL" }>
  | Readonly<{ readonly type: "RECONCILE_ROW"; readonly row: unknown }>
  | Readonly<{ readonly type: "RECONCILE_COLUMN"; readonly column: CompiledFieldColumn }>;

const brunoTableCellEditMachine = createMachine({
  id: "brunoTableCellEditSession",
  initial: "idle",
  types: {} as { context: CellEditContext; events: CellEditEvent },
  context: {
    session: undefined,
    draftPatch: undefined,
    affectedCellKeys: [],
    evaluation: undefined,
    acceptedChange: undefined,
  },
  states: {
    idle: {
      on: {
        START: {
          target: "admitting",
          actions: assign({
            session: ({ event }) => prepareSession(event),
            draftPatch: undefined,
            affectedCellKeys: [],
            evaluation: undefined,
            acceptedChange: undefined,
          }),
        },
      },
    },
    admitting: {
      always: [
        { guard: ({ context }) => context.session !== undefined, target: "editing" },
        { target: "idle" },
      ],
    },
    editing: {
      on: {
        RECONCILE_COLUMN: {
          actions: assign({
            session: ({ context, event }) =>
              context.session === undefined
                ? undefined
                : reconcileSessionPermission(
                    Object.freeze({ ...context.session, column: event.column }),
                  ),
          }),
        },
        RECONCILE_ROW: {
          actions: assign({
            session: ({ context, event }) => {
              const session = context.session;
              if (session === undefined) return undefined;
              return typeof event.row === "object" && event.row !== null
                ? reconcileSessionPermission(
                    Object.freeze({ ...session, row: event.row, rowMissing: false }),
                  )
                : Object.freeze({ ...session, rowMissing: true });
            },
          }),
        },
        COMMIT: {
          target: "validating",
          actions: assign({
            evaluation: ({ context, event }) =>
              evaluateCandidate(context.session, event.rawText, event.nativeInvalid, event.intent),
            draftPatch: undefined,
            affectedCellKeys: [],
            acceptedChange: undefined,
          }),
        },
        CANCEL: {
          target: "idle",
          actions: assign({
            session: undefined,
            draftPatch: undefined,
            affectedCellKeys: [],
            evaluation: undefined,
            acceptedChange: undefined,
          }),
        },
      },
    },
    validating: {
      always: [
        {
          guard: ({ context }) => context.evaluation?.kind === "accepted",
          target: "idle",
          actions: assign({
            session: undefined,
            draftPatch: ({ context }) => createAcceptedDraftPatch(context),
            affectedCellKeys: ({ context }) =>
              Object.freeze([getAcceptedEvaluation(context).cellKey]),
            acceptedChange: ({ context }) => getAcceptedEvaluation(context).change,
            evaluation: undefined,
          }),
        },
        {
          target: "editing",
          actions: assign({
            session: ({ context }) => {
              const session = context.session;
              const evaluation = context.evaluation;
              return session === undefined || evaluation?.kind !== "invalid"
                ? session
                : evaluation.reason === "permission"
                  ? Object.freeze({ ...session, permissionMessage: evaluation.message })
                  : evaluation.reason === "rowMissing"
                    ? session
                    : Object.freeze({ ...session, invalidMessage: evaluation.message });
            },
            affectedCellKeys: [],
            draftPatch: undefined,
            acceptedChange: undefined,
            evaluation: undefined,
          }),
        },
      ],
    },
  },
});

function prepareSession(
  event: Extract<CellEditEvent, { readonly type: "START" }>,
): ActiveSession | undefined {
  const { column, row } = event;
  if (
    event.mode === "replace" &&
    event.producedText.length > BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH
  ) {
    return undefined;
  }
  if (
    column?.kind !== "field" ||
    column.isEditable === undefined ||
    column.isEditable === false ||
    typeof row !== "object" ||
    row === null
  ) {
    return undefined;
  }
  const sourceValue = Reflect.get(row, column.field);
  const before = event.hasDraft ? event.draftValue : sourceValue;
  if (typeof column.isEditable === "function") {
    try {
      if (Reflect.apply(column.isEditable, undefined, [{ row, value: before }]) !== true) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  try {
    return Object.freeze({
      rowId: event.rowId,
      column,
      row,
      before,
      beforeFromDraft: event.hasDraft,
      initialText:
        event.mode === "replace"
          ? event.producedText
          : before === null || before === undefined
            ? ""
            : column.semantics.formatCanonicalText(before),
      selectInitialText: event.mode === "current",
      rowMissing: false,
    });
  } catch {
    return undefined;
  }
}

export const BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH = 65_536;
const BRUNO_TABLE_CELL_EDIT_PERMISSION_MESSAGE = "This cell is no longer editable.";
const BRUNO_TABLE_CELL_EDIT_ROW_MISSING_MESSAGE =
  "This row was removed from the server. Changes cannot be saved.";

function reconcileSessionPermission(session: ActiveSession): ActiveSession {
  const permissionMessage = isSessionEditable(session)
    ? undefined
    : BRUNO_TABLE_CELL_EDIT_PERMISSION_MESSAGE;
  if (session.permissionMessage === permissionMessage) return session;
  const { permissionMessage: _previousPermissionMessage, ...retained } = session;
  return Object.freeze({
    ...retained,
    ...(permissionMessage === undefined ? {} : { permissionMessage }),
  });
}

function isSessionEditable(session: ActiveSession): boolean {
  const policy = session.column.isEditable;
  if (policy === true) return true;
  if (typeof policy !== "function") return false;
  try {
    const value = session.beforeFromDraft
      ? session.before
      : Reflect.get(session.row, session.column.field);
    return Reflect.apply(policy, undefined, [{ row: session.row, value }]) === true;
  } catch {
    return false;
  }
}

function evaluateCandidate(
  session: ActiveSession | undefined,
  rawText: string,
  nativeInvalid = false,
  intent: "scalar" | "blank" = "scalar",
): CommitEvaluation {
  if (session === undefined) {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
  }
  if (session.rowMissing) {
    return Object.freeze({
      kind: "invalid",
      message: BRUNO_TABLE_CELL_EDIT_ROW_MISSING_MESSAGE,
      reason: "rowMissing",
    });
  }
  if (!isSessionEditable(session)) {
    return Object.freeze({
      kind: "invalid",
      message: BRUNO_TABLE_CELL_EDIT_PERMISSION_MESSAGE,
      reason: "permission",
    });
  }
  if (rawText.length > BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH) {
    return Object.freeze({
      kind: "invalid",
      message: `Enter at most ${String(BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH)} characters.`,
    });
  }
  if (nativeInvalid) {
    return Object.freeze({ kind: "invalid", message: "Enter a valid number." });
  }
  const blankIntent =
    intent === "blank" ||
    (rawText.length === 0 &&
      session.column.blankValue !== undefined &&
      session.column.semantics.editorFamily !== "select");
  if (intent === "blank" && session.column.blankValue === undefined) {
    return Object.freeze({ kind: "invalid", message: "Enter a value." });
  }
  if (
    rawText.length === 0 &&
    !blankIntent &&
    session.column.blankValue === undefined &&
    session.column.semantics.editorFamily !== "select" &&
    (session.column.semantics.editorFamily !== "text" ||
      session.column.semantics.filterFamily === "numeric")
  ) {
    return Object.freeze({ kind: "invalid", message: "Enter a value." });
  }
  let parsed: unknown;
  try {
    parsed =
      blankIntent && session.column.blankValue !== undefined
        ? { _tag: "Success", value: session.column.blankValue.value }
        : session.column.semantics.parseCanonicalText(rawText);
  } catch {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
  }
  if (typeof parsed !== "object" || parsed === null || !("_tag" in parsed)) {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
  }
  if (parsed._tag === "Failure") {
    return Object.freeze({
      kind: "invalid",
      message:
        "message" in parsed && typeof parsed.message === "string"
          ? boundedMessage(parsed.message)
          : "The value is invalid.",
    });
  }
  if (parsed._tag !== "Success" || !("value" in parsed)) {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
  }
  let after = parsed.value;
  if (!blankIntent) {
    let decoded: unknown;
    try {
      decoded = session.column.semantics.decodeRuntime(after);
    } catch {
      return Object.freeze({ kind: "invalid", message: "The value is invalid." });
    }
    if (typeof decoded !== "object" || decoded === null || !("_tag" in decoded)) {
      return Object.freeze({ kind: "invalid", message: "The value is invalid." });
    }
    if (decoded._tag === "Failure") {
      return Object.freeze({
        kind: "invalid",
        message:
          "message" in decoded && typeof decoded.message === "string"
            ? boundedMessage(decoded.message)
            : "The value is invalid.",
      });
    }
    if (decoded._tag !== "Success" || !("value" in decoded)) {
      return Object.freeze({ kind: "invalid", message: "The value is invalid." });
    }
    after = decoded.value;
  }
  if (session.column.validate !== undefined) {
    let result: unknown;
    try {
      result = Reflect.apply(session.column.validate, undefined, [
        { row: session.row, value: after },
      ]);
    } catch {
      result = "The value could not be validated.";
    }
    if (result !== undefined) {
      return Object.freeze({
        kind: "invalid",
        message:
          typeof result === "string" && result.trim().length > 0
            ? boundedMessage(result)
            : "The value is invalid.",
      });
    }
  }
  const sourceValue = Reflect.get(session.row, session.column.field);
  const equivalentBefore = safeEquivalentEditValue(session.column, session.before, after);
  const equivalentSource = safeEquivalentEditValue(session.column, after, sourceValue);
  if (equivalentBefore === undefined || equivalentSource === undefined) {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
  }
  const changed = !equivalentBefore;
  return Object.freeze({
    kind: "accepted",
    cellKey: cellKey(session.rowId, session.column.columnId),
    value: after,
    removeDraft: equivalentSource,
    ...(changed
      ? {
          change: Object.freeze({
            rowId: session.rowId,
            columnId: session.column.columnId,
            field: session.column.field,
            before: session.before,
            after,
          }),
        }
      : {}),
  });
}

function safeEquivalentEditValue(
  column: CompiledFieldColumn,
  left: unknown,
  right: unknown,
): boolean | undefined {
  try {
    if (left === null || left === undefined || right === null || right === undefined) {
      return Object.is(left, right);
    }
    const result: unknown = column.semantics.equivalent(left, right);
    return typeof result === "boolean" ? result : undefined;
  } catch {
    return undefined;
  }
}

function getAcceptedEvaluation(
  context: CellEditContext,
): Extract<CommitEvaluation, { readonly kind: "accepted" }> {
  const evaluation = context.evaluation;
  if (evaluation?.kind !== "accepted") {
    throw new TypeError("BrunoTable Cell Edit accepted without evaluated candidate evidence.");
  }
  return evaluation;
}

function createAcceptedDraftPatch(context: CellEditContext): DraftPatch {
  const evaluation = getAcceptedEvaluation(context);
  return evaluation.removeDraft
    ? Object.freeze({ kind: "remove", cellKey: evaluation.cellKey })
    : Object.freeze({ kind: "set", cellKey: evaluation.cellKey, value: evaluation.value });
}

function applyDraftPatch(
  drafts: ReadonlyMap<string, DraftEntry>,
  patch: DraftPatch,
): ReadonlyMap<string, DraftEntry> {
  const previous = drafts.get(patch.cellKey);
  if (patch.kind === "remove" && previous === undefined) return drafts;
  if (patch.kind === "set" && previous !== undefined && Object.is(previous.value, patch.value))
    return drafts;
  const next = new Map(drafts);
  if (patch.kind === "remove") next.delete(patch.cellKey);
  else {
    next.set(
      patch.cellKey,
      Object.freeze({
        value: patch.value,
        projection: Object.freeze({ active: false, hasDraft: true, draft: patch.value }),
      }),
    );
  }
  return next;
}

export type BrunoTableCellEditSessionSnapshot =
  | Readonly<{ readonly kind: "idle" }>
  | Readonly<{
      readonly kind: "editing";
      readonly rowId: string;
      readonly columnId: string;
      readonly initialText: string;
      readonly selectInitialText: boolean;
      readonly rowMissing: boolean;
      readonly invalidMessage?: string;
    }>;

export type BrunoTableCellEditProjection = Readonly<{
  readonly active: boolean;
  readonly hasDraft: boolean;
  readonly draft?: unknown;
}>;
export type BrunoTableCellEditMovement =
  | "enter-forward"
  | "enter-backward"
  | "tab-forward"
  | "tab-backward";
export type BrunoTableCellEditMovementOrigin = Readonly<{
  readonly rowId: string;
  readonly columnId: string;
  readonly retainedRowIndex: number;
}>;
const IDLE_SESSION: BrunoTableCellEditSessionSnapshot = Object.freeze({ kind: "idle" });
const IDLE_CELL: BrunoTableCellEditProjection = Object.freeze({ active: false, hasDraft: false });
type ActiveCandidateSnapshot =
  | Readonly<{ readonly kind: "scalar"; readonly rawText: string; readonly nativeInvalid: boolean }>
  | Readonly<{ readonly kind: "blank"; readonly rawText: ""; readonly nativeInvalid: false }>;
const EMPTY_CANDIDATE: ActiveCandidateSnapshot = Object.freeze({
  kind: "scalar",
  rawText: "",
  nativeInvalid: false,
});

export class BrunoTableCellEditRuntime {
  private columns: readonly CompiledColumn[];
  private fieldColumnsById: ReadonlyMap<string, CompiledFieldColumn>;
  private readonly getRow: (rowId: string) => unknown;
  private readonly onCommit: (change: BrunoTableCellEditChange) => void;
  private actor = createActor(brunoTableCellEditMachine);
  private actorActive = false;
  private readonly sessionStore = new Store<BrunoTableCellEditSessionSnapshot>(IDLE_SESSION);
  private readonly draftStore = new Store<ReadonlyMap<string, DraftEntry>>(new Map());
  private readonly candidateStore = new Store<ActiveCandidateSnapshot>(EMPTY_CANDIDATE);
  private readonly cellStores = new Map<string, Store<BrunoTableCellEditProjection>>();
  private readonly cellSubscriberCounts = new Map<string, number>();
  private readonly traversalInvalidationListeners = new Set<Listener>();
  private readonly traversalIndex: BrunoTableCellEditTraversalIndex;
  private appliedDraftPatch: DraftPatch | undefined;
  private activeCellKey: string | undefined;
  private activeCandidate:
    | Readonly<{
        readonly restoreFocus: () => void;
      }>
    | undefined;
  private movementCommand:
    | ((
        movement: BrunoTableCellEditMovement,
        origin: BrunoTableCellEditMovementOrigin | undefined,
      ) => boolean)
    | undefined;
  private retainedMovementRowIndex: number | undefined;

  public constructor(
    options: Readonly<{
      readonly columns: readonly CompiledColumn[];
      readonly getRow: (rowId: string) => unknown;
      readonly onCommit?: (change: BrunoTableCellEditChange) => void;
      readonly incrementalTraversal?: boolean;
    }>,
  ) {
    this.columns = options.columns;
    this.fieldColumnsById = indexFieldColumns(options.columns);
    this.getRow = options.getRow;
    this.onCommit = options.onCommit ?? (() => undefined);
    this.traversalIndex = new BrunoTableCellEditTraversalIndex(
      this.getRow,
      (rowId, row, column) => this.evaluateEditable(rowId, row, column),
      options.incrementalTraversal === true,
    );
  }

  public readonly activate = (): void => {
    if (this.actorActive) return;
    if (this.actor.getSnapshot().status === "stopped") {
      this.actor = createActor(brunoTableCellEditMachine);
    }
    this.actor.subscribe(() => this.publishActorDecision());
    this.actor.start();
    this.actorActive = true;
  };

  public readonly getSessionSnapshot = (): BrunoTableCellEditSessionSnapshot =>
    this.sessionStore.get();

  public readonly subscribeSession = (listener: Listener): (() => void) => {
    const subscription = this.sessionStore.subscribe(listener);
    return () => subscription.unsubscribe();
  };

  public readonly getCellSnapshot = (
    rowId: string,
    columnId: string,
  ): BrunoTableCellEditProjection => this.getCellProjection(cellKey(rowId, columnId));

  public readonly subscribeCell = (
    rowId: string,
    columnId: string,
    listener: Listener,
  ): (() => void) => {
    const key = cellKey(rowId, columnId);
    const store = this.cellStores.get(key) ?? this.installCellStore(key);
    this.cellSubscriberCounts.set(key, (this.cellSubscriberCounts.get(key) ?? 0) + 1);
    const subscription = store.subscribe(listener);
    return () => {
      subscription.unsubscribe();
      const remaining = (this.cellSubscriberCounts.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.cellSubscriberCounts.set(key, remaining);
        return;
      }
      this.cellSubscriberCounts.delete(key);
      if (this.activeCellKey !== key) this.cellStores.delete(key);
    };
  };

  public readonly getDraftSnapshot = (rowId: string, columnId: string): unknown =>
    this.draftStore.get().get(cellKey(rowId, columnId))?.value;

  public readonly getDraftMemorySnapshot = (): ReadonlyMap<string, unknown> =>
    this.draftStore.get();

  public readonly captureDraftCommandReader = (): ((
    rowId: string,
    columnId: string,
  ) => Readonly<{ readonly hasDraft: boolean; readonly value?: unknown }>) => {
    const drafts = this.draftStore.get();
    return (rowId, columnId) => {
      const draft = drafts.get(cellKey(rowId, columnId));
      return draft === undefined
        ? Object.freeze({ hasDraft: false })
        : Object.freeze({ hasDraft: true, value: draft.value });
    };
  };

  public readonly getActiveCandidateSnapshot = (): ActiveCandidateSnapshot =>
    this.candidateStore.get();

  public readonly updateActiveCandidate = (
    rawText: string,
    nativeInvalid: boolean,
    intent: "scalar" | "blank" = "scalar",
  ): void => {
    const boundedRawText = rawText.slice(0, BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1);
    const next: ActiveCandidateSnapshot =
      intent === "blank"
        ? Object.freeze({ kind: "blank", rawText: "", nativeInvalid: false })
        : Object.freeze({ kind: "scalar", rawText: boundedRawText, nativeInvalid });
    const previous = this.candidateStore.get();
    if (
      previous.kind === next.kind &&
      previous.rawText === next.rawText &&
      previous.nativeInvalid === next.nativeInvalid
    )
      return;
    this.candidateStore.setState(() => next);
  };

  public readonly getRetainedCellStoreCount = (): number => this.cellStores.size;

  public readonly registerActiveCandidate = (
    candidate: Readonly<{
      readonly restoreFocus: () => void;
    }>,
  ): (() => void) => {
    this.activeCandidate = candidate;
    return () => {
      if (this.activeCandidate === candidate) this.activeCandidate = undefined;
    };
  };

  public readonly registerMovementCommand = (
    command: (
      movement: BrunoTableCellEditMovement,
      origin: BrunoTableCellEditMovementOrigin | undefined,
    ) => boolean,
  ): (() => void) => {
    this.movementCommand = command;
    return () => {
      if (this.movementCommand === command) this.movementCommand = undefined;
    };
  };

  public readonly reconcileMovementRowIndex = (rowIndex: number | undefined): void => {
    if (rowIndex !== undefined && this.getSessionSnapshot().kind === "editing") {
      this.retainedMovementRowIndex = rowIndex;
    }
  };

  public readonly captureMovementOrigin = (): BrunoTableCellEditMovementOrigin | undefined => {
    const session = this.getSessionSnapshot();
    return session.kind === "editing" && this.retainedMovementRowIndex !== undefined
      ? Object.freeze({
          rowId: session.rowId,
          columnId: session.columnId,
          retainedRowIndex: this.retainedMovementRowIndex,
        })
      : undefined;
  };

  public readonly requestMovement = (
    movement: BrunoTableCellEditMovement,
    origin: BrunoTableCellEditMovementOrigin | undefined,
  ): boolean => this.movementCommand?.(movement, origin) === true;

  public readonly reconcileTraversal = (
    columns: readonly CompiledColumn[],
    rowSpace: BrunoTableCellEditTraversalRowSpace,
  ): boolean => this.traversalIndex.reconcile(columns, rowSpace);

  public readonly buildTraversalSlice = (): boolean => this.traversalIndex.buildNextSlice();

  public readonly isTraversalReady = (): boolean => this.traversalIndex.isReady();

  public readonly reconcileTraversalRows = (
    changedRowIds: ReadonlySet<string> | undefined,
  ): void => {
    if (this.traversalIndex.reconcileRows(changedRowIds)) {
      this.publishTraversalInvalidation();
    }
  };

  public readonly subscribeTraversalInvalidation = (listener: Listener): (() => void) => {
    this.traversalInvalidationListeners.add(listener);
    return () => this.traversalInvalidationListeners.delete(listener);
  };

  public readonly reconcileActiveRow = (changedRowIds?: ReadonlySet<string>): void => {
    const session = this.actor.getSnapshot().context.session;
    if (
      session !== undefined &&
      (changedRowIds === undefined || changedRowIds.has(session.rowId))
    ) {
      this.actor.send({ type: "RECONCILE_ROW", row: this.getRow(session.rowId) });
    }
  };

  public readonly reconcileTraversalRange = (
    range: BrunoTableCellEditTraversalRange | undefined,
  ): void => {
    this.traversalIndex.reconcileRange(range);
  };

  public readonly findTraversalDestination = (
    rowIndex: number,
    columnId: string,
    direction: -1 | 1,
  ): BrunoTableCellEditTraversalDestination | undefined =>
    this.traversalIndex.find(rowIndex, columnId, direction);

  public readonly findTraversalDestinationFromRowBoundary = (
    rowIndex: number,
    direction: -1 | 1,
  ): BrunoTableCellEditTraversalDestination | undefined =>
    this.traversalIndex.findFromRowBoundary(rowIndex, direction);

  public readonly findRangeTraversalDestination = (
    range: BrunoTableCellEditTraversalRange,
    rowId: string,
    columnId: string,
    direction: -1 | 1,
  ): BrunoTableCellEditTraversalDestination | undefined =>
    this.traversalIndex.findRange(range, rowId, columnId, direction);

  public readonly reconcileColumns = (columns: readonly CompiledColumn[]): void => {
    if (this.columns === columns) return;
    const previousFieldColumns = this.fieldColumnsById;
    const nextFieldColumns = indexFieldColumns(columns);
    const previousDrafts = this.draftStore.get();
    const { drafts: nextDrafts, changedKeys } = reconcileDraftsForColumns(
      previousDrafts,
      previousFieldColumns,
      nextFieldColumns,
    );
    const activeSession = this.actor.getSnapshot().context.session;
    const nextActiveColumn =
      activeSession === undefined ? undefined : nextFieldColumns.get(activeSession.column.columnId);
    const canRebindActiveSession =
      activeSession !== undefined &&
      nextActiveColumn !== undefined &&
      isCompatibleActiveColumn(activeSession.column, nextActiveColumn);
    batch(() => {
      this.columns = columns;
      this.fieldColumnsById = nextFieldColumns;
      if (canRebindActiveSession) {
        this.actor.send({ type: "RECONCILE_COLUMN", column: nextActiveColumn });
      } else {
        this.cancel();
      }
      if (nextDrafts === previousDrafts) return;
      this.draftStore.setState(() => nextDrafts);
      for (const key of changedKeys) {
        this.invalidateDraftCell(key);
        this.publishCell(key, nextDrafts);
        this.releaseUnusedCellStore(key);
      }
    });
  };

  public readonly commitActiveCandidate = (): boolean => {
    const candidate = this.activeCandidate;
    if (candidate === undefined) return this.getSessionSnapshot().kind === "idle";
    const candidateValue = this.candidateStore.get();
    const accepted = this.commit(
      candidateValue.rawText,
      candidateValue.nativeInvalid,
      candidateValue.kind,
    );
    if (!accepted) candidate.restoreFocus();
    return accepted;
  };

  public readonly isEditable = (rowId: string, columnId: string): boolean => {
    const column = this.fieldColumnsById.get(columnId);
    if (column === undefined || column.isEditable === undefined || column.isEditable === false) {
      return false;
    }
    const row = this.getRow(rowId);
    if (typeof row !== "object" || row === null) return false;
    return this.evaluateEditable(rowId, row, column);
  };

  private readonly evaluateEditable = (
    rowId: string,
    row: object,
    column: CompiledFieldColumn,
  ): boolean => {
    if (column.isEditable === undefined || column.isEditable === false) return false;
    if (typeof column.isEditable !== "function") return true;
    const draft = this.draftStore.get().get(cellKey(rowId, column.columnId));
    const value = draft === undefined ? Reflect.get(row, column.field) : draft.value;
    try {
      return Reflect.apply(column.isEditable, undefined, [{ row, value }]) === true;
    } catch {
      return false;
    }
  };

  public readonly start = (
    rowId: string,
    columnId: string,
    mode: "current" | "replace" = "current",
    producedText = "",
  ): boolean => {
    if (this.getSessionSnapshot().kind !== "idle") return false;
    const column = this.fieldColumnsById.get(columnId);
    const row = this.getRow(rowId);
    const draft = this.draftStore.get().get(cellKey(rowId, columnId));
    this.actor.send({
      type: "START",
      rowId,
      column,
      row,
      hasDraft: draft !== undefined,
      draftValue: draft?.value,
      mode,
      producedText,
    });
    this.retainedMovementRowIndex = undefined;
    return this.getSessionSnapshot().kind === "editing";
  };

  public readonly commit = (
    rawText: string,
    nativeInvalid = false,
    intent: "scalar" | "blank" = "scalar",
  ): boolean => {
    const actorSnapshot = this.actor.getSnapshot();
    if (actorSnapshot.value !== "editing" || actorSnapshot.context.session === undefined) {
      return false;
    }
    this.actor.send({ type: "COMMIT", rawText, nativeInvalid, intent });
    const result = this.actor.getSnapshot();
    if (result.value !== "idle") return false;
    if (result.context.acceptedChange !== undefined) this.onCommit(result.context.acceptedChange);
    return true;
  };

  public readonly cancel = (): boolean => {
    if (this.actor.getSnapshot().value !== "editing") return false;
    this.actor.send({ type: "CANCEL" });
    this.retainedMovementRowIndex = undefined;
    return true;
  };

  public readonly dispose = (): void => {
    if (!this.actorActive) return;
    this.actor.stop();
    this.actorActive = false;
    this.sessionStore.setState(() => IDLE_SESSION);
    this.draftStore.setState(() => new Map());
    this.candidateStore.setState(() => EMPTY_CANDIDATE);
    this.cellStores.clear();
    this.cellSubscriberCounts.clear();
    this.traversalInvalidationListeners.clear();
    this.activeCellKey = undefined;
    this.activeCandidate = undefined;
  };

  private readonly publishActorDecision = (): void => {
    const previousKey = this.activeCellKey;
    const snapshot = this.actor.getSnapshot();
    const session = snapshot.value === "editing" ? snapshot.context.session : undefined;
    const invalidMessage =
      session === undefined
        ? undefined
        : session.rowMissing
          ? session.invalidMessage
          : (session.permissionMessage ?? session.invalidMessage);
    const next =
      session === undefined
        ? IDLE_SESSION
        : Object.freeze({
            kind: "editing" as const,
            rowId: session.rowId,
            columnId: session.column.columnId,
            initialText: session.initialText,
            selectInitialText: session.selectInitialText,
            rowMissing: session.rowMissing,
            ...(invalidMessage === undefined ? {} : { invalidMessage }),
          });
    const nextKey = next.kind === "editing" ? cellKey(next.rowId, next.columnId) : undefined;
    if (previousKey === undefined && next.kind === "editing") {
      this.candidateStore.setState(() =>
        session !== undefined &&
        session.column.blankValue !== undefined &&
        (session.before === null || session.before === undefined)
          ? Object.freeze({ kind: "blank", rawText: "", nativeInvalid: false })
          : Object.freeze({ kind: "scalar", rawText: next.initialText, nativeInvalid: false }),
      );
    }
    this.activeCellKey = nextKey;
    if (nextKey !== undefined && !this.cellStores.has(nextKey)) this.installCellStore(nextKey);
    const actorContext = this.actor.getSnapshot().context;
    const affectedKeys = new Set(actorContext.affectedCellKeys);
    const previousDrafts = this.draftStore.get();
    const draftPatch = actorContext.draftPatch;
    const nextDrafts =
      draftPatch === undefined || this.appliedDraftPatch === draftPatch
        ? previousDrafts
        : applyDraftPatch(previousDrafts, draftPatch);
    if (draftPatch !== undefined) this.appliedDraftPatch = draftPatch;
    if (previousKey !== undefined) affectedKeys.add(previousKey);
    if (nextKey !== undefined) affectedKeys.add(nextKey);
    batch(() => {
      if (nextDrafts !== previousDrafts) {
        this.draftStore.setState(() => nextDrafts);
        for (const key of actorContext.affectedCellKeys) this.invalidateDraftCell(key);
      }
      if (!sameSessionSnapshot(this.sessionStore.get(), next)) {
        this.sessionStore.setState(() => next);
      }
      for (const key of affectedKeys) this.publishCell(key, nextDrafts);
    });
    for (const key of affectedKeys) this.releaseUnusedCellStore(key);
  };

  private readonly getCellProjection = (key: string): BrunoTableCellEditProjection => {
    const store = this.cellStores.get(key);
    if (store !== undefined) return store.get();
    return this.draftStore.get().get(key)?.projection ?? IDLE_CELL;
  };

  private readonly createCellProjection = (
    key: string,
    drafts = this.draftStore.get(),
  ): BrunoTableCellEditProjection => {
    const draft = drafts.get(key);
    if (this.activeCellKey !== key) return draft?.projection ?? IDLE_CELL;
    return Object.freeze({
      active: true,
      hasDraft: draft !== undefined,
      ...(draft === undefined ? {} : { draft: draft.value }),
    });
  };

  private readonly installCellStore = (key: string): Store<BrunoTableCellEditProjection> => {
    const store = new Store(this.createCellProjection(key));
    this.cellStores.set(key, store);
    return store;
  };

  private readonly publishCell = (key: string, drafts: ReadonlyMap<string, DraftEntry>): void => {
    const store = this.cellStores.get(key);
    if (store === undefined) return;
    const next = this.createCellProjection(key, drafts);
    const previous = store.get();
    if (
      previous.active === next.active &&
      previous.hasDraft === next.hasDraft &&
      Object.is(previous.draft, next.draft)
    ) {
      return;
    }
    store.setState(() => next);
  };

  private readonly releaseUnusedCellStore = (key: string): void => {
    if (this.activeCellKey === key || (this.cellSubscriberCounts.get(key) ?? 0) > 0) return;
    this.cellStores.delete(key);
  };

  private readonly invalidateDraftCell = (key: string): void => {
    const identity = parseCellKey(key);
    if (identity !== undefined) {
      this.traversalIndex.invalidateCell(identity.rowId, identity.columnId);
      this.publishTraversalInvalidation();
    }
  };

  private readonly publishTraversalInvalidation = (): void => {
    for (const listener of this.traversalInvalidationListeners) listener();
  };
}

function indexFieldColumns(
  columns: readonly CompiledColumn[],
): ReadonlyMap<string, CompiledFieldColumn> {
  const indexed = new Map<string, CompiledFieldColumn>();
  for (const column of columns) {
    if (column.kind === "field") indexed.set(column.columnId, column);
  }
  return indexed;
}

function reconcileDraftsForColumns(
  drafts: ReadonlyMap<string, DraftEntry>,
  previousColumns: ReadonlyMap<string, CompiledFieldColumn>,
  nextColumns: ReadonlyMap<string, CompiledFieldColumn>,
): Readonly<{ readonly drafts: ReadonlyMap<string, DraftEntry>; readonly changedKeys: string[] }> {
  let nextDrafts: Map<string, DraftEntry> | undefined;
  const changedKeys: string[] = [];
  for (const [key, draft] of drafts) {
    const identity = parseCellKey(key);
    const previousColumn =
      identity === undefined ? undefined : previousColumns.get(identity.columnId);
    const nextColumn = identity === undefined ? undefined : nextColumns.get(identity.columnId);
    if (
      nextColumn === undefined ||
      nextColumn.isEditable === undefined ||
      nextColumn.isEditable === false ||
      previousColumn?.field !== nextColumn.field
    ) {
      nextDrafts ??= new Map(drafts);
      nextDrafts.delete(key);
      changedKeys.push(key);
      continue;
    }
    if (
      previousColumn?.semantics.decodeRuntimeAuthority ===
      nextColumn.semantics.decodeRuntimeAuthority
    ) {
      continue;
    }
    const decoded = nextColumn.semantics.decodeRuntime(draft.value);
    if (decoded._tag === "Failure") {
      nextDrafts ??= new Map(drafts);
      nextDrafts.delete(key);
      changedKeys.push(key);
      continue;
    }
    if (Object.is(decoded.value, draft.value)) continue;
    nextDrafts ??= new Map(drafts);
    nextDrafts.set(
      key,
      Object.freeze({
        value: decoded.value,
        projection: Object.freeze({ active: false, hasDraft: true, draft: decoded.value }),
      }),
    );
    changedKeys.push(key);
  }
  return Object.freeze({ drafts: nextDrafts ?? drafts, changedKeys });
}

function isCompatibleActiveColumn(
  previousColumn: CompiledFieldColumn,
  nextColumn: CompiledFieldColumn,
): boolean {
  return (
    previousColumn.field === nextColumn.field &&
    hasEquivalentEditSemantics(previousColumn, nextColumn) &&
    sameBlankPolicy(previousColumn, nextColumn) &&
    nextColumn.isEditable !== undefined &&
    nextColumn.isEditable !== false
  );
}

function hasEquivalentEditSemantics(
  previousColumn: CompiledFieldColumn,
  nextColumn: CompiledFieldColumn,
): boolean {
  const previousSelectAuthority = previousColumn.semantics.selectEditAuthority;
  const nextSelectAuthority = nextColumn.semantics.selectEditAuthority;
  if (previousSelectAuthority !== undefined || nextSelectAuthority !== undefined) {
    return sameStringSequence(previousSelectAuthority, nextSelectAuthority);
  }
  return (
    sameStringSequence(
      previousColumn.semantics.booleanEditorCanonicalValues,
      nextColumn.semantics.booleanEditorCanonicalValues,
    ) &&
    previousColumn.semantics.decodeRuntimeAuthority ===
      nextColumn.semantics.decodeRuntimeAuthority &&
    previousColumn.semantics.editorFamily === nextColumn.semantics.editorFamily &&
    previousColumn.semantics.editSessionAuthority.formatCanonicalText ===
      nextColumn.semantics.editSessionAuthority.formatCanonicalText &&
    previousColumn.semantics.editSessionAuthority.parseCanonicalText ===
      nextColumn.semantics.editSessionAuthority.parseCanonicalText
  );
}

function sameBlankPolicy(
  previousColumn: CompiledFieldColumn,
  nextColumn: CompiledFieldColumn,
): boolean {
  return (
    (previousColumn.blankValue === undefined) === (nextColumn.blankValue === undefined) &&
    Object.is(previousColumn.blankValue?.value, nextColumn.blankValue?.value)
  );
}

function sameStringSequence(
  previousOptions: readonly string[] | undefined,
  nextOptions: readonly string[] | undefined,
): boolean {
  if (previousOptions === nextOptions) return true;
  if (previousOptions === undefined || nextOptions === undefined) return false;
  return (
    previousOptions.length === nextOptions.length &&
    previousOptions.every((option, index) => option === nextOptions[index])
  );
}

function cellKey(rowId: string, columnId: string): string {
  return `${rowId.length}:${rowId}${columnId}`;
}

function parseCellKey(
  key: string,
): Readonly<{ readonly rowId: string; readonly columnId: string }> | undefined {
  const separator = key.indexOf(":");
  if (separator <= 0) return undefined;
  const rowIdLength = Number(key.slice(0, separator));
  if (!Number.isSafeInteger(rowIdLength) || rowIdLength < 0) return undefined;
  const rowStart = separator + 1;
  const columnStart = rowStart + rowIdLength;
  if (columnStart > key.length) return undefined;
  return { rowId: key.slice(rowStart, columnStart), columnId: key.slice(columnStart) };
}

function boundedMessage(message: string): string {
  const normalized = message.trim();
  const present = normalized.length === 0 ? "The value is invalid." : normalized;
  return present.length <= 512 ? present : `${present.slice(0, 511)}…`;
}

function sameSessionSnapshot(
  previous: BrunoTableCellEditSessionSnapshot,
  next: BrunoTableCellEditSessionSnapshot,
): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "idle" || next.kind === "idle") return true;
  return (
    previous.rowId === next.rowId &&
    previous.columnId === next.columnId &&
    previous.initialText === next.initialText &&
    previous.selectInitialText === next.selectInitialText &&
    previous.rowMissing === next.rowMissing &&
    previous.invalidMessage === next.invalidMessage
  );
}
