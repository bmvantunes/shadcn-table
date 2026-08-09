import type {
  BrunoTableRowId,
  BrunoTableSourceRetry,
  BrunoTableSourceStatus,
} from "../public-types";
import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableOrderBy } from "./grid-query";
import {
  brunoTableFilterReferencesColumn,
  collectClientFilterColumnIds,
  reconcileBrunoTableOrderBy,
  sanitizeBrunoTableFilters,
  sanitizeBrunoTableOrderBy,
} from "./grid-query";

type Listener = () => void;
export type BrunoTableInvalidSourceSnapshot =
  | Readonly<{
      readonly kind: "row-count-mismatch";
      readonly expectedRows: number;
      readonly receivedRows: number;
    }>
  | Readonly<{
      readonly kind: "invalid-value";
      readonly rowIndex: number;
      readonly columnId: string;
      readonly message: string;
    }>;

const BRUNO_TABLE_INVALID_CELL_VALUE: unique symbol = Symbol("BrunoTableInvalidCellValue");
const BRUNO_TABLE_INVALID_CELL_VALUES = new WeakSet<object>();

export type BrunoTableInvalidCellValue = Readonly<{
  readonly [BRUNO_TABLE_INVALID_CELL_VALUE]: true;
  readonly invalid: Extract<BrunoTableInvalidSourceSnapshot, { readonly kind: "invalid-value" }>;
}>;

export function createBrunoTableInvalidCellValue(
  invalid: BrunoTableInvalidCellValue["invalid"],
): BrunoTableInvalidCellValue {
  const value = Object.freeze({ [BRUNO_TABLE_INVALID_CELL_VALUE]: true as const, invalid });
  BRUNO_TABLE_INVALID_CELL_VALUES.add(value);
  return value;
}

export function isBrunoTableInvalidCellValue(value: unknown): value is BrunoTableInvalidCellValue {
  return typeof value === "object" && value !== null && BRUNO_TABLE_INVALID_CELL_VALUES.has(value);
}

export type BrunoTableChromeSnapshot = Readonly<{
  readonly status: BrunoTableSourceStatus;
  readonly statusCode?: string;
  readonly message?: string;
  readonly retry?: BrunoTableSourceRetry;
  readonly hasCoherentRows: boolean;
  readonly invalid?: BrunoTableInvalidSourceSnapshot;
}>;

export type BrunoTableSourceSnapshot = Readonly<{
  readonly totalRows: number;
  readonly loadedRows: number;
  readonly version: number;
}>;

export type BrunoTableBodySnapshot =
  | Readonly<{ readonly kind: "rows" }>
  | Readonly<{ readonly kind: "loading"; readonly totalRows: number }>
  | Readonly<{ readonly kind: "invalid" }>
  | Readonly<{ readonly kind: "empty" }>;

export type BrunoTableRowSpaceSnapshot<TRow> = Readonly<{
  readonly totalRows: number;
  readonly loadedRows: number;
  readonly getRowId: (index: number) => BrunoTableRowId | undefined;
  readonly getRow: (rowId: BrunoTableRowId) => TRow | undefined;
  readonly getCellValue: (rowId: BrunoTableRowId, columnId: string) => unknown;
}>;

export type BrunoTableRuntimeView = {
  readonly getChromeSnapshot: () => BrunoTableChromeSnapshot;
  readonly getSourceSnapshot: () => BrunoTableSourceSnapshot;
  readonly getBodySnapshot: () => BrunoTableBodySnapshot;
  readonly getRowSpaceSnapshot: () => BrunoTableRowSpaceSnapshot<unknown> | undefined;
  readonly getRowSnapshot: (rowId: BrunoTableRowId) => unknown;
  readonly getCellSnapshot: (rowId: BrunoTableRowId, columnId: string) => BrunoTableCellSnapshot;
  readonly getCellValueSnapshot: (rowId: BrunoTableRowId, columnId: string) => unknown;
  readonly getColumnCommandSnapshot: (columnId: string) => BrunoTableColumnCommandSnapshot;
  readonly subscribeChrome: (listener: Listener) => () => void;
  readonly subscribeSource: (listener: Listener) => () => void;
  readonly subscribeBody: (listener: Listener) => () => void;
  readonly subscribeRowSpace: (listener: Listener) => () => void;
  readonly subscribeRow: (rowId: BrunoTableRowId, listener: Listener) => () => void;
  readonly subscribeCell: (
    rowId: BrunoTableRowId,
    columnId: string,
    listener: Listener,
  ) => () => void;
  readonly subscribeColumnCommands: (columnId: string, listener: Listener) => () => void;
  readonly toggleColumnSort: (columnId: string, multi: boolean) => void;
  readonly clearColumnFilters: (columnId: string) => void;
  readonly resetColumnFilters: (columnId: string) => void;
  readonly retry: () => void;
};

