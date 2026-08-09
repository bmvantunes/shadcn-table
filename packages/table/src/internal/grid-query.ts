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
      orderBy === undefined || isReadableEmptyArray(orderBy)
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
  const candidates = snapshotRootEntries(orderBy);
  if (candidates === undefined) return EMPTY_ORDER_BY;
  const sortable = new Set<string>(
    columns.filter((column) => column.enableSorting !== false).map((column) => column.columnId),
  );
  const seen = new Set<string>();
  const sanitized: { readonly columnId: string; readonly direction: "asc" | "desc" }[] = [];
  for (const candidate of candidates) {
    try {
      const sort = asRecord(candidate);
      const direction = sort["direction"];
      const columnId = sort["columnId"];
      if (direction !== "asc" && direction !== "desc") continue;
      if (typeof columnId !== "string" || !sortable.has(columnId) || seen.has(columnId)) continue;
      seen.add(columnId);
      sanitized.push(Object.freeze({ columnId, direction }));
    } catch {
      // Ignore only this unreadable external entry so valid siblings remain usable.
    }
  }
  return Object.freeze(sanitized);
}

export function sanitizeClientInitialFilters(
  filters: readonly unknown[] | undefined,
  columns: readonly CompiledColumn[],
): readonly unknown[] {
  const candidates = snapshotRootEntries(filters);
  if (candidates === undefined) return EMPTY_FILTERS;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const context: FilterSanitizationContext = {
    captured: new WeakMap<object, Readonly<Record<string, unknown>> | undefined>(),
    capturedArrays: new WeakMap<object, readonly unknown[] | undefined>(),
    completed: new WeakMap<object, Map<number, SanitizedFilterNode | undefined>>(),
    visited: new WeakSet<object>(),
  };
  const sanitized: Readonly<Record<string, unknown>>[] = [];
  for (const filter of candidates) {
    const next = sanitizeFilter(filter, columnsById, context, 0);
    if (next !== undefined) sanitized.push(next.filter);
  }
  return snapshotSanitizedFilterArray(filters, sanitized);
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
  const hasSharedNodes = containsSharedFilterNodes(filters);
  return (row) => {
    const completed = hasSharedNodes ? new WeakMap<object, boolean>() : undefined;
    return filters.every((filter) =>
      evaluateFilter(filter, row, columnsById, readUnknown, completed),
    );
  };
}

export function filterReferencesColumn(candidate: unknown, columnId: string): boolean {
  const columnIds = new Set<string>();
  collectClientFilterColumnIds(candidate, columnIds);
  return columnIds.has(columnId);
}

export function collectClientFilterColumnIds(candidate: unknown, target: Set<string>): void {
  collectFilterColumnIds(candidate, target, new WeakSet<object>());
}

function collectFilterColumnIds(
  candidate: unknown,
  target: Set<string>,
  visited: WeakSet<object>,
): void {
  if (typeof candidate !== "object" || candidate === null || visited.has(candidate)) return;
  visited.add(candidate);
  const filter = asRecord(candidate);
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"])
      collectFilterColumnIds(condition, target, visited);
  }
  if (filter["condition"] !== undefined) {
    collectFilterColumnIds(filter["condition"], target, visited);
  }
}

function sanitizeFilter(
  candidate: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
): SanitizedFilterNode | undefined {
  if (
    depth > CLIENT_FILTER_MAX_DEPTH ||
    typeof candidate !== "object" ||
    candidate === null ||
    context.visited.has(candidate)
  ) {
    return undefined;
  }
  const completedAtDepth = context.completed.get(candidate);
  if (completedAtDepth?.has(depth) === true) return completedAtDepth.get(depth);
  context.visited.add(candidate);
  let captured: Readonly<Record<string, unknown>> | undefined;
  try {
    captured = context.captured.get(candidate);
    if (!context.captured.has(candidate)) {
      captured = captureFilterRecord(asRecord(candidate), context);
      context.captured.set(candidate, captured);
    }
  } catch {
    context.captured.set(candidate, undefined);
    context.visited.delete(candidate);
    return memoizeSanitizedFilter(candidate, depth, undefined, context, completedAtDepth);
  }
  let sanitized: SanitizedFilterNode | undefined;
  try {
    sanitized =
      captured === undefined
        ? undefined
        : sanitizeFilterRecord(captured, columnsById, context, depth);
  } finally {
    context.visited.delete(candidate);
  }
  return memoizeSanitizedFilter(candidate, depth, sanitized, context, completedAtDepth);
}

