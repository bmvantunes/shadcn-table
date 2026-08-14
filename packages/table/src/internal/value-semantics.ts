import type {
  BrunoTableBuiltInValueType,
  BrunoTableAggregateResults,
  BrunoTableCellAlign,
  BrunoTableDecodeResult,
  BrunoTableEditorFamily,
  BrunoTableEditorLayout,
  BrunoTableFilterFamily,
  BrunoTableJsonValue,
  BrunoTableNumberFormat,
  BrunoTableOrdering,
} from "../public-types";
import type { BrunoTableRuntimeRecord } from "./runtime-value";

type SemanticsOverrides = {
  readonly cellAlign?: BrunoTableRuntimeRecord[PropertyKey];
  readonly editorLayout?: BrunoTableRuntimeRecord[PropertyKey];
  readonly width?: BrunoTableRuntimeRecord[PropertyKey];
  readonly format?: BrunoTableRuntimeRecord[PropertyKey];
};

/**
 * The erased callback contract at the custom Value Type boundary.
 *
 * Custom descriptors are validated before these callbacks are owned by the compiled semantics
 * plan. Their outputs remain in the complete runtime value domain until the corresponding result
 * validator narrows them to the public contract.
 */
interface RuntimeValueTypeCallbacks {
  readonly decodeRuntime: (
    this: void,
    input: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
  readonly equivalent: (
    this: void,
    left: BrunoTableRuntimeRecord[PropertyKey],
    right: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
  readonly compare: (
    this: void,
    left: BrunoTableRuntimeRecord[PropertyKey],
    right: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
  readonly formatCanonicalText: (
    this: void,
    value: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
  readonly parseCanonicalText: (this: void, text: string) => BrunoTableRuntimeRecord[PropertyKey];
  readonly formatDisplay: (
    this: void,
    value: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
  readonly encodePersisted: (
    this: void,
    value: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
  readonly decodePersisted: (
    this: void,
    input: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableRuntimeRecord[PropertyKey];
}

type RuntimeValueTypeDescriptor = {
  readonly codecId: string;
  readonly codecVersion: number;
  readonly filterFamily: BrunoTableFilterFamily;
  readonly editorFamily: BrunoTableEditorFamily;
  readonly cellAlign: BrunoTableCellAlign;
  readonly editorLayout: BrunoTableEditorLayout;
  readonly defaultWidth: number;
  readonly aggregateResults: BrunoTableAggregateResults;
  readonly decodeRuntime: (
    this: void,
    input: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]>;
  readonly equivalent: (
    this: void,
    left: BrunoTableRuntimeRecord[PropertyKey],
    right: BrunoTableRuntimeRecord[PropertyKey],
  ) => boolean;
  readonly compare: (
    this: void,
    left: BrunoTableRuntimeRecord[PropertyKey],
    right: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableOrdering;
  readonly formatCanonicalText: (this: void, value: BrunoTableRuntimeRecord[PropertyKey]) => string;
  readonly parseCanonicalText: (
    this: void,
    text: string,
  ) => BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]>;
  readonly formatDisplay: (this: void, value: BrunoTableRuntimeRecord[PropertyKey]) => string;
  readonly encodePersisted: (
    this: void,
    value: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableJsonValue;
  readonly decodePersisted: (
    this: void,
    input: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]>;
};

export type CompiledColumnValueSemantics = {
  readonly codecId: string;
  readonly codecVersion: number;
  readonly filterFamily: BrunoTableFilterFamily;
  readonly editorFamily: BrunoTableEditorFamily;
  readonly cellAlign: BrunoTableCellAlign;
  readonly editorLayout: BrunoTableEditorLayout;
  readonly width: number;
  readonly aggregateResults: BrunoTableAggregateResults;
  readonly decodeRuntime: (
    this: void,
    input: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]>;
  readonly equivalent: (
    this: void,
    left: BrunoTableRuntimeRecord[PropertyKey],
    right: BrunoTableRuntimeRecord[PropertyKey],
  ) => boolean;
  readonly compare: (
    this: void,
    left: BrunoTableRuntimeRecord[PropertyKey],
    right: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableOrdering;
  readonly formatCanonicalText: (this: void, value: BrunoTableRuntimeRecord[PropertyKey]) => string;
  readonly parseCanonicalText: (
    this: void,
    text: string,
  ) => BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]>;
  readonly formatDisplay: (this: void, value: BrunoTableRuntimeRecord[PropertyKey]) => string;
  readonly encodePersisted: (
    this: void,
    value: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableJsonValue;
  readonly decodePersisted: (
    this: void,
    input: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]>;
};

export class ValueSemanticsConfigurationError extends TypeError {}

const numberTextPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;
const bigIntTextPattern = /^-?\d+$/u;
const numberFormatOptionKeys = new Set<PropertyKey>([
  "compactDisplay",
  "currency",
  "currencyDisplay",
  "currencySign",
  "localeMatcher",
  "maximumFractionDigits",
  "maximumSignificantDigits",
  "minimumFractionDigits",
  "minimumIntegerDigits",
  "minimumSignificantDigits",
  "notation",
  "numberingSystem",
  "roundingIncrement",
  "roundingMode",
  "roundingPriority",
  "signDisplay",
  "style",
  "trailingZeroDisplay",
  "unit",
  "unitDisplay",
  "useGrouping",
]);
const aggregateFunctionNames = new Set<PropertyKey>(["countDistinct", "sum", "min", "max", "avg"]);
const builtInScalarAggregateResults = Object.freeze({
  countDistinct: "bigint",
  min: "self",
  max: "self",
} satisfies BrunoTableAggregateResults);
const builtInBigIntAggregateResults = Object.freeze({
  ...builtInScalarAggregateResults,
  sum: "self",
} satisfies BrunoTableAggregateResults);

const builtInValueTypes: Readonly<Record<BrunoTableBuiltInValueType, RuntimeValueTypeDescriptor>> =
  Object.freeze({
    text: createTextValueType(),
    number: createNumberValueType(),
    bigint: createBigIntValueType(),
    boolean: createBooleanValueType(),
  });

export function compileColumnValueSemantics(
  selection: BrunoTableRuntimeRecord[PropertyKey],
  overrides: SemanticsOverrides,
): CompiledColumnValueSemantics {
  const builtInSelection = isBuiltInValueType(selection) ? selection : undefined;
  const descriptor =
    builtInSelection === undefined
      ? snapshotCustomValueType(selection)
      : builtInValueTypes[builtInSelection];

  const cellAlign = overrides.cellAlign === undefined ? descriptor.cellAlign : overrides.cellAlign;
  if (!isCellAlign(cellAlign)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable cellAlign must be start, center, or end when provided.",
    );
  }

  const editorLayout =
    overrides.editorLayout === undefined ? descriptor.editorLayout : overrides.editorLayout;
  if (!isEditorLayout(editorLayout)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable editorLayout must be inline, center, or fullWidth when provided.",
    );
  }

  const width = overrides.width === undefined ? descriptor.defaultWidth : overrides.width;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable width must be a positive finite number when provided.",
    );
  }

  const format = overrides.format;
  if (format !== undefined && builtInSelection !== "number") {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable format is supported only by the built-in number Value Type.",
    );
  }

  let formatDisplay = (value: BrunoTableRuntimeRecord[PropertyKey]) =>
    descriptor.formatDisplay(value);
  if (format !== undefined) {
    if (!isRecord(format)) {
      throw new ValueSemanticsConfigurationError(
        "BrunoTable number format must be an object when provided.",
      );
    }
    for (const key of Reflect.ownKeys(format)) {
      if (!numberFormatOptionKeys.has(key)) {
        throw new ValueSemanticsConfigurationError(
          `BrunoTable number format does not accept ${String(key)}.`,
        );
      }
    }
    // SAFETY: Own-key validation above limits this snapshot to Intl.NumberFormat option names;
    // Intl.NumberFormat validates each option value at the boundary immediately below.
    const formatSnapshot = Object.freeze({ ...format }) as BrunoTableNumberFormat;
    let formatter: Intl.NumberFormat;
    try {
      formatter = new Intl.NumberFormat(BRUNO_TABLE_NUMBER_DISPLAY_LOCALE, formatSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new ValueSemanticsConfigurationError(`BrunoTable number format is invalid: ${message}`);
    }
    formatDisplay = (value) => formatter.format(assertFiniteNumber(value));
  }

  return Object.freeze({
    codecId: descriptor.codecId,
    codecVersion: descriptor.codecVersion,
    filterFamily: descriptor.filterFamily,
    editorFamily: descriptor.editorFamily,
    cellAlign,
    editorLayout,
    width,
    aggregateResults: descriptor.aggregateResults,
    decodeRuntime: (input) => descriptor.decodeRuntime(input),
    equivalent: (left, right) => descriptor.equivalent(left, right),
    compare: (left, right) => descriptor.compare(left, right),
    formatCanonicalText: (value) => descriptor.formatCanonicalText(value),
    parseCanonicalText: (text) =>
      typeof text === "string"
        ? descriptor.parseCanonicalText(text)
        : { _tag: "Failure", message: "Expected canonical text input." },
    formatDisplay,
    encodePersisted: (value) => descriptor.encodePersisted(value),
    decodePersisted: (input) => descriptor.decodePersisted(input),
  });
}

const BRUNO_TABLE_NUMBER_DISPLAY_LOCALE = "en-US";

function snapshotCustomValueType(
  selection: BrunoTableRuntimeRecord[PropertyKey],
): RuntimeValueTypeDescriptor {
  if (!isRecord(selection)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable valueType must be text, number, bigint, boolean, or a Value Type descriptor.",
    );
  }

  const codecId = selection["codecId"];
  const codecVersion = selection["codecVersion"];
  const filterFamily = selection["filterFamily"];
  const editorFamily = selection["editorFamily"];
  const cellAlign = selection["cellAlign"];
  const editorLayout = selection["editorLayout"];
  const defaultWidth = selection["defaultWidth"];
  const aggregateResults = snapshotAggregateResults(selection["aggregateResults"]);
  if (typeof codecId !== "string" || codecId.trim().length === 0) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable Value Type codecId must be a non-empty string.",
    );
  }
  if (typeof codecVersion !== "number" || !Number.isSafeInteger(codecVersion) || codecVersion < 1) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable Value Type codecVersion must be a positive safe integer.",
    );
  }
  if (!isFilterFamily(filterFamily)) {
    throw new ValueSemanticsConfigurationError("BrunoTable Value Type filterFamily is invalid.");
  }
  if (!isEditorFamily(editorFamily)) {
    throw new ValueSemanticsConfigurationError("BrunoTable Value Type editorFamily is invalid.");
  }
  if (!isCellAlign(cellAlign)) {
    throw new ValueSemanticsConfigurationError("BrunoTable Value Type cellAlign is invalid.");
  }
  if (!isEditorLayout(editorLayout)) {
    throw new ValueSemanticsConfigurationError("BrunoTable Value Type editorLayout is invalid.");
  }
  if (typeof defaultWidth !== "number" || !Number.isFinite(defaultWidth) || defaultWidth <= 0) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable Value Type defaultWidth must be a positive finite number.",
    );
  }

  if (!hasRuntimeValueTypeCallbacks(selection)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable Value Type callbacks must all be functions.",
    );
  }
  const {
    decodeRuntime,
    equivalent,
    compare,
    formatCanonicalText,
    parseCanonicalText,
    formatDisplay,
    encodePersisted,
    decodePersisted,
  } = selection;

  const descriptor: RuntimeValueTypeDescriptor = {
    codecId,
    codecVersion,
    filterFamily,
    editorFamily,
    cellAlign,
    editorLayout,
    defaultWidth,
    aggregateResults,
    decodeRuntime: (input) => safeDecode(decodeRuntime, input, "decodeRuntime"),
    equivalent: (left, right) => validateBoolean(equivalent(left, right)),
    compare: (left, right) => validateOrdering(compare(left, right)),
    formatCanonicalText: (value) => validateText(formatCanonicalText(value)),
    parseCanonicalText: (text) => safeParseCanonicalText(parseCanonicalText, text),
    formatDisplay: (value) => validateText(formatDisplay(value)),
    encodePersisted: (value) => validateJsonValue(encodePersisted(value)),
    decodePersisted: (input) => safeDecode(decodePersisted, input, "decodePersisted"),
  };
  return Object.freeze(descriptor);
}

