import type { BrunoTableClientSource, BrunoTableRowId } from "../public-types";
import type {
  BrunoTableQueryConfiguration,
  BrunoTableRowPipelinePublication,
  BrunoTableRowSpaceSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import { createBrunoTableInvalidCellValue, isBrunoTableInvalidCellValue } from "./grid-runtime";
import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";
import type { ClientOrderBy } from "./grid-query";
import {
  collectClientFilterColumnIds,
  reconcileClientOrderBy,
  sanitizeClientInitialFilters,
  sanitizeClientInitialOrderBy,
} from "./grid-query";

export class BrunoTableClientRowPipelineAdapter<TRow> {
  private sourceRowsInput: readonly TRow[];
  private source: BrunoTableClientSource<TRow>;
  private getRowId: (row: TRow) => BrunoTableRowId;
  private publication: BrunoTableRowPipelinePublication<TRow>;
  private coherent: ClientCoherentSnapshot<TRow> | undefined;
  private acceptedCoherent: ClientCoherentSnapshot<TRow> | undefined;
  private readonly initialFilters: readonly unknown[];
  private readonly initialOrderBy: ClientOrderBy;
  private sourceColumns: readonly CompiledColumn[];
  private queryColumns: readonly CompiledColumn[];
  private queryConfiguration: BrunoTableQueryConfiguration;
  private activeFilters: readonly unknown[];
  private activeOrderBy: ClientOrderBy;
  private validationColumnIds: ReadonlySet<string>;
  private queryValidationPending = true;
  private readonly valueCache = new ClientCanonicalValueCache();

  public constructor(
    source: BrunoTableClientSource<TRow>,
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
    initialFilters: readonly unknown[] | undefined,
    initialOrderBy: ClientOrderBy | undefined,
  ) {
    this.initialFilters = sanitizeClientInitialFilters(initialFilters, columns);
    this.initialOrderBy = sanitizeClientInitialOrderBy(initialOrderBy, columns);
    this.activeFilters = this.initialFilters;
    this.activeOrderBy = this.initialOrderBy;
    this.validationColumnIds = queryColumnIds(this.initialFilters, this.initialOrderBy);
    this.sourceRowsInput = source.rows;
    this.source = snapshotSource(source);
    this.getRowId = getRowId;
    this.publication = createPublication(
      this.source,
      getRowId,
      columns,
      undefined,
      undefined,
      false,
      this.validationColumnIds,
      "none",
      this.valueCache,
    );
    this.coherent = nextCoherent(this.coherent, this.publication);
    this.acceptEmptyCoherent();
    this.sourceColumns = columns;
    this.queryColumns = columns;
    this.queryConfiguration = Object.freeze({
      baselineFilters: this.initialFilters,
      baselineOrderBy: this.initialOrderBy,
    });
  }

  public readonly getPublication = (): BrunoTableRowPipelinePublication<TRow> => this.publication;

  public readonly getQueryConfiguration = (
    columns: readonly CompiledColumn[],
  ): BrunoTableQueryConfiguration => {
    if (columns === this.queryColumns) return this.queryConfiguration;
    const baselineFilters = sanitizeClientInitialFilters(this.initialFilters, columns);
    const baselineOrderBy = reconcileClientOrderBy(
      this.initialOrderBy,
      this.initialOrderBy,
      columns,
    );
    if (baselineOrderBy.length === 0) {
      throw new TypeError("BrunoTableClient requires at least one sortable column.");
    }
    this.activeFilters = sanitizeClientInitialFilters(this.activeFilters, columns);
    this.activeOrderBy = reconcileClientOrderBy(this.activeOrderBy, baselineOrderBy, columns);
    this.updateValidationColumnIds(queryColumnIds(this.activeFilters, this.activeOrderBy));
    this.queryColumns = columns;
    this.queryConfiguration = Object.freeze({ baselineFilters, baselineOrderBy });
    return this.queryConfiguration;
  };

  public readonly reconcile = (
    source: BrunoTableClientSource<TRow>,
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
  ): BrunoTableRowPipelinePublication<TRow> => {
    const previousCoherent = this.coherent;
    const sourceSnapshot = snapshotSource(
      source,
      source.rows === this.sourceRowsInput ? this.source.rows : undefined,
    );
    this.publication = createPublication(
      sourceSnapshot,
      getRowId,
      columns,
      this.coherent,
      this.acceptedCoherent,
      this.getRowId !== getRowId,
      this.validationColumnIds,
      this.queryValidationPending ? "all" : "changed",
      this.valueCache,
    );
    this.recordQueryValidation(sourceSnapshot);
    this.coherent = nextCoherent(this.coherent, this.publication);
    this.acceptEmptyCoherent();
    if (
      this.coherent !== undefined &&
      this.coherent !== previousCoherent &&
      this.coherent.changeFromPrevious.rowIdsChanged
    ) {
      this.valueCache.retainRowIds(this.coherent.hasRowId);
    }
    this.valueCache.retainColumns(columns, this.coherent?.validatedColumns);
    this.sourceRowsInput = source.rows;
    this.source = sourceSnapshot;
    this.getRowId = getRowId;
    this.sourceColumns = columns;
    return this.publication;
  };

  public readonly publish = (
    source: BrunoTableClientSource<TRow>,
  ): BrunoTableRowPipelinePublication<TRow> =>
    this.reconcile(source, this.getRowId, this.sourceColumns);

  public readonly configure = (
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
  ): BrunoTableRowPipelinePublication<TRow> => {
    const previousCoherent = this.coherent;
    this.publication = createPublication(
      this.source,
      getRowId,
      columns,
      this.coherent,
      this.acceptedCoherent,
      this.getRowId !== getRowId,
      this.validationColumnIds,
      this.queryValidationPending ? "all" : "changed",
      this.valueCache,
    );
    this.recordQueryValidation(this.source);
    this.coherent = nextCoherent(this.coherent, this.publication);
    this.acceptEmptyCoherent();
    if (
      this.coherent !== undefined &&
      this.coherent !== previousCoherent &&
      this.coherent.changeFromPrevious.rowIdsChanged
    ) {
      this.valueCache.retainRowIds(this.coherent.hasRowId);
    }
    this.valueCache.retainColumns(columns, this.coherent?.validatedColumns);
    this.getRowId = getRowId;
    this.sourceColumns = columns;
    return this.publication;
  };

  public readonly resolveRowId = (row: unknown): BrunoTableRowId => this.getRowId(row as TRow);

  public readonly setActiveQuery = (filters: readonly unknown[], orderBy: ClientOrderBy): void => {
    this.activeFilters = filters;
    this.activeOrderBy = orderBy;
    this.updateValidationColumnIds(queryColumnIds(filters, orderBy));
  };

  private readonly updateValidationColumnIds = (next: ReadonlySet<string>): void => {
    if (!sameStringSet(this.validationColumnIds, next)) this.queryValidationPending = true;
    this.validationColumnIds = next;
  };

  private readonly recordQueryValidation = (source: BrunoTableClientSource<TRow>): void => {
    if (this.publication.invalid?.kind === "invalid-value") {
      this.queryValidationPending = true;
    } else if (canValidateSource(source)) {
      this.queryValidationPending = false;
    }
  };

  public readonly acceptRows = (rows: readonly BrunoTableClientAdmittedRow[]): void => {
    if (this.coherent?.admittedRows === rows) this.acceptedCoherent = this.coherent;
  };

  private readonly acceptEmptyCoherent = (): void => {
    if (this.coherent?.admittedRows.length === 0) this.acceptedCoherent = this.coherent;
  };

  public readonly createRowsStore = (
    runtime: BrunoTableRuntimeView,
    detector: BrunoTableClientRowOrderChangeDetector,
  ): BrunoTableClientRowsStore => {
    let snapshot: readonly BrunoTableClientAdmittedRow[] =
      this.coherent?.admittedRows ?? EMPTY_ROWS;
    const listeners = new Set<() => void>();
    let unsubscribeRuntime: (() => void) | undefined;
    const publish = () => {
      const previousRows = snapshot;
      const nextCoherent = this.coherent;
      const nextRows = nextCoherent?.admittedRows ?? EMPTY_ROWS;
      const change =
        nextCoherent?.changeFromPrevious ??
        Object.freeze({ rowIdsChanged: previousRows.length > 0, changedIndexes: EMPTY_ROWS });
      try {
        if (!detector(previousRows, nextRows, change)) {
          if (nextCoherent !== undefined) this.acceptedCoherent = nextCoherent;
          return;
        }
      } catch (error) {
        snapshot = nextRows;
        notifyRowsStoreListeners(listeners, error);
        return;
      }
      snapshot = nextRows;
      notifyRowsStoreListeners(listeners);
    };
    return Object.freeze({
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        if (unsubscribeRuntime === undefined) {
          snapshot = this.coherent?.admittedRows ?? EMPTY_ROWS;
          unsubscribeRuntime = runtime.subscribeRowSpace(publish);
        }
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          listeners.delete(listener);
          if (listeners.size === 0) {
            unsubscribeRuntime?.();
            unsubscribeRuntime = undefined;
          }
        };
      },
    });
  };
}

