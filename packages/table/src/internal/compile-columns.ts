import type { BrunoTableColumnId } from "../public-types";
import { compileColumnValueSemantics, ValueSemanticsConfigurationError } from "./value-semantics";

const columnIdPrefix = "COL_ID_";
const columnIdSuffixStartPattern = /^[A-Z0-9_]/u;
type RuntimeColumnDefinition = Readonly<Record<PropertyKey, unknown>>;
type RuntimeCallback = (...parameters: never[]) => unknown;

type CompiledColumnBase = {
  readonly columnId: BrunoTableColumnId;
  readonly headerName: string;
  readonly valueType: unknown;
  readonly semantics: ReturnType<typeof compileColumnValueSemantics>;
  readonly enableFilter: boolean;
  readonly enableSorting: boolean;
  readonly valueFormatter?: RuntimeCallback;
  readonly cellClassName?: string | RuntimeCallback;
  readonly cellRenderer?: RuntimeCallback;
};

export type CompiledFieldColumn = CompiledColumnBase & {
  readonly kind: "field";
  readonly field: string;
  readonly isEditable?: boolean | RuntimeCallback;
};

export type CompiledComputedColumn = CompiledColumnBase & {
  readonly kind: "computed";
  readonly fields: readonly [string, ...string[]];
  readonly valueGetter: RuntimeCallback;
};

export type CompiledColumn = CompiledFieldColumn | CompiledComputedColumn;

export class ColumnConfigurationError extends TypeError {}

export function compileColumns(columns: readonly unknown[]): readonly CompiledColumn[] {
  const seen = new Set<string>();
  const compiled = Array.from(columns, (column, index) => compileColumn(column, index, seen));

  return Object.freeze(compiled);
}

