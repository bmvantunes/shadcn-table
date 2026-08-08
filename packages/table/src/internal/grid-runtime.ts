import type {
  BrunoTableClientSource,
  BrunoTableRowId,
  BrunoTableSourceRetry,
  BrunoTableSourceStatus,
} from "../public-types";
import type { CompiledColumn } from "./compile-columns";
import type { ClientOrderBy } from "./client-row-model";
import {
  filterReferencesColumn,
  reconcileClientOrderBy,
  sanitizeClientOrderBy,
  sanitizeClientInitialFilters,
  sanitizeClientInitialOrderBy,
} from "./client-row-model";

type Listener = () => void;
export type BrunoTableRowOrderChangeDetector = (
  previousRows: readonly unknown[],
  nextRows: readonly unknown[],
  previousRowIds: readonly BrunoTableRowId[],
  nextRowIds: readonly BrunoTableRowId[],
) => boolean;

export type BrunoTableClientChromeSnapshot = Readonly<{
  readonly status: BrunoTableSourceStatus;
  readonly totalRows: number;
  readonly statusCode?: string;
  readonly message?: string;
  readonly retry?: BrunoTableSourceRetry;
  readonly hasCoherentRows: boolean;
  readonly incomplete: boolean;
  readonly receivedRows: number;
}>;

export type BrunoTableClientBodySnapshot<TRow> = Readonly<
  | {
      readonly kind: "loading";
      readonly skeletonCount: number;
    }
  | {
      readonly kind: "invalid";
      readonly rows: readonly [];
    }
  | {
      readonly kind: "empty";
      readonly rows: readonly [];
      readonly emptyTitle: string;
      readonly emptyDescription?: string;
      readonly retry?: BrunoTableSourceRetry;
      readonly destructive?: boolean;
    }
  | {
      readonly kind: "rows";
      readonly rows: readonly TRow[];
      readonly rowIds: readonly BrunoTableRowId[];
    }
>;

export type BrunoTableClientRuntimeView = {
  readonly getChromeSnapshot: () => BrunoTableClientChromeSnapshot;
  readonly getBodySnapshot: () => BrunoTableClientBodySnapshot<unknown>;
  readonly getRowsSnapshot: () => readonly unknown[];
  readonly getRowSnapshot: (rowId: BrunoTableRowId) => unknown;
  readonly getQuerySnapshot: () => BrunoTableClientQuerySnapshot;
  readonly getColumnCommandSnapshot: (columnId: string) => BrunoTableColumnCommandSnapshot;
  readonly subscribeChrome: (listener: Listener) => () => void;
  readonly subscribeBody: (listener: Listener) => () => void;
  readonly subscribeRows: (
    listener: Listener,
    detector?: BrunoTableRowOrderChangeDetector,
  ) => () => void;
  readonly subscribeRow: (rowId: BrunoTableRowId, listener: Listener) => () => void;
  readonly subscribeQuery: (listener: Listener) => () => void;
  readonly subscribeColumnCommands: (columnId: string, listener: Listener) => () => void;
  readonly resolveRowId: (row: unknown) => BrunoTableRowId;
  readonly toggleColumnSort: (columnId: string, multi: boolean) => void;
  readonly clearColumnFilters: (columnId: string) => void;
  readonly resetColumnFilters: (columnId: string) => void;
  readonly retry: () => void;
};

export type BrunoTableClientQuerySnapshot = Readonly<{
  readonly filters: readonly unknown[];
  readonly orderBy: ClientOrderBy;
  readonly generation: number;
}>;

export type BrunoTableColumnCommandSnapshot = Readonly<{
  readonly sortable: boolean;
  readonly sortDirection?: "asc" | "desc";
  readonly sortPriority?: number;
  readonly filterActive: boolean;
  readonly filterBaselineAvailable: boolean;
}>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);
const EMPTY_COLUMN_COMMAND: BrunoTableColumnCommandSnapshot = Object.freeze({
  sortable: false,
  filterActive: false,
  filterBaselineAvailable: false,
});

type CoherentRows<TRow> = Readonly<{
  readonly rows: readonly TRow[];
  readonly rowIds: readonly BrunoTableRowId[];
  readonly rowsById: Readonly<{
    readonly get: (rowId: BrunoTableRowId) => TRow | undefined;
    readonly depth: number;
  }>;
}>;

