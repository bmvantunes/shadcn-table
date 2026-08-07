import {
  compareTrustedWireSafeBigDecimal,
  inspectWireSafeBigDecimal,
} from "@effect-view-server/effect-utils";
import * as BigDecimal from "effect/BigDecimal";
import * as Option from "effect/Option";

import { BrunoTableComputedColumn } from "./public-types";

import type {
  BrunoTableCellAlign,
  BrunoTableComputedColumnDefinition,
  BrunoTableComputedColumnDependencies,
  BrunoTableComputedColumnInput,
  BrunoTableDecodeResult,
  BrunoTableEditorLayout,
  BrunoTableFieldColumnDefinition,
  BrunoTableFieldKey,
  BrunoTableNonEmptyFields,
  BrunoTableNonNullish,
  BrunoTableOrdering,
  BrunoTableValueType,
} from "./public-types";

const codecId = "@bruno/table/effect/bigdecimal";
const persistedType = "effect-bigdecimal";
const codecVersion = 1;
const trustedWireSafeValues = new WeakSet<object>();

function success<TValue>(value: TValue): BrunoTableDecodeResult<TValue> {
  return { _tag: "Success", value };
}

function failure(message: string): BrunoTableDecodeResult<never> {
  return { _tag: "Failure", message };
}

function decodeRuntimeBigDecimal(input: unknown): BrunoTableDecodeResult<BigDecimal.BigDecimal> {
  if (typeof input === "object" && input !== null && trustedWireSafeValues.has(input)) {
    return success(input as BigDecimal.BigDecimal);
  }
  const inspection = inspectWireSafeBigDecimal(input);
  if (inspection._tag !== "Success") {
    return failure("Expected a wire-safe Effect BigDecimal value.");
  }
  trustedWireSafeValues.add(inspection.source);
  return success(inspection.source);
}

function assertWireSafeBigDecimal(input: unknown): BigDecimal.BigDecimal {
  const decoded = decodeRuntimeBigDecimal(input);
  if (decoded._tag === "Failure") {
    throw new TypeError("BrunoTable BigDecimal Value Type received an invalid value.");
  }
  return decoded.value;
}

function compareBigDecimal(
  left: BigDecimal.BigDecimal,
  right: BigDecimal.BigDecimal,
): BrunoTableOrdering {
  const trustedLeft = assertWireSafeBigDecimal(left);
  const trustedRight = left === right ? trustedLeft : assertWireSafeBigDecimal(right);
  const ordering = compareTrustedWireSafeBigDecimal(trustedLeft, trustedRight);
  if (ordering === undefined || (ordering !== -1 && ordering !== 0 && ordering !== 1)) {
    throw new TypeError("BrunoTable BigDecimal Value Type received an invalid value.");
  }
  return ordering;
}

function parseBigDecimalText(text: string): BrunoTableDecodeResult<BigDecimal.BigDecimal> {
  if (typeof text !== "string") {
    return failure("Expected canonical BigDecimal text input.");
  }
  if (text.trim().length === 0) {
    return failure("BigDecimal text must not be blank.");
  }

  const parsed = BigDecimal.fromString(text);
  if (Option.isNone(parsed)) {
    return failure("Expected exact decimal text.");
  }
  const decoded = decodeRuntimeBigDecimal(parsed.value);
  return decoded._tag === "Success"
    ? decoded
    : failure("The BigDecimal value is not safe for View Server transport.");
}

function hasExactPersistedShape(input: unknown): input is {
  readonly $brunoTableValue: string;
  readonly version: number;
  readonly value: string;
} {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 3 ||
      !keys.includes("$brunoTableValue") ||
      !keys.includes("version") ||
      !keys.includes("value")
    ) {
      return false;
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return false;
      }
    }
    return (
      Reflect.get(input, "$brunoTableValue") === persistedType &&
      Reflect.get(input, "version") === codecVersion &&
      typeof Reflect.get(input, "value") === "string"
    );
  } catch {
    return false;
  }
}

/** Exact Effect BigDecimal semantics compatible with effect-view-server's admitted wire domain. */
export const BrunoTableBigDecimalValueType: BrunoTableValueType<
  BigDecimal.BigDecimal,
  "numeric",
  "bigdecimal"
> = Object.freeze({
  codecId,
  codecVersion,
  filterFamily: "numeric",
  editorFamily: "bigdecimal",
  cellAlign: "end",
  editorLayout: "inline",
  defaultWidth: 140,
  decodeRuntime: decodeRuntimeBigDecimal,
  equivalent: (left: BigDecimal.BigDecimal, right: BigDecimal.BigDecimal): boolean =>
    compareBigDecimal(left, right) === 0,
  compare: compareBigDecimal,
  formatCanonicalText: (value: BigDecimal.BigDecimal): string =>
    BigDecimal.format(assertWireSafeBigDecimal(value)),
  parseCanonicalText: parseBigDecimalText,
  formatDisplay: (value: BigDecimal.BigDecimal): string =>
    BigDecimal.format(assertWireSafeBigDecimal(value)),
  encodePersisted: (value: BigDecimal.BigDecimal) => ({
    $brunoTableValue: persistedType,
    version: codecVersion,
    value: BigDecimal.format(assertWireSafeBigDecimal(value)),
  }),
  decodePersisted: (input: unknown): BrunoTableDecodeResult<BigDecimal.BigDecimal> =>
    hasExactPersistedShape(input)
      ? parseBigDecimalText(input.value)
      : failure("Persisted Effect BigDecimal value has an invalid tag."),
});

