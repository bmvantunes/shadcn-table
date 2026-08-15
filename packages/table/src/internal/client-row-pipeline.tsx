import { memo, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { NamedExoticComponent, ReactElement } from "react";
import type { CompiledColumn } from "./compile-columns";
import { compileClientFilterPlan, type ClientFilterPlan } from "./grid-query";
import type { BrunoTableColumnLayoutSnapshot } from "./column-management";
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
import { createClientQueryPredicate, readClientQuickFilterField } from "./quick-filter";
import { recordBrunoTableClientRowOrderPlanning } from "./render-instrumentation";

export type BrunoTableClientRowPipelineAdapterView = Readonly<{
  readonly resolveRowId: (row: unknown) => string;
  readonly createRowsStore: (
    runtime: BrunoTableRowPipelineRuntimeView,
    createDetector: () => BrunoTableClientRowOrderChangeDetector,
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
  readonly columnLayout: BrunoTableColumnLayoutSnapshot;
  readonly filters: readonly unknown[];
  readonly quickFilter: string;
  readonly quickFilterFields: readonly string[];
  readonly queryGeneration: number;
  readonly preserveActiveCellOnQueryChange: boolean;
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
  const columnLayout = useSyncExternalStore(
    props.runtime.subscribeColumnStructure,
    props.runtime.getColumnStructureSnapshot,
    props.runtime.getColumnStructureSnapshot,
  );
  return (
    <ClientResolvedRowOrder
      {...props}
      columnLayout={columnLayout}
      columns={query.columns}
      filters={query.filters}
      quickFilter={query.quickFilter}
      quickFilterFields={props.runtime.getQuickFilterFieldsSnapshot()}
      orderBy={query.orderBy}
      queryGeneration={query.generation}
      preserveActiveCellOnQueryChange={props.runtime.getPreserveActiveCellOnQueryChangeSnapshot()}
    />
  );
});

const ClientResolvedRowOrder = memo(function ClientResolvedRowOrder({
  runtime,
  tableId,
  columns,
  rowPipelineAdapter,
  children,
  filters,
  quickFilter,
  quickFilterFields,
  orderBy,
  queryGeneration,
  preserveActiveCellOnQueryChange,
  columnLayout,
}: ClientResolvedRowOrderProps) {
  const filterPlan = useMemo(() => compileClientFilterPlan(columns, filters), [columns, filters]);
  const createDetector = useMemo(
    () => () =>
      createRowOrderChangeDetector(
        tableId,
        columns,
        filters,
        quickFilter,
        quickFilterFields,
        orderBy,
        filterPlan,
      ),
    [columns, filterPlan, filters, orderBy, quickFilter, quickFilterFields, tableId],
  );
  const rowsStore = useMemo(
    () => rowPipelineAdapter.createRowsStore(runtime, createDetector),
    [createDetector, rowPipelineAdapter, runtime],
  );
  const rows = useSyncExternalStore(
    rowsStore.subscribe,
    rowsStore.getSnapshot,
    rowsStore.getSnapshot,
  );
  const rowModel = useClientRowIds(
    rows,
    columns,
    orderBy,
    filters,
    tableId,
    columnLayout,
    quickFilter,
    quickFilterFields,
    filterPlan,
  );
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
          preserveActiveCellOnQueryChange,
        }),
  );
});

function createRowOrderChangeDetector(
  tableId: string,
  columns: readonly CompiledColumn[],
  filters: readonly unknown[],
  quickFilter: string,
  quickFilterFields: readonly string[],
  orderBy: ClientResolvedRowOrderProps["orderBy"],
  filterPlan: ClientFilterPlan | undefined,
): BrunoTableClientRowOrderChangeDetector {
  if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) {
    recordBrunoTableClientRowOrderPlanning(tableId);
  }
  const orderedIds = new Set(orderBy.map((sort) => sort.columnId));
  const orderedColumns = columns.filter((column) => orderedIds.has(column.columnId));
  const filterPredicate = createClientQueryPredicate<BrunoTableClientAdmittedRow>(
    columns,
    filters,
    quickFilter,
    quickFilterFields,
    (column, row) => {
      const value = row.values.read(row.raw, row.rowId, row.rowIndex, column);
      if (isBrunoTableInvalidCellValue(value)) throw FILTER_VALUE_INVALID;
      return value;
    },
    (row, field) => readClientQuickFilterField(row.raw, field),
    filterPlan,
  );
  return (previousRows, nextRows, change) =>
    rowOrderChanged(previousRows, nextRows, change, orderedColumns, filterPredicate);
}

function rowOrderChanged(
  previousRows: readonly BrunoTableClientAdmittedRow[],
  nextRows: readonly BrunoTableClientAdmittedRow[],
  change: Readonly<{
    readonly rowIdsChanged: boolean;
    readonly changedIndexes: readonly number[];
  }>,
  orderedColumns: readonly CompiledColumn[],
  filterPredicate: ((row: BrunoTableClientAdmittedRow) => boolean) | undefined,
): boolean {
  if (change.rowIdsChanged) return true;
  if (orderedColumns.length === 0 && filterPredicate === undefined) return false;
  for (const index of change.changedIndexes) {
    const previousRow = previousRows[index];
    const nextRow = nextRows[index];
    if (previousRow === nextRow) continue;
    if (previousRow === undefined || nextRow === undefined) return true;
    if (filterPredicate !== undefined) {
      try {
        const previousIncluded = filterPredicate(previousRow);
        const nextIncluded = filterPredicate(nextRow);
        if (previousIncluded !== nextIncluded) return true;
        if (!nextIncluded) continue;
      } catch {
        return true;
      }
    }
    for (const column of orderedColumns) {
      const previousValue = previousRow.values.read(
        previousRow.raw,
        previousRow.rowId,
        previousRow.rowIndex,
        column,
      );
      const nextValue = nextRow.values.read(nextRow.raw, nextRow.rowId, nextRow.rowIndex, column);
      if (
        isBrunoTableInvalidCellValue(previousValue) ||
        isBrunoTableInvalidCellValue(nextValue) ||
        !equivalentOrderedValue(column, previousValue, nextValue)
      ) {
        return true;
      }
    }
  }
  return false;
}

const FILTER_VALUE_INVALID = Object.freeze({});

function equivalentOrderedValue(
  column: CompiledColumn,
  previousValue: unknown,
  nextValue: unknown,
): boolean {
  if (
    previousValue === null ||
    previousValue === undefined ||
    nextValue === null ||
    nextValue === undefined
  ) {
    return previousValue == null && nextValue == null;
  }
  return column.semantics.compare(previousValue, nextValue) === 0;
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

const EMPTY_ROW_IDS: readonly never[] = Object.freeze([]);