type RuntimeState<TRow> = Readonly<{
  readonly chrome: BrunoTableClientChromeSnapshot;
  readonly body: BrunoTableClientBodySnapshot<TRow>;
  readonly coherent: CoherentRows<TRow> | undefined;
}>;

export class BrunoTableClientRuntime<TRow> {
  private readonly chromeListeners = new Set<Listener>();
  private readonly bodyListeners = new Set<Listener>();
  private readonly rowsListeners = new Set<{
    readonly listener: Listener;
    readonly detector?: BrunoTableRowOrderChangeDetector;
  }>();
  private readonly rowListeners = new Map<BrunoTableRowId, Set<Listener>>();
  private readonly queryListeners = new Set<Listener>();
  private readonly columnCommandListeners = new Map<string, Set<Listener>>();
  private view: BrunoTableClientRuntimeView | undefined;
  private state: RuntimeState<TRow>;
  private getRowId: (row: TRow) => BrunoTableRowId;
  private source: BrunoTableClientSource<TRow>;
  private columns: readonly CompiledColumn[];
  private readonly initialFilters: readonly unknown[];
  private readonly initialOrderBy: ClientOrderBy;
  private baselineFilters: readonly unknown[];
  private baselineOrderBy: ClientOrderBy;
  private query: BrunoTableClientQuerySnapshot;
  private columnCommands = new Map<string, BrunoTableColumnCommandSnapshot>();

  public constructor(
    source: BrunoTableClientSource<TRow>,
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
    initialFilters: readonly unknown[] | undefined,
    initialOrderBy: ClientOrderBy | undefined,
  ) {
    this.getRowId = getRowId;
    this.columns = columns;
    this.initialFilters = sanitizeClientInitialFilters(initialFilters, columns);
    this.initialOrderBy = sanitizeClientInitialOrderBy(initialOrderBy, columns);
    this.baselineFilters = this.initialFilters;
    this.baselineOrderBy = this.initialOrderBy;
    this.query = Object.freeze({
      filters: this.baselineFilters,
      orderBy: this.baselineOrderBy,
      generation: 0,
    });
    this.columnCommands = createColumnCommandSnapshots(columns, this.query, this.baselineFilters);
    this.source = snapshotSource(source);
    this.state = this.createState(this.source, undefined);
  }

  public readonly getView = (): BrunoTableClientRuntimeView => {
    if (this.view === undefined) {
      this.view = Object.freeze({
        getChromeSnapshot: this.getChromeSnapshot,
        getBodySnapshot: () => this.getBodySnapshot() as BrunoTableClientBodySnapshot<unknown>,
        getRowsSnapshot: () => this.state.coherent?.rows ?? EMPTY_ROWS,
        getRowSnapshot: this.getRowSnapshot,
        getQuerySnapshot: this.getQuerySnapshot,
        getColumnCommandSnapshot: this.getColumnCommandSnapshot,
        subscribeChrome: this.subscribeChrome,
        subscribeBody: this.subscribeBody,
        subscribeRows: this.subscribeRows,
        subscribeRow: this.subscribeRow,
        subscribeQuery: this.subscribeQuery,
        subscribeColumnCommands: this.subscribeColumnCommands,
        resolveRowId: this.resolveRowId,
        toggleColumnSort: this.toggleColumnSort,
        clearColumnFilters: this.clearColumnFilters,
        resetColumnFilters: this.resetColumnFilters,
        retry: this.retry,
      });
    }
    return this.view;
  };

  public readonly publish = (source: BrunoTableClientSource<TRow>): void => {
    const previous = this.state;
    this.source = snapshotSource(source);
    const next = this.createState(this.source, previous.coherent);
    const chromeChanged = !sameChrome(previous.chrome, next.chrome);
    const bodyChanged = !sameBody(previous.body, next.body);
    this.state = Object.freeze({
      chrome: chromeChanged ? next.chrome : previous.chrome,
      body: bodyChanged ? next.body : previous.body,
      coherent: next.coherent,
    });

    if (chromeChanged) {
      notify(this.chromeListeners);
    }
    if (bodyChanged) {
      notify(this.bodyListeners);
    }
    this.notifyRows(previous.coherent, next.coherent);
    this.notifyChangedRows(previous.coherent, next.coherent);
  };

