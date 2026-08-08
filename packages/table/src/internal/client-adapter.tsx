import {
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnDef, RowData } from "@tanstack/react-table";

import type { CompiledColumn } from "./compile-columns";
import type { ClientOrderBy } from "./client-row-model";
import { filterClientRows } from "./client-row-model";
import { readCompiledColumnValue } from "./cell-value";

const clientFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

type AdapterRow = RowData;
type ClientColumn = ColumnDef<typeof clientFeatures, AdapterRow, unknown>;

export function useClientRowIds<TRow>(
  rows: readonly TRow[],
  compiledColumns: readonly CompiledColumn[],
  orderBy: ClientOrderBy,
  getRowId: (row: TRow) => string,
  filters?: readonly unknown[],
): readonly string[] {
  const tieBreaker = orderBy.at(-1);
  const adapterColumns = useMemo(
    () => buildAdapterColumns(compiledColumns, tieBreaker),
    [compiledColumns, tieBreaker],
  );
  const filteredRows = useMemo(
    () => filterClientRows(rows, compiledColumns, filters),
    [compiledColumns, filters, rows],
  );
  const sorting = useMemo(
    () =>
      orderBy.map((sort) => ({
        id: sort.columnId,
        desc: sort.direction === "desc",
      })),
    [orderBy],
  );
  const data = filteredRows as readonly AdapterRow[];
  const table = useTable(
    {
      features: clientFeatures,
      columns: adapterColumns,
      data,
      getRowId: (row) => getRowId(row as TRow),
      state: { sorting },
    },
    () => null,
  );

  const rowModel = table.getRowModel();
  return useMemo(() => rowModel.rows.map((row) => row.id), [rowModel]);
}

function buildAdapterColumns(
  compiledColumns: readonly CompiledColumn[],
  tieBreaker: { readonly columnId: string; readonly direction: "asc" | "desc" } | undefined,
): ClientColumn[] {
  return compiledColumns.map((column) => ({
    id: column.columnId,
    header: column.headerName,
    accessorFn: (row: AdapterRow) => readCompiledColumnValue(column, row),
    sortFn: (rowA, rowB) => {
      const comparison = column.semantics.compare(
        rowA.getValue(column.columnId),
        rowB.getValue(column.columnId),
      );
      return comparison === 0 && column.columnId === tieBreaker?.columnId
        ? compareRowIds(rowA.id, rowB.id) * (tieBreaker.direction === "desc" ? -1 : 1)
        : comparison;
    },
  }));
}

function compareRowIds(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
