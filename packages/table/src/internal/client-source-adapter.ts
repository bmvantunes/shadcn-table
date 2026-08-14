import type {
  BrunoTableClientSource,
  BrunoTableRowId,
  BrunoTableSourceRetry,
  BrunoTableSourceStatus,
} from "../public-types";
import type {
  BrunoTableInvalidCellValue,
  BrunoTableQueryConfiguration,
  BrunoTableRowPipelinePublication,
  BrunoTableRowSpaceSnapshot,
  BrunoTableRuntimeView,
} from "./grid-runtime";
import { createBrunoTableInvalidCellValue, isBrunoTableInvalidCellValue } from "./grid-runtime";
import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";
import { isBrunoTableRuntimeRecord, type BrunoTableRuntimeRecord } from "./runtime-value";
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
  readonly rebuiltSourceSequence: boolean;
  readonly rebuiltIdentityIndex: boolean;
}>;

let reconciliationListener: ((event: BrunoTableClientReconciliationEvent) => void) | undefined;
let valueCachePruneListener: ((visitedEntries: number) => void) | undefined;

export function installBrunoTableClientReconciliationListener(
  listener: (event: BrunoTableClientReconciliationEvent) => void,
): () => void {
  reconciliationListener = listener;
  return () => {
    if (reconciliationListener === listener) reconciliationListener = undefined;
  };
}

export function installBrunoTableClientValueCachePruneListener(
  listener: (visitedEntries: number) => void,
): () => void {
  valueCachePruneListener = listener;
  return () => {
    if (valueCachePruneListener === listener) valueCachePruneListener = undefined;
  };
}

export class BrunoTableClientRowPipelineAdapter<TRow extends BrunoTableRuntimeRecord[PropertyKey]> {
  private observedRows: TRow[] | undefined;
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
  private queryFallbackActive = false;
  private lifecycleFallbackCoherent: ClientCoherentSnapshot<TRow> | undefined;
  private queryRejected:
    | Readonly<{
        readonly coherent: ClientCoherentSnapshot<TRow>;
        readonly publication: BrunoTableRowPipelinePublication<TRow>;
      }>
    | undefined;
  private readonly valueCache = new ClientCanonicalValueCache<TRow>();

