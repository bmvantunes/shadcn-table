import type { ReactNode } from "react";

export type BrunoTableColumnId = `COL_ID_${Uppercase<string>}`;

export type BrunoTableRowId = string;

export type BrunoTableBuiltInValueType = "text" | "number" | "bigint" | "boolean";

export type BrunoTableSourceStatus = "loading" | "ready" | "stale" | "closed" | "error";

export type BrunoTableSourceChrome = {
  readonly totalRows: number;
  readonly version: number;
  readonly status: BrunoTableSourceStatus;
  readonly statusCode?: string | undefined;
  readonly message?: string | undefined;
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

type ValueGetterParams<TRow, TFields extends NonEmptyFields<TRow>> = {
  readonly row: Pick<TRow, TFields[number]>;
};

type FieldColumn<
  TRow,
  TField extends FieldKey<TRow>,
  TValueType extends BrunoTableBuiltInValueType,
> = {
  readonly columnId: BrunoTableColumnId;
  readonly field: TField;
  readonly headerName: string;
  readonly valueType: TValueType;
  readonly isEditable?: boolean | ((params: ValueParams<TRow, TRow[TField]>) => boolean);
  readonly valueFormatter?: (params: ValueParams<TRow, TRow[TField]>) => string;
  readonly fields?: never;
  readonly valueGetter?: never;
};

type FieldColumns<TRow> = {
  readonly [TField in FieldKey<TRow>]:
    | ([NonNullish<TRow[TField]>] extends [never]
        ? never
        : NonNullish<TRow[TField]> extends string
          ? FieldColumn<TRow, TField, "text">
          : never)
    | (NonNullish<TRow[TField]> extends number ? FieldColumn<TRow, TField, "number"> : never)
    | (NonNullish<TRow[TField]> extends bigint ? FieldColumn<TRow, TField, "bigint"> : never)
    | (NonNullish<TRow[TField]> extends boolean ? FieldColumn<TRow, TField, "boolean"> : never);
}[FieldKey<TRow>];

const computedColumnMarker: unique symbol = Symbol("BrunoTableComputedColumn");

type ComputedColumn<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType,
> = {
  readonly [computedColumnMarker]: true;
  readonly columnId: BrunoTableColumnId;
  readonly headerName: string;
  readonly fields: TFields;
  readonly valueGetter: (params: ValueGetterParams<TRow, TFields>) => TValue;
  readonly valueType: TValueType;
  readonly field?: never;
  readonly isEditable?: never;
  readonly valueFormatter?: (params: ValueParams<TRow, TValue>) => string;
};

type AnyComputedColumn<TRow> = {
  readonly [TValueType in BrunoTableBuiltInValueType]: ComputedColumn<
    TRow,
    NonEmptyFields<TRow>,
    ValueForBuiltInType<TValueType>,
    TValueType
  >;
}[BrunoTableBuiltInValueType];

type ComputedColumnDependencies<TRow, TFields extends NonEmptyFields<TRow>, TValue> = {
  readonly fields: TFields;
  readonly valueGetter: (params: ValueGetterParams<TRow, TFields>) => TValue;
};

type ComputedColumnOptions<
  TRow,
  TFields extends NonEmptyFields<TRow>,
  TValue,
  TValueType extends BrunoTableBuiltInValueType,
> = Omit<
  ComputedColumn<TRow, TFields, TValue, TValueType>,
  typeof computedColumnMarker | "fields" | "valueGetter"
>;

/**
 * Captures a Computed Column's exact dependency tuple before contextually typing its getter.
 * Built-in Value Type helpers will delegate to this strict construction boundary.
 */
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, string, "text">,
>(
  options: TOptions & ComputedColumnDependencies<TRow, TFields, string>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, string> &
  ComputedColumn<TRow, TFields, string, "text">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, number, "number">,
>(
  options: TOptions & ComputedColumnDependencies<TRow, TFields, number>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, number> &
  ComputedColumn<TRow, TFields, number, "number">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, bigint, "bigint">,
>(
  options: TOptions & ComputedColumnDependencies<TRow, TFields, bigint>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, bigint> &
  ComputedColumn<TRow, TFields, bigint, "bigint">;
export function BrunoTableComputedColumn<
  TRow,
  const TFields extends NonEmptyFields<TRow>,
  const TOptions extends ComputedColumnOptions<TRow, TFields, boolean, "boolean">,
>(
  options: TOptions & ComputedColumnDependencies<TRow, TFields, boolean>,
): TOptions &
  ComputedColumnDependencies<TRow, TFields, boolean> &
  ComputedColumn<TRow, TFields, boolean, "boolean">;
export function BrunoTableComputedColumn(options: Readonly<Record<string, unknown>>) {
  return { ...options, [computedColumnMarker]: true };
}

type Column<TRow> = FieldColumns<TRow> | AnyComputedColumn<TRow>;

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

type FieldColumnId<TColumns extends readonly { readonly columnId: BrunoTableColumnId }[]> =
  TColumns[number] extends infer TColumn
    ? TColumn extends { readonly columnId: infer TColumnId extends BrunoTableColumnId }
      ? TColumn extends { readonly field: string }
        ? TColumnId
        : never
      : never
    : never;

export type BrunoTableFilterableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = FieldColumnId<TColumns>;

export type BrunoTableSortableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = FieldColumnId<TColumns>;

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

type ScalarFilterValue<TValue> = Exclude<TValue, undefined>;
type StringFilterValue<TValue> = Extract<TValue, string>;
type NumericFilterValue<TValue> = Extract<TValue, number | bigint>;

type TextSensitivity<TValue> = [StringFilterValue<TValue>] extends [never]
  ? {
      readonly caseSensitive?: never;
      readonly accentSensitive?: never;
    }
  : {
      readonly caseSensitive?: boolean;
      readonly accentSensitive?: boolean;
    };

type EqualityFilter<TColumnId extends BrunoTableColumnId, TValue> =
  | ({
      readonly columnId: TColumnId;
      readonly type: "equals" | "notEqual";
      readonly filter: ScalarFilterValue<TValue>;
    } & TextSensitivity<TValue>)
  | ({
      readonly columnId: TColumnId;
      readonly type: "in";
      readonly filter: readonly ScalarFilterValue<TValue>[];
    } & TextSensitivity<TValue>);

type TextFilter<TColumnId extends BrunoTableColumnId, TValue> = [
  StringFilterValue<TValue>,
] extends [never]
  ? never
  : {
      readonly columnId: TColumnId;
      readonly type: "contains" | "notContains" | "startsWith" | "endsWith";
      readonly filter: string;
      readonly caseSensitive?: boolean;
      readonly accentSensitive?: boolean;
    };

type NumericFilter<TColumnId extends BrunoTableColumnId, TValue> = [
  NumericFilterValue<TValue>,
] extends [never]
  ? never
  :
      | {
          readonly columnId: TColumnId;
          readonly type: "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual";
          readonly filter: NumericFilterValue<TValue>;
        }
      | {
          readonly columnId: TColumnId;
          readonly type: "inRange";
          readonly filter: NumericFilterValue<TValue>;
          readonly filterTo: NumericFilterValue<TValue>;
        };

type BlankFilter<TColumnId extends BrunoTableColumnId> = {
  readonly columnId: TColumnId;
  readonly type: "blank" | "notBlank";
};

type FilterLeaf<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TColumnId extends BrunoTableFilterableColumnId<TColumns>,
> =
  | EqualityFilter<TColumnId, BrunoTableColumnValue<TRow, TColumns, TColumnId>>
  | TextFilter<TColumnId, BrunoTableColumnValue<TRow, TColumns, TColumnId>>
  | NumericFilter<TColumnId, BrunoTableColumnValue<TRow, TColumns, TColumnId>>
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

export type BrunoTableCommonProps<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly tableId: string;
  readonly columns: TColumns;
  readonly initialOrderBy: BrunoTableSortBy<TColumns>;
  /** Optional page-specific content rendered in BrunoTable's toolbar region. */
  readonly children?: ReactNode;
};

export type BrunoTableClientProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion = never,
> = BrunoTableCommonProps<TRow, TColumns> &
  BrunoTableEditingCapability<TRow, TColumns, TRowVersion> & {
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
