import type { ReactNode } from "react";

type ColumnIdFirstCharacter =
  | "_"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

type ColumnIdWhitespace =
  | "\t"
  | "\n"
  | "\v"
  | "\f"
  | "\r"
  | " "
  | "\u00a0"
  | "\u1680"
  | "\u2000"
  | "\u2001"
  | "\u2002"
  | "\u2003"
  | "\u2004"
  | "\u2005"
  | "\u2006"
  | "\u2007"
  | "\u2008"
  | "\u2009"
  | "\u200a"
  | "\u2028"
  | "\u2029"
  | "\u202f"
  | "\u205f"
  | "\u3000"
  | "\ufeff";
type ColumnIdPattern = `COL_ID_${ColumnIdFirstCharacter}${Uppercase<string>}`;

export type BrunoTableColumnId<TColumnId extends ColumnIdPattern = ColumnIdPattern> =
  TColumnId extends `${string}${ColumnIdWhitespace}${string}` ? never : TColumnId;

/** @internal Applies literal Column Identity validation at inference boundaries. */
export type BrunoTableColumnIdentityInput<TOptions> = TOptions extends {
  readonly columnId: infer TColumnId extends ColumnIdPattern;
}
  ? { readonly columnId: BrunoTableColumnId<TColumnId> }
  : unknown;

export type BrunoTableRowId = string;

export type BrunoTableBuiltInValueType = "text" | "number" | "bigint" | "boolean";

export type BrunoTableOrdering = -1 | 0 | 1;

export type BrunoTableAggFunc = "countDistinct" | "sum" | "min" | "max" | "avg";

export type BrunoTableAggregateResultKind = "self" | "bigint";

export type BrunoTableAggregateResults = Readonly<
  Partial<Record<BrunoTableAggFunc, BrunoTableAggregateResultKind>>
>;

export type BrunoTableDecodeResult<TValue> =
  | { readonly _tag: "Success"; readonly value: TValue }
  | { readonly _tag: "Failure"; readonly message: string };

export type BrunoTableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BrunoTableJsonValue[]
  | { readonly [key: string]: BrunoTableJsonValue };

export type BrunoTableFilterFamily = "boolean" | "equality" | "numeric" | "select" | "text";

export type BrunoTableEditorFamily =
  | "bigdecimal"
  | "bigint"
  | "boolean"
  | "number"
  | "select"
  | "text";

export type BrunoTableCellAlign = "start" | "center" | "end";

export type BrunoTableEditorLayout = "inline" | "center" | "fullWidth";

export type BrunoTableNumberFormat = Intl.NumberFormatOptions;

/**
 * One explicit runtime value domain. BrunoTable snapshots this descriptor into a private compiled
 * plan during column normalization; mounted cells never discover or dispatch value kinds.
 */
export type BrunoTableValueType<
  TValue,
  TFilterFamily extends BrunoTableFilterFamily = BrunoTableFilterFamily,
  TEditorFamily extends BrunoTableEditorFamily = BrunoTableEditorFamily,
  TAggregateResults extends BrunoTableAggregateResults = {},
> = {
  readonly codecId: string;
  readonly codecVersion: number;
  readonly filterFamily: TFilterFamily;
  readonly editorFamily: TEditorFamily;
  readonly cellAlign: BrunoTableCellAlign;
  readonly editorLayout: BrunoTableEditorLayout;
  readonly defaultWidth: number;
  readonly decodeRuntime: (this: void, input: unknown) => BrunoTableDecodeResult<TValue>;
  readonly equivalent: (this: void, left: TValue, right: TValue) => boolean;
  readonly compare: (this: void, left: TValue, right: TValue) => BrunoTableOrdering;
  readonly formatCanonicalText: (this: void, value: TValue) => string;
  readonly parseCanonicalText: (this: void, text: string) => BrunoTableDecodeResult<TValue>;
  readonly formatDisplay: (this: void, value: TValue) => string;
  readonly encodePersisted: (this: void, value: TValue) => BrunoTableJsonValue;
  readonly decodePersisted: (this: void, input: unknown) => BrunoTableDecodeResult<TValue>;
} & ([keyof TAggregateResults] extends [never]
  ? { readonly aggregateResults?: TAggregateResults }
  : { readonly aggregateResults: TAggregateResults });

export type BrunoTableValueTypeValue<TValueType> = TValueType extends {
  readonly decodeRuntime: (this: void, input: unknown) => BrunoTableDecodeResult<infer TValue>;
}
  ? TValue
  : never;