  public readonly configure = (
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
  ): void => {
    if (this.columns !== columns) this.configureColumns(columns);
    if (this.getRowId === getRowId) return;
    const previous = this.state;
    this.getRowId = getRowId;
    const next = this.createState(this.source, previous.coherent, true);
    const chromeChanged = !sameChrome(previous.chrome, next.chrome);
    const bodyChanged = !sameBody(previous.body, next.body);
    this.state = Object.freeze({
      chrome: chromeChanged ? next.chrome : previous.chrome,
      body: bodyChanged ? next.body : previous.body,
      coherent: next.coherent,
    });
    if (chromeChanged) notify(this.chromeListeners);
    if (bodyChanged) notify(this.bodyListeners);
    this.notifyRows(previous.coherent, next.coherent);
    this.notifyChangedRows(previous.coherent, next.coherent);
  };

  public readonly getChromeSnapshot = (): BrunoTableClientChromeSnapshot => this.state.chrome;

  public readonly getBodySnapshot = (): BrunoTableClientBodySnapshot<TRow> => this.state.body;

  public readonly getRowSnapshot = (rowId: BrunoTableRowId): TRow | undefined =>
    this.state.coherent?.rowsById.get(rowId);

  public readonly getQuerySnapshot = (): BrunoTableClientQuerySnapshot => this.query;

  public readonly getColumnCommandSnapshot = (columnId: string): BrunoTableColumnCommandSnapshot =>
    this.columnCommands.get(columnId) ?? EMPTY_COLUMN_COMMAND;

  public readonly resolveRowId = (row: unknown): BrunoTableRowId => this.getRowId(row as TRow);

  public readonly subscribeChrome = (listener: Listener): (() => void) =>
    subscribe(this.chromeListeners, listener);

  public readonly subscribeBody = (listener: Listener): (() => void) =>
    subscribe(this.bodyListeners, listener);

  public readonly subscribeRows = (
    listener: Listener,
    detector?: BrunoTableRowOrderChangeDetector,
  ): (() => void) => {
    const entry = { listener, ...(detector === undefined ? {} : { detector }) };
    this.rowsListeners.add(entry);
    return () => this.rowsListeners.delete(entry);
  };