export type BrunoTableRowPipelineRuntimeView = BrunoTableRuntimeView & {
  readonly getQuerySnapshot: () => BrunoTableQuerySnapshot;
  readonly subscribeQuery: (listener: Listener) => () => void;
};

export type BrunoTableQuerySnapshot = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly filters: readonly unknown[];
  readonly orderBy: BrunoTableOrderBy;
  readonly generation: number;
}>;

export type BrunoTableQueryConfiguration = Readonly<{
  readonly baselineFilters: readonly unknown[];
  readonly baselineOrderBy: BrunoTableOrderBy;
}>;

export type BrunoTableColumnCommandSnapshot = Readonly<{
  readonly sortable: boolean;
  readonly sortDirection?: "asc" | "desc";
  readonly sortPriority?: number;
  readonly filterActive: boolean;
  readonly filterBaselineAvailable: boolean;
}>;

const BODY_ROWS: BrunoTableBodySnapshot = Object.freeze({ kind: "rows" });
const BODY_INVALID: BrunoTableBodySnapshot = Object.freeze({ kind: "invalid" });
const BODY_EMPTY: BrunoTableBodySnapshot = Object.freeze({ kind: "empty" });
const EMPTY_COLUMN_COMMAND: BrunoTableColumnCommandSnapshot = Object.freeze({
  sortable: false,
  filterActive: false,
  filterBaselineAvailable: false,
});

export type BrunoTableRowPipelinePublication<TRow> = Readonly<{
  readonly status: BrunoTableSourceStatus;
  readonly totalRows: number;
  readonly version: number;
  readonly statusCode?: string;
  readonly message?: string;
  readonly retry?: BrunoTableSourceRetry;
  readonly rowSpace?: BrunoTableRowSpaceSnapshot<TRow>;
  readonly hasCoherentRows: boolean;
  readonly invalid?: BrunoTableInvalidSourceSnapshot;
}>;

type RuntimeState<TRow> = Readonly<{
  readonly chrome: BrunoTableChromeSnapshot;
  readonly source: BrunoTableSourceSnapshot;
  readonly body: BrunoTableBodySnapshot;
  readonly rowSpace: BrunoTableRowSpaceSnapshot<TRow> | undefined;
}>;

export type BrunoTableCellSnapshot = Readonly<{
  readonly column: CompiledColumn | undefined;
  readonly rowSpace: BrunoTableRowSpaceSnapshot<unknown> | undefined;
  readonly rowPresent: boolean;
  readonly value: unknown;
}>;

const PENDING_CELL_SNAPSHOT_LIMIT = 4_096;

type QueryTransition = Readonly<{
  readonly queryChanged: boolean;
  readonly previousCommands: ReadonlyMap<string, BrunoTableColumnCommandSnapshot>;
}>;

type ColumnConfiguration = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly baselineFilters: readonly unknown[];
  readonly baselineOrderBy: BrunoTableOrderBy;
  readonly query: BrunoTableQuerySnapshot;
  readonly columnCommands: Map<string, BrunoTableColumnCommandSnapshot>;
  readonly transition: QueryTransition;
}>;