export type BrunoTableSourceStatus = "loading" | "ready" | "stale" | "closed" | "error";

export type BrunoTableSourceRetry = {
  readonly run: (this: void) => void;
  readonly pending: boolean;
};

export type BrunoTableSourceChrome = {
  readonly totalRows: number;
  readonly version: number;
  readonly status: BrunoTableSourceStatus;
  readonly statusCode?: string | undefined;
  readonly message?: string | undefined;
  readonly retry?: BrunoTableSourceRetry | undefined;
};

export type BrunoTableClientSource<TRow> = BrunoTableSourceChrome & {
  readonly rows: readonly TRow[];
};

/**
 * The lifecycle envelope returned by a long-lived server viewport hook.
 *
 * `TViewport` stays opaque at the public boundary. The private server adapter is responsible for
 * narrowing it to the transport it supports; consumers never depend on rendering-engine state or
 * types.
 */
export type BrunoTableServerSource<TViewport = unknown> = BrunoTableSourceChrome & {
  readonly viewport: TViewport;
};

type FieldKey<TRow> = Extract<keyof TRow, string>;

type NonNullish<TValue> = Exclude<TValue, null | undefined>;

type NonEmptyFields<TRow> = readonly [FieldKey<TRow>, ...FieldKey<TRow>[]];

type ValueForBuiltInType<TValueType extends BrunoTableBuiltInValueType> = TValueType extends "text"
  ? string
  : TValueType extends "number"
    ? number
    : TValueType extends "bigint"
      ? bigint
      : boolean;

type ValueParams<TRow, TValue> = {
  readonly row: TRow;
  readonly value: TValue;
};

type GroupKeyCallback<TValue, TColumnId extends BrunoTableColumnId, TResult> = (
  parameters: BrunoTableGroupKeyCellParams<TValue, TColumnId>,
) => TResult;

type AggregateCallback<
  TValue,
  TColumnId extends BrunoTableColumnId,
  TAggFunc extends BrunoTableAggFunc,
  TResult,
> = (parameters: BrunoTableAggregateCellParams<TAggFunc, TValue, TColumnId>) => TResult;

type RowGroupKeyValue<TRow> = {
  readonly [TField in FieldKey<TRow>]: [NonNullish<TRow[TField]>] extends [never]
    ? never
    : {
        readonly columnId: BrunoTableColumnId;
        readonly field: TField;
        readonly value: TRow[TField];
      };
}[FieldKey<TRow>];

type DefinedGroupKeyValue<
  TRow,
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = TColumns[number] extends infer TColumn
  ? TColumn extends {
      readonly columnId: infer TColumnId extends BrunoTableColumnId;
      readonly field: infer TField extends FieldKey<TRow>;
      readonly groupBy: true;
    }
    ? {
        readonly columnId: TColumnId;
        readonly field: TField;
        readonly value: TRow[TField];
      }
    : never
  : never;

export type BrunoTableGroupKeyValue<
  TRow,
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[] | undefined = undefined,
> = TColumns extends readonly { readonly columnId: BrunoTableColumnId }[]
  ? DefinedGroupKeyValue<TRow, TColumns>
  : RowGroupKeyValue<TRow>;

export type BrunoTableGroupKeyValues<
  TRow,
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = readonly BrunoTableGroupKeyValue<TRow, TColumns>[];

export type BrunoTableGroupKeyCellParams<TValue, TColumnId extends BrunoTableColumnId> = {
  readonly columnId: TColumnId;
  readonly value: TValue;
  readonly rowCount: bigint;
};

export type BrunoTableAggregateCellParams<
  TAggFunc extends BrunoTableAggFunc,
  TValue,
  TColumnId extends BrunoTableColumnId,
> = {
  readonly columnId: TColumnId;
  readonly aggFunc: TAggFunc;
  readonly value: TValue;
  readonly rowCount: bigint;
};

type GroupKeyPresentation<TValue, TColumnId extends BrunoTableColumnId> =
  | {
      readonly groupBy?: false | undefined;
      readonly groupKeyValueFormatter?: never;
      readonly groupKeyCellClassName?: never;
      readonly groupKeyCellRenderer?: never;
    }
  | {
      readonly groupBy: true;
      readonly groupKeyValueFormatter?: GroupKeyCallback<TValue, TColumnId, string>;
      readonly groupKeyCellClassName?:
        | string
        | GroupKeyCallback<TValue, TColumnId, string | undefined>;
      readonly groupKeyCellRenderer?: GroupKeyCallback<TValue, TColumnId, ReactNode>;
    };

