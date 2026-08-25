import { Store } from "@tanstack/store";
import { assign, createActor, createMachine } from "xstate";

import type { CompiledColumn, CompiledFieldColumn } from "./compile-columns";

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
  readonly invalidMessage?: string;
}>;

type CellEditContext = Readonly<{ readonly session: ActiveSession | undefined }>;
type CellEditEvent =
  | Readonly<{ readonly type: "START"; readonly session: ActiveSession }>
  | Readonly<{ readonly type: "INVALID"; readonly message: string }>
  | Readonly<{ readonly type: "COMMIT" }>
  | Readonly<{ readonly type: "CANCEL" }>;

const brunoTableCellEditMachine = createMachine({
  id: "brunoTableCellEditSession",
  initial: "idle",
  types: {} as { context: CellEditContext; events: CellEditEvent },
  context: { session: undefined },
  states: {
    idle: {
      on: {
        START: {
          target: "editing",
          actions: assign({ session: ({ event }) => event.session }),
        },
      },
    },
    editing: {
      on: {
        INVALID: {
          actions: assign({
            session: ({ context, event }) =>
              context.session === undefined
                ? undefined
                : Object.freeze({ ...context.session, invalidMessage: event.message }),
          }),
        },
        COMMIT: { target: "idle", actions: assign({ session: undefined }) },
        CANCEL: { target: "idle", actions: assign({ session: undefined }) },
      },
    },
  },
});

export type BrunoTableCellEditSessionSnapshot =
  | Readonly<{ readonly kind: "idle" }>
  | Readonly<{
      readonly kind: "editing";
      readonly rowId: string;
      readonly columnId: string;
      readonly initialText: string;
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

export class BrunoTableCellEditRuntime {
  private columns: readonly CompiledColumn[];
  private readonly getRow: (rowId: string) => unknown;
  private readonly onCommit: (change: BrunoTableCellEditChange) => void;
  private readonly actor = createActor(brunoTableCellEditMachine);
  private readonly sessionStore = new Store<BrunoTableCellEditSessionSnapshot>(IDLE_SESSION);
  private readonly drafts = new Map<string, unknown>();
  private readonly cellStores = new Map<string, Store<BrunoTableCellEditProjection>>();
  private readonly cellSubscriberCounts = new Map<string, number>();
  private activeCellKey: string | undefined;
  private activeCandidate:
    | Readonly<{ readonly read: () => string; readonly restoreFocus: () => void }>
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
    this.getRow = options.getRow;
    this.onCommit = options.onCommit ?? (() => undefined);
    this.actor.subscribe(() => this.publishSession());
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
  ): BrunoTableCellEditProjection => {
    const key = cellKey(rowId, columnId);
    return (this.cellStores.get(key) ?? this.installCellStore(key)).get();
  };

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
    this.drafts.get(cellKey(rowId, columnId));

  public readonly registerActiveCandidate = (
    candidate: Readonly<{ readonly read: () => string; readonly restoreFocus: () => void }>,
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

  public readonly reconcileColumns = (columns: readonly CompiledColumn[]): void => {
    if (this.columns === columns) return;
    this.cancel();
    this.columns = columns;
  };

  public readonly commitActiveCandidate = (): boolean => {
    const candidate = this.activeCandidate;
    if (candidate === undefined) return this.getSessionSnapshot().kind === "idle";
    const accepted = this.commit(candidate.read());
    if (!accepted) candidate.restoreFocus();
    return accepted;
  };

  public readonly isEditable = (rowId: string, columnId: string): boolean => {
    const column = this.columns.find(
      (candidate): candidate is CompiledFieldColumn =>
        candidate.kind === "field" && candidate.columnId === columnId,
    );
    if (column === undefined || column.isEditable === undefined || column.isEditable === false) {
      return false;
    }
    const row = this.getRow(rowId);
    if (typeof row !== "object" || row === null) return false;
    if (typeof column.isEditable !== "function") return true;
    const key = cellKey(rowId, columnId);
    const value = this.drafts.has(key) ? this.drafts.get(key) : Reflect.get(row, column.field);
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
    const column = this.columns.find(
      (candidate): candidate is CompiledFieldColumn =>
        candidate.kind === "field" && candidate.columnId === columnId,
    );
    if (!this.isEditable(rowId, columnId) || column === undefined) return false;
    const row = this.getRow(rowId);
    if (typeof row !== "object" || row === null) return false;
    const sourceValue = Reflect.get(row, column.field);
    const key = cellKey(rowId, columnId);
    const before = this.drafts.has(key) ? this.drafts.get(key) : sourceValue;
    let initialText: string;
    try {
      initialText =
        mode === "replace" ? producedText : column.semantics.formatCanonicalText(before);
    } catch {
      return false;
    }
    this.actor.send({
      type: "START",
      session: Object.freeze({ rowId, column, row, before, initialText }),
    });
    return this.getSessionSnapshot().kind === "editing";
  };

  public readonly commit = (rawText: string): boolean => {
    const actorSnapshot = this.actor.getSnapshot();
    const session = actorSnapshot.context.session;
    if (actorSnapshot.value !== "editing" || session === undefined) return false;
    const parsed = session.column.semantics.parseCanonicalText(rawText);
    if (parsed._tag === "Failure") {
      this.actor.send({ type: "INVALID", message: boundedMessage(parsed.message) });
      return false;
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
        this.actor.send({
          type: "INVALID",
          message:
            typeof result === "string" && result.trim().length > 0
              ? boundedMessage(result)
              : "The value is invalid.",
        });
        return false;
      }
    }
    const key = cellKey(session.rowId, session.column.columnId);
    const sourceValue = Reflect.get(session.row, session.column.field);
    if (session.column.semantics.equivalent(after, sourceValue)) this.drafts.delete(key);
    else this.drafts.set(key, after);
    const changed = !session.column.semantics.equivalent(session.before, after);
    this.actor.send({ type: "COMMIT" });
    this.publishCell(key);
    if (changed) {
      this.onCommit(
        Object.freeze({
          rowId: session.rowId,
          columnId: session.column.columnId,
          field: session.column.field,
          before: session.before,
          after,
        }),
      );
    }
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

  private readonly publishSession = (): void => {
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
            ...(session.invalidMessage === undefined
              ? {}
              : { invalidMessage: session.invalidMessage }),
          });
    const nextKey = next.kind === "editing" ? cellKey(next.rowId, next.columnId) : undefined;
    this.activeCellKey = nextKey;
    if (!sameSessionSnapshot(this.sessionStore.get(), next)) {
      this.sessionStore.setState(() => next);
    }
    if (previousKey !== undefined) this.publishCell(previousKey);
    if (nextKey !== undefined && nextKey !== previousKey) this.publishCell(nextKey);
  };

  private readonly createCellProjection = (key: string): BrunoTableCellEditProjection => {
    const draft = this.drafts.get(key);
    return Object.freeze({
      active: this.activeCellKey === key,
      hasDraft: draft !== undefined || this.drafts.has(key),
      ...(draft === undefined && !this.drafts.has(key) ? {} : { draft }),
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
    if (previous.active === next.active && Object.is(previous.draft, next.draft)) return;
    store.setState(() => next);
  };
}

function cellKey(rowId: string, columnId: string): string {
  return `${rowId.length}:${rowId}${columnId}`;
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
    previous.invalidMessage === next.invalidMessage
  );
}