export class BrunoTableGridRuntime<TRow> {
  private readonly chromeListeners = new Set<Listener>();
  private readonly sourceListeners = new Set<Listener>();
  private readonly bodyListeners = new Set<Listener>();
  private readonly rowSpaceListeners = new Set<Listener>();
  private readonly rowListeners = new Map<BrunoTableRowId, Set<Listener>>();
  private readonly cellListeners = new Map<BrunoTableRowId, Map<string, Set<Listener>>>();
  private readonly cellSnapshots = new Map<BrunoTableRowId, Map<string, BrunoTableCellSnapshot>>();
  private readonly pendingCellTokensByRow = new Map<BrunoTableRowId, Map<string, object>>();
  private readonly pendingCellLru = new Map<
    object,
    Readonly<{ rowId: BrunoTableRowId; columnId: string }>
  >();
  private readonly queryListeners = new Set<Listener>();
  private readonly columnCommandListeners = new Map<string, Set<Listener>>();
  private view: BrunoTableRowPipelineRuntimeView | undefined;
  private state: RuntimeState<TRow>;
  private publication: BrunoTableRowPipelinePublication<TRow>;
  private columns: readonly CompiledColumn[];
  private columnsById: ReadonlyMap<string, CompiledColumn>;
  private baselineFilters: readonly unknown[];
  private baselineOrderBy: BrunoTableOrderBy;
  private query: BrunoTableQuerySnapshot;
  private columnCommands = new Map<string, BrunoTableColumnCommandSnapshot>();

  public constructor(
    publication: BrunoTableRowPipelinePublication<TRow>,
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration,
  ) {
    this.columns = columns;
    this.columnsById = indexColumns(columns);
    this.baselineFilters = queryConfiguration.baselineFilters;
    this.baselineOrderBy = queryConfiguration.baselineOrderBy;
    this.query = Object.freeze({
      columns,
      filters: this.baselineFilters,
      orderBy: this.baselineOrderBy,
      generation: 0,
    });
    this.columnCommands = createColumnCommandSnapshots(columns, this.query, this.baselineFilters);
    this.publication = publication;
    this.state = this.createState(publication);
  }

  public readonly getView = (): BrunoTableRowPipelineRuntimeView => {
    if (this.view === undefined) {
      this.view = Object.freeze({
        getChromeSnapshot: this.getChromeSnapshot,
        getSourceSnapshot: this.getSourceSnapshot,
        getBodySnapshot: this.getBodySnapshot,
        getRowSpaceSnapshot: this.getRowSpaceSnapshot,
        getRowSnapshot: this.getRowSnapshot,
        getCellSnapshot: this.getCellSnapshot,
        getCellValueSnapshot: this.getCellValueSnapshot,
        getQuerySnapshot: this.getQuerySnapshot,
        getColumnCommandSnapshot: this.getColumnCommandSnapshot,
        subscribeChrome: this.subscribeChrome,
        subscribeSource: this.subscribeSource,
        subscribeBody: this.subscribeBody,
        subscribeRowSpace: this.subscribeRowSpace,
        subscribeRow: this.subscribeRow,
        subscribeCell: this.subscribeCell,
        subscribeQuery: this.subscribeQuery,
        subscribeColumnCommands: this.subscribeColumnCommands,
        toggleColumnSort: this.toggleColumnSort,
        clearColumnFilters: this.clearColumnFilters,
        resetColumnFilters: this.resetColumnFilters,
        retry: this.retry,
      });
    }
    return this.view;
  };

  public readonly publish = (publication: BrunoTableRowPipelinePublication<TRow>): void => {
    this.reconcile(publication, this.columns);
  };

  public readonly reconcile = (
    publication: BrunoTableRowPipelinePublication<TRow>,
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration = Object.freeze({
      baselineFilters: this.baselineFilters,
      baselineOrderBy: this.baselineOrderBy,
    }),
  ): void => {
    const previous = this.state;
    const configuration =
      this.columns === columns &&
      this.baselineFilters === queryConfiguration.baselineFilters &&
      this.baselineOrderBy === queryConfiguration.baselineOrderBy
        ? undefined
        : this.stageColumns(columns, queryConfiguration);
    const next = this.createState(publication);

    if (configuration !== undefined) {
      this.columns = configuration.columns;
      this.columnsById = indexColumns(configuration.columns);
      this.baselineFilters = configuration.baselineFilters;
      this.baselineOrderBy = configuration.baselineOrderBy;
      this.query = configuration.query;
      this.columnCommands = configuration.columnCommands;
    }
    this.publication = publication;
    const installed = stabilizeRuntimeState(previous, next);
    this.state = installed;
    const transitionError =
      configuration === undefined
        ? undefined
        : this.notifyQueryTransition(configuration.transition);
    const commitError = this.commitState(previous, installed);
    const firstError = firstListenerError(transitionError, commitError);
    if (firstError !== undefined) throw firstError.value;
  };

