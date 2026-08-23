import type { BrunoTableSourceChrome, BrunoTableSourceStatus } from "../public-types";
import { readCompiledColumnValue } from "./cell-value";
import type { CompiledColumn } from "./compile-columns";
import type {
  BrunoTableQueryConfiguration,
  BrunoTableQueryNavigationMode,
  BrunoTableQuerySnapshot,
  BrunoTableRowPipelinePublication,
  BrunoTableRowSpaceSnapshot,
} from "./grid-runtime";
import {
  compileClientFilterCollection,
  reconcileBrunoTableOrderBy,
  sanitizeClientInitialOrderBy,
} from "./grid-query";
import {
  columnUsesRawRowPresentation,
  compileBrunoTableServerProjectionFields,
  compileBrunoTableServerQueryPlan,
} from "./server-query";
import { snapshotBrunoTableQuickFilterFields } from "./quick-filter";
import {
  BrunoTableServerViewportStore,
  sanitizeBrunoTableServerViewportWindow,
  type BrunoTableServerViewportWindow,
} from "./server-viewport-store";

type Listener = () => void;

type BrunoTableServerSourceSnapshot = BrunoTableSourceChrome & {
  readonly viewport: unknown;
};

type BrunoTableServerSourceInput = BrunoTableServerSourceSnapshot & {
  readonly completeRawSelect: unknown;
};

type BrunoTableServerStructureSnapshot = Readonly<{
  readonly totalRows: number;
  readonly getRowId: (index: number) => string | undefined;
  readonly findRowIndex: (rowId: string) => number | undefined;
  readonly generation: number;
  readonly navigationMode: BrunoTableQueryNavigationMode;
  readonly loading: boolean;
}>;

type BrunoTableServerViewportSink<TRow> = Readonly<{
  readonly setRowCount: (count: number, keepRenderedRows?: boolean) => void;
  readonly setRowData: (
    rowsByIndex: Readonly<Record<number, TRow>>,
    rowKeysByIndex: Readonly<Record<number, string>>,
  ) => void;
}>;

type BrunoTableServerViewportRequest<TRow> = Readonly<{
  readonly window: BrunoTableServerViewportWindow;
  readonly query: unknown;
  readonly sink: BrunoTableServerViewportSink<TRow>;
}>;

type BrunoTableServerViewportGeneration = Readonly<{
  readonly setWindow: (window: BrunoTableServerViewportWindow) => void;
  readonly release: () => void;
}>;

export type BrunoTableServerViewportTransport<TRow> = Readonly<{
  readonly semanticKey: (query: unknown) => unknown;
  readonly replace: (
    request: BrunoTableServerViewportRequest<TRow>,
  ) => BrunoTableServerViewportGeneration;
}>;

type ActiveGeneration = Readonly<{
  readonly token: number;
  readonly controller: BrunoTableServerViewportGeneration;
  readonly inputs: BrunoTableServerQueryInputs;
  readonly semanticKey: Readonly<{
    readonly viewport: unknown;
    readonly query: unknown;
  }>;
}>;

export type BrunoTableServerQueryInputs = Readonly<{
  readonly routeBy: Readonly<Record<string, unknown>> | undefined;
  readonly externalFilters: readonly unknown[] | undefined;
  readonly visibleColumnIds: readonly string[] | undefined;
}>;

const EMPTY_SERVER_QUERY_INPUTS: BrunoTableServerQueryInputs = Object.freeze({
  routeBy: undefined,
  externalFilters: undefined,
  visibleColumnIds: undefined,
});

type RowEquivalencePlan = Readonly<{
  readonly fieldColumns: ReadonlyMap<string, readonly CompiledColumn[]>;
  readonly computedColumns: readonly CompiledColumn[];
  readonly usesRawRowPresentation: boolean;
}>;

type BrunoTableServerRuntimeQuery = Readonly<{
  readonly generation: number;
  readonly navigationMode: BrunoTableQueryNavigationMode;
  readonly filters: readonly unknown[];
  readonly quickFilter: string;
  readonly orderBy: readonly Readonly<{
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }>[];
}>;

const INITIAL_WINDOW: BrunoTableServerViewportWindow = Object.freeze({
  firstRow: 0,
  lastRow: 17,
});

