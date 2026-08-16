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
        ? "BrunoTable initialOrderBy is required."
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
  if (candidates === undefined || candidates === ROOT_ENTRIES_OVER_BUDGET) {
    return EMPTY_ORDER_BY;
  }
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
  options?: Readonly<{ readonly rejectOverBudget?: boolean }>,
): readonly unknown[] {
  const candidates = snapshotRootEntries(filters);
  if (candidates === ROOT_ENTRIES_OVER_BUDGET) {
    if (options?.rejectOverBudget === true) {
      throw new TypeError(
        `BrunoTable initialFilters root contains more than ${BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES} entries.`,
      );
    }
    return EMPTY_FILTERS;
  }
  if (candidates === undefined) return EMPTY_FILTERS;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const captured = new WeakMap<object, Readonly<Record<string, unknown>> | undefined>();
  const capturedArrays = new WeakMap<object, CapturedFilterArray | undefined>();
  const sanitized: Readonly<Record<string, unknown>>[] = [];
  for (const filter of candidates) {
    const context: FilterSanitizationContext = {
      captured,
      capturedArrays,
      completed: new WeakMap<object, Map<number, SanitizedFilterNode | undefined>>(),
      visited: new WeakSet<object>(),
      overBudget: false,
      remainingNodes: BRUNO_TABLE_CLIENT_FILTER_MAX_NODES,
    };
    const next = sanitizeFilter(filter, columnsById, context, 0);
    if (context.overBudget && options?.rejectOverBudget === true) {
      throw new TypeError(
        `BrunoTable initialFilters expressions may contain at most ${BRUNO_TABLE_CLIENT_FILTER_MAX_NODES} nodes, nesting depth ${BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH}, and ${BRUNO_TABLE_CLIENT_FILTER_MAX_OPERANDS} values per in operand.`,
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

export type ClientFilterPlan = Readonly<{
  readonly filters: readonly unknown[];
  readonly columnsById: ReadonlyMap<string, CompiledColumn>;
  readonly compiledOperands: Readonly<WeakMap<object, CompiledFilterOperandPlan>>;
  readonly hasSharedNodes: boolean;
}>;

/**
 * Compiles immutable filter evidence once for the query consumers that use different row
 * adapters. The plan deliberately contains no row reader, so it can be shared by TanStack's
 * row model and the source row-order detector without crossing either adapter seam.
 */
export function compileClientFilterPlan(
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
): ClientFilterPlan | undefined {
  // Keep the plan's filter snapshot beside its compiled operands so every predicate entry point
  // evaluates bounded, immutable evidence, including direct internal callers that skip the row
  // pipeline's normal query snapshot path.
  const sanitizedFilters = sanitizeClientInitialFilters(filters, columns);
  if (sanitizedFilters.length === 0) return undefined;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  return Object.freeze({
    filters: sanitizedFilters,
    columnsById,
    compiledOperands: compileFilterOperandPlans(sanitizedFilters, columnsById),
    hasSharedNodes: containsSharedFilterNodes(sanitizedFilters),
  });
}

export function createClientFilterPredicate<TRow>(
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  readValue: (column: CompiledColumn, row: TRow) => unknown = readCompiledColumnValue,
  filterPlan?: ClientFilterPlan,
): ((row: TRow) => boolean) | undefined {
  const plan = filterPlan ?? compileClientFilterPlan(columns, filters);
  if (plan === undefined) return undefined;
  const columnsById = plan.columnsById;
  const readUnknown = (column: CompiledColumn, row: unknown) => readValue(column, row as TRow);
  return (row) => {
    const completed = plan.hasSharedNodes ? new WeakMap<object, boolean>() : undefined;
    return plan.filters.every((filter) =>
      evaluateFilter(filter, row, columnsById, readUnknown, plan.compiledOperands, completed),
    );
  };
}

export function normalizeBrunoTableFilterText(
  value: string,
  caseSensitive = false,
  accentSensitive = false,
): string {
  const withoutAccents = accentSensitive
    ? value.normalize("NFC")
    : value.normalize("NFD").replace(/\p{Mark}/gu, "");
  return caseSensitive ? withoutAccents : withoutAccents.toLowerCase();
}

export const BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH = 1_024;
const BRUNO_TABLE_MAX_FILTER_OPERAND_OBJECTS = 64;
const BRUNO_TABLE_MAX_FILTER_OPERAND_PROPERTIES = 256;
const BRUNO_TABLE_MAX_FILTER_OPERAND_DEPTH = 16;

export function boundBrunoTableFilterOperandText(text: string): string {
  return text.length <= BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH
    ? text
    : text.slice(0, BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH);
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
  precharged = false,
): SanitizedFilterNode | undefined {
  if (depth > BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH) {
    context.overBudget = true;
    return undefined;
  }
  if (typeof candidate !== "object" || candidate === null || context.visited.has(candidate)) {
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
  let captured: Readonly<Record<string, unknown>> | undefined;
  try {
    captured = context.captured.get(candidate);
    if (!context.captured.has(candidate)) {
      captured = captureFilterRecord(asRecord(candidate));
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
): Readonly<Record<string, unknown>> | undefined {
  if (SANITIZED_FILTER_SNAPSHOTS.has(filter)) return filter;
  if (!Object.hasOwn(filter, "type")) return undefined;
  const type = filter["type"];
  const keys = filterCaptureKeys(type);
  if (keys === undefined) return undefined;
  const captured: Record<string, unknown> = { type };
  for (const key of keys) {
    if (!Object.hasOwn(filter, key)) continue;
    captured[key] = filter[key];
  }
  return Object.freeze(captured);
}

function captureDenseFilterArray(
  value: unknown,
  context: FilterSanitizationContext,
  reserveConditions: boolean,
): readonly unknown[] | undefined {
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
  if (length <= BRUNO_TABLE_CLIENT_FILTER_MAX_OPERANDS) return true;
  context.overBudget = true;
  return false;
}

function captureFilterArrayLength(value: object): CapturedFilterArray | undefined {
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
    const candidates = captureDenseFilterArray(filter["conditions"], context, true);
    if (candidates === undefined || candidates.length === 0) return undefined;
    const conditions: Readonly<Record<string, unknown>>[] = [];
    const columnIds = new Set<string>();
    for (const candidate of candidates) {
      const condition = sanitizeFilter(candidate, columnsById, context, depth + 1, true);
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
  const decode = (value: unknown) => {
    try {
      return column.semantics.decodeRuntime(value);
    } catch {
      return { _tag: "Failure" as const, message: "Value decoding failed." };
    }
  };
  if (type === "blank" || type === "notBlank") {
    return node(snapshotFilter(filter, ["columnId", "type"]));
  }
  if (type === "in") {
    // Boolean and Select filters intentionally remain exact equality surfaces
    // until issue #13 owns Set Filter inclusion semantics and its live facets.
    if (column.semantics.filterFamily === "boolean" || column.semantics.filterFamily === "select") {
      return undefined;
    }
    const captured = captureDenseFilterArray(operand, context, false);
    if (
      captured === undefined ||
      captured.length === 0 ||
      !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text")
    ) {
      return undefined;
    }
    if (!captured.every((value) => isBoundedFilterOperand(value, context))) return undefined;
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
    if (
      !isBoundedFilterOperand(operand, context) ||
      !isBoundedFilterOperand(filter["filterTo"], context)
    ) {
      return undefined;
    }
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
    let configuredSelectValue: unknown;
    let isConfiguredSelectValue = false;
    if (column.semantics.filterFamily === "select") {
      const selectOptions = column.selectOptions;
      if (selectOptions === undefined) return undefined;
      const exactOptionIndex = selectOptions.findIndex((option) => Object.is(option, operand));
      if (exactOptionIndex !== -1) {
        configuredSelectValue = selectOptions[exactOptionIndex];
        isConfiguredSelectValue = true;
      } else if (!isBoundedFilterOperand(operand, context)) {
        return undefined;
      } else {
        for (const option of selectOptions) {
          try {
            if (!column.semantics.equivalent(option, operand)) continue;
            configuredSelectValue = option;
            isConfiguredSelectValue = true;
            break;
          } catch {
            // Ignore an unreadable or invalid external operand and continue checking
            // the remaining bounded configured options.
          }
        }
      }
      if (!isConfiguredSelectValue) return undefined;
    }
    if (!isConfiguredSelectValue && !isBoundedFilterOperand(operand, context)) return undefined;
    // Compiled Select options are already canonical. Reuse the admitted option
    // so a long trusted option never re-enters a consumer decoder.
    const result = isConfiguredSelectValue
      ? ({ _tag: "Success", value: configuredSelectValue } as const)
      : decode(operand);
    if (result._tag !== "Success") return undefined;
    if (
      (type === "equals" || type === "notEqual") &&
      !hasValidTextSensitivity(filter, column.semantics.filterFamily === "text")
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
    return column.semantics.filterFamily === "text" &&
      textOperand !== undefined &&
      isBoundedFilterOperand(textOperand, context) &&
      validSensitivity
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

type CompiledFilterOperandPlan = Readonly<{
  readonly normalizedOperand?: string | undefined;
  readonly normalizedOperands?: readonly (string | undefined)[] | undefined;
  readonly membershipKeys?: ReadonlySet<string> | undefined;
  readonly normalizedSubstringOperand?: string | undefined;
}>;

function compileFilterOperandPlans(
  filters: readonly unknown[],
  columnsById: ReadonlyMap<string, CompiledColumn>,
): WeakMap<object, CompiledFilterOperandPlan> {
  const plans = new WeakMap<object, CompiledFilterOperandPlan>();
  const pending = Array.from(filters);
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate !== "object" || candidate === null || visited.has(candidate)) continue;
    visited.add(candidate);
    const filter = asRecord(candidate);
    const type = filter["type"];
    const columnId = filter["columnId"];
    const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
    const caseSensitive = filter["caseSensitive"] === true;
    const accentSensitive = filter["accentSensitive"] === true;
    const operand = filter["filter"];
    if (column?.semantics.filterFamily === "text") {
      if ((type === "equals" || type === "notEqual") && operand !== undefined) {
        plans.set(candidate, {
          normalizedOperand: normalizeCanonicalTextOperand(
            column,
            operand,
            caseSensitive,
            accentSensitive,
          ),
        });
      } else if (type === "in" && Array.isArray(operand)) {
        const normalizedOperands = operand.map((item) =>
          normalizeCanonicalTextOperand(column, item, caseSensitive, accentSensitive),
        );
        const membershipKeys = compileFilterMembershipKeys(column, operand, normalizedOperands);
        plans.set(candidate, {
          normalizedOperands: Object.freeze(normalizedOperands),
          ...(membershipKeys === undefined ? {} : { membershipKeys }),
        });
      } else if (
        (type === "contains" ||
          type === "notContains" ||
          type === "startsWith" ||
          type === "endsWith") &&
        typeof operand === "string"
      ) {
        plans.set(candidate, {
          normalizedSubstringOperand: normalizeBrunoTableFilterText(
            operand,
            caseSensitive,
            accentSensitive,
          ),
        });
      }
    } else if (column !== undefined && type === "in" && Array.isArray(operand)) {
      const membershipKeys = compileFilterMembershipKeys(column, operand, []);
      if (membershipKeys !== undefined) plans.set(candidate, { membershipKeys });
    }
    const conditions = filter["conditions"];
    if (Array.isArray(conditions)) {
      for (const condition of conditions) pending.push(condition);
    }
    if (filter["condition"] !== undefined) pending.push(filter["condition"]);
  }
  return plans;
}

function normalizeCanonicalTextOperand(
  column: CompiledColumn,
  operand: unknown,
  caseSensitive: boolean,
  accentSensitive: boolean,
): string | undefined {
  try {
    return normalizeBrunoTableFilterText(
      column.semantics.formatCanonicalText(operand),
      caseSensitive,
      accentSensitive,
    );
  } catch {
    return undefined;
  }
}

function compileFilterMembershipKeys(
  column: CompiledColumn,
  operands: readonly unknown[],
  normalizedOperands: readonly (string | undefined)[],
): ReadonlySet<string> | undefined {
  const keys = new Set<string>();
  for (let index = 0; index < operands.length; index += 1) {
    const key = filterMembershipKey(column, operands[index], normalizedOperands[index]);
    if (key === undefined) return undefined;
    keys.add(key);
  }
  return keys;
}

function filterMembershipKey(
  column: CompiledColumn,
  value: unknown,
  normalizedText?: string,
): string | undefined {
  if (column.semantics.filterFamily === "text") {
    return normalizedText === undefined ? undefined : `text:${normalizedText}`;
  }
  if (column.valueType === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? `number:${String(value)}`
      : undefined;
  }
  if (column.valueType === "bigint") {
    return typeof value === "bigint" ? `bigint:${value.toString(10)}` : undefined;
  }
  return undefined;
}

function evaluateFilter(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
  compiledOperands: Readonly<WeakMap<object, CompiledFilterOperandPlan>>,
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  if (completed === undefined) {
    return evaluateFilterRecord(
      candidate,
      row,
      columnsById,
      readValue,
      compiledOperands,
      undefined,
    );
  }
  const candidateObject =
    typeof candidate === "object" && candidate !== null ? candidate : undefined;
  if (candidateObject !== undefined && completed.has(candidateObject)) {
    return completed.get(candidateObject) ?? false;
  }
  const result = evaluateFilterRecord(
    candidate,
    row,
    columnsById,
    readValue,
    compiledOperands,
    completed,
  );
  if (candidateObject !== undefined) completed.set(candidateObject, result);
  return result;
}

function evaluateFilterRecord(
  candidate: unknown,
  row: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  readValue: (column: CompiledColumn, row: unknown) => unknown,
  compiledOperands: Readonly<WeakMap<object, CompiledFilterOperandPlan>>,
  completed: WeakMap<object, boolean> | undefined,
): boolean {
  const filter = asRecord(candidate);
  const type = filter["type"];
  if (type === "AND" || type === "OR") {
    const conditions = Array.isArray(filter["conditions"]) ? filter["conditions"] : [];
    return type === "AND"
      ? conditions.every((condition) =>
          evaluateFilter(condition, row, columnsById, readValue, compiledOperands, completed),
        )
      : conditions.some((condition) =>
          evaluateFilter(condition, row, columnsById, readValue, compiledOperands, completed),
        );
  }
  if (type === "NOT") {
    return !evaluateFilter(
      filter["condition"],
      row,
      columnsById,
      readValue,
      compiledOperands,
      completed,
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
  const plan =
    typeof candidate === "object" && candidate !== null
      ? compiledOperands.get(candidate)
      : undefined;
  if (filter["type"] === "blank") return value === null || value === undefined || value === "";
  if (filter["type"] === "notBlank") return value !== null && value !== undefined && value !== "";
  if (filter["type"] === "equals") {
    return compareEquality(
      column,
      value,
      operand,
      caseSensitive,
      accentSensitive,
      plan?.normalizedOperand,
    );
  }
  if (filter["type"] === "notEqual") {
    return !compareEquality(
      column,
      value,
      operand,
      caseSensitive,
      accentSensitive,
      plan?.normalizedOperand,
    );
  }
  if (filter["type"] === "in") {
    if (plan?.membershipKeys !== undefined) {
      const key = filterMembershipKey(
        column,
        value,
        column.semantics.filterFamily === "text"
          ? normalizeCanonicalTextOperand(column, value, caseSensitive, accentSensitive)
          : undefined,
      );
      if (key !== undefined) return plan.membershipKeys.has(key);
    }
    return (
      Array.isArray(operand) &&
      operand.some((item, index) =>
        compareEquality(
          column,
          value,
          item,
          caseSensitive,
          accentSensitive,
          plan?.normalizedOperands?.[index],
        ),
      )
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
  const left = normalizeBrunoTableFilterText(
    column.semantics.formatCanonicalText(value),
    caseSensitive,
    accentSensitive,
  );
  const right =
    plan?.normalizedSubstringOperand ??
    normalizeBrunoTableFilterText(operand, caseSensitive, accentSensitive);
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
  normalizedOperand?: string,
): boolean {
  if (value === null || value === undefined || operand === null || operand === undefined) {
    return value === operand;
  }
  if (column.semantics.filterFamily === "text") {
    return (
      normalizeBrunoTableFilterText(
        column.semantics.formatCanonicalText(value),
        caseSensitive,
        accentSensitive,
      ) ===
      (normalizedOperand ??
        normalizeBrunoTableFilterText(
          column.semantics.formatCanonicalText(operand),
          caseSensitive,
          accentSensitive,
        ))
    );
  }
  return column.semantics.equivalent(value, operand);
}

/**
 * Compares filter state using the same compiled Column Value Semantics as row evaluation.
 * Runtime query publication uses this seam so semantic equality cannot drift from predicates.
 */
export function sameBrunoTableFilterCollection(
  previous: readonly unknown[],
  next: readonly unknown[],
  columnsById: ReadonlyMap<string, CompiledColumn>,
  unordered = true,
): boolean {
  if (previous.length !== next.length) return false;
  if (
    previous.every((value, index) => sameBrunoTableFilterValue(value, next[index], columnsById))
  ) {
    return true;
  }
  if (!unordered) return false;
  // The root budget admits more than the per-expression comparison budget. Compare the
  // canonical semantic multiset directly so a valid large root is not mistaken for a change.
  const nextCounts = new Map<string, number>();
  const nextKeys = next.map((value) => filterValueComparisonKey(value, columnsById));
  if (nextKeys.every((key): key is string => key !== undefined)) {
    for (const key of nextKeys) nextCounts.set(key, (nextCounts.get(key) ?? 0) + 1);
    for (const value of previous) {
      const key = filterValueComparisonKey(value, columnsById);
      if (key === undefined) break;
      const count = nextCounts.get(key) ?? 0;
      if (count === 0) break;
      if (count === 1) nextCounts.delete(key);
      else nextCounts.set(key, count - 1);
    }
    if (nextCounts.size === 0) return true;
  }
  // Custom Value Semantics may not have a built-in comparison key. Keep the conservative
  // semantic fallback bounded instead of allowing a maximum-size root to trigger O(n²)
  // equivalent() calls. A false result publishes a fresh query, which is safer than blocking
  // the interaction frame on an equality proof the runtime cannot make cheaply.
  let remainingComparisons = BRUNO_TABLE_CLIENT_FILTER_COMPARISON_BUDGET;
  const matched = new Set<number>();
  return previous.every((value) => {
    for (let index = 0; index < next.length; index += 1) {
      if (matched.has(index)) continue;
      remainingComparisons -= 1;
      if (remainingComparisons < 0) return false;
      if (!sameBrunoTableFilterValue(value, next[index], columnsById)) continue;
      matched.add(index);
      return true;
    }
    return false;
  });
}

const BRUNO_TABLE_CLIENT_FILTER_COMPARISON_BUDGET = 4_096;

function filterValueComparisonKey(
  value: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  seen: WeakMap<object, string | undefined> = new WeakMap(),
): string | undefined {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "number")
    return Number.isFinite(value) ? `number:${String(value)}` : undefined;
  if (typeof value === "bigint") return `bigint:${value.toString(10)}`;
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (typeof value !== "object") return undefined;
  const existing = seen.get(value);
  if (existing !== undefined || seen.has(value)) return existing;
  seen.set(value, undefined);
  if (Array.isArray(value)) {
    const keys = value.map((item) => filterValueComparisonKey(item, columnsById, seen));
    if (keys.some((key) => key === undefined)) return undefined;
    const result = `array:${JSON.stringify(keys)}`;
    seen.set(value, result);
    return result;
  }
  if (!isPlainFilterRecord(value)) return undefined;
  const record = value as Readonly<Record<PropertyKey, unknown>>;
  const columnId = record["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  const type = typeof record["type"] === "string" ? record["type"] : undefined;
  const keys = Reflect.ownKeys(record)
    .filter((key) => !isImplicitFalseTextSensitivity(record, key))
    .sort((left, right) => {
      const leftText = String(left);
      const rightText = String(right);
      return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
    });
  const parts: Array<readonly [string, string]> = [];
  for (const key of keys) {
    const child = record[key];
    if ((key === "filter" || key === "filterTo") && column !== undefined) {
      if (key === "filter" && type === "in" && Array.isArray(child)) {
        const operands = child.map((operand) =>
          filterOperandComparisonKey(operand, column, {
            accentSensitive: record["accentSensitive"] === true,
            caseSensitive: record["caseSensitive"] === true,
            raw: false,
            text: column.semantics.filterFamily === "text",
            unordered: true,
          }),
        );
        if (operands.some((operand) => operand === undefined)) return undefined;
        parts.push([
          String(key),
          JSON.stringify([...new Set(operands as string[])].sort(compareStringValues)),
        ]);
      } else {
        const operand = filterOperandComparisonKey(child, column, {
          accentSensitive: record["accentSensitive"] === true,
          caseSensitive: record["caseSensitive"] === true,
          raw:
            type === "contains" ||
            type === "notContains" ||
            type === "startsWith" ||
            type === "endsWith",
          text:
            column.semantics.filterFamily === "text" &&
            (type === "equals" ||
              type === "notEqual" ||
              type === "in" ||
              type === "contains" ||
              type === "notContains" ||
              type === "startsWith" ||
              type === "endsWith"),
          unordered: false,
        });
        if (operand === undefined) return undefined;
        parts.push([String(key), operand]);
      }
      continue;
    }
    if (key === "conditions" && (type === "AND" || type === "OR") && Array.isArray(child)) {
      const conditions = child.map((condition) =>
        filterValueComparisonKey(condition, columnsById, seen),
      );
      if (conditions.some((condition) => condition === undefined)) return undefined;
      parts.push([String(key), JSON.stringify((conditions as string[]).sort(compareStringValues))]);
      continue;
    }
    const childKey = filterValueComparisonKey(child, columnsById, seen);
    if (childKey === undefined) return undefined;
    parts.push([String(key), childKey]);
  }
  const result = `record:${JSON.stringify(parts)}`;
  seen.set(value, result);
  return result;
}

function compareStringValues(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sameBrunoTableFilterValue(
  previous: unknown,
  next: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  column?: CompiledColumn,
  seen: WeakMap<object, object> = new WeakMap(),
): boolean {
  try {
    if (Object.is(previous, next)) return true;
    if (Array.isArray(previous) && Array.isArray(next)) {
      return (
        previous.length === next.length &&
        previous.every((value, index) =>
          sameBrunoTableFilterValue(value, next[index], columnsById, column, seen),
        )
      );
    }
    if (
      typeof previous !== "object" ||
      previous === null ||
      typeof next !== "object" ||
      next === null
    ) {
      return false;
    }
    const previousRecord = previous as Readonly<Record<PropertyKey, unknown>>;
    const nextRecord = next as Readonly<Record<PropertyKey, unknown>>;
    const previousColumnId = previousRecord["columnId"];
    const nextColumnId = nextRecord["columnId"];
    const valueColumn =
      column ??
      (typeof previousColumnId === "string" && previousColumnId === nextColumnId
        ? columnsById.get(previousColumnId)
        : undefined);
    const remembered = seen.get(previous);
    if (remembered !== undefined) return remembered === next;
    seen.set(previous, next);
    if (Object.getPrototypeOf(previous) !== Object.getPrototypeOf(next)) return false;
    if (!isPlainFilterRecord(previous) || !isPlainFilterRecord(next)) return false;
    const previousKeys = Reflect.ownKeys(previous).filter(
      (key) => !isImplicitFalseTextSensitivity(previousRecord, key),
    );
    const nextKeys = Reflect.ownKeys(next).filter(
      (key) => !isImplicitFalseTextSensitivity(nextRecord, key),
    );
    if (previousKeys.length !== nextKeys.length) return false;
    const operator =
      previousRecord["type"] === nextRecord["type"] && typeof previousRecord["type"] === "string"
        ? previousRecord["type"]
        : undefined;
    const rawTextOperand =
      valueColumn?.semantics.filterFamily === "text" &&
      (operator === "contains" ||
        operator === "notContains" ||
        operator === "startsWith" ||
        operator === "endsWith");
    const textOperand =
      valueColumn?.semantics.filterFamily === "text" &&
      (operator === "equals" ||
        operator === "notEqual" ||
        operator === "in" ||
        operator === "contains" ||
        operator === "notContains" ||
        operator === "startsWith" ||
        operator === "endsWith");
    const operandOptions = {
      accentSensitive: previousRecord["accentSensitive"] === true,
      caseSensitive: previousRecord["caseSensitive"] === true,
      raw: rawTextOperand,
      text: textOperand,
    } as const;
    return previousKeys.every((key) => {
      if (!nextKeys.includes(key)) return false;
      const previousValue = previousRecord[key];
      const nextValue = nextRecord[key];
      if (
        key === "conditions" &&
        (operator === "AND" || operator === "OR") &&
        Array.isArray(previousValue) &&
        Array.isArray(nextValue)
      ) {
        return sameBrunoTableFilterCollection(previousValue, nextValue, columnsById, true);
      }
      if ((key === "filter" || key === "filterTo") && valueColumn !== undefined) {
        return sameFilterOperand(
          previousValue,
          nextValue,
          valueColumn,
          key === "filter" && operator === "in"
            ? { ...operandOptions, unordered: true }
            : { ...operandOptions, unordered: false },
        );
      }
      return sameBrunoTableFilterValue(previousValue, nextValue, columnsById, valueColumn, seen);
    });
  } catch {
    return false;
  }
}

function isImplicitFalseTextSensitivity(
  record: Readonly<Record<PropertyKey, unknown>>,
  key: PropertyKey,
): boolean {
  return (key === "caseSensitive" || key === "accentSensitive") && record[key] === false;
}

function sameFilterOperand(
  previous: unknown,
  next: unknown,
  column: CompiledColumn,
  options: Readonly<{
    readonly accentSensitive: boolean;
    readonly caseSensitive: boolean;
    readonly raw: boolean;
    readonly text: boolean;
    readonly unordered: boolean;
  }>,
): boolean {
  if (Object.is(previous, next)) return true;
  if (options.unordered && Array.isArray(previous) && Array.isArray(next)) {
    const previousKeys = previous.map((value) =>
      filterOperandComparisonKey(value, column, options),
    );
    const nextKeys = next.map((value) => filterOperandComparisonKey(value, column, options));
    if (
      previousKeys.every((key) => key !== undefined) &&
      nextKeys.every((key) => key !== undefined)
    ) {
      const nextSet = new Set(nextKeys as string[]);
      const previousSet = new Set(previousKeys as string[]);
      return previousSet.size === nextSet.size && [...previousSet].every((key) => nextSet.has(key));
    }
    let remainingComparisons = BRUNO_TABLE_CLIENT_FILTER_COMPARISON_BUDGET;
    const hasEveryMatch = (values: readonly unknown[], candidates: readonly unknown[]): boolean => {
      for (const value of values) {
        let matched = false;
        for (const candidate of candidates) {
          if (remainingComparisons <= 0) return false;
          remainingComparisons -= 1;
          if (sameFilterOperand(value, candidate, column, { ...options, unordered: false })) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    };
    return hasEveryMatch(previous, next) && hasEveryMatch(next, previous);
  }
  if (previous === null || next === null || previous === undefined || next === undefined) {
    return false;
  }
  if (options.raw) {
    if (typeof previous !== "string" || typeof next !== "string") return false;
    return (
      normalizeBrunoTableFilterText(previous, options.caseSensitive, options.accentSensitive) ===
      normalizeBrunoTableFilterText(next, options.caseSensitive, options.accentSensitive)
    );
  }
  if (options.text) {
    try {
      return (
        normalizeBrunoTableFilterText(
          column.semantics.formatCanonicalText(previous),
          options.caseSensitive,
          options.accentSensitive,
        ) ===
        normalizeBrunoTableFilterText(
          column.semantics.formatCanonicalText(next),
          options.caseSensitive,
          options.accentSensitive,
        )
      );
    } catch {
      return false;
    }
  }
  try {
    return column.semantics.equivalent(previous, next);
  } catch {
    return false;
  }
}

function filterOperandComparisonKey(
  value: unknown,
  column: CompiledColumn,
  options: Readonly<{
    readonly accentSensitive: boolean;
    readonly caseSensitive: boolean;
    readonly raw: boolean;
    readonly text: boolean;
    readonly unordered: boolean;
  }>,
): string | undefined {
  if (options.raw) {
    return typeof value === "string"
      ? `text:${normalizeBrunoTableFilterText(value, options.caseSensitive, options.accentSensitive)}`
      : undefined;
  }
  if (options.text) {
    try {
      return `text:${normalizeBrunoTableFilterText(
        column.semantics.formatCanonicalText(value),
        options.caseSensitive,
        options.accentSensitive,
      )}`;
    } catch {
      return undefined;
    }
  }
  switch (column.semantics.editorFamily) {
    case "number":
      if (column.valueType !== "number") return undefined;
      return typeof value === "number" ? `number:${String(value)}` : undefined;
    case "bigint":
      if (column.valueType !== "bigint") return undefined;
      return typeof value === "bigint" ? `bigint:${value.toString()}` : undefined;
    case "boolean":
      if (column.valueType !== "boolean") return undefined;
      return typeof value === "boolean" ? `boolean:${String(value)}` : undefined;
    default:
      return undefined;
  }
}

function isPlainFilterRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasValidTextSensitivity(
  filter: Readonly<Record<string, unknown>>,
  supported: boolean,
): boolean {
  return ["caseSensitive", "accentSensitive"].every(
    (key) => !Object.hasOwn(filter, key) || (supported && typeof filter[key] === "boolean"),
  );
}

function snapshotDenseArray(values: unknown, length: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(values)) return undefined;
    const snapshot: unknown[] = [];
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
  values: unknown,
): readonly unknown[] | undefined | typeof ROOT_ENTRIES_OVER_BUDGET {
  try {
    if (!Array.isArray(values)) return undefined;
    const length = values.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const indexes = readOwnArrayIndexes(values, length);
    if (indexes === undefined || indexes === ROOT_ENTRIES_OVER_BUDGET) return indexes;
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
): readonly number[] | undefined | typeof ROOT_ENTRIES_OVER_BUDGET {
  try {
    const indexes: number[] = [];
    const ownKeys = Reflect.ownKeys(values);
    // An Array always owns its non-data `length` key. Count every other own
    // key, including symbols and non-index properties, before inspecting any
    // indexed values so hostile metadata cannot bypass the root budget.
    if (ownKeys.length > BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES + 1) {
      return ROOT_ENTRIES_OVER_BUDGET;
    }
    for (const key of ownKeys) {
      if (typeof key !== "string" || key === "length") continue;
      const index = Number(key);
      if (Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key) {
        indexes.push(index);
        if (indexes.length > BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES) {
          return ROOT_ENTRIES_OVER_BUDGET;
        }
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
export const BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH = 64;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_NODES = 1_024;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_OPERANDS = 4_096;
export const BRUNO_TABLE_CLIENT_FILTER_MAX_ROOT_ENTRIES = 16_384;
const ROOT_ENTRIES_OVER_BUDGET = Symbol("BrunoTable root filter entries over budget");
const SANITIZED_FILTER_SNAPSHOTS = new WeakSet<object>();

type FilterSanitizationContext = {
  readonly captured: WeakMap<object, Readonly<Record<string, unknown>> | undefined>;
  readonly capturedArrays: WeakMap<object, CapturedFilterArray | undefined>;
  readonly completed: WeakMap<object, Map<number, SanitizedFilterNode | undefined>>;
  readonly visited: WeakSet<object>;
  overBudget: boolean;
  remainingNodes: number;
};

function isBoundedFilterOperand(value: unknown, context: FilterSanitizationContext): boolean {
  const visited = new WeakSet<object>();
  let objectCount = 0;
  let propertyCount = 0;

  const visit = (candidate: unknown, depth: number): boolean => {
    if (typeof candidate === "string") {
      if (candidate.length <= BRUNO_TABLE_MAX_FILTER_OPERAND_LENGTH) return true;
      context.overBudget = true;
      return false;
    }
    if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate === "boolean" ||
      typeof candidate === "number" ||
      typeof candidate === "bigint" ||
      typeof candidate === "symbol"
    ) {
      return true;
    }
    if (typeof candidate !== "object" || depth > BRUNO_TABLE_MAX_FILTER_OPERAND_DEPTH) {
      if (depth > BRUNO_TABLE_MAX_FILTER_OPERAND_DEPTH) context.overBudget = true;
      return false;
    }
    if (visited.has(candidate)) return true;
    visited.add(candidate);
    objectCount += 1;
    if (objectCount > BRUNO_TABLE_MAX_FILTER_OPERAND_OBJECTS) {
      context.overBudget = true;
      return false;
    }
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(candidate);
    } catch {
      return false;
    }
    propertyCount += keys.length;
    if (propertyCount > BRUNO_TABLE_MAX_FILTER_OPERAND_PROPERTIES) {
      context.overBudget = true;
      return false;
    }
    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      } catch {
        return false;
      }
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return false;
      if (!visit(descriptor.value, depth + 1)) return false;
    }
    return true;
  };

  return visit(value, 0);
}

type CapturedFilterArray = {
  attempted: boolean;
  readonly length: number;
  snapshot: readonly unknown[] | undefined;
};

type SanitizedFilterNode = {
  readonly columnIds: ReadonlySet<string>;
  readonly filter: Readonly<Record<string, unknown>>;
};
