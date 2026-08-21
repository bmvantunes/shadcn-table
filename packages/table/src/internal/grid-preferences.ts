import type { BrunoTableJsonValue } from "../public-types";
import type { CompiledColumn } from "./compile-columns";
import {
  createBrunoTableColumnLayout,
  getBrunoTableCommittedColumnWidths,
  getBrunoTableColumnLayoutSnapshot,
  restoreBrunoTableColumnLayout,
  type BrunoTableColumnLayoutState,
} from "./column-management";
import {
  BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH,
  BRUNO_TABLE_CLIENT_FILTER_MAX_INPUT_ENTRIES,
  BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES,
  BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS,
  compileClientFilterCollection,
  reconcileBrunoTableOrderBy,
  type BrunoTableClientFilterCollection,
  type BrunoTableOrderBy,
} from "./grid-query";
import { captureBrunoTablePlainRecord } from "./untrusted-input";

export const BRUNO_TABLE_PERSISTED_STATE_VERSION = 1 as const;

const PERSISTED_STATE_KEYS = Object.freeze([
  "version",
  "tableId",
  "filters",
  "orderBy",
  "groupBy",
  "groupOrderBy",
  "columnOrder",
  "columnVisibility",
  "columnWidths",
  "columnPinning",
]);
const PERSISTED_FILTER_KEYS = Object.freeze([
  "type",
  "conditions",
  "condition",
  "columnId",
  "codecId",
  "codecVersion",
  "filter",
  "filterTo",
  "caseSensitive",
  "accentSensitive",
]);

type PersistedFilter = Readonly<Record<string, BrunoTableJsonValue>>;

export type BrunoTableGridPreferences = Readonly<{
  readonly tableId: string;
  readonly columns: readonly CompiledColumn[];
  readonly filters: readonly unknown[];
  readonly filterCollection: BrunoTableClientFilterCollection;
  readonly orderBy: BrunoTableOrderBy;
  readonly groupBy: readonly string[];
  readonly groupOrderBy: BrunoTableOrderBy;
  readonly columnLayout: BrunoTableColumnLayoutState;
}>;

export type BrunoTableGridPreferencesInput = Readonly<{
  readonly tableId: string;
  readonly columns: readonly CompiledColumn[];
  readonly initialFilters: readonly unknown[];
  readonly initialOrderBy: BrunoTableOrderBy;
  readonly initialPersistedState?: unknown;
}>;

export function createBrunoTableGridPreferences(
  input: BrunoTableGridPreferencesInput,
): BrunoTableGridPreferences {
  const baselineFilters = compileClientFilterCollection(input.initialFilters, input.columns, {
    rejectOverBudget: true,
  });
  const baselineOrderBy = reconcileBrunoTableOrderBy(
    input.initialOrderBy,
    input.initialOrderBy,
    input.columns,
  );
  const persisted = capturePersistedState(input.initialPersistedState, input.tableId);
  if (persisted === undefined) {
    return Object.freeze({
      tableId: input.tableId,
      columns: input.columns,
      filters: baselineFilters.filters,
      filterCollection: baselineFilters,
      orderBy: baselineOrderBy,
      groupBy: Object.freeze([]),
      groupOrderBy: Object.freeze([]),
      columnLayout: createBrunoTableColumnLayout(input.columns),
    });
  }

  const decodedFilters = decodePersistedFilters(persisted["filters"], input.columns);
  let filterCollection = baselineFilters;
  if (decodedFilters !== undefined) {
    try {
      filterCollection = compileClientFilterCollection(decodedFilters, input.columns, {
        rejectOverBudget: true,
      });
    } catch {
      // A damaged persisted collection cannot erase the valid configured baseline.
    }
  }
  const orderBy = reconcileBrunoTableOrderBy(persisted["orderBy"], baselineOrderBy, input.columns);
  return Object.freeze({
    tableId: input.tableId,
    columns: input.columns,
    filters: filterCollection.filters,
    filterCollection,
    orderBy,
    // Grouping is a forward-compatible persisted seam. This Client runtime has no grouping
    // capability, so restoration must conservatively discard it.
    groupBy: Object.freeze([]),
    groupOrderBy: Object.freeze([]),
    columnLayout: restoreBrunoTableColumnLayout(input.columns, {
      columnOrder: persisted["columnOrder"],
      columnVisibility: persisted["columnVisibility"],
      columnWidths: persisted["columnWidths"],
      columnPinning: persisted["columnPinning"],
    }),
  });
}

