import type {
  BrunoTableRowId,
  BrunoTableSourceRetry,
  BrunoTableSourceStatus,
} from "../public-types";
import type { CompiledColumn } from "./compile-columns";
import {
  applyBrunoTableGridCommand,
  createBrunoTableColumnLayout,
  getBrunoTableColumnWidthBounds,
  getBrunoTableColumnLayoutSnapshot,
  isBrunoTableColumnLayoutCommand,
  reconcileBrunoTableColumnLayout,
  type BrunoTableColumnLayoutSnapshot,
  type BrunoTableColumnLayoutState,
  type BrunoTableGridCommand,
} from "./column-management";
import type { BrunoTableOrderBy } from "./grid-query";
import {
  brunoTableFilterReferencesColumn,
  collectClientFilterColumnIds,
  normalizeBrunoTableFilterText,
  reconcileBrunoTableOrderBy,
  sanitizeBrunoTableFilters,
} from "./grid-query";
import { recordBrunoTableGridCommand } from "./grid-command-instrumentation";
import {
  recordBrunoTableColumnCommandSubscriptionNotification,
  recordBrunoTableColumnFilterSubscriptionEvent,
} from "./grid-subscription-instrumentation";
import { recordBrunoTableClientQueryTransition } from "./render-instrumentation";
import { applyBrunoTableSortingCommand, isBrunoTableSortingCommand } from "./sorting";

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
    }>
  | Readonly<{
      readonly kind: "invalid-status";
      readonly receivedStatus: string;
    }>
  | Readonly<{
      readonly kind: "invalid-lifecycle";
      readonly field: "status" | "totalRows" | "version";
    }>
  | Readonly<{
      readonly kind: "invalid-rows";
      readonly receivedRows: string;
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
}>;

export type BrunoTableSourceVersionSnapshot = Readonly<{
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
  readonly getSourceVersionSnapshot: () => BrunoTableSourceVersionSnapshot;
  readonly getBodySnapshot: () => BrunoTableBodySnapshot;
  readonly getRowSpaceSnapshot: () => BrunoTableRowSpaceSnapshot<unknown> | undefined;
  readonly getRowSnapshot: (rowId: BrunoTableRowId) => unknown;
  readonly getCellSnapshot: (rowId: BrunoTableRowId, columnId: string) => BrunoTableCellSnapshot;
  readonly getCellValueSnapshot: (rowId: BrunoTableRowId, columnId: string) => unknown;
  readonly getColumnCommandSnapshot: (columnId: string) => BrunoTableColumnCommandSnapshot;
  readonly getColumnFilterSnapshot: (columnId: string) => unknown;
  readonly getColumnFilterVersionSnapshot: (columnId: string) => number;
  readonly getQuickFilterSnapshot: () => string;
  readonly getQuickFilterFieldsSnapshot: () => readonly string[];
  readonly getSortingSnapshot: () => BrunoTableOrderBy;
  readonly getColumnLayoutSnapshot: () => BrunoTableColumnLayoutSnapshot;
  /** Controlled Client column input; width-only commits do not publish it. */
  readonly getColumnStructureSnapshot: () => BrunoTableColumnLayoutSnapshot;
  readonly subscribeChrome: (listener: Listener) => () => void;
  readonly subscribeSource: (listener: Listener) => () => void;
  readonly subscribeSourceVersion: (listener: Listener) => () => void;
  readonly subscribeBody: (listener: Listener) => () => void;
  readonly subscribeRowSpace: (listener: Listener) => () => void;
  readonly subscribeRow: (rowId: BrunoTableRowId, listener: Listener) => () => void;
  readonly subscribeCell: (
    rowId: BrunoTableRowId,
    columnId: string,
    listener: Listener,
  ) => () => void;
  readonly subscribeColumnCommands: (columnId: string, listener: Listener) => () => void;
  readonly subscribeColumnFilter: (columnId: string, listener: Listener) => () => void;
  readonly subscribeQuickFilter: (listener: Listener) => () => void;
  readonly subscribeSorting: (listener: Listener) => () => void;
  readonly subscribeColumnLayout: (listener: Listener) => () => void;
  readonly subscribeColumnStructure: (listener: Listener) => () => void;
  readonly dispatchGridCommand: (command: BrunoTableGridCommand) => void;
  readonly toggleColumnSort: (columnId: string, multi: boolean) => void;
  readonly clearColumnFilters: (columnId: string) => void;
  readonly resetColumnFilters: (columnId: string) => void;
  readonly retry: () => void;
};

export type BrunoTableRowPipelineRuntimeView = BrunoTableRuntimeView & {
  readonly getQuerySnapshot: () => BrunoTableQuerySnapshot;
  readonly subscribeQuery: (listener: Listener) => () => void;
  readonly publishRowPipeline: (publication: BrunoTableRowPipelinePublication<unknown>) => void;
};

export type BrunoTableQuerySnapshot = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly filters: readonly unknown[];
  readonly quickFilter: string;
  readonly orderBy: BrunoTableOrderBy;
  readonly generation: number;
}>;

