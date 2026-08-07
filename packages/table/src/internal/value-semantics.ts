import type {
  BrunoTableBuiltInValueType,
  BrunoTableCellAlign,
  BrunoTableDecodeResult,
  BrunoTableEditorFamily,
  BrunoTableEditorLayout,
  BrunoTableFilterFamily,
  BrunoTableJsonValue,
  BrunoTableNumberFormat,
  BrunoTableOrdering,
} from "../public-types";

type SemanticsOverrides = {
  readonly cellAlign?: unknown;
  readonly editorLayout?: unknown;
  readonly width?: unknown;
  readonly format?: unknown;
};

type RuntimeValueTypeDescriptor = {
  readonly codecId: string;
  readonly codecVersion: number;
  readonly filterFamily: BrunoTableFilterFamily;
  readonly editorFamily: BrunoTableEditorFamily;
  readonly cellAlign: BrunoTableCellAlign;
  readonly editorLayout: BrunoTableEditorLayout;
  readonly defaultWidth: number;
  readonly decodeRuntime: (input: unknown) => BrunoTableDecodeResult<unknown>;
  readonly equivalent: (left: unknown, right: unknown) => boolean;
  readonly compare: (left: unknown, right: unknown) => BrunoTableOrdering;
  readonly formatCanonicalText: (value: unknown) => string;
  readonly parseCanonicalText: (text: string) => BrunoTableDecodeResult<unknown>;
  readonly formatDisplay: (value: unknown) => string;
  readonly encodePersisted: (value: unknown) => BrunoTableJsonValue;
  readonly decodePersisted: (input: unknown) => BrunoTableDecodeResult<unknown>;
};

export type CompiledColumnValueSemantics = {
  readonly codecId: string;
  readonly codecVersion: number;
  readonly filterFamily: BrunoTableFilterFamily;
  readonly editorFamily: BrunoTableEditorFamily;
  readonly cellAlign: BrunoTableCellAlign;
  readonly editorLayout: BrunoTableEditorLayout;
  readonly width: number;
  readonly decodeRuntime: (input: unknown) => BrunoTableDecodeResult<unknown>;
  readonly equivalent: (left: unknown, right: unknown) => boolean;
  readonly compare: (left: unknown, right: unknown) => BrunoTableOrdering;
  readonly formatCanonicalText: (value: unknown) => string;
  readonly parseCanonicalText: (text: string) => BrunoTableDecodeResult<unknown>;
  readonly formatDisplay: (value: unknown) => string;
  readonly encodePersisted: (value: unknown) => BrunoTableJsonValue;
  readonly decodePersisted: (input: unknown) => BrunoTableDecodeResult<unknown>;
};

export class ValueSemanticsConfigurationError extends TypeError {}

const numberTextPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;
const bigIntTextPattern = /^-?\d+$/u;

const builtInValueTypes: Readonly<Record<BrunoTableBuiltInValueType, RuntimeValueTypeDescriptor>> =
  Object.freeze({
    text: createTextValueType(),
    number: createNumberValueType(),
    bigint: createBigIntValueType(),
    boolean: createBooleanValueType(),
  });

export function compileColumnValueSemantics(
  selection: unknown,
  overrides: SemanticsOverrides,
): CompiledColumnValueSemantics {
  const builtInSelection = isBuiltInValueType(selection) ? selection : undefined;
  const descriptor =
    builtInSelection === undefined
      ? snapshotCustomValueType(selection)
      : builtInValueTypes[builtInSelection];

  const cellAlign = overrides.cellAlign ?? descriptor.cellAlign;
  if (!isCellAlign(cellAlign)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable cellAlign must be start, center, or end when provided.",
    );
  }

  const editorLayout = overrides.editorLayout ?? descriptor.editorLayout;
  if (!isEditorLayout(editorLayout)) {
    throw new ValueSemanticsConfigurationError(
      "BrunoTable editorLayout must be inline, center, or fullWidth when provided.",
    );
  }

  const width = overrides.width ?? descriptor.defaultWidth;
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

  let formatDisplay = (value: unknown) => descriptor.formatDisplay(value);
  if (format !== undefined) {
    if (!isRecord(format)) {
      throw new ValueSemanticsConfigurationError(
        "BrunoTable number format must be an object when provided.",
      );
    }
    const formatSnapshot = Object.freeze({ ...format }) as BrunoTableNumberFormat;
    let formatter: Intl.NumberFormat;
    try {
      formatter = new Intl.NumberFormat(undefined, formatSnapshot);
    } catch (error) {
      throw new ValueSemanticsConfigurationError(
        `BrunoTable number format is invalid: ${safeErrorMessage(error)}`,
      );
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
    decodeRuntime: (input) => descriptor.decodeRuntime(input),
    equivalent: (left, right) => descriptor.equivalent(left, right),
    compare: (left, right) => descriptor.compare(left, right),
    formatCanonicalText: (value) => descriptor.formatCanonicalText(value),
    parseCanonicalText: (text) => descriptor.parseCanonicalText(text),
    formatDisplay,
    encodePersisted: (value) => descriptor.encodePersisted(value),
    decodePersisted: (input) => descriptor.decodePersisted(input),
  });
}

