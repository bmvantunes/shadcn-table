import type {
  BrunoTableClientSource,
  BrunoTableRowId,
  BrunoTableSourceStatus,
} from "../public-types";
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
  reconcileClientOrderBy,
  sanitizeClientInitialFilters,
  sanitizeClientInitialOrderBy,
} from "./grid-query";

export type BrunoTableClientReconciliationEvent = Readonly<{
  readonly residentRows: number;
  readonly changedRows: number;
  readonly resolvedRowIds: number;
  readonly identityPatches: number;
  readonly rebuiltIdentityIndex: boolean;
}>;

let reconciliationListener: ((event: BrunoTableClientReconciliationEvent) => void) | undefined;

export function installBrunoTableClientReconciliationListener(
  listener: (event: BrunoTableClientReconciliationEvent) => void,
): () => void {
  reconciliationListener = listener;
  return () => {
    if (reconciliationListener === listener) reconciliationListener = undefined;
  };
}

export class BrunoTableClientRowPipelineAdapter<TRow> {
  private readonly observedRows: TRow[];
  private source: ClientSourceSnapshot<TRow>;
  private getRowId: (row: TRow) => BrunoTableRowId;
  private publication: BrunoTableRowPipelinePublication<TRow>;
  private coherent: ClientCoherentSnapshot<TRow> | undefined;
  private acceptedCoherent: ClientCoherentSnapshot<TRow> | undefined;
  private readonly initialFilters: readonly unknown[];
  private readonly initialOrderBy: ClientOrderBy;
  private sourceColumns: readonly CompiledColumn[];
  private queryColumns: readonly CompiledColumn[];
  private queryConfiguration: BrunoTableQueryConfiguration;
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
    this.observedRows = Array.from(source.rows);
    this.source = snapshotSource(source);
    this.getRowId = getRowId;
    this.publication = createPublication(
      this.source,
      getRowId,
      columns,
      undefined,
      undefined,
      false,
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
    const sourceSnapshot = snapshotSource(source, this.source, this.observedRows);
    this.publication = createPublication(
      sourceSnapshot,
      getRowId,
      columns,
      this.coherent,
      this.acceptedCoherent,
      this.getRowId !== getRowId,
      this.valueCache,
    );
    this.coherent = nextCoherent(this.coherent, this.publication);
    this.acceptEmptyCoherent();
    if (
      this.coherent !== undefined &&
      this.coherent !== previousCoherent &&
      this.coherent.changeFromPrevious.rowIdsChanged
    ) {
      this.valueCache.retainRowIds(this.coherent.hasRowId);
    }
    commitObservedRows(source.rows, sourceSnapshot.rows.changedIndexes, this.observedRows);
    this.valueCache.retainColumns(columns, this.coherent?.validatedColumns);
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
      this.valueCache,
    );
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

  public readonly acceptRows = (rows: readonly BrunoTableClientAdmittedRow[]): void => {
    if (this.coherent?.admittedRows.asArray() === rows) this.acceptedCoherent = this.coherent;
  };

  private readonly acceptEmptyCoherent = (): void => {
    if (this.coherent?.admittedRows.length === 0) this.acceptedCoherent = this.coherent;
  };

