import {
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import type { ColumnDef, RowData } from "@tanstack/react-table";

import type { CompiledColumn } from "./compile-columns";
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
  initialOrderBy: readonly {
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }[],
  getRowId: (row: TRow) => string,
  initialFilters?: readonly unknown[],
): readonly string[] {
  const adapterColumns = useMemo(() => buildAdapterColumns(compiledColumns), [compiledColumns]);
  const filteredRows = useMemo(
    () => filterClientRows(rows, compiledColumns, initialFilters),
    [compiledColumns, initialFilters, rows],
  );
  const data = filteredRows as readonly AdapterRow[];
  const table = useTable(
    {
      features: clientFeatures,
      columns: adapterColumns,
      data,
      getRowId: (row) => getRowId(row as TRow),
      initialState: {
        sorting: initialOrderBy.map((sort) => ({
          id: sort.columnId,
          desc: sort.direction === "desc",
        })),
      },
    },
    () => null,
  );

  const rowsInSortOrder = table.getRowModel().rows.slice();
  if (initialOrderBy.length > 0) {
    const columnsById = new Map<string, CompiledColumn>(
      compiledColumns.map((column) => [column.columnId, column]),
    );
    rowsInSortOrder.sort((left, right) => {
      for (const sort of initialOrderBy) {
        const column = columnsById.get(sort.columnId);
        if (column === undefined) continue;
        const result = column.semantics.compare(
          left.getValue(sort.columnId),
          right.getValue(sort.columnId),
        );
        if (result !== 0) return sort.direction === "desc" ? -result : result;
      }
      return compareRowIds(left.id, right.id);
    });
  }
  return rowsInSortOrder.map((row) => row.id);
}

export function sanitizeClientInitialOrderBy(
  orderBy: readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[] | undefined,
  columns: readonly CompiledColumn[],
): readonly { readonly columnId: string; readonly direction: "asc" | "desc" }[] {
  const sortable = new Set<string>(
    columns.filter((column) => column.enableSorting !== false).map((column) => column.columnId),
  );
  if (sortable.size > 0 && (orderBy === undefined || orderBy.length === 0)) {
    throw new TypeError("BrunoTable initialOrderBy is required when sorting is available.");
  }
  if (orderBy === undefined) return [];
  const seen = new Set<string>();
  const sanitized = orderBy.filter((sort) => {
    if (sort.direction !== "asc" && sort.direction !== "desc") return false;
    if (!sortable.has(sort.columnId) || seen.has(sort.columnId)) return false;
    seen.add(sort.columnId);
    return true;
  });
  if (sortable.size > 0 && sanitized.length === 0) {
    throw new TypeError("BrunoTable initialOrderBy contains no valid sortable column.");
  }
  return sanitized;
}

export function sanitizeClientInitialFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
): readonly unknown[] {
  if (filters === undefined) return [];
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  return filters.flatMap((filter) => {
    const sanitized = sanitizeFilter(filter, columnsById);
    return sanitized === undefined ? [] : [sanitized];
  });
}

function sanitizeFilter(
  candidate: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
): Readonly<Record<string, unknown>> | undefined {
  const filter = asRecord(candidate);
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    if (!Array.isArray(filter["conditions"])) return undefined;
    const conditions = filter["conditions"].map((condition) =>
      sanitizeFilter(condition, columnsById),
    );
    if (conditions.some((condition) => condition === undefined)) return undefined;
    const columnIds = new Set<string>();
    for (const condition of conditions) collectFilterColumnIds(condition, columnIds);
    if (columnIds.size > 1) return undefined;
    return { ...filter, conditions };
  }
  if (type === "NOT") {
    const condition = sanitizeFilter(filter["condition"], columnsById);
    return condition === undefined ? undefined : { ...filter, condition };
  }
  const columnId = filter["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  if (column === undefined || column.enableFilter === false || column.kind !== "field")
    return undefined;
  const operand = filter["filter"];
  const decode = (value: unknown) => column.semantics.decodeRuntime(value);
  if (type === "blank" || type === "notBlank") return filter;
  if (type === "in") {
    if (!Array.isArray(operand)) return undefined;
    const decoded = operand.map(decode);
    return decoded.every((result) => result._tag === "Success")
      ? {
          ...filter,
          filter: decoded.map((result) => (result._tag === "Success" ? result.value : undefined)),
        }
      : undefined;
  }
  if (type === "inRange") {
    if (column.semantics.filterFamily !== "numeric") return undefined;
    const from = decode(operand);
    const to = decode(filter["filterTo"]);
    return from._tag === "Success" && to._tag === "Success"
      ? { ...filter, filter: from.value, filterTo: to.value }
      : undefined;
  }
  if (
    type === "equals" ||
    type === "notEqual" ||
    type === "greaterThan" ||
    type === "greaterThanOrEqual" ||
    type === "lessThan" ||
    type === "lessThanOrEqual"
  ) {
    if (
      (type === "greaterThan" ||
        type === "greaterThanOrEqual" ||
        type === "lessThan" ||
        type === "lessThanOrEqual") &&
      column.semantics.filterFamily !== "numeric"
    ) {
      return undefined;
    }
    const result = decode(operand);
    return result._tag === "Success" ? { ...filter, filter: result.value } : undefined;
  }
  if (
    type === "contains" ||
    type === "notContains" ||
    type === "startsWith" ||
    type === "endsWith"
  ) {
    return typeof operand === "string" && column.semantics.filterFamily === "text"
      ? filter
      : undefined;
  }
  return undefined;
}

