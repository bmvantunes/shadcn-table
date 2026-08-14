import type { ReactNode } from "react";

import type { BrunoTableAggFunc, BrunoTableColumnId } from "../public-types";
import type { BrunoTableRuntimeRecord } from "./runtime-value";
import {
  compileColumnValueSemantics,
  ValueSemanticsConfigurationError,
  type CompiledColumnValueSemantics,
} from "./value-semantics";

const columnIdPrefix = "COL_ID_";
const BRUNO_TABLE_ROWS_COLUMN_ID = "COL_ID_BRUNO_TABLE_ROWS";
const columnIdSuffixStartPattern = /^[A-Z0-9_]/u;
const columnIdWhitespacePattern = /\s/u;
type RuntimeColumnDefinition = BrunoTableRuntimeRecord;
/** Erased presentation callbacks intentionally receive the raw row and canonical value. */
export interface BrunoTableRuntimeCallbackParameters {
  readonly row: BrunoTableRuntimeRecord[PropertyKey];
  readonly value: BrunoTableRuntimeRecord[PropertyKey];
}

type RuntimeCallback = (
  parameters: BrunoTableRuntimeCallbackParameters,
) => BrunoTableRuntimeRecord[PropertyKey];
type RuntimeCellRenderer = (parameters: BrunoTableRuntimeCallbackParameters) => ReactNode;

export interface BrunoTableRuntimeComputedGetterParameters {
  readonly row: BrunoTableRuntimeRecord;
}

type RuntimeComputedGetter = (
  parameters: BrunoTableRuntimeComputedGetterParameters,
) => BrunoTableRuntimeRecord[PropertyKey];

type PresentationCallbacks = {
  valueFormatter?: RuntimeCallback;
  cellClassName?: string | RuntimeCallback;
  cellRenderer?: RuntimeCellRenderer;
};

type CompiledPresentationCallbacks = Readonly<{
  readonly hasPresentation: boolean;
  readonly compiled: PresentationCallbacks;
}>;

type MutableCompiledFieldColumn = {
  -readonly [Key in keyof CompiledFieldColumn]: CompiledFieldColumn[Key];
};

type MutableCompiledComputedColumn = {
  -readonly [Key in keyof CompiledComputedColumn]: CompiledComputedColumn[Key];
};

type CompiledColumnBase = {
  readonly columnId: BrunoTableColumnId;
  readonly headerName: string;
  readonly pinned?: "start" | "end";
  readonly valueType: BrunoTableRuntimeRecord[PropertyKey];
  readonly semantics: ReturnType<typeof compileColumnValueSemantics>;
  readonly enableFilter: boolean;
  readonly enableSorting: boolean;
  readonly valueFormatter?: RuntimeCallback;
  readonly cellClassName?: string | RuntimeCallback;
  readonly cellRenderer?: RuntimeCellRenderer;
};

export type CompiledFieldColumn = CompiledColumnBase & {
  readonly kind: "field";
  readonly field: string;
  readonly groupBy: boolean;
  readonly aggFunc?: BrunoTableAggFunc;
  readonly isEditable?: boolean | RuntimeCallback;
  readonly groupKeyValueFormatter?: RuntimeCallback;
  readonly groupKeyCellClassName?: string | RuntimeCallback;
  readonly groupKeyCellRenderer?: RuntimeCellRenderer;
  readonly aggregateValueFormatter?: RuntimeCallback;
  readonly aggregateCellClassName?: string | RuntimeCallback;
  readonly aggregateCellRenderer?: RuntimeCellRenderer;
};

export type CompiledComputedColumn = CompiledColumnBase & {
  readonly kind: "computed";
  readonly fields: readonly [string, ...string[]];
  readonly valueGetter: RuntimeComputedGetter;
};

export type CompiledColumn = CompiledFieldColumn | CompiledComputedColumn;

export class ColumnConfigurationError extends TypeError {}

export function compileColumns<TColumn>(columns: readonly TColumn[]): readonly CompiledColumn[] {
  const seen = new Set<string>();
  const compiled = Array.from(columns, (column, index) => compileColumn(column, index, seen));

  return Object.freeze(compiled);
}

