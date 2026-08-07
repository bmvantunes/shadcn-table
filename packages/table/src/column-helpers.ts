import { BrunoTableComputedColumn } from "./public-types";

import type {
  BrunoTableBuiltInValueType,
  BrunoTableCellAlign,
  BrunoTableComputedColumnDependencies,
  BrunoTableComputedColumnDefinition,
  BrunoTableComputedColumnInput,
  BrunoTableEditorLayout,
  BrunoTableFieldColumnDefinition,
  BrunoTableFieldKey,
  BrunoTableJsonValue,
  BrunoTableNonEmptyFields,
  BrunoTableNonNullish,
  BrunoTableNumberFormat,
  BrunoTableOrdering,
  BrunoTableValueType,
} from "./public-types";

export type BrunoTableSelectValue = string | number | bigint | boolean;

type FieldOfKind<TRow, TValueKind> = {
  readonly [TField in BrunoTableFieldKey<TRow>]: [BrunoTableNonNullish<TRow[TField]>] extends [
    never,
  ]
    ? never
    : [BrunoTableNonNullish<TRow[TField]>] extends [TValueKind]
      ? TField
      : never;
}[BrunoTableFieldKey<TRow>];

type Merge<TDefaults, TOptions> = Omit<TDefaults, keyof TOptions> & TOptions;

type ApplyDefaults<TOptions, TDefaults> = Omit<TOptions, Extract<keyof TDefaults, keyof TOptions>> &
  Partial<Pick<TOptions, Extract<keyof TDefaults, keyof TOptions>>>;

type OnlyKnownKeys<TActual, TAllowed> = {
  readonly [TKey in Exclude<keyof TActual, keyof TAllowed>]: never;
};

type HelperResult<TBuiltIn, TOptions, TColumn> = Merge<TBuiltIn, TOptions> & TColumn;

type PresetResult<TBuiltIn, TDefaults, TOptions, TColumn> = Merge<
  Merge<TBuiltIn, TDefaults>,
  TOptions
> &
  TColumn;

type FieldInput<
  TRow,
  TField extends BrunoTableFieldKey<TRow>,
  TValueType extends
    | BrunoTableBuiltInValueType
    | BrunoTableValueType<BrunoTableNonNullish<TRow[TField]>>,
> = Omit<BrunoTableFieldColumnDefinition<TRow, TField, TValueType>, "valueType">;

type ComputedOptions<
  TRow,
  TFields extends BrunoTableNonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType | BrunoTableValueType<TValue>,
> = Omit<
  BrunoTableComputedColumnInput<TRow, TFields, TValue, TValueType>,
  "fields" | "valueGetter" | "valueType"
>;

type BuiltInDefaults<
  TValueType extends BrunoTableBuiltInValueType,
  TCellAlign extends BrunoTableCellAlign,
  TEditorLayout extends BrunoTableEditorLayout,
  TWidth extends number,
> = {
  readonly valueType: TValueType;
  readonly cellAlign: TCellAlign;
  readonly editorLayout: TEditorLayout;
  readonly width: TWidth;
};

type TextBuiltIn = BuiltInDefaults<"text", "start", "inline", 160>;
type NumberBuiltIn = BuiltInDefaults<"number", "end", "inline", 120>;
type BigIntBuiltIn = BuiltInDefaults<"bigint", "end", "inline", 140>;
type BooleanBuiltIn = BuiltInDefaults<"boolean", "center", "center", 88>;

type PresetDefaults = {
  readonly headerName?: string;
  readonly width?: number;
  readonly cellAlign?: BrunoTableCellAlign;
  readonly editorLayout?: BrunoTableEditorLayout;
  readonly enableFilter?: boolean;
  readonly enableSorting?: boolean;
  readonly isEditable?: boolean;
  readonly cellClassName?: string;
};

type NumberPresetDefaults = PresetDefaults & {
  readonly format?: BrunoTableNumberFormat;
};

type BuiltInColumnPreset<
  TValue,
  TValueType extends BrunoTableBuiltInValueType,
  TBuiltIn,
  TDefaults extends PresetDefaults,
