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
const brunoTableCellEditDraftReviewSources = new WeakSet<object>();

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
  readonly baseRow: object;
  readonly baseValue: unknown;
  readonly before: unknown;
  readonly beforeFromDraft: boolean;
  readonly sourceValue: unknown;
  readonly sourceValueAvailable: boolean;
  readonly expectedVersion: unknown;
  readonly initialText: string;
  readonly selectInitialText: boolean;
  readonly rowMissing: boolean;
  readonly invalidMessage?: string;
  readonly permissionMessage?: string;
}>;

export type BrunoTableCellEditDraftSnapshot = Readonly<{
  readonly rowId: string;
  readonly columnId: string;
  readonly field: string;
  readonly baseRow: object;
  readonly expectedVersion: unknown;
  readonly base: unknown;
  readonly mine: unknown;
  readonly validationMessage?: string;
  readonly conflict?: Readonly<{
    readonly server: unknown;
    readonly resolution?: "mine" | "server";
  }>;
}>;

export type BrunoTableCellEditDraftReviewRow = BrunoTableCellEditDraftSnapshot &
  Readonly<{
    readonly id: string;
    readonly reviewVersion: number;
    readonly headerName: string;
    readonly columnLabel: string;
    readonly serverText: "";
    readonly mineText: "";
    readonly status: string;
    readonly column: CompiledFieldColumn;
    readonly serverRow: object | undefined;
    readonly projectedRow: object;
    readonly serverNow: unknown;
    readonly blockedReason: string | undefined;
    readonly candidateText?: string;
    readonly candidateInvalid?: boolean;
  }>;

export type BrunoTableCellEditDraftReviewSourceRow = Readonly<{
  readonly kind: "bruno-table-cell-edit-draft-review-source";
  readonly id: string;
  readonly rowId: string;
  readonly columnLabel: string;
  readonly serverText: "";
  readonly mineText: "";
  readonly statusText: "";
  readonly getSnapshot: () => BrunoTableCellEditDraftReviewRow;
  readonly subscribe: (listener: Listener) => () => void;
}>;

export function isBrunoTableCellEditDraftReviewSourceRow(
  value: unknown,
): value is BrunoTableCellEditDraftReviewSourceRow {
  return (
    typeof value === "object" && value !== null && brunoTableCellEditDraftReviewSources.has(value)
  );
}

type DraftEntry = BrunoTableCellEditDraftSnapshot &
  Readonly<{
    readonly blockedReason?: string;
  }>;

type DraftPatch =
  | Readonly<{ readonly kind: "remove"; readonly cellKey: string }>
  | Readonly<{
      readonly kind: "set";
      readonly cellKey: string;
      readonly value: unknown;
      readonly rowId: string;
      readonly columnId: string;
      readonly field: string;
      readonly baseRow: object;
      readonly expectedVersion: unknown;
      readonly base: unknown;
      readonly validationMessage?: string;
      readonly conflict?: Readonly<{
        readonly server: unknown;
        readonly resolution?: "mine" | "server";
      }>;
    }>;

type DraftHistoryCellPatch = Readonly<{
  readonly cellKey: string;
  readonly before: DraftEntry | undefined;
  readonly after: DraftEntry | undefined;
}>;

const BRUNO_TABLE_DRAFT_HISTORY_PATCH_BUCKET_COUNT = 64;

function draftHistoryPatchBucket(key: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % BRUNO_TABLE_DRAFT_HISTORY_PATCH_BUCKET_COUNT;
}

class DraftHistoryPatchMap implements ReadonlyMap<string, DraftHistoryCellPatch> {
  public static from(
    patches: Iterable<readonly [string, DraftHistoryCellPatch]>,
  ): DraftHistoryPatchMap {
    const buckets = Array.from(
      { length: BRUNO_TABLE_DRAFT_HISTORY_PATCH_BUCKET_COUNT },
      () => new Map<string, DraftHistoryCellPatch>(),
    );
    let size = 0;
    for (const [key, patch] of patches) {
      const bucket = buckets[draftHistoryPatchBucket(key)]!;
      if (!bucket.has(key)) size += 1;
      bucket.set(key, patch);
    }
    return new DraftHistoryPatchMap(Object.freeze(buckets), size);
  }

  public constructor(
    private readonly buckets: readonly ReadonlyMap<string, DraftHistoryCellPatch>[],
    public readonly size: number,
  ) {}

  public readonly get = (key: string): DraftHistoryCellPatch | undefined =>
    this.buckets[draftHistoryPatchBucket(key)]?.get(key);

  public readonly has = (key: string): boolean =>
    this.buckets[draftHistoryPatchBucket(key)]?.has(key) === true;

  public readonly with = (
    key: string,
    patch: DraftHistoryCellPatch | undefined,
  ): DraftHistoryPatchMap => {
    const bucketIndex = draftHistoryPatchBucket(key);
    const previousBucket = this.buckets[bucketIndex];
    if (previousBucket === undefined) return this;
    const previous = previousBucket.get(key);
    if (previous === patch || (previous === undefined && patch === undefined)) return this;
    const nextBucket = new Map(previousBucket);
    if (patch === undefined) nextBucket.delete(key);
    else nextBucket.set(key, patch);
    const nextBuckets = [...this.buckets];
    nextBuckets[bucketIndex] = nextBucket;
    return new DraftHistoryPatchMap(
      Object.freeze(nextBuckets),
      this.size + (previous === undefined ? 1 : patch === undefined ? -1 : 0),
    );
  };

  public *entries(): MapIterator<[string, DraftHistoryCellPatch]> {
    for (const bucket of this.buckets) yield* bucket.entries();
  }

  public *keys(): MapIterator<string> {
    for (const bucket of this.buckets) yield* bucket.keys();
  }

  public *values(): MapIterator<DraftHistoryCellPatch> {
    for (const bucket of this.buckets) yield* bucket.values();
  }

  public forEach(
    callback: (
      value: DraftHistoryCellPatch,
      key: string,
      map: ReadonlyMap<string, DraftHistoryCellPatch>,
    ) => void,
    thisArgument?: unknown,
  ): void {
    for (const [key, value] of this) callback.call(thisArgument, value, key, this);
  }

  public [Symbol.iterator](): MapIterator<[string, DraftHistoryCellPatch]> {
    return this.entries();
  }
}

class DraftHistoryPatchMapBuilder {
  private readonly buckets = Array.from(
    { length: BRUNO_TABLE_DRAFT_HISTORY_PATCH_BUCKET_COUNT },
    () => new Map<string, DraftHistoryCellPatch>(),
  );
  private size = 0;

  public readonly set = (key: string, patch: DraftHistoryCellPatch | undefined): void => {
    const bucket = this.buckets[draftHistoryPatchBucket(key)]!;
    const hadKey = bucket.has(key);
    if (patch === undefined) {
      if (hadKey) {
        bucket.delete(key);
        this.size -= 1;
      }
      return;
    }
    bucket.set(key, patch);
    if (!hadKey) this.size += 1;
  };

  public readonly build = (): DraftHistoryPatchMap =>
    new DraftHistoryPatchMap(Object.freeze(this.buckets), this.size);
}

type DraftHistoryCommand = Readonly<{
  readonly lineage: object;
  readonly patches: DraftHistoryPatchMap;
}>;

type DraftMemoryState = Readonly<{
  readonly drafts: ReadonlyMap<string, DraftEntry>;
  readonly undoStack: readonly DraftHistoryCommand[];
  readonly redoStack: readonly DraftHistoryCommand[];
}>;