function captureFilterRecord(
  filter: Readonly<Record<string, unknown>>,
  context: FilterSanitizationContext,
): Readonly<Record<string, unknown>> | undefined {
  if (SANITIZED_FILTER_SNAPSHOTS.has(filter)) return filter;
  if (!Object.hasOwn(filter, "type")) return undefined;
  const type = filter["type"];
  const keys = filterCaptureKeys(type);
  if (keys === undefined) return undefined;
  const captured: Record<string, unknown> = { type };
  for (const key of keys) {
    if (!Object.hasOwn(filter, key)) continue;
    const value = filter[key];
    captured[key] =
      (key === "conditions" || (key === "filter" && type === "in")) && value !== undefined
        ? captureDenseFilterArray(value, context)
        : value;
  }
  return Object.freeze(captured);
}

function captureDenseFilterArray(
  value: unknown,
  context: FilterSanitizationContext,
): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (SANITIZED_FILTER_SNAPSHOTS.has(value) && Array.isArray(value)) return value;
  const existing = context.capturedArrays.get(value);
  if (existing !== undefined || context.capturedArrays.has(value)) return existing;
  const captured = snapshotDenseArray(value);
  const snapshot = captured === undefined ? undefined : Object.freeze(captured);
  if (snapshot !== undefined) SANITIZED_FILTER_SNAPSHOTS.add(snapshot);
  context.capturedArrays.set(value, snapshot);
  return snapshot;
}

function memoizeSanitizedFilter(
  candidate: object,
  depth: number,
  sanitized: SanitizedFilterNode | undefined,
  context: FilterSanitizationContext,
  completedAtDepth: Map<number, SanitizedFilterNode | undefined> | undefined,
): SanitizedFilterNode | undefined {
  const memo = completedAtDepth ?? new Map<number, SanitizedFilterNode | undefined>();
  memo.set(depth, sanitized);
  if (completedAtDepth === undefined) context.completed.set(candidate, memo);
  return sanitized;
}

function filterCaptureKeys(type: unknown): readonly string[] | undefined {
  if (type === "AND" || type === "OR") return ["conditions"];
  if (type === "NOT") return ["condition"];
  if (type === "blank" || type === "notBlank") return ["columnId"];
  if (type === "inRange") return ["columnId", "filter", "filterTo"];
  if (
    type === "in" ||
    type === "equals" ||
    type === "notEqual" ||
    type === "contains" ||
    type === "notContains" ||
    type === "startsWith" ||
    type === "endsWith"
  ) {
    return ["columnId", "filter", "caseSensitive", "accentSensitive"];
  }
  if (
    type === "greaterThan" ||
    type === "greaterThanOrEqual" ||
    type === "lessThan" ||
    type === "lessThanOrEqual"
  ) {
    return ["columnId", "filter"];
  }
  return undefined;
}

