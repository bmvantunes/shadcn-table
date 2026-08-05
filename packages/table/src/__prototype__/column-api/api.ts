// PROTOTYPE — this module answers whether the desired plain-array Column Helper API can preserve
// strict row, field, callback, computed-dependency, and save-payload inference. It is not production.

export type BrunoTablePrototypeColumnId = `COL_ID_${Uppercase<string>}`;

export type BrunoTablePrototypeRowId = string;

type BrunoTablePrototypeFieldKey<TRow> = Extract<keyof TRow, string>;

type BrunoTablePrototypeNonNullish<TValue> = Exclude<TValue, null | undefined>;

type BrunoTablePrototypeFieldOfKind<TRow, TValueKind> = {
  readonly [TField in BrunoTablePrototypeFieldKey<TRow>]: [
    BrunoTablePrototypeNonNullish<TRow[TField]>,
  ] extends [never]
    ? never
    : [BrunoTablePrototypeNonNullish<TRow[TField]>] extends [TValueKind]
      ? TField
      : never;
}[BrunoTablePrototypeFieldKey<TRow>];

type BrunoTablePrototypeNonEmptyFields<TRow> = readonly [
  BrunoTablePrototypeFieldKey<TRow>,
  ...BrunoTablePrototypeFieldKey<TRow>[],
];

export type BrunoTablePrototypeCellAlign = "start" | "center" | "end";

export type BrunoTablePrototypeEditorLayout = "center" | "inline" | "fullWidth";

export type BrunoTablePrototypeNumberFormat = {
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
};

type BrunoTablePrototypeValueParams<TRow, TValue> = {
  readonly row: TRow;
  readonly value: TValue;
};

type BrunoTablePrototypePresentation<TRow, TValue> = {
  readonly valueFormatter?: (params: BrunoTablePrototypeValueParams<TRow, TValue>) => string;
  readonly cellClassName?:
    | string
    | ((params: BrunoTablePrototypeValueParams<TRow, TValue>) => string | undefined);
  readonly cellRenderer?: (params: BrunoTablePrototypeValueParams<TRow, TValue>) => unknown;
};

type BrunoTablePrototypeEditable<TRow, TValue> = {
  readonly isEditable?:
    | boolean
    | ((params: BrunoTablePrototypeValueParams<TRow, TValue>) => boolean);
};

type BrunoTablePrototypeCommonColumn = {
  readonly columnId: BrunoTablePrototypeColumnId;
  readonly headerName: string;
  readonly width?: number;
  readonly cellAlign?: BrunoTablePrototypeCellAlign;
  readonly editorLayout?: BrunoTablePrototypeEditorLayout;
  readonly enableFilter?: boolean;
  readonly enableSorting?: boolean;
};

type BrunoTablePrototypeFieldColumn<
  TRow,
  TField extends BrunoTablePrototypeFieldKey<TRow>,
  TValueType extends "bigint" | "boolean" | "number" | "text",
> = BrunoTablePrototypeCommonColumn &
  BrunoTablePrototypePresentation<TRow, TRow[TField]> &
  BrunoTablePrototypeEditable<TRow, TRow[TField]> & {
    readonly field: TField;
    readonly valueType: TValueType;
    readonly fields?: never;
    readonly valueGetter?: never;
  };

type BrunoTablePrototypeComputedColumn<
  TRow,
  TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  TValue,
  TValueType extends "bigint" | "boolean" | "number" | "text",
> = BrunoTablePrototypeCommonColumn &
  BrunoTablePrototypePresentation<TRow, TValue> & {
    readonly fields: TFields;
    readonly valueGetter: (params: { readonly row: Pick<TRow, TFields[number]> }) => TValue;
    readonly valueType: TValueType;
    readonly field?: never;
    readonly isEditable?: never;
    readonly enableFilter?: never;
    readonly enableSorting?: never;
  };

