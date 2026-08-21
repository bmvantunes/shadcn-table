import type {
  BrunoTableJsonValue,
  BrunoTableRowId,
  BrunoTableSourceRetry,
  BrunoTableSourceStatus,
} from "../public-types";
import type { CompiledColumn } from "./compile-columns";
import {
  applyBrunoTableGridCommand,
  getBrunoTableColumnWidthBounds,
  getBrunoTableColumnLayoutSnapshot,
  isBrunoTableColumnLayoutCommand,
  reconcileBrunoTableColumnLayout,
  type BrunoTableColumnLayoutSnapshot,
  type BrunoTableColumnLayoutState,
  type BrunoTableGridCommand,
} from "./column-management";
import type {
  BrunoTableClientFilterCollection,
  BrunoTableFilterComplexity,
  BrunoTableOrderBy,
} from "./grid-query";
import {
  compileClientFilterCollection,
  normalizeBrunoTableFilterText,
  reconcileBrunoTableOrderBy,
  removeClientFilterColumn,
  replaceClientFilterColumn,
  restoreClientFilterColumn,
  sameBrunoTableFilterColumn,
  sameBrunoTableFilterCollections,
} from "./grid-query";
import { recordBrunoTableGridCommand } from "./grid-command-instrumentation";
import {
  recordBrunoTableColumnCommandSubscriptionNotification,
  recordBrunoTableColumnFilterSubscriptionEvent,
} from "./grid-subscription-instrumentation";
import { recordBrunoTableClientQueryTransition } from "./render-instrumentation";
import { isBrunoTableQuickFilterTextWithinLimit } from "./quick-filter";
import { applyBrunoTableSortingCommand, isBrunoTableSortingCommand } from "./sorting";
import {
  createBrunoTableGridPreferences,
  createBrunoTablePersistedState,
} from "./grid-preferences";

type Listener = () => void;
/**
 * Optional editor-owned gate for commands that can change the filtered row projection.
 * The registered editor owns parsing, validation, and focus restoration; returning false
 * rejects the filter command before it is instrumented or published. Client editing is
 * intentionally not installed by the current read-only filter slice, but this seam keeps
 * future editor capabilities out of the filter controls and command implementations.
 */
export type BrunoTableActiveEditorCommitGate = () => boolean;

export type BrunoTableGridPreferencesRuntimeOptions = Readonly<{
  readonly initialPersistedState?: unknown;
  readonly getOnPersistChange?: () =>
    | ((state: Readonly<Record<string, BrunoTableJsonValue>>) => void)
    | undefined;
}>;

function isBrunoTableFilterCommand(command: BrunoTableGridCommand): boolean {
  switch (command.type) {
    case "column.filter.clear":
    case "column.filters.clear":
    case "column.filter.reset":
    case "column.filter.replace":
    case "quick-filter.replace":
      return true;
    case "column.resize.commit":
    case "column.reorder.commit":
    case "column.visibility.commit":
    case "column.pin.commit":
    case "column.reset.order":
    case "column.reset.widths":
    case "column.reset.visibility":
    case "column.reset.pinning":
    case "column.reset.layout":
    case "column.sort.toggle":
    case "sorting.add":
    case "sorting.remove":
    case "sorting.move":
    case "sorting.reset":
      return false;
    default:
      return assertNeverBrunoTableGridCommand(command);
  }
}

function isBrunoTableDurablePreferenceCommand(command: BrunoTableGridCommand): boolean {
  switch (command.type) {
    case "column.resize.commit":
    case "column.reorder.commit":
    case "column.visibility.commit":
    case "column.pin.commit":
    case "column.reset.order":
    case "column.reset.widths":
    case "column.reset.visibility":
    case "column.reset.pinning":
    case "column.reset.layout":
    case "column.sort.toggle":
    case "sorting.add":
    case "sorting.remove":
    case "sorting.move":
    case "sorting.reset":
    case "column.filter.clear":
    case "column.filters.clear":
    case "column.filter.reset":
    case "column.filter.replace":
      return true;
    case "quick-filter.replace":
      return false;
    default:
      return assertNeverBrunoTableGridCommand(command);
  }
}

function assertNeverBrunoTableGridCommand(value: never): never {
  throw new TypeError(`Unsupported BrunoTable grid command: ${String(value)}`);
}

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

export type BrunoTableQueryNavigationMode = "reset" | "reconcile" | "clear";

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
  /** Invalidates queued editor candidates even when a Clear/Reset command is a semantic no-op. */
  readonly getColumnFilterCommandEpochSnapshot: (columnId: string) => number;
  readonly getFilterComplexitySnapshot: () => BrunoTableFilterComplexity;
  readonly getQuickFilterSnapshot: () => string;
  /** Resets Client filter position for committed raw text changes that preserve semantics. */
  readonly getFilterPositionResetEpochSnapshot: () => number;
  /** Invalidates queued Quick Filter candidates when any Quick Filter command commits. */
  readonly getQuickFilterCommandEpochSnapshot: () => number;
  readonly getQuickFilterFieldsSnapshot: () => readonly string[];
  readonly getSortingSnapshot: () => BrunoTableOrderBy;
  readonly getLoadedRowCountSnapshot: () => number;
  readonly getActiveFilterCountSnapshot: () => number;
  readonly getActiveSortCountSnapshot: () => number;
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
  readonly subscribeColumnFilterCommandEpoch: (columnId: string, listener: Listener) => () => void;
  readonly subscribeQuickFilter: (listener: Listener) => () => void;
  readonly subscribeFilterPositionReset: (listener: Listener) => () => void;
  readonly subscribeQuickFilterCommandEpoch: (listener: Listener) => () => void;
  /** Imperative invalidation sink for same-value Quick Filter command cancellation. */
  readonly registerQuickFilterInvalidation: (listener: Listener) => () => void;
  readonly subscribeSorting: (listener: Listener) => () => void;
  readonly subscribeLoadedRowCount: (listener: Listener) => () => void;
  readonly subscribeActiveFilterCount: (listener: Listener) => () => void;
  readonly subscribeActiveSortCount: (listener: Listener) => () => void;
  readonly subscribeColumnLayout: (listener: Listener) => () => void;
  readonly subscribeColumnStructure: (listener: Listener) => () => void;
  readonly registerActiveEditorCommitGate: (gate: BrunoTableActiveEditorCommitGate) => () => void;
  readonly dispatchGridCommand: (command: BrunoTableGridCommand) => boolean;
  readonly toggleColumnSort: (columnId: string, multi: boolean) => void;
  readonly clearColumnFilters: (columnId: string) => void;
  readonly resetColumnFilters: (columnId: string) => void;
  readonly retry: () => void;
};

