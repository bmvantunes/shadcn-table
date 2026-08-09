import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnDef, RowData } from "@tanstack/react-table";

import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableClientAdmittedRow } from "./client-source-adapter";
import type { ClientOrderBy } from "./client-row-model";
import { createClientFilterPredicate } from "./client-row-model";

const clientFeatures = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

type AdapterRow = BrunoTableClientAdmittedRow & RowData;
type ClientColumn = ColumnDef<typeof clientFeatures, AdapterRow, unknown>;
const INTERNAL_FILTER_COLUMN_ID = "__BRUNO_TABLE_FILTERS__";

export function useClientRowIds(
  rows: readonly BrunoTableClientAdmittedRow[],
  compiledColumns: readonly CompiledColumn[],
  orderBy: ClientOrderBy,
  filters?: readonly unknown[],
): readonly string[] {
  const tieBreaker = orderBy.at(-1);
  const filterPredicate = useMemo(() => {
    return createClientFilterPredicate<AdapterRow>(compiledColumns, filters, (column, row) =>
      row.values.get(column.columnId),
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

  const rowModel = table.getRowModel();
  return useMemo(() => rowModel.rows.map((row) => row.id), [rowModel]);
}

function buildAdapterColumns(
  compiledColumns: readonly CompiledColumn[],
  tieBreaker: { readonly columnId: string; readonly direction: "asc" | "desc" } | undefined,
  filterPredicate: ((row: AdapterRow) => boolean) | undefined,
): ClientColumn[] {
  const columns = compiledColumns.map(
    (column): ClientColumn => ({
      id: column.columnId,
      header: column.headerName,
      accessorFn: (row: AdapterRow) => row.values.get(column.columnId),
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
      filterFn: (row) => filterPredicate?.(row.original) ?? true,
    },
    ...columns,
  ];
}

function compareRowIds(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