  public readonly subscribeRow = (rowId: BrunoTableRowId, listener: Listener): (() => void) => {
    let listeners = this.rowListeners.get(rowId);
    if (listeners === undefined) {
      listeners = new Set<Listener>();
      this.rowListeners.set(rowId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.rowListeners.delete(rowId);
    };
  };

  public readonly subscribeQuery = (listener: Listener): (() => void) =>
    subscribe(this.queryListeners, listener);

  public readonly subscribeColumnCommands = (
    columnId: string,
    listener: Listener,
  ): (() => void) => {
    let listeners = this.columnCommandListeners.get(columnId);
    if (listeners === undefined) {
      listeners = new Set<Listener>();
      this.columnCommandListeners.set(columnId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.columnCommandListeners.delete(columnId);
    };
  };

  public readonly toggleColumnSort = (columnId: string, multi: boolean): void => {
    if (
      !this.columns.some((column) => column.columnId === columnId && column.enableSorting !== false)
    ) {
      return;
    }
    const currentIndex = this.query.orderBy.findIndex((sort) => sort.columnId === columnId);
    const current = this.query.orderBy[currentIndex];
    const nextDirection: "asc" | "desc" = current?.direction === "asc" ? "desc" : "asc";
    const nextOrderBy = multi
      ? current === undefined
        ? [...this.query.orderBy, { columnId, direction: "asc" as const }]
        : this.query.orderBy.map((sort, index) =>
            index === currentIndex ? { columnId, direction: nextDirection } : sort,
          )
      : [{ columnId, direction: nextDirection }];
    this.publishQuery(this.query.filters, sanitizeClientOrderBy(nextOrderBy, this.columns));
  };

  public readonly clearColumnFilters = (columnId: string): void => {
    const next = this.query.filters.filter((filter) => !filterReferencesColumn(filter, columnId));
    if (next.length === this.query.filters.length) return;
    this.publishQuery(Object.freeze(next), this.query.orderBy);
  };

  public readonly resetColumnFilters = (columnId: string): void => {
    const withoutColumn = this.query.filters.filter(
      (filter) => !filterReferencesColumn(filter, columnId),
    );
    const baseline = this.baselineFilters.filter((filter) =>
      filterReferencesColumn(filter, columnId),
    );
    this.publishQuery(Object.freeze([...withoutColumn, ...baseline]), this.query.orderBy);
  };

  public readonly retry = (): void => {
    const retry = this.state.chrome.retry;
    if (retry !== undefined && !retry.pending) retry.run();
  };

  private createState(
    source: BrunoTableClientSource<TRow>,
    previousCoherent: CoherentRows<TRow> | undefined,
    resolveRowIds = false,
  ): RuntimeState<TRow> {
    const sourceSnapshot = snapshotSource(source);
    const complete = isCompleteSource(sourceSnapshot);
    const incomplete =
      (sourceSnapshot.status === "ready" || sourceSnapshot.status === "stale") && !complete;
    const currentCoherent = complete
      ? createCoherent(sourceSnapshot.rows, this.getRowId, previousCoherent, resolveRowIds)
      : undefined;
    const terminal = sourceSnapshot.status === "closed" || sourceSnapshot.status === "error";
    const retainPrevious = terminal || sourceSnapshot.status === "stale";
    const coherent =
      terminal && previousCoherent !== undefined && currentCoherent?.rows.length === 0
        ? previousCoherent
        : (currentCoherent ?? (retainPrevious ? previousCoherent : undefined));
    const hasCoherentRows = coherent !== undefined && (!terminal || coherent.rows.length > 0);
    const chrome = Object.freeze({
      status: sourceSnapshot.status,
      totalRows: sourceSnapshot.totalRows,
      ...(sourceSnapshot.statusCode === undefined ? {} : { statusCode: sourceSnapshot.statusCode }),
      ...(sourceSnapshot.message === undefined ? {} : { message: sourceSnapshot.message }),
      ...(sourceSnapshot.retry === undefined ? {} : { retry: sourceSnapshot.retry }),
      hasCoherentRows,
      incomplete,
      receivedRows: sourceSnapshot.rows.length,
    });

    let body: BrunoTableClientBodySnapshot<TRow>;
    if (sourceSnapshot.status === "loading") {
      body = Object.freeze({
        kind: "loading",
        skeletonCount: skeletonCount(sourceSnapshot.totalRows),
      });
    } else if (incomplete && coherent === undefined) {
      body = Object.freeze({ kind: "invalid", rows: EMPTY_ROWS });
    } else if (hasCoherentRows && coherent !== undefined && coherent.rows.length > 0) {
      body = Object.freeze({ kind: "rows", rows: coherent.rows, rowIds: coherent.rowIds });
    } else {
      body = Object.freeze({
        kind: "empty",
        rows: EMPTY_ROWS,
        emptyTitle: emptyTitle(sourceSnapshot.status),
        ...emptyDescription(sourceSnapshot),
        ...(sourceSnapshot.status === "closed" || sourceSnapshot.status === "error"
          ? sourceSnapshot.retry === undefined
            ? {}
            : { retry: sourceSnapshot.retry }
          : {}),
        ...(sourceSnapshot.status === "error" ? { destructive: true } : {}),
      });
    }

    return Object.freeze({ chrome, body, coherent });
  }

  private configureColumns(columns: readonly CompiledColumn[]): void {
    this.columns = columns;
    this.baselineFilters = sanitizeClientInitialFilters(this.initialFilters, columns);
    this.baselineOrderBy = reconcileClientOrderBy(
      this.initialOrderBy,
      this.initialOrderBy,
      columns,
    );
    const nextFilters = sanitizeClientInitialFilters(this.query.filters, columns);
    const nextOrderBy = reconcileClientOrderBy(this.query.orderBy, this.baselineOrderBy, columns);
    this.publishQuery(nextFilters, nextOrderBy, true);
  }

  private publishQuery(
    filters: readonly unknown[],
    orderBy: ClientOrderBy,
    forceColumnRefresh = false,
  ): void {
    const queryChanged =
      !sameReferences(this.query.filters, filters) || !sameOrderBy(this.query.orderBy, orderBy);
    if (!queryChanged && !forceColumnRefresh) return;
    const previousCommands = this.columnCommands;
    if (queryChanged) {
      this.query = Object.freeze({
        filters,
        orderBy,
        generation: this.query.generation + 1,
      });
    }
    this.columnCommands = createColumnCommandSnapshots(
      this.columns,
      this.query,
      this.baselineFilters,
    );
    if (queryChanged) notify(this.queryListeners);
    const columnIds = new Set([...previousCommands.keys(), ...this.columnCommands.keys()]);
    for (const columnId of columnIds) {
      if (!sameColumnCommand(previousCommands.get(columnId), this.columnCommands.get(columnId))) {
        const listeners = this.columnCommandListeners.get(columnId);
        if (listeners !== undefined) notify(listeners);
      }
    }
  }

  private notifyChangedRows(
    previous: CoherentRows<TRow> | undefined,
    next: CoherentRows<TRow> | undefined,
  ): void {
    if (previous === next) return;
    const ids = new Set<BrunoTableRowId>();
    previous?.rowIds.forEach((rowId) => ids.add(rowId));
    next?.rowIds.forEach((rowId) => ids.add(rowId));
    for (const rowId of ids) {
      if (previous?.rowsById.get(rowId) !== next?.rowsById.get(rowId)) {
        const listeners = this.rowListeners.get(rowId);
        if (listeners !== undefined) notify(listeners);
      }
    }
  }

  private notifyRows(
    previous: CoherentRows<TRow> | undefined,
    next: CoherentRows<TRow> | undefined,
  ): void {
    if (previous === next) return;
    const previousRows = previous?.rows ?? EMPTY_ROWS;
    const nextRows = next?.rows ?? EMPTY_ROWS;
    const previousRowIds = previous?.rowIds ?? EMPTY_ROWS;
    const nextRowIds = next?.rowIds ?? EMPTY_ROWS;
    for (const { listener, detector } of this.rowsListeners) {
      if (detector === undefined || detector(previousRows, nextRows, previousRowIds, nextRowIds)) {
        listener();
      }
    }
  }
}

function createCoherent<TRow>(
  rows: readonly TRow[],
  getRowId: (row: TRow) => BrunoTableRowId,
  previous: CoherentRows<TRow> | undefined,
  resolveRowIds: boolean,
): CoherentRows<TRow> {
  const rowIds = Array.from({ length: rows.length }, () => "" as BrunoTableRowId);
  const changedById = new Map<BrunoTableRowId, TRow>();
  const removedIds = new Set<BrunoTableRowId>();
  const seenIds = new Set<BrunoTableRowId>();
  let changed = previous === undefined || previous.rows.length !== rows.length;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const previousRow = previous?.rows[index];
    const rowId =
      previous !== undefined && previousRow === row && !resolveRowIds
        ? previous.rowIds[index]!
        : getRowId(row);
    if (typeof rowId !== "string" || rowId.length === 0) {
      throw new TypeError("BrunoTable getRowId must return a non-empty string.");
    }
    if (seenIds.has(rowId)) {
      throw new TypeError(`BrunoTable getRowId returned a duplicate row identity: ${rowId}`);
    }
    seenIds.add(rowId);
    rowIds[index] = rowId;
    if (previousRow !== row || previous?.rowIds[index] !== rowId) {
      changed = true;
      changedById.set(rowId, row);
      const previousRowId = previous?.rowIds[index];
      if (previousRowId !== undefined && previousRowId !== rowId) removedIds.add(previousRowId);
    }
  }
  if (previous !== undefined) {
    for (const previousRowId of previous.rowIds) {
      if (!seenIds.has(previousRowId)) removedIds.add(previousRowId);
    }
  }
  if (!changed && previous !== undefined) return previous;

  const depth = (previous?.rowsById.depth ?? 0) + 1;
  if (depth >= 32) {
    const flatRowsById = new Map<BrunoTableRowId, TRow>();
    for (let index = 0; index < rowIds.length; index += 1) {
      flatRowsById.set(rowIds[index]!, rows[index]!);
    }
    return Object.freeze({
      rows: Object.freeze(Array.from(rows)),
      rowIds: Object.freeze(rowIds),
      rowsById: Object.freeze({
        get: (rowId: BrunoTableRowId) => flatRowsById.get(rowId),
        depth: 0,
      }),
    });
  }

  return Object.freeze({
    rows: Object.freeze(Array.from(rows)),
    rowIds: Object.freeze(rowIds),
    rowsById: Object.freeze({
      get: (rowId: BrunoTableRowId) => {
        if (changedById.has(rowId)) return changedById.get(rowId);
        if (removedIds.has(rowId)) return undefined;
        return previous?.rowsById.get(rowId);
      },
      depth,
    }),
  });
}

function snapshotSource<TRow>(source: BrunoTableClientSource<TRow>): BrunoTableClientSource<TRow> {
  return Object.freeze({
    rows: Object.freeze(Array.from(source.rows)),
    totalRows: source.totalRows,
    version: source.version,
    status: source.status,
    ...(source.statusCode === undefined ? {} : { statusCode: boundedText(source.statusCode, 128) }),
    ...(source.message === undefined ? {} : { message: boundedText(source.message, 512) }),
    ...(source.retry === undefined
      ? {}
      : { retry: Object.freeze({ run: source.retry.run, pending: source.retry.pending }) }),
  });
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function isCompleteSource<TRow>(source: BrunoTableClientSource<TRow>): boolean {
  return (
    Number.isSafeInteger(source.totalRows) &&
    source.totalRows >= 0 &&
    source.rows.length === source.totalRows
  );
}

function skeletonCount(totalRows: number): number {
  return Number.isSafeInteger(totalRows) && totalRows > 0 ? Math.min(totalRows, 10) : 5;
}

function emptyTitle(status: BrunoTableSourceStatus): string {
  if (status === "closed") return "Live updates stopped";
  if (status === "error") return "Live data error";
  return "No rows";
}

function emptyDescription<TRow>(source: BrunoTableClientSource<TRow>): {
  readonly emptyDescription?: string;
} {
  const details = [source.message, source.statusCode].filter(
    (detail): detail is string => detail !== undefined && detail.length > 0,
  );
  return details.length === 0 ? {} : { emptyDescription: details.join(" · ") };
}

function sameChrome(
  previous: BrunoTableClientChromeSnapshot,
  next: BrunoTableClientChromeSnapshot,
): boolean {
  return (
    previous.status === next.status &&
    previous.totalRows === next.totalRows &&
    previous.statusCode === next.statusCode &&
    previous.message === next.message &&
    previous.retry?.run === next.retry?.run &&
    previous.retry?.pending === next.retry?.pending &&
    previous.hasCoherentRows === next.hasCoherentRows &&
    previous.incomplete === next.incomplete &&
    previous.receivedRows === next.receivedRows
  );
}

function sameBody<TRow>(
  previous: BrunoTableClientBodySnapshot<TRow>,
  next: BrunoTableClientBodySnapshot<TRow>,
): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "loading" && next.kind === "loading") {
    return previous.skeletonCount === next.skeletonCount;
  }
  if (previous.kind === "rows" && next.kind === "rows") {
    return sameRowIds(previous.rowIds, next.rowIds);
  }
  if (previous.kind === "empty" && next.kind === "empty") {
    return (
      previous.emptyTitle === next.emptyTitle &&
      previous.emptyDescription === next.emptyDescription &&
      previous.destructive === next.destructive &&
      previous.retry?.run === next.retry?.run &&
      previous.retry?.pending === next.retry?.pending
    );
  }
  return true;
}