export type BrunoTableQueryConfiguration = Readonly<{
  readonly baselineFilters: readonly unknown[];
  readonly baselineOrderBy: BrunoTableOrderBy;
  readonly quickFilterFields?: readonly string[];
}>;

export type BrunoTableColumnCommandSnapshot = Readonly<{
  readonly sortable: boolean;
  readonly sortDirection?: "asc" | "desc";
  readonly sortPriority?: number;
  readonly filterActive: boolean;
  readonly filterBaselineAvailable: boolean;
  readonly visible: boolean;
  readonly pinned?: "start" | "end";
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}>;

const BODY_ROWS: BrunoTableBodySnapshot = Object.freeze({ kind: "rows" });
const BODY_INVALID: BrunoTableBodySnapshot = Object.freeze({ kind: "invalid" });
const BODY_EMPTY: BrunoTableBodySnapshot = Object.freeze({ kind: "empty" });
const EMPTY_COLUMN_COMMAND: BrunoTableColumnCommandSnapshot = Object.freeze({
  sortable: false,
  filterActive: false,
  filterBaselineAvailable: false,
  visible: false,
  width: 0,
  minWidth: 0,
  maxWidth: 0,
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
  readonly sourceVersion: BrunoTableSourceVersionSnapshot;
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
const EMPTY_QUICK_FILTER_FIELDS: readonly string[] = Object.freeze([]);

type QueryTransition = Readonly<{
  readonly queryChanged: boolean;
  readonly quickFilterChanged: boolean;
  readonly sortingChanged: boolean;
  readonly previousCommands: ReadonlyMap<string, BrunoTableColumnCommandSnapshot>;
  readonly previousColumnFilters: ReadonlyMap<string, unknown>;
}>;

type ColumnConfiguration = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly baselineFilters: readonly unknown[];
  readonly baselineOrderBy: BrunoTableOrderBy;
  readonly query: BrunoTableQuerySnapshot;
  readonly columnCommands: Map<string, BrunoTableColumnCommandSnapshot>;
  readonly columnLayout: BrunoTableColumnLayoutState;
  readonly transition: QueryTransition;
}>;

export class BrunoTableGridRuntime<TRow> {
  private readonly chromeListeners = new Set<Listener>();
  private readonly sourceListeners = new Set<Listener>();
  private readonly sourceVersionListeners = new Set<Listener>();
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
  private readonly quickFilterListeners = new Set<Listener>();
  private readonly sortingListeners = new Set<Listener>();
  private readonly columnCommandListeners = new Map<string, Set<Listener>>();
  private readonly columnFilterListeners = new Map<string, Set<Listener>>();
  private readonly columnLayoutListeners = new Set<Listener>();
  private readonly columnStructureListeners = new Set<Listener>();
  private view: BrunoTableRowPipelineRuntimeView | undefined;
  private state: RuntimeState<TRow>;
  private publication: BrunoTableRowPipelinePublication<TRow>;
  private columns: readonly CompiledColumn[];
  private columnsById: ReadonlyMap<string, CompiledColumn>;
  private baselineFilters: readonly unknown[];
  private baselineOrderBy: BrunoTableOrderBy;
  private readonly quickFilterFields: readonly string[];
  private query: BrunoTableQuerySnapshot;
  private columnFilterSnapshots: ReadonlyMap<string, unknown>;
  private readonly columnFilterVersions = new Map<string, number>();
  private columnLayout: BrunoTableColumnLayoutState;
  private columnLayoutSnapshot: BrunoTableColumnLayoutSnapshot;
  private columnStructureSnapshot: BrunoTableColumnLayoutSnapshot;
  private columnCommands = new Map<string, BrunoTableColumnCommandSnapshot>();
  private readonly tableId: string;

  public constructor(
    publication: BrunoTableRowPipelinePublication<TRow>,
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration,
    tableId: string,
  ) {
    this.tableId = tableId;
    this.columns = columns;
    this.columnsById = indexColumns(columns);
    this.baselineFilters = queryConfiguration.baselineFilters;
    this.quickFilterFields = queryConfiguration.quickFilterFields ?? EMPTY_QUICK_FILTER_FIELDS;
    const normalizedBaselineOrderBy = reconcileBrunoTableOrderBy(
      queryConfiguration.baselineOrderBy,
      queryConfiguration.baselineOrderBy,
      columns,
    );
    this.baselineOrderBy = sameOrderBy(
      queryConfiguration.baselineOrderBy,
      normalizedBaselineOrderBy,
    )
      ? queryConfiguration.baselineOrderBy
      : normalizedBaselineOrderBy;
    this.query = Object.freeze({
      columns,
      filters: this.baselineFilters,
      quickFilter: "",
      orderBy: this.baselineOrderBy,
      generation: 0,
    });
    this.columnFilterSnapshots = createColumnFilterSnapshots(this.query.filters, columns);
    for (const columnId of this.columnFilterSnapshots.keys()) {
      this.columnFilterVersions.set(columnId, 0);
    }
    this.columnLayout = createBrunoTableColumnLayout(columns);
    this.columnLayoutSnapshot = getBrunoTableColumnLayoutSnapshot(this.columnLayout);
    this.columnStructureSnapshot = this.columnLayoutSnapshot;
    this.columnCommands = createColumnCommandSnapshots(
      columns,
      this.query,
      this.baselineFilters,
      undefined,
      this.columnLayoutSnapshot,
    );
    this.publication = publication;
    this.state = this.createState(publication);
  }

  public readonly getView = (): BrunoTableRowPipelineRuntimeView => {
    if (this.view === undefined) {
      this.view = Object.freeze({
        getChromeSnapshot: this.getChromeSnapshot,
        getSourceSnapshot: this.getSourceSnapshot,
        getSourceVersionSnapshot: this.getSourceVersionSnapshot,
        getBodySnapshot: this.getBodySnapshot,
        getRowSpaceSnapshot: this.getRowSpaceSnapshot,
        getRowSnapshot: this.getRowSnapshot,
        getCellSnapshot: this.getCellSnapshot,
        getCellValueSnapshot: this.getCellValueSnapshot,
        getQuerySnapshot: this.getQuerySnapshot,
        getQuickFilterSnapshot: this.getQuickFilterSnapshot,
        getQuickFilterFieldsSnapshot: this.getQuickFilterFieldsSnapshot,
        getColumnCommandSnapshot: this.getColumnCommandSnapshot,
        getColumnFilterSnapshot: this.getColumnFilterSnapshot,
        getColumnFilterVersionSnapshot: this.getColumnFilterVersionSnapshot,
        getSortingSnapshot: this.getSortingSnapshot,
        getColumnLayoutSnapshot: this.getColumnLayoutSnapshot,
        getColumnStructureSnapshot: this.getColumnStructureSnapshot,
        subscribeChrome: this.subscribeChrome,
        subscribeSource: this.subscribeSource,
        subscribeSourceVersion: this.subscribeSourceVersion,
        subscribeBody: this.subscribeBody,
        subscribeRowSpace: this.subscribeRowSpace,
        subscribeRow: this.subscribeRow,
        subscribeCell: this.subscribeCell,
        subscribeQuery: this.subscribeQuery,
        subscribeQuickFilter: this.subscribeQuickFilter,
        publishRowPipeline: this.publishRowPipeline,
        subscribeColumnCommands: this.subscribeColumnCommands,
        subscribeColumnFilter: this.subscribeColumnFilter,
        subscribeSorting: this.subscribeSorting,
        subscribeColumnLayout: this.subscribeColumnLayout,
        subscribeColumnStructure: this.subscribeColumnStructure,
        dispatchGridCommand: this.dispatchGridCommand,
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

  private readonly publishRowPipeline = (
    publication: BrunoTableRowPipelinePublication<unknown>,
  ): void => {
    this.publish(publication as BrunoTableRowPipelinePublication<TRow>);
  };

  public readonly reconcile = (
    publication: BrunoTableRowPipelinePublication<TRow>,
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration = Object.freeze({
      baselineFilters: this.baselineFilters,
      baselineOrderBy: this.baselineOrderBy,
      quickFilterFields: this.quickFilterFields,
    }),
  ): void => {
    const previous = this.state;
    const previousLayoutSnapshot = this.columnLayoutSnapshot;
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
      this.updateColumnFilterSnapshots();
      this.columnLayout = configuration.columnLayout;
      this.columnLayoutSnapshot = getBrunoTableColumnLayoutSnapshot(this.columnLayout);
      this.columnCommands = configuration.columnCommands;
    }
    this.publication = publication;
    const installed = stabilizeRuntimeState(previous, next);
    this.state = installed;
    const transitionError =
      configuration === undefined
        ? undefined
        : firstListenerError(
            firstListenerError(
              this.notifyQueryTransition(configuration.transition),
              this.notifyColumnLayoutTransition(previousLayoutSnapshot),
            ),
            this.notifyColumnStructureTransition(previousLayoutSnapshot),
          );
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
    const sourceVersionChanged = previous.sourceVersion !== next.sourceVersion;
    const bodyChanged = previous.body !== next.body;
    const rowSpaceChanged = previous.rowSpace !== next.rowSpace;
    this.state = next;

    let firstError: ListenerError | undefined;
    if (chromeChanged) firstError = notify(this.chromeListeners);
    if (sourceChanged) firstError = firstListenerError(firstError, notify(this.sourceListeners));
    if (sourceVersionChanged) {
      firstError = firstListenerError(firstError, notify(this.sourceVersionListeners));
    }
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

  public readonly getSourceVersionSnapshot = (): BrunoTableSourceVersionSnapshot =>
    this.state.sourceVersion;

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

  public readonly getQuickFilterSnapshot = (): string => this.query.quickFilter;

  public readonly getQuickFilterFieldsSnapshot = (): readonly string[] => this.quickFilterFields;

  public readonly getSortingSnapshot = (): BrunoTableOrderBy => this.query.orderBy;

  public readonly getColumnCommandSnapshot = (columnId: string): BrunoTableColumnCommandSnapshot =>
    this.columnCommands.get(columnId) ?? EMPTY_COLUMN_COMMAND;

  public readonly getColumnFilterSnapshot = (columnId: string): unknown =>
    this.columnFilterSnapshots.get(columnId);

  public readonly getColumnFilterVersionSnapshot = (columnId: string): number =>
    this.columnFilterVersions.get(columnId) ?? 0;

  public readonly getColumnLayoutSnapshot = (): BrunoTableColumnLayoutSnapshot =>
    this.columnLayoutSnapshot;

  public readonly getColumnStructureSnapshot = (): BrunoTableColumnLayoutSnapshot =>
    this.columnStructureSnapshot;

  public readonly subscribeChrome = (listener: Listener): (() => void) =>
    subscribe(this.chromeListeners, listener);

  public readonly subscribeSource = (listener: Listener): (() => void) =>
    subscribe(this.sourceListeners, listener);

  public readonly subscribeSourceVersion = (listener: Listener): (() => void) =>
    subscribe(this.sourceVersionListeners, listener);

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

  public readonly subscribeQuickFilter = (listener: Listener): (() => void) =>
    subscribe(this.quickFilterListeners, listener);

  public readonly subscribeSorting = (listener: Listener): (() => void) =>
    subscribe(this.sortingListeners, listener);

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

  public readonly subscribeColumnFilter = (columnId: string, listener: Listener): (() => void) => {
    let listeners = this.columnFilterListeners.get(columnId);
    if (listeners === undefined) {
      listeners = new Set<Listener>();
      this.columnFilterListeners.set(columnId, listeners);
    }
    listeners.add(listener);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableColumnFilterSubscriptionEvent(
        this.tableId,
        columnId,
        listeners.size,
        "subscribe",
      );
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.columnFilterListeners.get(columnId) !== listeners) return;
      listeners.delete(listener);
      if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
        recordBrunoTableColumnFilterSubscriptionEvent(
          this.tableId,
          columnId,
          listeners.size,
          "unsubscribe",
        );
      }
      if (listeners.size === 0) this.columnFilterListeners.delete(columnId);
    };
  };

  public readonly subscribeColumnLayout = (listener: Listener): (() => void) =>
    subscribe(this.columnLayoutListeners, listener);

  public readonly subscribeColumnStructure = (listener: Listener): (() => void) =>
    subscribe(this.columnStructureListeners, listener);

  public readonly dispatchGridCommand = (command: BrunoTableGridCommand): void => {
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      recordBrunoTableGridCommand(this.tableId, command);
    }
    if (isBrunoTableSortingCommand(command)) {
      const nextOrderBy = applyBrunoTableSortingCommand(
        this.query.orderBy,
        this.baselineOrderBy,
        this.columns,
        command,
      );
      this.publishQuery(this.query.filters, nextOrderBy);
      return;
    }
    if (command.type === "column.filter.clear") {
      this.clearColumnFiltersImpl(command.columnId);
      return;
    }
    if (command.type === "column.filter.reset") {
      this.resetColumnFiltersImpl(command.columnId);
      return;
    }
    if (command.type === "column.filter.replace") {
      this.replaceColumnFilterImpl(command.columnId, command.filter);
      return;
    }
    if (command.type === "quick-filter.replace") {
      this.publishQuery(this.query.filters, this.query.orderBy, command.text);
      return;
    }
    if (!isBrunoTableColumnLayoutCommand(command)) return;
    const previousLayoutSnapshot = this.columnLayoutSnapshot;
    const previousCommands = this.columnCommands;
    const nextLayout = applyBrunoTableGridCommand(this.columnLayout, command);
    if (nextLayout === this.columnLayout) return;
    this.columnLayout = nextLayout;
    this.columnLayoutSnapshot = getBrunoTableColumnLayoutSnapshot(nextLayout);
    this.columnCommands = createColumnCommandSnapshots(
      this.columns,
      this.query,
      this.baselineFilters,
      previousCommands,
      this.columnLayoutSnapshot,
    );
    const error = firstListenerError(
      this.notifyColumnLayoutTransition(previousLayoutSnapshot, previousCommands),
      this.notifyColumnStructureTransition(previousLayoutSnapshot),
    );
    if (error !== undefined) throw error.value;
  };

  public readonly toggleColumnSort = (columnId: string, multi: boolean): void => {
    this.dispatchGridCommand({ type: "column.sort.toggle", columnId, multi });
  };

  public readonly clearColumnFilters = (columnId: string): void => {
    this.dispatchGridCommand({ type: "column.filter.clear", columnId });
  };

  private readonly clearColumnFiltersImpl = (columnId: string): void => {
    const next = this.query.filters.filter(
      (filter) => !brunoTableFilterReferencesColumn(filter, columnId),
    );
    if (next.length === this.query.filters.length) return;
    this.publishQuery(Object.freeze(next), this.query.orderBy);
  };

  private readonly replaceColumnFilterImpl = (columnId: string, candidate: unknown): void => {
    const replacement =
      candidate === undefined ? [] : sanitizeBrunoTableFilters([candidate], this.columns);
    if (candidate !== undefined && replacement.length === 0) return;
    if (
      replacement.length > 1 ||
      (replacement.length === 1 && !brunoTableFilterReferencesColumn(replacement[0], columnId))
    ) {
      return;
    }
    const currentColumnFilters = this.query.filters.filter((filter) =>
      brunoTableFilterReferencesColumn(filter, columnId),
    );
    if (replacement.length === 0 && currentColumnFilters.length === 0) return;
    if (
      candidate !== undefined &&
      replacement.length === 1 &&
      currentColumnFilters.length === 1 &&
      sameFilterValue(currentColumnFilters[0], replacement[0], this.columnsById)
    ) {
      return;
    }
    const withoutColumn = this.query.filters.filter(
      (filter) => !brunoTableFilterReferencesColumn(filter, columnId),
    );
    const next = Object.freeze([...withoutColumn, ...replacement]);
    this.publishQuery(next, this.query.orderBy);
  };

  public readonly resetColumnFilters = (columnId: string): void => {
    this.dispatchGridCommand({ type: "column.filter.reset", columnId });
  };

  private readonly resetColumnFiltersImpl = (columnId: string): void => {
    const withoutColumn = this.query.filters.filter(
      (filter) => !brunoTableFilterReferencesColumn(filter, columnId),
    );
    const baseline = this.baselineFilters.filter((filter) =>
      brunoTableFilterReferencesColumn(filter, columnId),
    );
    const next = Object.freeze([...withoutColumn, ...baseline]);
    if (sameFilterCollection(this.query.filters, next, this.columnsById)) return;
    this.publishQuery(next, this.query.orderBy);
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
    });
    const sourceVersion = Object.freeze({ version: publication.version });
    const body = bodySnapshot(publication);
    return Object.freeze({ chrome, source, sourceVersion, body, rowSpace });
  }

  private stageColumns(
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration,
  ): ColumnConfiguration {
    const baselineFilters = queryConfiguration.baselineFilters;
    const baselineOrderBy = queryConfiguration.baselineOrderBy;
    const nextFilters = sanitizeBrunoTableFilters(this.query.filters, columns);
    const nextOrderBy = reconcileBrunoTableOrderBy(this.query.orderBy, baselineOrderBy, columns);
    const nextQuickFilter = this.query.quickFilter;
    const semanticsChanged =
      !sameReferences(this.query.filters, nextFilters) ||
      !sameOrderBy(this.query.orderBy, nextOrderBy) ||
      this.query.quickFilter !== nextQuickFilter ||
      activeQuerySemanticsChanged(this.columns, columns, this.query);
    const query = Object.freeze({
      columns,
      filters: nextFilters,
      quickFilter: nextQuickFilter,
      orderBy: nextOrderBy,
      generation: semanticsChanged ? this.query.generation + 1 : this.query.generation,
    });
    const columnLayout = reconcileBrunoTableColumnLayout(
      this.columnLayout,
      columns,
      this.columnLayout.version + 1,
    );
    const columnCommands = createColumnCommandSnapshots(
      columns,
      query,
      baselineFilters,
      this.columnCommands,
      getBrunoTableColumnLayoutSnapshot(columnLayout),
    );
    return Object.freeze({
      columns,
      baselineFilters,
      baselineOrderBy,
      query,
      columnCommands,
      columnLayout,
      transition: Object.freeze({
        queryChanged: true,
        quickFilterChanged: this.query.quickFilter !== nextQuickFilter,
        sortingChanged: !sameOrderBy(this.query.orderBy, nextOrderBy),
        previousCommands: this.columnCommands,
        previousColumnFilters: this.columnFilterSnapshots,
      }),
    });
  }

  private publishQuery(
    filters: readonly unknown[],
    orderBy: BrunoTableOrderBy,
    quickFilter = this.query.quickFilter,
    forceColumnRefresh = false,
  ): void {
    const transition = this.updateQuery(filters, orderBy, quickFilter, forceColumnRefresh);
    if (transition === undefined) return;
    const error = this.notifyQueryTransition(transition);
    if (error !== undefined) throw error.value;
  }

  private updateQuery(
    filters: readonly unknown[],
    orderBy: BrunoTableOrderBy,
    quickFilter: string,
    forceColumnRefresh = false,
  ): QueryTransition | undefined {
    const sortingChanged = !sameOrderBy(this.query.orderBy, orderBy);
    const quickFilterChanged = this.query.quickFilter !== quickFilter;
    const quickFilterSemanticsChanged =
      normalizeBrunoTableFilterText(this.query.quickFilter) !==
      normalizeBrunoTableFilterText(quickFilter);
    const queryChanged =
      !sameReferences(this.query.filters, filters) || sortingChanged || quickFilterSemanticsChanged;
    if (!queryChanged && !quickFilterChanged && !forceColumnRefresh) return undefined;
    const previousCommands = this.columnCommands;
    const previousColumnFilters = this.columnFilterSnapshots;
    if (queryChanged) {
      this.query = Object.freeze({
        columns: this.columns,
        filters,
        quickFilter,
        orderBy,
        generation: this.query.generation + 1,
      });
      this.updateColumnFilterSnapshots();
    } else if (quickFilterChanged) {
      this.query = Object.freeze({ ...this.query, quickFilter });
    }
    this.columnCommands = createColumnCommandSnapshots(
      this.columns,
      this.query,
      this.baselineFilters,
      previousCommands,
      this.columnLayoutSnapshot,
    );
    return Object.freeze({
      queryChanged,
      quickFilterChanged,
      sortingChanged,
      previousCommands,
      previousColumnFilters,
    });
  }

  private notifyQueryTransition(transition: QueryTransition): ListenerError | undefined {
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__ && transition.queryChanged) {
      recordBrunoTableClientQueryTransition(this.tableId, this.query.generation);
    }
    let firstError = transition.queryChanged ? notify(this.queryListeners) : undefined;
    if (transition.quickFilterChanged) {
      firstError = firstListenerError(firstError, notify(this.quickFilterListeners));
    }
    if (transition.sortingChanged) {
      firstError = firstListenerError(firstError, notify(this.sortingListeners));
    }
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
          if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
            recordBrunoTableColumnCommandSubscriptionNotification(
              this.tableId,
              columnId,
              listeners.size,
            );
          }
          firstError = firstListenerError(firstError, notify(listeners));
        }
      }
    }
    const filterColumnIds = new Set([
      ...transition.previousColumnFilters.keys(),
      ...this.columnFilterSnapshots.keys(),
      ...this.columnFilterListeners.keys(),
    ]);
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
      for (const column of this.columns) filterColumnIds.add(column.columnId);
    }
    for (const columnId of filterColumnIds) {
      const listeners = this.columnFilterListeners.get(columnId);
      if (
        Object.is(
          transition.previousColumnFilters.get(columnId),
          this.columnFilterSnapshots.get(columnId),
        )
      ) {
        continue;
      }
      if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
        recordBrunoTableColumnFilterSubscriptionEvent(
          this.tableId,
          columnId,
          listeners?.size ?? 0,
          "notify",
        );
      }
      if (listeners !== undefined) {
        firstError = firstListenerError(firstError, notify(listeners));
      }
    }
    return firstError;
  }

  private updateColumnFilterSnapshots(): void {
    const next = createColumnFilterSnapshots(
      this.query.filters,
      this.columns,
      this.columnFilterSnapshots,
    );
    const columnIds = new Set([...this.columnFilterSnapshots.keys(), ...next.keys()]);
    for (const columnId of columnIds) {
      if (Object.is(this.columnFilterSnapshots.get(columnId), next.get(columnId))) continue;
      this.columnFilterVersions.set(columnId, (this.columnFilterVersions.get(columnId) ?? 0) + 1);
    }
    this.columnFilterSnapshots = next;
    const currentColumnIds = new Set<string>(this.columns.map((column) => column.columnId));
    for (const columnId of this.columnFilterVersions.keys()) {
      if (!currentColumnIds.has(columnId)) this.columnFilterVersions.delete(columnId);
    }
  }

  private notifyColumnLayoutTransition(
    previous: BrunoTableColumnLayoutSnapshot,
    previousCommands: ReadonlyMap<string, BrunoTableColumnCommandSnapshot> = this.columnCommands,
  ): ListenerError | undefined {
    let firstError =
      previous.version === this.columnLayoutSnapshot.version
        ? undefined
        : notify(this.columnLayoutListeners);
    const columnIds = new Set([...previousCommands.keys(), ...this.columnCommands.keys()]);
    for (const columnId of columnIds) {
      if (!sameColumnCommand(previousCommands.get(columnId), this.columnCommands.get(columnId))) {
        const listeners = this.columnCommandListeners.get(columnId);
        if (listeners !== undefined) {
          if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
            recordBrunoTableColumnCommandSubscriptionNotification(
              this.tableId,
              columnId,
              listeners.size,
            );
          }
          firstError = firstListenerError(firstError, notify(listeners));
        }
      }
    }
    return firstError;
  }

  private notifyColumnStructureTransition(
    previous: BrunoTableColumnLayoutSnapshot,
  ): ListenerError | undefined {
    if (sameColumnProjection(previous, this.columnLayoutSnapshot)) return undefined;
    this.columnStructureSnapshot = this.columnLayoutSnapshot;
    return notify(this.columnStructureListeners);
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

function createColumnFilterSnapshots(
  filters: readonly unknown[],
  columns: readonly CompiledColumn[],
  previousSnapshots?: ReadonlyMap<string, unknown>,
): ReadonlyMap<string, unknown> {
  const entries = new Map<string, unknown[]>();
  for (const filter of filters) {
    for (const column of columns) {
      if (!brunoTableFilterReferencesColumn(filter, column.columnId)) continue;
      const values = entries.get(column.columnId);
      if (values === undefined) entries.set(column.columnId, [filter]);
      else values.push(filter);
    }
  }
  const snapshots = new Map<string, unknown>();
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  for (const [columnId, values] of entries) {
    if (values.length === 1) {
      snapshots.set(columnId, values[0]);
      continue;
    }
    const previous = previousSnapshots?.get(columnId);
    if (
      Array.isArray(previous) &&
      previous.length === values.length &&
      values.every((value, index) => sameFilterValue(previous[index], value, columnsById))
    ) {
      snapshots.set(columnId, previous);
    } else {
      snapshots.set(columnId, Object.freeze(Array.from(values)));
    }
  }
  return snapshots;
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
  if (
    previous.value === null ||
    previous.value === undefined ||
    next.value === null ||
    next.value === undefined
  ) {
    return false;
  }
  const column = next.column;
  return (
    column !== undefined &&
    column.semantics.equivalent(previous.value, next.value) &&
    column.semantics.formatDisplay(previous.value) === column.semantics.formatDisplay(next.value)
  );
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
  if (previous.kind === "invalid-status" && next.kind === "invalid-status") {
    return previous.receivedStatus === next.receivedStatus;
  }
  if (previous.kind === "invalid-lifecycle" && next.kind === "invalid-lifecycle") {
    return previous.field === next.field;
  }
  if (previous.kind === "invalid-rows" && next.kind === "invalid-rows") {
    return previous.receivedRows === next.receivedRows;
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
  return previous.totalRows === next.totalRows && previous.loadedRows === next.loadedRows;
}

function sameSourceVersion(
  previous: BrunoTableSourceVersionSnapshot,
  next: BrunoTableSourceVersionSnapshot,
): boolean {
  return previous.version === next.version;
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
    sourceVersion: sameSourceVersion(previous.sourceVersion, next.sourceVersion)
      ? previous.sourceVersion
      : next.sourceVersion,
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
    (publication.invalid?.kind === "invalid-value" ||
      publication.invalid?.kind === "invalid-status" ||
      publication.invalid?.kind === "invalid-lifecycle" ||
      publication.invalid?.kind === "invalid-rows") &&
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
  layout?: BrunoTableColumnLayoutSnapshot,
): Map<string, BrunoTableColumnCommandSnapshot> {
  const snapshots = new Map<string, BrunoTableColumnCommandSnapshot>();
  const layoutById = new Map(
    (layout?.allColumns ?? columns).map((column) => [column.columnId, column]),
  );
  const baselineById = new Map(
    (layout?.baselineColumns ?? columns).map((column) => [column.columnId, column]),
  );
  const visibleIds = new Set(layout?.visibleColumnIds ?? columns.map((column) => column.columnId));
  for (const column of columns) {
    const sortIndex = query.orderBy.findIndex((sort) => sort.columnId === column.columnId);
    const sort = query.orderBy[sortIndex];
    const layoutColumn = layoutById.get(column.columnId);
    const widthColumn = layoutColumn ?? column;
    const widthBounds = getBrunoTableColumnWidthBounds(
      widthColumn,
      baselineById.get(column.columnId)?.semantics.width ?? widthColumn.semantics.width,
    );
    const next = Object.freeze({
      sortable: column.enableSorting !== false,
      ...(sort === undefined ? {} : { sortDirection: sort.direction, sortPriority: sortIndex + 1 }),
      filterActive: query.filters.some((filter) =>
        brunoTableFilterReferencesColumn(filter, column.columnId),
      ),
      filterBaselineAvailable: baselineFilters.some((filter) =>
        brunoTableFilterReferencesColumn(filter, column.columnId),
      ),
      visible: visibleIds.has(column.columnId),
      ...(layoutColumn?.pinned === undefined ? {} : { pinned: layoutColumn.pinned }),
      width: layoutColumn?.semantics.width ?? column.semantics.width,
      minWidth: widthBounds.min,
      maxWidth: widthBounds.max,
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
    previous?.filterBaselineAvailable === next?.filterBaselineAvailable &&
    previous?.visible === next?.visible &&
    previous?.pinned === next?.pinned &&
    previous?.width === next?.width &&
    previous?.minWidth === next?.minWidth &&
    previous?.maxWidth === next?.maxWidth
  );
}

function sameReferences(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function sameFilterCollection(
  previous: readonly unknown[],
  next: readonly unknown[],
  columnsById: ReadonlyMap<string, CompiledColumn>,
): boolean {
  if (previous.length !== next.length) return false;
  const matched = new Set<number>();
  return previous.every((value) => {
    for (let index = 0; index < next.length; index += 1) {
      if (matched.has(index)) continue;
      if (!sameFilterValue(value, next[index], columnsById)) continue;
      matched.add(index);
      return true;
    }
    return false;
  });
}

function sameFilterValue(
  previous: unknown,
  next: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  column?: CompiledColumn,
  seen: WeakMap<object, object> = new WeakMap(),
): boolean {
  try {
    if (Object.is(previous, next)) return true;
    if (Array.isArray(previous) && Array.isArray(next)) {
      return (
        previous.length === next.length &&
        previous.every((value, index) =>
          sameFilterValue(value, next[index], columnsById, column, seen),
        )
      );
    }
    if (
      typeof previous !== "object" ||
      previous === null ||
      typeof next !== "object" ||
      next === null
    ) {
      return false;
    }
    const previousRecord = previous as Readonly<Record<PropertyKey, unknown>>;
    const nextRecord = next as Readonly<Record<PropertyKey, unknown>>;
    const previousColumnId = previousRecord["columnId"];
    const nextColumnId = nextRecord["columnId"];
    const valueColumn =
      column ??
      (typeof previousColumnId === "string" && previousColumnId === nextColumnId
        ? columnsById.get(previousColumnId)
        : undefined);
    const remembered = seen.get(previous);
    if (remembered !== undefined) return remembered === next;
    seen.set(previous, next);
    if (Object.getPrototypeOf(previous) !== Object.getPrototypeOf(next)) return false;
    if (!isPlainFilterRecord(previous) || !isPlainFilterRecord(next)) return false;
    const previousKeys = Reflect.ownKeys(previous).filter(
      (key) => !isImplicitFalseTextSensitivity(previousRecord, key),
    );
    const nextKeys = Reflect.ownKeys(next).filter(
      (key) => !isImplicitFalseTextSensitivity(nextRecord, key),
    );
    if (previousKeys.length !== nextKeys.length) return false;
    const operator =
      previousRecord["type"] === nextRecord["type"] && typeof previousRecord["type"] === "string"
        ? previousRecord["type"]
        : undefined;
    const rawTextOperand =
      valueColumn?.semantics.filterFamily === "text" &&
      (operator === "contains" ||
        operator === "notContains" ||
        operator === "startsWith" ||
        operator === "endsWith");
    const textOperand =
      valueColumn?.semantics.filterFamily === "text" &&
      (operator === "equals" ||
        operator === "notEqual" ||
        operator === "in" ||
        operator === "contains" ||
        operator === "notContains" ||
        operator === "startsWith" ||
        operator === "endsWith");
    const operandOptions = {
      accentSensitive: previousRecord["accentSensitive"] === true,
      caseSensitive: previousRecord["caseSensitive"] === true,
      raw: rawTextOperand,
      text: textOperand,
    } as const;
    return previousKeys.every((key) => {
      if (!nextKeys.includes(key)) return false;
      const previousValue = previousRecord[key];
      const nextValue = nextRecord[key];
      if (
        key === "conditions" &&
        (operator === "AND" || operator === "OR") &&
        Array.isArray(previousValue) &&
        Array.isArray(nextValue)
      ) {
        return sameFilterCollection(previousValue, nextValue, columnsById);
      }
      if ((key === "filter" || key === "filterTo") && valueColumn !== undefined) {
        return sameFilterOperand(
          previousValue,
          nextValue,
          valueColumn,
          key === "filter" && operator === "in"
            ? { ...operandOptions, unordered: true }
            : { ...operandOptions, unordered: false },
        );
      }
      return sameFilterValue(previousValue, nextValue, columnsById, valueColumn, seen);
    });
  } catch {
    return false;
  }
}

function isImplicitFalseTextSensitivity(
  record: Readonly<Record<PropertyKey, unknown>>,
  key: PropertyKey,
): boolean {
  return (key === "caseSensitive" || key === "accentSensitive") && record[key] === false;
}

function sameFilterOperand(
  previous: unknown,
  next: unknown,
  column: CompiledColumn,
  options: Readonly<{
    readonly accentSensitive: boolean;
    readonly caseSensitive: boolean;
    readonly raw: boolean;
    readonly text: boolean;
    readonly unordered: boolean;
  }>,
): boolean {
  if (Object.is(previous, next)) return true;
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (options.unordered) {
      return (
        previous.every((value) =>
          next.some((candidate) =>
            sameFilterOperand(value, candidate, column, { ...options, unordered: false }),
          ),
        ) &&
        next.every((value) =>
          previous.some((candidate) =>
            sameFilterOperand(value, candidate, column, { ...options, unordered: false }),
          ),
        )
      );
    }
    return (
      previous.length === next.length &&
      previous.every((value, index) =>
        sameFilterOperand(value, next[index], column, { ...options, unordered: false }),
      )
    );
  }
  if (previous === null || next === null || previous === undefined || next === undefined) {
    return false;
  }
  if (options.raw) {
    if (typeof previous !== "string" || typeof next !== "string") return false;
    return (
      normalizeBrunoTableFilterText(previous, options.caseSensitive, options.accentSensitive) ===
      normalizeBrunoTableFilterText(next, options.caseSensitive, options.accentSensitive)
    );
  }
  if (options.text) {
    try {
      return (
        normalizeBrunoTableFilterText(
          column.semantics.formatCanonicalText(previous),
          options.caseSensitive,
          options.accentSensitive,
        ) ===
        normalizeBrunoTableFilterText(
          column.semantics.formatCanonicalText(next),
          options.caseSensitive,
          options.accentSensitive,
        )
      );
    } catch {
      return false;
    }
  }
  try {
    return column.semantics.equivalent(previous, next);
  } catch {
    return false;
  }
}

function isPlainFilterRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameColumnProjection(
  previous: BrunoTableColumnLayoutSnapshot,
  next: BrunoTableColumnLayoutSnapshot,
): boolean {
  return (
    sameColumnIdentityAndPinning(previous.allColumns, next.allColumns) &&
    sameStringArray(previous.visibleColumnIds, next.visibleColumnIds)
  );
}

function sameColumnIdentityAndPinning(
  previous: readonly CompiledColumn[],
  next: readonly CompiledColumn[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (column, index) =>
        column.columnId === next[index]?.columnId && column.pinned === next[index]?.pinned,
    )
  );
}

function sameStringArray(previous: readonly string[], next: readonly string[]): boolean {
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