  public readonly createRowsStore = (
    runtime: BrunoTableRuntimeView,
    detector: BrunoTableClientRowOrderChangeDetector,
  ): BrunoTableClientRowsStore => {
    let snapshot: readonly BrunoTableClientAdmittedRow[] =
      this.coherent?.admittedRows.asArray() ?? EMPTY_ROWS;
    const listeners = new Set<() => void>();
    let unsubscribeRuntime: (() => void) | undefined;
    const publish = () => {
      const previousRows = snapshot;
      const nextCoherent = this.coherent;
      const nextRows = nextCoherent?.admittedRows.asArray() ?? EMPTY_ROWS;
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
          snapshot = this.coherent?.admittedRows.asArray() ?? EMPTY_ROWS;
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
    readonly rows: ClientPersistentSequence<TRow>;
    readonly admittedRows: ClientPersistentSequence<BrunoTableClientAdmittedRow>;
    readonly rowIds: ClientPersistentSequence<BrunoTableRowId>;
    readonly admittedById: ClientPersistentIdentityIndex;
    readonly columnsById: ReadonlyMap<string, CompiledColumn>;
    readonly hasRowId: (rowId: BrunoTableRowId) => boolean;
    readonly identityResolver: (row: TRow) => BrunoTableRowId;
    readonly changeFromPrevious: BrunoTableClientRowOrderChange;
    readonly validatedColumns: readonly CompiledColumn[];
  }>;

type ClientSourceSnapshot<TRow> = Omit<BrunoTableClientSource<TRow>, "rows" | "status"> &
  Readonly<{
    readonly rows: ClientPersistentSequence<TRow>;
    readonly status: BrunoTableSourceStatus;
    readonly invalidStatus?: string;
  }>;

type ClientPersistentSequence<T> = Readonly<{
  readonly length: number;
  readonly token: object;
  readonly parentToken?: object;
  readonly chunks: readonly (readonly T[])[];
  readonly changedIndexes: readonly number[];
  readonly get: (index: number) => T | undefined;
  readonly asArray: () => readonly T[];
}>;

type ClientPersistentIdentityIndex = Readonly<{
  readonly buckets: ReadonlyMap<number, ReadonlyMap<BrunoTableRowId, BrunoTableClientAdmittedRow>>;
  readonly get: (rowId: BrunoTableRowId) => BrunoTableClientAdmittedRow | undefined;
  readonly has: (rowId: BrunoTableRowId) => boolean;
}>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);
const EMPTY_ROW_ORDER_CHANGE: BrunoTableClientRowOrderChange = Object.freeze({
  rowIdsChanged: false,
  changedIndexes: EMPTY_ROWS,
});
const EMPTY_COLUMNS: readonly CompiledColumn[] = Object.freeze([]);
const NOT_FOUND = Object.freeze({ found: false as const });
const CLIENT_BOUNDED_VALUE_CACHE_LIMIT = 16_384;
const CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE = 256;
const CLIENT_PERSISTENT_SEQUENCE_CHUNK_SHIFT = 8;
const CLIENT_PERSISTENT_SEQUENCE_CHUNK_MASK = CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE - 1;
const CLIENT_PERSISTENT_IDENTITY_BUCKETS = 4_096;

function snapshotObservedPersistentSequence<T>(
  input: readonly T[],
  previous: ClientPersistentSequence<T>,
  observed: T[],
): ClientPersistentSequence<T> {
  const changedIndexes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (index >= observed.length || observed[index] !== input[index]) {
      changedIndexes.push(index);
    }
  }
  if (previous.length === input.length && changedIndexes.length === 0) return previous;
  const patches = new Map(changedIndexes.map((index) => [index, input[index]!]));
  return patchPersistentSequence(
    previous,
    input.length,
    patches,
    changedIndexes,
    (index) => input[index]!,
  );
}

function commitObservedRows<T>(
  input: readonly T[],
  changedIndexes: readonly number[],
  observed: T[],
): void {
  for (const index of changedIndexes) observed[index] = input[index]!;
  observed.length = input.length;
}

function patchPersistentSequence<T>(
  previous: ClientPersistentSequence<T>,
  length: number,
  patches: ReadonlyMap<number, T>,
  changedIndexes: readonly number[],
  materialize: (index: number) => T,
): ClientPersistentSequence<T> {
  if (previous.length === length && patches.size === 0) return previous;
  const chunkCount = Math.ceil(length / CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE);
  const chunks = Array.from({ length: chunkCount }, (_unused, chunkIndex) =>
    previous.chunks[chunkIndex] === undefined
      ? Object.freeze([] as T[])
      : previous.chunks[chunkIndex]!,
  );
  const changedChunks = new Set<number>();
  for (const index of patches.keys()) {
    changedChunks.add(Math.floor(index / CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE));
  }
  if (
    length < previous.length &&
    length > 0 &&
    length % CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE !== 0
  ) {
    changedChunks.add(Math.floor((length - 1) / CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE));
  }
  for (const chunkIndex of changedChunks) {
    const start = chunkIndex * CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE;
    const chunkLength = Math.min(CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE, length - start);
    chunks[chunkIndex] = Object.freeze(
      Array.from({ length: chunkLength }, (_unused, offset) => {
        const index = start + offset;
        if (patches.has(index)) return patches.get(index)!;
        return index < previous.length ? previous.get(index)! : materialize(index);
      }),
    );
  }
  return persistentSequence(
    Object.freeze(chunks),
    length,
    Object.freeze(Array.from(changedIndexes)),
    previous.token,
  );
}