export class BrunoTableServerRowPipelineAdapter<TRow> {
  private readonly store: BrunoTableServerViewportStore<TRow>;
  private readonly listeners = new Set<Listener>();
  private readonly resultRowCountListeners = new Set<Listener>();
  private readonly structureListeners = new Set<Listener>();
  private quickFilterFields: readonly string[];
  private projectionFields: readonly string[];
  private completeRawSelect: readonly [string, ...string[]] | undefined;
  private columns: readonly CompiledColumn[];
  private columnsById: ReadonlyMap<string, CompiledColumn>;
  private rowEquivalencePlan: RowEquivalencePlan;
  private readonly initialFilters: readonly unknown[];
  private readonly initialOrderBy: BrunoTableServerRuntimeQuery["orderBy"];
  private queryConfiguration: BrunoTableQueryConfiguration;
  private resultRowCount = 0;
  private active: ActiveGeneration | undefined;
  private lastReplacedViewport: unknown;
  private queryGeneration = 0;
  private forceNextNavigationReset = false;
  private generationNavigationMode: BrunoTableQueryNavigationMode = "reset";
  private maskedRowSpace:
    | Readonly<{
        readonly totalRows: number;
        readonly snapshot: BrunoTableRowSpaceSnapshot<TRow>;
      }>
    | undefined;
  private dispatchedWindow: BrunoTableServerViewportWindow | undefined;
  private generationReleased = true;
  private suppressStorePublication = false;
  private forceFullStorePublication = false;
  private observedRowSpace: BrunoTableRowSpaceSnapshot<TRow>;
  private observedAuthoritativeTotalRows: boolean;
  private observedStructureVersion: number;
  private source: BrunoTableServerSourceSnapshot = Object.freeze({
    viewport: undefined,
    totalRows: 0,
    version: 0,
    status: "loading",
  });
  private publication: BrunoTableRowPipelinePublication<TRow>;
  private structureSnapshot: BrunoTableServerStructureSnapshot;

  public constructor(
    columns: readonly CompiledColumn[],
    quickFilterFields: readonly string[] | undefined,
    initialFilters: readonly unknown[] = Object.freeze([]),
    initialOrderBy: BrunoTableServerRuntimeQuery["orderBy"] = Object.freeze([]),
    completeRawSelect?: unknown,
  ) {
    this.columns = columns;
    this.rowEquivalencePlan = compileRowEquivalencePlan(columns);
    this.quickFilterFields = snapshotBrunoTableQuickFilterFields(quickFilterFields);
    this.completeRawSelect =
      completeRawSelect === undefined ? undefined : snapshotCompleteRawSelect(completeRawSelect);
    this.projectionFields = compileBrunoTableServerProjectionFields(
      columns,
      this.quickFilterFields,
      this.completeRawSelect,
    );
    this.columnsById = new Map<string, CompiledColumn>(
      columns.map((column) => [column.columnId, column]),
    );
    const filterCollection = compileClientFilterCollection(initialFilters, columns, {
      rejectOverBudget: true,
    });
    this.initialFilters = filterCollection.filters;
    this.initialOrderBy = sanitizeClientInitialOrderBy(initialOrderBy, columns);
    this.queryConfiguration = Object.freeze({
      baselineFilters: this.initialFilters,
      baselineFilterCollection: filterCollection,
      baselineOrderBy: this.initialOrderBy,
      quickFilterFields: this.quickFilterFields,
    });
    this.store = new BrunoTableServerViewportStore(
      (row, columnId) => {
        const column = this.columnsById.get(columnId);
        return column === undefined ? undefined : readCompiledColumnValue(column, row);
      },
      (previous, next) => rowsEquivalentBySelectedValues(this.rowEquivalencePlan, previous, next),
    );
    this.publication = this.createPublication();
    const initialStoreSnapshot = this.store.getSnapshot();
    this.observedRowSpace = initialStoreSnapshot.rowSpace;
    this.observedAuthoritativeTotalRows = initialStoreSnapshot.authoritativeTotalRows;
    this.observedStructureVersion = initialStoreSnapshot.structureVersion;
    this.structureSnapshot = createStructureSnapshot(
      this.publication,
      this.store.findRowIndex,
      this.queryGeneration,
      this.generationNavigationMode,
    );
    this.store.subscribe(this.reconcileStorePublication);
  }

  public readonly getPublication = (): BrunoTableRowPipelinePublication<TRow> => this.publication;

  public readonly subscribePublication = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getResultRowCountSnapshot = (): number => this.resultRowCount;

  public readonly subscribeResultRowCount = (listener: Listener): (() => void) => {
    this.resultRowCountListeners.add(listener);
    return () => this.resultRowCountListeners.delete(listener);
  };