type CanonicalSourceValue =
  | Readonly<{ readonly _tag: "Success"; readonly value: unknown }>
  | Readonly<{ readonly _tag: "Failure" }>;

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
      readonly sourceValue: CanonicalSourceValue;
      readonly expectedVersion: unknown;
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
  | Readonly<{
      readonly type: "RECONCILE_ROW";
      readonly row: unknown;
      readonly sourceValue: CanonicalSourceValue;
    }>
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
                    Object.freeze({
                      ...session,
                      row: event.row,
                      rowMissing: false,
                      sourceValue:
                        event.sourceValue._tag === "Success" ? event.sourceValue.value : undefined,
                      sourceValueAvailable: event.sourceValue._tag === "Success",
                    }),
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
  if (event.sourceValue._tag === "Failure") return undefined;
  const sourceValue = event.sourceValue.value;
  const before = event.hasDraft ? event.draftValue : sourceValue;
  if (!isEditorValueRepresentable(column, before)) return undefined;
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
      baseRow: row,
      baseValue: sourceValue,
      before,
      beforeFromDraft: event.hasDraft,
      sourceValue,
      sourceValueAvailable: true,
      expectedVersion: event.expectedVersion,
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
  if (!session.beforeFromDraft && !session.sourceValueAvailable) return false;
  const value = session.beforeFromDraft ? session.before : session.sourceValue;
  if (!isEditorValueRepresentable(session.column, value)) return false;
  const policy = session.column.isEditable;
  if (policy === true) return true;
  if (typeof policy !== "function") return false;
  try {
    return Reflect.apply(policy, undefined, [{ row: session.row, value }]) === true;
  } catch {
    return false;
  }
}