type BuiltInAggregateResults<TValueType extends BrunoTableBuiltInValueType> =
  TValueType extends "bigint"
    ? {
        readonly countDistinct: "bigint";
        readonly sum: "self";
        readonly min: "self";
        readonly max: "self";
      }
    : {
        readonly countDistinct: "bigint";
        readonly min: "self";
        readonly max: "self";
      };

type AggregateResultsFor<TValue, TValueType> = Omit<
  TValueType extends BrunoTableBuiltInValueType
    ? BuiltInAggregateResults<TValueType>
    : TValueType extends {
          readonly aggregateResults?: infer TAggregateResults extends BrunoTableAggregateResults;
        }
      ? TAggregateResults
      : {},
  [TValue] extends [NonNullish<TValue>] ? never : "sum" | "avg"
>;

type AggregateResultValue<TValue, TResultKind> = TResultKind extends "self"
  ? TValue
  : TResultKind extends "bigint"
    ? bigint
    : never;

type AggregatePresentationBranch<
  TValue,
  TColumnId extends BrunoTableColumnId,
  TAggFunc extends BrunoTableAggFunc,
  TResultKind extends BrunoTableAggregateResultKind,
> = {
  readonly aggFunc: TAggFunc;
  readonly aggregateValueFormatter?: AggregateCallback<
    AggregateResultValue<TValue, TResultKind>,
    TColumnId,
    TAggFunc,
    string
  >;
  readonly aggregateCellClassName?:
    | string
    | AggregateCallback<
        AggregateResultValue<TValue, TResultKind>,
        TColumnId,
        TAggFunc,
        string | undefined
      >;
  readonly aggregateCellRenderer?: AggregateCallback<
    AggregateResultValue<TValue, TResultKind>,
    TColumnId,
    TAggFunc,
    ReactNode
  >;
};

type AggregatePresentation<TValue, TValueType, TColumnId extends BrunoTableColumnId> =
  | {
      readonly aggFunc?: never;
      readonly aggregateValueFormatter?: never;
      readonly aggregateCellClassName?: never;
      readonly aggregateCellRenderer?: never;
    }
  | {
      readonly [TAggFunc in Extract<
        keyof AggregateResultsFor<TValue, TValueType>,
        BrunoTableAggFunc
      >]: AggregatePresentationBranch<
        TValue,
        TColumnId,
        TAggFunc,
        Extract<AggregateResultsFor<TValue, TValueType>[TAggFunc], BrunoTableAggregateResultKind>
      >;
    }[Extract<keyof AggregateResultsFor<TValue, TValueType>, BrunoTableAggFunc>];

type ColumnPresentation<TRow, TValue> = {
  readonly valueFormatter?: (parameters: ValueParams<TRow, TValue>) => string;
  readonly cellClassName?: string | ((parameters: ValueParams<TRow, TValue>) => string | undefined);
  readonly cellRenderer?: (parameters: ValueParams<TRow, TValue>) => ReactNode;
};

type ColumnLayout = {
  readonly width?: number;
  readonly cellAlign?: BrunoTableCellAlign;
  readonly editorLayout?: BrunoTableEditorLayout;
  readonly pinned?: "start" | "end";
};

type ValueGetterParams<TRow, TFields extends NonEmptyFields<TRow>> = {
  readonly row: Pick<TRow, TFields[number]>;
};

type FieldColumn<
  TRow,
  TField extends FieldKey<TRow>,
  TValueType extends BrunoTableBuiltInValueType | ErasedValueType,
  TColumnId extends BrunoTableColumnId = BrunoTableColumnId,
> = ColumnPresentation<TRow, TRow[TField]> &
  ColumnLayout & {
    readonly columnId: TColumnId;
    readonly field: TField;
    readonly headerName: string;
    readonly valueType: TValueType;
    readonly enableFilter?: boolean;
    readonly enableSorting?: boolean;
    readonly isEditable?: boolean | ((parameters: ValueParams<TRow, TRow[TField]>) => boolean);
    readonly format?: TValueType extends "number" ? BrunoTableNumberFormat : never;
    readonly fields?: never;
    readonly valueGetter?: never;
  } & GroupKeyPresentation<TRow[TField], TColumnId> &
  AggregatePresentation<TRow[TField], TValueType, TColumnId>;