  public readonly getStructureSnapshot = (): BrunoTableServerStructureSnapshot =>
    this.structureSnapshot;

  public readonly subscribeStructure = (listener: Listener): (() => void) => {
    this.structureListeners.add(listener);
    return () => this.structureListeners.delete(listener);
  };

  public readonly initializeResultRowCount = (
    _query: BrunoTableQuerySnapshot,
    _rowSpace: BrunoTableRowSpaceSnapshot<unknown> | undefined,
  ): boolean => {
    const count = this.resolveResultRowCount();
    if (this.resultRowCount === count) return false;
    this.publishResultRowCount(count);
    return true;
  };

  public readonly getQueryConfiguration = (): BrunoTableQueryConfiguration =>
    this.queryConfiguration;

  public readonly findRowIndex = (rowId: string): number | undefined =>
    this.store.findRowIndex(rowId);

  public reconcileColumns(
    columns: readonly CompiledColumn[],
    quickFilterFields: readonly string[] | undefined,
  ): BrunoTableQueryConfiguration {
    const nextQuickFilterFields =
      quickFilterFields === this.quickFilterFields
        ? this.quickFilterFields
        : snapshotBrunoTableQuickFilterFields(quickFilterFields);
    const visibleColumnIds = retainSurvivingVisibleColumnIds(
      columns,
      this.active?.inputs.visibleColumnIds,
    );
    const nextProjectionFields = compileBrunoTableServerProjectionFields(
      columns,
      nextQuickFilterFields,
      this.completeRawSelect,
      visibleColumnIds,
    );
    if (
      columns === this.columns &&
      sameStringArray(nextQuickFilterFields, this.quickFilterFields)
    ) {
      return this.queryConfiguration;
    }
    if (columns === this.columns) {
      if (!sameProjectionFields(this.projectionFields, nextProjectionFields)) {
        this.forceNextNavigationReset = true;
      }
      this.quickFilterFields = nextQuickFilterFields;
      this.projectionFields = nextProjectionFields;
      this.queryConfiguration = Object.freeze({
        ...this.queryConfiguration,
        quickFilterFields: nextQuickFilterFields,
      });
      return this.queryConfiguration;
    }
    const filterCollection = compileClientFilterCollection(this.initialFilters, columns);
    const initialOrderBy = reconcileBrunoTableOrderBy(
      this.queryConfiguration.baselineOrderBy,
      this.initialOrderBy,
      columns,
    );
    if (!sameProjectionFields(this.projectionFields, nextProjectionFields)) {
      this.forceNextNavigationReset = true;
    }
    this.columns = columns;
    this.quickFilterFields = nextQuickFilterFields;
    this.projectionFields = nextProjectionFields;
    this.rowEquivalencePlan = compileRowEquivalencePlan(columns, visibleColumnIds);
    this.columnsById = new Map(columns.map((column) => [column.columnId, column]));
    this.queryConfiguration = Object.freeze({
      baselineFilters: filterCollection.filters,
      baselineFilterCollection: filterCollection,
      baselineOrderBy: initialOrderBy,
      quickFilterFields: nextQuickFilterFields,
    });
    return this.queryConfiguration;
  }

  public reconcileSource(source: BrunoTableServerSourceInput): void {
    const nextCompleteRawSelect = snapshotCompleteRawSelect(source.completeRawSelect);
    const next = snapshotSource(source);
    requireViewportTransport<TRow>(next.viewport);
    const nextProjectionFields = compileBrunoTableServerProjectionFields(
      this.columns,
      this.quickFilterFields,
      nextCompleteRawSelect,
      this.active?.inputs.visibleColumnIds,
    );
    const replacingActiveSource =
      this.active !== undefined &&
      (this.active.semanticKey.viewport !== next.viewport ||
        !sameProjectionFields(this.projectionFields, nextProjectionFields));
    this.source = next;
    this.completeRawSelect = nextCompleteRawSelect;
    this.projectionFields = nextProjectionFields;
    if (replacingActiveSource) this.forceNextNavigationReset = true;
    this.publishResultRowCount(this.resolveResultRowCount());
    if (replacingActiveSource) return;
    this.publication = this.createPublication();
    this.reconcileStructureSnapshot();
    notify(this.listeners);
  }