export type BrunoTableClientRowOrderChangeDetector = (
  previousRows: readonly BrunoTableClientAdmittedRow[],
  nextRows: readonly BrunoTableClientAdmittedRow[],
  change: BrunoTableClientRowOrderChange,
) => boolean;

export type BrunoTableClientRowOrderChange = Readonly<{
  readonly rowIdsChanged: boolean;
  readonly changedIndexes: readonly number[];
}>;

export type BrunoTableClientRowsStore = Readonly<{
  readonly getSnapshot: () => readonly BrunoTableClientAdmittedRow[];
  readonly subscribe: (listener: () => void) => () => void;
}>;

export type BrunoTableClientAdmittedRow = Readonly<{
  readonly raw: unknown;
  readonly rowId: BrunoTableRowId;
  readonly rowIndex: number;
  readonly values: BrunoTableClientValueCache;
}>;

export type BrunoTableClientValueCache = Readonly<{
  readonly read: (
    row: unknown,
    rowId: BrunoTableRowId,
    rowIndex: number,
    column: CompiledColumn,
  ) => unknown;
}>;

type ClientCoherentSnapshot<TRow> = BrunoTableRowSpaceSnapshot<TRow> &
  Readonly<{
    readonly rows: readonly TRow[];
    readonly admittedRows: readonly BrunoTableClientAdmittedRow[];
    readonly rowIds: readonly BrunoTableRowId[];
    readonly hasRowId: (rowId: BrunoTableRowId) => boolean;
    readonly identityResolver: (row: TRow) => BrunoTableRowId;
    readonly changeFromPrevious: BrunoTableClientRowOrderChange;
    readonly validatedColumns: readonly CompiledColumn[];
  }>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);