export type BrunoTableRowPipelineRuntimeView = BrunoTableRuntimeView & {
  readonly getFilterSnapshot: () => BrunoTableFilterSnapshot;
  readonly getQuerySnapshot: () => BrunoTableQuerySnapshot;
  readonly subscribeFilter: (listener: Listener) => () => void;
  readonly subscribeQuery: (listener: Listener) => () => void;
  /**
   * Accepts authoritative Adapter input during runtime notifications. When a publication pass is
   * already active, that pass completes first; re-entrant publications then apply in call order
   * before the outer publication returns or rethrows its first listener failure.
   */
  readonly publishRowPipeline: (publication: BrunoTableRowPipelinePublication<unknown>) => void;
};

export type BrunoTableFilterSnapshot = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly filters: readonly unknown[];
  /** Runtime-owned immutable lookup used by active-filter review without reparsing the root AST. */
  readonly filtersByColumn: Readonly<{
    readonly get: (columnId: string) => unknown;
  }>;
  /** Bounded label compiled with the admitted column expression for active-filter review. */
  readonly activeFilterLabelsByColumn: Readonly<{
    readonly get: (columnId: string) => string | undefined;
  }>;
  readonly quickFilter: string;
}>;

export type BrunoTableQuerySnapshot = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly filters: readonly unknown[];
  readonly filterCollection: BrunoTableClientFilterCollection;
  readonly quickFilter: string;
  readonly orderBy: BrunoTableOrderBy;
  readonly generation: number;
  /** Immutable Active Cell policy for this exact query generation. */
  readonly navigationMode: BrunoTableQueryNavigationMode;
}>;

function createFilterSnapshot(
  query: BrunoTableQuerySnapshot,
  filtersByColumn: ReadonlyMap<string, unknown>,
  activeFilterLabelsByColumn: ReadonlyMap<string, string>,
): BrunoTableFilterSnapshot {
  return Object.freeze({
    columns: query.columns,
    filters: query.filters,
    filtersByColumn: createFilterColumnIndex(filtersByColumn),
    activeFilterLabelsByColumn: createFilterLabelIndex(activeFilterLabelsByColumn),
    quickFilter: query.quickFilter,
  });
}

function createFilterColumnIndex(
  filtersByColumn: ReadonlyMap<string, unknown>,
): Readonly<{ readonly get: (columnId: string) => unknown }> {
  const snapshot = new Map(filtersByColumn);
  return Object.freeze({ get: (columnId: string): unknown => snapshot.get(columnId) });
}

function createFilterLabelIndex(
  activeFilterLabelsByColumn: ReadonlyMap<string, string>,
): Readonly<{ readonly get: (columnId: string) => string | undefined }> {
  const snapshot = new Map(activeFilterLabelsByColumn);
  return Object.freeze({
    get: (columnId: string): string | undefined => snapshot.get(columnId),
  });
}

function createQuerySnapshot(
  columns: readonly CompiledColumn[],
  filterCollection: BrunoTableClientFilterCollection,
  quickFilter: string,
  orderBy: BrunoTableOrderBy,
  generation: number,
  navigationMode: BrunoTableQueryNavigationMode = "reset",
): BrunoTableQuerySnapshot {
  const snapshot = {
    columns,
    filters: filterCollection.filters,
    quickFilter,
    orderBy,
    generation,
  } as BrunoTableQuerySnapshot & { filterCollection: BrunoTableClientFilterCollection };
  Object.defineProperty(snapshot, "filterCollection", {
    configurable: false,
    enumerable: false,
    value: filterCollection,
    writable: false,
  });
  Object.defineProperty(snapshot, "navigationMode", {
    configurable: false,
    enumerable: false,
    value: navigationMode,
    writable: false,
  });
  return Object.freeze(snapshot);
}

export type BrunoTableQueryConfiguration = Readonly<{
  readonly baselineFilters: readonly unknown[];
  readonly baselineFilterCollection?: BrunoTableClientFilterCollection;
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
  readonly filterChanged: boolean;
  readonly queryChanged: boolean;
  readonly quickFilterChanged: boolean;
  readonly sortingChanged: boolean;
  readonly activeFilterCountChanged: boolean;
  readonly activeSortCountChanged: boolean;
  readonly previousCommands: ReadonlyMap<string, BrunoTableColumnCommandSnapshot>;
  readonly previousColumnFilters: ReadonlyMap<string, unknown>;
}>;

type ColumnConfiguration = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly baselineFilters: readonly unknown[];
  readonly baselineFilterCollection: BrunoTableClientFilterCollection;
  readonly baselineOrderBy: BrunoTableOrderBy;
  readonly query: BrunoTableQuerySnapshot;
  readonly columnCommands: Map<string, BrunoTableColumnCommandSnapshot>;
  readonly columnLayout: BrunoTableColumnLayoutState;
  readonly invalidatedColumnIds: readonly string[];
  readonly transition: QueryTransition;
}>;

