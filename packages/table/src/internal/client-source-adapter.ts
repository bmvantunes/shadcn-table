import type { BrunoTableClientSource, BrunoTableRowId } from "../public-types";
import type {
  BrunoTableQueryConfiguration,
  BrunoTableRowPipelinePublication,
  BrunoTableRowSpaceSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import type { CompiledColumn } from "./compile-columns";
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
    this.publication = createPublication(this.source, getRowId, undefined, false);
    this.coherent = asClientCoherent(this.publication.rowSpace);
    this.initialFilters = sanitizeClientInitialFilters(initialFilters, columns);
    this.initialOrderBy = sanitizeClientInitialOrderBy(initialOrderBy, columns);
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
  ): BrunoTableRowPipelinePublication<TRow> => {
    const sourceSnapshot = snapshotSource(
      source,
      source.rows === this.sourceRowsInput ? this.source.rows : undefined,
    );
    this.publication = createPublication(
      sourceSnapshot,
      getRowId,
      this.coherent,
      this.getRowId !== getRowId,
    );
    this.coherent = asClientCoherent(this.publication.rowSpace);
    this.sourceRowsInput = source.rows;
    this.source = sourceSnapshot;
    this.getRowId = getRowId;
    return this.publication;
  };

  public readonly publish = (
    source: BrunoTableClientSource<TRow>,
  ): BrunoTableRowPipelinePublication<TRow> => this.reconcile(source, this.getRowId);

  public readonly configure = (
    getRowId: (row: TRow) => BrunoTableRowId,
  ): BrunoTableRowPipelinePublication<TRow> => {
    this.publication = createPublication(
      this.source,
      getRowId,
      this.coherent,
      this.getRowId !== getRowId,
    );
    this.coherent = asClientCoherent(this.publication.rowSpace);
    this.getRowId = getRowId;
    return this.publication;
  };

  public readonly resolveRowId = (row: unknown): BrunoTableRowId => this.getRowId(row as TRow);

  public readonly createRowsStore = (
    runtime: BrunoTableRuntimeView,
    detector: BrunoTableClientRowOrderChangeDetector,
  ): BrunoTableClientRowsStore => {
    let snapshot: readonly TRow[] = this.coherent?.rows ?? EMPTY_ROWS;
    const listeners = new Set<() => void>();
    let unsubscribeRuntime: (() => void) | undefined;
    const publish = () => {
      const previousRows = snapshot;
      const nextCoherent = this.coherent;
      const nextRows = nextCoherent?.rows ?? EMPTY_ROWS;
      const change =
        nextCoherent?.changeFromPrevious ??
        Object.freeze({ rowIdsChanged: previousRows.length > 0, changedIndexes: EMPTY_ROWS });
      try {
        if (!detector(previousRows, nextRows, change)) return;
      } catch (error) {
        snapshot = publishableRows(previousRows, nextRows, change.rowIdsChanged);
        notifyRowsStoreListeners(listeners, error);
        return;
      }
      snapshot = publishableRows(previousRows, nextRows, change.rowIdsChanged);
      notifyRowsStoreListeners(listeners);
    };
    return Object.freeze({
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        if (unsubscribeRuntime === undefined) {
          snapshot = this.coherent?.rows ?? EMPTY_ROWS;
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
  previousRows: readonly unknown[],
  nextRows: readonly unknown[],
  change: BrunoTableClientRowOrderChange,
) => boolean;

export type BrunoTableClientRowOrderChange = Readonly<{
  readonly rowIdsChanged: boolean;
  readonly changedIndexes: readonly number[];
}>;

export type BrunoTableClientRowsStore = Readonly<{
  readonly getSnapshot: () => readonly unknown[];
  readonly subscribe: (listener: () => void) => () => void;
}>;

type ClientCoherentSnapshot<TRow> = BrunoTableRowSpaceSnapshot<TRow> &
  Readonly<{
    readonly rows: readonly TRow[];
    readonly rowIds: readonly BrunoTableRowId[];
    readonly changeFromPrevious: BrunoTableClientRowOrderChange;
  }>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);

function createPublication<TRow>(
  source: BrunoTableClientSource<TRow>,
  getRowId: (row: TRow) => BrunoTableRowId,
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
  const currentCoherent =
    complete && (source.status !== "loading" || source.rows.length > 0)
      ? createCoherent(source.rows, getRowId, previousCoherent, resolveRowIds)
      : undefined;
  const terminal = source.status === "closed" || source.status === "error";
  const retainPrevious = terminal || source.status === "stale";
  const coherent =
    terminal && previousCoherent !== undefined && currentCoherent?.rows.length === 0
      ? previousCoherent
      : (currentCoherent ?? (retainPrevious ? previousCoherent : undefined));
  const hasCoherentRows = coherent !== undefined && (!terminal || coherent.rows.length > 0);
  return Object.freeze({
    status: source.status,
    totalRows: source.totalRows,
    version: source.version,
    ...(source.statusCode === undefined ? {} : { statusCode: source.statusCode }),
    ...(source.message === undefined ? {} : { message: source.message }),
    ...(source.retry === undefined ? {} : { retry: source.retry }),
    ...(coherent === undefined ? {} : { rowSpace: coherent }),
    hasCoherentRows,
    ...(invalid === undefined ? {} : { invalid }),
  });
}

function createCoherent<TRow>(
  rows: readonly TRow[],
  getRowId: (row: TRow) => BrunoTableRowId,
  previous: ClientCoherentSnapshot<TRow> | undefined,
  resolveRowIds: boolean,
): ClientCoherentSnapshot<TRow> {
  if (previous !== undefined && !resolveRowIds && previous.rows === rows) return previous;
  if (
    previous !== undefined &&
    !resolveRowIds &&
    previous.rows.length === rows.length &&
    rows.every((row, index) => previous.rows[index] === row)
  ) {
    return previous;
  }
  const rowIds = Array.from({ length: rows.length }, () => "" as BrunoTableRowId);
  const rowsById = new Map<BrunoTableRowId, TRow>();
  const seenIds = new Set<BrunoTableRowId>();
  let rowIdsChanged = previous === undefined || previous.rows.length !== rows.length;
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
    rowIds[index] = rowId;
    rowsById.set(rowId, row);
    if (previousRow !== row) changedIndexes.push(index);
    if (previous?.rowIds[index] !== rowId) rowIdsChanged = true;
  }
  if (!rowIdsChanged && changedIndexes.length === 0 && previous !== undefined) return previous;
  const changeFromPrevious: BrunoTableClientRowOrderChange = Object.freeze({
    rowIdsChanged,
    changedIndexes: Object.freeze(changedIndexes),
  });
  return Object.freeze({
    rows,
    rowIds: Object.freeze(rowIds),
    totalRows: rows.length,
    loadedRows: rows.length,
    getRowId: (index: number) => rowIds[index],
    getRow: (rowId: BrunoTableRowId) => rowsById.get(rowId),
    changeFromPrevious,
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

function publishableRows<TRow>(
  previousRows: readonly TRow[],
  nextRows: readonly TRow[],
  rowIdsChanged: boolean,
): readonly TRow[] {
  return rowIdsChanged && previousRows === nextRows
    ? Object.freeze(Array.from(nextRows))
    : nextRows;
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