const EMPTY_COLUMNS: readonly CompiledColumn[] = Object.freeze([]);
const EMPTY_ADMITTED_ROWS: readonly BrunoTableClientAdmittedRow[] = Object.freeze([]);
const NOT_FOUND = Object.freeze({ found: false as const });
const CLIENT_BOUNDED_VALUE_CACHE_LIMIT = 16_384;

function createPublication<TRow>(
  source: BrunoTableClientSource<TRow>,
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  previousCoherent: ClientCoherentSnapshot<TRow> | undefined,
  fallbackCoherent: ClientCoherentSnapshot<TRow> | undefined,
  resolveRowIds: boolean,
  validationColumnIds: ReadonlySet<string>,
  queryValidation: "none" | "all" | "changed",
  valueCache: ClientCanonicalValueCache,
): BrunoTableRowPipelinePublication<TRow> {
  const complete = isCompleteSource(source);
  const invalid =
    (source.status === "ready" || source.status === "stale") && !complete
      ? Object.freeze({
          kind: "row-count-mismatch" as const,
          expectedRows: source.totalRows,
          receivedRows: source.rows.length,
        })
      : undefined;
  const coherentResult =
    complete && source.status !== "loading"
      ? createCoherent(source.rows, getRowId, columns, previousCoherent, resolveRowIds, valueCache)
      : undefined;
  const terminal = source.status === "closed" || source.status === "error";
  const validationColumns = columns.filter((column) => validationColumnIds.has(column.columnId));
  const lifecycleCandidate = coherentResult?.coherent;
  const invalidValue =
    lifecycleCandidate !== undefined
      ? validateAdmittedRows(
          rowsRequiringQueryValidation(
            lifecycleCandidate,
            previousCoherent,
            columns,
            queryValidation,
          ),
          validationColumns,
        )
      : coherentResult?.invalid;
  const currentCoherent = invalidValue === undefined ? lifecycleCandidate : undefined;
  const retainPrevious = terminal || source.status === "stale";
  const useFallback =
    fallbackCoherent !== undefined &&
    retainPrevious &&
    (currentCoherent === undefined || (terminal && currentCoherent.rows.length === 0));
  const fallbackResult = useFallback
    ? createCoherent(
        fallbackCoherent.rows,
        getRowId,
        columns,
        previousCoherent,
        resolveRowIds,
        valueCache,
      )
    : undefined;
  const fallbackCandidate = fallbackResult?.coherent;
  const fallbackInvalidValue =
    fallbackCandidate === undefined
      ? fallbackResult?.invalid
      : validateAdmittedRows(
          queryValidation === "none" ? EMPTY_ADMITTED_ROWS : fallbackCandidate.admittedRows,
          validationColumns,
        );
  const coherent = useFallback
    ? fallbackInvalidValue === undefined
      ? fallbackCandidate
      : undefined
    : currentCoherent;
  const hasCoherentRows = coherent !== undefined && (!terminal || coherent.rows.length > 0);
  const resolvedInvalid = invalid ?? invalidValue ?? fallbackInvalidValue;
  return Object.freeze({
    status: source.status,
    totalRows: source.totalRows,
    version: source.version,
    ...(source.statusCode === undefined ? {} : { statusCode: source.statusCode }),
    ...(source.message === undefined ? {} : { message: source.message }),
    ...(source.retry === undefined ? {} : { retry: source.retry }),
    ...(coherent === undefined ? {} : { rowSpace: coherent }),
    hasCoherentRows,
    ...(resolvedInvalid === undefined ? {} : { invalid: resolvedInvalid }),
  });
}

