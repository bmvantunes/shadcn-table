import type { CompiledColumn } from "./compile-columns";
import {
  createClientFilterPredicate,
  normalizeBrunoTableFilterText,
  type ClientFilterPlan,
} from "./grid-query";

/** Internal safety boundary for pasted Quick Filter candidates. */
export const BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH = 1_024;
/** Internal configuration bound shared by Client configuration and predicate construction. */
export const BRUNO_TABLE_MAX_QUICK_FILTER_FIELDS = 256;

export function isBrunoTableQuickFilterTextWithinLimit(text: string): boolean {
  return text.length <= BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH;
}

export function boundBrunoTableQuickFilterText(text: string): string {
  return isBrunoTableQuickFilterTextWithinLimit(text)
    ? text
    : text.slice(0, BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH);
}

export type BrunoTableClientQuickFilterFieldReader<TRow> = (row: TRow, field: string) => unknown;

/**
 * Compiles the session-only Quick Filter independently from Grid Filter state. An empty query
 * intentionally has no predicate so the Client row model can retain its current query shape.
 */
export function createClientQuickFilterPredicate<TRow>(
  text: string | undefined,
  fields: readonly string[] | undefined,
  readField: BrunoTableClientQuickFilterFieldReader<TRow> = readClientQuickFilterField,
): ((row: TRow) => boolean) | undefined {
  if (text === undefined || text.length === 0) return undefined;
  if (!isBrunoTableQuickFilterTextWithinLimit(text)) return undefined;
  const normalizedQuery = normalizeBrunoTableFilterText(text);
  if (normalizedQuery.length === 0) return undefined;
  const quickFilterFields = snapshotQuickFilterFieldsForPredicate(fields);
  if (quickFilterFields.length === 0) return undefined;
  return (row) =>
    quickFilterFields.some((field) => {
      try {
        const value = readField(row, field);
        return (
          typeof value === "string" &&
          normalizeBrunoTableFilterText(value).includes(normalizedQuery)
        );
      } catch {
        return false;
      }
    });
}

/** Composes the two independent query predicates without representing Quick Filter as a Grid Filter. */
export function createClientQueryPredicate<TRow>(
  columns: readonly CompiledColumn[],
  filters: readonly unknown[] | undefined,
  quickFilterText: string | undefined,
  quickFilterFields: readonly string[] | undefined,
  readValue: (column: CompiledColumn, row: TRow) => unknown,
  readField: BrunoTableClientQuickFilterFieldReader<TRow> = readClientQuickFilterField,
  filterPlan?: ClientFilterPlan,
): ((row: TRow) => boolean) | undefined {
  const gridPredicate = createClientFilterPredicate(columns, filters, readValue, filterPlan);
  const quickPredicate = createClientQuickFilterPredicate(
    quickFilterText,
    quickFilterFields,
    readField,
  );
  if (gridPredicate === undefined) return quickPredicate;
  if (quickPredicate === undefined) return gridPredicate;
  return (row) => gridPredicate(row) && quickPredicate(row);
}

/** Internal field access policy shared by every Client Quick Filter evaluation path. */
export function readClientQuickFilterField(row: unknown, field: string): unknown {
  if (row === null || row === undefined) throw new TypeError("Quick Filter row is nullish.");
  return Reflect.get(Object(row), field);
}

const EMPTY_QUICK_FILTER_FIELDS: readonly string[] = Object.freeze([]);

function snapshotQuickFilterFieldsForPredicate(
  fields: readonly string[] | undefined,
): readonly string[] {
  // Public Client configuration is validated and rejected by the Adapter before this predicate
  // seam. The defensive empty result here is only for hostile internal/direct predicate callers;
  // it must never be used as the public configuration admission path.
  if (fields === undefined) return EMPTY_QUICK_FILTER_FIELDS;
  try {
    if (!Array.isArray(fields)) return EMPTY_QUICK_FILTER_FIELDS;
    const length = fields.length;
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > BRUNO_TABLE_MAX_QUICK_FILTER_FIELDS
    ) {
      return EMPTY_QUICK_FILTER_FIELDS;
    }
    const snapshot: string[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(fields, index)) return EMPTY_QUICK_FILTER_FIELDS;
      const field = fields[index];
      if (typeof field !== "string" || field.length === 0) return EMPTY_QUICK_FILTER_FIELDS;
      snapshot.push(field);
    }
    return Object.freeze(snapshot);
  } catch {
    return EMPTY_QUICK_FILTER_FIELDS;
  }
}