function snapshotCustomValueType(selection: unknown): RuntimeValueTypeDescriptor {
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
  const decodeRuntime = selection["decodeRuntime"];
  const equivalent = selection["equivalent"];
  const compare = selection["compare"];
  const formatCanonicalText = selection["formatCanonicalText"];
  const parseCanonicalText = selection["parseCanonicalText"];
  const formatDisplay = selection["formatDisplay"];
  const encodePersisted = selection["encodePersisted"];
  const decodePersisted = selection["decodePersisted"];

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

  const decodeRuntimeFunction = requireFunction(decodeRuntime, "decodeRuntime");
  const equivalentFunction = requireFunction(equivalent, "equivalent");
  const compareFunction = requireFunction(compare, "compare");
  const formatCanonicalTextFunction = requireFunction(formatCanonicalText, "formatCanonicalText");
  const parseCanonicalTextFunction = requireFunction(parseCanonicalText, "parseCanonicalText");
  const formatDisplayFunction = requireFunction(formatDisplay, "formatDisplay");
  const encodePersistedFunction = requireFunction(encodePersisted, "encodePersisted");
  const decodePersistedFunction = requireFunction(decodePersisted, "decodePersisted");

  const descriptor: RuntimeValueTypeDescriptor = {
    codecId,
    codecVersion,
    filterFamily,
    editorFamily,
    cellAlign,
    editorLayout,
    defaultWidth,
    decodeRuntime: (input) => safeDecode(decodeRuntimeFunction, input, "decodeRuntime"),
    equivalent: (left, right) =>
      validateBoolean(Reflect.apply(equivalentFunction, undefined, [left, right])),
    compare: (left, right) =>
      validateOrdering(Reflect.apply(compareFunction, undefined, [left, right])),
    formatCanonicalText: (value) =>
      validateText(Reflect.apply(formatCanonicalTextFunction, undefined, [value])),
    parseCanonicalText: (text) =>
      safeDecode(parseCanonicalTextFunction, text, "parseCanonicalText"),
    formatDisplay: (value) =>
      validateText(Reflect.apply(formatDisplayFunction, undefined, [value])),
    encodePersisted: (value) =>
      validateJsonValue(Reflect.apply(encodePersistedFunction, undefined, [value])),
    decodePersisted: (input) => safeDecode(decodePersistedFunction, input, "decodePersisted"),
  };
  return Object.freeze(descriptor);
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
  input: unknown,
  type: string,
  decode: (value: unknown) => BrunoTableDecodeResult<TValue>,
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

function assertFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("BrunoTable Number Value Type received a non-finite value.");
  }
  return value;
}

function assertString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("BrunoTable Text Value Type received a non-string value.");
  }
  return value;
}

function assertBigInt(value: unknown): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError("BrunoTable BigInt Value Type received a non-bigint value.");
  }
  return value;
}

function assertBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("BrunoTable Boolean Value Type received a non-boolean value.");
  }
  return value;
}

function safeDecode(
  decoder: Function,
  input: unknown,
  operation: "decodePersisted" | "decodeRuntime" | "parseCanonicalText",
): BrunoTableDecodeResult<unknown> {
  try {
    return validateDecodeResult(Reflect.apply(decoder, undefined, [input]));
  } catch {
    return failure(`BrunoTable Value Type ${operation} failed.`);
  }
}

function validateBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("BrunoTable Value Type equivalent must return a boolean.");
  }
  return value;
}

function validateDecodeResult(value: unknown): BrunoTableDecodeResult<unknown> {
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

function validateOrdering(value: unknown): BrunoTableOrdering {
  if (value !== -1 && value !== 0 && value !== 1) {
    throw new TypeError("BrunoTable Value Type compare must return -1, 0, or 1.");
  }
  return value;
}

function validateText(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("BrunoTable Value Type formatter must return a string.");
  }
  return value;
}

function validateJsonValue(value: unknown): BrunoTableJsonValue {
  if (!isJsonValue(value, new Set())) {
    throw new TypeError("BrunoTable Value Type persisted output must be JSON-safe.");
  }
  return value;
}

function isJsonValue(value: unknown, ancestors: Set<object>): value is BrunoTableJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isBuiltInValueType(value: unknown): value is BrunoTableBuiltInValueType {
  return value === "text" || value === "number" || value === "bigint" || value === "boolean";
}

function isFilterFamily(value: unknown): value is BrunoTableFilterFamily {
  return (
    value === "boolean" ||
    value === "equality" ||
    value === "numeric" ||
    value === "select" ||
    value === "text"
  );
}

function isEditorFamily(value: unknown): value is BrunoTableEditorFamily {
  return (
    value === "bigdecimal" ||
    value === "bigint" ||
    value === "boolean" ||
    value === "number" ||
    value === "select" ||
    value === "text"
  );
}

function isCellAlign(value: unknown): value is BrunoTableCellAlign {
  return value === "start" || value === "center" || value === "end";
}

function isEditorLayout(value: unknown): value is BrunoTableEditorLayout {
  return value === "inline" || value === "center" || value === "fullWidth";
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFunction(value: unknown, name: string): Function {
  if (typeof value !== "function") {
    throw new ValueSemanticsConfigurationError(`BrunoTable Value Type ${name} must be a function.`);
  }
  return value;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
