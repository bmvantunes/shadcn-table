import type { BrunoTableAggFunc, BrunoTableColumnId } from "../public-types";
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
  readonly groupBy: boolean;
  readonly aggFunc?: BrunoTableAggFunc;
  readonly isEditable?: boolean | RuntimeCallback;
  readonly groupKeyValueFormatter?: RuntimeCallback;
  readonly groupKeyCellClassName?: string | RuntimeCallback;
  readonly groupKeyCellRenderer?: RuntimeCallback;
  readonly aggregateValueFormatter?: RuntimeCallback;
  readonly aggregateCellClassName?: string | RuntimeCallback;
  readonly aggregateCellRenderer?: RuntimeCallback;
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
  const hasGroupBy = Object.hasOwn(candidate, "groupBy");
  const hasAggFunc = Object.hasOwn(candidate, "aggFunc");
  const columnId = candidate["columnId"];
  const groupPresentation = compilePresentationCallbacks(candidate, columnId, "groupKey");
  const aggregatePresentation = compilePresentationCallbacks(candidate, columnId, "aggregate");

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

    const groupBy = hasGroupBy ? candidate["groupBy"] : false;
    if (typeof groupBy !== "boolean") {
      throw new ColumnConfigurationError(
        `BrunoTable groupBy must be a boolean when provided: ${columnId}`,
      );
    }
    if (groupPresentation.hasPresentation && !groupBy) {
      throw new ColumnConfigurationError(
        `BrunoTable group-key presentation requires groupBy: true: ${columnId}`,
      );
    }

    const aggFunc = hasAggFunc ? candidate["aggFunc"] : undefined;
    if (aggFunc !== undefined && !isAggFunc(aggFunc)) {
      throw new ColumnConfigurationError(
        `BrunoTable aggFunc is unsupported for column: ${columnId}`,
      );
    }
    if (aggregatePresentation.hasPresentation && aggFunc === undefined) {
      throw new ColumnConfigurationError(
        `BrunoTable aggregate presentation requires aggFunc: ${columnId}`,
      );
    }
    if (aggFunc !== undefined && !Object.hasOwn(semantics.aggregateResults, aggFunc)) {
      throw new ColumnConfigurationError(
        `BrunoTable Value Type does not support ${aggFunc} aggregation: ${columnId}`,
      );
    }

    return Object.freeze({
      kind: "field",
      columnId,
      headerName,
      valueType,
      semantics,
      field,
      groupBy,
      enableFilter,
      enableSorting,
      ...(typeof isEditable === "boolean" || typeof isEditable === "function"
        ? { isEditable: isEditable as boolean | RuntimeCallback }
        : {}),
      ...(aggFunc === undefined ? {} : { aggFunc }),
      ...groupPresentation.compiled,
      ...aggregatePresentation.compiled,
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

  if (
    hasGroupBy ||
    hasAggFunc ||
    groupPresentation.hasPresentation ||
    aggregatePresentation.hasPresentation
  ) {
    throw new ColumnConfigurationError(
      `BrunoTable computed columns cannot declare grouping or aggregation: ${columnId}`,
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

function compilePresentationCallbacks(
  candidate: RuntimeColumnDefinition,
  columnId: unknown,
  family: "groupKey" | "aggregate",
): {
  readonly hasPresentation: boolean;
  readonly compiled: Readonly<Record<string, string | RuntimeCallback>>;
} {
  const valueFormatterKey = `${family}ValueFormatter`;
  const cellClassNameKey = `${family}CellClassName`;
  const cellRendererKey = `${family}CellRenderer`;
  const hasValueFormatter = Object.hasOwn(candidate, valueFormatterKey);
  const hasCellClassName = Object.hasOwn(candidate, cellClassNameKey);
  const hasCellRenderer = Object.hasOwn(candidate, cellRendererKey);
  const valueFormatter = candidate[valueFormatterKey];
  const cellClassName = candidate[cellClassNameKey];
  const cellRenderer = candidate[cellRendererKey];

  if (hasValueFormatter && typeof valueFormatter !== "function") {
    throw new ColumnConfigurationError(
      `BrunoTable ${valueFormatterKey} must be a function when provided: ${String(columnId)}`,
    );
  }
  if (
    hasCellClassName &&
    typeof cellClassName !== "string" &&
    typeof cellClassName !== "function"
  ) {
    throw new ColumnConfigurationError(
      `BrunoTable ${cellClassNameKey} must be a string or function when provided: ${String(columnId)}`,
    );
  }
  if (hasCellRenderer && typeof cellRenderer !== "function") {
    throw new ColumnConfigurationError(
      `BrunoTable ${cellRendererKey} must be a function when provided: ${String(columnId)}`,
    );
  }

  return {
    hasPresentation: hasValueFormatter || hasCellClassName || hasCellRenderer,
    compiled: {
      ...(typeof valueFormatter === "function"
        ? { [valueFormatterKey]: valueFormatter as RuntimeCallback }
        : {}),
      ...(typeof cellClassName === "string" || typeof cellClassName === "function"
        ? { [cellClassNameKey]: cellClassName as string | RuntimeCallback }
        : {}),
      ...(typeof cellRenderer === "function"
        ? { [cellRendererKey]: cellRenderer as RuntimeCallback }
        : {}),
    },
  };
}

function isAggFunc(value: unknown): value is BrunoTableAggFunc {
  return (
    value === "countDistinct" ||
    value === "sum" ||
    value === "min" ||
    value === "max" ||
    value === "avg"
  );
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
