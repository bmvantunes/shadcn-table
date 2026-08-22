import type { BrunoTableSourceChrome, BrunoTableSourceStatus } from "../public-types";
import { readCompiledColumnValue } from "./cell-value";
import type { CompiledColumn } from "./compile-columns";
import type {
  BrunoTableQueryConfiguration,
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
  compileBrunoTableServerProjectionFields,
  compileBrunoTableServerQueryPlan,
  type BrunoTableCompiledServerQueryPlan,
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
  readonly replace: (
    request: BrunoTableServerViewportRequest<TRow>,
  ) => BrunoTableServerViewportGeneration;
}>;

type ActiveGeneration = Readonly<{
  readonly token: number;
  readonly controller: BrunoTableServerViewportGeneration;
  readonly semanticKey: Readonly<{
    readonly viewport: unknown;
    readonly queryPlan: BrunoTableCompiledServerQueryPlan;
  }>;
}>;

type RowEquivalencePlan = Readonly<{
  readonly fieldColumns: ReadonlyMap<string, readonly CompiledColumn[]>;
  readonly computedColumns: readonly CompiledColumn[];
}>;

type BrunoTableServerRuntimeQuery = Readonly<{
  readonly generation: number;
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
  private dispatchedWindow: BrunoTableServerViewportWindow | undefined;
  private generationReleased = true;
  private suppressStorePublication = false;
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
    this.structureSnapshot = createStructureSnapshot(this.publication);
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
    const snapshot = this.store.getSnapshot();
    const count = snapshot.authoritativeTotalRows
      ? snapshot.rowSpace.totalRows
      : this.source.totalRows;
    if (this.resultRowCount === count) return false;
    this.publishResultRowCount(count);
    return true;
  };

  public readonly getQueryConfiguration = (): BrunoTableQueryConfiguration =>
    this.queryConfiguration;

  public reconcileColumns(
    columns: readonly CompiledColumn[],
    quickFilterFields: readonly string[] | undefined,
  ): BrunoTableQueryConfiguration {
    const nextQuickFilterFields =
      quickFilterFields === this.quickFilterFields
        ? this.quickFilterFields
        : snapshotBrunoTableQuickFilterFields(quickFilterFields);
    const nextProjectionFields = compileBrunoTableServerProjectionFields(
      columns,
      nextQuickFilterFields,
      this.completeRawSelect,
    );
    if (
      columns === this.columns &&
      sameStringArray(nextQuickFilterFields, this.quickFilterFields)
    ) {
      return this.queryConfiguration;
    }
    if (columns === this.columns) {
      if (!sameProjectionFields(this.projectionFields, nextProjectionFields)) this.release();
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
    if (!sameProjectionFields(this.projectionFields, nextProjectionFields)) this.release();
    this.columns = columns;
    this.quickFilterFields = nextQuickFilterFields;
    this.projectionFields = nextProjectionFields;
    this.rowEquivalencePlan = compileRowEquivalencePlan(columns);
    this.columnsById = new Map(columns.map((column) => [column.columnId, column]));
    this.queryConfiguration = Object.freeze({
      baselineFilters: filterCollection.filters,
      baselineFilterCollection: filterCollection,
      baselineOrderBy: initialOrderBy,
      quickFilterFields: nextQuickFilterFields,
    });
    return this.queryConfiguration;
  }

  public readonly getGeneration = (): number => this.store.getSnapshot().generation;

  public readonly findRowIndex = (rowId: string): number | undefined =>
    this.store.findRowIndex(rowId);

  public reconcileSource(source: BrunoTableServerSourceInput): void {
    const nextCompleteRawSelect = snapshotCompleteRawSelect(source.completeRawSelect);
    const next = snapshotSource(source);
    const nextProjectionFields = compileBrunoTableServerProjectionFields(
      this.columns,
      this.quickFilterFields,
      nextCompleteRawSelect,
    );
    const replacingActiveSource =
      this.active !== undefined &&
      (this.active.semanticKey.viewport !== next.viewport ||
        !sameProjectionFields(this.projectionFields, nextProjectionFields));
    this.source = next;
    this.completeRawSelect = nextCompleteRawSelect;
    this.projectionFields = nextProjectionFields;
    const storeSnapshot = this.store.getSnapshot();
    this.publishResultRowCount(
      this.active?.semanticKey.viewport === next.viewport && storeSnapshot.authoritativeTotalRows
        ? storeSnapshot.rowSpace.totalRows
        : next.totalRows,
    );
    if (replacingActiveSource) return;
    this.publication = this.createPublication();
    this.reconcileStructureSnapshot();
    notify(this.listeners);
  }

  public replace(viewport: unknown, query: BrunoTableServerRuntimeQuery): void {
    const queryPlan = compileBrunoTableServerQueryPlan(
      this.columns,
      {
        filters: query.filters,
        quickFilter: query.quickFilter,
        quickFilterFields: this.quickFilterFields,
        orderBy: query.orderBy,
      },
      this.completeRawSelect,
    );
    const semanticKey = Object.freeze({
      viewport,
      queryPlan,
    });
    if (sameSemanticKey(this.active?.semanticKey, semanticKey)) return;
    const transport = requireViewportTransport<TRow>(viewport);
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
        preservePrimaryFailure(() => this.publishResultRowCount(this.source.totalRows));
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
      this.publishResultRowCount(this.source.totalRows);
      notify(this.listeners);
      throw error;
    }
    this.active = Object.freeze({ token: activeToken, controller, semanticKey });
    this.dispatchedWindow = INITIAL_WINDOW;
    this.suppressStorePublication = false;
    this.reconcileStorePublication();
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
    this.reconcileStructureSnapshot();
    active.controller.release();
  }

  private createPublication(): BrunoTableRowPipelinePublication<TRow> {
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
    const hidesRetainedRows =
      this.source.status === "loading" ||
      (!hasCoherentRows && (this.source.status === "closed" || this.source.status === "error"));
    const rowSpace = hidesRetainedRows ? undefined : retainedRowSpace;
    return Object.freeze({
      status,
      totalRows,
      version: this.source.version,
      ...(this.source.statusCode === undefined ? {} : { statusCode: this.source.statusCode }),
      ...(this.source.message === undefined ? {} : { message: this.source.message }),
      ...(this.source.retry === undefined ? {} : { retry: this.source.retry }),
      ...(rowSpace === undefined ? {} : { rowSpace }),
      hasCoherentRows,
    });
  }

  private publishResultRowCount(count: number): void {
    if (this.resultRowCount === count) return;
    this.resultRowCount = count;
    notify(this.resultRowCountListeners);
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
    this.publication = this.createPublication();
    if (storeSnapshot.structureVersion !== this.observedStructureVersion) {
      this.observedStructureVersion = storeSnapshot.structureVersion;
      this.reconcileStructureSnapshot();
    }
    this.publishResultRowCount(
      storeSnapshot.authoritativeTotalRows
        ? storeSnapshot.rowSpace.totalRows
        : this.source.totalRows,
    );
    notify(this.listeners);
  };

  private alignObservedStoreSnapshot(): void {
    const storeSnapshot = this.store.getSnapshot();
    this.observedRowSpace = storeSnapshot.rowSpace;
    this.observedAuthoritativeTotalRows = storeSnapshot.authoritativeTotalRows;
    this.observedStructureVersion = storeSnapshot.structureVersion;
  }

  private reconcileStructureSnapshot(): void {
    const next = createStructureSnapshot(this.publication);
    if (
      next.totalRows === this.structureSnapshot.totalRows &&
      next.getRowId === this.structureSnapshot.getRowId
    ) {
      return;
    }
    this.structureSnapshot = next;
    notify(this.structureListeners);
  }
}