function basePersistentSequence<T>(
  input: readonly T[],
  changedIndexes: readonly number[] = EMPTY_ROWS,
): ClientPersistentSequence<T> {
  const chunks: (readonly T[])[] = [];
  for (let start = 0; start < input.length; start += CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE) {
    chunks.push(
      Object.freeze(Array.from(input.slice(start, start + CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE))),
    );
  }
  return persistentSequence(
    Object.freeze(chunks),
    input.length,
    Object.freeze(Array.from(changedIndexes)),
  );
}

function persistentSequence<T>(
  chunks: readonly (readonly T[])[],
  length: number,
  changedIndexes: readonly number[],
  parentToken?: object,
): ClientPersistentSequence<T> {
  const token = Object.freeze({});
  let arrayView: readonly T[] | undefined;
  const sequence: ClientPersistentSequence<T> = Object.freeze({
    length,
    token,
    ...(parentToken === undefined ? {} : { parentToken }),
    chunks,
    changedIndexes,
    get: (index: number) =>
      index < 0 || index >= length
        ? undefined
        : chunks[index >>> CLIENT_PERSISTENT_SEQUENCE_CHUNK_SHIFT]?.[
            index & CLIENT_PERSISTENT_SEQUENCE_CHUNK_MASK
          ],
    asArray: () => (arrayView ??= persistentSequenceArray(sequence)),
  });
  return sequence;
}

function persistentSequenceArray<T>(sequence: ClientPersistentSequence<T>): readonly T[] {
  const target: T[] = [];
  return new Proxy(target, {
    get: (_target, property, receiver) => {
      if (property === "length") return sequence.length;
      if (property === Symbol.iterator) {
        return function* iteratePersistentSequence() {
          for (let index = 0; index < sequence.length; index += 1) yield sequence.get(index)!;
        };
      }
      const index = arrayIndex(property);
      return index === undefined ? Reflect.get(target, property, receiver) : sequence.get(index);
    },
    has: (_target, property) => {
      const index = arrayIndex(property);
      return index === undefined ? Reflect.has(target, property) : index < sequence.length;
    },
    set: () => false,
    deleteProperty: () => false,
  });
}

function arrayIndex(property: string | symbol): number | undefined {
  if (typeof property !== "string" || !/^(0|[1-9]\d*)$/u.test(property)) return undefined;
  const index = Number(property);
  return Number.isSafeInteger(index) ? index : undefined;
}

function persistentSequenceChange<T>(
  previous: ClientPersistentSequence<T>,
  next: ClientPersistentSequence<T>,
): Readonly<{
  readonly changedIndexes: readonly number[];
  readonly removedIndexes: readonly number[];
}> {
  if (previous === next) {
    return Object.freeze({ changedIndexes: EMPTY_ROWS, removedIndexes: EMPTY_ROWS });
  }
  const removedIndexes =
    previous.length <= next.length
      ? EMPTY_ROWS
      : Object.freeze(
          Array.from(
            { length: previous.length - next.length },
            (_unused, offset) => next.length + offset,
          ),
        );
  if (next.parentToken === previous.token) {
    return Object.freeze({ changedIndexes: next.changedIndexes, removedIndexes });
  }
  const changedIndexes: number[] = [];
  for (let index = 0; index < next.length; index += 1) {
    if (previous.get(index) !== next.get(index)) changedIndexes.push(index);
  }
  return Object.freeze({
    changedIndexes: Object.freeze(changedIndexes),
    removedIndexes,
  });
}

function patchPersistentIdentityIndex(
  previous: ClientPersistentIdentityIndex,
  patches: ReadonlyMap<BrunoTableRowId, BrunoTableClientAdmittedRow>,
  removedRowIds: ReadonlySet<BrunoTableRowId>,
): ClientPersistentIdentityIndex {
  if (patches.size === 0 && removedRowIds.size === 0) return previous;
  const buckets = new Map(previous.buckets);
  const removalsByBucket = new Map<number, BrunoTableRowId[]>();
  const patchesByBucket = new Map<number, [BrunoTableRowId, BrunoTableClientAdmittedRow][]>();
  for (const rowId of removedRowIds) {
    const bucketIndex = clientIdentityBucket(rowId);
    const removals = removalsByBucket.get(bucketIndex) ?? [];
    removals.push(rowId);
    removalsByBucket.set(bucketIndex, removals);
  }
  for (const patch of patches) {
    const bucketIndex = clientIdentityBucket(patch[0]);
    const bucketPatches = patchesByBucket.get(bucketIndex) ?? [];
    bucketPatches.push(patch);
    patchesByBucket.set(bucketIndex, bucketPatches);
  }
  const changedBuckets = new Set([...removalsByBucket.keys(), ...patchesByBucket.keys()]);
  for (const bucketIndex of changedBuckets) {
    const bucket = new Map(previous.buckets.get(bucketIndex));
    for (const rowId of removalsByBucket.get(bucketIndex) ?? EMPTY_ROWS) bucket.delete(rowId);
    for (const [rowId, admitted] of patchesByBucket.get(bucketIndex) ?? EMPTY_ROWS) {
      bucket.set(rowId, admitted);
    }
    if (bucket.size === 0) buckets.delete(bucketIndex);
    else buckets.set(bucketIndex, bucket);
  }
  return persistentIdentityIndex(buckets);
}