function sameRowIds(
  previous: readonly BrunoTableRowId[],
  next: readonly BrunoTableRowId[],
): boolean {
  return previous.length === next.length && previous.every((rowId, index) => rowId === next[index]);
}

function createColumnCommandSnapshots(
  columns: readonly CompiledColumn[],
  query: BrunoTableClientQuerySnapshot,
  baselineFilters: readonly unknown[],
): Map<string, BrunoTableColumnCommandSnapshot> {
  const snapshots = new Map<string, BrunoTableColumnCommandSnapshot>();
  for (const column of columns) {
    const sortIndex = query.orderBy.findIndex((sort) => sort.columnId === column.columnId);
    const sort = query.orderBy[sortIndex];
    snapshots.set(
      column.columnId,
      Object.freeze({
        sortable: column.enableSorting !== false,
        ...(sort === undefined
          ? {}
          : { sortDirection: sort.direction, sortPriority: sortIndex + 1 }),
        filterActive: query.filters.some((filter) =>
          filterReferencesColumn(filter, column.columnId),
        ),
        filterBaselineAvailable: baselineFilters.some((filter) =>
          filterReferencesColumn(filter, column.columnId),
        ),
      }),
    );
  }
  return snapshots;
}

function sameColumnCommand(
  previous: BrunoTableColumnCommandSnapshot | undefined,
  next: BrunoTableColumnCommandSnapshot | undefined,
): boolean {
  return (
    previous?.sortable === next?.sortable &&
    previous?.sortDirection === next?.sortDirection &&
    previous?.sortPriority === next?.sortPriority &&
    previous?.filterActive === next?.filterActive &&
    previous?.filterBaselineAvailable === next?.filterBaselineAvailable
  );
}

function sameReferences(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function sameOrderBy(previous: ClientOrderBy, next: ClientOrderBy): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (sort, index) =>
        sort.columnId === next[index]?.columnId && sort.direction === next[index]?.direction,
    )
  );
}

function subscribe(listeners: Set<Listener>, listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(listeners: Set<Listener>): void {
  for (const listener of listeners) listener();
}