function collectFilterColumnIds(candidate: unknown, target: Set<string>): void {
  const filter = asRecord(candidate);
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"]) collectFilterColumnIds(condition, target);
  }
  if (filter["condition"] !== undefined) collectFilterColumnIds(filter["condition"], target);
}

export function filterClientRows<TRow>(
  rows: readonly TRow[],
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
): readonly TRow[] {
  if (filters === undefined || filters.length === 0) return rows;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  return rows.filter((row) => filters.every((filter) => evaluateFilter(filter, row, columnsById)));
}

function evaluateFilter(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
): boolean {
  const filter = asRecord(candidate);
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const conditions = Array.isArray(filter["conditions"]) ? filter["conditions"] : [];
    return type === "AND"
      ? conditions.every((condition) => evaluateFilter(condition, row, columnsById))
      : conditions.some((condition) => evaluateFilter(condition, row, columnsById));
  }
  if (type === "NOT") return !evaluateFilter(filter["condition"], row, columnsById);
  const columnId = filter["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  if (column === undefined || column.enableFilter === false || column.kind !== "field")
    return false;

  const value = readCompiledColumnValue(column, row);
  const operand = filter["filter"];
  const caseSensitive = filter["caseSensitive"] === true;
  const accentSensitive = filter["accentSensitive"] === true;
  if (filter["type"] === "blank") return value === null || value === undefined || value === "";
  if (filter["type"] === "notBlank") return value !== null && value !== undefined && value !== "";
  if (filter["type"] === "equals")
    return compareEquality(column, value, operand, caseSensitive, accentSensitive);
  if (filter["type"] === "notEqual")
    return !compareEquality(column, value, operand, caseSensitive, accentSensitive);
  if (filter["type"] === "in") {
    return (
      Array.isArray(operand) &&
      operand.some((item) => compareEquality(column, value, item, caseSensitive, accentSensitive))
    );
  }
  if (filter["type"] === "greaterThan") return column.semantics.compare(value, operand) > 0;
  if (filter["type"] === "greaterThanOrEqual") return column.semantics.compare(value, operand) >= 0;
  if (filter["type"] === "lessThan") return column.semantics.compare(value, operand) < 0;
  if (filter["type"] === "lessThanOrEqual") return column.semantics.compare(value, operand) <= 0;
  if (filter["type"] === "inRange") {
    return (
      column.semantics.compare(operand, value) <= 0 &&
      column.semantics.compare(value, filter["filterTo"]) < 0
    );
  }
  if (typeof value !== "string" || typeof operand !== "string") return false;
  const left = normalizeText(value, caseSensitive, accentSensitive);
  const right = normalizeText(operand, caseSensitive, accentSensitive);
  if (filter["type"] === "contains") return left.includes(right);
  if (filter["type"] === "notContains") return !left.includes(right);
  if (filter["type"] === "startsWith") return left.startsWith(right);
  if (filter["type"] === "endsWith") return left.endsWith(right);
  return false;
}

function compareEquality(
  column: CompiledColumn,
  value: unknown,
  operand: unknown,
  caseSensitive: boolean,
  accentSensitive: boolean,
): boolean {
  if (
    column.semantics.filterFamily === "text" &&
    typeof value === "string" &&
    typeof operand === "string"
  ) {
    return (
      normalizeText(value, caseSensitive, accentSensitive) ===
      normalizeText(operand, caseSensitive, accentSensitive)
    );
  }
  return column.semantics.equivalent(value, operand);
}

function normalizeText(value: string, caseSensitive: boolean, accentSensitive: boolean): string {
  const withoutAccents = accentSensitive ? value : value.normalize("NFD").replace(/\p{Mark}/gu, "");
  return caseSensitive ? withoutAccents : withoutAccents.toLocaleLowerCase();
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function compareRowIds(left: string, right: string): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function buildAdapterColumns(compiledColumns: readonly CompiledColumn[]): ClientColumn[] {
  return compiledColumns.map((column) => ({
    id: column.columnId,
    header: column.headerName,
    accessorFn: (row: AdapterRow) => readCompiledColumnValue(column, row),
    sortFn: (rowA, rowB) =>
      column.semantics.compare(rowA.getValue(column.columnId), rowB.getValue(column.columnId)),
  }));
}