function persistentIdentityIndex(
  buckets: ReadonlyMap<number, ReadonlyMap<BrunoTableRowId, BrunoTableClientAdmittedRow>>,
): ClientPersistentIdentityIndex {
  return Object.freeze({
    buckets,
    get: (rowId: BrunoTableRowId) => buckets.get(clientIdentityBucket(rowId))?.get(rowId),
    has: (rowId: BrunoTableRowId) => buckets.get(clientIdentityBucket(rowId))?.has(rowId) ?? false,
  });
}

function clientIdentityBucket(rowId: BrunoTableRowId): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < rowId.length; index += 1) {
    hash = Math.imul(hash ^ rowId.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0) % CLIENT_PERSISTENT_IDENTITY_BUCKETS;
}

function createPublication<TRow>(
  source: ClientSourceSnapshot<TRow>,
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  previousCoherent: ClientCoherentSnapshot<TRow> | undefined,
  fallbackCoherent: ClientCoherentSnapshot<TRow> | undefined,
  resolveRowIds: boolean,
  valueCache: ClientCanonicalValueCache,
): BrunoTableRowPipelinePublication<TRow> {
  const complete = isCompleteSource(source);
  const invalid =
    source.invalidStatus !== undefined
      ? Object.freeze({
          kind: "invalid-status" as const,
          receivedStatus: source.invalidStatus,
        })
      : (source.status === "ready" || source.status === "stale") && !complete
        ? Object.freeze({
            kind: "row-count-mismatch" as const,
            expectedRows: source.totalRows,
            receivedRows: source.rows.length,
          })
        : undefined;
  const coherentResult =
    source.invalidStatus === undefined && complete && source.status !== "loading"
      ? createCoherent(source.rows, getRowId, columns, previousCoherent, resolveRowIds, valueCache)
      : undefined;
  const terminal = source.status === "closed" || source.status === "error";
  const currentCoherent = coherentResult?.coherent;
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
  const coherent = useFallback ? fallbackResult?.coherent : currentCoherent;
  const hasCoherentRows = coherent !== undefined && (!terminal || coherent.rows.length > 0);
  const resolvedInvalid = invalid ?? coherentResult?.invalid ?? fallbackResult?.invalid;
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

function createInitialCoherent<TRow>(
  rows: ClientPersistentSequence<TRow>,
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  valueCache: ClientCanonicalValueCache,
): CoherentResult<TRow> {
  const rowIdValues = Array.from<BrunoTableRowId>({ length: rows.length });
  const admittedValues = Array.from<BrunoTableClientAdmittedRow>({ length: rows.length });
  const identityBuckets = new Map<number, Map<BrunoTableRowId, BrunoTableClientAdmittedRow>>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows.get(index)!;
    const rowId = getRowId(row);
    if (typeof rowId !== "string" || rowId.length === 0) {
      throw new TypeError("BrunoTable getRowId must return a non-empty string.");
    }
    const bucketIndex = clientIdentityBucket(rowId);
    const bucket = identityBuckets.get(bucketIndex) ?? new Map();
    if (bucket.has(rowId)) {
      throw new TypeError(`BrunoTable getRowId returned a duplicate row identity: ${rowId}`);
    }
    const admitted = Object.freeze({ raw: row, rowId, rowIndex: index, values: valueCache });
    rowIdValues[index] = rowId;
    admittedValues[index] = admitted;
    bucket.set(rowId, admitted);
    identityBuckets.set(bucketIndex, bucket);
  }
  reconciliationListener?.(
    Object.freeze({
      residentRows: rows.length,
      changedRows: rows.length,
      resolvedRowIds: rows.length,
      identityPatches: rows.length,
      rebuiltIdentityIndex: true,
    }),
  );
  return coherentResult(
    rows,
    basePersistentSequence(rowIdValues),
    basePersistentSequence(admittedValues),
    persistentIdentityIndex(identityBuckets),
    new Map(columns.map((column) => [column.columnId, column])),
    getRowId,
    Object.freeze({ rowIdsChanged: true, changedIndexes: EMPTY_ROWS }),
    columns,
  );
}