function rowsRequiringQueryValidation<TRow>(
  coherent: ClientCoherentSnapshot<TRow>,
  previous: ClientCoherentSnapshot<TRow> | undefined,
  columns: readonly CompiledColumn[],
  queryValidation: "none" | "all" | "changed",
): readonly BrunoTableClientAdmittedRow[] {
  if (queryValidation === "none") return EMPTY_ADMITTED_ROWS;
  if (
    queryValidation === "all" ||
    previous === undefined ||
    previous.validatedColumns !== columns
  ) {
    return coherent.admittedRows;
  }
  if (coherent === previous) return EMPTY_ADMITTED_ROWS;
  return Object.freeze(
    coherent.changeFromPrevious.changedIndexes.flatMap((index) => {
      const row = coherent.admittedRows[index];
      return row === undefined ? [] : [row];
    }),
  );
}

type CoherentResult<TRow> = Readonly<{
  readonly coherent?: ClientCoherentSnapshot<TRow>;
  readonly invalid?: Readonly<{
    readonly kind: "invalid-value";
    readonly rowIndex: number;
    readonly columnId: string;
    readonly message: string;
  }>;
}>;

function createCoherent<TRow>(
  rows: readonly TRow[],
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  previous: ClientCoherentSnapshot<TRow> | undefined,
  resolveRowIds: boolean,
  valueCache: ClientCanonicalValueCache,
): CoherentResult<TRow> {
  const resolveCurrentRowIds =
    resolveRowIds || (previous !== undefined && previous.identityResolver !== getRowId);
  if (
    previous !== undefined &&
    !resolveCurrentRowIds &&
    previous.rows === rows &&
    previous.validatedColumns === columns
  ) {
    return Object.freeze({ coherent: previous });
  }
  if (
    previous !== undefined &&
    !resolveCurrentRowIds &&
    previous.validatedColumns === columns &&
    previous.rows.length === rows.length &&
    rows.every((row, index) => previous.rows[index] === row)
  ) {
    return Object.freeze({ coherent: previous });
  }
  const rowIds = Array.from({ length: rows.length }, () => "" as BrunoTableRowId);
  const admittedRows = Array.from<BrunoTableClientAdmittedRow>({ length: rows.length });
  const admittedById = new Map<BrunoTableRowId, BrunoTableClientAdmittedRow>();
  const columnsById = new Map<string, CompiledColumn>(
    columns.map((column) => [column.columnId, column]),
  );
  let rowIdsChanged = previous === undefined || previous.rows.length !== rows.length;
  const changedIndexes: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const previousRow = previous?.rows[index];
    const rowId =
      previous !== undefined && previousRow === row && !resolveCurrentRowIds
        ? previous.rowIds[index]!
        : getRowId(row);
    if (typeof rowId !== "string" || rowId.length === 0) {
      throw new TypeError("BrunoTable getRowId must return a non-empty string.");
    }
    if (admittedById.has(rowId)) {
      throw new TypeError(`BrunoTable getRowId returned a duplicate row identity: ${rowId}`);
    }
    const previousAdmitted = previous?.admittedRows[index];
    const admitted =
      previousRow === row && previousAdmitted !== undefined
        ? previousAdmitted.rowId === rowId
          ? previousAdmitted
          : Object.freeze({ ...previousAdmitted, rowId })
        : Object.freeze({ raw: row, rowId, rowIndex: index, values: valueCache });
    rowIds[index] = rowId;
    admittedRows[index] = admitted;
    admittedById.set(rowId, admitted);
    if (previousRow !== row) changedIndexes.push(index);
    if (previous?.rowIds[index] !== rowId) rowIdsChanged = true;
  }
  if (
    !rowIdsChanged &&
    changedIndexes.length === 0 &&
    previous !== undefined &&
    previous.validatedColumns === columns
  ) {
    return Object.freeze({ coherent: previous });
  }
  const changeFromPrevious: BrunoTableClientRowOrderChange = Object.freeze({
    rowIdsChanged,
    changedIndexes: Object.freeze(changedIndexes),
  });
  return Object.freeze({
    coherent: Object.freeze({
      rows,
      admittedRows: Object.freeze(admittedRows),
      rowIds: Object.freeze(rowIds),
      totalRows: rows.length,
      loadedRows: rows.length,
      getRowId: (index: number) => rowIds[index],
      hasRowId: (rowId: BrunoTableRowId) => admittedById.has(rowId),
      identityResolver: getRowId,
      getRow: (rowId: BrunoTableRowId) => admittedById.get(rowId)?.raw as TRow | undefined,
      getCellValue: (rowId: BrunoTableRowId, columnId: string) => {
        const admitted = admittedById.get(rowId);
        const column = columnsById.get(columnId);
        return admitted === undefined || column === undefined
          ? undefined
          : admitted.values.read(admitted.raw, admitted.rowId, admitted.rowIndex, column);
      },
      changeFromPrevious,
      validatedColumns: columns,
    }),
  });
}