function sanitizeFilterRecord(
  filter: Readonly<Record<string, unknown>>,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
): SanitizedFilterNode | undefined {
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const candidates = readSanitizerOwnedArray(filter["conditions"]);
    if (candidates === undefined || candidates.length === 0) return undefined;
    const conditions: Readonly<Record<string, unknown>>[] = [];
    const columnIds = new Set<string>();
    for (const candidate of candidates) {
      const condition = sanitizeFilter(candidate, columnsById, context, depth + 1);
      if (condition === undefined) return undefined;
      conditions.push(condition.filter);
      for (const columnId of condition.columnIds) columnIds.add(columnId);
    }
    if (columnIds.size > 1) return undefined;
    const sanitizedConditions = snapshotSanitizedFilterArray(candidates, conditions);
    return {
      columnIds,
      filter: snapshotFilter(filter, ["type", "conditions"], {
        conditions: sanitizedConditions,
      }),
    };
  }
  if (type === "NOT") {
    const condition = sanitizeFilter(filter["condition"], columnsById, context, depth + 1);
    return condition === undefined
      ? undefined
      : {
          columnIds: condition.columnIds,
          filter: snapshotFilter(filter, ["type", "condition"], {
            condition: condition.filter,
          }),
        };
  }
  const columnId = filter["columnId"];
  if (typeof columnId !== "string") return undefined;
  const column = columnsById.get(columnId);
  if (column === undefined || column.enableFilter === false || column.kind !== "field") {
    return undefined;
  }
  const node = (sanitizedFilter: Readonly<Record<string, unknown>>): SanitizedFilterNode => ({
    columnIds: new Set([columnId]),
    filter: sanitizedFilter,
  });
  const operand = filter["filter"];
  const decode = (value: unknown) => column.semantics.decodeRuntime(value);
  if (type === "blank" || type === "notBlank") {
    return node(snapshotFilter(filter, ["columnId", "type"]));
  }
  if (type === "in") {
    const captured = readSanitizerOwnedArray(operand);
    if (
      captured === undefined ||
      !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text")
    ) {
      return undefined;
    }
    const decoded = captured.map(decode);
    const decodedValues = decoded.map((result) =>
      result._tag === "Success" ? result.value : undefined,
    );
    const sanitizedValues = snapshotSanitizedFilterArray(operand, decodedValues);
    return decoded.every((result) => result._tag === "Success")
      ? node(
          snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            { filter: sanitizedValues },
          ),
        )
      : undefined;
  }
  if (type === "inRange") {
    if (column.semantics.filterFamily !== "numeric") return undefined;
    const from = decode(operand);
    const to = decode(filter["filterTo"]);
    return from._tag === "Success" && to._tag === "Success"
      ? node(
          snapshotFilter(filter, ["columnId", "type", "filter", "filterTo"], {
            filter: from.value,
            filterTo: to.value,
          }),
        )
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
    return node(
      snapshotFilter(
        filter,
        type === "equals" || type === "notEqual"
          ? ["columnId", "type", "filter", "caseSensitive", "accentSensitive"]
          : ["columnId", "type", "filter"],
        { filter: result.value },
      ),
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
      ? node(
          snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            { filter: decoded._tag === "Success" ? decoded.value : undefined },
          ),
        )
      : undefined;
  }
  return undefined;
}

function readSanitizerOwnedArray(value: unknown): readonly unknown[] | undefined {
  return typeof value === "object" &&
    value !== null &&
    SANITIZED_FILTER_SNAPSHOTS.has(value) &&
    Array.isArray(value)
    ? value
    : undefined;
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
    SANITIZED_FILTER_SNAPSHOTS.has(filter) &&
    Reflect.ownKeys(filter).length === Reflect.ownKeys(snapshot).length &&
    Reflect.ownKeys(snapshot).every((key) =>
      Object.is(filter[key as string], snapshot[key as string]),
    )
  ) {
    return filter;
  }
  const frozen = Object.freeze(snapshot);
  SANITIZED_FILTER_SNAPSHOTS.add(frozen);
  return frozen;
}

function snapshotSanitizedFilterArray<T>(input: unknown, values: readonly T[]): readonly T[] {
  if (
    typeof input === "object" &&
    input !== null &&
    SANITIZED_FILTER_SNAPSHOTS.has(input) &&
    Array.isArray(input) &&
    sameReferences(input, values)
  ) {
    return input as readonly T[];
  }
  const snapshot = Object.freeze(Array.from(values));
  SANITIZED_FILTER_SNAPSHOTS.add(snapshot);
  return snapshot;
}