function createCoherent<TRow>(
  rows: ClientPersistentSequence<TRow>,
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  previous: ClientCoherentSnapshot<TRow> | undefined,
  resolveRowIds: boolean,
  valueCache: ClientCanonicalValueCache,
): CoherentResult<TRow> {
  if (previous === undefined) return createInitialCoherent(rows, getRowId, columns, valueCache);
  const resolveCurrentRowIds = resolveRowIds || previous.identityResolver !== getRowId;
  if (!resolveCurrentRowIds && previous.rows === rows && previous.validatedColumns === columns) {
    return Object.freeze({ coherent: previous });
  }
  const sourceChange = persistentSequenceChange(previous.rows, rows);
  const indexesToResolve = resolveCurrentRowIds
    ? Array.from({ length: rows.length }, (_unused, index) => index)
    : sourceChange.changedIndexes;
  const changedIndexSet = new Set([...sourceChange.changedIndexes, ...sourceChange.removedIndexes]);
  const rowIdPatches = new Map<number, BrunoTableRowId>();
  const admittedPatches = new Map<number, BrunoTableClientAdmittedRow>();
  const identityPatches = new Map<BrunoTableRowId, BrunoTableClientAdmittedRow>();
  const removedRowIds = new Set<BrunoTableRowId>();
  const resolvedRowIds = new Set<BrunoTableRowId>();
  let rowIdsChanged = previous.rows.length !== rows.length;
  for (const index of sourceChange.removedIndexes) {
    const removedRowId = previous.rowIds.get(index);
    if (removedRowId !== undefined) removedRowIds.add(removedRowId);
  }
  for (const index of indexesToResolve) {
    const row = rows.get(index)!;
    const previousRowId = previous.rowIds.get(index);
    const rowId = getRowId(row);
    if (typeof rowId !== "string" || rowId.length === 0) {
      throw new TypeError("BrunoTable getRowId must return a non-empty string.");
    }
    if (previousRowId !== undefined && previousRowId !== rowId) {
      removedRowIds.add(previousRowId);
      rowIdsChanged = true;
    }
    const existing = previous.admittedById.get(rowId);
    if (
      resolvedRowIds.has(rowId) ||
      (!resolveCurrentRowIds &&
        existing !== undefined &&
        existing.rowIndex !== index &&
        !changedIndexSet.has(existing.rowIndex))
    ) {
      throw new TypeError(`BrunoTable getRowId returned a duplicate row identity: ${rowId}`);
    }
    resolvedRowIds.add(rowId);
    const previousAdmitted = previous.admittedRows.get(index);
    const admitted =
      previousAdmitted?.raw === row && previousAdmitted !== undefined
        ? previousAdmitted.rowId === rowId
          ? previousAdmitted
          : Object.freeze({ ...previousAdmitted, rowId })
        : Object.freeze({ raw: row, rowId, rowIndex: index, values: valueCache });
    if (previousRowId !== rowId) rowIdPatches.set(index, rowId);
    if (previousAdmitted !== admitted) admittedPatches.set(index, admitted);
    if (previousRowId !== rowId || previousAdmitted !== admitted) {
      identityPatches.set(rowId, admitted);
    }
  }
  const rowIds = patchPersistentSequence(
    previous.rowIds,
    rows.length,
    rowIdPatches,
    sourceChange.changedIndexes,
    (index) => previous.rowIds.get(index) ?? getRowId(rows.get(index)!),
  );
  const patchedAdmittedRows = patchPersistentSequence(
    previous.admittedRows,
    rows.length,
    admittedPatches,
    sourceChange.changedIndexes,
    (index) => {
      const row = rows.get(index)!;
      const rowId = rowIds.get(index)!;
      return Object.freeze({ raw: row, rowId, rowIndex: index, values: valueCache });
    },
  );
  const admittedRows =
    previous.validatedColumns !== columns && patchedAdmittedRows === previous.admittedRows
      ? persistentSequence(
          previous.admittedRows.chunks,
          previous.admittedRows.length,
          sourceChange.changedIndexes,
          previous.admittedRows.token,
        )
      : patchedAdmittedRows;
  const admittedById = patchPersistentIdentityIndex(
    previous.admittedById,
    identityPatches,
    removedRowIds,
  );
  reconciliationListener?.(
    Object.freeze({
      residentRows: rows.length,
      changedRows: sourceChange.changedIndexes.length,
      resolvedRowIds: indexesToResolve.length,
      identityPatches: identityPatches.size,
      rebuiltIdentityIndex: false,
    }),
  );
  if (
    !rowIdsChanged &&
    sourceChange.changedIndexes.length === 0 &&
    previous.validatedColumns === columns
  ) {
    return Object.freeze({
      coherent:
        previous.identityResolver === getRowId
          ? previous
          : Object.freeze({
              ...previous,
              identityResolver: getRowId,
              changeFromPrevious: EMPTY_ROW_ORDER_CHANGE,
            }),
    });
  }
  const changeFromPrevious: BrunoTableClientRowOrderChange = Object.freeze({
    rowIdsChanged,
    changedIndexes: sourceChange.changedIndexes,
  });
  const columnsById =
    previous.validatedColumns === columns
      ? previous.columnsById
      : new Map(columns.map((column) => [column.columnId, column]));
  return coherentResult(
    rows,
    rowIds,
    admittedRows,
    admittedById,
    columnsById,
    getRowId,
    changeFromPrevious,
    columns,
  );
}