  private commitState(
    previous: RuntimeState<TRow>,
    next: RuntimeState<TRow>,
  ): ListenerError | undefined {
    const chromeChanged = previous.chrome !== next.chrome;
    const sourceChanged = previous.source !== next.source;
    const bodyChanged = previous.body !== next.body;
    const rowSpaceChanged = previous.rowSpace !== next.rowSpace;
    this.state = next;

    let firstError: ListenerError | undefined;
    if (chromeChanged) firstError = notify(this.chromeListeners);
    if (sourceChanged) firstError = firstListenerError(firstError, notify(this.sourceListeners));
    if (bodyChanged) firstError = firstListenerError(firstError, notify(this.bodyListeners));
    if (rowSpaceChanged) {
      firstError = firstListenerError(firstError, notify(this.rowSpaceListeners));
    }
    return firstListenerError(firstError, this.notifyChangedRows(previous.rowSpace, next.rowSpace));
  }

  public readonly configure = (
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration,
  ): void => {
    this.reconcile(this.publication, columns, queryConfiguration);
  };

  public readonly getChromeSnapshot = (): BrunoTableChromeSnapshot => this.state.chrome;

  public readonly getSourceSnapshot = (): BrunoTableSourceSnapshot => this.state.source;

  public readonly getBodySnapshot = (): BrunoTableBodySnapshot => this.state.body;

  public readonly getRowSpaceSnapshot = (): BrunoTableRowSpaceSnapshot<TRow> | undefined =>
    this.state.rowSpace;

  public readonly getRowSnapshot = (rowId: BrunoTableRowId): TRow | undefined =>
    this.state.rowSpace?.getRow(rowId);

  public readonly getCellSnapshot = (
    rowId: BrunoTableRowId,
    columnId: string,
  ): BrunoTableCellSnapshot => {
    const snapshot = this.currentCellSnapshot(rowId, columnId);
    if (!this.cellListeners.get(rowId)?.has(columnId)) {
      this.installCellSnapshot(rowId, columnId, snapshot);
      this.trackPendingCellSnapshot(rowId, columnId);
    }
    return snapshot;
  };

  public readonly getCellValueSnapshot = (rowId: BrunoTableRowId, columnId: string): unknown =>
    this.currentCellSnapshot(rowId, columnId).value;

  public readonly getQuerySnapshot = (): BrunoTableQuerySnapshot => this.query;

  public readonly getColumnCommandSnapshot = (columnId: string): BrunoTableColumnCommandSnapshot =>
    this.columnCommands.get(columnId) ?? EMPTY_COLUMN_COMMAND;

  public readonly subscribeChrome = (listener: Listener): (() => void) =>
    subscribe(this.chromeListeners, listener);

  public readonly subscribeSource = (listener: Listener): (() => void) =>
    subscribe(this.sourceListeners, listener);

  public readonly subscribeBody = (listener: Listener): (() => void) =>
    subscribe(this.bodyListeners, listener);

  public readonly subscribeRowSpace = (listener: Listener): (() => void) =>
    subscribe(this.rowSpaceListeners, listener);

  public readonly subscribeRow = (rowId: BrunoTableRowId, listener: Listener): (() => void) => {
    let listeners = this.rowListeners.get(rowId);
    if (listeners === undefined) {
      listeners = new Set<Listener>();
      this.rowListeners.set(rowId, listeners);
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.rowListeners.get(rowId) !== listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.rowListeners.delete(rowId);
    };
  };

