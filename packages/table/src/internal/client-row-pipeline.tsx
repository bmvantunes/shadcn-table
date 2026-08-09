import { memo, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { CompiledColumn } from "./compile-columns";
import type {
  BrunoTableInvalidCellValue,
  BrunoTableRowPipelinePublication,
  BrunoTableRowPipelineRuntimeView,
} from "./grid-runtime";
import { isBrunoTableInvalidCellValue } from "./grid-runtime";
import type { BrunoTableRowPipelineProps } from "./bruno-table-view";
import type {
  BrunoTableClientAdmittedRow,
  BrunoTableClientRowOrderChangeDetector,
  BrunoTableClientRowsStore,
} from "./client-source-adapter";
import { useClientRowIds } from "./client-adapter";
import { collectClientFilterColumnIds } from "./client-row-model";

export type BrunoTableClientRowPipelineAdapterView = Readonly<{
  readonly resolveRowId: (row: unknown) => string;
  readonly createRowsStore: (
    runtime: BrunoTableRowPipelineRuntimeView,
    detector: BrunoTableClientRowOrderChangeDetector,
  ) => BrunoTableClientRowsStore;
  readonly acceptRows: (rows: readonly BrunoTableClientAdmittedRow[]) => void;
  readonly rejectQueryRows: (
    rows: readonly BrunoTableClientAdmittedRow[],
    invalid: BrunoTableInvalidCellValue["invalid"],
  ) => BrunoTableRowPipelinePublication<unknown> | undefined;
  readonly retryQueryRows: () => BrunoTableRowPipelinePublication<unknown> | undefined;
}>;

type ClientResolvedRowOrderProps = BrunoTableRowPipelineProps<
  BrunoTableRowPipelineRuntimeView,
  BrunoTableClientRowPipelineAdapterView
> & {
  readonly filters: readonly unknown[];
  readonly queryGeneration: number;
  readonly orderBy: readonly {
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }[];
};

export const BrunoTableClientRowPipeline: NamedExoticComponent<
  BrunoTableRowPipelineProps<
    BrunoTableRowPipelineRuntimeView,
    BrunoTableClientRowPipelineAdapterView
  >
> = memo(function BrunoTableClientRowPipeline(
  props: BrunoTableRowPipelineProps<
    BrunoTableRowPipelineRuntimeView,
    BrunoTableClientRowPipelineAdapterView
  >,
): ReactElement {
  const query = useSyncExternalStore(
    props.runtime.subscribeQuery,
    props.runtime.getQuerySnapshot,
    props.runtime.getQuerySnapshot,
  );
  return (
    <ClientResolvedRowOrder
      {...props}
      columns={query.columns}
      filters={query.filters}
      orderBy={query.orderBy}
      queryGeneration={query.generation}
    />
  );
});

const ClientResolvedRowOrder = memo(function ClientResolvedRowOrder({
  runtime,
  columns,
  rowPipelineAdapter,
  children,
  filters,
  orderBy,
  queryGeneration,
}: ClientResolvedRowOrderProps) {
  const rowOrderDetector = useMemo<BrunoTableClientRowOrderChangeDetector>(
    () => (previousRows, nextRows, change) =>
      rowOrderChanged(previousRows, nextRows, change, columns, filters, orderBy),
    [columns, filters, orderBy],
  );
  const rowsStore = useMemo(
    () => rowPipelineAdapter.createRowsStore(runtime, rowOrderDetector),
    [rowOrderDetector, rowPipelineAdapter, runtime],
  );
  const rows = useSyncExternalStore(
    rowsStore.subscribe,
    rowsStore.getSnapshot,
    rowsStore.getSnapshot,
  );
  const rowModel = useClientRowIds(rows, columns, orderBy, filters);
  const invalid = rowModel.kind === "invalid" ? rowModel.invalid : undefined;
  const nextRowIds =
    invalid === undefined && rowModel.kind === "ready" ? rowModel.rowIds : EMPTY_ROW_IDS;
  const [orderStore] = useState(() => new ClientRowOrderStore(nextRowIds, queryGeneration));
  useLayoutEffect(() => {
    const candidate = rowPipelineAdapter.retryQueryRows();
    if (candidate !== undefined) runtime.publishRowPipeline(candidate);
  }, [queryGeneration, rowPipelineAdapter, runtime]);
  useLayoutEffect(() => {
    if (invalid === undefined) {
      rowPipelineAdapter.acceptRows(rows);
      return;
    }
    const fallback = rowPipelineAdapter.rejectQueryRows(rows, invalid);
    if (fallback !== undefined) runtime.publishRowPipeline(fallback);
  }, [invalid, rowPipelineAdapter, rows, runtime]);
  useLayoutEffect(() => {
    orderStore.publish(nextRowIds, queryGeneration);
  }, [nextRowIds, orderStore, queryGeneration]);
  const orderSnapshot = useSyncExternalStore(
    orderStore.subscribe,
    orderStore.getSnapshot,
    orderStore.getSnapshot,
  );

  return children(
    invalid !== undefined
      ? Object.freeze({ kind: "invalid" as const, columns: rowModel.columns, invalid })
      : Object.freeze({
          kind: "rows" as const,
          ...orderSnapshot,
          columns: rowModel.columns,
        }),
  );
});

function rowOrderChanged(
  previousRows: readonly BrunoTableClientAdmittedRow[],
  nextRows: readonly BrunoTableClientAdmittedRow[],
  change: Readonly<{
    readonly rowIdsChanged: boolean;
    readonly changedIndexes: readonly number[];
  }>,
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  orderBy: readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[],
): boolean {
  if (change.rowIdsChanged) return true;
  const orderedIds = new Set(orderBy.map((sort) => sort.columnId));
  const filteredIds = new Set<string>();
  for (const filter of filters ?? EMPTY_FILTERS) {
    collectClientFilterColumnIds(filter, filteredIds);
  }
  const relevantColumns = columns.filter(
    (column) => orderedIds.has(column.columnId) || filteredIds.has(column.columnId),
  );
  if (relevantColumns.length === 0) return false;
  for (const index of change.changedIndexes) {
    const previousRow = previousRows[index];
    const nextRow = nextRows[index];
    if (previousRow === nextRow) continue;
    for (const column of relevantColumns) {
      const previousValue =
        previousRow?.values.read(
          previousRow.raw,
          previousRow.rowId,
          previousRow.rowIndex,
          column,
        ) ?? undefined;
      const nextValue =
        nextRow?.values.read(nextRow.raw, nextRow.rowId, nextRow.rowIndex, column) ?? undefined;
      if (
        isBrunoTableInvalidCellValue(previousValue) ||
        isBrunoTableInvalidCellValue(nextValue) ||
        (filteredIds.has(column.columnId)
          ? !Object.is(previousValue, nextValue)
          : !equivalentOrderedValue(column, previousValue, nextValue))
      ) {
        return true;
      }
    }
  }
  return false;
}

function equivalentOrderedValue(
  column: CompiledColumn,
  previousValue: unknown,
  nextValue: unknown,
): boolean {
  return previousValue == null || nextValue == null
    ? previousValue == null && nextValue == null
    : column.semantics.equivalent(previousValue, nextValue);
}

export class ClientRowOrderStore {
  private readonly listeners = new Set<() => void>();
  private rowIds: readonly string[];
  private snapshot: Readonly<{
    readonly rowSpace: Readonly<{
      readonly totalRows: number;
      readonly getRowId: (index: number) => string | undefined;
      readonly findRowIndex: (rowId: string) => number | undefined;
      readonly setRequiredRange: (start: number, end: number) => void;
    }>;
    readonly queryGeneration: number;
  }>;

  public constructor(initialRowIds: readonly string[], queryGeneration: number) {
    const rowIds = Object.freeze(Array.from(initialRowIds));
    this.rowIds = rowIds;
    this.snapshot = Object.freeze({
      rowSpace: createLogicalRowSpace(rowIds),
      queryGeneration,
    });
  }

  public readonly getSnapshot = (): typeof this.snapshot => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly publish = (nextRowIds: readonly string[], queryGeneration: number): void => {
    const rowIdsUnchanged = sameRowIds(this.rowIds, nextRowIds);
    if (this.snapshot.queryGeneration === queryGeneration && rowIdsUnchanged) return;
    const rowIds = rowIdsUnchanged ? this.rowIds : Object.freeze(Array.from(nextRowIds));
    this.rowIds = rowIds;
    this.snapshot = Object.freeze({
      rowSpace: rowIdsUnchanged ? this.snapshot.rowSpace : createLogicalRowSpace(rowIds),
      queryGeneration,
    });
    notifyClientRowOrderListeners(this.listeners);
  };
}

function createLogicalRowSpace(rowIds: readonly string[]) {
  const rowIndexById = new Map(rowIds.map((rowId, index) => [rowId, index]));
  return Object.freeze({
    totalRows: rowIds.length,
    getRowId: (index: number) => rowIds[index],
    findRowIndex: (rowId: string) => rowIndexById.get(rowId),
    setRequiredRange: (_start: number, _end: number) => undefined,
  });
}

function notifyClientRowOrderListeners(listeners: ReadonlySet<() => void>): void {
  let firstError: unknown;
  let failed = false;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      if (!failed) {
        firstError = error;
        failed = true;
      }
    }
  }
  if (failed) throw firstError;
}

function sameRowIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((rowId, index) => rowId === next[index]);
}

const EMPTY_FILTERS: readonly never[] = Object.freeze([]);
const EMPTY_ROW_IDS: readonly never[] = Object.freeze([]);