function sameReferences(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function evaluateFilter(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  if (completed === undefined) {
    return evaluateFilterRecord(candidate, row, columnsById, readValue, undefined);
  }
  const candidateObject =
    typeof candidate === "object" && candidate !== null ? candidate : undefined;
  if (candidateObject !== undefined && completed.has(candidateObject)) {
    return completed.get(candidateObject) ?? false;
  }
  const result = evaluateFilterRecord(candidate, row, columnsById, readValue, completed);
  if (candidateObject !== undefined) completed.set(candidateObject, result);
  return result;
}

function evaluateFilterRecord(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  const filter = asRecord(candidate);
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const conditions = Array.isArray(filter["conditions"]) ? filter["conditions"] : [];
    return type === "AND"
      ? conditions.every((condition) =>
          evaluateFilter(condition, row, columnsById, readValue, completed),
        )
      : conditions.some((condition) =>
          evaluateFilter(condition, row, columnsById, readValue, completed),
        );
  }
  if (type === "NOT") {
    return !evaluateFilter(filter["condition"], row, columnsById, readValue, completed);
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
  if (typeof operand !== "string") return filter["type"] === "notContains";
  if (typeof value !== "string") return filter["type"] === "notContains";
  const left = normalizeText(value, caseSensitive, accentSensitive);
  const right = normalizeText(operand, caseSensitive, accentSensitive);
  if (filter["type"] === "contains") return left.includes(right);
  if (filter["type"] === "notContains") return !left.includes(right);
  if (filter["type"] === "startsWith") return left.startsWith(right);
  if (filter["type"] === "endsWith") return left.endsWith(right);
  return false;
}

function containsSharedFilterNodes(filters: readonly unknown[]): boolean {
  const visited = new WeakSet<object>();
  const pending = Array.from(filters);
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate !== "object" || candidate === null) continue;
    if (visited.has(candidate)) return true;
    visited.add(candidate);
    const filter = asRecord(candidate);
    const conditions = filter["conditions"];
    if (Array.isArray(conditions)) {
      for (let index = 0; index < conditions.length; index += 1) {
        pending.push(conditions[index]);
      }
    }
    if (filter["condition"] !== undefined) pending.push(filter["condition"]);
  }
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

function snapshotDenseArray(values: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(values)) return undefined;
    const length = values.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const indexes = readOwnArrayIndexes(values, length);
    if (indexes === undefined || indexes.length !== length) return undefined;
    const snapshot: unknown[] = [];
    for (let position = 0; position < indexes.length; position += 1) {
      const index = indexes[position];
      if (index !== position) return undefined;
      snapshot.push(values[index]);
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function snapshotRootEntries(values: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(values)) return undefined;
    const length = values.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const indexes = readOwnArrayIndexes(values, length);
    if (indexes === undefined) return undefined;
    const snapshot: unknown[] = [];
    for (const index of indexes) {
      try {
        snapshot.push(values[index]);
      } catch {
        // Ignore only this unreadable external entry so valid siblings remain usable.
      }
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function readOwnArrayIndexes(
  values: readonly unknown[],
  length: number,
): readonly number[] | undefined {
  try {
    const indexes: number[] = [];
    for (const key of Reflect.ownKeys(values)) {
      if (typeof key !== "string" || key === "length") continue;
      const index = Number(key);
      if (Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key) {
        indexes.push(index);
      }
    }
    indexes.sort((left, right) => left - right);
    return indexes;
  } catch {
    return undefined;
  }
}

function isReadableEmptyArray(value: unknown): boolean {
  try {
    return Array.isArray(value) && value.length === 0;
  } catch {
    return false;
  }
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
const SANITIZED_FILTER_SNAPSHOTS = new WeakSet<object>();

type FilterSanitizationContext = {
  readonly captured: WeakMap<object, Readonly<Record<string, unknown>> | undefined>;
  readonly capturedArrays: WeakMap<object, readonly unknown[] | undefined>;
  readonly completed: WeakMap<object, Map<number, SanitizedFilterNode | undefined>>;
  readonly visited: WeakSet<object>;
};

type SanitizedFilterNode = {
  readonly columnIds: ReadonlySet<string>;
  readonly filter: Readonly<Record<string, unknown>>;
};
