import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";

export type ClientOrderBy = readonly {
  readonly columnId: string;
  readonly direction: "asc" | "desc";
}[];

export type BrunoTableOrderBy = ClientOrderBy;

export function reconcileBrunoTableOrderBy(
  orderBy: BrunoTableOrderBy,
  baseline: BrunoTableOrderBy,
  columns: readonly CompiledColumn[],
): BrunoTableOrderBy {
  return reconcileClientOrderBy(orderBy, baseline, columns);
}

export function sanitizeBrunoTableOrderBy(
  orderBy: BrunoTableOrderBy | undefined,
  columns: readonly CompiledColumn[],
): BrunoTableOrderBy {
  return sanitizeClientOrderBy(orderBy, columns);
}

export function sanitizeBrunoTableFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
): readonly unknown[] {
  return sanitizeClientInitialFilters(filters, columns);
}

export function brunoTableFilterReferencesColumn(candidate: unknown, columnId: string): boolean {
  return filterReferencesColumn(candidate, columnId);
}

export function sanitizeClientInitialOrderBy(
  orderBy: ClientOrderBy | undefined,
  columns: readonly CompiledColumn[],
): ClientOrderBy {
  const sanitized = sanitizeClientOrderBy(orderBy, columns);
  if (sanitized.length === 0) {
    throw new TypeError(
      orderBy === undefined || (Array.isArray(orderBy) && orderBy.length === 0)
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
  if (!Array.isArray(orderBy)) return EMPTY_ORDER_BY;
  const sortable = new Set<string>(
    columns.filter((column) => column.enableSorting !== false).map((column) => column.columnId),
  );
  const seen = new Set<string>();
  return Object.freeze(
    orderBy.flatMap((candidate: unknown) => {
      const sort = asRecord(candidate);
      const direction = sort["direction"];
      const columnId = sort["columnId"];
      if (direction !== "asc" && direction !== "desc") return [];
      if (typeof columnId !== "string" || !sortable.has(columnId) || seen.has(columnId)) return [];
      seen.add(columnId);
      return [Object.freeze({ columnId, direction })];
    }),
  );
}

export function sanitizeClientInitialFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
): readonly unknown[] {
  if (!Array.isArray(filters)) return EMPTY_FILTERS;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const context: FilterSanitizationContext = { nodes: 0, visited: new WeakSet<object>() };
  const sanitized = filters.flatMap((filter) => {
    const next = sanitizeFilter(filter, columnsById, context, 0);
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
  const predicate = createClientFilterPredicate(columns, filters);
  return predicate === undefined ? rows : rows.filter(predicate);
}

export function createClientFilterPredicate<TRow>(
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  readValue: (column: CompiledColumn, row: TRow) => unknown = readCompiledColumnValue,
): ((row: TRow) => boolean) | undefined {
  if (filters === undefined || filters.length === 0) return undefined;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const readUnknown = (column: CompiledColumn, row: unknown) => readValue(column, row as TRow);
  return (row) => filters.every((filter) => evaluateFilter(filter, row, columnsById, readUnknown));
}

export function filterReferencesColumn(candidate: unknown, columnId: string): boolean {
  const columnIds = new Set<string>();
  collectClientFilterColumnIds(candidate, columnIds);
  return columnIds.has(columnId);
}

export function collectClientFilterColumnIds(candidate: unknown, target: Set<string>): void {
  const filter = asRecord(candidate);
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"]) collectClientFilterColumnIds(condition, target);
  }
  if (filter["condition"] !== undefined) {
    collectClientFilterColumnIds(filter["condition"], target);
  }
}

function sanitizeFilter(
  candidate: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
): Readonly<Record<string, unknown>> | undefined {
  if (
    depth > CLIENT_FILTER_MAX_DEPTH ||
    context.nodes >= CLIENT_FILTER_MAX_NODES ||
    typeof candidate !== "object" ||
    candidate === null ||
    context.visited.has(candidate)
  ) {
    return undefined;
  }
  context.nodes += 1;
  context.visited.add(candidate);
  try {
    const filter = asRecord(candidate);
    const type = filter["type"];
    if (type === "AND" || type === "OR") {
      const candidates = filter["conditions"];
      if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
      const conditions: Readonly<Record<string, unknown>>[] = [];
      for (let index = 0; index < candidates.length; index += 1) {
        if (!Object.hasOwn(candidates, index)) return undefined;
        const condition = sanitizeFilter(candidates[index], columnsById, context, depth + 1);
        if (condition === undefined) return undefined;
        conditions.push(condition);
      }
      const columnIds = new Set<string>();
      for (const condition of conditions) collectClientFilterColumnIds(condition, columnIds);
      if (columnIds.size > 1) return undefined;
      const sanitizedConditions =
        Object.isFrozen(candidates) && sameReferences(candidates, conditions)
          ? candidates
          : Object.freeze(conditions);
      return snapshotFilter(filter, ["type", "conditions"], { conditions: sanitizedConditions });
    }
    if (type === "NOT") {
      const condition = sanitizeFilter(filter["condition"], columnsById, context, depth + 1);
      return condition === undefined
        ? undefined
        : snapshotFilter(filter, ["type", "condition"], { condition });
    }
    const columnId = filter["columnId"];
    const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
    if (column === undefined || column.enableFilter === false || column.kind !== "field") {
      return undefined;
    }
    const operand = filter["filter"];
    const decode = (value: unknown) => column.semantics.decodeRuntime(value);
    if (type === "blank" || type === "notBlank") {
      return snapshotFilter(filter, ["columnId", "type"]);
    }
    if (type === "in") {
      if (
        !Array.isArray(operand) ||
        !isDenseArray(operand) ||
        !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text")
      ) {
        return undefined;
      }
      const decoded = operand.map(decode);
      const decodedValues = decoded.map((result) =>
        result._tag === "Success" ? result.value : undefined,
      );
      const sanitizedValues =
        Object.isFrozen(operand) && sameReferences(operand, decodedValues)
          ? operand
          : Object.freeze(decodedValues);
      return decoded.every((result) => result._tag === "Success")
        ? snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            {
              filter: sanitizedValues,
            },
          )
        : undefined;
    }
    if (type === "inRange") {
      if (column.semantics.filterFamily !== "numeric") return undefined;
      const from = decode(operand);
      const to = decode(filter["filterTo"]);
      return from._tag === "Success" && to._tag === "Success"
        ? snapshotFilter(filter, ["columnId", "type", "filter", "filterTo"], {
            filter: from.value,
            filterTo: to.value,
          })
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
      if (
        result._tag !== "Success" ||
        ((type === "equals" || type === "notEqual") &&
          !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text"))
      ) {
        return undefined;
      }
      return snapshotFilter(
        filter,
        type === "equals" || type === "notEqual"
          ? ["columnId", "type", "filter", "caseSensitive", "accentSensitive"]
          : ["columnId", "type", "filter"],
        { filter: result.value },
      );
    }
    if (
      type === "contains" ||
      type === "notContains" ||
      type === "startsWith" ||
      type === "endsWith"
    ) {
      const validSensitivity = hasValidTextSensitivity(filter, true);
      const decoded = decode(operand);
      const normalizedOperand =
        decoded._tag === "Success" && typeof decoded.value === "string" && validSensitivity
          ? normalizeText(
              decoded.value,
              filter["caseSensitive"] === true,
              filter["accentSensitive"] === true,
            )
          : "";
      return column.semantics.filterFamily === "text" && normalizedOperand.length > 0
        ? snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            {
              filter: decoded._tag === "Success" ? decoded.value : undefined,
            },
          )
        : undefined;
    }
    return undefined;
  } finally {
    context.visited.delete(candidate);
  }
}

function snapshotFilter(
  filter: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  replacements: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(replacements, key)) snapshot[key] = replacements[key];
    else if (Object.hasOwn(filter, key)) snapshot[key] = filter[key];
  }
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