function snapshotAggregateResults(
  input: BrunoTableRuntimeRecord[PropertyKey],
): BrunoTableAggregateResults {
  if (input === undefined) return Object.freeze({});
  if (!isRecord(input)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable Value Type aggregateResults must be an object when provided.",
    );
  }

  const snapshot: Partial<Record<string, "self" | "bigint">> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (!aggregateFunctionNames.has(key) || typeof key !== "string") {
      throw new ValueSemanticsConfigurationError(
        `BrunoTable Value Type aggregateResults does not accept ${String(key)}.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new ValueSemanticsConfigurationError(
        "BrunoTable Value Type aggregateResults must contain enumerable data properties.",
      );
    }
    if (descriptor.value !== "self" && descriptor.value !== "bigint") {
      throw new ValueSemanticsConfigurationError(
        `BrunoTable Value Type aggregateResults.${key} is invalid.`,
      );
    }
    snapshot[key] = descriptor.value;
  }

  return Object.freeze(snapshot);
}

function createTextValueType(): RuntimeValueTypeDescriptor {
  const descriptor: RuntimeValueTypeDescriptor = {
    codecId: "@bruno/table/text",
    codecVersion: 1,
    filterFamily: "text",
    editorFamily: "text",
    cellAlign: "start",
    editorLayout: "inline",
    defaultWidth: 160,
    aggregateResults: builtInScalarAggregateResults,
    decodeRuntime: (input) =>
      typeof input === "string" ? success(input) : failure("Expected a string value."),
    equivalent: (left, right) => assertString(left) === assertString(right),
    compare: (left, right) => comparePrimitive(assertString(left), assertString(right)),
    formatCanonicalText: assertString,
    parseCanonicalText: success,
    formatDisplay: assertString,
    encodePersisted: (value) => persisted("text", assertString(value)),
    decodePersisted: (input) =>
      decodePersistedTag(input, "text", (value) =>
        typeof value === "string" ? success(value) : failure("Persisted text value is invalid."),
      ),
  };
  return Object.freeze(descriptor);
}

function createNumberValueType(): RuntimeValueTypeDescriptor {
  const descriptor: RuntimeValueTypeDescriptor = {
    codecId: "@bruno/table/number",
    codecVersion: 1,
    filterFamily: "numeric",
    editorFamily: "number",
    cellAlign: "end",
    editorLayout: "inline",
    defaultWidth: 120,
    aggregateResults: builtInScalarAggregateResults,
    decodeRuntime: (input) =>
      typeof input === "number" && Number.isFinite(input)
        ? success(input)
        : failure("Expected a finite number value."),
    equivalent: (left, right) => assertFiniteNumber(left) === assertFiniteNumber(right),
    compare: (left, right) => comparePrimitive(assertFiniteNumber(left), assertFiniteNumber(right)),
    formatCanonicalText: (value) => String(assertFiniteNumber(value)),
    parseCanonicalText: parseNumberText,
    formatDisplay: (value) => String(assertFiniteNumber(value)),
    encodePersisted: (value) => persisted("number", String(assertFiniteNumber(value))),
    decodePersisted: (input) =>
      decodePersistedTag(input, "number", (value) =>
        typeof value === "string"
          ? parseNumberText(value)
          : failure("Persisted number value is invalid."),
      ),
  };
  return Object.freeze(descriptor);
}

function createBigIntValueType(): RuntimeValueTypeDescriptor {
  const descriptor: RuntimeValueTypeDescriptor = {
    codecId: "@bruno/table/bigint",
    codecVersion: 1,
    filterFamily: "numeric",
    editorFamily: "bigint",
    cellAlign: "end",
    editorLayout: "inline",
    defaultWidth: 140,
    aggregateResults: builtInBigIntAggregateResults,
    decodeRuntime: (input) =>
      typeof input === "bigint" ? success(input) : failure("Expected a bigint value."),
    equivalent: (left, right) => assertBigInt(left) === assertBigInt(right),
    compare: (left, right) => comparePrimitive(assertBigInt(left), assertBigInt(right)),
    formatCanonicalText: (value) => assertBigInt(value).toString(10),
    parseCanonicalText: parseBigIntText,
    formatDisplay: (value) => assertBigInt(value).toString(10),
    encodePersisted: (value) => persisted("bigint", assertBigInt(value).toString(10)),
    decodePersisted: (input) =>
      decodePersistedTag(input, "bigint", (value) =>
        typeof value === "string"
          ? parseBigIntText(value)
          : failure("Persisted bigint value is invalid."),
      ),
  };
  return Object.freeze(descriptor);
}

function createBooleanValueType(): RuntimeValueTypeDescriptor {
  const descriptor: RuntimeValueTypeDescriptor = {
    codecId: "@bruno/table/boolean",
    codecVersion: 1,
    filterFamily: "boolean",
    editorFamily: "boolean",
    cellAlign: "center",
    editorLayout: "center",
    defaultWidth: 88,
    aggregateResults: builtInScalarAggregateResults,
    decodeRuntime: (input) =>
      typeof input === "boolean" ? success(input) : failure("Expected a boolean value."),
    equivalent: (left, right) => assertBoolean(left) === assertBoolean(right),
    compare: (left, right) => {
      const leftBoolean = assertBoolean(left);
      const rightBoolean = assertBoolean(right);
      return leftBoolean === rightBoolean ? 0 : leftBoolean ? 1 : -1;
    },
    formatCanonicalText: (value) => String(assertBoolean(value)),
    parseCanonicalText: (text) =>
      text === "true"
        ? success(true)
        : text === "false"
          ? success(false)
          : failure("Expected true or false."),
    formatDisplay: (value) => String(assertBoolean(value)),
    encodePersisted: (value) => persisted("boolean", assertBoolean(value)),
    decodePersisted: (input) =>
      decodePersistedTag(input, "boolean", (value) =>
        typeof value === "boolean"
          ? success(value)
          : failure("Persisted boolean value is invalid."),
      ),
  };
  return Object.freeze(descriptor);
}

function parseNumberText(text: string): BrunoTableDecodeResult<number> {
  if (!numberTextPattern.test(text)) return failure("Expected a finite decimal number.");
  const value = Number(text);
  return Number.isFinite(value) ? success(value) : failure("Expected a finite decimal number.");
}

function parseBigIntText(text: string): BrunoTableDecodeResult<bigint> {
  return bigIntTextPattern.test(text)
    ? success(BigInt(text))
    : failure("Expected signed base-10 integer digits.");
}

function persisted(type: string, value: BrunoTableJsonValue): BrunoTableJsonValue {
  return { $brunoTableValue: type, version: 1, value };
}

function decodePersistedTag<TValue>(
  input: BrunoTableRuntimeRecord[PropertyKey],
  type: string,
  decode: (
    this: void,
    value: BrunoTableRuntimeRecord[PropertyKey],
  ) => BrunoTableDecodeResult<TValue>,
): BrunoTableDecodeResult<TValue> {
  return isRecord(input) && input["$brunoTableValue"] === type && input["version"] === 1
    ? decode(input["value"])
    : failure(`Persisted ${type} value has an invalid tag.`);
}

function comparePrimitive<TValue extends string | number | bigint>(
  left: TValue,
  right: TValue,
): BrunoTableOrdering {
  return left === right ? 0 : left < right ? -1 : 1;
}

function success<TValue>(value: TValue): BrunoTableDecodeResult<TValue> {
  return { _tag: "Success", value };
}

function failure(message: string): BrunoTableDecodeResult<never> {
  return { _tag: "Failure", message };
}

function assertFiniteNumber(value: BrunoTableRuntimeRecord[PropertyKey]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("BrunoTable Number Value Type received a non-finite value.");
  }
  return value;
}

function assertString(value: BrunoTableRuntimeRecord[PropertyKey]): string {
  if (typeof value !== "string") {
    throw new TypeError("BrunoTable Text Value Type received a non-string value.");
  }
  return value;
}

function assertBigInt(value: BrunoTableRuntimeRecord[PropertyKey]): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError("BrunoTable BigInt Value Type received a non-bigint value.");
  }
  return value;
}

function assertBoolean(value: BrunoTableRuntimeRecord[PropertyKey]): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("BrunoTable Boolean Value Type received a non-boolean value.");
  }
  return value;
}

function safeDecode(
  decoder: RuntimeValueTypeCallbacks["decodeRuntime"],
  input: BrunoTableRuntimeRecord[PropertyKey],
  operation: "decodePersisted" | "decodeRuntime",
): BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]> {
  try {
    return validateDecodeResult(decoder(input));
  } catch {
    return failure(`BrunoTable Value Type ${operation} failed.`);
  }
}

function safeParseCanonicalText(
  decoder: RuntimeValueTypeCallbacks["parseCanonicalText"],
  text: string,
): BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]> {
  try {
    return validateDecodeResult(decoder(text));
  } catch {
    return failure("BrunoTable Value Type parseCanonicalText failed.");
  }
}

function validateBoolean(value: BrunoTableRuntimeRecord[PropertyKey]): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("BrunoTable Value Type equivalent must return a boolean.");
  }
  return value;
}

function validateDecodeResult(
  value: BrunoTableRuntimeRecord[PropertyKey],
): BrunoTableDecodeResult<BrunoTableRuntimeRecord[PropertyKey]> {
  if (!isRecord(value) || (value["_tag"] !== "Success" && value["_tag"] !== "Failure")) {
    throw new TypeError("BrunoTable Value Type returned an invalid decode result.");
  }
  if (value["_tag"] === "Failure") {
    if (typeof value["message"] !== "string" || value["message"].trim().length === 0) {
      throw new TypeError("BrunoTable Value Type returned an invalid decode failure.");
    }
    return { _tag: "Failure", message: value["message"] };
  }
  return { _tag: "Success", value: value["value"] };
}

function validateOrdering(value: BrunoTableRuntimeRecord[PropertyKey]): BrunoTableOrdering {
  if (value !== -1 && value !== 0 && value !== 1) {
    throw new TypeError("BrunoTable Value Type compare must return -1, 0, or 1.");
  }
  return value;
}

function validateText(value: BrunoTableRuntimeRecord[PropertyKey]): string {
  if (typeof value !== "string") {
    throw new TypeError("BrunoTable Value Type formatter must return a string.");
  }
  return value;
}

function validateJsonValue(value: BrunoTableRuntimeRecord[PropertyKey]): BrunoTableJsonValue {
  if (!isJsonValue(value, new Set())) {
    throw new TypeError("BrunoTable Value Type persisted output must be JSON-safe.");
  }
  return value;
}

function isJsonValue(
  value: BrunoTableRuntimeRecord[PropertyKey],
  ancestors: Set<object>,
): value is BrunoTableJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? isDenseJsonArray(value, ancestors)
    : isRecord(value) && isJsonObject(value, ancestors);
  ancestors.delete(value);
  return valid;
}

function isDenseJsonArray(
  value: readonly BrunoTableRuntimeRecord[PropertyKey][],
  ancestors: Set<object>,
): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) return false;

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isJsonValue(value[index], ancestors)) return false;
  }
  return true;
}

function isJsonObject(value: BrunoTableRuntimeRecord, ancestors: Set<object>): boolean {
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string" || !Object.propertyIsEnumerable.call(value, key))
  ) {
    return false;
  }
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined && "value" in descriptor && isJsonValue(descriptor.value, ancestors)
    );
  });
}

function isBuiltInValueType(
  value: BrunoTableRuntimeRecord[PropertyKey],
): value is BrunoTableBuiltInValueType {
  return value === "text" || value === "number" || value === "bigint" || value === "boolean";
}

function isFilterFamily(
  value: BrunoTableRuntimeRecord[PropertyKey],
): value is BrunoTableFilterFamily {
  return (
    value === "boolean" ||
    value === "equality" ||
    value === "numeric" ||
    value === "select" ||
    value === "text"
  );
}

function isEditorFamily(
  value: BrunoTableRuntimeRecord[PropertyKey],
): value is BrunoTableEditorFamily {
  return (
    value === "bigdecimal" ||
    value === "bigint" ||
    value === "boolean" ||
    value === "number" ||
    value === "select" ||
    value === "text"
  );
}

function isCellAlign(value: BrunoTableRuntimeRecord[PropertyKey]): value is BrunoTableCellAlign {
  return value === "start" || value === "center" || value === "end";
}

function isEditorLayout(
  value: BrunoTableRuntimeRecord[PropertyKey],
): value is BrunoTableEditorLayout {
  return value === "inline" || value === "center" || value === "fullWidth";
}

function isRecord(value: BrunoTableRuntimeRecord[PropertyKey]): value is BrunoTableRuntimeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRuntimeValueTypeCallbacks(
  value: BrunoTableRuntimeRecord,
): value is BrunoTableRuntimeRecord & RuntimeValueTypeCallbacks {
  return (
    typeof value["decodeRuntime"] === "function" &&
    typeof value["equivalent"] === "function" &&
    typeof value["compare"] === "function" &&
    typeof value["formatCanonicalText"] === "function" &&
    typeof value["parseCanonicalText"] === "function" &&
    typeof value["formatDisplay"] === "function" &&
    typeof value["encodePersisted"] === "function" &&
    typeof value["decodePersisted"] === "function"
  );
}