  public replace(
    viewport: unknown,
    query: BrunoTableServerRuntimeQuery,
    inputs: BrunoTableServerQueryInputs = EMPTY_SERVER_QUERY_INPUTS,
    resetWhenInputsChange = false,
  ): void {
    const snappedInputs = snapshotServerQueryInputs(inputs);
    const visibleColumnIds = retainSurvivingVisibleColumnIds(
      this.columns,
      snappedInputs.visibleColumnIds,
    );
    const nextInputs =
      visibleColumnIds === snappedInputs.visibleColumnIds
        ? snappedInputs
        : Object.freeze({ ...snappedInputs, visibleColumnIds });
    this.rowEquivalencePlan = compileRowEquivalencePlan(this.columns, nextInputs.visibleColumnIds);
    const compilePlan = (candidate: BrunoTableServerQueryInputs) => {
      const candidateVisibleColumnIds = retainSurvivingVisibleColumnIds(
        this.columns,
        candidate.visibleColumnIds,
      );
      return compileBrunoTableServerQueryPlan(
        this.columns,
        {
          ...(candidate.routeBy === undefined ? {} : { routeBy: candidate.routeBy }),
          ...(candidate.externalFilters === undefined
            ? {}
            : { externalFilters: candidate.externalFilters }),
          ...(candidateVisibleColumnIds === undefined
            ? {}
            : { visibleColumnIds: candidateVisibleColumnIds }),
          filters: query.filters,
          quickFilter: query.quickFilter,
          quickFilterFields: this.quickFilterFields,
          orderBy: query.orderBy,
        },
        this.completeRawSelect,
      );
    };
    const queryPlan = compilePlan(nextInputs);
    this.projectionFields = queryPlan.query.select;
    const transport = requireViewportTransport<TRow>(viewport);
    let semanticKey: ActiveGeneration["semanticKey"];
    try {
      semanticKey = Object.freeze({
        viewport,
        query: transport.semanticKey(queryPlan.query),
      });
    } catch (error) {
      this.invalidateAfterSemanticKeyFailure(error);
    }
    if (sameSemanticKey(this.active?.semanticKey, semanticKey)) {
      const active = this.active;
      if (active !== undefined) {
        this.active = Object.freeze({
          ...active,
          inputs: nextInputs,
        });
      }
      this.forceNextNavigationReset = false;
      return;
    }
    let semanticInputsChanged = false;
    try {
      semanticInputsChanged =
        resetWhenInputsChange &&
        this.active !== undefined &&
        this.active.semanticKey.viewport === viewport &&
        !Object.is(transport.semanticKey(compilePlan(this.active.inputs).query), semanticKey.query);
    } catch (error) {
      this.invalidateAfterSemanticKeyFailure(error);
    }
    const nextNavigationMode =
      semanticInputsChanged ||
      this.forceNextNavigationReset ||
      this.lastReplacedViewport !== viewport
        ? "reset"
        : query.navigationMode;
    const previous = this.active;
    this.active = undefined;
    this.dispatchedWindow = undefined;
    if (previous !== undefined) {
      this.store.invalidateGeneration(previous.token);
      this.generationReleased = true;
      try {
        previous.controller.release();
      } catch (error) {
        this.publication = this.createPublication();
        preservePrimaryFailure(() => this.reconcileStructureSnapshot());
        preservePrimaryFailure(() => this.publishResultRowCount(this.resolveResultRowCount()));
        preservePrimaryFailure(() => notify(this.listeners));
        throw error;
      }
    }
    this.generationReleased = false;
    this.suppressStorePublication = true;
    const activeToken = this.store.beginGeneration(INITIAL_WINDOW);
    let controller: BrunoTableServerViewportGeneration;
    try {
      controller = transport.replace({
        window: INITIAL_WINDOW,
        query: queryPlan.query,
        sink: Object.freeze({
          setRowCount: (count, keepRenderedRows) => {
            const accepted = this.store.setRowCount(activeToken, count, keepRenderedRows);
            if (!accepted && this.store.isActiveGeneration(activeToken)) {
              throw new TypeError("BrunoTable Server viewport delivered an invalid row count.");
            }
          },
          setRowData: (rowsByIndex, rowKeysByIndex) => {
            const accepted = this.store.setRowData(activeToken, rowsByIndex, rowKeysByIndex);
            if (!accepted && this.store.isActiveGeneration(activeToken)) {
              throw new TypeError("BrunoTable Server viewport delivered invalid row/key maps.");
            }
          },
        }),
      });
    } catch (error) {
      this.store.invalidateGeneration(activeToken);
      this.generationReleased = true;
      this.suppressStorePublication = false;
      this.alignObservedStoreSnapshot();
      this.publication = this.createPublication();
      this.reconcileStructureSnapshot();
      this.publishResultRowCount(this.resolveResultRowCount());
      notify(this.listeners);
      throw error;
    }
    this.active = Object.freeze({
      token: activeToken,
      controller,
      inputs: nextInputs,
      semanticKey,
    });
    this.lastReplacedViewport = viewport;
    this.queryGeneration += 1;
    this.generationNavigationMode = nextNavigationMode;
    this.forceNextNavigationReset = false;
    this.dispatchedWindow = INITIAL_WINDOW;
    this.suppressStorePublication = false;
    this.forceFullStorePublication = true;
    this.reconcileStorePublication();
  }

