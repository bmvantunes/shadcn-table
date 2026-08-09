import {
  columnOrderingFeature,
  columnPinningFeature,
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
import type { BrunoTableClientAdmittedRow } from "./client-source-adapter";
import type { BrunoTableInvalidCellValue } from "./grid-runtime";
import { isBrunoTableInvalidCellValue } from "./grid-runtime";
import type { ClientOrderBy } from "./client-row-model";
import { createClientFilterPredicate } from "./client-row-model";

const clientFeatures = tableFeatures({
  columnOrderingFeature,
  columnPinningFeature,
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

type AdapterRow = BrunoTableClientAdmittedRow & RowData;
type ClientRow = Row<typeof clientFeatures, AdapterRow>;
type ClientColumn = ColumnDef<typeof clientFeatures, AdapterRow, unknown>;
type ClientTable = Table<typeof clientFeatures, AdapterRow>;
const INTERNAL_FILTER_COLUMN_ID = "__BRUNO_TABLE_FILTERS__";
let queryValueReadListener: ((rowId: string, columnId: string) => void) | undefined;

export function installBrunoTableClientQueryValueReadListener(
  listener: (rowId: string, columnId: string) => void,
): () => void {
  queryValueReadListener = listener;
  return () => {
    if (queryValueReadListener === listener) queryValueReadListener = undefined;
  };
}

export function useClientRowIds(
  rows: readonly BrunoTableClientAdmittedRow[],
  compiledColumns: readonly CompiledColumn[],
  orderBy: ClientOrderBy,
  filters?: readonly unknown[],
): BrunoTableClientRowModelResult {
  const tieBreaker = orderBy.at(-1);
  const filterPredicate = useMemo(() => {
    return createClientFilterPredicate<ClientRow>(compiledColumns, filters, (column, row) =>
      row.getValue(column.columnId),
    );
  }, [compiledColumns, filters]);
  const adapterColumns = useMemo(
    () => buildAdapterColumns(compiledColumns, tieBreaker, filterPredicate),
    [compiledColumns, filterPredicate, tieBreaker],
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
    () => compiledColumns.map((column) => column.columnId),
    [compiledColumns],
  );
  const columnPinning = useMemo(
    () => ({
      start: compiledColumns
        .filter((column) => column.pinned === "start")
        .map((column) => column.columnId),
      end: compiledColumns
        .filter((column) => column.pinned === "end")
        .map((column) => column.columnId),
    }),
    [compiledColumns],
  );
  const table = useTable(
    {
      features: clientFeatures,
      columns: adapterColumns,
      data: rows,
      getRowId: (row) => row.rowId,
      state: { columnFilters, columnOrder, columnPinning, sorting },
    },
    () => null,
  );
  const logicalColumns = stableLogicalColumns(table, compiledColumns);

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

function readLogicalColumns(
  table: ClientTable,
  compiledColumns: readonly CompiledColumn[],
): readonly CompiledColumn[] {
  const compiledById = new Map<string, CompiledColumn>(
    compiledColumns.map((column) => [column.columnId, column]),
  );
  const ordered = [
    ...table.getStartLeafColumns(),
    ...table.getCenterLeafColumns(),
    ...table.getEndLeafColumns(),
  ].flatMap((column) => {
    const compiled = compiledById.get(column.id);
    return compiled === undefined ? [] : [compiled];
  });
  if (ordered.length !== compiledColumns.length) {
    throw new TypeError("BrunoTable could not resolve its private Logical Column Order.");
  }
  return Object.freeze(ordered);
}

const LOGICAL_COLUMNS_BY_DEFINITION = new WeakMap<
  readonly CompiledColumn[],
  readonly CompiledColumn[]
>();

function stableLogicalColumns(
  table: ClientTable,
  compiledColumns: readonly CompiledColumn[],
): readonly CompiledColumn[] {
  const current = LOGICAL_COLUMNS_BY_DEFINITION.get(compiledColumns);
  if (current !== undefined) return current;
  const next = readLogicalColumns(table, compiledColumns);
  LOGICAL_COLUMNS_BY_DEFINITION.set(compiledColumns, next);
  return next;
}

function buildAdapterColumns(
  compiledColumns: readonly CompiledColumn[],
  tieBreaker: { readonly columnId: string; readonly direction: "asc" | "desc" } | undefined,
  filterPredicate: ((row: ClientRow) => boolean) | undefined,
): ClientColumn[] {
  const columns = compiledColumns.map(
    (column): ClientColumn => ({
      id: column.columnId,
      header: column.headerName,
      accessorFn: (row: AdapterRow) => readCanonicalValue(row, column),
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
      accessorFn: (row: AdapterRow) => row,
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

function readCanonicalValue(row: AdapterRow, column: CompiledColumn): unknown {
  queryValueReadListener?.(row.rowId, column.columnId);
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

function stableRowIds(rowModel: { readonly rows: readonly { readonly id: string }[] }) {
  const cached = ROW_IDS_BY_MODEL.get(rowModel);
  if (cached !== undefined) return cached;
  const rowIds = Object.freeze(rowModel.rows.map((row) => row.id));
  ROW_IDS_BY_MODEL.set(rowModel, rowIds);
  return rowIds;
}
