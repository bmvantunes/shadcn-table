import type { CompiledColumn, CompiledFieldColumn } from "./compile-columns";

export type BrunoTableServerQueryInput = Readonly<{
  readonly routeBy?: Readonly<Record<string, unknown>>;
  readonly externalFilters?: readonly unknown[];
  readonly filters: readonly unknown[];
  readonly quickFilter: string;
  readonly quickFilterFields: readonly string[];
  readonly visibleColumnIds?: readonly string[];
  readonly orderBy: readonly Readonly<{
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }>[];
}>;

export type BrunoTableCompiledServerQuery = Readonly<{
  readonly routeBy?: Readonly<Record<string, unknown>>;
  readonly select: readonly [string, ...string[]];
  readonly where: readonly unknown[];
  readonly orderBy: readonly Readonly<{
    readonly field: string;
    readonly direction: "asc" | "desc";
  }>[];
}>;

export type BrunoTableCompiledServerQueryPlan = Readonly<{
  readonly query: BrunoTableCompiledServerQuery;
}>;

export const BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS = "__bruno_table_facet_count";

export type BrunoTableCompiledServerFacetQuery = Readonly<{
  readonly routeBy?: Readonly<Record<string, unknown>>;
  readonly groupBy: readonly [string];
  readonly aggregates: Readonly<Record<string, Readonly<{ readonly aggFunc: "count" }>>>;
  readonly where: readonly unknown[];
  readonly orderBy: readonly [Readonly<{ readonly field: string; readonly direction: "asc" }>];
}>;

export type BrunoTableCompiledServerFacetQueryPlan = Readonly<{
  readonly countAlias: string;
  readonly query: BrunoTableCompiledServerFacetQuery;
}>;

export function compileBrunoTableServerProjectionFields(
  columns: readonly CompiledColumn[],
  quickFilterFields: readonly string[],
  completeRawSelect: readonly [string, ...string[]] | undefined,
  visibleColumnIds?: readonly string[],
): readonly [string, ...string[]] {
  const visibleIds = visibleColumnIds === undefined ? undefined : new Set(visibleColumnIds);
  const activeColumns =
    visibleIds === undefined
      ? columns
      : columns.filter((column) => visibleIds.has(column.columnId));
  if (activeColumns.some(columnUsesRawRowPresentation)) {
    if (completeRawSelect === undefined) {
      throw new TypeError(
        "BrunoTable Server raw-row presentation requires source-owned completeRawSelect.",
      );
    }
    return completeRawSelect;
  }
  const fields = new Set<string>();
  for (const column of activeColumns) {
    if (column.kind === "field") fields.add(column.field);
    else for (const field of column.fields) fields.add(field);
  }
  for (const field of quickFilterFields) fields.add(field);
  const select = [...fields];
  const first = select[0];
  if (first === undefined) {
    throw new TypeError("BrunoTable Server projection must contain at least one Query Field.");
  }
  return Object.freeze([first, ...select.slice(1)]);
}

export function compileBrunoTableServerQueryPlan(
  columns: readonly CompiledColumn[],
  input: BrunoTableServerQueryInput,
  completeRawSelect: readonly [string, ...string[]] | undefined,
): BrunoTableCompiledServerQueryPlan {
  const fieldColumns = new Map<string, CompiledFieldColumn>();
  for (const column of columns) {
    if (column.kind === "field") {
      fieldColumns.set(column.columnId, column);
    }
  }
  const select = compileBrunoTableServerProjectionFields(
    columns,
    input.quickFilterFields,
    completeRawSelect,
    input.visibleColumnIds,
  );

  const where = [...(input.externalFilters ?? [])];
  where.push(...input.filters.map((filter) => compileFilter(filter, fieldColumns)));
  if (input.quickFilter.length > 0 && input.quickFilterFields.length > 0) {
    const quickFilterFields = [...input.quickFilterFields].sort();
    where.push(
      Object.freeze({
        type: "OR",
        conditions: Object.freeze(
          quickFilterFields.map((field) =>
            Object.freeze({ field, type: "contains", filter: input.quickFilter }),
          ),
        ),
      }),
    );
  }

  const orderBy = input.orderBy.map((order) => {
    const column = fieldColumns.get(order.columnId);
    if (column === undefined || !column.enableSorting) {
      throw new TypeError(`BrunoTable Server sort has no Query Field: ${order.columnId}`);
    }
    return Object.freeze({ field: column.field, direction: order.direction });
  });
  if (orderBy.length === 0) {
    throw new TypeError("BrunoTable Server requires a non-empty orderBy query.");
  }

  return Object.freeze({
    query: Object.freeze({
      ...(input.routeBy === undefined ? {} : { routeBy: input.routeBy }),
      select,
      where: Object.freeze(where),
      orderBy: Object.freeze(orderBy),
    }),
  });
}