  public getSemanticIdentity(): unknown {
    return this.active?.semanticKey;
  }

  private invalidateAfterSemanticKeyFailure(error: unknown): never {
    const previous = this.active;
    this.active = undefined;
    this.dispatchedWindow = undefined;
    this.forceNextNavigationReset = true;
    if (previous !== undefined) {
      this.store.invalidateGeneration(previous.token);
      this.generationReleased = true;
      preservePrimaryFailure(() => previous.controller.release());
    }
    this.suppressStorePublication = false;
    this.alignObservedStoreSnapshot();
    this.publication = this.createPublication();
    preservePrimaryFailure(() => this.reconcileStructureSnapshot());
    preservePrimaryFailure(() => this.publishResultRowCount(this.resolveResultRowCount()));
    preservePrimaryFailure(() => notify(this.listeners));
    throw error;
  }

  public readonly setRequiredRange = (start: number, end: number): void => {
    const active = this.active;
    if (active === undefined) return;
    const snapshot = this.store.getSnapshot();
    const totalRows = snapshot.rowSpace.totalRows;
    const requestedFirst = Math.max(0, Math.trunc(start));
    const maximumIndex = Math.max(0, totalRows - 1);
    const firstRow = snapshot.authoritativeTotalRows
      ? Math.min(requestedFirst, maximumIndex)
      : requestedFirst;
    const requestedLast = Math.max(firstRow, Math.trunc(end) - 1);
    const lastRow = snapshot.authoritativeTotalRows
      ? Math.min(requestedLast, maximumIndex)
      : requestedLast;
    const window = sanitizeBrunoTableServerViewportWindow({ firstRow, lastRow });
    const storeChanged = this.store.setRequiredRange(active.token, window);
    if (!storeChanged && sameViewportWindow(this.dispatchedWindow, window)) return;
    active.controller.setWindow(window);
    this.dispatchedWindow = window;
  };

