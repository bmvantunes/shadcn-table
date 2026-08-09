import type { BrunoTableClientSource, BrunoTableRowId } from "../public-types";
import type {
  BrunoTableQueryConfiguration,
  BrunoTableRowPipelinePublication,
  BrunoTableRowSpaceSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";
import type { ClientOrderBy } from "./grid-query";
import {
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
  private readonly initialFilters: readonly unknown[];
  private readonly initialOrderBy: ClientOrderBy;
  private sourceColumns: readonly CompiledColumn[];
  private queryColumns: readonly CompiledColumn[];
  private queryConfiguration: BrunoTableQueryConfiguration;

  public constructor(
    source: BrunoTableClientSource<TRow>,
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
    initialFilters: readonly unknown[] | undefined,
    initialOrderBy: ClientOrderBy | undefined,
  ) {
    this.sourceRowsInput = source.rows;
    this.source = snapshotSource(source);
    this.getRowId = getRowId;
    this.publication = createPublication(this.source, getRowId, columns, undefined, false);
    this.coherent = nextCoherent(this.coherent, this.publication);
    this.initialFilters = sanitizeClientInitialFilters(initialFilters, columns);
    this.initialOrderBy = sanitizeClientInitialOrderBy(initialOrderBy, columns);
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
    this.queryColumns = columns;
    this.queryConfiguration = Object.freeze({ baselineFilters, baselineOrderBy });
    return this.queryConfiguration;
  };

  public readonly reconcile = (
    source: BrunoTableClientSource<TRow>,
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
  ): BrunoTableRowPipelinePublication<TRow> => {
    const sourceSnapshot = snapshotSource(
      source,
      source.rows === this.sourceRowsInput ? this.source.rows : undefined,
    );
    this.publication = createPublication(
      sourceSnapshot,
      getRowId,
      columns,
      this.coherent,
      this.getRowId !== getRowId,
    );
    this.coherent = nextCoherent(this.coherent, this.publication);
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
    this.publication = createPublication(
      this.source,
      getRowId,
      columns,
      this.coherent,
      this.getRowId !== getRowId,
    );
    this.coherent = nextCoherent(this.coherent, this.publication);
    this.getRowId = getRowId;
    this.sourceColumns = columns;
    return this.publication;
  };

  public readonly resolveRowId = (row: unknown): BrunoTableRowId => this.getRowId(row as TRow);

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
        if (!detector(previousRows, nextRows, change)) return;
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
  readonly values: ReadonlyMap<string, unknown>;
}>;

type ClientCoherentSnapshot<TRow> = BrunoTableRowSpaceSnapshot<TRow> &
  Readonly<{
    readonly rows: readonly TRow[];
    readonly admittedRows: readonly BrunoTableClientAdmittedRow[];
    readonly rowIds: readonly BrunoTableRowId[];
    readonly changeFromPrevious: BrunoTableClientRowOrderChange;
    readonly validatedColumns: readonly CompiledColumn[];
  }>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);

function createPublication<TRow>(
  source: BrunoTableClientSource<TRow>,
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  previousCoherent: ClientCoherentSnapshot<TRow> | undefined,
  resolveRowIds: boolean,
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
    complete && (source.status !== "loading" || source.rows.length > 0)
      ? createCoherent(source.rows, getRowId, columns, previousCoherent, resolveRowIds)
      : undefined;
  const invalidValue = coherentResult?.invalid;
  const currentCoherent = coherentResult?.coherent;
  const terminal = source.status === "closed" || source.status === "error";
  const retainPrevious = terminal || source.status === "stale";
  const coherent =
    terminal && previousCoherent !== undefined && currentCoherent?.rows.length === 0
      ? previousCoherent
      : (currentCoherent ?? (retainPrevious ? previousCoherent : undefined));
  const hasCoherentRows = coherent !== undefined && (!terminal || coherent.rows.length > 0);
  const resolvedInvalid = invalid ?? invalidValue;
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
): CoherentResult<TRow> {
  if (
    previous !== undefined &&
    !resolveRowIds &&
    previous.rows === rows &&
    previous.validatedColumns === columns
  ) {
    return Object.freeze({ coherent: previous });
  }
  if (
    previous !== undefined &&
    !resolveRowIds &&
    previous.validatedColumns === columns &&
    previous.rows.length === rows.length &&
    rows.every((row, index) => previous.rows[index] === row)
  ) {
    return Object.freeze({ coherent: previous });
  }
  const rowIds = Array.from({ length: rows.length }, () => "" as BrunoTableRowId);
  const admittedRows = Array.from<BrunoTableClientAdmittedRow>({ length: rows.length });
  const rowsById = new Map<BrunoTableRowId, TRow>();
  const valuesByRowId = new Map<BrunoTableRowId, ReadonlyMap<string, unknown>>();
  const seenIds = new Set<BrunoTableRowId>();
  let rowIdsChanged = previous === undefined || previous.rows.length !== rows.length;
  const validateEveryRow = previous?.validatedColumns !== columns;
  const changedIndexes: number[] = [];
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
    const previousAdmitted = previous?.admittedRows[index];
    let admitted: BrunoTableClientAdmittedRow;
    if (!validateEveryRow && previousRow === row && previousAdmitted !== undefined) {
      admitted =
        previousAdmitted.rowId === rowId
          ? previousAdmitted
          : Object.freeze({ raw: row, rowId, values: previousAdmitted.values });
    } else {
      const decoded = decodeSourceValues(row, index, columns);
      if ("invalid" in decoded) return Object.freeze({ invalid: decoded.invalid });
      admitted = Object.freeze({ raw: row, rowId, values: decoded.values });
    }
    rowIds[index] = rowId;
    admittedRows[index] = admitted;
    rowsById.set(rowId, row);
    valuesByRowId.set(rowId, admitted.values);
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
      getRow: (rowId: BrunoTableRowId) => rowsById.get(rowId),
      getCellValue: (rowId: BrunoTableRowId, columnId: string) =>
        valuesByRowId.get(rowId)?.get(columnId),
      changeFromPrevious,
      validatedColumns: columns,
    }),
  });
}

type DecodedSourceValues =
  | Readonly<{ readonly values: ReadonlyMap<string, unknown> }>
  | Readonly<{ readonly invalid: NonNullable<CoherentResult<unknown>["invalid"]> }>;

function decodeSourceValues(
  row: unknown,
  rowIndex: number,
  columns: readonly CompiledColumn[],
): DecodedSourceValues {
  const values = new Map<string, unknown>();
  for (const column of columns) {
    let value: unknown;
    try {
      value = readCompiledColumnValue(column, row);
    } catch {
      return Object.freeze({
        invalid: invalidValue(rowIndex, column.columnId, "The source value could not be read."),
      });
    }
    if (value === null || value === undefined) {
      values.set(column.columnId, value);
      continue;
    }
    const decoded = column.semantics.decodeRuntime(value);
    if (decoded._tag === "Failure") {
      return Object.freeze({
        invalid: invalidValue(rowIndex, column.columnId, decoded.message),
      });
    }
    values.set(column.columnId, decoded.value);
  }
  return Object.freeze({ values });
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
  return Object.freeze({
    rows: stableRows ?? Object.freeze(Array.from(source.rows)),
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

function nextCoherent<TRow>(
  previous: ClientCoherentSnapshot<TRow> | undefined,
  publication: BrunoTableRowPipelinePublication<TRow>,
): ClientCoherentSnapshot<TRow> | undefined {
  const next = asClientCoherent(publication.rowSpace);
  return next ?? (publication.invalid === undefined ? undefined : previous);
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