export function createBrunoTablePersistedState(
  preferences: Omit<BrunoTableGridPreferences, "filterCollection">,
): Readonly<Record<string, BrunoTableJsonValue>> {
  const layout = getBrunoTableColumnLayoutSnapshot(preferences.columnLayout);
  const visible = new Set(layout.visibleColumnIds);
  const columnOrder = layout.allColumns.map((column) => column.columnId);
  const columnVisibility = Object.fromEntries(
    columnOrder.map((columnId) => [columnId, visible.has(columnId)]),
  );
  const columnWidths = getBrunoTableCommittedColumnWidths(preferences.columnLayout);
  const columnPinning = {
    start: layout.allColumns
      .filter((column) => column.pinned === "start")
      .map((column) => column.columnId),
    end: layout.allColumns
      .filter((column) => column.pinned === "end")
      .map((column) => column.columnId),
  };
  return Object.freeze({
    version: BRUNO_TABLE_PERSISTED_STATE_VERSION,
    tableId: preferences.tableId,
    filters: encodePersistedFilters(preferences.filters, preferences.columns),
    orderBy: encodeOrderBy(preferences.orderBy),
    groupBy: Object.freeze(Array.from(preferences.groupBy)),
    groupOrderBy: encodeOrderBy(preferences.groupOrderBy),
    columnOrder: Object.freeze(columnOrder),
    columnVisibility: Object.freeze(columnVisibility),
    columnWidths: Object.freeze(columnWidths),
    columnPinning: Object.freeze({
      start: Object.freeze(columnPinning.start),
      end: Object.freeze(columnPinning.end),
    }),
  });
}

function capturePersistedState(
  input: unknown,
  tableId: string,
): Readonly<Record<string, unknown>> | undefined {
  const snapshot = captureBrunoTablePlainRecord(input, PERSISTED_STATE_KEYS);
  if (
    snapshot === undefined ||
    snapshot["version"] !== BRUNO_TABLE_PERSISTED_STATE_VERSION ||
    snapshot["tableId"] !== tableId
  ) {
    return undefined;
  }
  return snapshot;
}

function encodePersistedFilters(
  filters: readonly unknown[],
  columns: readonly CompiledColumn[],
): readonly PersistedFilter[] {
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  return Object.freeze(filters.map((filter) => encodePersistedFilter(filter, columnsById)));
}

function encodePersistedFilter(
  input: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
): PersistedFilter {
  if (!isRecord(input) || typeof input["type"] !== "string") {
    throw new TypeError("BrunoTable cannot persist an invalid Grid Filter Expression.");
  }
  const type = input["type"];
  if ((type === "AND" || type === "OR") && Array.isArray(input["conditions"])) {
    return Object.freeze({
      type,
      conditions: Object.freeze(
        input["conditions"].map((condition) => encodePersistedFilter(condition, columnsById)),
      ),
    });
  }
  if (type === "NOT") {
    return Object.freeze({
      type,
      condition: encodePersistedFilter(input["condition"], columnsById),
    });
  }
  const columnId = input["columnId"];
  const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
  if (column === undefined)
    throw new TypeError("BrunoTable cannot persist a filter for an unknown column.");
  const result: Record<string, BrunoTableJsonValue> = { type, columnId: column.columnId };
  if (type === "blank" || type === "notBlank" || type === "matchNone") return Object.freeze(result);
  result["codecId"] = column.semantics.codecId;
  result["codecVersion"] = column.semantics.codecVersion;
  if (type === "in") {
    if (!Array.isArray(input["filter"]))
      throw new TypeError("BrunoTable cannot persist an invalid in filter.");
    result["filter"] = Object.freeze(
      input["filter"].map((value) => snapshotJsonValue(column.semantics.encodePersisted(value))),
    );
  } else {
    result["filter"] = snapshotJsonValue(column.semantics.encodePersisted(input["filter"]));
    if (type === "inRange")
      result["filterTo"] = snapshotJsonValue(column.semantics.encodePersisted(input["filterTo"]));
  }
  if (input["caseSensitive"] === true) result["caseSensitive"] = true;
  if (input["accentSensitive"] === true) result["accentSensitive"] = true;
  return Object.freeze(result);
}

function decodePersistedFilters(
  input: unknown,
  columns: readonly CompiledColumn[],
): readonly unknown[] | undefined {
  const entries = captureDenseArray(input, BRUNO_TABLE_CLIENT_FILTER_MAX_INPUT_ENTRIES);
  if (entries === undefined) return undefined;
  const columnsById = new Map(columns.map((column) => [column.columnId, column]));
  const budget = { nodes: 0, operands: 0, overBudget: false };
  const decoded: Readonly<Record<string, unknown>>[] = [];
  for (const filter of entries) {
    const next = decodePersistedFilter(filter, columnsById, budget, 0);
    if (budget.overBudget) return undefined;
    if (next !== undefined) decoded.push(next);
  }
  return Object.freeze(decoded);
}