type ClientBoundedValue = Readonly<{
  readonly raw: unknown;
  readonly value: unknown;
  readonly token: object;
}>;

class ClientCanonicalValueCache implements BrunoTableClientValueCache {
  private readonly boundedValuesByRow = new Map<
    BrunoTableRowId,
    Map<CompiledColumn, ClientBoundedValue>
  >();
  private readonly boundedLru = new Map<
    object,
    Readonly<{ rowId: BrunoTableRowId; column: CompiledColumn }>
  >();

  public readonly read = (
    row: unknown,
    rowId: BrunoTableRowId,
    rowIndex: number,
    column: CompiledColumn,
  ): unknown => {
    const bounded = this.readBounded(row, rowId, rowIndex, column);
    if (bounded.found) {
      return bounded.value;
    }
    let value: unknown;
    try {
      value = readCompiledColumnValue(column, row);
    } catch {
      const invalid = createBrunoTableInvalidCellValue(
        invalidValue(rowIndex, column.columnId, "The source value could not be read."),
      );
      this.store(row, rowId, column, invalid);
      return invalid;
    }
    if (value === null || value === undefined) {
      this.store(row, rowId, column, value);
      return value;
    }
    const decoded = column.semantics.decodeRuntime(value);
    if (decoded._tag === "Failure") {
      const invalid = createBrunoTableInvalidCellValue(
        invalidValue(rowIndex, column.columnId, decoded.message),
      );
      this.store(row, rowId, column, invalid);
      return invalid;
    }
    this.store(row, rowId, column, decoded.value);
    return decoded.value;
  };

