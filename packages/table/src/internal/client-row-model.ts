import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";

export type ClientOrderBy = readonly {
  readonly columnId: string;
  readonly direction: "asc" | "desc";
}[];

export function sanitizeClientInitialOrderBy(
  orderBy: ClientOrderBy | undefined,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  const sanitized = sanitizeClientOrderBy(orderBy, columns);
  if (sanitized.length === 0) {
    throw new TypeError(
      orderBy === undefined || orderBy.length === 0
        ? "BrunoTable initialOrderBy is required when sorting is available."
        : hasSortableColumns(columns)
          ? "BrunoTable initialOrderBy contains no valid sortable column."
          : "BrunoTableClient requires at least one sortable column.",
    );
  }
  return sanitized;
}

export function reconcileClientOrderBy(
  orderBy: ClientOrderBy,
  baseline: ClientOrderBy,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  const current = sanitizeClientOrderBy(orderBy, columns);
  if (current.length > 0 || !hasSortableColumns(columns)) return current;
  const initial = sanitizeClientOrderBy(baseline, columns);
  if (initial.length > 0) return initial;
  const firstSortable = columns.find((column) => column.enableSorting !== false);
  return firstSortable === undefined
    ? EMPTY_ORDER_BY
    : Object.freeze([
        Object.freeze({ columnId: firstSortable.columnId, direction: "asc" as const }),
      ]);
}

export function sanitizeClientOrderBy(
  orderBy: ClientOrderBy | undefined,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  if (orderBy === undefined) return EMPTY_ORDER_BY;
  const sortable = new Set<string>(
    columns.filter((column) => column.enableSorting !== false).map((column) => column.columnId),
  );
  const seen = new Set<string>();
  return Object.freeze(
    orderBy.flatMap((sort) => {
      if (sort.direction !== "asc" && sort.direction !== "desc") return [];
      if (!sortable.has(sort.columnId) || seen.has(sort.columnId)) return [];
      seen.add(sort.columnId);
      return [Object.freeze({ columnId: sort.columnId, direction: sort.direction })];
    }),
  );
}

export function sanitizeClientInitialFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
): readonly unknown[] {
  if (filters === undefined) return EMPTY_FILTERS;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const sanitized = filters.flatMap((filter) => {
    const next = sanitizeFilter(filter, columnsById);
    return next === undefined ? [] : [next];
  });
  return Object.isFrozen(filters) && sameReferences(filters, sanitized)
    ? filters
    : Object.freeze(sanitized);
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

export function filterReferencesColumn(candidate: unknown, columnId: string): boolean {
  const filter = asRecord(candidate);
  if (filter["columnId"] === columnId) return true;
  if (Array.isArray(filter["conditions"])) {
    return filter["conditions"].some((condition) => filterReferencesColumn(condition, columnId));
  }
  return filter["condition"] === undefined
    ? false
    : filterReferencesColumn(filter["condition"], columnId);
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
    const sanitizedConditions =
      Object.isFrozen(filter["conditions"]) && sameReferences(filter["conditions"], conditions)
        ? filter["conditions"]
        : Object.freeze(conditions);
    return snapshotFilter(filter, { conditions: sanitizedConditions });
  }
  if (type === "NOT") {
    const condition = sanitizeFilter(filter["condition"], columnsById);
    return condition === undefined ? undefined : snapshotFilter(filter, { condition });
  }
  const columnId = filter["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  if (column === undefined || column.enableFilter === false || column.kind !== "field") {
    return undefined;
  }
  const operand = filter["filter"];
  const decode = (value: unknown) => column.semantics.decodeRuntime(value);
  if (type === "blank" || type === "notBlank") return snapshotFilter(filter);
  if (type === "in") {
    if (!Array.isArray(operand)) return undefined;
    const decoded = operand.map(decode);
    const decodedValues = decoded.map((result) =>
      result._tag === "Success" ? result.value : undefined,
    );
    const sanitizedValues =
      Object.isFrozen(operand) && sameReferences(operand, decodedValues)
        ? operand
        : Object.freeze(decodedValues);
    return decoded.every((result) => result._tag === "Success")
      ? snapshotFilter(filter, { filter: sanitizedValues })
      : undefined;
  }
  if (type === "inRange") {
    if (column.semantics.filterFamily !== "numeric") return undefined;
    const from = decode(operand);
    const to = decode(filter["filterTo"]);
    return from._tag === "Success" && to._tag === "Success"
      ? snapshotFilter(filter, { filter: from.value, filterTo: to.value })
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
    return result._tag === "Success" ? snapshotFilter(filter, { filter: result.value }) : undefined;
  }
  if (
    type === "contains" ||
    type === "notContains" ||
    type === "startsWith" ||
    type === "endsWith"
  ) {
    return typeof operand === "string" && column.semantics.filterFamily === "text"
      ? snapshotFilter(filter)
      : undefined;
  }
  return undefined;
}

function snapshotFilter(
  filter: Readonly<Record<string, unknown>>,
  replacements: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const snapshot = { ...filter, ...replacements };
  if (
    Object.isFrozen(filter) &&
    Reflect.ownKeys(filter).length === Reflect.ownKeys(snapshot).length &&
    Reflect.ownKeys(snapshot).every((key) =>
      Object.is(filter[key as string], snapshot[key as string]),
    )
  ) {
    return filter;
  }
  return Object.freeze(snapshot);
}

function sameReferences(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function collectFilterColumnIds(candidate: unknown, target: Set<string>): void {
  const filter = asRecord(candidate);
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"]) collectFilterColumnIds(condition, target);
  }
  if (filter["condition"] !== undefined) collectFilterColumnIds(filter["condition"], target);
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
  if (column === undefined || column.enableFilter === false || column.kind !== "field") {
    return false;
  }

  const value = readCompiledColumnValue(column, row);
  const operand = filter["filter"];
  const caseSensitive = filter["caseSensitive"] === true;
  const accentSensitive = filter["accentSensitive"] === true;
  if (filter["type"] === "blank") return value === null || value === undefined || value === "";
  if (filter["type"] === "notBlank") return value !== null && value !== undefined && value !== "";
  if (filter["type"] === "equals") {
    return compareEquality(column, value, operand, caseSensitive, accentSensitive);
  }
  if (filter["type"] === "notEqual") {
    return !compareEquality(column, value, operand, caseSensitive, accentSensitive);
  }
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
  if (typeof operand !== "string") return false;
  if (typeof value !== "string") return filter["type"] === "notContains";
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
  return caseSensitive ? withoutAccents : withoutAccents.toLowerCase();
}

function hasSortableColumns(columns: readonly CompiledColumn[]): boolean {
  return columns.some((column) => column.enableSorting !== false);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

const EMPTY_FILTERS: readonly never[] = Object.freeze([]);
const EMPTY_ORDER_BY: ClientOrderBy = Object.freeze([]);
