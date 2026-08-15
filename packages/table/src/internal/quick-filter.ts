import type { CompiledColumn } from "./compile-columns";
import { createClientFilterPredicate, normalizeBrunoTableFilterText } from "./grid-query";

/** Internal safety boundary for pasted Quick Filter candidates. */
export const BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH = 1_024;

export function boundBrunoTableQuickFilterText(text: string): string {
  return text.length <= BRUNO_TABLE_MAX_QUICK_FILTER_LENGTH
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
  const normalizedQuery = normalizeBrunoTableFilterText(text);
  const quickFilterFields = fields ?? EMPTY_QUICK_FILTER_FIELDS;
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
): ((row: TRow) => boolean) | undefined {
  const gridPredicate = createClientFilterPredicate(columns, filters, readValue);
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