type FieldOfBigDecimal<TRow> = {
  readonly [TField in BrunoTableFieldKey<TRow>]: [BrunoTableNonNullish<TRow[TField]>] extends [
    BigDecimal.BigDecimal,
  ]
    ? TField
    : never;
}[BrunoTableFieldKey<TRow>];

type Merge<TDefaults, TOptions> = Omit<TDefaults, keyof TOptions> & TOptions;

type ApplyDefaults<TOptions, TDefaults> = Omit<TOptions, Extract<keyof TDefaults, keyof TOptions>> &
  Partial<Pick<TOptions, Extract<keyof TDefaults, keyof TOptions>>>;

type OnlyKnownKeys<TActual, TAllowed> = {
  readonly [TKey in Exclude<keyof TActual, keyof TAllowed>]: never;
};

type BigDecimalBuiltInDefaults = {
  readonly valueType: typeof BrunoTableBigDecimalValueType;
  readonly cellAlign: "end";
  readonly editorLayout: "inline";
  readonly width: 140;
};

type BigDecimalFieldInput<TRow, TField extends FieldOfBigDecimal<TRow>> = Omit<
  BrunoTableFieldColumnDefinition<TRow, TField, typeof BrunoTableBigDecimalValueType>,
  "valueType"
>;

type BigDecimalComputedOptions<TRow, TFields extends BrunoTableNonEmptyFields<TRow>> = Omit<
  BrunoTableComputedColumnInput<
    TRow,
    TFields,
    BigDecimal.BigDecimal,
    typeof BrunoTableBigDecimalValueType
  >,
  "fields" | "valueGetter" | "valueType"
>;

type BrunoTableBigDecimalColumnPresetDefaults = {
  readonly headerName?: string;
  readonly width?: number;
  readonly cellAlign?: BrunoTableCellAlign;
  readonly editorLayout?: BrunoTableEditorLayout;
  readonly enableFilter?: boolean;
  readonly enableSorting?: boolean;
  readonly isEditable?: boolean;
  readonly cellClassName?: string;
};

type FieldOnlyPresetKey = "enableFilter" | "enableSorting" | "isEditable";
type ComputedPresetDefaults<TDefaults> = Omit<TDefaults, FieldOnlyPresetKey>;

type BigDecimalPresetResult<TDefaults, TOptions, TColumn> = Merge<
  Merge<BigDecimalBuiltInDefaults, TDefaults>,
  TOptions
> &
  TColumn;

type BigDecimalHelperResult<TOptions, TColumn> = Merge<BigDecimalBuiltInDefaults, TOptions> &
  TColumn;

type BrunoTableBigDecimalColumnPreset<TDefaults extends BrunoTableBigDecimalColumnPresetDefaults> =
  {
    <
      TRow,
      TField extends FieldOfBigDecimal<TRow>,
      const TOptions extends ApplyDefaults<BigDecimalFieldInput<TRow, TField>, TDefaults>,
    >(
      options: TOptions & OnlyKnownKeys<TOptions, BigDecimalFieldInput<TRow, TField>>,
    ): BigDecimalPresetResult<
      TDefaults,
      TOptions,
      BrunoTableFieldColumnDefinition<TRow, TField, typeof BrunoTableBigDecimalValueType>
    >;
    <
      TRow,
      const TFields extends BrunoTableNonEmptyFields<TRow>,
      const TOptions extends ApplyDefaults<
        BigDecimalComputedOptions<TRow, TFields>,
        ComputedPresetDefaults<TDefaults>
      >,
    >(
      options: TOptions &
        BrunoTableComputedColumnDependencies<TRow, TFields, BigDecimal.BigDecimal> &
        OnlyKnownKeys<
          TOptions,
          BigDecimalComputedOptions<TRow, TFields> &
            BrunoTableComputedColumnDependencies<TRow, TFields, BigDecimal.BigDecimal>
        >,
    ): BigDecimalPresetResult<
      ComputedPresetDefaults<TDefaults>,
      TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, BigDecimal.BigDecimal>,
      BrunoTableComputedColumnDefinition<
        TRow,
        TFields,
        BigDecimal.BigDecimal,
        typeof BrunoTableBigDecimalValueType
      >
    >;
  };