type BrunoTablePrototypeFieldColumns<TRow> = {
  readonly [TField in BrunoTablePrototypeFieldKey<TRow>]:
    | (BrunoTablePrototypeNonNullish<TRow[TField]> extends string
        ? BrunoTablePrototypeFieldColumn<TRow, TField, "text">
        : never)
    | (BrunoTablePrototypeNonNullish<TRow[TField]> extends number
        ? BrunoTablePrototypeFieldColumn<TRow, TField, "number">
        : never)
    | (BrunoTablePrototypeNonNullish<TRow[TField]> extends bigint
        ? BrunoTablePrototypeFieldColumn<TRow, TField, "bigint">
        : never)
    | (BrunoTablePrototypeNonNullish<TRow[TField]> extends boolean
        ? BrunoTablePrototypeFieldColumn<TRow, TField, "boolean">
        : never);
}[BrunoTablePrototypeFieldKey<TRow>];

type BrunoTablePrototypeAnyComputedColumn<TRow> =
  | BrunoTablePrototypeComputedColumn<TRow, BrunoTablePrototypeNonEmptyFields<TRow>, string, "text">
  | BrunoTablePrototypeComputedColumn<
      TRow,
      BrunoTablePrototypeNonEmptyFields<TRow>,
      number,
      "number"
    >
  | BrunoTablePrototypeComputedColumn<
      TRow,
      BrunoTablePrototypeNonEmptyFields<TRow>,
      bigint,
      "bigint"
    >
  | BrunoTablePrototypeComputedColumn<
      TRow,
      BrunoTablePrototypeNonEmptyFields<TRow>,
      boolean,
      "boolean"
    >;

export type BrunoTablePrototypeColumns<TRow> = readonly (
  | BrunoTablePrototypeFieldColumns<TRow>
  | BrunoTablePrototypeAnyComputedColumn<TRow>
)[];

type BrunoTablePrototypeMerge<TDefaults, TOptions> = Omit<TDefaults, keyof TOptions> & TOptions;

type BrunoTablePrototypeApplyDefaults<TOptions, TDefaults> = Omit<
  TOptions,
  Extract<keyof TDefaults, keyof TOptions>
> &
  Partial<Pick<TOptions, Extract<keyof TDefaults, keyof TOptions>>>;

type BrunoTablePrototypeHelperResult<TBuiltIn, TOptions, TColumn> = BrunoTablePrototypeMerge<
  TBuiltIn,
  TOptions
> &
  TColumn;

type BrunoTablePrototypePresetResult<TBuiltIn, TDefaults, TOptions, TColumn> =
  BrunoTablePrototypeMerge<BrunoTablePrototypeMerge<TBuiltIn, TDefaults>, TOptions> & TColumn;

type BrunoTablePrototypeFieldInput<
  TRow,
  TField extends BrunoTablePrototypeFieldKey<TRow>,
  TValueType extends "bigint" | "boolean" | "number" | "text",
> = Omit<
  BrunoTablePrototypeFieldColumn<TRow, TField, TValueType>,
  "cellAlign" | "editorLayout" | "valueType"
> & {
  readonly cellAlign?: BrunoTablePrototypeCellAlign;
  readonly editorLayout?: BrunoTablePrototypeEditorLayout;
};

type BrunoTablePrototypeComputedInput<
  TRow,
  TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  TValue,
  TValueType extends "bigint" | "boolean" | "number" | "text",
> = Omit<
  BrunoTablePrototypeComputedColumn<TRow, TFields, TValue, TValueType>,
  "cellAlign" | "editorLayout" | "valueType"
> & {
  readonly cellAlign?: BrunoTablePrototypeCellAlign;
  readonly editorLayout?: BrunoTablePrototypeEditorLayout;
};

type BrunoTablePrototypeComputedDependencies<
  TRow,
  TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  TValue,
> = {
  readonly fields: TFields;
  readonly valueGetter: (params: { readonly row: Pick<TRow, TFields[number]> }) => TValue;
};

type BrunoTablePrototypeComputedOptions<
  TRow,
  TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  TValue,
  TValueType extends "bigint" | "boolean" | "number" | "text",