type RawCustomFieldValueType<
  TValue,
  TAggregateResults extends BrunoTableAggregateResults = {},
> = BrunoTableValueType<
  NonNullish<TValue>,
  BrunoTableFilterFamily,
  BrunoTableEditorFamily,
  TAggregateResults
>;

type RawCustomFieldColumnWithoutAggregate<TRow, TField extends FieldKey<TRow>> = Extract<
  FieldColumn<TRow, TField, RawCustomFieldValueType<TRow[TField]>>,
  { readonly aggFunc?: never }
>;

type RawCustomAggregatedFieldColumn<TRow, TField extends FieldKey<TRow>> = {
  readonly [TAggFunc in BrunoTableAggFunc]: {
    readonly [TResultKind in BrunoTableAggregateResultKind]: Extract<
      FieldColumn<
        TRow,
        TField,
        RawCustomFieldValueType<TRow[TField], Readonly<Record<TAggFunc, TResultKind>>>
      >,
      { readonly aggFunc: TAggFunc }
    >;
  }[BrunoTableAggregateResultKind];
}[BrunoTableAggFunc];

type FieldColumns<TRow> = {
  readonly [TField in FieldKey<TRow>]:
    | ([NonNullish<TRow[TField]>] extends [never]
        ? never
        : NonNullish<TRow[TField]> extends string
          ? FieldColumn<TRow, TField, "text">
          : never)
    | (NonNullish<TRow[TField]> extends number ? FieldColumn<TRow, TField, "number"> : never)
    | (NonNullish<TRow[TField]> extends bigint ? FieldColumn<TRow, TField, "bigint"> : never)
    | (NonNullish<TRow[TField]> extends boolean ? FieldColumn<TRow, TField, "boolean"> : never)
    | ([NonNullish<TRow[TField]>] extends [never]
        ? never
        :
            | RawCustomFieldColumnWithoutAggregate<TRow, TField>
            | RawCustomAggregatedFieldColumn<TRow, TField>);
}[FieldKey<TRow>];

const computedColumnMarker: unique symbol = Symbol("BrunoTableComputedColumn");

type ComputedColumn<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType | ErasedValueType,
> = ColumnPresentation<TRow, TValue> &
  ColumnLayout & {
    readonly [computedColumnMarker]: true;
    readonly columnId: BrunoTableColumnId;
    readonly headerName: string;
    readonly fields: TFields;
    readonly valueGetter: (params: ValueGetterParams<TRow, TFields>) => TValue;
    readonly valueType: TValueType;
    readonly field?: never;
    readonly enableFilter?: never;
    readonly enableSorting?: never;
    readonly isEditable?: never;
    readonly format?: TValueType extends "number" ? BrunoTableNumberFormat : never;
  };

type ErasedValueType = {
  readonly codecId: string;
  readonly codecVersion: number;
  readonly filterFamily: BrunoTableFilterFamily;
  readonly editorFamily: BrunoTableEditorFamily;
  readonly cellAlign: BrunoTableCellAlign;
  readonly editorLayout: BrunoTableEditorLayout;
  readonly defaultWidth: number;
  readonly aggregateResults?: BrunoTableAggregateResults;
  readonly decodeRuntime: (input: unknown) => unknown;
  readonly equivalent: (...parameters: never[]) => unknown;
  readonly compare: (...parameters: never[]) => unknown;
  readonly formatCanonicalText: (...parameters: never[]) => unknown;
  readonly parseCanonicalText: (text: string) => unknown;
  readonly formatDisplay: (...parameters: never[]) => unknown;
  readonly encodePersisted: (...parameters: never[]) => unknown;
  readonly decodePersisted: (input: unknown) => unknown;
};

type ErasedCustomComputedColumn<TRow> = ColumnPresentation<TRow, never> &
  ColumnLayout & {
    readonly [computedColumnMarker]: true;
    readonly columnId: BrunoTableColumnId;
    readonly headerName: string;
    readonly fields: NonEmptyFields<TRow>;
    readonly valueGetter: (...parameters: never[]) => unknown;
    readonly valueType: ErasedValueType;
    readonly field?: never;
    readonly enableFilter?: never;
    readonly enableSorting?: never;
    readonly isEditable?: never;
    readonly format?: never;
  };