type BrunoTableBigDecimalColumnHelper = {
  <
    TRow,
    TField extends FieldOfBigDecimal<TRow>,
    const TOptions extends BigDecimalFieldInput<TRow, TField>,
  >(
    options: TOptions & OnlyKnownKeys<TOptions, BigDecimalFieldInput<TRow, TField>>,
  ): BigDecimalHelperResult<
    TOptions,
    BrunoTableFieldColumnDefinition<TRow, TField, typeof BrunoTableBigDecimalValueType>
  >;
  <
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends BigDecimalComputedOptions<TRow, TFields>,
  >(
    options: TOptions &
      BrunoTableComputedColumnDependencies<TRow, TFields, BigDecimal.BigDecimal> &
      OnlyKnownKeys<
        TOptions,
        BigDecimalComputedOptions<TRow, TFields> &
          BrunoTableComputedColumnDependencies<TRow, TFields, BigDecimal.BigDecimal>
      >,
  ): BigDecimalHelperResult<
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, BigDecimal.BigDecimal>,
    BrunoTableComputedColumnDefinition<
      TRow,
      TFields,
      BigDecimal.BigDecimal,
      typeof BrunoTableBigDecimalValueType
    >
  >;
  readonly withDefaults: <const TDefaults extends BrunoTableBigDecimalColumnPresetDefaults>(
    defaults: TDefaults & OnlyKnownKeys<TDefaults, BrunoTableBigDecimalColumnPresetDefaults>,
  ) => BrunoTableBigDecimalColumnPreset<TDefaults>;
};

type RuntimeColumnOptions = Readonly<Record<PropertyKey, unknown>>;

const builtInDefaults: BigDecimalBuiltInDefaults = {
  valueType: BrunoTableBigDecimalValueType,
  cellAlign: "end",
  editorLayout: "inline",
  width: 140,
};

const presetDefaultKeys = new Set<PropertyKey>([
  "headerName",
  "width",
  "cellAlign",
  "editorLayout",
  "enableFilter",
  "enableSorting",
  "isEditable",
  "cellClassName",
]);

const commonOptionKeys = new Set<PropertyKey>([
  "columnId",
  "headerName",
  "width",
  "cellAlign",
  "editorLayout",
  "valueFormatter",
  "cellClassName",
  "cellRenderer",
]);
const fieldOptionKeys = new Set<PropertyKey>([
  "field",
  "enableFilter",
  "enableSorting",
  "isEditable",
]);
const computedOptionKeys = new Set<PropertyKey>(["fields", "valueGetter"]);

function isRecord(value: unknown): value is RuntimeColumnOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComputedColumnOptions(options: RuntimeColumnOptions): boolean {
  return Object.hasOwn(options, "fields") || Object.hasOwn(options, "valueGetter");
}

function omitFieldOnlyDefaults(defaults: RuntimeColumnOptions): RuntimeColumnOptions {
  return Object.fromEntries(
    Reflect.ownKeys(defaults)
      .filter((key) => key !== "enableFilter" && key !== "enableSorting" && key !== "isEditable")
      .map((key) => [key, defaults[key]]),
  );
}

function validateColumnOptions(options: RuntimeColumnOptions): void {
  if (Object.hasOwn(options, "valueType")) {
    throw new TypeError(
      "BrunoTable BigDecimal Column Helper does not accept a valueType override.",
    );
  }
  const isComputed = isComputedColumnOptions(options);
  const allowed = isComputed
    ? new Set([...commonOptionKeys, ...computedOptionKeys])
    : new Set([...commonOptionKeys, ...fieldOptionKeys]);
  for (const key of Reflect.ownKeys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(`BrunoTable BigDecimal Column Helper does not accept ${String(key)}.`);
    }
  }
}

function mergeColumnOptions(
  defaults: RuntimeColumnOptions,
  options: RuntimeColumnOptions,
): RuntimeColumnOptions {
  validateColumnOptions(options);
  const isComputed = isComputedColumnOptions(options);
  const merged = {
    ...builtInDefaults,
    ...(isComputed ? omitFieldOnlyDefaults(defaults) : defaults),
    ...options,
  };
  return isComputed
    ? (BrunoTableComputedColumn(merged as never) as unknown as RuntimeColumnOptions)
    : merged;
}

function snapshotPresetDefaults(input: unknown): RuntimeColumnOptions {
  if (!isRecord(input)) {
    throw new TypeError("BrunoTable BigDecimal Column preset defaults must be an object.");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (!presetDefaultKeys.has(key)) {
      throw new TypeError(`BrunoTable BigDecimal Column preset does not accept ${String(key)}.`);
    }
  }
  return Object.freeze({ ...input });
}

function BrunoTableBigDecimalColumnBase(options: RuntimeColumnOptions) {
  return mergeColumnOptions({}, options);
}

function BrunoTableBigDecimalColumnWithDefaults<
  const TDefaults extends BrunoTableBigDecimalColumnPresetDefaults,
>(defaults: TDefaults): BrunoTableBigDecimalColumnPreset<TDefaults> {
  const snapshot = snapshotPresetDefaults(defaults);
  return ((options: RuntimeColumnOptions) => mergeColumnOptions(snapshot, options)) as never;
}

/** Creates an ordinary exact BigDecimal Column Definition with coherent numeric defaults. */
export const BrunoTableBigDecimalColumn: BrunoTableBigDecimalColumnHelper = Object.assign(
  BrunoTableBigDecimalColumnBase,
  { withDefaults: BrunoTableBigDecimalColumnWithDefaults },
);
