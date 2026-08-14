import type { CompiledColumn } from "./compile-columns";
import { readCompiledColumnValue } from "./cell-value";
import type { BrunoTableRuntimeRecord } from "./runtime-value";

interface MutableRuntimeRecord {
  [key: PropertyKey]: BrunoTableRuntimeRecord[PropertyKey];
}

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

export function brunoTableFilterReferencesColumn(
  candidate: BrunoTableRuntimeRecord,
  columnId: string,
): boolean {
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
      const sort = isRuntimeRecord(candidate) ? candidate : {};
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
  options?: Readonly<{ readonly rejectOverBudget?: boolean }>,
): readonly unknown[] {
  const candidates = snapshotRootEntries(filters);
  if (candidates === undefined) return EMPTY_FILTERS;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const captured = new WeakMap<object, BrunoTableRuntimeRecord | undefined>();
  const capturedArrays = new WeakMap<object, CapturedFilterArray | undefined>();
  const sanitized: BrunoTableRuntimeRecord[] = [];
  for (const filter of candidates) {
    const context: FilterSanitizationContext = {
      captured,
      capturedArrays,
      completed: new WeakMap<object, Map<number, SanitizedFilterNode | undefined>>(),
      visited: new WeakSet<object>(),
      overBudget: false,
      remainingNodes: CLIENT_FILTER_MAX_NODES,
    };
    const next = isRuntimeRecord(filter)
      ? sanitizeFilter(filter, columnsById, context, 0)
      : undefined;
    if (context.overBudget && options?.rejectOverBudget === true) {
      throw new TypeError(
        `BrunoTable initialFilters expressions may contain at most ${CLIENT_FILTER_MAX_NODES} nodes, nesting depth ${CLIENT_FILTER_MAX_DEPTH}, and ${CLIENT_FILTER_MAX_OPERANDS} values per in operand.`,
      );
    }
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
  readValue: (
    column: CompiledColumn,
    row: TRow,
  ) => BrunoTableRuntimeRecord[PropertyKey] = readCompiledColumnValue,
): ((row: TRow) => boolean) | undefined {
  if (filters === undefined || filters.length === 0) return undefined;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const hasSharedNodes = containsSharedFilterNodes(filters);
  return (row) => {
    const completed = hasSharedNodes ? new WeakMap<object, boolean>() : undefined;
    return filters.every(
      (filter) =>
        isRuntimeRecord(filter) && evaluateFilter(filter, row, columnsById, readValue, completed),
    );
  };
}

export function filterReferencesColumn(
  candidate: BrunoTableRuntimeRecord,
  columnId: string,
): boolean {
  const columnIds = new Set<string>();
  collectClientFilterColumnIds(candidate, columnIds);
  return columnIds.has(columnId);
}

export function collectClientFilterColumnIds(
  candidate: BrunoTableRuntimeRecord,
  target: Set<string>,
): void {
  collectFilterColumnIds(candidate, target, new WeakSet<object>());
}

function collectFilterColumnIds(
  candidate: BrunoTableRuntimeRecord,
  target: Set<string>,
  visited: WeakSet<object>,
): void {
  if (visited.has(candidate)) return;
  visited.add(candidate);
  const filter = candidate;
  if (typeof filter["columnId"] === "string") target.add(filter["columnId"]);
  if (Array.isArray(filter["conditions"])) {
    for (const condition of filter["conditions"]) {
      if (isRuntimeRecord(condition)) collectFilterColumnIds(condition, target, visited);
    }
  }
  if (isRuntimeRecord(filter["condition"])) {
    collectFilterColumnIds(filter["condition"], target, visited);
  }
}

function sanitizeFilter(
  candidate: BrunoTableRuntimeRecord,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
  precharged = false,
): SanitizedFilterNode | undefined {
  if (depth > CLIENT_FILTER_MAX_DEPTH) {
    context.overBudget = true;
    return undefined;
  }
  if (context.visited.has(candidate)) {
    return undefined;
  }
  if (!precharged) {
    if (context.remainingNodes === 0) {
      context.overBudget = true;
      return undefined;
    }
    context.remainingNodes -= 1;
  }
  const completedAtDepth = context.completed.get(candidate);
  if (completedAtDepth?.has(depth) === true) return completedAtDepth.get(depth);
  context.visited.add(candidate);
  let captured: BrunoTableRuntimeRecord | undefined;
  try {
    captured = context.captured.get(candidate);
    if (!context.captured.has(candidate)) {
      captured = captureFilterRecord(candidate);
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

function captureFilterRecord(filter: BrunoTableRuntimeRecord): BrunoTableRuntimeRecord | undefined {
  if (SANITIZED_FILTER_SNAPSHOTS.has(filter)) return filter;
  if (!Object.hasOwn(filter, "type")) return undefined;
  const type = filter["type"];
  const keys = filterCaptureKeys(type);
  if (keys === undefined) return undefined;
  const captured: MutableRuntimeRecord = { type };
  for (const key of keys) {
    if (!Object.hasOwn(filter, key)) continue;
    captured[key] = filter[key];
  }
  return Object.freeze(captured);
}

function captureDenseFilterArray(
  value: BrunoTableRuntimeRecord[PropertyKey],
  context: FilterSanitizationContext,
  reserveConditions: boolean,
): readonly BrunoTableRuntimeRecord[PropertyKey][] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (SANITIZED_FILTER_SNAPSHOTS.has(value) && Array.isArray(value)) {
    return admitFilterArrayLength(value.length, context, reserveConditions) ? value : undefined;
  }
  let captured = context.capturedArrays.get(value);
  if (!context.capturedArrays.has(value)) {
    captured = captureFilterArrayLength(value);
    context.capturedArrays.set(value, captured);
  }
  if (captured === undefined) return undefined;
  if (!admitFilterArrayLength(captured.length, context, reserveConditions)) return undefined;
  if (!captured.attempted) {
    captured.attempted = true;
    const snapshot = snapshotDenseArray(value, captured.length);
    captured.snapshot = snapshot === undefined ? undefined : Object.freeze(snapshot);
    if (captured.snapshot !== undefined) SANITIZED_FILTER_SNAPSHOTS.add(captured.snapshot);
  }
  return captured.snapshot;
}

function admitFilterArrayLength(
  length: number,
  context: FilterSanitizationContext,
  reserveConditions: boolean,
): boolean {
  if (reserveConditions) return reserveConditionEntries(length, context);
  if (length <= CLIENT_FILTER_MAX_OPERANDS) return true;
  context.overBudget = true;
  return false;
}

function captureFilterArrayLength(
  value: BrunoTableRuntimeRecord[PropertyKey],
): CapturedFilterArray | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = value.length;
    return Number.isSafeInteger(length) && length >= 0
      ? { attempted: false, length, snapshot: undefined }
      : undefined;
  } catch {
    return undefined;
  }
}

function reserveConditionEntries(length: number, context: FilterSanitizationContext): boolean {
  if (length > context.remainingNodes) {
    context.overBudget = true;
    return false;
  }
  context.remainingNodes -= length;
  return true;
}

function memoizeSanitizedFilter(
  candidate: BrunoTableRuntimeRecord,
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

function filterCaptureKeys(
  type: BrunoTableRuntimeRecord[PropertyKey],
): readonly string[] | undefined {
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
  filter: BrunoTableRuntimeRecord,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  context: FilterSanitizationContext,
  depth: number,
): SanitizedFilterNode | undefined {
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const candidates = captureDenseFilterArray(filter["conditions"], context, true);
    if (candidates === undefined || candidates.length === 0) return undefined;
    const conditions: BrunoTableRuntimeRecord[] = [];
    const columnIds = new Set<string>();
    for (const candidate of candidates) {
      const condition = isRuntimeRecord(candidate)
        ? sanitizeFilter(candidate, columnsById, context, depth + 1, true)
        : undefined;
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
    const condition = isRuntimeRecord(filter["condition"])
      ? sanitizeFilter(filter["condition"], columnsById, context, depth + 1)
      : undefined;
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
  const node = (sanitizedFilter: BrunoTableRuntimeRecord): SanitizedFilterNode => ({
    columnIds: new Set([columnId]),
    filter: sanitizedFilter,
  });
  const operand = filter["filter"];
  const decode = (value: BrunoTableRuntimeRecord[PropertyKey]) =>
    column.semantics.decodeRuntime(value);
  if (type === "blank" || type === "notBlank") {
    return node(snapshotFilter(filter, ["columnId", "type"]));
  }
  if (type === "in") {
    const captured = captureDenseFilterArray(operand, context, false);
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
    const textOperand = typeof operand === "string" ? operand : undefined;
    return column.semantics.filterFamily === "text" && textOperand !== undefined && validSensitivity
      ? node(
          snapshotFilter(
            filter,
            ["columnId", "type", "filter", "caseSensitive", "accentSensitive"],
            { filter: textOperand },
          ),
        )
      : undefined;
  }
  return undefined;
}

function snapshotFilter(
  filter: BrunoTableRuntimeRecord,
  keys: readonly string[],
  replacements: BrunoTableRuntimeRecord = {},
): BrunoTableRuntimeRecord {
  const snapshot: MutableRuntimeRecord = {};
  for (const key of keys) {
    if (Object.hasOwn(replacements, key)) snapshot[key] = replacements[key];
    else if (Object.hasOwn(filter, key)) snapshot[key] = filter[key];
  }
  if (
    SANITIZED_FILTER_SNAPSHOTS.has(filter) &&
    Reflect.ownKeys(filter).length === Reflect.ownKeys(snapshot).length &&
    Reflect.ownKeys(snapshot).every((key) => Object.is(filter[key], snapshot[key]))
  ) {
    return filter;
  }
  const frozen = Object.freeze(snapshot);
  SANITIZED_FILTER_SNAPSHOTS.add(frozen);
  return frozen;
}

function snapshotSanitizedFilterArray<T>(
  input: BrunoTableRuntimeRecord[PropertyKey],
  values: readonly T[],
): readonly T[] {
  if (
    typeof input === "object" &&
    input !== null &&
    SANITIZED_FILTER_SNAPSHOTS.has(input) &&
    Array.isArray(input) &&
    sameReferences(input, values)
  ) {
    // SAFETY: The identity and every element reference were checked against `values` above;
    // returning the same array therefore preserves the caller's element type exactly.
    return input as readonly T[];
  }
  const snapshot = Object.freeze(Array.from(values));
  SANITIZED_FILTER_SNAPSHOTS.add(snapshot);
  return snapshot;
}

function sameReferences(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function evaluateFilter<TRow>(
  candidate: BrunoTableRuntimeRecord,
  row: TRow,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: TRow) => BrunoTableRuntimeRecord[PropertyKey],
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  if (completed === undefined) {
    return evaluateFilterRecord(candidate, row, columnsById, readValue, undefined);
  }
  if (completed.has(candidate)) {
    return completed.get(candidate) ?? false;
  }
  const result = evaluateFilterRecord(candidate, row, columnsById, readValue, completed);
  completed.set(candidate, result);
  return result;
}

function evaluateFilterRecord<TRow>(
  candidate: BrunoTableRuntimeRecord,
  row: TRow,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: TRow) => BrunoTableRuntimeRecord[PropertyKey],
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  const filter = candidate;
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const conditions = Array.isArray(filter["conditions"]) ? filter["conditions"] : [];
    return type === "AND"
      ? conditions.every(
          (condition) =>
            isRuntimeRecord(condition) &&
            evaluateFilter(condition, row, columnsById, readValue, completed),
        )
      : conditions.some(
          (condition) =>
            isRuntimeRecord(condition) &&
            evaluateFilter(condition, row, columnsById, readValue, completed),
        );
  }
  if (type === "NOT") {
    return !(
      isRuntimeRecord(filter["condition"]) &&
      evaluateFilter(filter["condition"], row, columnsById, readValue, completed)
    );
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
  if (value === null || value === undefined) return filter["type"] === "notContains";
  const left = normalizeText(
    column.semantics.formatCanonicalText(value),
    caseSensitive,
    accentSensitive,
  );
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
    const filter = isRuntimeRecord(candidate) ? candidate : {};
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
  value: BrunoTableRuntimeRecord[PropertyKey],
  operand: BrunoTableRuntimeRecord[PropertyKey],
  caseSensitive: boolean,
  accentSensitive: boolean,
): boolean {
  if (value === null || value === undefined || operand === null || operand === undefined) {
    return value === operand;
  }
  if (column.semantics.filterFamily === "text") {
    return (
      normalizeText(column.semantics.formatCanonicalText(value), caseSensitive, accentSensitive) ===
      normalizeText(column.semantics.formatCanonicalText(operand), caseSensitive, accentSensitive)
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

function hasValidTextSensitivity(filter: BrunoTableRuntimeRecord, supported: boolean): boolean {
  return ["caseSensitive", "accentSensitive"].every(
    (key) => !Object.hasOwn(filter, key) || (supported && typeof filter[key] === "boolean"),
  );
}

function snapshotDenseArray(
  values: BrunoTableRuntimeRecord[PropertyKey],
  length: number,
): readonly BrunoTableRuntimeRecord[PropertyKey][] | undefined {
  try {
    if (!Array.isArray(values)) return undefined;
    const snapshot: BrunoTableRuntimeRecord[PropertyKey][] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(values, index)) return undefined;
      snapshot.push(values[index]);
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function snapshotRootEntries(
  values: BrunoTableRuntimeRecord[PropertyKey] | undefined,
): readonly BrunoTableRuntimeRecord[PropertyKey][] | undefined {
  try {
    if (!Array.isArray(values)) return undefined;
    const length = values.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const indexes = readOwnArrayIndexes(values, length);
    if (indexes === undefined) return undefined;
    const snapshot: BrunoTableRuntimeRecord[PropertyKey][] = [];
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

function isReadableEmptyArray(value: BrunoTableRuntimeRecord[PropertyKey]): boolean {
  try {
    return Array.isArray(value) && value.length === 0;
  } catch {
    return false;
  }
}

function hasSortableColumns(columns: readonly CompiledColumn[]): boolean {
  return columns.some((column) => column.enableSorting !== false);
}

function isRuntimeRecord(value: unknown): value is BrunoTableRuntimeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EMPTY_FILTERS: readonly never[] = Object.freeze([]);
const EMPTY_ORDER_BY: ClientOrderBy = Object.freeze([]);
const CLIENT_FILTER_MAX_DEPTH = 64;
const CLIENT_FILTER_MAX_NODES = 1_024;
const CLIENT_FILTER_MAX_OPERANDS = 4_096;
const SANITIZED_FILTER_SNAPSHOTS = new WeakSet<object>();

type FilterSanitizationContext = {
  readonly captured: WeakMap<object, BrunoTableRuntimeRecord | undefined>;
  readonly capturedArrays: WeakMap<object, CapturedFilterArray | undefined>;
  readonly completed: WeakMap<object, Map<number, SanitizedFilterNode | undefined>>;
  readonly visited: WeakSet<object>;
  overBudget: boolean;
  remainingNodes: number;
};

type CapturedFilterArray = {
  attempted: boolean;
  readonly length: number;
  snapshot: readonly BrunoTableRuntimeRecord[PropertyKey][] | undefined;
};

type SanitizedFilterNode = {
  readonly columnIds: ReadonlySet<string>;
  readonly filter: BrunoTableRuntimeRecord;
};