function isDraftEditable(column: CompiledFieldColumn, row: object, value: unknown): boolean {
  if (!isEditorValueRepresentable(column, value)) return false;
  if (column.isEditable === true) return true;
  if (typeof column.isEditable !== "function") return false;
  try {
    return Reflect.apply(column.isEditable, undefined, [{ row, value }]) === true;
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
  if (!session.sourceValueAvailable) {
    return Object.freeze({ kind: "invalid", message: "The source value is invalid." });
  }
  const sourceValue = session.sourceValue;
  const equivalentBefore = safeEquivalentEditValue(session.column, session.before, after);
  const equivalentSource = safeEquivalentEditValue(session.column, after, sourceValue);
  if (equivalentBefore === undefined || equivalentSource === undefined) {
    return Object.freeze({ kind: "invalid", message: "The value is invalid." });
  }
  const changed = !equivalentBefore;
  const removeDraft = equivalentSource || (!session.beforeFromDraft && equivalentBefore);
  return Object.freeze({
    kind: "accepted",
    cellKey: cellKey(session.rowId, session.column.columnId),
    value: after,
    removeDraft,
    ...(changed && (!equivalentSource || session.beforeFromDraft)
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

function isEditorValueRepresentable(column: CompiledFieldColumn, value: unknown): boolean {
  const booleanValues = column.semantics.booleanEditorCanonicalValues;
  if (column.semantics.editorFamily !== "boolean" || booleanValues === undefined) return true;
  if (value === null || value === undefined) {
    return column.blankValue !== undefined && Object.is(value, column.blankValue.value);
  }
  try {
    const canonicalText = column.semantics.formatCanonicalText(value);
    return canonicalText === booleanValues[0] || canonicalText === booleanValues[1];
  } catch {
    return false;
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
  const session = context.session;
  if (session === undefined) {
    throw new TypeError("BrunoTable Cell Edit accepted without session evidence.");
  }
  return evaluation.removeDraft
    ? Object.freeze({ kind: "remove", cellKey: evaluation.cellKey })
    : Object.freeze({
        kind: "set",
        cellKey: evaluation.cellKey,
        value: evaluation.value,
        rowId: session.rowId,
        columnId: session.column.columnId,
        field: session.column.field,
        baseRow: session.baseRow,
        expectedVersion: session.expectedVersion,
        base: session.baseValue,
      });
}

function applyDraftPatch(
  drafts: ReadonlyMap<string, DraftEntry>,
  patch: DraftPatch,
  columns: ReadonlyMap<string, CompiledFieldColumn>,
): ReadonlyMap<string, DraftEntry> {
  const previous = drafts.get(patch.cellKey);
  if (patch.kind === "remove" && previous === undefined) return drafts;
  if (patch.kind === "set" && previous !== undefined) {
    const column = columns.get(patch.columnId);
    if (
      column !== undefined &&
      safeEquivalentEditValue(column, previous.mine, patch.value) === true
    ) {
      return drafts;
    }
  }
  const next = new Map(drafts);
  if (patch.kind === "remove") next.delete(patch.cellKey);
  else {
    const retained =
      previous === undefined
        ? {
            rowId: patch.rowId,
            columnId: patch.columnId,
            field: patch.field,
            baseRow: patch.baseRow,
            expectedVersion: patch.expectedVersion,
            base: patch.base,
            ...(patch.validationMessage === undefined
              ? {}
              : { validationMessage: patch.validationMessage }),
            ...(patch.conflict === undefined ? {} : { conflict: patch.conflict }),
          }
        : {
            rowId: previous.rowId,
            columnId: previous.columnId,
            field: previous.field,
            baseRow: previous.baseRow,
            expectedVersion: previous.expectedVersion,
            base: previous.base,
            ...(patch.validationMessage === undefined
              ? {}
              : { validationMessage: patch.validationMessage }),
            ...(patch.conflict === undefined ? {} : { conflict: patch.conflict }),
          };
    next.set(
      patch.cellKey,
      Object.freeze({
        ...retained,
        mine: patch.value,
      }),
    );
  }
  return next;
}

function pruneDraftHistory(
  commands: readonly DraftHistoryCommand[],
  convergedCellKeys: ReadonlySet<string>,
): readonly DraftHistoryCommand[] {
  if (convergedCellKeys.size === 0) return commands;
  const retained: DraftHistoryCommand[] = [];
  for (const command of commands) {
    let patches = command.patches;
    for (const key of convergedCellKeys) patches = patches.with(key, undefined);
    if (patches.size === 0) continue;
    retained.push(
      patches === command.patches ? command : Object.freeze({ lineage: command.lineage, patches }),
    );
  }
  return retained;
}

function transformDraftHistoryCell(
  commands: readonly DraftHistoryCommand[],
  key: string,
  transform: (entry: DraftEntry | undefined) => DraftEntry | undefined,
): readonly DraftHistoryCommand[] {
  let changed = false;
  const nextCommands: DraftHistoryCommand[] = [];
  for (const command of commands) {
    const patch = command.patches.get(key);
    if (patch === undefined) {
      nextCommands.push(command);
      continue;
    }
    const before = transform(patch.before);
    const after = transform(patch.after);
    if (before === patch.before && after === patch.after) {
      nextCommands.push(command);
      continue;
    }
    changed = true;
    const patches = command.patches.with(
      key,
      before === undefined && after === undefined
        ? undefined
        : Object.freeze({ cellKey: key, before, after }),
    );
    if (patches.size > 0) {
      nextCommands.push(Object.freeze({ lineage: command.lineage, patches }));
    }
  }
  return changed ? Object.freeze(nextCommands) : commands;
}

function setDraftBlockedReason(
  draft: DraftEntry | undefined,
  blockedReason: string | undefined,
): DraftEntry | undefined {
  if (draft === undefined || draft.blockedReason === blockedReason) return draft;
  const { blockedReason: _previousBlockedReason, ...retained } = draft;
  return Object.freeze({
    ...retained,
    ...(blockedReason === undefined ? {} : { blockedReason }),
  });
}

function findDraftHistoryEntry(
  undoStack: readonly DraftHistoryCommand[],
  redoStack: readonly DraftHistoryCommand[],
  key: string,
): DraftEntry | undefined {
  for (const commands of [redoStack, undoStack]) {
    for (let index = commands.length - 1; index >= 0; index -= 1) {
      const patch = commands[index]?.patches.get(key);
      const entry = patch?.after ?? patch?.before;
      if (entry !== undefined) return entry;
    }
  }
  return undefined;
}

function historyKeysInvalidatedByColumns(
  commands: readonly DraftHistoryCommand[],
  previousColumns: ReadonlyMap<string, CompiledFieldColumn>,
  nextColumns: ReadonlyMap<string, CompiledFieldColumn>,
): Set<string> {
  const invalidated = new Set<string>();
  for (const command of commands) {
    for (const [key, patch] of command.patches) {
      if (invalidated.has(key)) continue;
      const identity = parseCellKey(key);
      const previousColumn =
        identity === undefined ? undefined : previousColumns.get(identity.columnId);
      const nextColumn = identity === undefined ? undefined : nextColumns.get(identity.columnId);
      const representative = patch.after ?? patch.before;
      if (
        representative === undefined ||
        nextColumn === undefined ||
        nextColumn.isEditable === undefined ||
        nextColumn.isEditable === false ||
        previousColumn?.field !== nextColumn.field ||
        !sameBlankPolicy(previousColumn, nextColumn) ||
        previousColumn.semantics.decodeRuntimeAuthority !==
          nextColumn.semantics.decodeRuntimeAuthority
      ) {
        invalidated.add(key);
      }
    }
  }
  return invalidated;
}

function redoHistoryMineConverged(
  redoStack: readonly DraftHistoryCommand[],
  key: string,
  column: CompiledFieldColumn,
  sourceValue: unknown,
): boolean {
  for (let index = redoStack.length - 1; index >= 0; index -= 1) {
    const command = redoStack[index];
    if (command === undefined) continue;
    const patch = command.patches.get(key);
    if (patch === undefined) continue;
    return (
      patch.after !== undefined &&
      safeEquivalentEditValue(column, patch.after.mine, sourceValue) === true
    );
  }
  return false;
}

function createDraftHistoryCommand(
  first: DraftHistoryCellPatch,
  ...rest: DraftHistoryCellPatch[]
): DraftHistoryCommand {
  const patches = new Map<string, DraftHistoryCellPatch>();
  patches.set(first.cellKey, first);
  for (const patch of rest) patches.set(patch.cellKey, patch);
  return Object.freeze({
    lineage: Object.freeze({}),
    patches: DraftHistoryPatchMap.from(patches),
  });
}

function createDraftHistoryCommandFromPatches(patches: DraftHistoryPatchMap): DraftHistoryCommand {
  if (patches.size === 0) {
    throw new TypeError("BrunoTable Batch History Command requires a non-empty patch set.");
  }
  return Object.freeze({
    lineage: Object.freeze({}),
    patches,
  });
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
export type BrunoTableCellEditActivitySnapshot = Readonly<{
  readonly activeEditor: boolean;
  readonly activeCandidatePending: boolean;
  readonly reviewCount: number;
  readonly draftCount: number;
  readonly undoCount: number;
  readonly redoCount: number;
  readonly blockedCount: number;
  readonly validationCount: number;
  readonly conflictCount: number;
}>;
const IDLE_SESSION: BrunoTableCellEditSessionSnapshot = Object.freeze({ kind: "idle" });
const IDLE_CELL: BrunoTableCellEditProjection = Object.freeze({ active: false, hasDraft: false });
const IDLE_ACTIVITY: BrunoTableCellEditActivitySnapshot = Object.freeze({
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
const BRUNO_TABLE_BATCH_HISTORY_LIMIT = 100;
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
  private readonly getCanonicalValue:
    | ((rowId: string, columnId: string) => CanonicalSourceValue)
    | undefined;
  private getRowVersion: ((row: object) => unknown) | undefined;
  private canonicalSourceValueCache = new WeakMap<
    object,
    Map<unknown, Map<string, CanonicalSourceValue>>
  >();
  private draftProjectionCache = new WeakMap<DraftEntry, BrunoTableCellEditProjection>();
  private readonly onCommit: (change: BrunoTableCellEditChange) => void;
  private actor = createActor(brunoTableCellEditMachine);
  private actorActive = false;
  private readonly sessionStore = new Store<BrunoTableCellEditSessionSnapshot>(IDLE_SESSION);
  private readonly draftMemoryStore = new Store<DraftMemoryState>(
    Object.freeze({
      drafts: new Map(),
      undoStack: Object.freeze([]),
      redoStack: Object.freeze([]),
    }),
  );
  private readonly draftStore = {
    get: (): ReadonlyMap<string, DraftEntry> => this.draftMemoryStore.get().drafts,
  };
  private readonly activityStore = new Store<BrunoTableCellEditActivitySnapshot>(IDLE_ACTIVITY);
  private readonly draftReviewStore = new Store<readonly BrunoTableCellEditDraftReviewSourceRow[]>(
    Object.freeze([]),
  );
  private draftReviewSubscriberCount = 0;
  private draftReviewVersion = 0;
  private draftReviewRowsById = new Map<string, BrunoTableCellEditDraftReviewSourceRow>();
  private draftReviewRowStoresById = new Map<string, Store<BrunoTableCellEditDraftReviewRow>>();
  private draftReviewEntriesById = new Map<string, DraftEntry>();
  private readonly resetControls = new WeakSet<Element>();
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
  private batchHistoryEnabled = false;
  private readonly blockedDraftKeys = new Set<string>();
  private readonly validationDraftKeys = new Set<string>();
  private readonly conflictDraftKeys = new Set<string>();
  private readonly draftEvidenceKeys = new Set<string>();
  private readonly draftKeysByRowId = new Map<string, string | Set<string>>();

  private get undoStack(): readonly DraftHistoryCommand[] {
    return this.draftMemoryStore.get().undoStack;
  }

  private get redoStack(): readonly DraftHistoryCommand[] {
    return this.draftMemoryStore.get().redoStack;
  }

  public constructor(
    options: Readonly<{
      readonly columns: readonly CompiledColumn[];
      readonly getRow: (rowId: string) => unknown;
      readonly getCanonicalValue?: (rowId: string, columnId: string) => CanonicalSourceValue;
      readonly getRowVersion?: (row: object) => unknown;
      readonly onCommit?: (change: BrunoTableCellEditChange) => void;
      readonly incrementalTraversal?: boolean;
    }>,
  ) {
    this.columns = options.columns;
    this.fieldColumnsById = indexFieldColumns(options.columns);
    this.getRow = options.getRow;
    this.getCanonicalValue = options.getCanonicalValue;
    this.getRowVersion = options.getRowVersion;
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

  public readonly getActivitySnapshot = (): BrunoTableCellEditActivitySnapshot =>
    this.activityStore.get();

  public readonly setRowVersionExtractor = (
    getRowVersion: ((row: object) => unknown) | undefined,
  ): void => {
    this.getRowVersion = getRowVersion;
  };

  public readonly subscribeActivity = (listener: Listener): (() => void) => {
    const subscription = this.activityStore.subscribe(listener);
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
    this.draftStore.get().get(cellKey(rowId, columnId))?.mine;

  public readonly getDraftMemorySnapshot = (): ReadonlyMap<string, unknown> =>
    this.draftStore.get();

  public readonly getDraftReviewSnapshot = (): readonly BrunoTableCellEditDraftReviewRow[] =>
    this.draftReviewSubscriberCount === 0
      ? Object.freeze(
          [...this.draftStore.get()].flatMap(([id, draft]) => {
            const row = this.createDraftReviewRow(id, draft);
            return row === undefined ? [] : [row];
          }),
        )
      : Object.freeze(this.draftReviewStore.get().map((row) => row.getSnapshot()));

  public readonly getDraftReviewSourceSnapshot =
    (): readonly BrunoTableCellEditDraftReviewSourceRow[] => this.draftReviewStore.get();

  public readonly subscribeDraftReview = (listener: Listener): (() => void) => {
    this.draftReviewSubscriberCount += 1;
    if (this.draftReviewSubscriberCount === 1) this.publishDraftReview(this.draftStore.get());
    const subscription = this.draftReviewStore.subscribe(listener);
    return () => {
      subscription.unsubscribe();
      this.draftReviewSubscriberCount -= 1;
      if (this.draftReviewSubscriberCount === 0) {
        this.draftReviewStore.setState(() => Object.freeze([]));
        this.draftReviewRowsById.clear();
        this.draftReviewRowStoresById.clear();
        this.draftReviewEntriesById.clear();
      }
    };
  };

  public readonly captureDraftCommandReader = (): ((
    rowId: string,
    columnId: string,
  ) => Readonly<{ readonly hasDraft: boolean; readonly value?: unknown }>) => {
    const drafts = this.draftStore.get();
    return (rowId, columnId) => {
      const draft = drafts.get(cellKey(rowId, columnId));
      return draft === undefined
        ? Object.freeze({ hasDraft: false })
        : Object.freeze({ hasDraft: true, value: draft.mine });
    };
  };

  public readonly getActiveCandidateSnapshot = (): ActiveCandidateSnapshot =>
    this.candidateStore.get();

  private readonly hasActiveCandidateWork = (session = this.sessionStore.get()): boolean => {
    if (session.kind !== "editing") return false;
    const candidate = this.candidateStore.get();
    return (
      session.invalidMessage !== undefined ||
      candidate.nativeInvalid ||
      candidate.rawText !== session.initialText ||
      (candidate.kind === "blank" && session.initialText !== "")
    );
  };

  private readonly hasInvalidActiveCandidate = (): boolean => {
    const session = this.actor.getSnapshot().context.session;
    if (session === undefined || !this.hasActiveCandidateWork()) return false;
    return session.invalidMessage !== undefined || this.candidateStore.get().nativeInvalid;
  };

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
    this.publishActivitySnapshot();
    if (this.activeCellKey !== undefined) {
      this.publishDraftReview(this.draftStore.get(), new Set([this.activeCellKey]));
    }
  };

  public readonly getRetainedCellStoreCount = (): number => this.cellStores.size;

  public readonly getRetainedDraftDependencyCellCount = (): number => this.draftEvidenceKeys.size;

  public readonly registerResetControl = (element: Element): (() => void) => {
    this.resetControls.add(element);
    return () => this.resetControls.delete(element);
  };

  public readonly ownsResetControl = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    const control = target.closest("[data-bruno-cell-edit-reset]");
    return control !== null && this.resetControls.has(control);
  };

  public readonly setBatchHistoryEnabled = (enabled: boolean): void => {
    if (this.batchHistoryEnabled === enabled) return;
    if (!enabled && (this.undoStack.length > 0 || this.redoStack.length > 0)) return;
    this.batchHistoryEnabled = enabled;
    this.publishActivitySnapshot();
  };

  public readonly applyAcceptedDraftGesture = (
    drafts: readonly [BrunoTableCellEditDraftSnapshot, ...BrunoTableCellEditDraftSnapshot[]],
  ): boolean => {
    if (this.getSessionSnapshot().kind === "editing") return false;
    const previousDrafts = this.draftStore.get();
    const nextDrafts = new Map(previousDrafts);
    const historyPatchBuilder = new DraftHistoryPatchMapBuilder();
    let unchangedGestureKeys: Set<string> | undefined;
    let draftStatusEvidenceChanged =
      this.blockedDraftKeys.size > 0 ||
      this.validationDraftKeys.size > 0 ||
      this.conflictDraftKeys.size > 0;
    for (const draft of drafts) {
      const column = this.fieldColumnsById.get(draft.columnId);
      if (column?.field !== draft.field) return false;
      const key = cellKey(draft.rowId, draft.columnId);
      const before = previousDrafts.get(key);
      const existing = nextDrafts.get(key);
      if (existing !== before || unchangedGestureKeys?.has(key) === true) return false;
      const base = existing?.base ?? draft.base;
      const equivalentToBase = safeEquivalentEditValue(column, draft.mine, base);
      if (equivalentToBase === undefined) return false;
      if (equivalentToBase) nextDrafts.delete(key);
      else if (
        existing === undefined ||
        safeEquivalentEditValue(column, existing.mine, draft.mine) !== true
      ) {
        const retained = existing ?? draft;
        nextDrafts.set(
          key,
          existing === undefined
            ? Object.isFrozen(draft)
              ? draft
              : Object.freeze({ ...draft })
            : Object.freeze({
                rowId: retained.rowId,
                columnId: retained.columnId,
                field: retained.field,
                baseRow: retained.baseRow,
                expectedVersion: retained.expectedVersion,
                base: retained.base,
                mine: draft.mine,
                ...(draft.validationMessage === undefined
                  ? {}
                  : { validationMessage: draft.validationMessage }),
                ...(draft.conflict === undefined ? {} : { conflict: draft.conflict }),
              }),
        );
      }
      const after = nextDrafts.get(key);
      draftStatusEvidenceChanged ||=
        after?.blockedReason !== undefined ||
        after?.validationMessage !== undefined ||
        after?.conflict !== undefined;
      historyPatchBuilder.set(
        key,
        before === after ? undefined : Object.freeze({ cellKey: key, before, after }),
      );
      if (before === after) {
        unchangedGestureKeys ??= new Set();
        unchangedGestureKeys.add(key);
      }
    }
    const historyPatches = historyPatchBuilder.build();
    if (historyPatches.size === 0) return false;
    if (draftStatusEvidenceChanged) {
      for (const key of historyPatches.keys()) this.syncBlockedDraftKey(key, nextDrafts.get(key));
    }
    const nextUndoStack = this.batchHistoryEnabled
      ? [...this.undoStack, createDraftHistoryCommandFromPatches(historyPatches)].slice(
          -BRUNO_TABLE_BATCH_HISTORY_LIMIT,
        )
      : this.undoStack;
    const nextRedoStack = this.batchHistoryEnabled ? [] : this.redoStack;
    batch(() => {
      this.setDraftMemory(nextDrafts, nextUndoStack, nextRedoStack, historyPatches.keys());
      if (this.draftReviewSubscriberCount > 0) {
        this.publishDraftReview(nextDrafts, new Set(historyPatches.keys()));
      }
      for (const patch of historyPatches.values()) {
        const entry = patch.after ?? patch.before;
        if (entry !== undefined) {
          this.traversalIndex.invalidateCell(entry.rowId, entry.columnId);
        }
        if (this.cellStores.size > 0) this.publishCell(patch.cellKey, nextDrafts);
      }
      this.publishActivitySnapshot();
    });
    this.publishTraversalInvalidation();
    if (this.cellStores.size > 0) {
      for (const key of historyPatches.keys()) this.releaseUnusedCellStore(key);
    }
    return true;
  };

  public readonly undoBatchDraft = (): boolean => {
    if (!this.batchHistoryEnabled || this.getSessionSnapshot().kind === "editing") return false;
    const command = this.undoStack.at(-1);
    if (command === undefined) return false;
    this.applyHistoryCommand(command, "before", this.undoStack.slice(0, -1), [
      ...this.redoStack,
      command,
    ]);
    return true;
  };

  public readonly redoBatchDraft = (): boolean => {
    if (!this.batchHistoryEnabled || this.getSessionSnapshot().kind === "editing") return false;
    const command = this.redoStack.at(-1);
    if (command === undefined) return false;
    this.applyHistoryCommand(
      command,
      "after",
      [...this.undoStack, command],
      this.redoStack.slice(0, -1),
    );
    return true;
  };

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
  ): boolean => {
    return this.traversalIndex.reconcile(columns, rowSpace);
  };

  public readonly buildTraversalSlice = (): boolean => this.traversalIndex.buildNextSlice();

  public readonly isTraversalReady = (): boolean => this.traversalIndex.isReady();

  public readonly reconcileTraversalRows = (
    changedRowIds: ReadonlySet<string> | undefined,
  ): void => {
    if (this.traversalIndex.reconcileRows(changedRowIds)) this.publishTraversalInvalidation();
  };

  public readonly reconcileSourceRows = (changedRowIds: ReadonlySet<string> | undefined): void => {
    if (this.reconcileDraftRows(changedRowIds, false)) this.publishTraversalInvalidation();
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
      const row = this.getRow(session.rowId);
      this.actor.send({
        type: "RECONCILE_ROW",
        row,
        sourceValue: this.readCanonicalSourceValue(session.rowId, row, session.column),
      });
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
    this.canonicalSourceValueCache = new WeakMap();
    this.draftProjectionCache = new WeakMap();
    const nextFieldColumns = indexFieldColumns(columns);
    const previousDrafts = this.draftStore.get();
    const { drafts: nextDrafts, changedKeys } = reconcileDraftsForColumns(
      previousDrafts,
      previousFieldColumns,
      nextFieldColumns,
    );
    const invalidatedHistoryKeys = new Set([
      ...historyKeysInvalidatedByColumns(this.undoStack, previousFieldColumns, nextFieldColumns),
      ...historyKeysInvalidatedByColumns(this.redoStack, previousFieldColumns, nextFieldColumns),
    ]);
    const affectedKeys = new Set([...changedKeys, ...invalidatedHistoryKeys]);
    const nextUndoStack = pruneDraftHistory(this.undoStack, invalidatedHistoryKeys);
    const nextRedoStack = pruneDraftHistory(this.redoStack, invalidatedHistoryKeys);
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
      if (
        nextDrafts !== previousDrafts ||
        nextUndoStack !== this.undoStack ||
        nextRedoStack !== this.redoStack
      ) {
        this.setDraftMemory(nextDrafts, nextUndoStack, nextRedoStack, affectedKeys);
      }
      for (const key of affectedKeys) this.syncBlockedDraftKey(key, nextDrafts.get(key));
      if (affectedKeys.size === 0) return;
      this.publishDraftReview(nextDrafts, affectedKeys);
      this.publishActivitySnapshot();
      for (const key of affectedKeys) {
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

  public readonly resetAllDrafts = (): number => {
    this.cancel();
    const previousDrafts = this.draftStore.get();
    const affectedKeys = [...this.draftEvidenceKeys];
    const nextDrafts = new Map<string, DraftEntry>();
    this.blockedDraftKeys.clear();
    this.validationDraftKeys.clear();
    this.conflictDraftKeys.clear();
    batch(() => {
      this.setDraftMemory(nextDrafts, [], [], affectedKeys);
      this.publishDraftReview(nextDrafts, new Set(affectedKeys));
      this.publishActivitySnapshot();
      for (const key of affectedKeys) {
        this.invalidateDraftCell(key);
        this.publishCell(key, nextDrafts);
      }
    });
    for (const key of affectedKeys) this.releaseUnusedCellStore(key);
    return previousDrafts.size;
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
    const draft = this.draftStore.get().get(cellKey(rowId, column.columnId));
    let value: unknown;
    if (draft === undefined) {
      const sourceValue = this.readCanonicalSourceValue(rowId, row, column);
      if (sourceValue._tag !== "Success") return false;
      value = sourceValue.value;
    } else {
      value = draft.mine;
    }
    if (!isEditorValueRepresentable(column, value)) return false;
    if (typeof column.isEditable !== "function") return true;
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
    let expectedVersion: unknown;
    try {
      expectedVersion =
        typeof row === "object" && row !== null ? this.getRowVersion?.(row) : undefined;
    } catch {
      return false;
    }
    this.actor.send({
      type: "START",
      rowId,
      column,
      row,
      sourceValue: this.readCanonicalSourceValue(rowId, row, column),
      expectedVersion,
      hasDraft: draft !== undefined,
      draftValue: draft?.mine,
      mode,
      producedText,
    });
    this.retainedMovementRowIndex = undefined;
    return this.getSessionSnapshot().kind === "editing";
  };

  private readonly readCanonicalSourceValue = (
    rowId: string,
    row: unknown,
    column: CompiledColumn | undefined,
  ): CanonicalSourceValue => {
    if (column?.kind !== "field" || typeof row !== "object" || row === null) {
      return Object.freeze({ _tag: "Failure" });
    }
    let byAuthority = this.canonicalSourceValueCache.get(row);
    if (byAuthority === undefined) {
      byAuthority = new Map();
      this.canonicalSourceValueCache.set(row, byAuthority);
    }
    const authority = column.semantics.decodeRuntimeAuthority;
    let byField = byAuthority.get(authority);
    if (byField === undefined) {
      byField = new Map();
      byAuthority.set(authority, byField);
    }
    const cached = byField.get(column.field);
    if (cached !== undefined) return cached;
    let result: CanonicalSourceValue | undefined;
    if (this.getCanonicalValue !== undefined) {
      try {
        const canonical = this.getCanonicalValue(rowId, column.columnId);
        result =
          canonical?._tag === "Success" && "value" in canonical
            ? Object.freeze({ _tag: "Success", value: canonical.value })
            : Object.freeze({ _tag: "Failure" });
      } catch {
        result = Object.freeze({ _tag: "Failure" });
      }
    } else {
      let raw: unknown;
      try {
        raw = Reflect.get(row, column.field);
      } catch {
        result = Object.freeze({ _tag: "Failure" });
      }
      if (result === undefined && (raw === null || raw === undefined)) {
        result = Object.freeze({ _tag: "Success", value: raw });
      } else if (result === undefined) {
        const decoded = column.semantics.decodeRuntime(raw);
        result =
          decoded._tag === "Success" && "value" in decoded
            ? Object.freeze({ _tag: "Success", value: decoded.value })
            : Object.freeze({ _tag: "Failure" });
      }
    }
    result ??= Object.freeze({ _tag: "Failure" });
    byField.set(column.field, result);
    return result;
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
    this.setDraftMemory(new Map(), [], [], this.draftEvidenceKeys);
    this.draftReviewStore.setState(() => Object.freeze([]));
    this.draftReviewRowsById.clear();
    this.draftReviewRowStoresById.clear();
    this.draftReviewEntriesById.clear();
    this.draftReviewSubscriberCount = 0;
    this.activityStore.setState(() => IDLE_ACTIVITY);
    this.candidateStore.setState(() => EMPTY_CANDIDATE);
    this.cellStores.clear();
    this.cellSubscriberCounts.clear();
    this.traversalInvalidationListeners.clear();
    this.activeCellKey = undefined;
    this.activeCandidate = undefined;
    this.blockedDraftKeys.clear();
    this.validationDraftKeys.clear();
    this.conflictDraftKeys.clear();
    this.draftKeysByRowId.clear();
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
        : applyDraftPatch(previousDrafts, draftPatch, this.fieldColumnsById);
    if (draftPatch !== undefined) this.appliedDraftPatch = draftPatch;
    if (previousKey !== undefined) affectedKeys.add(previousKey);
    if (nextKey !== undefined) affectedKeys.add(nextKey);
    const historyCommand =
      nextDrafts !== previousDrafts && this.batchHistoryEnabled && draftPatch !== undefined
        ? createDraftHistoryCommand(
            Object.freeze({
              cellKey: draftPatch.cellKey,
              before: previousDrafts.get(draftPatch.cellKey),
              after: nextDrafts.get(draftPatch.cellKey),
            }),
          )
        : undefined;
    const nextUndoStack =
      historyCommand === undefined
        ? this.undoStack
        : [...this.undoStack, historyCommand].slice(-BRUNO_TABLE_BATCH_HISTORY_LIMIT);
    const nextRedoStack = historyCommand === undefined ? this.redoStack : [];
    batch(() => {
      if (nextDrafts !== previousDrafts) {
        this.setDraftMemory(
          nextDrafts,
          nextUndoStack,
          nextRedoStack,
          actorContext.affectedCellKeys,
        );
        if (draftPatch !== undefined) {
          this.syncBlockedDraftKey(draftPatch.cellKey, nextDrafts.get(draftPatch.cellKey));
        }
        for (const key of actorContext.affectedCellKeys) this.invalidateDraftCell(key);
      }
      if (!sameSessionSnapshot(this.sessionStore.get(), next)) {
        this.sessionStore.setState(() => next);
      }
      this.publishDraftReview(nextDrafts, affectedKeys);
      this.publishActivity(
        next.kind === "editing",
        this.hasActiveCandidateWork(next),
        nextDrafts.size,
        this.undoStack.length,
        this.redoStack.length,
      );
      for (const key of affectedKeys) this.publishCell(key, nextDrafts);
    });
    for (const key of affectedKeys) this.releaseUnusedCellStore(key);
  };

  private readonly publishActivity = (
    activeEditor: boolean,
    activeCandidatePending: boolean,
    draftCount: number,
    undoCount = this.undoStack.length,
    redoCount = this.redoStack.length,
    blockedCount = this.blockedDraftKeys.size,
    validationCount = this.validationDraftKeys.size,
    conflictCount = this.conflictDraftKeys.size,
  ): void => {
    const reviewCount =
      draftCount +
      (activeCandidatePending &&
      (this.activeCellKey === undefined || !this.draftStore.get().has(this.activeCellKey))
        ? 1
        : 0);
    const activeCandidateValidationCount =
      activeCandidatePending &&
      this.hasInvalidActiveCandidate() &&
      (this.activeCellKey === undefined || !this.validationDraftKeys.has(this.activeCellKey))
        ? 1
        : 0;
    validationCount += activeCandidateValidationCount;
    const previous = this.activityStore.get();
    if (
      previous.activeEditor === activeEditor &&
      previous.activeCandidatePending === activeCandidatePending &&
      previous.reviewCount === reviewCount &&
      previous.draftCount === draftCount &&
      previous.undoCount === undoCount &&
      previous.redoCount === redoCount &&
      previous.blockedCount === blockedCount &&
      previous.validationCount === validationCount &&
      previous.conflictCount === conflictCount
    )
      return;
    this.activityStore.setState(() =>
      Object.freeze({
        activeEditor,
        activeCandidatePending,
        reviewCount,
        draftCount,
        undoCount,
        redoCount,
        blockedCount,
        validationCount,
        conflictCount,
      }),
    );
  };

  private readonly publishActivitySnapshot = (): void => {
    this.publishActivity(
      this.sessionStore.get().kind === "editing",
      this.hasActiveCandidateWork(this.sessionStore.get()),
      this.draftStore.get().size,
      this.undoStack.length,
      this.redoStack.length,
      this.blockedDraftKeys.size,
      this.validationDraftKeys.size,
      this.conflictDraftKeys.size,
    );
  };

  private readonly applyHistoryCommand = (
    command: DraftHistoryCommand,
    state: "before" | "after",
    nextUndoStack: readonly DraftHistoryCommand[],
    nextRedoStack: readonly DraftHistoryCommand[],
  ): void => {
    const nextDrafts = new Map(this.draftStore.get());
    const prunedKeys = new Set<string>();
    for (const patch of command.patches.values()) {
      const requested = patch[state];
      const { entry, prune } = this.revalidateHistoryEntry(requested);
      if (prune) prunedKeys.add(patch.cellKey);
      if (entry === undefined) nextDrafts.delete(patch.cellKey);
      else nextDrafts.set(patch.cellKey, entry);
      this.syncBlockedDraftKey(patch.cellKey, entry);
    }
    if (prunedKeys.size > 0) {
      nextUndoStack = pruneDraftHistory(nextUndoStack, prunedKeys);
      nextRedoStack = pruneDraftHistory(nextRedoStack, prunedKeys);
    }
    batch(() => {
      this.setDraftMemory(nextDrafts, nextUndoStack, nextRedoStack, command.patches.keys());
      this.publishDraftReview(nextDrafts, new Set(command.patches.keys()));
      for (const patch of command.patches.values()) {
        this.invalidateDraftCell(patch.cellKey, false);
        if (this.cellStores.size > 0) this.publishCell(patch.cellKey, nextDrafts);
      }
      this.publishActivitySnapshot();
    });
    this.publishTraversalInvalidation();
    if (this.cellStores.size > 0) {
      for (const patch of command.patches.values()) this.releaseUnusedCellStore(patch.cellKey);
    }
  };

  private readonly setDraftMemory = (
    drafts: ReadonlyMap<string, DraftEntry>,
    undoStack: readonly DraftHistoryCommand[] = this.undoStack,
    redoStack: readonly DraftHistoryCommand[] = this.redoStack,
    affectedKeys: Iterable<string>,
  ): void => {
    const previous = this.draftMemoryStore.get();
    const next = Object.freeze({
      drafts,
      undoStack: Object.freeze([...undoStack]),
      redoStack: Object.freeze([...redoStack]),
    });
    this.draftMemoryStore.setState(() => next);
    const changedEvidenceKeys = new Set(affectedKeys);
    const previousCommands = new Map(
      [...previous.undoStack, ...previous.redoStack].map((command) => [command.lineage, command]),
    );
    const nextLineages = new Set(
      [...next.undoStack, ...next.redoStack].map((command) => command.lineage),
    );
    for (const [lineage, command] of previousCommands) {
      if (!nextLineages.has(lineage)) {
        for (const key of command.patches.keys()) changedEvidenceKeys.add(key);
      }
    }
    for (const key of changedEvidenceKeys) this.syncDraftEvidenceKey(key, next);
  };

  private readonly revalidateHistoryEntry = (
    entry: DraftEntry | undefined,
  ): Readonly<{ readonly entry: DraftEntry | undefined; readonly prune: boolean }> => {
    if (entry === undefined) return Object.freeze({ entry: undefined, prune: false });
    const row = this.getRow(entry.rowId);
    const column = this.fieldColumnsById.get(entry.columnId);
    if (column === undefined) return Object.freeze({ entry: undefined, prune: true });
    if (typeof row !== "object" || row === null) {
      return Object.freeze({
        entry: setDraftBlockedReason(entry, BRUNO_TABLE_CELL_EDIT_ROW_MISSING_MESSAGE),
        prune: false,
      });
    }
    const source = this.readCanonicalSourceValue(entry.rowId, row, column);
    if (
      source._tag === "Success" &&
      safeEquivalentEditValue(column, entry.mine, source.value) === true
    ) {
      return Object.freeze({ entry: undefined, prune: true });
    }
    const blockedReason =
      source._tag !== "Success" || !isDraftEditable(column, row, entry.mine)
        ? BRUNO_TABLE_CELL_EDIT_PERMISSION_MESSAGE
        : undefined;
    return Object.freeze({ entry: setDraftBlockedReason(entry, blockedReason), prune: false });
  };

  private readonly publishDraftReview = (
    drafts: ReadonlyMap<string, DraftEntry>,
    changedKeys?: ReadonlySet<string>,
    serverRows?: ReadonlyMap<string, unknown>,
  ): void => {
    if (this.draftReviewSubscriberCount === 0) return;
    const activeKey = this.hasActiveCandidateWork() ? this.activeCellKey : undefined;
    const keys =
      changedKeys ??
      new Set([
        ...drafts.keys(),
        ...this.draftReviewRowsById.keys(),
        ...(activeKey === undefined ? [] : [activeKey]),
      ]);
    let membershipChanged = false;
    for (const id of keys) {
      const draft = drafts.get(id);
      const activeRow =
        activeKey === id ? this.createActiveCandidateReviewRow(id, draft) : undefined;
      if (draft === undefined && activeRow === undefined) {
        if (this.draftReviewRowsById.delete(id)) membershipChanged = true;
        this.draftReviewRowStoresById.delete(id);
        this.draftReviewEntriesById.delete(id);
        continue;
      }
      const previousSource = this.draftReviewRowsById.get(id);
      const previousStore = this.draftReviewRowStoresById.get(id);
      const previousRow = previousStore?.get();
      const nextRow =
        activeRow ??
        (draft === undefined
          ? undefined
          : this.createDraftReviewRow(
              id,
              draft,
              serverRows?.has(id) === true ? serverRows.get(id) : this.getRow(draft.rowId),
            ));
      if (nextRow === undefined) {
        if (this.draftReviewRowsById.delete(id)) membershipChanged = true;
        this.draftReviewRowStoresById.delete(id);
        this.draftReviewEntriesById.delete(id);
        continue;
      }
      if (
        previousRow !== undefined &&
        activeRow === undefined &&
        this.draftReviewEntriesById.get(id) === draft &&
        previousRow.serverRow === nextRow.serverRow &&
        previousRow.column === nextRow.column
      ) {
        continue;
      }
      if (
        previousSource === undefined ||
        previousStore === undefined ||
        previousSource.rowId !== nextRow.rowId ||
        previousSource.columnLabel !== nextRow.columnLabel
      ) {
        const store = new Store(nextRow);
        const source: BrunoTableCellEditDraftReviewSourceRow = Object.freeze({
          kind: "bruno-table-cell-edit-draft-review-source",
          id,
          rowId: nextRow.rowId,
          columnLabel: nextRow.columnLabel,
          serverText: "",
          mineText: "",
          statusText: "",
          getSnapshot: () => store.get(),
          subscribe: (listener) => {
            const subscription = store.subscribe(listener);
            return () => subscription.unsubscribe();
          },
        });
        brunoTableCellEditDraftReviewSources.add(source);
        this.draftReviewRowsById.set(id, source);
        this.draftReviewRowStoresById.set(id, store);
        membershipChanged = true;
      } else {
        previousStore.setState(() => nextRow);
      }
      if (draft === undefined) this.draftReviewEntriesById.delete(id);
      else this.draftReviewEntriesById.set(id, draft);
    }
    if (!membershipChanged) return;
    const rows = Object.freeze(
      [
        ...drafts.keys(),
        ...(activeKey === undefined || drafts.has(activeKey) ? [] : [activeKey]),
      ].flatMap((id) => {
        const row = this.draftReviewRowsById.get(id);
        return row === undefined ? [] : [row];
      }),
    );
    this.draftReviewStore.setState(() => rows);
  };

  private readonly createDraftReviewRow = (
    id: string,
    draft: DraftEntry,
    serverCandidate = this.getRow(draft.rowId),
  ): BrunoTableCellEditDraftReviewRow | undefined => {
    const serverRow =
      typeof serverCandidate === "object" && serverCandidate !== null ? serverCandidate : undefined;
    const column = this.fieldColumnsById.get(draft.columnId);
    if (column === undefined) return undefined;
    this.draftReviewVersion += 1;
    const reviewVersion = this.draftReviewVersion;
    const canonical = this.readCanonicalSourceValue(draft.rowId, serverRow, column);
    const projectedSource = serverRow ?? draft.baseRow;
    const projectedRow = Object.freeze(
      Object.create(Object.getPrototypeOf(projectedSource), {
        ...Object.getOwnPropertyDescriptors(projectedSource),
        [draft.field]: {
          configurable: true,
          enumerable: true,
          value: draft.mine,
          writable: true,
        },
      }) as object,
    );
    const reviewRow: BrunoTableCellEditDraftReviewRow = Object.freeze({
      id,
      reviewVersion,
      rowId: draft.rowId,
      columnId: draft.columnId,
      field: draft.field,
      baseRow: draft.baseRow,
      expectedVersion: draft.expectedVersion,
      base: draft.base,
      mine: draft.mine,
      ...(draft.validationMessage === undefined
        ? {}
        : { validationMessage: draft.validationMessage }),
      ...(draft.conflict === undefined ? {} : { conflict: draft.conflict }),
      headerName: column.headerName,
      columnLabel: column.headerName,
      serverText: "",
      mineText: "",
      status:
        draft.blockedReason ??
        draft.validationMessage ??
        (draft.conflict === undefined ? "Draft" : "Conflict"),
      column,
      serverRow,
      projectedRow,
      serverNow: canonical._tag === "Success" ? canonical.value : undefined,
      blockedReason: draft.blockedReason,
    });
    return reviewRow;
  };

  private readonly createActiveCandidateReviewRow = (
    id: string,
    draft: DraftEntry | undefined,
  ): BrunoTableCellEditDraftReviewRow | undefined => {
    const session = this.actor.getSnapshot().context.session;
    if (
      session === undefined ||
      !this.hasActiveCandidateWork() ||
      cellKey(session.rowId, session.column.columnId) !== id
    ) {
      return undefined;
    }
    const candidate = this.candidateStore.get();
    const evaluation = evaluateCandidate(
      session,
      candidate.rawText,
      candidate.nativeInvalid,
      candidate.kind === "blank" ? "blank" : "scalar",
    );
    const candidateInvalid = evaluation.kind === "invalid";
    const activeDraft: DraftEntry = Object.freeze({
      rowId: session.rowId,
      columnId: session.column.columnId,
      field: session.column.field,
      baseRow: draft?.baseRow ?? session.baseRow,
      expectedVersion: draft?.expectedVersion ?? session.expectedVersion,
      base: draft?.base ?? session.baseValue,
      mine: evaluation.kind === "accepted" ? evaluation.value : (draft?.mine ?? session.before),
      ...(draft?.blockedReason === undefined ? {} : { blockedReason: draft.blockedReason }),
    });
    const row = this.createDraftReviewRow(id, activeDraft);
    if (row === undefined) return undefined;
    return Object.freeze({
      ...row,
      status:
        evaluation.kind === "invalid"
          ? evaluation.message
          : (session.invalidMessage ?? "Active candidate"),
      ...(candidateInvalid ? { candidateText: candidate.rawText, candidateInvalid: true } : {}),
    });
  };

  private readonly reconcileDraftRows = (
    changedRowIds: ReadonlySet<string> | undefined,
    publishTraversalInvalidation: boolean,
  ): boolean => {
    const previousDrafts = this.draftStore.get();
    let nextDrafts: Map<string, DraftEntry> | undefined;
    let nextUndoStack = this.undoStack;
    let nextRedoStack = this.redoStack;
    const convergedKeys: string[] = [];
    const changedKeys: string[] = [];
    const reviewChangedKeys = new Set<string>();
    const reviewServerRows = new Map<string, unknown>();
    const keys =
      changedRowIds === undefined
        ? this.draftEvidenceKeys.values()
        : (function* (
            byRowId: ReadonlyMap<string, string | ReadonlySet<string>>,
            rowIds: ReadonlySet<string>,
          ): Generator<string> {
            for (const rowId of rowIds) {
              const rowKeys = byRowId.get(rowId);
              if (rowKeys === undefined) continue;
              if (typeof rowKeys === "string") yield rowKeys;
              else yield* rowKeys;
            }
          })(this.draftKeysByRowId, changedRowIds);
    for (const key of keys) {
      const draft = previousDrafts.get(key);
      const representative = draft ?? findDraftHistoryEntry(nextUndoStack, nextRedoStack, key);
      if (representative === undefined) continue;
      const row = this.getRow(representative.rowId);
      reviewServerRows.set(key, row);
      if (this.draftReviewRowStoresById.get(key)?.get().serverRow !== row) {
        reviewChangedKeys.add(key);
      }
      const column = this.fieldColumnsById.get(representative.columnId);
      let blockedReason: string | undefined;
      if (typeof row !== "object" || row === null) {
        blockedReason = BRUNO_TABLE_CELL_EDIT_ROW_MISSING_MESSAGE;
      } else if (column === undefined) {
        blockedReason = BRUNO_TABLE_CELL_EDIT_PERMISSION_MESSAGE;
      } else {
        const source = this.readCanonicalSourceValue(representative.rowId, row, column);
        if (
          source._tag === "Success" &&
          ((draft !== undefined &&
            safeEquivalentEditValue(column, draft.mine, source.value) === true) ||
            (draft === undefined &&
              redoHistoryMineConverged(nextRedoStack, key, column, source.value)))
        ) {
          nextDrafts ??= new Map(previousDrafts);
          nextDrafts.delete(key);
          convergedKeys.push(key);
          changedKeys.push(key);
          continue;
        }
        if (source._tag !== "Success" || !isDraftEditable(column, row, representative.mine)) {
          blockedReason = BRUNO_TABLE_CELL_EDIT_PERMISSION_MESSAGE;
        }
      }
      const nextDraft = setDraftBlockedReason(draft, blockedReason);
      const transformedUndo = transformDraftHistoryCell(nextUndoStack, key, (entry) =>
        setDraftBlockedReason(entry, blockedReason),
      );
      const transformedRedo = transformDraftHistoryCell(nextRedoStack, key, (entry) =>
        setDraftBlockedReason(entry, blockedReason),
      );
      if (nextDraft !== draft) {
        nextDrafts ??= new Map(previousDrafts);
        if (nextDraft === undefined) nextDrafts.delete(key);
        else nextDrafts.set(key, nextDraft);
      }
      if (
        nextDraft !== draft ||
        transformedUndo !== nextUndoStack ||
        transformedRedo !== nextRedoStack
      ) {
        nextUndoStack = transformedUndo;
        nextRedoStack = transformedRedo;
        changedKeys.push(key);
      }
    }
    if (
      nextDrafts === undefined &&
      nextUndoStack === this.undoStack &&
      nextRedoStack === this.redoStack
    ) {
      if (reviewChangedKeys.size > 0) {
        this.publishDraftReview(previousDrafts, reviewChangedKeys, reviewServerRows);
      }
      return false;
    }
    nextDrafts ??= new Map(previousDrafts);
    const converged = new Set(convergedKeys);
    const finalUndoStack = pruneDraftHistory(nextUndoStack, converged);
    const finalRedoStack = pruneDraftHistory(nextRedoStack, converged);
    for (const key of changedKeys) this.syncBlockedDraftKey(key, nextDrafts.get(key));
    batch(() => {
      this.setDraftMemory(nextDrafts, finalUndoStack, finalRedoStack, changedKeys);
      this.publishDraftReview(
        nextDrafts,
        new Set([...changedKeys, ...reviewChangedKeys]),
        reviewServerRows,
      );
      for (const key of changedKeys) {
        this.invalidateDraftCell(key, false);
        this.publishCell(key, nextDrafts);
      }
      this.publishActivitySnapshot();
    });
    if (publishTraversalInvalidation) this.publishTraversalInvalidation();
    for (const key of changedKeys) this.releaseUnusedCellStore(key);
    return changedKeys.length > 0;
  };

  private readonly syncBlockedDraftKey = (key: string, draft: DraftEntry | undefined): void => {
    if (draft?.blockedReason === undefined) {
      if (this.blockedDraftKeys.size > 0) this.blockedDraftKeys.delete(key);
    } else this.blockedDraftKeys.add(key);
    if (draft?.validationMessage === undefined) {
      if (this.validationDraftKeys.size > 0) this.validationDraftKeys.delete(key);
    } else this.validationDraftKeys.add(key);
    if (draft?.conflict === undefined) {
      if (this.conflictDraftKeys.size > 0) this.conflictDraftKeys.delete(key);
    } else this.conflictDraftKeys.add(key);
  };

  private readonly syncDraftEvidenceKey = (key: string, memory: DraftMemoryState): void => {
    const draft = memory.drafts.get(key);
    const retained =
      draft !== undefined ||
      memory.undoStack.some((command) => command.patches.has(key)) ||
      memory.redoStack.some((command) => command.patches.has(key));
    const wasRetained = this.draftEvidenceKeys.has(key);
    if (retained === wasRetained) return;
    const rowId = draft?.rowId ?? parseCellKey(key)?.rowId;
    if (rowId === undefined) return;
    if (retained) {
      this.draftEvidenceKeys.add(key);
      const rowKeys = this.draftKeysByRowId.get(rowId);
      if (rowKeys === undefined) this.draftKeysByRowId.set(rowId, key);
      else if (typeof rowKeys === "string") {
        if (rowKeys !== key) this.draftKeysByRowId.set(rowId, new Set([rowKeys, key]));
      } else rowKeys.add(key);
      return;
    }
    this.draftEvidenceKeys.delete(key);
    const rowKeys = this.draftKeysByRowId.get(rowId);
    if (typeof rowKeys === "string") {
      if (rowKeys === key) this.draftKeysByRowId.delete(rowId);
      return;
    }
    rowKeys?.delete(key);
    if (rowKeys?.size === 0) this.draftKeysByRowId.delete(rowId);
    else if (rowKeys?.size === 1) {
      const remaining = rowKeys.values().next().value;
      if (remaining !== undefined) this.draftKeysByRowId.set(rowId, remaining);
    }
  };

  private readonly getCellProjection = (key: string): BrunoTableCellEditProjection => {
    const store = this.cellStores.get(key);
    if (store !== undefined) return store.get();
    const draft = this.draftStore.get().get(key);
    return draft === undefined ? IDLE_CELL : this.getDraftProjection(draft);
  };

  private readonly createCellProjection = (
    key: string,
    drafts = this.draftStore.get(),
  ): BrunoTableCellEditProjection => {
    const draft = drafts.get(key);
    if (this.activeCellKey !== key)
      return draft === undefined ? IDLE_CELL : this.getDraftProjection(draft);
    return Object.freeze({
      active: true,
      hasDraft: draft !== undefined,
      ...(draft === undefined ? {} : { draft: draft.mine }),
    });
  };

  private readonly getDraftProjection = (draft: DraftEntry): BrunoTableCellEditProjection => {
    const cached = this.draftProjectionCache.get(draft);
    if (cached !== undefined) return cached;
    const projection = Object.freeze({ active: false, hasDraft: true, draft: draft.mine });
    this.draftProjectionCache.set(draft, projection);
    return projection;
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

  private readonly invalidateDraftCell = (key: string, publish = true): void => {
    const identity = parseCellKey(key);
    if (identity !== undefined) {
      this.traversalIndex.invalidateCell(identity.rowId, identity.columnId);
      if (publish) this.publishTraversalInvalidation();
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
      previousColumn?.blankValue !== undefined &&
      Object.is(draft.mine, previousColumn.blankValue.value)
    ) {
      if (
        nextColumn.blankValue !== undefined &&
        Object.is(previousColumn.blankValue.value, nextColumn.blankValue.value)
      ) {
        continue;
      }
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
    const decodedBase = nextColumn.semantics.decodeRuntime(draft.base);
    const decodedMine = nextColumn.semantics.decodeRuntime(draft.mine);
    if (decodedBase._tag === "Failure" || decodedMine._tag === "Failure") {
      nextDrafts ??= new Map(drafts);
      nextDrafts.delete(key);
      changedKeys.push(key);
      continue;
    }
    if (Object.is(decodedBase.value, draft.base) && Object.is(decodedMine.value, draft.mine))
      continue;
    nextDrafts ??= new Map(drafts);
    nextDrafts.set(
      key,
      Object.freeze({
        ...draft,
        base: decodedBase.value,
        mine: decodedMine.value,
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