  public constructor(
    source: BrunoTableClientSource<TRow>,
    getRowId: (row: TRow) => BrunoTableRowId,
    columns: readonly CompiledColumn[],
    initialFilters: readonly unknown[] | undefined,
    initialOrderBy: ClientOrderBy | undefined,
  ) {
    this.initialFilters = sanitizeClientInitialFilters(initialFilters, columns, {
      rejectOverBudget: true,
    });
    this.initialOrderBy = sanitizeClientInitialOrderBy(initialOrderBy, columns);
    this.source = snapshotSource(source);
    this.observedRows =
      this.source.inputRows === undefined ? undefined : Array.from(this.source.rows.asArray());
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
    this.valueCache.retainColumns(columns, this.coherent?.validatedColumns);
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
    const sourceSnapshot = snapshotSource(source, this.source, this.observedRows);
    const queryRejected = this.queryRejected;
    const retainedSourceInvalid = retainedSourceInvalidSnapshot(sourceSnapshot);
    const sameRetainedCandidate =
      this.queryFallbackActive &&
      queryRejected !== undefined &&
      retainsPreviousRows(this.source) &&
      retainsPreviousRows(sourceSnapshot) &&
      ((this.source.invalidStatus === sourceSnapshot.invalidStatus &&
        this.source.invalidRows === sourceSnapshot.invalidRows) ||
        retainedSourceInvalid !== undefined) &&
      this.source.rows === sourceSnapshot.rows &&
      this.source.totalRows === sourceSnapshot.totalRows &&
      this.getRowId === getRowId &&
      this.sourceColumns === columns;
    if (sameRetainedCandidate && queryRejected !== undefined) {
      this.publication = refreshPublicationSource(
        this.publication,
        sourceSnapshot,
        retainedSourceInvalid,
      );
      this.queryRejected = Object.freeze({
        coherent: queryRejected.coherent,
        publication: refreshPublicationSource(
          queryRejected.publication,
          sourceSnapshot,
          retainedSourceInvalid,
        ),
      });
      if (sourceSnapshot.inputRows !== undefined) {
        this.observedRows = commitObservedRows(
          sourceSnapshot.rows,
          sourceSnapshot.rows.changedIndexes,
          this.observedRows,
        );
      }
      this.source = sourceSnapshot;
      return this.publication;
    }
    this.queryFallbackActive = false;
    this.queryRejected = undefined;
    const previousCoherent = this.coherent;
    if (!retainsPreviousRows(sourceSnapshot)) {
      this.lifecycleFallbackCoherent = undefined;
    } else if (
      sourceSnapshot.invalidRows !== undefined ||
      sourceSnapshot.invalidLifecycle !== undefined ||
      sourceSnapshot.invalidStatus !== undefined ||
      !retainsPreviousRows(this.source) ||
      this.source.rows !== sourceSnapshot.rows ||
      this.source.totalRows !== sourceSnapshot.totalRows
    ) {
      this.lifecycleFallbackCoherent = this.acceptedCoherent;
    }
    this.lifecycleFallbackCoherent = reconfigureFallback(
      this.lifecycleFallbackCoherent,
      getRowId,
      columns,
      this.valueCache,
    );
    this.publication = createPublication(
      sourceSnapshot,
      getRowId,
      columns,
      this.coherent,
      this.lifecycleFallbackCoherent,
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
    if (sourceSnapshot.inputRows !== undefined) {
      this.observedRows = commitObservedRows(
        sourceSnapshot.rows,
        sourceSnapshot.rows.changedIndexes,
        this.observedRows,
      );
    }
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
    this.queryFallbackActive = false;
    this.queryRejected = undefined;
    const previousCoherent = this.coherent;
    this.lifecycleFallbackCoherent = reconfigureFallback(
      this.lifecycleFallbackCoherent,
      getRowId,
      columns,
      this.valueCache,
    );
    this.publication = createPublication(
      this.source,
      getRowId,
      columns,
      this.coherent,
      this.lifecycleFallbackCoherent,
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

  public readonly resolveRowId = (row: TRow): BrunoTableRowId => this.getRowId(row);

  public readonly acceptRows = (rows: readonly BrunoTableClientAdmittedRow<TRow>[]): void => {
    if (this.coherent?.admittedRows.asArray() === rows) this.acceptedCoherent = this.coherent;
  };

  public readonly rejectQueryRows = (
    rows: readonly BrunoTableClientAdmittedRow<TRow>[],
    invalid: BrunoTableInvalidCellValue["invalid"],
  ): BrunoTableRowPipelinePublication<TRow> | undefined => {
    const rejectedCoherent = this.coherent;
    if (rejectedCoherent?.admittedRows.asArray() !== rows || !retainsPreviousRows(this.source)) {
      return undefined;
    }
    if (this.queryFallbackActive) {
      this.publication = rejectPublicationRows(
        this.publication,
        retainedSourceInvalidSnapshot(this.source) ?? invalid,
      );
      this.coherent = undefined;
      this.valueCache.retainColumns(this.sourceColumns);
      return this.publication;
    }
    const fallbackCoherent =
      this.lifecycleFallbackCoherent === rejectedCoherent
        ? undefined
        : this.lifecycleFallbackCoherent === undefined
          ? undefined
          : refreshRowOrderEvidence(this.lifecycleFallbackCoherent);
    this.queryFallbackActive = true;
    this.queryRejected = Object.freeze({
      coherent: rejectedCoherent,
      publication: this.publication,
    });
    this.publication = createPublication(
      this.source,
      this.getRowId,
      this.sourceColumns,
      rejectedCoherent,
      fallbackCoherent,
      false,
      this.valueCache,
      invalid,
    );
    this.coherent = asClientCoherent(this.publication.rowSpace);
    this.valueCache.retainColumns(this.sourceColumns, this.coherent?.validatedColumns);
    return this.publication;
  };

  public readonly retryQueryRows = (): BrunoTableRowPipelinePublication<TRow> | undefined => {
    const rejected = this.queryRejected;
    if (!this.queryFallbackActive || rejected === undefined) return undefined;
    this.queryFallbackActive = false;
    this.queryRejected = undefined;
    this.coherent = refreshRowOrderEvidence(rejected.coherent);
    this.publication = Object.freeze({
      ...rejected.publication,
      rowSpace: this.coherent,
    });
    return this.publication;
  };

  private readonly acceptEmptyCoherent = (): void => {
    if (this.coherent?.admittedRows.length === 0) this.acceptedCoherent = this.coherent;
  };

  public readonly createRowsStore = (
    runtime: BrunoTableRuntimeView<TRow>,
    createDetector: () => BrunoTableClientRowOrderChangeDetector<TRow>,
  ): BrunoTableClientRowsStore<TRow> => {
    let snapshot: readonly BrunoTableClientAdmittedRow<TRow>[] =
      this.coherent?.admittedRows.asArray() ?? EMPTY_ROWS;
    let detector: BrunoTableClientRowOrderChangeDetector<TRow> | undefined;
    const listeners = new Set<() => void>();
    let unsubscribeRuntime: (() => void) | undefined;
    const publish = () => {
      const previousRows = snapshot;
      const nextCoherent = this.coherent;
      const nextRows = nextCoherent?.admittedRows.asArray() ?? EMPTY_ROWS;
      const change =
        nextCoherent?.changeFromPrevious ??
        Object.freeze({ rowIdsChanged: previousRows.length > 0, changedIndexes: EMPTY_ROWS });
      const activeDetector = detector;
      if (activeDetector === undefined) return;
      try {
        if (!activeDetector(previousRows, nextRows, change)) {
          if (nextCoherent !== undefined) this.acceptedCoherent = nextCoherent;
          return;
        }
      } catch (error) {
        snapshot = nextRows;
        notifyRowsStoreListeners(
          listeners,
          error instanceof Error ? error : new Error("Rows store listener failed."),
        );
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
          detector ??= createDetector();
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

export type BrunoTableClientRowOrderChangeDetector<TRow = BrunoTableRuntimeRecord[PropertyKey]> = (
  previousRows: readonly BrunoTableClientAdmittedRow<TRow>[],
  nextRows: readonly BrunoTableClientAdmittedRow<TRow>[],
  change: BrunoTableClientRowOrderChange,
) => boolean;

export type BrunoTableClientRowOrderChange = Readonly<{
  readonly rowIdsChanged: boolean;
  readonly changedIndexes: readonly number[];
}>;

export type BrunoTableClientRowsStore<TRow = BrunoTableRuntimeRecord[PropertyKey]> = Readonly<{
  readonly getSnapshot: () => readonly BrunoTableClientAdmittedRow<TRow>[];
  readonly subscribe: (listener: () => void) => () => void;
}>;

export type BrunoTableClientAdmittedRow<TRow = BrunoTableRuntimeRecord[PropertyKey]> = Readonly<{
  readonly raw: TRow;
  readonly rowId: BrunoTableRowId;
  readonly rowIndex: number;
  readonly values: BrunoTableClientValueCache<TRow>;
}>;

export type BrunoTableClientValueCache<TRow = BrunoTableRuntimeRecord[PropertyKey]> = Readonly<{
  readonly read: (
    row: TRow,
    rowId: BrunoTableRowId,
    rowIndex: number,
    column: CompiledColumn,
  ) => BrunoTableRuntimeRecord[PropertyKey];
}>;

type ClientCoherentSnapshot<TRow> = BrunoTableRowSpaceSnapshot<TRow> &
  Readonly<{
    readonly rows: ClientPersistentSequence<TRow>;
    readonly admittedRows: ClientPersistentSequence<BrunoTableClientAdmittedRow<TRow>>;
    readonly rowIds: ClientPersistentSequence<BrunoTableRowId>;
    readonly admittedById: ClientPersistentIdentityIndex<TRow>;
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
    readonly invalidLifecycle?: "status" | "totalRows" | "version";
    readonly invalidRows?: string;
    readonly inputRows?: readonly TRow[];
  }>;

type ClientPersistentSequence<T> = Readonly<{
  readonly length: number;
  readonly token: ClientSequenceToken;
  readonly parentToken?: ClientSequenceToken;
  readonly chunks: readonly (readonly T[])[];
  readonly changedIndexes: readonly number[];
  readonly get: (index: number) => T | undefined;
  readonly asArray: () => readonly T[];
}>;

interface MutableClientPersistentSequence<T> {
  length: number;
  token: ClientSequenceToken;
  parentToken?: ClientSequenceToken;
  chunks: readonly (readonly T[])[];
  changedIndexes: readonly number[];
  get: (index: number) => T | undefined;
  asArray: () => readonly T[];
}

interface MutableClientSourceSnapshot<TRow> {
  rows: ClientPersistentSequence<TRow>;
  totalRows: number;
  version: number;
  status: BrunoTableSourceStatus;
  statusCode?: string;
  message?: string;
  retry?: BrunoTableSourceRetry;
  invalidStatus?: string;
  invalidLifecycle?: "status" | "totalRows" | "version";
  invalidRows?: string;
  inputRows?: readonly TRow[];
}

interface MutableRowPipelinePublication<TRow> {
  status: BrunoTableSourceStatus;
  totalRows: number;
  version: number;
  statusCode?: string;
  message?: string;
  retry?: BrunoTableSourceRetry;
  rowSpace?: BrunoTableRowSpaceSnapshot<TRow>;
  hasCoherentRows: boolean;
  invalid?: Exclude<BrunoTableRowPipelinePublication<TRow>["invalid"], undefined>;
}

interface ClientSequenceToken {}

type ClientPersistentSequenceSnapshot<T> =
  | Readonly<{ readonly rows: ClientPersistentSequence<T> }>
  | Readonly<{ readonly invalidRows: string }>;

type ClientPersistentIdentityIndex<TRow> = Readonly<{
  readonly buckets: ReadonlyMap<
    number,
    ReadonlyMap<BrunoTableRowId, BrunoTableClientAdmittedRow<TRow>>
  >;
  readonly get: (rowId: BrunoTableRowId) => BrunoTableClientAdmittedRow<TRow> | undefined;
  readonly has: (rowId: BrunoTableRowId) => boolean;
}>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);
const EMPTY_PERSISTENT_SEQUENCE: ClientPersistentSequence<never> =
  basePersistentSequence(EMPTY_ROWS);
const CLIENT_MAX_PROTOTYPE_DEPTH = 64;
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
): ClientPersistentSequenceSnapshot<T> {
  const changedIndexes: number[] = [];
  const patches = new Map<number, T>();
  let length = 0;
  try {
    length = input.length;
    const indexedPrototype = hasIndexedPrototypeProperty(input);
    for (let index = 0; index < length; index += 1) {
      if (!(indexedPrototype ? Object.hasOwn(input, index) : index in input)) {
        return Object.freeze({ invalidRows: "sparse array" });
      }
      const next = input[index]!;
      if (index >= observed.length || observed[index] !== next) {
        changedIndexes.push(index);
        patches.set(index, next);
      }
    }
  } catch {
    return Object.freeze({ invalidRows: "unreadable" });
  }
  if (previous.length === length && changedIndexes.length === 0) {
    return Object.freeze({ rows: previous });
  }
  return Object.freeze({
    rows: patchPersistentSequence(previous, length, patches, changedIndexes, (index) =>
      patches.get(index)!,
    ),
  });
}

function commitObservedRows<T>(
  input: ClientPersistentSequence<T>,
  changedIndexes: readonly number[],
  observed: T[] | undefined,
): T[] {
  if (observed === undefined) return Array.from(input.asArray());
  for (const index of changedIndexes) observed[index] = input.get(index)!;
  observed.length = input.length;
  return observed;
}

function snapshotBasePersistentSequence<T>(
  input: readonly T[],
): ClientPersistentSequenceSnapshot<T> {
  const chunks: (readonly T[])[] = [];
  let length = 0;
  try {
    length = input.length;
    const indexedPrototype = hasIndexedPrototypeProperty(input);
    for (let start = 0; start < length; start += CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE) {
      const end = Math.min(length, start + CLIENT_PERSISTENT_SEQUENCE_CHUNK_SIZE);
      const chunk: T[] = [];
      for (let index = start; index < end; index += 1) {
        if (!(indexedPrototype ? Object.hasOwn(input, index) : index in input)) {
          return Object.freeze({ invalidRows: "sparse array" });
        }
        chunk.push(input[index]!);
      }
      chunks.push(Object.freeze(chunk));
    }
  } catch {
    return Object.freeze({ invalidRows: "unreadable" });
  }
  return Object.freeze({
    rows: persistentSequence(Object.freeze(chunks), length, EMPTY_ROWS),
  });
}

function hasIndexedPrototypeProperty(input: readonly unknown[]): boolean {
  const visited = new WeakSet<object>();
  let depth = 0;
  // SAFETY: input is an Array-like object and Object.getPrototypeOf returns its object prototype or null.
  let prototype: object | null = Object.getPrototypeOf(input) as object | null;
  while (prototype !== null) {
    if (visited.has(prototype) || depth >= CLIENT_MAX_PROTOTYPE_DEPTH) {
      throw new TypeError("Client Source rows have an invalid prototype chain.");
    }
    visited.add(prototype);
    depth += 1;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === key) {
        return true;
      }
    }
    // SAFETY: prototype is known to be an object; its next prototype is an object or null by the ECMAScript contract.
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return false;
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
  const emptyChunk: readonly T[] = Object.freeze([]);
  const chunks = Array.from({ length: chunkCount }, (_unused, chunkIndex) =>
    previous.chunks[chunkIndex] === undefined ? emptyChunk : previous.chunks[chunkIndex]!,
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
  parentToken?: ClientSequenceToken,
): ClientPersistentSequence<T> {
  const token = Object.freeze({});
  let arrayView: readonly T[] | undefined;
  const sequence: MutableClientPersistentSequence<T> = {
    length,
    token,
    chunks,
    changedIndexes,
    get: (index: number) =>
      index < 0 || index >= length
        ? undefined
        : chunks[index >>> CLIENT_PERSISTENT_SEQUENCE_CHUNK_SHIFT]?.[
            index & CLIENT_PERSISTENT_SEQUENCE_CHUNK_MASK
          ],
    asArray: () => (arrayView ??= persistentSequenceArray(sequence)),
  };
  if (parentToken !== undefined) sequence.parentToken = parentToken;
  return Object.freeze(sequence);
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
      return index === undefined ? Reflect.get(_target, property, receiver) : sequence.get(index);
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

function patchPersistentIdentityIndex<TRow>(
  previous: ClientPersistentIdentityIndex<TRow>,
  patches: ReadonlyMap<BrunoTableRowId, BrunoTableClientAdmittedRow<TRow>>,
  removedRowIds: ReadonlySet<BrunoTableRowId>,
): ClientPersistentIdentityIndex<TRow> {
  if (patches.size === 0 && removedRowIds.size === 0) return previous;
  const buckets = new Map(previous.buckets);
  const removalsByBucket = new Map<number, BrunoTableRowId[]>();
  const patchesByBucket = new Map<number, [BrunoTableRowId, BrunoTableClientAdmittedRow<TRow>][]>();
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

function persistentIdentityIndex<TRow>(
  buckets: ReadonlyMap<number, ReadonlyMap<BrunoTableRowId, BrunoTableClientAdmittedRow<TRow>>>,
): ClientPersistentIdentityIndex<TRow> {
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
  valueCache: ClientCanonicalValueCache<TRow>,
  queryRejection?: BrunoTableInvalidCellValue["invalid"],
): BrunoTableRowPipelinePublication<TRow> {
  const complete = isCompleteSource(source);
  const invalid =
    source.invalidRows !== undefined
      ? Object.freeze({
          kind: "invalid-rows" as const,
          receivedRows: source.invalidRows,
        })
      : source.invalidLifecycle !== undefined
        ? Object.freeze({
            kind: "invalid-lifecycle" as const,
            field: source.invalidLifecycle,
          })
        : source.invalidStatus !== undefined
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
    source.invalidRows === undefined &&
    source.invalidLifecycle === undefined &&
    source.invalidStatus === undefined &&
    complete &&
    source.status !== "loading"
      ? createCoherent(source.rows, getRowId, columns, previousCoherent, resolveRowIds, valueCache)
      : undefined;
  const terminal = source.status === "closed" || source.status === "error";
  const currentCoherent = coherentResult?.coherent;
  const retainPrevious = retainsPreviousRows(source);
  const rejectCurrent = queryRejection !== undefined && retainPrevious;
  const useFallback =
    fallbackCoherent !== undefined &&
    retainPrevious &&
    (queryRejection !== undefined ||
      currentCoherent === undefined ||
      (terminal && currentCoherent.rows.length === 0));
  const fallbackResult: CoherentResult<TRow> | undefined = useFallback
    ? queryRejection === undefined
      ? createCoherent(
          fallbackCoherent.rows,
          getRowId,
          columns,
          previousCoherent,
          resolveRowIds,
          valueCache,
        )
      : Object.freeze({ coherent: fallbackCoherent })
    : undefined;
  const coherent = rejectCurrent
    ? fallbackResult?.coherent
    : useFallback
      ? fallbackResult?.coherent
      : currentCoherent;
  const hasCoherentRows = coherent !== undefined && (!terminal || coherent.rows.length > 0);
  const resolvedInvalid =
    invalid ?? queryRejection ?? coherentResult?.invalid ?? fallbackResult?.invalid;
  const publication: MutableRowPipelinePublication<TRow> = {
    status: source.status,
    totalRows: source.totalRows,
    version: source.version,
    hasCoherentRows,
  };
  if (source.statusCode !== undefined) publication.statusCode = source.statusCode;
  if (source.message !== undefined) publication.message = source.message;
  if (source.retry !== undefined) publication.retry = source.retry;
  if (coherent !== undefined) publication.rowSpace = coherent;
  if (resolvedInvalid !== undefined) publication.invalid = resolvedInvalid;
  return Object.freeze(publication);
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
  valueCache: ClientCanonicalValueCache<TRow>,
): CoherentResult<TRow> {
  const rowIdValues = Array.from<BrunoTableRowId>({ length: rows.length });
  const admittedValues = Array.from<BrunoTableClientAdmittedRow<TRow>>({ length: rows.length });
  const identityBuckets = new Map<
    number,
    Map<BrunoTableRowId, BrunoTableClientAdmittedRow<TRow>>
  >();
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
      rebuiltSourceSequence: rows.parentToken === undefined,
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
  valueCache: ClientCanonicalValueCache<TRow>,
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
  const admittedPatches = new Map<number, BrunoTableClientAdmittedRow<TRow>>();
  const identityPatches = new Map<BrunoTableRowId, BrunoTableClientAdmittedRow<TRow>>();
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
      rebuiltSourceSequence: previous.rows !== rows && rows.parentToken === undefined,
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
  admittedRows: ClientPersistentSequence<BrunoTableClientAdmittedRow<TRow>>,
  admittedById: ClientPersistentIdentityIndex<TRow>,
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
      getRow: (rowId: BrunoTableRowId) => admittedById.get(rowId)?.raw,
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
  readonly value: BrunoTableRuntimeRecord[PropertyKey];
  readonly token: object;
}>;

class ClientCanonicalValueCache<TRow> implements BrunoTableClientValueCache<TRow> {
  private readonly boundedValuesByRow = new Map<
    BrunoTableRowId,
    Map<CompiledColumn, ClientBoundedValue>
  >();
  private readonly boundedLru = new Map<
    object,
    Readonly<{ rowId: BrunoTableRowId; column: CompiledColumn }>
  >();
  private retainedColumnGroups: readonly (readonly CompiledColumn[] | undefined)[] = Object.freeze(
    [],
  );

  public readonly read = (
    row: TRow,
    rowId: BrunoTableRowId,
    rowIndex: number,
    column: CompiledColumn,
  ): BrunoTableRuntimeRecord[PropertyKey] => {
    const bounded = this.readBounded(row, rowId, rowIndex, column);
    if (bounded.found) {
      return bounded.value;
    }
    let value: BrunoTableRuntimeRecord[PropertyKey];
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
    if (
      this.retainedColumnGroups.length === columnGroups.length &&
      this.retainedColumnGroups.every((columns, index) => columns === columnGroups[index])
    ) {
      return;
    }
    this.retainedColumnGroups = Object.freeze(Array.from(columnGroups));
    const retained = new Set(columnGroups.flatMap((columns) => columns ?? EMPTY_COLUMNS));
    let visitedEntries = 0;
    for (const [rowId, values] of this.boundedValuesByRow) {
      for (const [column, entry] of values) {
        visitedEntries += 1;
        if (retained.has(column)) continue;
        values.delete(column);
        this.boundedLru.delete(entry.token);
      }
      if (values.size === 0) this.boundedValuesByRow.delete(rowId);
    }
    valueCachePruneListener?.(visitedEntries);
  };

  private readonly readBounded = (
    row: TRow,
    rowId: BrunoTableRowId,
    rowIndex: number,
    column: CompiledColumn,
  ):
    | Readonly<{ found: true; value: BrunoTableRuntimeRecord[PropertyKey] }>
    | Readonly<{
        found: false;
      }> => {
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
    row: TRow,
    rowId: BrunoTableRowId,
    column: CompiledColumn,
    value: BrunoTableRuntimeRecord[PropertyKey],
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

function currentInvalidRow(
  value: BrunoTableRuntimeRecord[PropertyKey],
  rowIndex: number,
  columnId: string,
): BrunoTableRuntimeRecord[PropertyKey] {
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
  // SAFETY: BrunoTableGridRuntime supplies this snapshot only from the client adapter's coherent row-space publication.
  return rowSpace as ClientCoherentSnapshot<TRow> | undefined;
}

function notifyRowsStoreListeners(
  listeners: Set<() => void>,
  initialError?: BrunoTableRuntimeRecord[PropertyKey],
): void {
  let firstError = initialError;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error("Rows store listener failed.");
    }
  }
  if (firstError !== undefined) throw firstError;
}

function snapshotSource<TRow>(
  source: BrunoTableClientSource<TRow>,
  previous?: ClientSourceSnapshot<TRow>,
  observedRows?: TRow[],
): ClientSourceSnapshot<TRow> {
  const required = snapshotRequiredSourceEnvelope(source);
  if ("invalidLifecycle" in required) {
    return Object.freeze({
      // SAFETY: The empty persistent sequence has no row values and is valid for every row type parameter.
      rows: previous?.rows ?? EMPTY_PERSISTENT_SEQUENCE,
      totalRows: previous?.totalRows ?? 0,
      version: previous?.version ?? 0,
      status: "error",
      invalidLifecycle: required.invalidLifecycle,
    });
  }
  const { sourceStatus, totalRows, version } = required;
  const status = snapshotSourceStatus(sourceStatus);
  const statusCode = boundedOptionalText(
    readOptionalSourceField(() => source.statusCode),
    128,
  );
  const message = boundedOptionalText(
    readOptionalSourceField(() => source.message),
    512,
  );
  const retry = snapshotRetry(readOptionalSourceField(() => source.retry));
  const rowInput =
    status === undefined || status === "loading" ? undefined : snapshotSourceRows(source);
  const inputRows = rowInput?.inputRows;
  const sequenceSnapshot =
    inputRows === undefined
      ? undefined
      : previous === undefined || observedRows === undefined
        ? snapshotBasePersistentSequence(inputRows)
        : snapshotObservedPersistentSequence(inputRows, previous.rows, observedRows);
  const sequenceRows =
    sequenceSnapshot !== undefined && "rows" in sequenceSnapshot
      ? sequenceSnapshot.rows
      : undefined;
  const invalidRows =
    rowInput?.invalidRows ??
    (sequenceSnapshot !== undefined && "invalidRows" in sequenceSnapshot
      ? sequenceSnapshot.invalidRows
      : undefined);
  const rows = sequenceRows ?? previous?.rows ?? EMPTY_PERSISTENT_SEQUENCE;
  const snapshot: MutableClientSourceSnapshot<TRow> = {
    rows,
    totalRows,
    version,
    status: invalidRows === undefined ? (status ?? "error") : "error",
  };
  if (status === undefined) snapshot.invalidStatus = describeInvalidStatus(sourceStatus);
  if (invalidRows !== undefined) snapshot.invalidRows = invalidRows;
  if (inputRows !== undefined && invalidRows === undefined) snapshot.inputRows = inputRows;
  if (statusCode !== undefined) snapshot.statusCode = statusCode;
  if (message !== undefined) snapshot.message = message;
  if (retry !== undefined) snapshot.retry = retry;
  return Object.freeze(snapshot);
}

type ClientRequiredSourceEnvelope = Readonly<{
  readonly sourceStatus: BrunoTableRuntimeRecord[PropertyKey];
  readonly totalRows: number;
  readonly version: number;
}>;

function snapshotRequiredSourceEnvelope<TRow>(
  source: BrunoTableClientSource<TRow>,
):
  | ClientRequiredSourceEnvelope
  | Readonly<{ readonly invalidLifecycle: "status" | "totalRows" | "version" }> {
  let sourceStatus: BrunoTableRuntimeRecord[PropertyKey];
  try {
    sourceStatus = source.status;
  } catch {
    return Object.freeze({ invalidLifecycle: "status" });
  }
  let totalRows: unknown;
  try {
    totalRows = source.totalRows;
  } catch {
    return Object.freeze({ invalidLifecycle: "totalRows" });
  }
  if (typeof totalRows !== "number" || !Number.isSafeInteger(totalRows) || totalRows < 0) {
    return Object.freeze({ invalidLifecycle: "totalRows" });
  }
  let version: unknown;
  try {
    version = source.version;
  } catch {
    return Object.freeze({ invalidLifecycle: "version" });
  }
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return Object.freeze({ invalidLifecycle: "version" });
  }
  return Object.freeze({ sourceStatus, totalRows, version });
}

function readOptionalSourceField(
  read: () => BrunoTableRuntimeRecord[PropertyKey],
): BrunoTableRuntimeRecord[PropertyKey] | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function snapshotSourceRows<TRow>(
  source: BrunoTableClientSource<TRow>,
): Readonly<{ readonly inputRows?: readonly TRow[]; readonly invalidRows?: string }> {
  try {
    const rows = source.rows;
    if (!Array.isArray(rows)) {
      return Object.freeze({ invalidRows: describeInvalidRows(rows) });
    }
    return Object.freeze({ inputRows: rows });
  } catch {
    return Object.freeze({ invalidRows: "unreadable" });
  }
}

function snapshotSourceStatus(
  value: BrunoTableRuntimeRecord[PropertyKey],
): BrunoTableSourceStatus | undefined {
  return value === "loading" ||
    value === "ready" ||
    value === "stale" ||
    value === "closed" ||
    value === "error"
    ? value
    : undefined;
}

function describeInvalidStatus(value: BrunoTableRuntimeRecord[PropertyKey]): string {
  if (typeof value === "string") return boundedText(value, 128);
  return describeUnknownValueKind(value);
}

function describeInvalidRows(value: BrunoTableRuntimeRecord[PropertyKey]): string {
  return describeUnknownValueKind(value);
}

function describeUnknownValueKind(value: BrunoTableRuntimeRecord[PropertyKey]): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  return "object";
}

function snapshotRetry(
  value: BrunoTableRuntimeRecord[PropertyKey],
): BrunoTableSourceRetry | undefined {
  if (!isBrunoTableRuntimeRecord(value)) return undefined;
  try {
    const run = value["run"];
    const pending = value["pending"];
    return isBrunoTableRetryRun(run) && typeof pending === "boolean"
      ? Object.freeze({ run, pending })
      : undefined;
  } catch {
    return undefined;
  }
}

function isBrunoTableRetryRun(value: BrunoTableRuntimeRecord[PropertyKey]): value is () => void {
  return typeof value === "function";
}

function retainsPreviousRows(source: Pick<ClientSourceSnapshot<unknown>, "status">): boolean {
  return source.status === "stale" || source.status === "closed" || source.status === "error";
}

function refreshRowOrderEvidence<TRow>(
  coherent: ClientCoherentSnapshot<TRow>,
): ClientCoherentSnapshot<TRow> {
  return Object.freeze({
    ...coherent,
    changeFromPrevious: Object.freeze({
      rowIdsChanged: true,
      changedIndexes: EMPTY_ROWS,
    }),
  });
}

function refreshPublicationSource<TRow>(
  publication: BrunoTableRowPipelinePublication<TRow>,
  source: ClientSourceSnapshot<TRow>,
  invalid: BrunoTableRowPipelinePublication<TRow>["invalid"] = publication.invalid,
): BrunoTableRowPipelinePublication<TRow> {
  const terminal = source.status === "closed" || source.status === "error";
  const refreshed: MutableRowPipelinePublication<TRow> = {
    status: source.status,
    totalRows: source.totalRows,
    version: source.version,
    hasCoherentRows:
      publication.rowSpace !== undefined && (!terminal || publication.rowSpace.loadedRows > 0),
  };
  if (source.statusCode !== undefined) refreshed.statusCode = source.statusCode;
  if (source.message !== undefined) refreshed.message = source.message;
  if (source.retry !== undefined) refreshed.retry = source.retry;
  if (publication.rowSpace !== undefined) refreshed.rowSpace = publication.rowSpace;
  if (invalid !== undefined) refreshed.invalid = invalid;
  return Object.freeze(refreshed);
}

function retainedSourceInvalidSnapshot<TRow>(
  source: ClientSourceSnapshot<TRow>,
): BrunoTableRowPipelinePublication<TRow>["invalid"] {
  return source.invalidRows !== undefined
    ? Object.freeze({ kind: "invalid-rows" as const, receivedRows: source.invalidRows })
    : source.invalidLifecycle !== undefined
      ? Object.freeze({ kind: "invalid-lifecycle" as const, field: source.invalidLifecycle })
      : source.invalidStatus !== undefined
        ? Object.freeze({ kind: "invalid-status" as const, receivedStatus: source.invalidStatus })
        : undefined;
}

function rejectPublicationRows<TRow>(
  publication: BrunoTableRowPipelinePublication<TRow>,
  invalid: NonNullable<BrunoTableRowPipelinePublication<TRow>["invalid"]>,
): BrunoTableRowPipelinePublication<TRow> {
  const rejected: MutableRowPipelinePublication<TRow> = {
    status: publication.status,
    totalRows: publication.totalRows,
    version: publication.version,
    hasCoherentRows: false,
    invalid,
  };
  if (publication.statusCode !== undefined) rejected.statusCode = publication.statusCode;
  if (publication.message !== undefined) rejected.message = publication.message;
  if (publication.retry !== undefined) rejected.retry = publication.retry;
  return Object.freeze(rejected);
}

function reconfigureFallback<TRow>(
  fallback: ClientCoherentSnapshot<TRow> | undefined,
  getRowId: (row: TRow) => BrunoTableRowId,
  columns: readonly CompiledColumn[],
  valueCache: ClientCanonicalValueCache<TRow>,
): ClientCoherentSnapshot<TRow> | undefined {
  return fallback === undefined
    ? undefined
    : createCoherent(
        fallback.rows,
        getRowId,
        columns,
        fallback,
        fallback.identityResolver !== getRowId,
        valueCache,
      ).coherent;
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

function boundedOptionalText(
  value: BrunoTableRuntimeRecord[PropertyKey],
  limit: number,
): string | undefined {
  return typeof value === "string" ? boundedText(value, limit) : undefined;
}

function isCompleteSource<TRow>(source: ClientSourceSnapshot<TRow>): boolean {
  return (
    Number.isSafeInteger(source.totalRows) &&
    source.totalRows >= 0 &&
    source.rows.length === source.totalRows
  );
}
