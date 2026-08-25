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
  readonly initialText: string;
  readonly selectInitialText: boolean;
  readonly invalidMessage?: string;
}>;

type DraftEntry = Readonly<{
  readonly value: unknown;
  readonly projection: BrunoTableCellEditProjection;
}>;

type CommitEvaluation =
  | Readonly<{ readonly kind: "invalid"; readonly message: string }>
  | Readonly<{
      readonly kind: "accepted";
      readonly cellKey: string;
      readonly value: unknown;
      readonly removeDraft: boolean;
      readonly change?: BrunoTableCellEditChange;
    }>;

type CellEditContext = Readonly<{
  readonly session: ActiveSession | undefined;
  readonly drafts: ReadonlyMap<string, DraftEntry>;
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
      readonly mode: "current" | "replace";
      readonly producedText: string;
    }>
  | Readonly<{
      readonly type: "COMMIT";
      readonly rawText: string;
      readonly nativeInvalid: boolean;
    }>
  | Readonly<{ readonly type: "CANCEL" }>;

const brunoTableCellEditMachine = createMachine({
  id: "brunoTableCellEditSession",
  initial: "idle",
  types: {} as { context: CellEditContext; events: CellEditEvent },
  context: {
    session: undefined,
    drafts: new Map(),
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
            session: ({ context, event }) => prepareSession(context, event),
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
        COMMIT: {
          target: "validating",
          actions: assign({
            evaluation: ({ context, event }) =>
              evaluateCandidate(context.session, event.rawText, event.nativeInvalid),
            affectedCellKeys: [],
            acceptedChange: undefined,
          }),
        },
        CANCEL: {
          target: "idle",
          actions: assign({
            session: undefined,
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
            drafts: ({ context }) => applyAcceptedDraft(context),
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
                : Object.freeze({ ...session, invalidMessage: evaluation.message });
            },
            affectedCellKeys: [],
            acceptedChange: undefined,
            evaluation: undefined,
          }),
        },
      ],
    },
  },
});

function prepareSession(
  context: CellEditContext,
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
  const key = cellKey(event.rowId, column.columnId);
  const draft = context.drafts.get(key);
  const sourceValue = Reflect.get(row, column.field);
  const before = draft === undefined ? sourceValue : draft.value;
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
      initialText:
        event.mode === "replace"
          ? event.producedText
          : column.semantics.formatCanonicalText(before),
      selectInitialText: event.mode === "current",
    });
  } catch {
    return undefined;
  }
}

export const BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH = 65_536;