> = {
  <
    TRow,
    TField extends FieldOfKind<TRow, TValue>,
    const TOptions extends ApplyDefaults<FieldInput<TRow, TField, TValueType>, TDefaults>,
  >(
    options: TOptions & OnlyKnownKeys<TOptions, FieldInput<TRow, TField, TValueType>>,
  ): PresetResult<
    TBuiltIn,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<TRow, TField, TValueType>
  >;
  <
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<
      ComputedOptions<TRow, TFields, TValue, TValueType>,
      TDefaults
    >,
  >(
    options: TOptions &
      BrunoTableComputedColumnDependencies<TRow, TFields, TValue> &
      OnlyKnownKeys<
        TOptions,
        ComputedOptions<TRow, TFields, TValue, TValueType> &
          BrunoTableComputedColumnDependencies<TRow, TFields, TValue>
      >,
  ): PresetResult<
    TBuiltIn,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, TValue>,
    BrunoTableComputedColumnDefinition<TRow, TFields, TValue, TValueType>
  >;
};

type BuiltInColumnHelper<
  TValue,
  TValueType extends BrunoTableBuiltInValueType,
  TBuiltIn,
  TPresetDefaults extends PresetDefaults,
> = {
  <
    TRow,
    TField extends FieldOfKind<TRow, TValue>,
    const TOptions extends FieldInput<TRow, TField, TValueType>,
  >(
    options: TOptions & OnlyKnownKeys<TOptions, FieldInput<TRow, TField, TValueType>>,
  ): HelperResult<TBuiltIn, TOptions, BrunoTableFieldColumnDefinition<TRow, TField, TValueType>>;
  <
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ComputedOptions<TRow, TFields, TValue, TValueType>,
  >(
    options: TOptions &
      BrunoTableComputedColumnDependencies<TRow, TFields, TValue> &
      OnlyKnownKeys<
        TOptions,
        ComputedOptions<TRow, TFields, TValue, TValueType> &
          BrunoTableComputedColumnDependencies<TRow, TFields, TValue>
      >,
  ): HelperResult<
    TBuiltIn,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, TValue>,
    BrunoTableComputedColumnDefinition<TRow, TFields, TValue, TValueType>
  >;
  readonly withDefaults: <const TDefaults extends TPresetDefaults>(
    defaults: TDefaults & OnlyKnownKeys<TDefaults, TPresetDefaults>,
  ) => BuiltInColumnPreset<TValue, TValueType, TBuiltIn, TDefaults>;
};

type RuntimeColumnOptions = Readonly<Record<PropertyKey, unknown>>;

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
const numberPresetDefaultKeys = new Set<PropertyKey>([...presetDefaultKeys, "format"]);
const selectPresetDefaultKeys = new Set<PropertyKey>([...presetDefaultKeys, "options"]);

const textBuiltInDefaults: TextBuiltIn = {
  valueType: "text",
  cellAlign: "start",
  editorLayout: "inline",
  width: 160,
};

const numberBuiltInDefaults: NumberBuiltIn = {
  valueType: "number",
  cellAlign: "end",
  editorLayout: "inline",
  width: 120,
};

const bigIntBuiltInDefaults: BigIntBuiltIn = {
  valueType: "bigint",
  cellAlign: "end",
  editorLayout: "inline",
  width: 140,
};

const booleanBuiltInDefaults: BooleanBuiltIn = {
  valueType: "boolean",
  cellAlign: "center",
  editorLayout: "center",
  width: 88,
};