  public release(): void {
    const active = this.active;
    if (active === undefined) return;
    this.active = undefined;
    this.dispatchedWindow = undefined;
    this.store.invalidateGeneration(active.token);
    this.generationReleased = true;
    this.publication = this.createPublication();
    let invalidationFailed = false;
    let invalidationFailure: unknown;
    const publishInvalidation = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        if (!invalidationFailed) invalidationFailure = error;
        invalidationFailed = true;
      }
    };
    publishInvalidation(() => this.reconcileStructureSnapshot());
    publishInvalidation(() => this.publishResultRowCount(this.resolveResultRowCount()));
    publishInvalidation(() => notify(this.listeners));
    active.controller.release();
    if (invalidationFailed) throw invalidationFailure;
  }

  private createPublication(
    changedRowIds?: ReadonlySet<string>,
  ): BrunoTableRowPipelinePublication<TRow> {
    const snapshot = this.store.getSnapshot();
    const retainedRowSpace =
      snapshot.generation === 0 || this.generationReleased ? undefined : snapshot.rowSpace;
    const totalRows = retainedRowSpace?.totalRows ?? this.source.totalRows;
    const hasCoherentRows =
      retainedRowSpace !== undefined &&
      (retainedRowSpace.loadedRows > 0 ||
        (snapshot.authoritativeTotalRows && retainedRowSpace.totalRows === 0));
    const status =
      !hasCoherentRows && this.source.status === "ready" ? "loading" : this.source.status;
    const hidesProvisionalRows =
      !hasCoherentRows &&
      (this.source.status === "stale" ||
        this.source.status === "closed" ||
        this.source.status === "error");
    const rowSpace =
      this.source.status === "loading" && retainedRowSpace !== undefined
        ? this.getMaskedRowSpace(retainedRowSpace)
        : hidesProvisionalRows
          ? undefined
          : retainedRowSpace;
    const visibleChangedRowIds =
      rowSpace === retainedRowSpace
        ? changedRowIds
        : rowSpace === undefined
          ? undefined
          : EMPTY_CHANGED_ROW_IDS;
    return Object.freeze({
      status,
      totalRows,
      version: this.source.version,
      ...(this.source.statusCode === undefined ? {} : { statusCode: this.source.statusCode }),
      ...(this.source.message === undefined ? {} : { message: this.source.message }),
      ...(this.source.retry === undefined ? {} : { retry: this.source.retry }),
      ...(rowSpace === undefined ? {} : { rowSpace }),
      ...(visibleChangedRowIds === undefined ? {} : { changedRowIds: visibleChangedRowIds }),
      hasCoherentRows,
    });
  }

  private publishResultRowCount(count: number): void {
    if (this.resultRowCount === count) return;
    this.resultRowCount = count;
    notify(this.resultRowCountListeners);
  }

  private resolveResultRowCount(): number {
    const snapshot = this.store.getSnapshot();
    if (!this.generationReleased && snapshot.authoritativeTotalRows) {
      return snapshot.rowSpace.totalRows;
    }
    return snapshot.generation === 0 ? this.source.totalRows : 0;
  }

  private getMaskedRowSpace(
    rowSpace: BrunoTableRowSpaceSnapshot<TRow>,
  ): BrunoTableRowSpaceSnapshot<TRow> {
    if (this.maskedRowSpace !== undefined && this.maskedRowSpace.totalRows === rowSpace.totalRows) {
      return this.maskedRowSpace.snapshot;
    }
    const snapshot = maskBrunoTableServerRowSpace(rowSpace);
    this.maskedRowSpace = Object.freeze({ totalRows: rowSpace.totalRows, snapshot });
    return snapshot;
  }

  private readonly reconcileStorePublication = (): void => {
    if (this.suppressStorePublication) return;
    const storeSnapshot = this.store.getSnapshot();
    if (
      storeSnapshot.rowSpace === this.observedRowSpace &&
      storeSnapshot.authoritativeTotalRows === this.observedAuthoritativeTotalRows
    ) {
      return;
    }
    this.observedRowSpace = storeSnapshot.rowSpace;
    this.observedAuthoritativeTotalRows = storeSnapshot.authoritativeTotalRows;
    const changedRowIds = this.forceFullStorePublication ? undefined : storeSnapshot.affectedRowIds;
    this.forceFullStorePublication = false;
    this.publication = this.createPublication(changedRowIds);
    if (storeSnapshot.structureVersion !== this.observedStructureVersion) {
      this.observedStructureVersion = storeSnapshot.structureVersion;
      this.reconcileStructureSnapshot();
    }
    this.publishResultRowCount(this.resolveResultRowCount());
    notify(this.listeners);
  };

  private alignObservedStoreSnapshot(): void {
    const storeSnapshot = this.store.getSnapshot();
    this.observedRowSpace = storeSnapshot.rowSpace;
    this.observedAuthoritativeTotalRows = storeSnapshot.authoritativeTotalRows;
    this.observedStructureVersion = storeSnapshot.structureVersion;
  }

  private reconcileStructureSnapshot(): void {
    const next = createStructureSnapshot(
      this.publication,
      this.store.findRowIndex,
      this.queryGeneration,
      this.generationNavigationMode,
    );
    if (
      next.totalRows === this.structureSnapshot.totalRows &&
      next.getRowId === this.structureSnapshot.getRowId &&
      next.findRowIndex === this.structureSnapshot.findRowIndex &&
      next.generation === this.structureSnapshot.generation &&
      next.navigationMode === this.structureSnapshot.navigationMode &&
      next.loading === this.structureSnapshot.loading
    ) {
      return;
    }
    this.structureSnapshot = next;
    notify(this.structureListeners);
  }
}

function maskBrunoTableServerRowSpace<TRow>(
  rowSpace: BrunoTableRowSpaceSnapshot<TRow>,
): BrunoTableRowSpaceSnapshot<TRow> {
  return Object.freeze({
    totalRows: rowSpace.totalRows === 0 ? INITIAL_WINDOW.lastRow + 1 : rowSpace.totalRows,
    loadedRows: 0,
    getRowId: EMPTY_SERVER_ROW_ID,
    getRow: () => undefined,
    getCellValue: () => undefined,
  });
}