  public readonly retainRowIds = (hasRowId: (rowId: BrunoTableRowId) => boolean): void => {
    for (const [rowId, values] of this.boundedValuesByRow) {
      if (hasRowId(rowId)) continue;
      for (const entry of values.values()) this.boundedLru.delete(entry.token);
      this.boundedValuesByRow.delete(rowId);
    }
  };

  public readonly retainColumns = (
    ...columnGroups: readonly (readonly CompiledColumn[] | undefined)[]
  ): void => {
    const retained = new Set(columnGroups.flatMap((columns) => columns ?? EMPTY_COLUMNS));
    for (const [rowId, values] of this.boundedValuesByRow) {
      for (const [column, entry] of values) {
        if (retained.has(column)) continue;
        values.delete(column);
        this.boundedLru.delete(entry.token);
      }
      if (values.size === 0) this.boundedValuesByRow.delete(rowId);
    }
  };

  private readonly readBounded = (
    row: unknown,
    rowId: BrunoTableRowId,
    rowIndex: number,
    column: CompiledColumn,
  ): Readonly<{ found: true; value: unknown }> | Readonly<{ found: false }> => {
    const values = this.boundedValuesByRow.get(rowId);
    const cached = values?.get(column);
    if (cached === undefined) return NOT_FOUND;
    if (!Object.is(cached.raw, row)) {
      values?.delete(column);
      this.boundedLru.delete(cached.token);
      if (values?.size === 0) this.boundedValuesByRow.delete(rowId);
      return NOT_FOUND;
    }
    this.boundedLru.delete(cached.token);
    this.boundedLru.set(cached.token, { rowId, column });
    const value = currentInvalidRow(cached.value, rowIndex, column.columnId);
    if (value !== cached.value) values?.set(column, Object.freeze({ ...cached, value }));
    return Object.freeze({ found: true, value });
  };