function evaluateCandidate(
  session: ActiveSession | undefined,
  rawText: string,
  nativeInvalid = false,
): CommitEvaluation {
  if (session === undefined) {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
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
  const parsed = session.column.semantics.parseCanonicalText(rawText);
  if (parsed._tag === "Failure") {
    return Object.freeze({ kind: "invalid", message: boundedMessage(parsed.message) });
  }
  const after = parsed.value;
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
  const changed = !session.column.semantics.equivalent(session.before, after);
  return Object.freeze({
    kind: "accepted",
    cellKey: cellKey(session.rowId, session.column.columnId),
    value: after,
    removeDraft: session.column.semantics.equivalent(after, sourceValue),
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

function getAcceptedEvaluation(
  context: CellEditContext,
): Extract<CommitEvaluation, { readonly kind: "accepted" }> {
  const evaluation = context.evaluation;
  if (evaluation?.kind !== "accepted") {
    throw new TypeError("BrunoTable Cell Edit accepted without evaluated candidate evidence.");
  }
  return evaluation;
}

function applyAcceptedDraft(context: CellEditContext): ReadonlyMap<string, DraftEntry> {
  const evaluation = getAcceptedEvaluation(context);
  const next = new Map(context.drafts);
  if (evaluation.removeDraft) next.delete(evaluation.cellKey);
  else {
    next.set(
      evaluation.cellKey,
      Object.freeze({
        value: evaluation.value,
        projection: Object.freeze({
          active: false,
          hasDraft: true,
          draft: evaluation.value,
        }),
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
const IDLE_SESSION: BrunoTableCellEditSessionSnapshot = Object.freeze({ kind: "idle" });
const IDLE_CELL: BrunoTableCellEditProjection = Object.freeze({ active: false, hasDraft: false });

export class BrunoTableCellEditRuntime {
  private columns: readonly CompiledColumn[];
  private fieldColumnsById: ReadonlyMap<string, CompiledFieldColumn>;
  private readonly getRow: (rowId: string) => unknown;
  private readonly onCommit: (change: BrunoTableCellEditChange) => void;
  private readonly actor = createActor(brunoTableCellEditMachine);
  private readonly sessionStore = new Store<BrunoTableCellEditSessionSnapshot>(IDLE_SESSION);
  private readonly cellStores = new Map<string, Store<BrunoTableCellEditProjection>>();
  private readonly cellSubscriberCounts = new Map<string, number>();
  private readonly publishedDraftEvidence = new Map<string, DraftEntry>();
  private readonly traversalIndex: BrunoTableCellEditTraversalIndex;
  private activeCellKey: string | undefined;
  private activeCandidate:
    | Readonly<{
        readonly read: () => Readonly<{
          readonly rawText: string;
          readonly nativeInvalid: boolean;
        }>;
        readonly restoreFocus: () => void;
      }>
    | undefined;
  private movementCommand: ((movement: BrunoTableCellEditMovement) => boolean) | undefined;

  public constructor(
    options: Readonly<{
      readonly columns: readonly CompiledColumn[];
      readonly getRow: (rowId: string) => unknown;
      readonly onCommit?: (change: BrunoTableCellEditChange) => void;
    }>,
  ) {
    this.columns = options.columns;
    this.fieldColumnsById = indexFieldColumns(options.columns);
    this.getRow = options.getRow;
    this.onCommit = options.onCommit ?? (() => undefined);
    this.traversalIndex = new BrunoTableCellEditTraversalIndex(this.getRow, (rowId, row, column) =>
      this.evaluateEditable(rowId, row, column),
    );
    this.actor.subscribe(() => this.publishActorDecision());
    this.actor.start();
  }

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
    this.actor.getSnapshot().context.drafts.get(cellKey(rowId, columnId))?.value;

  public readonly getRetainedCellStoreCount = (): number => this.cellStores.size;

  public readonly registerActiveCandidate = (
    candidate: Readonly<{
      readonly read: () => Readonly<{ readonly rawText: string; readonly nativeInvalid: boolean }>;
      readonly restoreFocus: () => void;
    }>,
  ): (() => void) => {
    this.activeCandidate = candidate;
    return () => {
      if (this.activeCandidate === candidate) this.activeCandidate = undefined;
    };
  };

  public readonly registerMovementCommand = (
    command: (movement: BrunoTableCellEditMovement) => boolean,
  ): (() => void) => {
    this.movementCommand = command;
    return () => {
      if (this.movementCommand === command) this.movementCommand = undefined;
    };
  };

  public readonly requestMovement = (movement: BrunoTableCellEditMovement): boolean =>
    this.movementCommand?.(movement) === true;

  public readonly reconcileTraversal = (
    columns: readonly CompiledColumn[],
    rowSpace: BrunoTableCellEditTraversalRowSpace,
  ): void => {
    this.traversalIndex.reconcile(columns, rowSpace);
  };

  public readonly reconcileTraversalRows = (
    changedRowIds: ReadonlySet<string> | undefined,
  ): void => {
    this.traversalIndex.reconcileRows(changedRowIds);
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

  public readonly findRangeTraversalDestination = (
    range: BrunoTableCellEditTraversalRange,
    rowId: string,
    columnId: string,
    direction: -1 | 1,
  ): BrunoTableCellEditTraversalDestination | undefined =>
    this.traversalIndex.findRange(range, rowId, columnId, direction);

  public readonly reconcileColumns = (columns: readonly CompiledColumn[]): void => {
    if (this.columns === columns) return;
    this.cancel();
    this.columns = columns;
    this.fieldColumnsById = indexFieldColumns(columns);
  };

  public readonly commitActiveCandidate = (): boolean => {
    const candidate = this.activeCandidate;
    if (candidate === undefined) return this.getSessionSnapshot().kind === "idle";
    const candidateValue = candidate.read();
    const accepted = this.commit(candidateValue.rawText, candidateValue.nativeInvalid);
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
    const draft = this.actor.getSnapshot().context.drafts.get(cellKey(rowId, column.columnId));
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
    this.actor.send({
      type: "START",
      rowId,
      column,
      row,
      mode,
      producedText,
    });
    return this.getSessionSnapshot().kind === "editing";
  };

  public readonly commit = (rawText: string, nativeInvalid = false): boolean => {
    const actorSnapshot = this.actor.getSnapshot();
    if (actorSnapshot.value !== "editing" || actorSnapshot.context.session === undefined) {
      return false;
    }
    this.actor.send({ type: "COMMIT", rawText, nativeInvalid });
    const result = this.actor.getSnapshot();
    if (result.value !== "idle") return false;
    if (result.context.acceptedChange !== undefined) this.onCommit(result.context.acceptedChange);
    return true;
  };

  public readonly cancel = (): boolean => {
    if (this.actor.getSnapshot().value !== "editing") return false;
    this.actor.send({ type: "CANCEL" });
    return true;
  };

  public readonly dispose = (): void => {
    this.actor.stop();
    this.cellStores.clear();
    this.cellSubscriberCounts.clear();
  };

  private readonly publishActorDecision = (): void => {
    const previousKey = this.activeCellKey;
    const snapshot = this.actor.getSnapshot();
    const session = snapshot.value === "editing" ? snapshot.context.session : undefined;
    const next =
      session === undefined
        ? IDLE_SESSION
        : Object.freeze({
            kind: "editing" as const,
            rowId: session.rowId,
            columnId: session.column.columnId,
            initialText: session.initialText,
            selectInitialText: session.selectInitialText,
            ...(session.invalidMessage === undefined
              ? {}
              : { invalidMessage: session.invalidMessage }),
          });
    const nextKey = next.kind === "editing" ? cellKey(next.rowId, next.columnId) : undefined;
    this.activeCellKey = nextKey;
    if (nextKey !== undefined && !this.cellStores.has(nextKey)) this.installCellStore(nextKey);
    const actorContext = this.actor.getSnapshot().context;
    const affectedKeys = new Set(actorContext.affectedCellKeys);
    for (const key of affectedKeys) this.reconcileDraftRevision(key, actorContext.drafts);
    if (previousKey !== undefined) affectedKeys.add(previousKey);
    if (nextKey !== undefined) affectedKeys.add(nextKey);
    batch(() => {
      if (!sameSessionSnapshot(this.sessionStore.get(), next)) {
        this.sessionStore.setState(() => next);
      }
      for (const key of affectedKeys) this.publishCell(key);
    });
    for (const key of affectedKeys) this.releaseUnusedCellStore(key);
  };

  private readonly getCellProjection = (key: string): BrunoTableCellEditProjection => {
    const store = this.cellStores.get(key);
    if (store !== undefined) return store.get();
    return this.actor.getSnapshot().context.drafts.get(key)?.projection ?? IDLE_CELL;
  };

  private readonly createCellProjection = (key: string): BrunoTableCellEditProjection => {
    const draft = this.actor.getSnapshot().context.drafts.get(key);
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

  private readonly publishCell = (key: string): void => {
    const store = this.cellStores.get(key);
    if (store === undefined) return;
    const next = this.createCellProjection(key);
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

  private readonly reconcileDraftRevision = (
    key: string,
    drafts: ReadonlyMap<string, DraftEntry>,
  ): void => {
    const previous = this.publishedDraftEvidence.get(key);
    const next = drafts.get(key);
    if (
      (previous === undefined) === (next === undefined) &&
      Object.is(previous?.value, next?.value)
    ) {
      return;
    }
    if (next === undefined) this.publishedDraftEvidence.delete(key);
    else this.publishedDraftEvidence.set(key, next);
    const identity = parseCellKey(key);
    if (identity !== undefined)
      this.traversalIndex.invalidateCell(identity.rowId, identity.columnId);
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
    previous.invalidMessage === next.invalidMessage
  );
}