type AnyComputedColumn<TRow> =
  | {
      readonly [TValueType in BrunoTableBuiltInValueType]: ComputedColumn<
        TRow,
        NonEmptyFields<TRow>,
        ValueForBuiltInType<TValueType>,
        TValueType
      >;
    }[BrunoTableBuiltInValueType]
  | ErasedCustomComputedColumn<TRow>;

type ComputedColumnDependencies<TRow, TFields extends NonEmptyFields<TRow>, TValue> = {
  readonly fields: TFields;
  readonly valueGetter: (params: ValueGetterParams<TRow, TFields>) => TValue;
};

type ComputedColumnOptions<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType | ErasedValueType,
> = Omit<
  ComputedColumn<TRow, TFields, TValue, TValueType>,
  typeof computedColumnMarker | "fields" | "valueGetter"
>;

/** A string key of the consumer's Row type. */
export type BrunoTableFieldKey<TRow> = FieldKey<TRow>;

/** @internal Shared only with BrunoTable's first-party Column Helper implementation. */
export type BrunoTableNonNullish<TValue> = NonNullish<TValue>;

/** @internal Shared only with BrunoTable's first-party Column Helper implementation. */
export type BrunoTableNonEmptyFields<TRow> = NonEmptyFields<TRow>;

/** @internal Shared only with BrunoTable's first-party Column Helper implementation. */
type SelectFieldColumnCapabilities<TColumn, TOptions> = [TOptions] extends [void]
  ? TColumn
  : TOptions extends {
        readonly groupBy: true;
      }
    ? TOptions extends { readonly aggFunc: infer TAggFunc }
      ? Extract<TColumn, { readonly groupBy: true; readonly aggFunc: TAggFunc }>
      : Extract<TColumn, { readonly groupBy: true; readonly aggFunc?: never }>
    : TOptions extends { readonly aggFunc: infer TAggFunc }
      ? Extract<TColumn, { readonly groupBy?: false | undefined; readonly aggFunc: TAggFunc }>
      : Extract<TColumn, { readonly groupBy?: false | undefined; readonly aggFunc?: never }>;

/** Exact structural Field Column definition for advanced raw configuration. */
export type BrunoTableFieldColumnDefinition<
  TRow,
  TField extends FieldKey<TRow>,
  TValueType extends BrunoTableBuiltInValueType | ErasedValueType,
  TOptions = void,
  TColumnId extends BrunoTableColumnId = BrunoTableColumnId,
> = BrunoTableFieldColumnInput<TRow, TField, TValueType, TOptions, TColumnId>;

/** @internal Capability-selecting input shape for first-party Column Helpers. */
export type BrunoTableFieldColumnInput<
  TRow,
  TField extends FieldKey<TRow>,
  TValueType extends BrunoTableBuiltInValueType | ErasedValueType,
  TOptions = void,
  TColumnId extends BrunoTableColumnId = BrunoTableColumnId,
> = SelectFieldColumnCapabilities<FieldColumn<TRow, TField, TValueType, TColumnId>, TOptions>;

/** @internal Shared only with BrunoTable's first-party Column Helper implementation. */
export type BrunoTableComputedColumnDefinition<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType | BrunoTableValueType<TValue>,
> = ComputedColumn<TRow, TFields, TValue, TValueType>;

/** @internal Shared only with BrunoTable's first-party Column Helper implementation. */
export type BrunoTableComputedColumnDependencies<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
> = ComputedColumnDependencies<TRow, TFields, TValue>;

/** @internal Shared only with BrunoTable's first-party Column Helper implementation. */
export type BrunoTableComputedColumnInput<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType | BrunoTableValueType<TValue>,
> = ComputedColumnOptions<TRow, TFields, TValue, TValueType> &
  ComputedColumnDependencies<TRow, TFields, TValue>;