function evaluateFilter(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
): boolean {
  const filter = asRecord(candidate);
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const conditions = Array.isArray(filter["conditions"]) ? filter["conditions"] : [];
    return type === "AND"
      ? conditions.every((condition) => evaluateFilter(condition, row, columnsById, readValue))
      : conditions.some((condition) => evaluateFilter(condition, row, columnsById, readValue));
  }
  if (type === "NOT") {
    return !evaluateFilter(filter["condition"], row, columnsById, readValue);
  }
  const columnId = filter["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  if (column === undefined || column.enableFilter === false || column.kind !== "field") {
    return false;
  }

  const value = readValue(column, row);
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
  if (
    (filter["type"] === "greaterThan" ||
      filter["type"] === "greaterThanOrEqual" ||
      filter["type"] === "lessThan" ||
      filter["type"] === "lessThanOrEqual" ||
      filter["type"] === "inRange") &&
    (value === null || value === undefined)
  ) {
    return false;
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
  if (value === null || value === undefined || operand === null || operand === undefined) {
    return value === operand;
  }
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
  const withoutAccents = accentSensitive
    ? value.normalize("NFC")
    : value.normalize("NFD").replace(/\p{Mark}/gu, "");
  return caseSensitive ? withoutAccents : withoutAccents.toLowerCase();
}

function hasValidTextSensitivity(
  filter: Readonly<Record<string, unknown>>,
  supported: boolean,
): boolean {
  return ["caseSensitive", "accentSensitive"].every(
    (key) => !Object.hasOwn(filter, key) || (supported && typeof filter[key] === "boolean"),
  );
}

function isDenseArray(values: readonly unknown[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) return false;
  }
  return true;
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
const CLIENT_FILTER_MAX_DEPTH = 64;
const CLIENT_FILTER_MAX_NODES = 1_024;

type FilterSanitizationContext = {
  nodes: number;
  readonly visited: WeakSet<object>;
};
