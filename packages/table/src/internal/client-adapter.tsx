import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnDef, Row, RowData } from "@tanstack/react-table";

import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableClientAdmittedRow } from "./client-source-adapter";
import type { BrunoTableInvalidCellValue } from "./grid-runtime";
import { isBrunoTableInvalidCellValue } from "./grid-runtime";
import type { ClientOrderBy } from "./client-row-model";
import { collectClientFilterColumnIds, createClientFilterPredicate } from "./client-row-model";

const clientFeatures = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

type AdapterRow = BrunoTableClientAdmittedRow & RowData;
type ClientRow = Row<typeof clientFeatures, AdapterRow>;
type ClientColumn = ColumnDef<typeof clientFeatures, AdapterRow, unknown>;
const INTERNAL_FILTER_COLUMN_ID = "__BRUNO_TABLE_FILTERS__";

export function useClientRowIds(
  rows: readonly BrunoTableClientAdmittedRow[],
  compiledColumns: readonly CompiledColumn[],
  orderBy: ClientOrderBy,
  filters?: readonly unknown[],
): BrunoTableClientRowModelResult {
  const tieBreaker = orderBy.at(-1);
  const queryColumnIds = useMemo(() => {
    const columnIds = new Set(orderBy.map((sort) => sort.columnId));
    for (const filter of filters ?? EMPTY_FILTERS) {
      collectClientFilterColumnIds(filter, columnIds);
    }
    return Object.freeze(Array.from(columnIds));
  }, [filters, orderBy]);
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
  const table = useTable(
    {
      features: clientFeatures,
      columns: adapterColumns,
      data: rows,
      getRowId: (row) => row.rowId,
      state: { columnFilters, sorting },
    },
    () => null,
  );

  let rowModel: ReturnType<typeof table.getRowModel> | undefined;
  let invalid: BrunoTableInvalidCellValue["invalid"] | undefined;
  try {
    for (const row of table.getCoreRowModel().rows) {
      for (const columnId of queryColumnIds) row.getValue(columnId);
    }
    rowModel = table.getRowModel();
  } catch (error) {
    if (!(error instanceof ClientInvalidValueError)) throw error;
    invalid = error.invalid;
  }
  const rowIds = rowModel === undefined ? EMPTY_ROW_IDS : stableRowIds(rowModel);
  return invalid === undefined
    ? Object.freeze({ kind: "ready" as const, rowIds })
    : Object.freeze({ kind: "invalid" as const, invalid });
}

export type BrunoTableClientRowModelResult =
  | Readonly<{ readonly kind: "ready"; readonly rowIds: readonly string[] }>
  | Readonly<{
      readonly kind: "invalid";
      readonly invalid: BrunoTableInvalidCellValue["invalid"];
    }>;

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
const EMPTY_FILTERS: readonly never[] = Object.freeze([]);
const ROW_IDS_BY_MODEL = new WeakMap<object, readonly string[]>();

function stableRowIds(rowModel: { readonly rows: readonly { readonly id: string }[] }) {
  const cached = ROW_IDS_BY_MODEL.get(rowModel);
  if (cached !== undefined) return cached;
  const rowIds = Object.freeze(rowModel.rows.map((row) => row.id));
  ROW_IDS_BY_MODEL.set(rowModel, rowIds);
  return rowIds;
}
