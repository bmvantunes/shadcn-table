import {
  columnOrderingFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnDef, Row, RowData, Table } from "@tanstack/react-table";

import type { CompiledColumn } from "./compile-columns";
import {
  getBrunoTableLogicalColumnOrder,
  type BrunoTableColumnLayoutSnapshot,
} from "./column-management";
import type { BrunoTableClientAdmittedRow } from "./client-source-adapter";
import type { BrunoTableInvalidCellValue } from "./grid-runtime";
import { isBrunoTableInvalidCellValue } from "./grid-runtime";
import type { BrunoTableRuntimeRecord } from "./runtime-value";
import type { ClientOrderBy } from "./client-row-model";
import { createClientFilterPredicate } from "./client-row-model";

const clientFeatures = tableFeatures({
  columnOrderingFeature,
  columnVisibilityFeature,
  columnPinningFeature,
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

type AdapterRow<TRow> = BrunoTableClientAdmittedRow<TRow> & RowData;
type ClientRow<TRow> = Row<typeof clientFeatures, AdapterRow<TRow>>;
type ClientColumn<TRow> = ColumnDef<typeof clientFeatures, AdapterRow<TRow>, unknown>;
type ClientTable<TRow> = Table<typeof clientFeatures, AdapterRow<TRow>>;
const INTERNAL_FILTER_COLUMN_ID = "__BRUNO_TABLE_FILTERS__";
const queryValueReadListeners = new Set<
  (rowId: string, columnId: string, tableId: string) => void
>();

export function installBrunoTableClientQueryValueReadListener(
  listener: (rowId: string, columnId: string, tableId: string) => void,
): () => void {
  queryValueReadListeners.add(listener);
  return () => queryValueReadListeners.delete(listener);
}

export function useClientRowIds<TRow>(
  rows: readonly BrunoTableClientAdmittedRow<TRow>[],
  compiledColumns: readonly CompiledColumn[],
  orderBy: ClientOrderBy,
  filters?: readonly unknown[],
  tableId = "",
  columnLayout?: BrunoTableColumnLayoutSnapshot,
): BrunoTableClientRowModelResult {
  // Layout state supplies controlled TanStack inputs. The returned `logicalColumns` below is the
  // only Client logical order consumed by rendering and navigation.
  const requestedColumns = useMemo(() => {
    if (columnLayout === undefined) return compiledColumns;
    const currentById = new Map(
      compiledColumns.map((column) => [column.columnId, column] as const),
    );
    return Object.freeze(
      columnLayout.allColumns.flatMap((requested) => {
        const current = currentById.get(requested.columnId);
        return current === undefined ? [] : [mergeColumnLayout(current, requested)];
      }),
    );
  }, [columnLayout, compiledColumns]);
  const tieBreaker = orderBy.at(-1);
  const filterPredicate = useMemo(() => {
    return createClientFilterPredicate<ClientRow<TRow>>(compiledColumns, filters, (column, row) =>
      row.getValue(column.columnId),
    );
  }, [compiledColumns, filters]);
  const adapterColumns = useMemo(
    () => buildAdapterColumns<TRow>(compiledColumns, tieBreaker, filterPredicate, tableId),
    [compiledColumns, filterPredicate, tableId, tieBreaker],
  );
  const columnFilters = useMemo(
    () =>
      filterPredicate === undefined ? [] : [{ id: INTERNAL_FILTER_COLUMN_ID, value: filters }],
    [filterPredicate, filters],
  );
  const sorting = useMemo(
    () =>
      orderBy.map((sort) => ({
        id: sort.columnId,
        desc: sort.direction === "desc",
      })),
    [orderBy],
  );
  const columnOrder = useMemo(
    () => requestedColumns.map((column) => column.columnId),
    [requestedColumns],
  );
  const columnPinning = useMemo(() => {
    const logicalColumns = getBrunoTableLogicalColumnOrder(requestedColumns);
    if (columnLayout === undefined) {
      return {
        start: logicalColumns
          .filter((column) => column.pinned === "start")
          .map((column) => column.columnId),
        end: logicalColumns
          .filter((column) => column.pinned === "end")
          .map((column) => column.columnId),
      };
    }
    const requestedById = new Map<string, CompiledColumn>(
      requestedColumns.map((column) => [column.columnId, column] as const),
    );
    const visibleIds = new Set(columnLayout.visibleColumnIds);
    const pinningOrder = [
      ...columnLayout.visibleColumnIds.flatMap((columnId) => {
        const column = requestedById.get(columnId);
        return column === undefined ? [] : [column];
      }),
      ...logicalColumns.filter((column) => !visibleIds.has(column.columnId)),
    ];
    return {
      start: pinningOrder
        .filter((column) => column.pinned === "start")
        .map((column) => column.columnId),
      end: pinningOrder
        .filter((column) => column.pinned === "end")
        .map((column) => column.columnId),
    };
  }, [columnLayout, requestedColumns]);
  const columnVisibility = useMemo(() => {
    if (columnLayout === undefined) return {};
    const visible = new Set(columnLayout.visibleColumnIds);
    return Object.fromEntries(
      requestedColumns.map((column) => [column.columnId, visible.has(column.columnId)]),
    );
  }, [columnLayout, requestedColumns]);
  const table: ClientTable<TRow> = useTable(
    {
      features: clientFeatures,
      columns: adapterColumns,
      data: rows,
      getRowId: (row) => row.rowId,
      state: { columnFilters, columnOrder, columnPinning, columnVisibility, sorting },
    },
    () => null,
  );
  const logicalColumns =
    LOGICAL_COLUMNS_BY_REQUEST.get(requestedColumns) ??
    stabilizeLogicalColumns(
      requestedColumns,
      readLogicalColumns(table, requestedColumns, compiledColumns),
    );

  let rowModel: ReturnType<typeof table.getRowModel> | undefined;
  let invalid: BrunoTableInvalidCellValue["invalid"] | undefined;
  try {
    rowModel = table.getRowModel();
  } catch (error) {
    if (!(error instanceof ClientInvalidValueError)) throw error;
    invalid = error.invalid;
  }
  const rowIds = rowModel === undefined ? EMPTY_ROW_IDS : stableRowIds(rowModel);
  return invalid === undefined
    ? Object.freeze({ kind: "ready" as const, columns: logicalColumns, rowIds })
    : Object.freeze({ kind: "invalid" as const, columns: logicalColumns, invalid });
}

export type BrunoTableClientRowModelResult =
  | Readonly<{
      readonly kind: "ready";
      readonly columns: readonly CompiledColumn[];
      readonly rowIds: readonly string[];
    }>
  | Readonly<{
      readonly kind: "invalid";
      readonly columns: readonly CompiledColumn[];
      readonly invalid: BrunoTableInvalidCellValue["invalid"];
    }>;

function readLogicalColumns<TRow>(
  table: ClientTable<TRow>,
  requestedColumns: readonly CompiledColumn[],
  currentColumns: readonly CompiledColumn[],
): readonly CompiledColumn[] {
  const compiledById = new Map<string, CompiledColumn>(
    currentColumns.map((column) => [column.columnId, column]),
  );
  const requestedById = new Map<string, CompiledColumn>(
    requestedColumns.map((column) => [column.columnId, column] as const),
  );
  const ordered = [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ].flatMap((column) => {
    const current = compiledById.get(column.id);
    const requested = requestedById.get(column.id);
    return current === undefined || requested === undefined
      ? []
      : [mergeColumnLayout(current, requested)];
  });
  const visibleIds = new Set(table.getVisibleLeafColumns().map((column) => column.id));
  const visibleRequestedCount = requestedColumns.reduce(
    (count, column) => count + (visibleIds.has(column.columnId) ? 1 : 0),
    0,
  );
  if (ordered.length !== visibleRequestedCount) {
    throw new TypeError("BrunoTable could not resolve its private Logical Column Order.");
  }
  return Object.freeze(ordered);
}

function mergeColumnLayout(current: CompiledColumn, requested: CompiledColumn): CompiledColumn {
  let next = current;
  if (current.semantics.width !== requested.semantics.width) {
    next = Object.freeze({
      ...next,
      semantics: Object.freeze({ ...next.semantics, width: requested.semantics.width }),
    });
  }
  if (current.pinned !== requested.pinned) {
    const withPin = { ...next };
    if (requested.pinned === undefined) delete withPin.pinned;
    else withPin.pinned = requested.pinned;
    next = Object.freeze(withPin);
  }
  return next;
}

function buildAdapterColumns<TRow>(
  compiledColumns: readonly CompiledColumn[],
  tieBreaker: { readonly columnId: string; readonly direction: "asc" | "desc" } | undefined,
  filterPredicate: ((row: ClientRow<TRow>) => boolean) | undefined,
  tableId: string,
): ClientColumn<TRow>[] {
  const columns = compiledColumns.map(
    (column): ClientColumn<TRow> => ({
      id: column.columnId,
      header: column.headerName,
      accessorFn: (row: AdapterRow<TRow>) => readCanonicalValue(row, column, tableId),
      sortUndefined: false,
      sortFn: (rowA, rowB) => {
        const comparison = column.semantics.compare(
          rowA.getValue(column.columnId),
          rowB.getValue(column.columnId),
        );
        return comparison === 0 && column.columnId === tieBreaker?.columnId
          ? compareRowIds(rowA.id, rowB.id) * (tieBreaker.direction === "desc" ? -1 : 1)
          : comparison;
      },
    }),
  );
  return [
    {
      id: INTERNAL_FILTER_COLUMN_ID,
      accessorFn: (row: AdapterRow<TRow>) => row,
      enableSorting: false,
      filterFn: (row) => filterPredicate?.(row) ?? true,
    },
    ...columns,
  ];
}

class ClientInvalidValueError extends Error {
  public constructor(public readonly invalid: BrunoTableInvalidCellValue["invalid"]) {
    super("BrunoTable Client row model encountered an invalid canonical value.");
  }
}

function readCanonicalValue<TRow>(
  row: AdapterRow<TRow>,
  column: CompiledColumn,
  tableId: string,
): BrunoTableRuntimeRecord[PropertyKey] {
  for (const listener of queryValueReadListeners) listener(row.rowId, column.columnId, tableId);
  const value = row.values.read(row.raw, row.rowId, row.rowIndex, column);
  if (isBrunoTableInvalidCellValue(value)) throw new ClientInvalidValueError(value.invalid);
  return value;
}

function compareRowIds(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const EMPTY_ROW_IDS: readonly never[] = Object.freeze([]);
const ROW_IDS_BY_MODEL = new WeakMap<object, readonly string[]>();
const LOGICAL_COLUMNS_BY_REQUEST = new WeakMap<
  readonly CompiledColumn[],
  readonly CompiledColumn[]
>();

function stableRowIds(rowModel: { readonly rows: readonly { readonly id: string }[] }) {
  const cached = ROW_IDS_BY_MODEL.get(rowModel);
  if (cached !== undefined) return cached;
  const rowIds = Object.freeze(rowModel.rows.map((row) => row.id));
  ROW_IDS_BY_MODEL.set(rowModel, rowIds);
  return rowIds;
}

function stabilizeLogicalColumns(
  requestedColumns: readonly CompiledColumn[],
  nextColumns: readonly CompiledColumn[],
): readonly CompiledColumn[] {
  const previousColumns = LOGICAL_COLUMNS_BY_REQUEST.get(requestedColumns);
  if (
    previousColumns !== undefined &&
    previousColumns.length === nextColumns.length &&
    previousColumns.every((column, index) => column === nextColumns[index])
  ) {
    return previousColumns;
  }
  LOGICAL_COLUMNS_BY_REQUEST.set(requestedColumns, nextColumns);
  return nextColumns;
}