function decodePersistedFilter(
  input: unknown,
  columnsById: ReadonlyMap<string, CompiledColumn>,
  budget: { nodes: number; operands: number; overBudget: boolean },
  depth: number,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (
      depth > BRUNO_TABLE_CLIENT_FILTER_MAX_DEPTH ||
      budget.nodes >= BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES
    ) {
      budget.overBudget = true;
      return undefined;
    }
    const record = captureBrunoTablePlainRecord(input, PERSISTED_FILTER_KEYS);
    if (record === undefined || typeof record["type"] !== "string") return undefined;
    budget.nodes += 1;
    const type = record["type"];
    if (type === "AND" || type === "OR") {
      const candidates = captureDenseArray(
        record["conditions"],
        BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES - budget.nodes,
      );
      if (candidates === undefined || candidates.length === 0) {
        budget.overBudget ||= isArrayLongerThan(
          record["conditions"],
          BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_NODES - budget.nodes,
        );
        return undefined;
      }
      const conditions: Readonly<Record<string, unknown>>[] = [];
      for (const condition of candidates) {
        const decoded = decodePersistedFilter(condition, columnsById, budget, depth + 1);
        if (decoded === undefined) return undefined;
        conditions.push(decoded);
      }
      return Object.freeze({ type, conditions: Object.freeze(conditions) });
    }
    if (type === "NOT") {
      const condition = decodePersistedFilter(record["condition"], columnsById, budget, depth + 1);
      return condition === undefined ? undefined : Object.freeze({ type, condition });
    }
    const columnId = record["columnId"];
    const column = typeof columnId === "string" ? columnsById.get(columnId) : undefined;
    if (column === undefined) return undefined;
    if (type === "blank" || type === "notBlank" || type === "matchNone") {
      return Object.freeze({ type, columnId });
    }
    if (
      record["codecId"] !== column.semantics.codecId ||
      record["codecVersion"] !== column.semantics.codecVersion
    )
      return undefined;
    const decode = (value: unknown) => {
      const result = column.semantics.decodePersisted(value);
      return result._tag === "Success" ? result.value : DECODE_FAILURE;
    };
    const decodedFilter =
      type === "in"
        ? captureDenseArray(
            record["filter"],
            BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS - budget.operands,
          )
        : undefined;
    if (type === "in" && decodedFilter === undefined) {
      budget.overBudget ||= isArrayLongerThan(
        record["filter"],
        BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS - budget.operands,
      );
      return undefined;
    }
    const operandCount = type === "in" ? (decodedFilter?.length ?? 0) : 1;
    if (budget.operands + operandCount > BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS) {
      budget.overBudget = true;
      return undefined;
    }
    budget.operands += operandCount;
    let decodedOperand: unknown;
    if (type === "in") {
      const decodedValues = decodedFilter!.map(decode);
      if (decodedValues.includes(DECODE_FAILURE)) return undefined;
      decodedOperand = Object.freeze(decodedValues);
    } else {
      decodedOperand = decode(record["filter"]);
      if (decodedOperand === DECODE_FAILURE) return undefined;
    }
    const result: Record<string, unknown> = {
      type,
      columnId,
      filter: decodedOperand,
    };
    if (type === "inRange") {
      if (budget.operands >= BRUNO_TABLE_CLIENT_FILTER_MAX_TOTAL_OPERANDS) {
        budget.overBudget = true;
        return undefined;
      }
      budget.operands += 1;
      const filterTo = decode(record["filterTo"]);
      if (filterTo === DECODE_FAILURE) return undefined;
      result["filterTo"] = filterTo;
    }
    if (record["caseSensitive"] === true) result["caseSensitive"] = true;
    if (record["accentSensitive"] === true) result["accentSensitive"] = true;
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

function captureDenseArray(input: unknown, maximumLength: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(input)) return undefined;
    const length = input.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return undefined;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, index);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return undefined;
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function isArrayLongerThan(input: unknown, maximumLength: number): boolean {
  try {
    return Array.isArray(input) && input.length > maximumLength;
  } catch {
    return false;
  }
}

const DECODE_FAILURE: unique symbol = Symbol("BrunoTablePersistedDecodeFailure");

function encodeOrderBy(orderBy: BrunoTableOrderBy): readonly BrunoTableJsonValue[] {
  return Object.freeze(orderBy.map((sort) => Object.freeze({ ...sort })));
}

function snapshotJsonValue(value: BrunoTableJsonValue): BrunoTableJsonValue {
  const snapshot = snapshotUnknownJsonValue(value, new WeakSet());
  if (snapshot === INVALID_JSON_VALUE) {
    throw new TypeError("BrunoTable persisted codecs must emit a JSON-safe value.");
  }
  return snapshot;
}

function snapshotUnknownJsonValue(
  value: unknown,
  active: WeakSet<object>,
): BrunoTableJsonValue | typeof INVALID_JSON_VALUE {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  if (typeof value !== "object" || active.has(value)) return INVALID_JSON_VALUE;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      if (!Number.isSafeInteger(length) || length < 0) return INVALID_JSON_VALUE;
      const result: BrunoTableJsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return INVALID_JSON_VALUE;
        }
        const nested = snapshotUnknownJsonValue(descriptor.value, active);
        if (nested === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
        result.push(nested);
      }
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return INVALID_JSON_VALUE;
    }
    const result: Record<string, BrunoTableJsonValue> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return INVALID_JSON_VALUE;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return INVALID_JSON_VALUE;
      }
      const nested = snapshotUnknownJsonValue(descriptor.value, active);
      if (nested === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
      Object.defineProperty(result, key, {
        value: nested,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    return INVALID_JSON_VALUE;
  } finally {
    active.delete(value);
  }
}

const INVALID_JSON_VALUE: unique symbol = Symbol("BrunoTableInvalidJsonValue");

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