  public readonly subscribeCell = (
    rowId: BrunoTableRowId,
    columnId: string,
    listener: Listener,
  ): (() => void) => {
    let rowListeners = this.cellListeners.get(rowId);
    if (rowListeners === undefined) {
      rowListeners = new Map();
      this.cellListeners.set(rowId, rowListeners);
    }
    let listeners = rowListeners.get(columnId);
    if (listeners === undefined) {
      listeners = new Set();
      rowListeners.set(columnId, listeners);
    }
    const snapshot = this.currentCellSnapshot(rowId, columnId);
    listeners.add(listener);
    this.clearPendingCellSnapshot(rowId, columnId);
    this.installCellSnapshot(rowId, columnId, snapshot);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.cellListeners.get(rowId)?.get(columnId) !== listeners) return;
      listeners.delete(listener);
      if (listeners.size > 0) return;
      rowListeners?.delete(columnId);
      this.cellSnapshots.get(rowId)?.delete(columnId);
      this.clearPendingCellSnapshot(rowId, columnId);
      if (rowListeners?.size === 0) this.cellListeners.delete(rowId);
      if (this.cellSnapshots.get(rowId)?.size === 0) this.cellSnapshots.delete(rowId);
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
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.columnCommandListeners.get(columnId) !== listeners) return;
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
    this.publishQuery(this.query.filters, sanitizeBrunoTableOrderBy(nextOrderBy, this.columns));
  };

  public readonly clearColumnFilters = (columnId: string): void => {
    const next = this.query.filters.filter(
      (filter) => !brunoTableFilterReferencesColumn(filter, columnId),
    );
    if (next.length === this.query.filters.length) return;
    this.publishQuery(Object.freeze(next), this.query.orderBy);
  };

  public readonly resetColumnFilters = (columnId: string): void => {
    const withoutColumn = this.query.filters.filter(
      (filter) => !brunoTableFilterReferencesColumn(filter, columnId),
    );
    const baseline = this.baselineFilters.filter((filter) =>
      brunoTableFilterReferencesColumn(filter, columnId),
    );
    this.publishQuery(Object.freeze([...withoutColumn, ...baseline]), this.query.orderBy);
  };

  public readonly retry = (): void => {
    const retry = this.state.chrome.retry;
    if (retry !== undefined && !retry.pending) {
      const run = retry.run;
      run();
    }
  };

  private createState(publication: BrunoTableRowPipelinePublication<TRow>): RuntimeState<TRow> {
    const rowSpace = publication.rowSpace;
    const chrome = Object.freeze({
      status: publication.status,
      ...(publication.statusCode === undefined ? {} : { statusCode: publication.statusCode }),
      ...(publication.message === undefined ? {} : { message: publication.message }),
      ...(publication.retry === undefined ? {} : { retry: publication.retry }),
      hasCoherentRows: publication.hasCoherentRows,
      ...(publication.invalid === undefined ? {} : { invalid: publication.invalid }),
    });
    const source = Object.freeze({
      totalRows: publication.totalRows,
      loadedRows: rowSpace?.loadedRows ?? 0,
      version: publication.version,
    });
    const body = bodySnapshot(publication);
    return Object.freeze({ chrome, source, body, rowSpace });
  }

  private stageColumns(
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration,
  ): ColumnConfiguration {
    const baselineFilters = queryConfiguration.baselineFilters;
    const baselineOrderBy = queryConfiguration.baselineOrderBy;
    const nextFilters = sanitizeBrunoTableFilters(this.query.filters, columns);
    const nextOrderBy = reconcileBrunoTableOrderBy(this.query.orderBy, baselineOrderBy, columns);
    const semanticsChanged =
      !sameReferences(this.query.filters, nextFilters) ||
      !sameOrderBy(this.query.orderBy, nextOrderBy) ||
      activeQuerySemanticsChanged(this.columns, columns, this.query);
    const query = Object.freeze({
      columns,
      filters: nextFilters,
      orderBy: nextOrderBy,
      generation: semanticsChanged ? this.query.generation + 1 : this.query.generation,
    });
    const columnCommands = createColumnCommandSnapshots(
      columns,
      query,
      baselineFilters,
      this.columnCommands,
    );
    return Object.freeze({
      columns,
      baselineFilters,
      baselineOrderBy,
      query,
      columnCommands,
      transition: Object.freeze({ queryChanged: true, previousCommands: this.columnCommands }),
    });
  }

  private publishQuery(
    filters: readonly unknown[],
    orderBy: BrunoTableOrderBy,
    forceColumnRefresh = false,
  ): void {
    const transition = this.updateQuery(filters, orderBy, forceColumnRefresh);
    if (transition === undefined) return;
    const error = this.notifyQueryTransition(transition);
    if (error !== undefined) throw error.value;
  }

  private updateQuery(
    filters: readonly unknown[],
    orderBy: BrunoTableOrderBy,
    forceColumnRefresh = false,
  ): QueryTransition | undefined {
    const queryChanged =
      !sameReferences(this.query.filters, filters) || !sameOrderBy(this.query.orderBy, orderBy);
    if (!queryChanged && !forceColumnRefresh) return undefined;
    const previousCommands = this.columnCommands;
    if (queryChanged) {
      this.query = Object.freeze({
        columns: this.columns,
        filters,
        orderBy,
        generation: this.query.generation + 1,
      });
    }
    this.columnCommands = createColumnCommandSnapshots(
      this.columns,
      this.query,
      this.baselineFilters,
      previousCommands,
    );
    return Object.freeze({ queryChanged, previousCommands });
  }

  private notifyQueryTransition(transition: QueryTransition): ListenerError | undefined {
    let firstError = transition.queryChanged ? notify(this.queryListeners) : undefined;
    const columnIds = new Set([
      ...transition.previousCommands.keys(),
      ...this.columnCommands.keys(),
    ]);
    for (const columnId of columnIds) {
      if (
        !sameColumnCommand(
          transition.previousCommands.get(columnId),
          this.columnCommands.get(columnId),
        )
      ) {
        const listeners = this.columnCommandListeners.get(columnId);
        if (listeners !== undefined) {
          firstError = firstListenerError(firstError, notify(listeners));
        }
      }
    }
    return firstError;
  }

  private notifyChangedRows(
    previous: BrunoTableRowSpaceSnapshot<TRow> | undefined,
    next: BrunoTableRowSpaceSnapshot<TRow> | undefined,
  ): ListenerError | undefined {
    if (previous === next) return undefined;
    let firstError: ListenerError | undefined;
    for (const [rowId, listeners] of this.rowListeners) {
      if (previous?.getRow(rowId) !== next?.getRow(rowId)) {
        firstError = firstListenerError(firstError, notify(listeners));
      }
    }
    for (const [rowId, columns] of this.cellListeners) {
      for (const [columnId, listeners] of columns) {
        const previousSnapshot =
          this.cellSnapshots.get(rowId)?.get(columnId) ??
          readCellSnapshot(previous, this.columnsById, rowId, columnId);
        const nextSnapshot = readCellSnapshot(next, this.columnsById, rowId, columnId);
        if (previousSnapshot.column !== nextSnapshot.column) {
          this.installCellSnapshot(rowId, columnId, nextSnapshot);
          continue;
        }
        if (sameCellSnapshot(previousSnapshot, nextSnapshot)) continue;
        this.installCellSnapshot(rowId, columnId, nextSnapshot);
        firstError = firstListenerError(firstError, notify(listeners));
      }
    }
    return firstError;
  }

  private currentCellSnapshot(rowId: BrunoTableRowId, columnId: string): BrunoTableCellSnapshot {
    const column = this.columnsById.get(columnId);
    const current = this.cellSnapshots.get(rowId)?.get(columnId);
    const subscribed = this.cellListeners.get(rowId)?.has(columnId) ?? false;
    if (
      current !== undefined &&
      current.column === column &&
      (subscribed || current.rowSpace === this.state.rowSpace)
    ) {
      return current;
    }
    const next = this.readCellSnapshot(rowId, columnId);
    if (this.cellListeners.get(rowId)?.has(columnId)) {
      this.installCellSnapshot(rowId, columnId, next);
    }
    return next;
  }

  private readCellSnapshot(rowId: BrunoTableRowId, columnId: string): BrunoTableCellSnapshot {
    return readCellSnapshot(this.state.rowSpace, this.columnsById, rowId, columnId);
  }

  private installCellSnapshot(
    rowId: BrunoTableRowId,
    columnId: string,
    snapshot: BrunoTableCellSnapshot,
  ): void {
    let rowSnapshots = this.cellSnapshots.get(rowId);
    if (rowSnapshots === undefined) {
      rowSnapshots = new Map();
      this.cellSnapshots.set(rowId, rowSnapshots);
    }
    rowSnapshots.set(columnId, snapshot);
  }

  private trackPendingCellSnapshot(rowId: BrunoTableRowId, columnId: string): void {
    let rowTokens = this.pendingCellTokensByRow.get(rowId);
    if (rowTokens === undefined) {
      rowTokens = new Map();
      this.pendingCellTokensByRow.set(rowId, rowTokens);
    }
    const currentToken = rowTokens.get(columnId);
    if (currentToken !== undefined) this.pendingCellLru.delete(currentToken);
    const token = currentToken ?? Object.freeze({});
    rowTokens.set(columnId, token);
    this.pendingCellLru.set(token, { rowId, columnId });
    if (this.pendingCellLru.size <= PENDING_CELL_SNAPSHOT_LIMIT) return;
    const oldestToken = this.pendingCellLru.keys().next().value;
    if (oldestToken === undefined) return;
    const oldest = this.pendingCellLru.get(oldestToken);
    if (oldest === undefined) return;
    this.clearPendingCellSnapshot(oldest.rowId, oldest.columnId);
    if (!this.cellListeners.get(oldest.rowId)?.has(oldest.columnId)) {
      this.cellSnapshots.get(oldest.rowId)?.delete(oldest.columnId);
      if (this.cellSnapshots.get(oldest.rowId)?.size === 0) {
        this.cellSnapshots.delete(oldest.rowId);
      }
    }
  }

  private clearPendingCellSnapshot(rowId: BrunoTableRowId, columnId: string): void {
    const rowTokens = this.pendingCellTokensByRow.get(rowId);
    const token = rowTokens?.get(columnId);
    if (token === undefined) return;
    rowTokens?.delete(columnId);
    this.pendingCellLru.delete(token);
    if (rowTokens?.size === 0) this.pendingCellTokensByRow.delete(rowId);
  }
}