export function compileBrunoTableServerFacetQuery(
  columns: readonly CompiledColumn[],
  columnId: string,
  input: BrunoTableServerQueryInput,
): BrunoTableCompiledServerFacetQueryPlan {
  const fieldColumns = new Map<string, CompiledFieldColumn>();
  for (const column of columns) {
    if (column.kind === "field") fieldColumns.set(column.columnId, column);
  }
  const column = fieldColumns.get(columnId);
  if (column === undefined || !column.enableFilter || !column.enableSetFilter) {
    throw new TypeError(`BrunoTable Server facet has no Query Field: ${columnId}`);
  }
  const where = [...(input.externalFilters ?? [])];
  where.push(
    ...input.filters
      .filter((filter) => !filterContainsColumn(filter, columnId))
      .map((filter) => compileFilter(filter, fieldColumns)),
  );
  if (input.quickFilter.length > 0 && input.quickFilterFields.length > 0) {
    where.push(
      Object.freeze({
        type: "OR",
        conditions: Object.freeze(
          [...input.quickFilterFields]
            .sort()
            .map((field) => Object.freeze({ field, type: "contains", filter: input.quickFilter })),
        ),
      }),
    );
  }
  const groupBy: readonly [string] = Object.freeze([column.field]);
  const countAlias =
    column.field === BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS
      ? `${BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS}_1`
      : BRUNO_TABLE_SERVER_FACET_COUNT_ALIAS;
  const orderBy: readonly [Readonly<{ readonly field: string; readonly direction: "asc" }>] =
    Object.freeze([Object.freeze({ field: column.field, direction: "asc" })]);
  return Object.freeze({
    countAlias,
    query: Object.freeze({
      ...(input.routeBy === undefined ? {} : { routeBy: input.routeBy }),
      groupBy,
      aggregates: Object.freeze({
        [countAlias]: Object.freeze({ aggFunc: "count" }),
      }),
      where: Object.freeze(where),
      orderBy,
    }),
  });
}

export function columnUsesRawRowPresentation(column: CompiledColumn): boolean {
  return (
    column.valueFormatter !== undefined ||
    typeof column.cellClassName === "function" ||
    column.cellRenderer !== undefined
  );
}

function compileFilter(
  filter: unknown,
  columns: ReadonlyMap<string, CompiledFieldColumn>,
): unknown {
  if (!isRecord(filter)) throw new TypeError("BrunoTable Server filter must be an object.");
  const type = Reflect.get(filter, "type");
  if (type === "AND" || type === "OR") {
    const conditions = Reflect.get(filter, "conditions");
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw new TypeError("BrunoTable Server compound filters must be non-empty.");
    }
    return Object.freeze({
      type,
      conditions: Object.freeze(conditions.map((condition) => compileFilter(condition, columns))),
    });
  }
  if (type === "NOT") {
    return Object.freeze({
      type,
      condition: compileFilter(Reflect.get(filter, "condition"), columns),
    });
  }

  const columnId = Reflect.get(filter, "columnId");
  if (typeof columnId !== "string") {
    throw new TypeError("BrunoTable Server filter is missing its Column Identity.");
  }
  const column = columns.get(columnId);
  if (column === undefined || !column.enableFilter) {
    throw new TypeError(`BrunoTable Server filter has no Query Field: ${columnId}`);
  }
  if (type === "matchNone") {
    if (!column.enableSetFilter) {
      throw new TypeError(`BrunoTable Server Match None requires a Set Filter: ${columnId}`);
    }
    return Object.freeze({ type: "FALSE" });
  }
  if (typeof type !== "string" || !FIELD_FILTER_TYPES.has(type)) {
    throw new TypeError(`BrunoTable Server filter operator is unsupported: ${String(type)}`);
  }

  const compiled: Record<PropertyKey, unknown> = { field: column.field, type };
  copyOwn(filter, compiled, "filter");
  copyOwn(filter, compiled, "filterTo");
  copyOwn(filter, compiled, "caseSensitive");
  copyOwn(filter, compiled, "accentSensitive");
  return Object.freeze(compiled);
}

function copyOwn(
  source: Readonly<Record<PropertyKey, unknown>>,
  target: Record<PropertyKey, unknown>,
  property: PropertyKey,
): void {
  if (Object.prototype.hasOwnProperty.call(source, property)) {
    const value = Reflect.get(source, property);
    Reflect.set(target, property, Array.isArray(value) ? Object.freeze([...value]) : value);
  }
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === "object" && value !== null;
}

function filterContainsColumn(filter: unknown, columnId: string): boolean {
  if (!isRecord(filter)) return false;
  if (Reflect.get(filter, "columnId") === columnId) return true;
  const conditions = Reflect.get(filter, "conditions");
  if (Array.isArray(conditions)) {
    return conditions.some((condition) => filterContainsColumn(condition, columnId));
  }
  return filterContainsColumn(Reflect.get(filter, "condition"), columnId);
}

const FIELD_FILTER_TYPES = new Set([
  "equals",
  "notEqual",
  "in",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "inRange",
  "blank",
  "notBlank",
]);