function createStructureSnapshot<TRow>(
  publication: BrunoTableRowPipelinePublication<TRow>,
  findRowIndex: (rowId: string) => number | undefined,
  generation: number,
  navigationMode: BrunoTableQueryNavigationMode,
): BrunoTableServerStructureSnapshot {
  const rowSpace = publication.rowSpace;
  const identitiesHidden = rowSpace === undefined || rowSpace.getRowId === EMPTY_SERVER_ROW_ID;
  return Object.freeze({
    totalRows: rowSpace?.totalRows ?? 0,
    getRowId: rowSpace?.getRowId ?? EMPTY_SERVER_ROW_ID,
    findRowIndex: identitiesHidden ? EMPTY_SERVER_ROW_INDEX : findRowIndex,
    generation,
    navigationMode,
    loading: publication.status === "loading",
  });
}

const EMPTY_SERVER_ROW_ID = (): undefined => undefined;
const EMPTY_SERVER_ROW_INDEX = (): undefined => undefined;
const EMPTY_CHANGED_ROW_IDS: ReadonlySet<string> = new Set();

function requireViewportTransport<TRow>(
  viewport: unknown,
): BrunoTableServerViewportTransport<TRow> {
  if (typeof viewport !== "object" || viewport === null) {
    throw new TypeError("BrunoTable Server viewportSource.viewport must be an object.");
  }
  const replace = Reflect.get(viewport, "replace");
  if (typeof replace !== "function") {
    throw new TypeError("BrunoTable Server viewportSource.viewport must expose replace().");
  }
  const semanticKey = Reflect.get(viewport, "semanticKey");
  if (typeof semanticKey !== "function") {
    throw new TypeError("BrunoTable Server viewportSource.viewport must expose semanticKey().");
  }
  return Object.freeze({
    semanticKey: (query) => Reflect.apply(semanticKey, viewport, [query]),
    replace: (request) => {
      const candidate = Reflect.apply(replace, viewport, [request]);
      if (typeof candidate !== "object" || candidate === null) {
        throw new TypeError("BrunoTable Server viewport.replace() returned no generation.");
      }
      const setWindow = Reflect.get(candidate, "setWindow");
      const release = Reflect.get(candidate, "release");
      if (typeof setWindow !== "function" || typeof release !== "function") {
        const compatibilityError = new TypeError(
          "BrunoTable Server viewport generation must expose setWindow() and release().",
        );
        if (typeof release === "function") {
          try {
            Reflect.apply(release, candidate, []);
          } catch {
            // Compatibility is primary; a partially valid controller still receives best-effort
            // cleanup without replacing the boundary error.
          }
        }
        throw compatibilityError;
      }
      return Object.freeze({
        setWindow: (window) => Reflect.apply(setWindow, candidate, [window]),
        release: () => Reflect.apply(release, candidate, []),
      });
    },
  });
}

function snapshotSource(source: BrunoTableServerSourceInput): BrunoTableServerSourceSnapshot {
  const status: BrunoTableSourceStatus = SOURCE_STATUSES.has(source.status)
    ? source.status
    : "error";
  return Object.freeze({
    viewport: source.viewport,
    totalRows:
      Number.isSafeInteger(source.totalRows) && source.totalRows >= 0 ? source.totalRows : 0,
    version: Number.isSafeInteger(source.version) && source.version >= 0 ? source.version : 0,
    status,
    ...(typeof source.statusCode === "string" ? { statusCode: source.statusCode } : {}),
    ...(typeof source.message === "string" ? { message: source.message } : {}),
    ...(source.retry === undefined ? {} : { retry: source.retry }),
  });
}

function snapshotCompleteRawSelect(candidate: unknown): readonly [string, ...string[]] {
  if (!Array.isArray(candidate)) {
    throw new TypeError(
      "BrunoTable Server viewportSource.completeRawSelect must be a non-empty unique source field tuple.",
    );
  }
  const first = candidate[0];
  let hasInvalidField = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const field = candidate[index];
    if (
      !Object.hasOwn(candidate, index) ||
      typeof field !== "string" ||
      field.trim().length === 0
    ) {
      hasInvalidField = true;
      break;
    }
  }
  if (
    typeof first !== "string" ||
    first.trim().length === 0 ||
    hasInvalidField ||
    new Set(candidate).size !== candidate.length
  ) {
    throw new TypeError(
      "BrunoTable Server viewportSource.completeRawSelect must be a non-empty unique source field tuple.",
    );
  }
  return Object.freeze([first, ...candidate.slice(1)]);
}