function compileColumn<TCandidate>(
  candidate: TCandidate,
  index: number,
  seen: Set<string>,
): CompiledColumn {
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
  const hasPinned = Object.hasOwn(candidate, "pinned");
  const hasGroupBy = Object.hasOwn(candidate, "groupBy");
  const hasAggFunc = Object.hasOwn(candidate, "aggFunc");
  const columnId = candidate["columnId"];
  const groupPresentation = compilePresentationCallbacks(candidate, columnId, "groupKey");
  const aggregatePresentation = compilePresentationCallbacks(candidate, columnId, "aggregate");

  if (columnId === BRUNO_TABLE_ROWS_COLUMN_ID) {
    throw new ColumnConfigurationError(
      `BrunoTable columnId is reserved for the Rows System Column: ${columnId}`,
    );
  }

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
  const pinned = hasPinned ? candidate["pinned"] : undefined;
  if (pinned !== undefined && pinned !== "start" && pinned !== "end") {
    throw new ColumnConfigurationError(
      `BrunoTable pinned must be start or end when provided: ${columnId}`,
    );
  }
  let semantics: ReturnType<typeof compileColumnValueSemantics>;
  try {
    semantics = compileColumnValueSemantics(valueType, { cellAlign, editorLayout, width, format });
  } catch (error) {
    if (!(error instanceof ValueSemanticsConfigurationError)) throw error;
    throw new ColumnConfigurationError(`${error.message} Column: ${columnId}`);
  }
  semantics = nullableSafeSemantics(semantics);

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

    const compiled: MutableCompiledFieldColumn = {
      kind: "field",
      columnId,
      headerName,
      valueType,
      semantics,
      field,
      groupBy,
      enableFilter,
      enableSorting,
    };
    if (pinned !== undefined) compiled.pinned = pinned;
    if (isEditable === true || isEditable === false || isRuntimeCallback(isEditable)) {
      compiled.isEditable = isEditable;
    }
    if (aggFunc !== undefined) compiled.aggFunc = aggFunc;
    if (groupPresentation.compiled.valueFormatter !== undefined) {
      compiled.groupKeyValueFormatter = groupPresentation.compiled.valueFormatter;
    }
    if (groupPresentation.compiled.cellClassName !== undefined) {
      compiled.groupKeyCellClassName = groupPresentation.compiled.cellClassName;
    }
    if (groupPresentation.compiled.cellRenderer !== undefined) {
      compiled.groupKeyCellRenderer = groupPresentation.compiled.cellRenderer;
    }
    if (aggregatePresentation.compiled.valueFormatter !== undefined) {
      compiled.aggregateValueFormatter = aggregatePresentation.compiled.valueFormatter;
    }
    if (aggregatePresentation.compiled.cellClassName !== undefined) {
      compiled.aggregateCellClassName = aggregatePresentation.compiled.cellClassName;
    }
    if (aggregatePresentation.compiled.cellRenderer !== undefined) {
      compiled.aggregateCellRenderer = aggregatePresentation.compiled.cellRenderer;
    }
    if (isRuntimeCallback(valueFormatter)) compiled.valueFormatter = valueFormatter;
    if (typeof cellClassName === "string" || isRuntimeCallback(cellClassName)) {
      compiled.cellClassName = cellClassName;
    }
    if (isRuntimeCellRenderer(cellRenderer)) compiled.cellRenderer = cellRenderer;
    return Object.freeze(compiled);
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

  const candidateFields: string[] = [];
  for (const field of fieldsCandidate) {
    if (typeof field !== "string" || field.trim().length === 0) {
      throw new ColumnConfigurationError(
        `BrunoTable computed fields must be a non-empty tuple of field names: ${columnId}`,
      );
    }
    candidateFields.push(field);
  }
  if (candidateFields.length === 0) {
    throw new ColumnConfigurationError(
      `BrunoTable computed fields must be a non-empty tuple of field names: ${columnId}`,
    );
  }

  const valueGetter = candidate["valueGetter"];
  if (!isRuntimeComputedGetter(valueGetter)) {
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

  const firstField = candidateFields[0];
  if (firstField === undefined) {
    throw new ColumnConfigurationError(
      `BrunoTable computed fields must be a non-empty tuple of field names: ${columnId}`,
    );
  }
  const fields: readonly [string, ...string[]] = Object.freeze([
    firstField,
    ...candidateFields.slice(1),
  ]);
  const compiled: MutableCompiledComputedColumn = {
    kind: "computed",
    columnId,
    headerName,
    valueType,
    semantics,
    enableFilter: false,
    enableSorting: false,
    fields,
    valueGetter,
  };
  if (pinned !== undefined) compiled.pinned = pinned;
  if (isRuntimeCallback(valueFormatter)) compiled.valueFormatter = valueFormatter;
  if (typeof cellClassName === "string" || isRuntimeCallback(cellClassName)) {
    compiled.cellClassName = cellClassName;
  }
  if (isRuntimeCellRenderer(cellRenderer)) compiled.cellRenderer = cellRenderer;
  return Object.freeze(compiled);
}

function nullableSafeSemantics(
  semantics: CompiledColumnValueSemantics,
): CompiledColumnValueSemantics {
  return Object.freeze({
    ...semantics,
    equivalent: (left, right) =>
      left == null || right == null
        ? left == null && right == null
        : semantics.equivalent(left, right),
    compare: (left, right) =>
      left == null || right == null
        ? left == null
          ? right == null
            ? 0
            : -1
          : 1
        : semantics.compare(left, right),
    formatDisplay: (value) => (value == null ? "" : semantics.formatDisplay(value)),
  });
}

function isRuntimeColumnDefinition(value: unknown): value is RuntimeColumnDefinition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compilePresentationCallbacks(
  candidate: RuntimeColumnDefinition,
  columnId: BrunoTableRuntimeRecord[PropertyKey],
  family: "groupKey" | "aggregate",
): CompiledPresentationCallbacks {
  const valueFormatterKey = `${family}ValueFormatter`;
  const cellClassNameKey = `${family}CellClassName`;
  const cellRendererKey = `${family}CellRenderer`;
  const hasValueFormatter = Object.hasOwn(candidate, valueFormatterKey);
  const hasCellClassName = Object.hasOwn(candidate, cellClassNameKey);
  const hasCellRenderer = Object.hasOwn(candidate, cellRendererKey);
  const valueFormatter = candidate[valueFormatterKey];
  const cellClassName = candidate[cellClassNameKey];
  const cellRenderer = candidate[cellRendererKey];

  if (hasValueFormatter && !isRuntimeCallback(valueFormatter)) {
    throw new ColumnConfigurationError(
      `BrunoTable ${valueFormatterKey} must be a function when provided: ${describeRuntimeColumnId(columnId)}`,
    );
  }
  if (hasCellClassName && typeof cellClassName !== "string" && !isRuntimeCallback(cellClassName)) {
    throw new ColumnConfigurationError(
      `BrunoTable ${cellClassNameKey} must be a string or function when provided: ${describeRuntimeColumnId(columnId)}`,
    );
  }
  if (hasCellRenderer && !isRuntimeCellRenderer(cellRenderer)) {
    throw new ColumnConfigurationError(
      `BrunoTable ${cellRendererKey} must be a function when provided: ${describeRuntimeColumnId(columnId)}`,
    );
  }

  const compiled: PresentationCallbacks = {};
  if (isRuntimeCallback(valueFormatter)) compiled.valueFormatter = valueFormatter;
  if (typeof cellClassName === "string" || isRuntimeCallback(cellClassName)) {
    compiled.cellClassName = cellClassName;
  }
  if (isRuntimeCellRenderer(cellRenderer)) compiled.cellRenderer = cellRenderer;
  return {
    hasPresentation: Object.keys(compiled).length > 0,
    compiled,
  };
}

function isRuntimeCallback(value: BrunoTableRuntimeRecord[PropertyKey]): value is RuntimeCallback {
  return typeof value === "function";
}

function isRuntimeCellRenderer(
  value: BrunoTableRuntimeRecord[PropertyKey],
): value is RuntimeCellRenderer {
  return typeof value === "function";
}

function isRuntimeComputedGetter(
  value: BrunoTableRuntimeRecord[PropertyKey],
): value is RuntimeComputedGetter {
  return typeof value === "function";
}

function describeRuntimeColumnId(value: BrunoTableRuntimeRecord[PropertyKey]): string {
  if (typeof value === "object" && value !== null) {
    return Object.prototype.toString.call(value);
  }
  return String(value);
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
    !columnIdWhitespacePattern.test(suffix) &&
    suffix === suffix.toUpperCase()
  );
}