function readCellSnapshot<TRow>(
  rowSpace: BrunoTableRowSpaceSnapshot<TRow> | undefined,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  rowId: BrunoTableRowId,
  columnId: string,
): BrunoTableCellSnapshot {
  const column = columnsById.get(columnId);
  const rowPresent = rowSpace?.getRow(rowId) !== undefined;
  return Object.freeze({
    column,
    rowSpace,
    rowPresent,
    value: rowPresent ? rowSpace?.getCellValue(rowId, columnId) : undefined,
  });
}

function indexColumns(columns: readonly CompiledColumn[]): ReadonlyMap<string, CompiledColumn> {
  return new Map(columns.map((column) => [column.columnId, column]));
}

function sameCellSnapshot(previous: BrunoTableCellSnapshot, next: BrunoTableCellSnapshot): boolean {
  if (previous.column !== next.column || previous.rowPresent !== next.rowPresent) return false;
  if (Object.is(previous.value, next.value)) return true;
  if (isBrunoTableInvalidCellValue(previous.value) || isBrunoTableInvalidCellValue(next.value)) {
    return (
      isBrunoTableInvalidCellValue(previous.value) &&
      isBrunoTableInvalidCellValue(next.value) &&
      sameInvalidSource(previous.value.invalid, next.value.invalid)
    );
  }
  return false;
}

