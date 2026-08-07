import type { BrunoTableBuiltInValueType, BrunoTableColumnId } from "../public-types";

const columnIdPrefix = "COL_ID_";
const columnIdSuffixStartPattern = /^[A-Z0-9_]/u;
const builtInValueTypes = new Set<BrunoTableBuiltInValueType>([
  "text",
  "number",
  "bigint",
  "boolean",
]);

type RuntimeColumnDefinition = Readonly<Record<PropertyKey, unknown>>;
type RuntimeCallback = (...parameters: never[]) => unknown;

type CompiledColumnBase = {
  readonly columnId: BrunoTableColumnId;
  readonly headerName: string;
  readonly valueType: BrunoTableBuiltInValueType;
  readonly valueFormatter?: RuntimeCallback;
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
  const hasIsEditable = Object.hasOwn(candidate, "isEditable");
  const hasValueFormatter = Object.hasOwn(candidate, "valueFormatter");
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
  if (!isBuiltInValueType(valueType)) {
    throw new ColumnConfigurationError(
      `BrunoTable valueType must be text, number, bigint, or boolean for column: ${columnId}`,
    );
  }

  const valueFormatter = hasValueFormatter ? candidate["valueFormatter"] : undefined;
  if (hasValueFormatter && typeof valueFormatter !== "function") {
    throw new ColumnConfigurationError(
      `BrunoTable valueFormatter must be a function when provided: ${columnId}`,
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

    return Object.freeze({
      kind: "field",
      columnId,
      headerName,
      valueType,
      field,
      ...(typeof isEditable === "boolean" || typeof isEditable === "function"
        ? { isEditable: isEditable as boolean | RuntimeCallback }
        : {}),
      ...(typeof valueFormatter === "function"
        ? { valueFormatter: valueFormatter as RuntimeCallback }
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

  const fields = Object.freeze(candidateFields) as readonly [string, ...string[]];

  return Object.freeze({
    kind: "computed",
    columnId,
    headerName,
    valueType,
    fields,
    valueGetter: valueGetter as RuntimeCallback,
    ...(typeof valueFormatter === "function"
      ? { valueFormatter: valueFormatter as RuntimeCallback }
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

function isBuiltInValueType(value: unknown): value is BrunoTableBuiltInValueType {
  return typeof value === "string" && builtInValueTypes.has(value as BrunoTableBuiltInValueType);
}