> = Omit<
  BrunoTablePrototypeComputedInput<TRow, TFields, TValue, TValueType>,
  "fields" | "valueGetter"
>;

type BrunoTablePrototypeTextBuiltIn = {
  readonly cellAlign: "start";
  readonly editorLayout: "inline";
  readonly valueType: "text";
};

type BrunoTablePrototypeNumberBuiltIn = {
  readonly cellAlign: "end";
  readonly editorLayout: "inline";
  readonly valueType: "number";
};

type BrunoTablePrototypeBigIntBuiltIn = {
  readonly cellAlign: "end";
  readonly editorLayout: "inline";
  readonly valueType: "bigint";
};

type BrunoTablePrototypeBooleanBuiltIn = {
  readonly cellAlign: "center";
  readonly editorLayout: "center";
  readonly valueType: "boolean";
};

type BrunoTablePrototypeNumberOptions = {
  readonly format?: BrunoTablePrototypeNumberFormat;
};

type BrunoTablePrototypeTextPresetDefaults = Partial<
  Pick<
    BrunoTablePrototypeCommonColumn,
    "cellAlign" | "editorLayout" | "enableFilter" | "enableSorting" | "headerName" | "width"
  >
>;

type BrunoTablePrototypeNumberPresetDefaults = BrunoTablePrototypeTextPresetDefaults &
  BrunoTablePrototypeNumberOptions;

type BrunoTablePrototypeRuntimeOptions = {
  readonly columnId: BrunoTablePrototypeColumnId;
  readonly headerName?: string;
  readonly field?: string;
  readonly fields?: readonly string[];
  readonly format?: BrunoTablePrototypeNumberFormat;
};

type BrunoTablePrototypeRuntimeDefaults = {
  readonly cellAlign?: BrunoTablePrototypeCellAlign;
  readonly editorLayout?: BrunoTablePrototypeEditorLayout;
  readonly enableFilter?: boolean;
  readonly enableSorting?: boolean;
  readonly format?: BrunoTablePrototypeNumberFormat;
  readonly headerName?: string;
  readonly width?: number;
};

function BrunoTablePrototypeMergeRuntimeColumn(
  valueType: "bigint" | "boolean" | "number" | "text",
  builtIn: BrunoTablePrototypeRuntimeDefaults,
  defaults: BrunoTablePrototypeRuntimeDefaults,
  options: BrunoTablePrototypeRuntimeOptions,
) {
  const format =
    builtIn.format === undefined && defaults.format === undefined && options.format === undefined
      ? undefined
      : {
          ...builtIn.format,
          ...defaults.format,
          ...options.format,
        };

  return {
    valueType,
    ...builtIn,
    ...defaults,
    ...options,
    format,
  };
}

const BrunoTablePrototypeTextBuiltInDefaults: BrunoTablePrototypeTextBuiltIn = {
  cellAlign: "start",
  editorLayout: "inline",
  valueType: "text",
};

const BrunoTablePrototypeNumberBuiltInDefaults: BrunoTablePrototypeNumberBuiltIn = {
  cellAlign: "end",
  editorLayout: "inline",
  valueType: "number",
};

const BrunoTablePrototypeBigIntBuiltInDefaults: BrunoTablePrototypeBigIntBuiltIn = {
  cellAlign: "end",
  editorLayout: "inline",
  valueType: "bigint",
};

const BrunoTablePrototypeBooleanBuiltInDefaults: BrunoTablePrototypeBooleanBuiltIn = {
  cellAlign: "center",
  editorLayout: "center",
  valueType: "boolean",
};

function BrunoTableTextColumnBase<
  TRow,
  TField extends BrunoTablePrototypeFieldOfKind<TRow, string>,
  const TOptions extends BrunoTablePrototypeFieldInput<TRow, TField, "text">,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeTextBuiltIn,
  TOptions,
  BrunoTablePrototypeFieldColumn<TRow, TField, "text">