function createStructureSnapshot<TRow>(
  publication: BrunoTableRowPipelinePublication<TRow>,
): BrunoTableServerStructureSnapshot {
  const rowSpace = publication.rowSpace;
  return Object.freeze({
    totalRows: rowSpace?.totalRows ?? 0,
    getRowId: rowSpace?.getRowId ?? EMPTY_SERVER_ROW_ID,
  });
}

const EMPTY_SERVER_ROW_ID = (): undefined => undefined;

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
  return Object.freeze({
    replace: (request) => {
      const candidate = Reflect.apply(replace, viewport, [request]);
      if (typeof candidate !== "object" || candidate === null) {
        throw new TypeError("BrunoTable Server viewport.replace() returned no generation.");
      }
      const setWindow = Reflect.get(candidate, "setWindow");
      const release = Reflect.get(candidate, "release");
      if (typeof setWindow !== "function" || typeof release !== "function") {
        throw new TypeError(
          "BrunoTable Server viewport generation must expose setWindow() and release().",
        );
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
  if (
    typeof first !== "string" ||
    first.trim().length === 0 ||
    candidate.some((field) => typeof field !== "string" || field.trim().length === 0) ||
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
    // The controller release failure is primary. Reconciliation is still attempted, but a
    // subscriber failure must not replace the source transport error.
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
    sameCompiledQuery(previous.queryPlan, next.queryPlan)
  );
}

function sameCompiledQuery(
  leftPlan: BrunoTableCompiledServerQueryPlan,
  rightPlan: BrunoTableCompiledServerQueryPlan,
): boolean {
  const left = leftPlan.query;
  const right = rightPlan.query;
  return (
    sameProjectionFields(left.select, right.select) &&
    sameArray(
      left.orderBy,
      right.orderBy,
      (leftOrder, rightOrder) =>
        leftOrder.field === rightOrder.field && leftOrder.direction === rightOrder.direction,
    ) &&
    sameArray(left.where, right.where, (leftWhere, rightWhere) =>
      sameQueryValue(leftWhere, rightWhere, leftPlan, rightPlan),
    )
  );
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

function sameQueryValue(
  left: unknown,
  right: unknown,
  leftPlan: BrunoTableCompiledServerQueryPlan,
  rightPlan: BrunoTableCompiledServerQueryPlan,
): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return sameArray(left, right, (leftValue, rightValue) =>
      sameQueryValue(leftValue, rightValue, leftPlan, rightPlan),
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false;
  }
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  const leftSemantics = leftPlan.operandSemantics.get(left);
  const rightSemantics = rightPlan.operandSemantics.get(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        (key === "filter" || key === "filterTo"
          ? sameQueryOperand(
              Reflect.get(left, key),
              Reflect.get(right, key),
              leftSemantics,
              rightSemantics,
            )
          : sameQueryValue(Reflect.get(left, key), Reflect.get(right, key), leftPlan, rightPlan)),
    )
  );
}

function sameQueryOperand(
  left: unknown,
  right: unknown,
  leftSemantics: CompiledColumn["semantics"] | undefined,
  rightSemantics: CompiledColumn["semantics"] | undefined,
): boolean {
  if (leftSemantics === undefined || rightSemantics === undefined) return Object.is(left, right);
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      sameArray(left, right, (leftValue, rightValue) =>
        sameQueryOperand(leftValue, rightValue, leftSemantics, rightSemantics),
      )
    );
  }
  if (
    leftSemantics.codecId !== rightSemantics.codecId ||
    leftSemantics.codecVersion !== rightSemantics.codecVersion
  ) {
    return false;
  }
  try {
    return leftSemantics.equivalent(left, right) && rightSemantics.equivalent(left, right);
  } catch {
    return false;
  }
}

function compileRowEquivalencePlan(columns: readonly CompiledColumn[]): RowEquivalencePlan {
  const fieldColumns = new Map<string, CompiledColumn[]>();
  const computedColumns: CompiledColumn[] = [];
  for (const column of columns) {
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
        if (!column.semantics.equivalent(left, right)) return false;
      } catch {
        return false;
      }
    }
  }
  for (const column of plan.computedColumns) {
    try {
      const left = readCompiledColumnValue(column, previous);
      const right = readCompiledColumnValue(column, next);
      if (!column.semantics.equivalent(left, right)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