/**
 * Captures a Computed Column's exact dependency tuple before contextually typing its getter.
 * Built-in Value Type helpers will delegate to this strict construction boundary.
 */
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, string, "text">,
>(
  options: TOptions &
    BrunoTableColumnIdentityInput<TOptions> &
    ComputedColumnDependencies<TRow, TFields, string>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, string> &
  ComputedColumn<TRow, TFields, string, "text">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, number, "number">,
>(
  options: TOptions &
    BrunoTableColumnIdentityInput<TOptions> &
    ComputedColumnDependencies<TRow, TFields, number>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, number> &
  ComputedColumn<TRow, TFields, number, "number">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, bigint, "bigint">,
>(
  options: TOptions &
    BrunoTableColumnIdentityInput<TOptions> &
    ComputedColumnDependencies<TRow, TFields, bigint>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, bigint> &
  ComputedColumn<TRow, TFields, bigint, "bigint">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, boolean, "boolean">,
>(
  options: TOptions &
    BrunoTableColumnIdentityInput<TOptions> &
    ComputedColumnDependencies<TRow, TFields, boolean>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, boolean> &
  ComputedColumn<TRow, TFields, boolean, "boolean">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TValueType extends ErasedValueType,
  const TOptions extends ComputedColumnOptions<
    TRow,
    TFields,
    BrunoTableValueTypeValue<TValueType>,
    TValueType
  >,
>(
  options: TOptions &
    BrunoTableColumnIdentityInput<TOptions> & {
      readonly valueType: TValueType;
    } & ComputedColumnDependencies<TRow, TFields, BrunoTableValueTypeValue<TValueType>>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, BrunoTableValueTypeValue<TValueType>> &
  ComputedColumn<TRow, TFields, BrunoTableValueTypeValue<TValueType>, TValueType>;
export function BrunoTableComputedColumn(options: Readonly<Record<string, unknown>>) {
  return { ...options, [computedColumnMarker]: true };
}

type GroupedPresentationCallbackKey =
  | "groupKeyValueFormatter"
  | "groupKeyCellClassName"
  | "groupKeyCellRenderer"
  | "aggregateValueFormatter"
  | "aggregateCellClassName"
  | "aggregateCellRenderer";

type EraseCallbackParameters<TValue> = TValue extends (...parameters: never[]) => infer TResult
  ? (...parameters: never[]) => TResult
  : TValue;

type EraseGroupedPresentationCallbacks<TColumn> = TColumn extends unknown
  ? {
      readonly [TKey in keyof TColumn]: TKey extends GroupedPresentationCallbackKey
        ? EraseCallbackParameters<TColumn[TKey]>
        : TColumn[TKey];
    }
  : never;

type Column<TRow> = EraseGroupedPresentationCallbacks<FieldColumns<TRow>> | AnyComputedColumn<TRow>;

/**
 * A plain column array intended to be used with `satisfies`.
 *
 * No helper call is required, so literal column identities and computed getter return types remain
 * available from the consumer's `typeof columns`.
 */
export type BrunoTableColumns<TRow> = readonly Column<TRow>[];

export type BrunoTableColumnIdOf<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = TColumns[number]["columnId"];

type ColumnForId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
  TColumnId extends BrunoTableColumnIdOf<TColumns>,
> = Extract<TColumns[number], { readonly columnId: TColumnId }>;

export type BrunoTableColumnField<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
  TColumnId extends BrunoTableColumnIdOf<TColumns>,
> =
  ColumnForId<TColumns, TColumnId> extends { readonly field: infer TField extends string }
    ? TField
    : never;

export type BrunoTableColumnValue<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TColumnId extends BrunoTableColumnIdOf<TColumns>,
> =
  ColumnForId<TColumns, TColumnId> extends {
    readonly valueGetter: (...parameters: never[]) => infer TValue;
  }
    ? TValue
    : ColumnForId<TColumns, TColumnId> extends { readonly field: infer TField }
      ? TField extends keyof TRow
        ? TRow[TField]
        : never
      : never;

type EnabledFieldColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
  TCapability extends "enableFilter" | "enableSorting",
> = TColumns[number] extends infer TColumn
  ? TColumn extends { readonly columnId: infer TColumnId extends BrunoTableColumnId }
    ? TColumn extends { readonly field: string }
      ? TColumn extends { readonly [TKey in TCapability]: false }
        ? never
        : TColumnId
      : never
    : never
  : never;

export type BrunoTableFilterableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = EnabledFieldColumnId<TColumns, "enableFilter">;

export type BrunoTableSortableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = EnabledFieldColumnId<TColumns, "enableSorting">;

type ExactEditableFieldColumn<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = TColumns[number] extends infer TColumn
  ? TColumn extends {
      readonly field: string;
      readonly isEditable: infer TEditable;
    }
    ? TEditable extends false | undefined
      ? never
      : TColumn
    : never
  : never;

type PotentiallyEditableFieldColumn<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> =
  BrunoTableColumnId extends BrunoTableColumnIdOf<TColumns>
    ? Extract<TColumns[number], { readonly field: string }>
    : ExactEditableFieldColumn<TColumns>;

export type BrunoTableEditableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> =
  PotentiallyEditableFieldColumn<TColumns> extends infer TColumn
    ? TColumn extends { readonly columnId: infer TColumnId extends BrunoTableColumnId }
      ? TColumnId
      : never
    : never;

type ScalarFilterValue<TValue> = Exclude<TValue, null | undefined>;

type FilterFamilyForValueType<TValueType> = TValueType extends "text"
  ? "text"
  : TValueType extends "number" | "bigint"
    ? "numeric"
    : TValueType extends "boolean"
      ? "boolean"
      : TValueType extends { readonly filterFamily: infer TFamily extends BrunoTableFilterFamily }
        ? TFamily
        : never;

type ColumnFilterFamily<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
  TColumnId extends BrunoTableColumnIdOf<TColumns>,
> =
  ColumnForId<TColumns, TColumnId> extends { readonly valueType: infer TValueType }
    ? FilterFamilyForValueType<TValueType>
    : never;

type TextSensitivity<TFilterFamily> = TFilterFamily extends "text"
  ? {
      readonly caseSensitive?: boolean;
      readonly accentSensitive?: boolean;
    }
  : {
      readonly caseSensitive?: never;
      readonly accentSensitive?: never;
    };

type EqualityFilter<TColumnId extends BrunoTableColumnId, TValue, TFilterFamily> =
  | ({
      readonly columnId: TColumnId;
      readonly type: "equals" | "notEqual";
      readonly filter: ScalarFilterValue<TValue>;
    } & TextSensitivity<TFilterFamily>)
  | ({
      readonly columnId: TColumnId;
      readonly type: "in";
      readonly filter: readonly ScalarFilterValue<TValue>[];
    } & TextSensitivity<TFilterFamily>);

type TextFilter<TColumnId extends BrunoTableColumnId, TFilterFamily> = TFilterFamily extends "text"
  ? {
      readonly columnId: TColumnId;
      readonly type: "contains" | "notContains" | "startsWith" | "endsWith";
      readonly filter: string;
      readonly caseSensitive?: boolean;
      readonly accentSensitive?: boolean;
    }
  : never;

type NumericFilter<
  TColumnId extends BrunoTableColumnId,
  TValue,
  TFilterFamily,
> = TFilterFamily extends "numeric"
  ?
      | {
          readonly columnId: TColumnId;
          readonly type: "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual";
          readonly filter: ScalarFilterValue<TValue>;
        }
      | {
          readonly columnId: TColumnId;
          /** Matches the half-open interval `filter <= value < filterTo`. */
          readonly type: "inRange";
          readonly filter: ScalarFilterValue<TValue>;
          readonly filterTo: ScalarFilterValue<TValue>;
        }
  : never;

type BlankFilter<TColumnId extends BrunoTableColumnId> = {
  readonly columnId: TColumnId;
  readonly type: "blank" | "notBlank";
};

type FilterLeaf<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TColumnId extends BrunoTableFilterableColumnId<TColumns>,
> =
  | EqualityFilter<
      TColumnId,
      BrunoTableColumnValue<TRow, TColumns, TColumnId>,
      ColumnFilterFamily<TColumns, TColumnId>
    >
  | TextFilter<TColumnId, ColumnFilterFamily<TColumns, TColumnId>>
  | NumericFilter<
      TColumnId,
      BrunoTableColumnValue<TRow, TColumns, TColumnId>,
      ColumnFilterFamily<TColumns, TColumnId>
    >
  | BlankFilter<TColumnId>;

type FilterExpressionForColumn<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TColumnId extends BrunoTableFilterableColumnId<TColumns>,
> =
  | FilterLeaf<TRow, TColumns, TColumnId>
  | {
      readonly type: "AND" | "OR";
      readonly conditions: readonly FilterExpressionForColumn<TRow, TColumns, TColumnId>[];
    }
  | {
      readonly type: "NOT";
      readonly condition: FilterExpressionForColumn<TRow, TColumns, TColumnId>;
    };

export type BrunoTableFilterExpression<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly [TColumnId in BrunoTableFilterableColumnId<TColumns>]: FilterExpressionForColumn<
    TRow,
    TColumns,
    TColumnId
  >;
}[BrunoTableFilterableColumnId<TColumns>];

export type BrunoTableFilterExpressions<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
> = readonly BrunoTableFilterExpression<TRow, TColumns>[];

export type BrunoTableSortBy<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = readonly [
  {
    readonly [TColumnId in BrunoTableSortableColumnId<TColumns>]: {
      readonly columnId: TColumnId;
      readonly direction: "asc" | "desc";
    };
  }[BrunoTableSortableColumnId<TColumns>],
  ...{
    readonly [TColumnId in BrunoTableSortableColumnId<TColumns>]: {
      readonly columnId: TColumnId;
      readonly direction: "asc" | "desc";
    };
  }[BrunoTableSortableColumnId<TColumns>][],
];

type SaveCellChangeForColumn<TRow, TColumn> = TColumn extends {
  readonly columnId: infer TColumnId extends BrunoTableColumnId;
  readonly field: infer TField extends keyof TRow & string;
}
  ? {
      readonly columnId: TColumnId;
      readonly field: TField;
      readonly before: TRow[TField];
      readonly after: TRow[TField];
    }
  : never;

export type BrunoTableSaveCellChange<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
> = SaveCellChangeForColumn<TRow, PotentiallyEditableFieldColumn<TColumns>>;

export type BrunoTableSaveCellChangeSet<TRow, TColumns extends BrunoTableColumns<TRow>> = readonly [
  BrunoTableSaveCellChange<TRow, TColumns>,
  ...BrunoTableSaveCellChange<TRow, TColumns>[],
];

export type BrunoTableSaveRowChange<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> = {
  readonly rowId: BrunoTableRowId;
  readonly baseRow: TRow;
  readonly expectedVersion: TRowVersion;
  readonly changes: BrunoTableSaveCellChangeSet<TRow, TColumns>;
};

export type BrunoTableSaveChangeSet<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> = readonly [
  BrunoTableSaveRowChange<TRow, TColumns, TRowVersion>,
  ...BrunoTableSaveRowChange<TRow, TColumns, TRowVersion>[],
];

export type BrunoTableSaveEditsHandler<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> = (changes: BrunoTableSaveChangeSet<TRow, TColumns, TRowVersion>) => PromiseLike<void>;

export type BrunoTableReadOnlyCapability = {
  readonly editable?: false;
  readonly getRowVersion?: never;
  readonly onSaveEdits?: never;
};

export type BrunoTableNoGroupingCapability = {
  readonly groupRowsColumn?: never;
};

export type BrunoTableEditableCapability<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> =
  BrunoTableEditableColumnId<TColumns> extends never
    ? never
    : {
        readonly editable: true;
        readonly getRowVersion: (row: TRow) => TRowVersion;
        readonly onSaveEdits: BrunoTableSaveEditsHandler<TRow, TColumns, TRowVersion>;
      } & BrunoTableNoGroupingCapability;

export type BrunoTableEditingCapability<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> = BrunoTableReadOnlyCapability | BrunoTableEditableCapability<TRow, TColumns, TRowVersion>;

type InitialOrderByCapability<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = [BrunoTableSortableColumnId<TColumns>] extends [never]
  ? { readonly initialOrderBy?: never }
  : { readonly initialOrderBy: BrunoTableSortBy<TColumns> };

export type BrunoTableCommonProps<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly tableId: string;
  readonly columns: TColumns;
  readonly initialFilters?: BrunoTableFilterExpressions<TRow, TColumns>;
  /** Optional page-specific content rendered in BrunoTable's toolbar region. */
  readonly children?: ReactNode;
} & InitialOrderByCapability<TColumns>;

export type BrunoTableClientProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion = never,
> = Omit<BrunoTableCommonProps<TRow, TColumns>, "initialOrderBy"> &
  BrunoTableEditingCapability<TRow, TColumns, TRowVersion> & {
    readonly initialOrderBy: BrunoTableSortBy<TColumns>;
    readonly getRowId: (row: TRow) => BrunoTableRowId;
    readonly clientSource: BrunoTableClientSource<TRow>;
    readonly viewportSource?: never;
  };

export type BrunoTableServerProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TViewport = unknown,
> = BrunoTableCommonProps<TRow, TColumns> & {
  /** Server row identity is supplied authoritatively by the Viewport Source. */
  readonly getRowId?: never;
  readonly viewportSource: BrunoTableServerSource<TViewport>;
  readonly clientSource?: never;
  readonly editable?: never;
  readonly getRowVersion?: never;
  readonly onSaveEdits?: never;
};