function compileColumn(candidate: unknown, index: number, seen: Set<string>): CompiledColumn {
  if (!isRuntimeColumnDefinition(candidate)) {
    throw new ColumnConfigurationError(`BrunoTable column at index ${index} must be an object.`);
  }

  const hasField = Object.hasOwn(candidate, "field");
  const hasFields = Object.hasOwn(candidate, "fields");
  const hasValueGetter = Object.hasOwn(candidate, "valueGetter");
  const hasEnableFilter = Object.hasOwn(candidate, "enableFilter");
  const hasEnableSorting = Object.hasOwn(candidate, "enableSorting");
  const hasIsEditable = Object.hasOwn(candidate, "isEditable");
  const hasValueFormatter = Object.hasOwn(candidate, "valueFormatter");
  const hasCellClassName = Object.hasOwn(candidate, "cellClassName");
  const hasCellRenderer = Object.hasOwn(candidate, "cellRenderer");
  const hasCellAlign = Object.hasOwn(candidate, "cellAlign");
  const hasEditorLayout = Object.hasOwn(candidate, "editorLayout");
  const hasWidth = Object.hasOwn(candidate, "width");
  const hasFormat = Object.hasOwn(candidate, "format");
  const columnId = candidate["columnId"];

  if (!isColumnId(columnId)) {
    throw new ColumnConfigurationError(
      "BrunoTable columnId must start with COL_ID_, begin its suffix with A-Z, 0-9, or _, and have an uppercase suffix.",
    );
  }

  if (seen.has(columnId)) {
    throw new ColumnConfigurationError(`BrunoTable columnId must be unique: ${columnId}`);
  }
  seen.add(columnId);

  const headerName = candidate["headerName"];
  if (typeof headerName !== "string" || headerName.trim().length === 0) {
    throw new ColumnConfigurationError(
      `BrunoTable headerName must be a non-empty string for column: ${columnId}`,
    );
  }

  const valueType = candidate["valueType"];
  const cellAlign = hasCellAlign ? candidate["cellAlign"] : undefined;
  const editorLayout = hasEditorLayout ? candidate["editorLayout"] : undefined;
  const width = hasWidth ? candidate["width"] : undefined;
  const format = hasFormat ? candidate["format"] : undefined;
  let semantics: ReturnType<typeof compileColumnValueSemantics>;
  try {
    semantics = compileColumnValueSemantics(valueType, { cellAlign, editorLayout, width, format });
  } catch (error) {
    if (!(error instanceof ValueSemanticsConfigurationError)) throw error;
    throw new ColumnConfigurationError(`${error.message} Column: ${columnId}`);
  }

  const valueFormatter = hasValueFormatter ? candidate["valueFormatter"] : undefined;
  if (hasValueFormatter && typeof valueFormatter !== "function") {
    throw new ColumnConfigurationError(
      `BrunoTable valueFormatter must be a function when provided: ${columnId}`,
    );
  }

  const cellClassName = hasCellClassName ? candidate["cellClassName"] : undefined;
  if (
    hasCellClassName &&
    typeof cellClassName !== "string" &&
    typeof cellClassName !== "function"
  ) {
    throw new ColumnConfigurationError(
      `BrunoTable cellClassName must be a string or function when provided: ${columnId}`,
    );
  }

  const cellRenderer = hasCellRenderer ? candidate["cellRenderer"] : undefined;
  if (hasCellRenderer && typeof cellRenderer !== "function") {
    throw new ColumnConfigurationError(
      `BrunoTable cellRenderer must be a function when provided: ${columnId}`,
    );
  }

  if (hasField) {
    if (hasFields || hasValueGetter) {
      throw new ColumnConfigurationError(
        `BrunoTable column cannot combine field with fields or valueGetter: ${columnId}`,
      );
    }

    const field = candidate["field"];
    if (typeof field !== "string" || field.trim().length === 0) {
      throw new ColumnConfigurationError(
        `BrunoTable field must be a non-empty string for column: ${columnId}`,
      );
    }

    const isEditable = hasIsEditable ? candidate["isEditable"] : undefined;
    if (hasIsEditable && typeof isEditable !== "boolean" && typeof isEditable !== "function") {
      throw new ColumnConfigurationError(
        `BrunoTable isEditable must be a boolean or function when provided: ${columnId}`,
      );
    }

    const enableFilter = hasEnableFilter ? candidate["enableFilter"] : true;
    if (typeof enableFilter !== "boolean") {
      throw new ColumnConfigurationError(
        `BrunoTable enableFilter must be a boolean when provided: ${columnId}`,
      );
    }

    const enableSorting = hasEnableSorting ? candidate["enableSorting"] : true;
    if (typeof enableSorting !== "boolean") {
      throw new ColumnConfigurationError(
        `BrunoTable enableSorting must be a boolean when provided: ${columnId}`,
      );
    }

    return Object.freeze({
      kind: "field",
      columnId,
      headerName,
      valueType,
      semantics,
      field,
      enableFilter,
      enableSorting,
      ...(typeof isEditable === "boolean" || typeof isEditable === "function"
        ? { isEditable: isEditable as boolean | RuntimeCallback }
        : {}),
      ...(typeof valueFormatter === "function"
        ? { valueFormatter: valueFormatter as RuntimeCallback }
        : {}),
      ...(typeof cellClassName === "string" || typeof cellClassName === "function"
        ? { cellClassName: cellClassName as string | RuntimeCallback }
        : {}),
      ...(typeof cellRenderer === "function"
        ? { cellRenderer: cellRenderer as RuntimeCallback }
        : {}),
    });
  }

  if (!hasFields || !hasValueGetter) {
    throw new ColumnConfigurationError(
      `BrunoTable column must define either field or both fields and valueGetter: ${columnId}`,
    );
  }

  const fieldsCandidate = candidate["fields"];
  if (!Array.isArray(fieldsCandidate)) {
    throw new ColumnConfigurationError(
      `BrunoTable computed fields must be a non-empty tuple of field names: ${columnId}`,
    );
  }

  const candidateFields = Array.from(fieldsCandidate);
  if (
    candidateFields.length === 0 ||
    !candidateFields.every((field) => typeof field === "string" && field.trim().length > 0)
  ) {
    throw new ColumnConfigurationError(
      `BrunoTable computed fields must be a non-empty tuple of field names: ${columnId}`,
    );
  }

  const valueGetter = candidate["valueGetter"];
  if (typeof valueGetter !== "function") {
    throw new ColumnConfigurationError(
      `BrunoTable computed valueGetter must be a function: ${columnId}`,
    );
  }

  if (hasIsEditable) {
    throw new ColumnConfigurationError(
      `BrunoTable computed columns cannot declare isEditable: ${columnId}`,
    );
  }

  if (hasEnableFilter || hasEnableSorting) {
    throw new ColumnConfigurationError(
      `BrunoTable computed columns cannot declare enableFilter or enableSorting: ${columnId}`,
    );
  }

  const fields = Object.freeze(candidateFields) as readonly [string, ...string[]];

  return Object.freeze({
    kind: "computed",
    columnId,
    headerName,
    valueType,
    semantics,
    enableFilter: false,
    enableSorting: false,
    fields,
    valueGetter: valueGetter as RuntimeCallback,
    ...(typeof valueFormatter === "function"
      ? { valueFormatter: valueFormatter as RuntimeCallback }
      : {}),
    ...(typeof cellClassName === "string" || typeof cellClassName === "function"
      ? { cellClassName: cellClassName as string | RuntimeCallback }
      : {}),
    ...(typeof cellRenderer === "function"
      ? { cellRenderer: cellRenderer as RuntimeCallback }
      : {}),
  });
}

function isRuntimeColumnDefinition(value: unknown): value is RuntimeColumnDefinition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isColumnId(columnId: unknown): columnId is BrunoTableColumnId {
  if (typeof columnId !== "string") {
    return false;
  }

  const suffix = columnId.slice(columnIdPrefix.length);

  return (
    columnId.startsWith(columnIdPrefix) &&
    columnIdSuffixStartPattern.test(suffix) &&
    suffix === suffix.toUpperCase()
  );
}
