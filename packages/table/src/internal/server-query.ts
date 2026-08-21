import type { CompiledColumn, CompiledFieldColumn } from "./compile-columns";

export type BrunoTableServerQueryInput = Readonly<{
  readonly filters: readonly unknown[];
  readonly quickFilter: string;
  readonly quickFilterFields: readonly string[];
  readonly orderBy: readonly Readonly<{
    readonly columnId: string;
    readonly direction: "asc" | "desc";
  }>[];
}>;

export type BrunoTableCompiledServerQuery = Readonly<{
  readonly select: readonly [string, ...string[]];
  readonly where: readonly unknown[];
  readonly orderBy: readonly Readonly<{
    readonly field: string;
    readonly direction: "asc" | "desc";
  }>[];
}>;

export type BrunoTableCompiledServerQueryPlan = Readonly<{
  readonly query: BrunoTableCompiledServerQuery;
  readonly operandSemantics: ReadonlyMap<object, CompiledFieldColumn["semantics"]>;
}>;

export function compileBrunoTableServerQuery(
  columns: readonly CompiledColumn[],
  input: BrunoTableServerQueryInput,
): BrunoTableCompiledServerQuery {
  return compileBrunoTableServerQueryPlan(columns, input).query;
}

export function compileBrunoTableServerQueryPlan(
  columns: readonly CompiledColumn[],
  input: BrunoTableServerQueryInput,
): BrunoTableCompiledServerQueryPlan {
  const fields = new Set<string>();
  const fieldColumns = new Map<string, CompiledFieldColumn>();
  const operandSemantics = new Map<object, CompiledFieldColumn["semantics"]>();
  for (const column of columns) {
    if (column.kind === "field") {
      fields.add(column.field);
      fieldColumns.set(column.columnId, column);
    } else {
      for (const field of column.fields) fields.add(field);
    }
  }
  for (const field of input.quickFilterFields) fields.add(field);
  const select = [...fields];
  if (select.length === 0) {
    throw new TypeError("BrunoTable Server projection must contain at least one Query Field.");
  }

  const where = input.filters.map((filter) =>
    compileFilter(filter, fieldColumns, operandSemantics),
  );
  if (input.quickFilter.length > 0 && input.quickFilterFields.length > 0) {
    where.push(
      Object.freeze({
        type: "OR",
        conditions: Object.freeze(
          input.quickFilterFields.map((field) =>
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

  const first = select[0]!;
  const projectedFields: [string, ...string[]] = [first, ...select.slice(1)];
  return Object.freeze({
    query: Object.freeze({
      select: Object.freeze(projectedFields),
      where: Object.freeze(where),
      orderBy: Object.freeze(orderBy),
    }),
    operandSemantics,
  });
}

function compileFilter(
  filter: unknown,
  columns: ReadonlyMap<string, CompiledFieldColumn>,
  operandSemantics: Map<object, CompiledFieldColumn["semantics"]>,
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
      conditions: Object.freeze(
        conditions.map((condition) => compileFilter(condition, columns, operandSemantics)),
      ),
    });
  }
  if (type === "NOT") {
    return Object.freeze({
      type,
      condition: compileFilter(Reflect.get(filter, "condition"), columns, operandSemantics),
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
  operandSemantics.set(compiled, column.semantics);
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