>;
function BrunoTableTextColumnBase<
  TRow,
  const TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  const TOptions extends BrunoTablePrototypeComputedInput<TRow, TFields, string, "text">,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeTextBuiltIn,
  TOptions,
  BrunoTablePrototypeComputedColumn<TRow, TFields, string, "text">
>;
function BrunoTableTextColumnBase(options: BrunoTablePrototypeRuntimeOptions) {
  return BrunoTablePrototypeMergeRuntimeColumn(
    "text",
    BrunoTablePrototypeTextBuiltInDefaults,
    {},
    options,
  );
}

function BrunoTableTextColumnWithDefaults<
  const TDefaults extends BrunoTablePrototypeTextPresetDefaults,
>(defaults: TDefaults) {
  function BrunoTableTextColumnPreset<
    TRow,
    TField extends BrunoTablePrototypeFieldOfKind<TRow, string>,
    const TOptions extends BrunoTablePrototypeApplyDefaults<
      BrunoTablePrototypeFieldInput<TRow, TField, "text">,
      TDefaults
    >,
  >(
    options: TOptions,
  ): BrunoTablePrototypePresetResult<
    BrunoTablePrototypeTextBuiltIn,
    TDefaults,
    TOptions,
    BrunoTablePrototypeFieldColumn<TRow, TField, "text">
  >;
  function BrunoTableTextColumnPreset<
    TRow,
    const TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
    const TOptions extends BrunoTablePrototypeApplyDefaults<
      BrunoTablePrototypeComputedInput<TRow, TFields, string, "text">,
      TDefaults
    >,
  >(
    options: TOptions,
  ): BrunoTablePrototypePresetResult<
    BrunoTablePrototypeTextBuiltIn,
    TDefaults,
    TOptions,
    BrunoTablePrototypeComputedColumn<TRow, TFields, string, "text">
  >;
  function BrunoTableTextColumnPreset(options: BrunoTablePrototypeRuntimeOptions) {
    return BrunoTablePrototypeMergeRuntimeColumn(
      "text",
      BrunoTablePrototypeTextBuiltInDefaults,
      defaults,
      options,
    );
  }

  return BrunoTableTextColumnPreset;
}

export const BrunoTablePrototypeTextColumn = Object.assign(BrunoTableTextColumnBase, {
  withDefaults: BrunoTableTextColumnWithDefaults,
});

function BrunoTableNumberColumnBase<
  TRow,
  TField extends BrunoTablePrototypeFieldOfKind<TRow, number>,
  const TOptions extends BrunoTablePrototypeFieldInput<TRow, TField, "number"> &
    BrunoTablePrototypeNumberOptions,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeNumberBuiltIn,
  TOptions,
  BrunoTablePrototypeFieldColumn<TRow, TField, "number">
>;
function BrunoTableNumberColumnBase<
  TRow,
  const TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  const TOptions extends BrunoTablePrototypeComputedOptions<TRow, TFields, number, "number"> &
    BrunoTablePrototypeNumberOptions,