function coherentResult<TRow>(
  rows: ClientPersistentSequence<TRow>,
  rowIds: ClientPersistentSequence<BrunoTableRowId>,
  admittedRows: ClientPersistentSequence<BrunoTableClientAdmittedRow>,
  admittedById: ClientPersistentIdentityIndex,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  getRowId: (row: TRow) => BrunoTableRowId,
  changeFromPrevious: BrunoTableClientRowOrderChange,
  columns: readonly CompiledColumn[],
): CoherentResult<TRow> {
  return Object.freeze({
    coherent: Object.freeze({
      rows,
      admittedRows,
      rowIds,
      admittedById,
      columnsById,
      totalRows: rows.length,
      loadedRows: rows.length,
      getRowId: (index: number) => rowIds.get(index),
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
  previous?: ClientSourceSnapshot<TRow>,
  observedRows?: TRow[],
): ClientSourceSnapshot<TRow> {
  const sourceStatus: unknown = source.status;
  const status = snapshotSourceStatus(sourceStatus);
  const statusCode = boundedOptionalText(source.statusCode, 128);
  const message = boundedOptionalText(source.message, 512);
  const retry = snapshotRetry(source.retry);
  return Object.freeze({
    rows:
      previous === undefined || observedRows === undefined
        ? basePersistentSequence(source.rows)
        : snapshotObservedPersistentSequence(source.rows, previous.rows, observedRows),
    totalRows: source.totalRows,
    version: source.version,
    status: status ?? "error",
    ...(status === undefined ? { invalidStatus: describeInvalidStatus(sourceStatus) } : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(message === undefined ? {} : { message }),
    ...(retry === undefined ? {} : { retry }),
  });
}

function snapshotSourceStatus(value: unknown): BrunoTableSourceStatus | undefined {
  return value === "loading" ||
    value === "ready" ||
    value === "stale" ||
    value === "closed" ||
    value === "error"
    ? value
    : undefined;
}

function describeInvalidStatus(value: unknown): string {
  if (typeof value === "string") return boundedText(value, 128);
  if (value === null) return "null";
  return typeof value;
}

function snapshotRetry(value: unknown): BrunoTableClientSource<unknown>["retry"] {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const candidate = value as { readonly run?: unknown; readonly pending?: unknown };
    const run = candidate.run;
    const pending = candidate.pending;
    return typeof run === "function" && typeof pending === "boolean"
      ? Object.freeze({ run: run as (this: void) => void, pending })
      : undefined;
  } catch {
    return undefined;
  }
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

function isCompleteSource<TRow>(source: ClientSourceSnapshot<TRow>): boolean {
  return (
    Number.isSafeInteger(source.totalRows) &&
    source.totalRows >= 0 &&
    source.rows.length === source.totalRows
  );
}