function mergeRuntimeColumn(
  builtIn: RuntimeColumnOptions,
  defaults: RuntimeColumnOptions,
  options: RuntimeColumnOptions,
): RuntimeColumnOptions {
  if (Object.hasOwn(defaults, "valueType") || Object.hasOwn(options, "valueType")) {
    throw new TypeError("BrunoTable Column Helpers do not accept a valueType override.");
  }

  const builtInFormat = builtIn["format"];
  const defaultFormat = defaults["format"];
  const optionFormat = options["format"];
  const hasFormat =
    builtInFormat !== undefined || defaultFormat !== undefined || optionFormat !== undefined;
  const merged = {
    ...builtIn,
    ...defaults,
    ...options,
    ...(hasFormat
      ? {
          format: {
            ...(isRecord(builtInFormat) ? builtInFormat : {}),
            ...(isRecord(defaultFormat) ? defaultFormat : {}),
            ...(isRecord(optionFormat) ? optionFormat : {}),
          },
        }
      : {}),
  };

  return Object.hasOwn(merged, "fields")
    ? (BrunoTableComputedColumn(merged as never) as unknown as RuntimeColumnOptions)
    : merged;
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function BrunoTableTextColumnBase<
  TRow,
  TField extends FieldOfKind<TRow, string>,
  const TOptions extends FieldInput<TRow, TField, "text">,
>(
  options: TOptions,
): HelperResult<TextBuiltIn, TOptions, BrunoTableFieldColumnDefinition<TRow, TField, "text">>;
function BrunoTableTextColumnBase<
  TRow,
  const TFields extends BrunoTableNonEmptyFields<TRow>,
  const TOptions extends ComputedOptions<TRow, TFields, string, "text">,
>(
  options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, string>,
): HelperResult<
  TextBuiltIn,
  TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, string>,
  BrunoTableComputedColumnDefinition<TRow, TFields, string, "text">
>;
function BrunoTableTextColumnBase(options: RuntimeColumnOptions) {
  return mergeRuntimeColumn(textBuiltInDefaults, {}, options);
}

function BrunoTableTextColumnWithDefaults<const TDefaults extends PresetDefaults>(
  defaults: TDefaults,
): BuiltInColumnPreset<string, "text", TextBuiltIn, TDefaults> {
  const defaultsSnapshot = snapshotPresetDefaults(defaults, presetDefaultKeys);
  function BrunoTableTextColumnPreset<
    TRow,
    TField extends FieldOfKind<TRow, string>,
    const TOptions extends ApplyDefaults<FieldInput<TRow, TField, "text">, TDefaults>,
  >(
    options: TOptions,
  ): PresetResult<
    TextBuiltIn,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<TRow, TField, "text">
  >;
  function BrunoTableTextColumnPreset<
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<ComputedOptions<TRow, TFields, string, "text">, TDefaults>,
  >(
    options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, string>,
  ): PresetResult<
    TextBuiltIn,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, string>,
    BrunoTableComputedColumnDefinition<TRow, TFields, string, "text">
  >;
  function BrunoTableTextColumnPreset(options: RuntimeColumnOptions) {
    return mergeRuntimeColumn(textBuiltInDefaults, defaultsSnapshot, options);
  }

  return BrunoTableTextColumnPreset;
}

export const BrunoTableTextColumn: BuiltInColumnHelper<
  string,
  "text",
  TextBuiltIn,
  PresetDefaults
> = Object.assign(BrunoTableTextColumnBase, {
  withDefaults: BrunoTableTextColumnWithDefaults,
});

function BrunoTableNumberColumnBase<
  TRow,
  TField extends FieldOfKind<TRow, number>,
  const TOptions extends FieldInput<TRow, TField, "number">,
>(
  options: TOptions,
): HelperResult<NumberBuiltIn, TOptions, BrunoTableFieldColumnDefinition<TRow, TField, "number">>;
function BrunoTableNumberColumnBase<
  TRow,
  const TFields extends BrunoTableNonEmptyFields<TRow>,
  const TOptions extends ComputedOptions<TRow, TFields, number, "number">,
>(
  options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, number>,
): HelperResult<
  NumberBuiltIn,
  TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, number>,
  BrunoTableComputedColumnDefinition<TRow, TFields, number, "number">
>;
function BrunoTableNumberColumnBase(options: RuntimeColumnOptions) {
  return mergeRuntimeColumn(numberBuiltInDefaults, {}, options);
}

function BrunoTableNumberColumnWithDefaults<const TDefaults extends NumberPresetDefaults>(
  defaults: TDefaults,
): BuiltInColumnPreset<number, "number", NumberBuiltIn, TDefaults> {
  const defaultsSnapshot = snapshotPresetDefaults(defaults, numberPresetDefaultKeys);
  function BrunoTableNumberColumnPreset<
    TRow,
    TField extends FieldOfKind<TRow, number>,
    const TOptions extends ApplyDefaults<FieldInput<TRow, TField, "number">, TDefaults>,
  >(
    options: TOptions,
  ): PresetResult<
    NumberBuiltIn,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<TRow, TField, "number">
  >;
  function BrunoTableNumberColumnPreset<
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<
      ComputedOptions<TRow, TFields, number, "number">,
      TDefaults
    >,
  >(
    options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, number>,
  ): PresetResult<
    NumberBuiltIn,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, number>,
    BrunoTableComputedColumnDefinition<TRow, TFields, number, "number">
  >;
  function BrunoTableNumberColumnPreset(options: RuntimeColumnOptions) {
    return mergeRuntimeColumn(numberBuiltInDefaults, defaultsSnapshot, options);
  }

  return BrunoTableNumberColumnPreset;
}

export const BrunoTableNumberColumn: BuiltInColumnHelper<
  number,
  "number",
  NumberBuiltIn,
  NumberPresetDefaults
> = Object.assign(BrunoTableNumberColumnBase, {
  withDefaults: BrunoTableNumberColumnWithDefaults,
});

function BrunoTableBigIntColumnBase<
  TRow,
  TField extends FieldOfKind<TRow, bigint>,
  const TOptions extends FieldInput<TRow, TField, "bigint">,
>(
  options: TOptions,
): HelperResult<BigIntBuiltIn, TOptions, BrunoTableFieldColumnDefinition<TRow, TField, "bigint">>;
function BrunoTableBigIntColumnBase<
  TRow,
  const TFields extends BrunoTableNonEmptyFields<TRow>,
  const TOptions extends ComputedOptions<TRow, TFields, bigint, "bigint">,
>(
  options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, bigint>,
): HelperResult<
  BigIntBuiltIn,
  TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, bigint>,
  BrunoTableComputedColumnDefinition<TRow, TFields, bigint, "bigint">
>;
function BrunoTableBigIntColumnBase(options: RuntimeColumnOptions) {
  return mergeRuntimeColumn(bigIntBuiltInDefaults, {}, options);
}

function BrunoTableBigIntColumnWithDefaults<const TDefaults extends PresetDefaults>(
  defaults: TDefaults,
): BuiltInColumnPreset<bigint, "bigint", BigIntBuiltIn, TDefaults> {
  const defaultsSnapshot = snapshotPresetDefaults(defaults, presetDefaultKeys);
  function BrunoTableBigIntColumnPreset<
    TRow,
    TField extends FieldOfKind<TRow, bigint>,
    const TOptions extends ApplyDefaults<FieldInput<TRow, TField, "bigint">, TDefaults>,
  >(
    options: TOptions,
  ): PresetResult<
    BigIntBuiltIn,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<TRow, TField, "bigint">
  >;
  function BrunoTableBigIntColumnPreset<
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<
      ComputedOptions<TRow, TFields, bigint, "bigint">,
      TDefaults
    >,
  >(
    options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, bigint>,
  ): PresetResult<
    BigIntBuiltIn,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, bigint>,
    BrunoTableComputedColumnDefinition<TRow, TFields, bigint, "bigint">
  >;
  function BrunoTableBigIntColumnPreset(options: RuntimeColumnOptions) {
    return mergeRuntimeColumn(bigIntBuiltInDefaults, defaultsSnapshot, options);
  }

  return BrunoTableBigIntColumnPreset;
}

export const BrunoTableBigIntColumn: BuiltInColumnHelper<
  bigint,
  "bigint",
  BigIntBuiltIn,
  PresetDefaults
> = Object.assign(BrunoTableBigIntColumnBase, {
  withDefaults: BrunoTableBigIntColumnWithDefaults,
});

function BrunoTableBooleanColumnBase<
  TRow,
  TField extends FieldOfKind<TRow, boolean>,
  const TOptions extends FieldInput<TRow, TField, "boolean">,
>(
  options: TOptions,
): HelperResult<BooleanBuiltIn, TOptions, BrunoTableFieldColumnDefinition<TRow, TField, "boolean">>;
function BrunoTableBooleanColumnBase<
  TRow,
  const TFields extends BrunoTableNonEmptyFields<TRow>,
  const TOptions extends ComputedOptions<TRow, TFields, boolean, "boolean">,
>(
  options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, boolean>,
): HelperResult<
  BooleanBuiltIn,
  TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, boolean>,
  BrunoTableComputedColumnDefinition<TRow, TFields, boolean, "boolean">
>;
function BrunoTableBooleanColumnBase(options: RuntimeColumnOptions) {
  return mergeRuntimeColumn(booleanBuiltInDefaults, {}, options);
}

function BrunoTableBooleanColumnWithDefaults<const TDefaults extends PresetDefaults>(
  defaults: TDefaults,
): BuiltInColumnPreset<boolean, "boolean", BooleanBuiltIn, TDefaults> {
  const defaultsSnapshot = snapshotPresetDefaults(defaults, presetDefaultKeys);
  function BrunoTableBooleanColumnPreset<
    TRow,
    TField extends FieldOfKind<TRow, boolean>,
    const TOptions extends ApplyDefaults<FieldInput<TRow, TField, "boolean">, TDefaults>,
  >(
    options: TOptions,
  ): PresetResult<
    BooleanBuiltIn,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<TRow, TField, "boolean">
  >;
  function BrunoTableBooleanColumnPreset<
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<
      ComputedOptions<TRow, TFields, boolean, "boolean">,
      TDefaults
    >,
  >(
    options: TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, boolean>,
  ): PresetResult<
    BooleanBuiltIn,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, boolean>,
    BrunoTableComputedColumnDefinition<TRow, TFields, boolean, "boolean">
  >;
  function BrunoTableBooleanColumnPreset(options: RuntimeColumnOptions) {
    return mergeRuntimeColumn(booleanBuiltInDefaults, defaultsSnapshot, options);
  }

  return BrunoTableBooleanColumnPreset;
}

export const BrunoTableBooleanColumn: BuiltInColumnHelper<
  boolean,
  "boolean",
  BooleanBuiltIn,
  PresetDefaults
> = Object.assign(BrunoTableBooleanColumnBase, {
  withDefaults: BrunoTableBooleanColumnWithDefaults,
});

type NonEmptySelectOptions<TValue extends BrunoTableSelectValue = BrunoTableSelectValue> =
  readonly [TValue, ...TValue[]];

type SelectValueType<TValue> = BrunoTableValueType<TValue, "select", "select">;

type SelectBuiltIn<TValue> = {
  readonly valueType: SelectValueType<TValue>;
  readonly cellAlign: "start";
  readonly editorLayout: "fullWidth";
  readonly width: 160;
};

type ExactSelectDomain<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? unknown
    : never
  : never;

type SelectFieldInput<
  TRow,
  TField extends BrunoTableFieldKey<TRow>,
  TOptions extends NonEmptySelectOptions,
> = Omit<
  FieldInput<TRow, TField, SelectValueType<BrunoTableNonNullish<TRow[TField]>>>,
  "options"
> & {
  readonly options: TOptions;
};

type SelectComputedInput<
  TRow,
  TFields extends BrunoTableNonEmptyFields<TRow>,
  TOptions extends NonEmptySelectOptions,
> = ComputedOptions<TRow, TFields, TOptions[number], SelectValueType<TOptions[number]>> & {
  readonly options: TOptions;
};

type SelectPresetDefaults<TOptions extends NonEmptySelectOptions> = PresetDefaults & {
  readonly options: TOptions;
};

type SelectColumnPreset<
  TDefaultOptions extends NonEmptySelectOptions,
  TDefaults extends SelectPresetDefaults<TDefaultOptions>,
> = {
  <
    TRow,
    TField extends FieldOfKind<TRow, TDefaultOptions[number]>,
    const TOptions extends ApplyDefaults<
      SelectFieldInput<TRow, TField, TDefaultOptions>,
      TDefaults
    > & { readonly options?: never },
  >(
    options: TOptions &
      ExactSelectDomain<TDefaultOptions[number], BrunoTableNonNullish<TRow[TField]>> &
      OnlyKnownKeys<
        TOptions,
        ApplyDefaults<SelectFieldInput<TRow, TField, TDefaultOptions>, TDefaults>
      >,
  ): PresetResult<
    SelectBuiltIn<BrunoTableNonNullish<TRow[TField]>>,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<
      TRow,
      TField,
      SelectValueType<BrunoTableNonNullish<TRow[TField]>>
    >
  >;
  <
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<
      ComputedOptions<
        TRow,
        TFields,
        TDefaultOptions[number],
        SelectValueType<TDefaultOptions[number]>
      >,
      TDefaults
    > & { readonly options?: never },
  >(
    options: TOptions &
      BrunoTableComputedColumnDependencies<TRow, TFields, TDefaultOptions[number]> &
      OnlyKnownKeys<
        TOptions,
        ComputedOptions<
          TRow,
          TFields,
          TDefaultOptions[number],
          SelectValueType<TDefaultOptions[number]>
        > &
          BrunoTableComputedColumnDependencies<TRow, TFields, TDefaultOptions[number]>
      >,
  ): PresetResult<
    SelectBuiltIn<TDefaultOptions[number]>,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, TDefaultOptions[number]>,
    BrunoTableComputedColumnDefinition<
      TRow,
      TFields,
      TDefaultOptions[number],
      SelectValueType<TDefaultOptions[number]>
    >
  >;
};

type SelectColumnHelper = {
  <
    TRow,
    const TSelectOptions extends NonEmptySelectOptions,
    TField extends FieldOfKind<TRow, TSelectOptions[number]>,
    const TOptions extends SelectFieldInput<TRow, TField, TSelectOptions>,
  >(
    options: TOptions & { readonly options: TSelectOptions } & ExactSelectDomain<
        TSelectOptions[number],
        BrunoTableNonNullish<TRow[TField]>
      > &
      OnlyKnownKeys<TOptions, SelectFieldInput<TRow, TField, TSelectOptions>>,
  ): HelperResult<
    SelectBuiltIn<BrunoTableNonNullish<TRow[TField]>>,
    TOptions,
    BrunoTableFieldColumnDefinition<
      TRow,
      TField,
      SelectValueType<BrunoTableNonNullish<TRow[TField]>>
    >
  >;
  <
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TSelectOptions extends NonEmptySelectOptions,
    const TOptions extends SelectComputedInput<TRow, TFields, TSelectOptions>,
  >(
    options: TOptions & { readonly options: TSelectOptions } & BrunoTableComputedColumnDependencies<
        TRow,
        TFields,
        TSelectOptions[number]
      > &
      OnlyKnownKeys<
        TOptions,
        SelectComputedInput<TRow, TFields, TSelectOptions> &
          BrunoTableComputedColumnDependencies<TRow, TFields, TSelectOptions[number]>
      >,
  ): HelperResult<
    SelectBuiltIn<TSelectOptions[number]>,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, TSelectOptions[number]>,
    BrunoTableComputedColumnDefinition<
      TRow,
      TFields,
      TSelectOptions[number],
      SelectValueType<TSelectOptions[number]>
    >
  >;
  readonly withDefaults: <
    const TDefaultOptions extends NonEmptySelectOptions,
    const TDefaults extends SelectPresetDefaults<TDefaultOptions>,
  >(
    defaults: TDefaults & { readonly options: TDefaultOptions } & OnlyKnownKeys<
        TDefaults,
        SelectPresetDefaults<TDefaultOptions>
      >,
  ) => SelectColumnPreset<TDefaultOptions, TDefaults>;
};

function BrunoTableSelectColumnBase<
  TRow,
  const TSelectOptions extends NonEmptySelectOptions,
  TField extends FieldOfKind<TRow, TSelectOptions[number]>,
  const TOptions extends SelectFieldInput<TRow, TField, TSelectOptions>,
>(
  options: TOptions & { readonly options: TSelectOptions } & ExactSelectDomain<
      TSelectOptions[number],
      BrunoTableNonNullish<TRow[TField]>
    >,
): HelperResult<
  SelectBuiltIn<BrunoTableNonNullish<TRow[TField]>>,
  TOptions,
  BrunoTableFieldColumnDefinition<TRow, TField, SelectValueType<BrunoTableNonNullish<TRow[TField]>>>
>;
function BrunoTableSelectColumnBase<
  TRow,
  const TFields extends BrunoTableNonEmptyFields<TRow>,
  const TSelectOptions extends NonEmptySelectOptions,
  const TOptions extends SelectComputedInput<TRow, TFields, TSelectOptions>,
>(
  options: TOptions & { readonly options: TSelectOptions } & BrunoTableComputedColumnDependencies<
      TRow,
      TFields,
      TSelectOptions[number]
    >,
): HelperResult<
  SelectBuiltIn<TSelectOptions[number]>,
  TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, TSelectOptions[number]>,
  BrunoTableComputedColumnDefinition<
    TRow,
    TFields,
    TSelectOptions[number],
    SelectValueType<TSelectOptions[number]>
  >
>;
function BrunoTableSelectColumnBase(options: RuntimeColumnOptions) {
  return mergeSelectRuntimeColumn({}, options);
}

function BrunoTableSelectColumnWithDefaults<
  const TDefaultOptions extends NonEmptySelectOptions,
  const TDefaults extends SelectPresetDefaults<TDefaultOptions>,
>(
  defaults: TDefaults & { readonly options: TDefaultOptions },
): SelectColumnPreset<TDefaultOptions, TDefaults> {
  const defaultsSnapshot = snapshotPresetDefaults(defaults, selectPresetDefaultKeys);
  function BrunoTableSelectColumnPreset<
    TRow,
    TField extends FieldOfKind<TRow, TDefaultOptions[number]>,
    const TOptions extends ApplyDefaults<
      SelectFieldInput<TRow, TField, TDefaultOptions>,
      TDefaults
    > & { readonly options?: never },
  >(
    options: TOptions &
      ExactSelectDomain<TDefaultOptions[number], BrunoTableNonNullish<TRow[TField]>>,
  ): PresetResult<
    SelectBuiltIn<BrunoTableNonNullish<TRow[TField]>>,
    TDefaults,
    TOptions,
    BrunoTableFieldColumnDefinition<
      TRow,
      TField,
      SelectValueType<BrunoTableNonNullish<TRow[TField]>>
    >
  >;
  function BrunoTableSelectColumnPreset<
    TRow,
    const TFields extends BrunoTableNonEmptyFields<TRow>,
    const TOptions extends ApplyDefaults<
      ComputedOptions<
        TRow,
        TFields,
        TDefaultOptions[number],
        SelectValueType<TDefaultOptions[number]>
      >,
      TDefaults
    > & { readonly options?: never },
  >(
    options: TOptions &
      BrunoTableComputedColumnDependencies<TRow, TFields, TDefaultOptions[number]>,
  ): PresetResult<
    SelectBuiltIn<TDefaultOptions[number]>,
    TDefaults,
    TOptions & BrunoTableComputedColumnDependencies<TRow, TFields, TDefaultOptions[number]>,
    BrunoTableComputedColumnDefinition<
      TRow,
      TFields,
      TDefaultOptions[number],
      SelectValueType<TDefaultOptions[number]>
    >
  >;
  function BrunoTableSelectColumnPreset(options: RuntimeColumnOptions) {
    return mergeSelectRuntimeColumn(defaultsSnapshot, options);
  }

  return BrunoTableSelectColumnPreset;
}

export const BrunoTableSelectColumn: SelectColumnHelper = Object.assign(
  BrunoTableSelectColumnBase,
  {
    withDefaults: BrunoTableSelectColumnWithDefaults,
  },
);

function mergeSelectRuntimeColumn(
  defaults: RuntimeColumnOptions,
  options: RuntimeColumnOptions,
): RuntimeColumnOptions {
  const merged = { ...defaults, ...options };
  const selectOptions = merged["options"];

  if (!Array.isArray(selectOptions) || selectOptions.length === 0) {
    throw new TypeError("BrunoTable Select Column options must be a non-empty array.");
  }

  const optionsSnapshot = Object.freeze(Array.from(selectOptions));
  const valueType = createSelectValueType(optionsSnapshot);

  return mergeRuntimeColumn(
    {
      valueType,
      cellAlign: "start",
      editorLayout: "fullWidth",
      width: 160,
    },
    defaults,
    { ...options, options: optionsSnapshot },
  );
}

function snapshotPresetDefaults(
  defaults: RuntimeColumnOptions,
  allowedKeys: ReadonlySet<PropertyKey>,
): RuntimeColumnOptions {
  for (const key of Reflect.ownKeys(defaults)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`BrunoTable Column Helper preset does not accept ${String(key)}.`);
    }
  }

  const format = defaults["format"];
  const options = defaults["options"];
  return Object.freeze({
    ...defaults,
    ...(isRecord(format) ? { format: Object.freeze({ ...format }) } : {}),
    ...(Array.isArray(options) ? { options: Object.freeze(Array.from(options)) } : {}),
  });
}