>(
  options: TOptions & BrunoTablePrototypeComputedDependencies<TRow, TFields, number>,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeNumberBuiltIn,
  TOptions & BrunoTablePrototypeComputedDependencies<TRow, TFields, number>,
  BrunoTablePrototypeComputedColumn<TRow, TFields, number, "number">
>;
function BrunoTableNumberColumnBase(options: BrunoTablePrototypeRuntimeOptions) {
  return BrunoTablePrototypeMergeRuntimeColumn(
    "number",
    BrunoTablePrototypeNumberBuiltInDefaults,
    {},
    options,
  );
}

function BrunoTableNumberColumnWithDefaults<
  const TDefaults extends BrunoTablePrototypeNumberPresetDefaults,
>(defaults: TDefaults) {
  function BrunoTableNumberColumnPreset<
    TRow,
    TField extends BrunoTablePrototypeFieldOfKind<TRow, number>,
    const TOptions extends BrunoTablePrototypeApplyDefaults<
      BrunoTablePrototypeFieldInput<TRow, TField, "number"> & BrunoTablePrototypeNumberOptions,
      TDefaults
    >,
  >(
    options: TOptions,
  ): BrunoTablePrototypePresetResult<
    BrunoTablePrototypeNumberBuiltIn,
    TDefaults,
    TOptions,
    BrunoTablePrototypeFieldColumn<TRow, TField, "number">
  >;
  function BrunoTableNumberColumnPreset<
    TRow,
    const TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
    const TOptions extends BrunoTablePrototypeApplyDefaults<
      BrunoTablePrototypeComputedOptions<TRow, TFields, number, "number"> &
        BrunoTablePrototypeNumberOptions,
      TDefaults
    >,
  >(
    options: TOptions & BrunoTablePrototypeComputedDependencies<TRow, TFields, number>,
  ): BrunoTablePrototypePresetResult<
    BrunoTablePrototypeNumberBuiltIn,
    TDefaults,
    TOptions & BrunoTablePrototypeComputedDependencies<TRow, TFields, number>,
    BrunoTablePrototypeComputedColumn<TRow, TFields, number, "number">
  >;
  function BrunoTableNumberColumnPreset(options: BrunoTablePrototypeRuntimeOptions) {
    return BrunoTablePrototypeMergeRuntimeColumn(
      "number",
      BrunoTablePrototypeNumberBuiltInDefaults,
      defaults,
      options,
    );
  }

  return BrunoTableNumberColumnPreset;
}

export const BrunoTablePrototypeNumberColumn = Object.assign(BrunoTableNumberColumnBase, {
  withDefaults: BrunoTableNumberColumnWithDefaults,
});

function BrunoTableBigIntColumnBase<
  TRow,
  TField extends BrunoTablePrototypeFieldOfKind<TRow, bigint>,
  const TOptions extends BrunoTablePrototypeFieldInput<TRow, TField, "bigint">,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeBigIntBuiltIn,
  TOptions,
  BrunoTablePrototypeFieldColumn<TRow, TField, "bigint">
>;
function BrunoTableBigIntColumnBase<
  TRow,
  const TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  const TOptions extends BrunoTablePrototypeComputedInput<TRow, TFields, bigint, "bigint">,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeBigIntBuiltIn,
  TOptions,
  BrunoTablePrototypeComputedColumn<TRow, TFields, bigint, "bigint">
>;
function BrunoTableBigIntColumnBase(options: BrunoTablePrototypeRuntimeOptions) {
  return BrunoTablePrototypeMergeRuntimeColumn(
    "bigint",
    BrunoTablePrototypeBigIntBuiltInDefaults,
    {},
    options,
  );
}

export const BrunoTablePrototypeBigIntColumn = BrunoTableBigIntColumnBase;

function BrunoTableBooleanColumnBase<
  TRow,
  TField extends BrunoTablePrototypeFieldOfKind<TRow, boolean>,
  const TOptions extends BrunoTablePrototypeFieldInput<TRow, TField, "boolean">,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeBooleanBuiltIn,
  TOptions,
  BrunoTablePrototypeFieldColumn<TRow, TField, "boolean">
>;
function BrunoTableBooleanColumnBase<
  TRow,
  const TFields extends BrunoTablePrototypeNonEmptyFields<TRow>,
  const TOptions extends BrunoTablePrototypeComputedInput<TRow, TFields, boolean, "boolean">,
>(
  options: TOptions,
): BrunoTablePrototypeHelperResult<
  BrunoTablePrototypeBooleanBuiltIn,
  TOptions,
  BrunoTablePrototypeComputedColumn<TRow, TFields, boolean, "boolean">
>;
function BrunoTableBooleanColumnBase(options: BrunoTablePrototypeRuntimeOptions) {
  return BrunoTablePrototypeMergeRuntimeColumn(
    "boolean",
    BrunoTablePrototypeBooleanBuiltInDefaults,
    {},
    options,
  );
}

export const BrunoTablePrototypeBooleanColumn = BrunoTableBooleanColumnBase;

export type BrunoTablePrototypeColumnIdOf<
  TColumns extends readonly { readonly columnId: BrunoTablePrototypeColumnId }[],
> = TColumns[number]["columnId"];

type BrunoTablePrototypeColumnForId<
  TColumns extends readonly { readonly columnId: BrunoTablePrototypeColumnId }[],
  TColumnId extends BrunoTablePrototypeColumnIdOf<TColumns>,
> = Extract<TColumns[number], { readonly columnId: TColumnId }>;

export type BrunoTablePrototypeColumnValue<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
  TColumnId extends BrunoTablePrototypeColumnIdOf<TColumns>,
> =
  BrunoTablePrototypeColumnForId<TColumns, TColumnId> extends {
    readonly valueGetter: (...parameters: never[]) => infer TValue;
  }
    ? TValue
    : BrunoTablePrototypeColumnForId<TColumns, TColumnId> extends {
          readonly field: infer TField;
        }
      ? TField extends keyof TRow
        ? TRow[TField]
        : never
      : never;

export type BrunoTablePrototypeEditableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTablePrototypeColumnId }[],
> = TColumns[number] extends infer TColumn
  ? TColumn extends {
      readonly columnId: infer TColumnId extends BrunoTablePrototypeColumnId;
      readonly field: string;
      readonly isEditable: infer TEditable;
    }
    ? TEditable extends false
      ? never
      : TColumnId
    : never
  : never;