type PublicationConfiguration = Readonly<{
  readonly columns: readonly CompiledColumn[];
  readonly queryConfiguration: BrunoTableQueryConfiguration;
}>;

type QueuedPublication<TRow> = Readonly<{
  readonly publication: BrunoTableRowPipelinePublication<TRow>;
  readonly configuration: PublicationConfiguration;
}>;

function activeFilterCount(
  filterCollection: BrunoTableClientFilterCollection,
  quickFilter: string,
): number {
  return (
    filterCollection.filters.length +
    (normalizeBrunoTableFilterText(quickFilter).length === 0 ? 0 : 1)
  );
}

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
  private readonly filterListeners = new Set<Listener>();
  private readonly quickFilterListeners = new Set<Listener>();
  private readonly filterPositionResetListeners = new Set<Listener>();
  private readonly sortingListeners = new Set<Listener>();
  private readonly loadedRowCountListeners = new Set<Listener>();
  private readonly activeFilterCountListeners = new Set<Listener>();
  private readonly activeSortCountListeners = new Set<Listener>();
  private readonly columnCommandListeners = new Map<string, Set<Listener>>();
  private readonly columnFilterListeners = new Map<string, Set<Listener>>();
  private readonly columnFilterCommandEpochListeners = new Map<string, Set<Listener>>();
  private readonly quickFilterCommandEpochListeners = new Set<Listener>();
  private readonly columnLayoutListeners = new Set<Listener>();
  private readonly columnStructureListeners = new Set<Listener>();
  private readonly activeEditorCommitGates = new Set<BrunoTableActiveEditorCommitGate>();
  private readonly queuedPublications: (QueuedPublication<TRow> | undefined)[] = [];
  private publishing = false;
  private installedPublicationConfiguration: PublicationConfiguration;
  private logicalPublicationConfiguration: PublicationConfiguration;
  private logicalPublication: BrunoTableRowPipelinePublication<TRow>;
  private view: BrunoTableRowPipelineRuntimeView | undefined;
  private state: RuntimeState<TRow>;
  private publication: BrunoTableRowPipelinePublication<TRow>;
  private columns: readonly CompiledColumn[];
  private columnsById: ReadonlyMap<string, CompiledColumn>;
  private baselineFilters: readonly unknown[];
  private baselineFilterCollection: BrunoTableClientFilterCollection;
  private baselineOrderBy: BrunoTableOrderBy;
  private readonly quickFilterFields: readonly string[];
  private query: BrunoTableQuerySnapshot;
  private filterCollection: BrunoTableClientFilterCollection;
  private filterSnapshot: BrunoTableFilterSnapshot;
  private columnFilterSnapshots: ReadonlyMap<string, unknown>;
  private readonly columnFilterVersions = new Map<string, number>();
  private readonly columnFilterCommandEpochs = new Map<string, number>();
  private quickFilterCommandEpoch = 0;
  private filterPositionResetEpoch = 0;
  private columnLayout: BrunoTableColumnLayoutState;
  private columnLayoutSnapshot: BrunoTableColumnLayoutSnapshot;
  private columnStructureSnapshot: BrunoTableColumnLayoutSnapshot;
  private columnCommands = new Map<string, BrunoTableColumnCommandSnapshot>();
  private readonly tableId: string;
  private getOnPersistChange: NonNullable<
    BrunoTableGridPreferencesRuntimeOptions["getOnPersistChange"]
  >;

  public constructor(
    publication: BrunoTableRowPipelinePublication<TRow>,
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration,
    tableId: string,
    preferencesOptions: BrunoTableGridPreferencesRuntimeOptions = {},
  ) {
    this.tableId = tableId;
    this.columns = columns;
    this.columnsById = indexColumns(columns);
    this.baselineFilterCollection =
      queryConfiguration.baselineFilterCollection ??
      compileClientFilterCollection(queryConfiguration.baselineFilters, columns, {
        rejectOverBudget: true,
      });
    this.baselineFilters = this.baselineFilterCollection.filters;
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
    const restoredPreferences = createBrunoTableGridPreferences({
      tableId,
      columns,
      initialFilters: this.baselineFilters,
      initialOrderBy: this.baselineOrderBy,
      initialPersistedState: preferencesOptions.initialPersistedState,
    });
    this.filterCollection = restoredPreferences.filterCollection;
    this.getOnPersistChange = preferencesOptions.getOnPersistChange ?? (() => undefined);
    this.query = createQuerySnapshot(
      columns,
      this.filterCollection,
      "",
      restoredPreferences.orderBy,
      0,
    );
    this.columnFilterSnapshots = createColumnFilterSnapshots(this.filterCollection);
    this.filterSnapshot = createFilterSnapshot(
      this.query,
      this.columnFilterSnapshots,
      this.filterCollection.activeFilterLabelsByColumn,
    );
    for (const columnId of this.columnFilterSnapshots.keys()) {
      this.columnFilterVersions.set(columnId, 0);
      this.columnFilterCommandEpochs.set(columnId, 0);
    }
    this.columnLayout = restoredPreferences.columnLayout;
    this.columnLayoutSnapshot = getBrunoTableColumnLayoutSnapshot(this.columnLayout);
    this.columnStructureSnapshot = this.columnLayoutSnapshot;
    this.columnCommands = createColumnCommandSnapshots(
      columns,
      this.query,
      this.baselineFilterCollection,
      undefined,
      this.columnLayoutSnapshot,
    );
    this.publication = publication;
    this.state = this.createState(publication);
    this.installedPublicationConfiguration = Object.freeze({
      columns,
      queryConfiguration: Object.freeze({
        baselineFilters: this.baselineFilters,
        baselineFilterCollection: this.baselineFilterCollection,
        baselineOrderBy: this.baselineOrderBy,
        quickFilterFields: this.quickFilterFields,
      }),
    });
    this.logicalPublicationConfiguration = this.installedPublicationConfiguration;
    this.logicalPublication = publication;
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
        getFilterSnapshot: this.getFilterSnapshot,
        getQuickFilterSnapshot: this.getQuickFilterSnapshot,
        getFilterPositionResetEpochSnapshot: this.getFilterPositionResetEpochSnapshot,
        getQuickFilterFieldsSnapshot: this.getQuickFilterFieldsSnapshot,
        getColumnCommandSnapshot: this.getColumnCommandSnapshot,
        getColumnFilterSnapshot: this.getColumnFilterSnapshot,
        getColumnFilterVersionSnapshot: this.getColumnFilterVersionSnapshot,
        getColumnFilterCommandEpochSnapshot: this.getColumnFilterCommandEpochSnapshot,
        getFilterComplexitySnapshot: this.getFilterComplexitySnapshot,
        getSortingSnapshot: this.getSortingSnapshot,
        getLoadedRowCountSnapshot: this.getLoadedRowCountSnapshot,
        getActiveFilterCountSnapshot: this.getActiveFilterCountSnapshot,
        getActiveSortCountSnapshot: this.getActiveSortCountSnapshot,
        getQuickFilterCommandEpochSnapshot: this.getQuickFilterCommandEpochSnapshot,
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
        subscribeFilter: this.subscribeFilter,
        subscribeQuickFilter: this.subscribeQuickFilter,
        subscribeFilterPositionReset: this.subscribeFilterPositionReset,
        registerQuickFilterInvalidation: this.registerQuickFilterInvalidation,
        publishRowPipeline: this.publishRowPipeline,
        subscribeColumnCommands: this.subscribeColumnCommands,
        subscribeColumnFilter: this.subscribeColumnFilter,
        subscribeColumnFilterCommandEpoch: this.subscribeColumnFilterCommandEpoch,
        subscribeSorting: this.subscribeSorting,
        subscribeLoadedRowCount: this.subscribeLoadedRowCount,
        subscribeActiveFilterCount: this.subscribeActiveFilterCount,
        subscribeActiveSortCount: this.subscribeActiveSortCount,
        subscribeColumnLayout: this.subscribeColumnLayout,
        subscribeColumnStructure: this.subscribeColumnStructure,
        registerActiveEditorCommitGate: this.registerActiveEditorCommitGate,
        subscribeQuickFilterCommandEpoch: this.subscribeQuickFilterCommandEpoch,
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
    this.acceptPublication(publication, this.logicalPublicationConfiguration);
  };

  private readonly publishRowPipeline = (
    publication: BrunoTableRowPipelinePublication<unknown>,
  ): void => {
    this.publish(publication as BrunoTableRowPipelinePublication<TRow>);
  };

  public readonly reconcile = (
    publication: BrunoTableRowPipelinePublication<TRow>,
    columns: readonly CompiledColumn[],
    queryConfiguration: BrunoTableQueryConfiguration = this.logicalPublicationConfiguration
      .queryConfiguration,
  ): void => {
    this.acceptPublication(publication, Object.freeze({ columns, queryConfiguration }));
  };

  private acceptPublication(
    publication: BrunoTableRowPipelinePublication<TRow>,
    configuration: PublicationConfiguration,
  ): void {
    this.logicalPublication = publication;
    this.logicalPublicationConfiguration = configuration;
    if (this.publishing) {
      this.queuedPublications.push({ publication, configuration });
      return;
    }

    this.publishing = true;
    let firstError: ListenerError | undefined;
    try {
      firstError = this.reconcilePublication(publication, configuration);
      for (let index = 0; index < this.queuedPublications.length; index += 1) {
        const queued = this.queuedPublications[index];
        this.queuedPublications[index] = undefined;
        if (queued === undefined) continue;
        firstError = firstListenerError(
          firstError,
          this.reconcilePublication(queued.publication, queued.configuration),
        );
      }
    } finally {
      this.queuedPublications.length = 0;
      this.publishing = false;
      this.logicalPublication = this.publication;
      this.logicalPublicationConfiguration = this.installedPublicationConfiguration;
    }
    if (firstError !== undefined) throw firstError.value;
  }

  private reconcilePublication(
    publication: BrunoTableRowPipelinePublication<TRow>,
    publicationConfiguration: PublicationConfiguration,
  ): ListenerError | undefined {
    const { columns, queryConfiguration } = publicationConfiguration;
    const previous = this.state;
    const previousLayoutSnapshot = this.columnLayoutSnapshot;
    const configuration =
      this.columns === columns &&
      this.baselineFilterCollection === queryConfiguration.baselineFilterCollection &&
      this.baselineOrderBy === queryConfiguration.baselineOrderBy
        ? undefined
        : this.stageColumns(columns, queryConfiguration);
    const next = this.createState(publication);

    if (configuration !== undefined) {
      this.columns = configuration.columns;
      this.columnsById = indexColumns(configuration.columns);
      this.baselineFilters = configuration.baselineFilters;
      this.baselineFilterCollection = configuration.baselineFilterCollection;
      this.baselineOrderBy = configuration.baselineOrderBy;
      this.query = configuration.query;
      this.filterCollection = this.query.filterCollection;
      this.updateColumnFilterSnapshots();
      this.filterSnapshot = createFilterSnapshot(
        this.query,
        this.columnFilterSnapshots,
        this.filterCollection.activeFilterLabelsByColumn,
      );
      this.columnLayout = configuration.columnLayout;
      this.columnLayoutSnapshot = getBrunoTableColumnLayoutSnapshot(this.columnLayout);
      this.columnCommands = configuration.columnCommands;
    }
    this.publication = publication;
    const installed = stabilizeRuntimeState(previous, next);
    this.state = installed;
    this.installedPublicationConfiguration = publicationConfiguration;
    let configurationError: ListenerError | undefined;
    if (configuration !== undefined) {
      for (const columnId of configuration.invalidatedColumnIds) {
        configurationError = firstListenerError(
          configurationError,
          this.invalidateColumnFilterCommand(columnId),
        );
      }
    }
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
    const firstError = firstListenerError(
      firstListenerError(configurationError, transitionError),
      commitError,
    );
    return firstError;
  }

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
    if (previous.source.loadedRows !== next.source.loadedRows) {
      firstError = firstListenerError(firstError, notify(this.loadedRowCountListeners));
    }
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
    this.reconcile(this.logicalPublication, columns, queryConfiguration);
  };

  public readonly setOnPersistChange = (
    callback: ((state: Readonly<Record<string, BrunoTableJsonValue>>) => void) | undefined,
  ): void => {
    this.getOnPersistChange = () => callback;
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

  public readonly getFilterSnapshot = (): BrunoTableFilterSnapshot => this.filterSnapshot;

  public readonly getQuickFilterSnapshot = (): string => this.query.quickFilter;

  public readonly getFilterPositionResetEpochSnapshot = (): number => this.filterPositionResetEpoch;

  public readonly getQuickFilterCommandEpochSnapshot = (): number => this.quickFilterCommandEpoch;

  public readonly getQuickFilterFieldsSnapshot = (): readonly string[] => this.quickFilterFields;

  public readonly getSortingSnapshot = (): BrunoTableOrderBy => this.query.orderBy;

  public readonly getLoadedRowCountSnapshot = (): number => this.state.source.loadedRows;

  public readonly getActiveFilterCountSnapshot = (): number =>
    activeFilterCount(this.filterCollection, this.query.quickFilter);

  public readonly getActiveSortCountSnapshot = (): number => this.query.orderBy.length;

  public readonly getColumnCommandSnapshot = (columnId: string): BrunoTableColumnCommandSnapshot =>
    this.columnCommands.get(columnId) ?? EMPTY_COLUMN_COMMAND;

  public readonly getColumnFilterSnapshot = (columnId: string): unknown =>
    this.columnFilterSnapshots.get(columnId);

  public readonly getColumnFilterVersionSnapshot = (columnId: string): number =>
    this.columnFilterVersions.get(columnId) ?? 0;

  public readonly getColumnFilterCommandEpochSnapshot = (columnId: string): number =>
    this.columnFilterCommandEpochs.get(columnId) ?? 0;

  public readonly getFilterComplexitySnapshot = (): BrunoTableFilterComplexity =>
    this.filterCollection.complexity;

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

  public readonly subscribeFilter = (listener: Listener): (() => void) =>
    subscribe(this.filterListeners, listener);

  public readonly subscribeQuickFilter = (listener: Listener): (() => void) =>
    subscribe(this.quickFilterListeners, listener);

  public readonly subscribeFilterPositionReset = (listener: Listener): (() => void) =>
    subscribe(this.filterPositionResetListeners, listener);

  public readonly subscribeQuickFilterCommandEpoch = (listener: Listener): (() => void) =>
    subscribe(this.quickFilterCommandEpochListeners, listener);

  public readonly registerQuickFilterInvalidation = (listener: Listener): (() => void) =>
    this.subscribeQuickFilterCommandEpoch(listener);

  public readonly subscribeSorting = (listener: Listener): (() => void) =>
    subscribe(this.sortingListeners, listener);

  public readonly subscribeLoadedRowCount = (listener: Listener): (() => void) =>
    subscribe(this.loadedRowCountListeners, listener);

  public readonly subscribeActiveFilterCount = (listener: Listener): (() => void) =>
    subscribe(this.activeFilterCountListeners, listener);

  public readonly subscribeActiveSortCount = (listener: Listener): (() => void) =>
    subscribe(this.activeSortCountListeners, listener);

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

  public readonly subscribeColumnFilterCommandEpoch = (
    columnId: string,
    listener: Listener,
  ): (() => void) => {
    let listeners = this.columnFilterCommandEpochListeners.get(columnId);
    if (listeners === undefined) {
      listeners = new Set<Listener>();
      this.columnFilterCommandEpochListeners.set(columnId, listeners);
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.columnFilterCommandEpochListeners.get(columnId) !== listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.columnFilterCommandEpochListeners.delete(columnId);
    };
  };

  public readonly subscribeColumnLayout = (listener: Listener): (() => void) =>
    subscribe(this.columnLayoutListeners, listener);

  public readonly subscribeColumnStructure = (listener: Listener): (() => void) =>
    subscribe(this.columnStructureListeners, listener);

  public readonly dispatchGridCommand = (command: BrunoTableGridCommand): boolean => {
    const previousFilterCollection = this.filterCollection;
    const previousOrderBy = this.query.orderBy;
    const previousLayout = this.columnLayout;
    let accepted = false;
    let commandThrew = false;
    let commandError: unknown;
    try {
      accepted = this.dispatchGridCommandImpl(command);
    } catch (error) {
      commandThrew = true;
      commandError = error;
    }
    let persistThrew = false;
    let persistError: unknown;
    if (
      isBrunoTableDurablePreferenceCommand(command) &&
      (previousFilterCollection !== this.filterCollection ||
        !sameOrderBy(previousOrderBy, this.query.orderBy) ||
        previousLayout !== this.columnLayout)
    ) {
      let persistedState: Readonly<Record<string, BrunoTableJsonValue>> | undefined;
      try {
        persistedState = createBrunoTablePersistedState({
          tableId: this.tableId,
          columns: this.columns,
          filters: this.query.filters,
          orderBy: this.query.orderBy,
          groupBy: Object.freeze([]),
          groupOrderBy: Object.freeze([]),
          columnLayout: this.columnLayout,
        });
      } catch (error) {
        persistThrew = true;
        persistError = error;
      }
      if (persistedState !== undefined) {
        try {
          this.getOnPersistChange()?.(persistedState);
        } catch {
          // Consumer notification failures never participate in grid command ownership.
        }
      }
    }
    if (commandThrew) throw commandError;
    if (persistThrew) throw persistError;
    return accepted;
  };

  private readonly dispatchGridCommandImpl = (command: BrunoTableGridCommand): boolean => {
    if (
      command.type === "quick-filter.replace" &&
      !isBrunoTableQuickFilterTextWithinLimit(command.text)
    ) {
      return false;
    }
    if (
      (isBrunoTableFilterCommand(command) || isBrunoTableSortingCommand(command)) &&
      !this.commitActiveEditor()
    ) {
      return false;
    }
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
      this.publishQuery(this.filterCollection, nextOrderBy);
      return true;
    }
    if (command.type === "column.filter.clear") {
      const invalidationError = this.invalidateColumnFilterCommand(command.columnId);
      this.clearColumnFiltersImpl(command.columnId);
      if (invalidationError !== undefined) throw invalidationError.value;
      return true;
    }
    if (command.type === "column.filters.clear") {
      let invalidationError: ListenerError | undefined;
      for (const column of this.columns) {
        invalidationError = firstListenerError(
          invalidationError,
          this.invalidateColumnFilterCommand(column.columnId),
        );
      }
      this.clearAllColumnFiltersImpl();
      if (invalidationError !== undefined) throw invalidationError.value;
      return true;
    }
    if (command.type === "column.filter.reset") {
      const invalidationError = this.invalidateColumnFilterCommand(command.columnId);
      const accepted = this.resetColumnFiltersImpl(command.columnId);
      if (invalidationError !== undefined) throw invalidationError.value;
      return accepted;
    }
    if (command.type === "column.filter.replace") {
      return this.replaceColumnFilterImpl(command.columnId, command.filter);
    }
    if (command.type === "quick-filter.replace") {
      this.quickFilterCommandEpoch += 1;
      this.publishQuery(this.filterCollection, this.query.orderBy, command.text);
      const error = notify(this.quickFilterCommandEpochListeners);
      if (error !== undefined) throw error.value;
      return true;
    }
    if (!isBrunoTableColumnLayoutCommand(command)) return true;
    const previousLayoutSnapshot = this.columnLayoutSnapshot;
    const previousCommands = this.columnCommands;
    const nextLayout = applyBrunoTableGridCommand(this.columnLayout, command);
    if (nextLayout === this.columnLayout) return true;
    this.columnLayout = nextLayout;
    this.columnLayoutSnapshot = getBrunoTableColumnLayoutSnapshot(nextLayout);
    this.columnCommands = createColumnCommandSnapshots(
      this.columns,
      this.query,
      this.baselineFilterCollection,
      previousCommands,
      this.columnLayoutSnapshot,
    );
    const error = firstListenerError(
      this.notifyColumnLayoutTransition(previousLayoutSnapshot, previousCommands),
      this.notifyColumnStructureTransition(previousLayoutSnapshot),
    );
    if (error !== undefined) throw error.value;
    return true;
  };

  public readonly registerActiveEditorCommitGate = (
    gate: BrunoTableActiveEditorCommitGate,
  ): (() => void) => {
    this.activeEditorCommitGates.add(gate);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeEditorCommitGates.delete(gate);
    };
  };

  private readonly commitActiveEditor = (): boolean => {
    for (const gate of this.activeEditorCommitGates) {
      if (!gate()) return false;
    }
    return true;
  };

  public readonly toggleColumnSort = (columnId: string, multi: boolean): void => {
    this.dispatchGridCommand({ type: "column.sort.toggle", columnId, multi });
  };

  public readonly clearColumnFilters = (columnId: string): void => {
    this.dispatchGridCommand({ type: "column.filter.clear", columnId });
  };

  private readonly clearAllColumnFiltersImpl = (): void => {
    if (this.query.filters.length === 0) return;
    this.publishQuery(compileClientFilterCollection([], this.columns), this.query.orderBy);
  };

  private readonly invalidateColumnFilterCommand = (
    columnId: string,
  ): ListenerError | undefined => {
    this.columnFilterCommandEpochs.set(
      columnId,
      (this.columnFilterCommandEpochs.get(columnId) ?? 0) + 1,
    );
    const listeners = this.columnFilterCommandEpochListeners.get(columnId);
    return listeners === undefined ? undefined : notify(listeners);
  };

  private readonly clearColumnFiltersImpl = (columnId: string): void => {
    const next = removeClientFilterColumn(this.filterCollection, columnId);
    if (next === this.filterCollection) return;
    this.publishQuery(next, this.query.orderBy);
  };

  private readonly replaceColumnFilterImpl = (columnId: string, candidate: unknown): boolean => {
    const next = replaceClientFilterColumn(this.filterCollection, columnId, candidate);
    if (next === undefined) return false;
    if (next === this.filterCollection) return true;
    this.publishQuery(next, this.query.orderBy);
    return true;
  };

  public readonly resetColumnFilters = (columnId: string): void => {
    this.dispatchGridCommand({ type: "column.filter.reset", columnId });
  };

  private readonly resetColumnFiltersImpl = (columnId: string): boolean => {
    const next = restoreClientFilterColumn(
      this.filterCollection,
      this.baselineFilterCollection,
      columnId,
    );
    if (next === undefined) return false;
    if (next === this.filterCollection) return true;
    this.publishQuery(next, this.query.orderBy);
    return true;
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
    const baselineFilterCollection =
      queryConfiguration.baselineFilterCollection ??
      compileClientFilterCollection(queryConfiguration.baselineFilters, columns, {
        rejectOverBudget: true,
      });
    const baselineFilters = baselineFilterCollection.filters;
    const baselineOrderBy = queryConfiguration.baselineOrderBy;
    const nextColumnsById = indexColumns(columns);
    const invalidatedColumnIds = new Set<string>();
    for (const column of this.columns) {
      const next = nextColumnsById.get(column.columnId);
      if (
        next === undefined ||
        !sameFilterCommandSemantics(column, next) ||
        !sameBrunoTableFilterColumn(
          this.baselineFilterCollection,
          baselineFilterCollection,
          column.columnId,
        )
      ) {
        invalidatedColumnIds.add(column.columnId);
      }
    }
    for (const column of columns) {
      const previous = this.columnsById.get(column.columnId);
      if (previous === undefined) invalidatedColumnIds.add(column.columnId);
    }
    const nextFilterCollection = compileClientFilterCollection(this.query.filters, columns);
    const nextOrderBy = reconcileBrunoTableOrderBy(this.query.orderBy, baselineOrderBy, columns);
    const nextQuickFilter = this.query.quickFilter;
    const semanticsChanged =
      !sameBrunoTableFilterCollections(this.query.filterCollection, nextFilterCollection) ||
      !sameOrderBy(this.query.orderBy, nextOrderBy) ||
      this.query.quickFilter !== nextQuickFilter ||
      activeQuerySemanticsChanged(this.columns, columns, this.query);
    const query = createQuerySnapshot(
      columns,
      nextFilterCollection,
      nextQuickFilter,
      nextOrderBy,
      semanticsChanged ? this.query.generation + 1 : this.query.generation,
      semanticsChanged
        ? !sameOrderBy(this.query.orderBy, nextOrderBy)
          ? "clear"
          : "reconcile"
        : this.query.navigationMode,
    );
    const columnLayout = reconcileBrunoTableColumnLayout(
      this.columnLayout,
      columns,
      this.columnLayout.version + 1,
    );
    const columnCommands = createColumnCommandSnapshots(
      columns,
      query,
      baselineFilterCollection,
      this.columnCommands,
      getBrunoTableColumnLayoutSnapshot(columnLayout),
    );
    return Object.freeze({
      columns,
      baselineFilters,
      baselineFilterCollection,
      baselineOrderBy,
      query,
      columnCommands,
      columnLayout,
      invalidatedColumnIds: Object.freeze([...invalidatedColumnIds]),
      transition: Object.freeze({
        filterChanged:
          this.columns !== columns ||
          !sameBrunoTableFilterCollections(this.query.filterCollection, nextFilterCollection) ||
          this.query.quickFilter !== nextQuickFilter,
        queryChanged: true,
        quickFilterChanged: this.query.quickFilter !== nextQuickFilter,
        sortingChanged: !sameOrderBy(this.query.orderBy, nextOrderBy),
        activeFilterCountChanged:
          activeFilterCount(this.filterCollection, this.query.quickFilter) !==
          activeFilterCount(nextFilterCollection, nextQuickFilter),
        activeSortCountChanged: this.query.orderBy.length !== nextOrderBy.length,
        previousCommands: this.columnCommands,
        previousColumnFilters: this.columnFilterSnapshots,
      }),
    });
  }

  private publishQuery(
    filterCollection: BrunoTableClientFilterCollection,
    orderBy: BrunoTableOrderBy,
    quickFilter = this.query.quickFilter,
    forceColumnRefresh = false,
  ): void {
    const transition = this.updateQuery(filterCollection, orderBy, quickFilter, forceColumnRefresh);
    if (transition === undefined) return;
    const error = this.notifyQueryTransition(transition);
    if (error !== undefined) throw error.value;
  }

  private updateQuery(
    filterCollection: BrunoTableClientFilterCollection,
    orderBy: BrunoTableOrderBy,
    quickFilter: string,
    forceColumnRefresh = false,
  ): QueryTransition | undefined {
    const previousActiveFilterCount = this.getActiveFilterCountSnapshot();
    const previousActiveSortCount = this.getActiveSortCountSnapshot();
    const sortingChanged = !sameOrderBy(this.query.orderBy, orderBy);
    const quickFilterChanged = this.query.quickFilter !== quickFilter;
    const quickFilterSemanticsChanged =
      normalizeBrunoTableFilterText(this.query.quickFilter) !==
      normalizeBrunoTableFilterText(quickFilter);
    const filterCollectionChanged = !sameBrunoTableFilterCollections(
      this.filterCollection,
      filterCollection,
    );
    const queryChanged = filterCollectionChanged || sortingChanged || quickFilterSemanticsChanged;
    const filterChanged = filterCollectionChanged || quickFilterChanged;
    if (!queryChanged && !quickFilterChanged && !forceColumnRefresh) return undefined;
    const previousCommands = this.columnCommands;
    const previousColumnFilters = this.columnFilterSnapshots;
    const filterColumnIdentitiesChanged =
      filterCollectionChanged &&
      !sameStringSet(this.filterCollection.columnIds, filterCollection.columnIds);
    if (queryChanged) {
      this.query = createQuerySnapshot(
        this.columns,
        filterCollection,
        quickFilter,
        orderBy,
        this.query.generation + 1,
        sortingChanged ? "clear" : "reset",
      );
      this.filterCollection = filterCollection;
      this.updateColumnFilterSnapshots();
    } else if (quickFilterChanged) {
      this.query = createQuerySnapshot(
        this.columns,
        this.filterCollection,
        quickFilter,
        this.query.orderBy,
        this.query.generation,
      );
    }
    if (filterChanged) {
      this.filterSnapshot = createFilterSnapshot(
        this.query,
        this.columnFilterSnapshots,
        this.filterCollection.activeFilterLabelsByColumn,
      );
    }
    this.columnCommands =
      !sortingChanged && !forceColumnRefresh && !filterColumnIdentitiesChanged
        ? previousCommands
        : createColumnCommandSnapshots(
            this.columns,
            this.query,
            this.baselineFilterCollection,
            previousCommands,
            this.columnLayoutSnapshot,
          );
    return Object.freeze({
      filterChanged,
      queryChanged,
      quickFilterChanged,
      sortingChanged,
      activeFilterCountChanged: previousActiveFilterCount !== this.getActiveFilterCountSnapshot(),
      activeSortCountChanged: previousActiveSortCount !== this.getActiveSortCountSnapshot(),
      previousCommands,
      previousColumnFilters,
    });
  }

  private notifyQueryTransition(transition: QueryTransition): ListenerError | undefined {
    if (__BRUNO_TABLE_TEST_DIAGNOSTICS__ && transition.queryChanged) {
      recordBrunoTableClientQueryTransition(this.tableId, this.query.generation);
    }
    let firstError = transition.queryChanged ? notify(this.queryListeners) : undefined;
    if (transition.filterChanged) {
      firstError = firstListenerError(firstError, notify(this.filterListeners));
    }
    if (transition.filterChanged && !transition.queryChanged) {
      this.filterPositionResetEpoch += 1;
      firstError = firstListenerError(firstError, notify(this.filterPositionResetListeners));
    }
    if (transition.quickFilterChanged) {
      firstError = firstListenerError(firstError, notify(this.quickFilterListeners));
    }
    if (transition.sortingChanged) {
      firstError = firstListenerError(firstError, notify(this.sortingListeners));
    }
    if (transition.activeFilterCountChanged) {
      firstError = firstListenerError(firstError, notify(this.activeFilterCountListeners));
    }
    if (transition.activeSortCountChanged) {
      firstError = firstListenerError(firstError, notify(this.activeSortCountListeners));
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
    const next = createColumnFilterSnapshots(this.filterCollection, this.columnFilterSnapshots);
    const columnIds = new Set([...this.columnFilterSnapshots.keys(), ...next.keys()]);
    for (const columnId of columnIds) {
      if (Object.is(this.columnFilterSnapshots.get(columnId), next.get(columnId))) continue;
      this.columnFilterVersions.set(columnId, (this.columnFilterVersions.get(columnId) ?? 0) + 1);
    }
    this.columnFilterSnapshots = next;
    const currentColumnIds = new Set<string>(this.columns.map((column) => column.columnId));
    for (const columnId of this.columnFilterVersions.keys()) {
      if (!currentColumnIds.has(columnId)) {
        this.columnFilterVersions.delete(columnId);
        this.columnFilterCommandEpochs.delete(columnId);
      }
    }
    for (const columnId of currentColumnIds) {
      if (!this.columnFilterCommandEpochs.has(columnId)) {
        this.columnFilterCommandEpochs.set(columnId, 0);
      }
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
  collection: BrunoTableClientFilterCollection,
  previousSnapshots?: ReadonlyMap<string, unknown>,
): ReadonlyMap<string, unknown> {
  const snapshots = new Map<string, unknown>();
  for (const [columnId, value] of collection.filtersByColumn) {
    const previous = previousSnapshots?.get(columnId);
    snapshots.set(columnId, Object.is(previous, value) ? previous : value);
  }
  return snapshots;
}

function sameStringSet(previous: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  return previous.size === next.size && [...previous].every((value) => next.has(value));
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
  baselineFilterCollection: BrunoTableClientFilterCollection,
  previous?: ReadonlyMap<string, BrunoTableColumnCommandSnapshot>,
  layout?: BrunoTableColumnLayoutSnapshot,
): Map<string, BrunoTableColumnCommandSnapshot> {
  const snapshots = new Map<string, BrunoTableColumnCommandSnapshot>();
  const activeFilterColumnIds = query.filterCollection.columnIds;
  const baselineFilterColumnIds = baselineFilterCollection.columnIds;
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
      filterActive: activeFilterColumnIds.has(column.columnId),
      filterBaselineAvailable: baselineFilterColumnIds.has(column.columnId),
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
  for (const columnId of query.filterCollection.columnIds) activeColumnIds.add(columnId);
  for (const columnId of activeColumnIds) {
    const previous = previousColumns.find((column) => column.columnId === columnId);
    const next = nextColumns.find((column) => column.columnId === columnId);
    if (previous === undefined || next === undefined) return true;
    if (!sameQuerySemantics(previous, next)) return true;
  }
  return false;
}

function sameFilterCommandSemantics(previous: CompiledColumn, next: CompiledColumn): boolean {
  if (
    previous.columnId !== next.columnId ||
    previous.enableFilter !== next.enableFilter ||
    previous.semantics.editorFamily !== next.semantics.editorFamily
  ) {
    return false;
  }
  if (!sameQuerySemantics(previous, next)) return false;
  if (previous.selectOptions === undefined || next.selectOptions === undefined) {
    return previous.selectOptions === next.selectOptions;
  }
  if (previous.selectOptions.length !== next.selectOptions.length) return false;
  try {
    return previous.selectOptions.every((value, index) =>
      next.semantics.equivalent(value, next.selectOptions?.[index]),
    );
  } catch {
    return false;
  }
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