function createSelectValueType(
  options: readonly unknown[],
): BrunoTableValueType<unknown, "select", "select"> {
  const kind = typeof options[0];
  if (!isSelectPrimitiveKind(kind) || options.some((option) => typeof option !== kind)) {
    throw new TypeError(
      "BrunoTable Select Column options must use one homogeneous string, number, bigint, or boolean domain.",
    );
  }

  if (
    kind === "number" &&
    options.some((option) => typeof option !== "number" || !Number.isFinite(option))
  ) {
    throw new TypeError("BrunoTable Select Column number options must be finite.");
  }

  const canonicalOptions = options.map(formatSelectCanonicalText);
  if (new Set(canonicalOptions).size !== canonicalOptions.length) {
    throw new TypeError("BrunoTable Select Column options must be semantically unique.");
  }

  const findOption = (input: unknown) => options.find((option) => option === input);
  const decodeOption = (input: unknown) => {
    const option = findOption(input);
    return option === undefined
      ? ({
          _tag: "Failure",
          message: "Value is not one of the configured Select options.",
        } as const)
      : ({ _tag: "Success", value: option } as const);
  };

  const descriptor: BrunoTableValueType<unknown, "select", "select"> = {
    codecId: "@bruno/table/select",
    codecVersion: 1,
    filterFamily: "select",
    editorFamily: "select",
    cellAlign: "start",
    editorLayout: "fullWidth",
    defaultWidth: 160,
    decodeRuntime: decodeOption,
    equivalent: (left, right) => left === right,
    compare: (left, right) => compareIndexes(options.indexOf(left), options.indexOf(right)),
    formatCanonicalText: formatSelectCanonicalText,
    parseCanonicalText: (text) => {
      const index = canonicalOptions.indexOf(text);
      return index === -1
        ? { _tag: "Failure", message: "Text is not one of the configured Select options." }
        : { _tag: "Success", value: options[index] };
    },
    formatDisplay: formatSelectCanonicalText,
    encodePersisted: (value) => ({
      $brunoTableValue: "select",
      version: 1,
      value: encodeSelectPrimitive(value),
    }),
    decodePersisted: (input) => {
      if (!isRecord(input) || input["$brunoTableValue"] !== "select" || input["version"] !== 1) {
        return { _tag: "Failure", message: "Persisted Select value has an invalid tag." };
      }
      return decodeOption(decodeSelectPrimitive(input["value"]));
    },
  };
  return Object.freeze(descriptor);
}

function isSelectPrimitiveKind(kind: string): kind is "string" | "number" | "bigint" | "boolean" {
  return kind === "string" || kind === "number" || kind === "bigint" || kind === "boolean";
}

function formatSelectCanonicalText(value: unknown): string {
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

function compareIndexes(left: number, right: number): BrunoTableOrdering {
  return left === right ? 0 : left < right ? -1 : 1;
}

function encodeSelectPrimitive(value: unknown): BrunoTableJsonValue {
  switch (typeof value) {
    case "string":
      return { type: "string", value };
    case "number":
      return { type: "number", value: String(value) };
    case "bigint":
      return { type: "bigint", value: value.toString(10) };
    case "boolean":
      return { type: "boolean", value };
    default:
      return null;
  }
}

function decodeSelectPrimitive(input: unknown): unknown {
  if (!isRecord(input) || typeof input["type"] !== "string") {
    return undefined;
  }

  const value = input["value"];
  switch (input["type"]) {
    case "string":
      return typeof value === "string" ? value : undefined;
    case "number": {
      if (typeof value !== "string" || value.trim().length === 0) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case "bigint":
      return typeof value === "string" && /^-?\d+$/u.test(value) ? BigInt(value) : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    default:
      return undefined;
  }
}
