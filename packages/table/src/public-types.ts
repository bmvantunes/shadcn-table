import type { ReactNode } from "react";

export type BrunoTableColumnId = `COL_ID_${Uppercase<string>}`;

export type BrunoTableRowId = string;

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

type ValueParams<TRow, TValue> = {
  readonly row: TRow;
  readonly value: TValue;
};

type ValueGetterParams<TRow> = {
  readonly row: TRow;
};

type FieldColumn<TRow, TField extends FieldKey<TRow>> = {
  readonly columnId: BrunoTableColumnId;
  readonly field: TField;
  readonly headerName: string;
  readonly isEditable?: boolean | ((params: ValueParams<TRow, TRow[TField]>) => boolean);
  readonly valueFormatter?: (params: ValueParams<TRow, TRow[TField]>) => string;
  readonly valueGetter?: never;
};

type FieldColumns<TRow> = {
  readonly [TField in FieldKey<TRow>]: FieldColumn<TRow, TField>;
}[FieldKey<TRow>];

type ComputedColumn<TRow> = {
  readonly columnId: BrunoTableColumnId;
  readonly headerName: string;
  readonly valueGetter: (params: ValueGetterParams<TRow>) => unknown;
  readonly field?: never;
  readonly isEditable?: false;
  readonly valueFormatter?: never;
};

type Column<TRow> = FieldColumns<TRow> | ComputedColumn<TRow>;

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

export type BrunoTableEditableColumnId<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = TColumns[number] extends infer TColumn
  ? TColumn extends {
      readonly columnId: infer TColumnId extends BrunoTableColumnId;
      readonly isEditable: infer TEditable;
    }
    ? TEditable extends false
      ? never
      : TColumnId
    : never
  : never;

type ScalarFilterValue<TValue> = Exclude<TValue, undefined>;
type StringFilterValue<TValue> = Extract<TValue, string>;
type NumericFilterValue<TValue> = Extract<TValue, number | bigint>;

type EqualityFilter<TColumnId extends BrunoTableColumnId, TValue> =
  | {
      readonly columnId: TColumnId;
      readonly type: "equals" | "notEqual";
      readonly filter: ScalarFilterValue<TValue>;
      readonly caseSensitive?: boolean;
      readonly accentSensitive?: boolean;
    }
  | {
      readonly columnId: TColumnId;
      readonly type: "in";
      readonly filter: readonly ScalarFilterValue<TValue>[];
      readonly caseSensitive?: boolean;
      readonly accentSensitive?: boolean;
    };

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

type FilterLeaf<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly [TColumnId in BrunoTableFilterableColumnId<TColumns>]:
    | EqualityFilter<TColumnId, BrunoTableColumnValue<TRow, TColumns, TColumnId>>
    | TextFilter<TColumnId, BrunoTableColumnValue<TRow, TColumns, TColumnId>>
    | NumericFilter<TColumnId, BrunoTableColumnValue<TRow, TColumns, TColumnId>>
    | BlankFilter<TColumnId>;
}[BrunoTableFilterableColumnId<TColumns>];

export type BrunoTableFilterExpression<TRow, TColumns extends BrunoTableColumns<TRow>> =
  | FilterLeaf<TRow, TColumns>
  | {
      readonly type: "AND" | "OR";
      readonly conditions: readonly BrunoTableFilterExpression<TRow, TColumns>[];
    }
  | {
      readonly type: "NOT";
      readonly condition: BrunoTableFilterExpression<TRow, TColumns>;
    };

export type BrunoTableFilterExpressions<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
> = readonly BrunoTableFilterExpression<TRow, TColumns>[];

export type BrunoTableSortBy<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = readonly {
  readonly [TColumnId in BrunoTableSortableColumnId<TColumns>]: {
    readonly columnId: TColumnId;
    readonly direction: "asc" | "desc";
  };
}[BrunoTableSortableColumnId<TColumns>][];

export type BrunoTableCellChange<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly [TColumnId in BrunoTableEditableColumnId<TColumns>]: {
    readonly rowId: BrunoTableRowId;
    readonly columnId: TColumnId;
    readonly before: BrunoTableColumnValue<TRow, TColumns, TColumnId>;
    readonly after: BrunoTableColumnValue<TRow, TColumns, TColumnId>;
  };
}[BrunoTableEditableColumnId<TColumns>];

export type BrunoTableCommonProps<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly tableId: string;
  readonly columns: TColumns;
  /** Optional page-specific content rendered in BrunoTable's toolbar region. */
  readonly children?: ReactNode;
};

export type BrunoTableClientProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
> = BrunoTableCommonProps<TRow, TColumns> & {
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
};