function sameChrome(previous: BrunoTableChromeSnapshot, next: BrunoTableChromeSnapshot): boolean {
  return (
    previous.status === next.status &&
    previous.statusCode === next.statusCode &&
    previous.message === next.message &&
    previous.retry?.run === next.retry?.run &&
    previous.retry?.pending === next.retry?.pending &&
    previous.hasCoherentRows === next.hasCoherentRows &&
    sameInvalidSource(previous.invalid, next.invalid)
  );
}

function sameInvalidSource(
  previous: BrunoTableInvalidSourceSnapshot | undefined,
  next: BrunoTableInvalidSourceSnapshot | undefined,
): boolean {
  if (previous?.kind !== next?.kind) return false;
  if (previous === undefined || next === undefined) return previous === next;
  if (previous.kind === "row-count-mismatch" && next.kind === "row-count-mismatch") {
    return (
      previous.expectedRows === next.expectedRows && previous.receivedRows === next.receivedRows
    );
  }
  return (
    previous.kind === "invalid-value" &&
    next.kind === "invalid-value" &&
    previous.rowIndex === next.rowIndex &&
    previous.columnId === next.columnId &&
    previous.message === next.message
  );
}

function sameSource(previous: BrunoTableSourceSnapshot, next: BrunoTableSourceSnapshot): boolean {
  return (
    previous.totalRows === next.totalRows &&
    previous.loadedRows === next.loadedRows &&
    previous.version === next.version
  );
}

function sameBody(previous: BrunoTableBodySnapshot, next: BrunoTableBodySnapshot): boolean {
  return (
    previous.kind === next.kind &&
    (previous.kind !== "loading" ||
      (next.kind === "loading" && previous.totalRows === next.totalRows))
  );
}