  private readonly store = (
    row: unknown,
    rowId: BrunoTableRowId,
    column: CompiledColumn,
    value: unknown,
  ): void => {
    let values = this.boundedValuesByRow.get(rowId);
    if (values === undefined) {
      values = new Map();
      this.boundedValuesByRow.set(rowId, values);
    }
    const previous = values.get(column);
    if (previous !== undefined) this.boundedLru.delete(previous.token);
    const token = Object.freeze({});
    values.set(column, Object.freeze({ raw: row, value, token }));
    this.boundedLru.set(token, { rowId, column });
    if (this.boundedLru.size <= CLIENT_BOUNDED_VALUE_CACHE_LIMIT) return;
    const oldestToken = this.boundedLru.keys().next().value;
    if (oldestToken === undefined) return;
    const oldest = this.boundedLru.get(oldestToken);
    this.boundedLru.delete(oldestToken);
    if (oldest === undefined) return;
    const oldestValues = this.boundedValuesByRow.get(oldest.rowId);
    if (oldestValues?.get(oldest.column)?.token !== oldestToken) return;
    oldestValues.delete(oldest.column);
    if (oldestValues.size === 0) this.boundedValuesByRow.delete(oldest.rowId);
  };
}

function currentInvalidRow(value: unknown, rowIndex: number, columnId: string): unknown {
  if (!isBrunoTableInvalidCellValue(value) || value.invalid.rowIndex === rowIndex) return value;
  return createBrunoTableInvalidCellValue(invalidValue(rowIndex, columnId, value.invalid.message));
}

function validateAdmittedRows(
  rows: readonly BrunoTableClientAdmittedRow[],
  columns: readonly CompiledColumn[],
): NonNullable<CoherentResult<unknown>["invalid"]> | undefined {
  for (const row of rows) {
    for (const column of columns) {
      const value = row.values.read(row.raw, row.rowId, row.rowIndex, column);
      if (isBrunoTableInvalidCellValue(value)) return value.invalid;
    }
  }
  return undefined;
}

function invalidValue(
  rowIndex: number,
  columnId: string,
  message: string,
): NonNullable<CoherentResult<unknown>["invalid"]> {
  return Object.freeze({
    kind: "invalid-value",
    rowIndex,
    columnId,
    message: boundedText(message, 256),
  });
}

function asClientCoherent<TRow>(
  rowSpace: BrunoTableRowSpaceSnapshot<TRow> | undefined,
): ClientCoherentSnapshot<TRow> | undefined {
  return rowSpace as ClientCoherentSnapshot<TRow> | undefined;
}

function notifyRowsStoreListeners(listeners: Set<() => void>, initialError?: unknown): void {
  let firstError = initialError;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

function snapshotSource<TRow>(
  source: BrunoTableClientSource<TRow>,
  stableRows?: readonly TRow[],
): BrunoTableClientSource<TRow> {
  const statusCode = boundedOptionalText(source.statusCode, 128);
  const message = boundedOptionalText(source.message, 512);
  return Object.freeze({
    rows: stableRows ?? source.rows,
    totalRows: source.totalRows,
    version: source.version,
    status: source.status,
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(message === undefined ? {} : { message }),
    ...(source.retry === undefined
      ? {}
      : { retry: Object.freeze({ run: source.retry.run, pending: source.retry.pending }) }),
  });
}

function queryColumnIds(filters: readonly unknown[], orderBy: ClientOrderBy): ReadonlySet<string> {
  const columnIds = new Set(orderBy.map((sort) => sort.columnId));
  for (const filter of filters) collectClientFilterColumnIds(filter, columnIds);
  return columnIds;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

function canValidateSource<TRow>(source: BrunoTableClientSource<TRow>): boolean {
  return source.status !== "loading" && isCompleteSource(source);
}

function nextCoherent<TRow>(
  previous: ClientCoherentSnapshot<TRow> | undefined,
  publication: BrunoTableRowPipelinePublication<TRow>,
): ClientCoherentSnapshot<TRow> | undefined {
  const next = asClientCoherent(publication.rowSpace);
  return (
    next ??
    (publication.status === "loading" || publication.invalid !== undefined ? previous : undefined)
  );
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function boundedOptionalText(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? boundedText(value, limit) : undefined;
}

function isCompleteSource<TRow>(source: BrunoTableClientSource<TRow>): boolean {
  return (
    Number.isSafeInteger(source.totalRows) &&
    source.totalRows >= 0 &&
    source.rows.length === source.totalRows
  );
}