function notify(listeners: ReadonlySet<Listener>): void {
  let firstError: unknown;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

function preservePrimaryFailure(operation: () => void): void {
  try {
    operation();
  } catch {
    // Cleanup remains best-effort after a source failure; a secondary release, reconciliation,
    // or subscriber failure must not replace the primary transport error.
  }
}

function sameViewportWindow(
  left: BrunoTableServerViewportWindow | undefined,
  right: BrunoTableServerViewportWindow,
): boolean {
  return left?.firstRow === right.firstRow && left.lastRow === right.lastRow;
}

const SOURCE_STATUSES = new Set<BrunoTableSourceStatus>([
  "loading",
  "ready",
  "stale",
  "closed",
  "error",
]);

function sameSemanticKey(
  previous: ActiveGeneration["semanticKey"] | undefined,
  next: ActiveGeneration["semanticKey"],
): boolean {
  return (
    previous !== undefined &&
    previous.viewport === next.viewport &&
    Object.is(previous.query, next.query)
  );
}

function snapshotServerQueryInputs(
  inputs: BrunoTableServerQueryInputs,
): BrunoTableServerQueryInputs {
  return Object.freeze({
    routeBy: inputs.routeBy === undefined ? undefined : Object.freeze({ ...inputs.routeBy }),
    externalFilters:
      inputs.externalFilters === undefined ? undefined : Object.freeze([...inputs.externalFilters]),
    visibleColumnIds:
      inputs.visibleColumnIds === undefined
        ? undefined
        : Object.freeze([...inputs.visibleColumnIds]),
  });
}

function retainSurvivingVisibleColumnIds(
  columns: readonly CompiledColumn[],
  visibleColumnIds: readonly string[] | undefined,
): readonly string[] | undefined {
  return visibleColumnIds === undefined ||
    visibleColumnIds.some((columnId) => columns.some((column) => column.columnId === columnId))
    ? visibleColumnIds
    : undefined;
}

function sameProjectionFields(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field) => right.includes(field));
}

function sameArray<TValue>(
  left: readonly TValue[],
  right: readonly TValue[],
  equivalent: (left: TValue, right: TValue) => boolean,
): boolean {
  return (
    left.length === right.length && left.every((value, index) => equivalent(value, right[index]!))
  );
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return sameArray(left, right, Object.is);
}

function compileRowEquivalencePlan(
  columns: readonly CompiledColumn[],
  visibleColumnIds?: readonly string[],
): RowEquivalencePlan {
  const visibleIds = visibleColumnIds === undefined ? undefined : new Set(visibleColumnIds);
  const fieldColumns = new Map<string, CompiledColumn[]>();
  const computedColumns: CompiledColumn[] = [];
  for (const column of columns) {
    if (visibleIds !== undefined && !visibleIds.has(column.columnId)) continue;
    if (column.kind === "computed") {
      computedColumns.push(column);
      continue;
    }
    const matching = fieldColumns.get(column.field) ?? [];
    matching.push(column);
    fieldColumns.set(column.field, matching);
  }
  return Object.freeze({
    fieldColumns: new Map(
      [...fieldColumns].map(([field, matching]) => [field, Object.freeze(matching)] as const),
    ),
    computedColumns: Object.freeze(computedColumns),
    usesRawRowPresentation: columns.some(
      (column) =>
        (visibleIds === undefined || visibleIds.has(column.columnId)) &&
        columnUsesRawRowPresentation(column),
    ),
  });
}

function rowsEquivalentBySelectedValues<TRow>(
  plan: RowEquivalencePlan,
  previous: TRow,
  next: TRow,
): boolean {
  if (Object.is(previous, next)) return true;
  if (
    typeof previous !== "object" ||
    previous === null ||
    typeof next !== "object" ||
    next === null
  ) {
    return false;
  }
  if (plan.usesRawRowPresentation) return false;
  const previousKeys = Reflect.ownKeys(previous);
  const nextKeys = Reflect.ownKeys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false;
    const left = Reflect.get(previous, key);
    const right = Reflect.get(next, key);
    const matching = typeof key === "string" ? plan.fieldColumns.get(key) : undefined;
    if (matching === undefined) {
      if (!Object.is(left, right)) return false;
      continue;
    }
    for (const column of matching) {
      try {
        if (
          !column.semantics.equivalent(left, right) ||
          column.semantics.formatDisplay(left) !== column.semantics.formatDisplay(right)
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }
  for (const column of plan.computedColumns) {
    try {
      const left = readCompiledColumnValue(column, previous);
      const right = readCompiledColumnValue(column, next);
      if (
        !column.semantics.equivalent(left, right) ||
        column.semantics.formatDisplay(left) !== column.semantics.formatDisplay(right)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