export type BrunoTablePrototypeColumnField<
  TColumns extends readonly { readonly columnId: BrunoTablePrototypeColumnId }[],
  TColumnId extends BrunoTablePrototypeColumnIdOf<TColumns>,
> =
  BrunoTablePrototypeColumnForId<TColumns, TColumnId> extends {
    readonly field: infer TField extends string;
  }
    ? TField
    : never;

export type BrunoTablePrototypeSaveCellChange<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
> = {
  readonly [TColumnId in BrunoTablePrototypeEditableColumnId<TColumns>]: {
    readonly columnId: TColumnId;
    readonly field: BrunoTablePrototypeColumnField<TColumns, TColumnId>;
    readonly before: BrunoTablePrototypeColumnValue<TRow, TColumns, TColumnId>;
    readonly after: BrunoTablePrototypeColumnValue<TRow, TColumns, TColumnId>;
  };
}[BrunoTablePrototypeEditableColumnId<TColumns>];

export type BrunoTablePrototypeSaveCellChangeSet<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
> = readonly [
  BrunoTablePrototypeSaveCellChange<TRow, TColumns>,
  ...BrunoTablePrototypeSaveCellChange<TRow, TColumns>[],
];

export type BrunoTablePrototypeSaveRowChange<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
  TRowVersion,
> = {
  readonly rowId: BrunoTablePrototypeRowId;
  readonly baseRow: TRow;
  readonly expectedVersion: TRowVersion;
  readonly changes: BrunoTablePrototypeSaveCellChangeSet<TRow, TColumns>;
};

export type BrunoTablePrototypeSaveChangeSet<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
  TRowVersion,
> = readonly [
  BrunoTablePrototypeSaveRowChange<TRow, TColumns, TRowVersion>,
  ...BrunoTablePrototypeSaveRowChange<TRow, TColumns, TRowVersion>[],
];

export type BrunoTablePrototypeSaveEditsHandler<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
  TRowVersion,
> = (changes: BrunoTablePrototypeSaveChangeSet<TRow, TColumns, TRowVersion>) => PromiseLike<void>;

type BrunoTablePrototypeReadOnlyCapability = {
  readonly editable?: false;
  readonly getRowVersion?: never;
  readonly onSaveEdits?: never;
};

type BrunoTablePrototypeEditableCapability<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
  TRowVersion,
> =
  BrunoTablePrototypeEditableColumnId<TColumns> extends never
    ? never
    : {
        readonly editable: true;
        readonly getRowVersion: (row: TRow) => TRowVersion;
        readonly onSaveEdits: BrunoTablePrototypeSaveEditsHandler<TRow, TColumns, TRowVersion>;
      };