function stabilizeRuntimeState<TRow>(
  previous: RuntimeState<TRow>,
  next: RuntimeState<TRow>,
): RuntimeState<TRow> {
  return Object.freeze({
    chrome: sameChrome(previous.chrome, next.chrome) ? previous.chrome : next.chrome,
    source: sameSource(previous.source, next.source) ? previous.source : next.source,
    body: sameBody(previous.body, next.body) ? previous.body : next.body,
    rowSpace: next.rowSpace,
  });
}

function bodySnapshot<TRow>(
  publication: BrunoTableRowPipelinePublication<TRow>,
): BrunoTableBodySnapshot {
  if (publication.rowSpace !== undefined) {
    return publication.rowSpace.totalRows > 0 ? BODY_ROWS : BODY_EMPTY;
  }
  if (
    publication.invalid?.kind === "invalid-value" &&
    (publication.status === "closed" || publication.status === "error")
  ) {
    return BODY_EMPTY;
  }
  if (publication.invalid !== undefined) return BODY_INVALID;
  if (publication.status === "loading" && publication.rowSpace === undefined) {
    return Object.freeze({ kind: "loading", totalRows: publication.totalRows });
  }
  return BODY_EMPTY;
}

function createColumnCommandSnapshots(
  columns: readonly CompiledColumn[],
  query: BrunoTableQuerySnapshot,
  baselineFilters: readonly unknown[],
  previous?: ReadonlyMap<string, BrunoTableColumnCommandSnapshot>,
): Map<string, BrunoTableColumnCommandSnapshot> {
  const snapshots = new Map<string, BrunoTableColumnCommandSnapshot>();
  for (const column of columns) {
    const sortIndex = query.orderBy.findIndex((sort) => sort.columnId === column.columnId);
    const sort = query.orderBy[sortIndex];
    const next = Object.freeze({
      sortable: column.enableSorting !== false,
      ...(sort === undefined ? {} : { sortDirection: sort.direction, sortPriority: sortIndex + 1 }),
      filterActive: query.filters.some((filter) =>
        brunoTableFilterReferencesColumn(filter, column.columnId),
      ),
      filterBaselineAvailable: baselineFilters.some((filter) =>
        brunoTableFilterReferencesColumn(filter, column.columnId),
      ),
    });
    const previousSnapshot = previous?.get(column.columnId);
    snapshots.set(
      column.columnId,
      sameColumnCommand(previousSnapshot, next) && previousSnapshot !== undefined
        ? previousSnapshot
        : next,
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

function activeQuerySemanticsChanged(
  previousColumns: readonly CompiledColumn[],
  nextColumns: readonly CompiledColumn[],
  query: BrunoTableQuerySnapshot,
): boolean {
  const activeColumnIds = new Set(query.orderBy.map((sort) => sort.columnId));
  for (const filter of query.filters) {
    collectClientFilterColumnIds(filter, activeColumnIds);
  }
  for (const columnId of activeColumnIds) {
    const previous = previousColumns.find((column) => column.columnId === columnId);
    const next = nextColumns.find((column) => column.columnId === columnId);
    if (previous === undefined || next === undefined) return true;
    if (!sameQuerySemantics(previous, next)) return true;
  }
  return false;
}

function sameQuerySemantics(previous: CompiledColumn, next: CompiledColumn): boolean {
  if (
    previous.kind !== next.kind ||
    !Object.is(previous.valueType, next.valueType) ||
    previous.semantics.codecId !== next.semantics.codecId ||
    previous.semantics.codecVersion !== next.semantics.codecVersion ||
    previous.semantics.filterFamily !== next.semantics.filterFamily
  ) {
    return false;
  }
  if (previous.kind === "field" && next.kind === "field") return previous.field === next.field;
  if (previous.kind === "computed" && next.kind === "computed") {
    return (
      previous.valueGetter === next.valueGetter &&
      previous.fields.length === next.fields.length &&
      previous.fields.every((field, index) => field === next.fields[index])
    );
  }
  return false;
}

function sameOrderBy(previous: BrunoTableOrderBy, next: BrunoTableOrderBy): boolean {
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

type ListenerError = Readonly<{ readonly value: unknown }>;

function firstListenerError(
  current: ListenerError | undefined,
  next: ListenerError | undefined,
): ListenerError | undefined {
  return current ?? next;
}

function notify(listeners: Set<Listener>): ListenerError | undefined {
  let firstError: ListenerError | undefined;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      firstError ??= Object.freeze({ value: error });
    }
  }
  return firstError;
}