export type BrunoTablePrototypeClientProps<
  TRow,
  TColumns extends BrunoTablePrototypeColumns<TRow>,
  TRowVersion,
> = {
  readonly tableId: string;
  readonly columns: TColumns;
  readonly clientSource: {
    readonly rows: readonly TRow[];
  };
  readonly getRowId: (row: TRow) => BrunoTablePrototypeRowId;
} & (
  | BrunoTablePrototypeReadOnlyCapability
  | BrunoTablePrototypeEditableCapability<TRow, TColumns, TRowVersion>
);

export function BrunoTablePrototypeClient<
  TRow,
  const TColumns extends BrunoTablePrototypeColumns<TRow>,
  TRowVersion,
>(
  props: BrunoTablePrototypeClientProps<TRow, TColumns, TRowVersion>,
): BrunoTablePrototypeClientProps<TRow, TColumns, TRowVersion> {
  return props;
}

type BrunoTablePrototypeInspectableColumn = {
  readonly columnId: BrunoTablePrototypeColumnId;
  readonly headerName: string;
  readonly valueType: "bigint" | "boolean" | "number" | "text";
  readonly field?: string;
  readonly fields?: readonly string[];
  readonly isEditable?: boolean | ((...parameters: never[]) => boolean);
  readonly cellAlign?: BrunoTablePrototypeCellAlign;
  readonly editorLayout?: BrunoTablePrototypeEditorLayout;
  readonly enableFilter?: boolean;
  readonly enableSorting?: boolean;
  readonly format?: BrunoTablePrototypeNumberFormat;
};

export type BrunoTablePrototypeCompiledColumn = {
  readonly columnId: BrunoTablePrototypeColumnId;
  readonly headerName: string;
  readonly valueType: "bigint" | "boolean" | "number" | "text";
  readonly source: { readonly field: string } | { readonly fields: readonly string[] };
  readonly filterable: boolean;
  readonly sortable: boolean;
  readonly potentiallyEditable: boolean;
  readonly cellAlign: BrunoTablePrototypeCellAlign;
  readonly editorLayout: BrunoTablePrototypeEditorLayout;
  readonly format?: BrunoTablePrototypeNumberFormat;
};

export type BrunoTablePrototypeCompiledColumns = {
  readonly columns: readonly BrunoTablePrototypeCompiledColumn[];
  readonly projection: readonly string[];
  readonly editableColumnIds: readonly BrunoTablePrototypeColumnId[];
};

export function BrunoTablePrototypeCompileColumns(
  columns: readonly BrunoTablePrototypeInspectableColumn[],
): BrunoTablePrototypeCompiledColumns {
  const seen = new Set<BrunoTablePrototypeColumnId>();
  const projection = new Set<string>();
  const editableColumnIds: BrunoTablePrototypeColumnId[] = [];
  const compiled: BrunoTablePrototypeCompiledColumn[] = [];

  for (const column of columns) {
    if (seen.has(column.columnId)) {
      throw new TypeError(`Duplicate Column Identity: ${column.columnId}`);
    }
    seen.add(column.columnId);

    const field = column.field;
    const fields = column.fields;
    const isField = field !== undefined;

    if (isField) {
      projection.add(field);
    } else if (fields !== undefined) {
      for (const dependency of fields) projection.add(dependency);
    }

    const potentiallyEditable =
      isField && column.isEditable !== undefined && column.isEditable !== false;
    if (potentiallyEditable) editableColumnIds.push(column.columnId);

    compiled.push({
      columnId: column.columnId,
      headerName: column.headerName,
      valueType: column.valueType,
      source: isField ? { field } : { fields: fields ?? [] },
      filterable: isField && column.enableFilter !== false,
      sortable: isField && column.enableSorting !== false,
      potentiallyEditable,
      cellAlign: column.cellAlign ?? "start",
      editorLayout: column.editorLayout ?? "inline",
      ...(column.format === undefined ? {} : { format: column.format }),
    });
  }

  return {
    columns: compiled,
    projection: [...projection],
    editableColumnIds,
  };
}
