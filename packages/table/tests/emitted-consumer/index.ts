import {
  BrunoTableComputedColumn,
  type BrunoTableBuiltInValueType,
  type BrunoTableColumnValue,
  type BrunoTableColumns,
  type BrunoTableFilterableColumnId,
  type BrunoTableFilterExpressions,
  type BrunoTableServerProps,
  type BrunoTableSortBy,
} from "@bruno/table";

type Equal<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2
    ? true
    : false;

type Expect<TValue extends true> = TValue;

type Order = {
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
};

const columns = [
  { columnId: "COL_ID_SYMBOL", field: "symbol", headerName: "Symbol", valueType: "text" },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    valueFormatter: ({ value }) => value.toFixed(2),
  },
  BrunoTableComputedColumn({
    columnId: "COL_ID_DOUBLE_QUANTITY",
    fields: ["quantity"],
    headerName: "Double quantity",
    valueType: "bigint",
    valueGetter: ({ row }) => row.quantity * 2n,
  }),
] satisfies BrunoTableColumns<Order>;

type Columns = typeof columns;
type Price = Expect<Equal<BrunoTableColumnValue<Order, Columns, "COL_ID_PRICE">, number>>;
type DoubleQuantity = Expect<
  Equal<BrunoTableColumnValue<Order, Columns, "COL_ID_DOUBLE_QUANTITY">, bigint>
>;
type Filterable = Expect<
  Equal<BrunoTableFilterableColumnId<Columns>, "COL_ID_SYMBOL" | "COL_ID_PRICE">
>;

const filters = [
  { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 },
  {
    columnId: "COL_ID_SYMBOL",
    type: "equals",
    filter: "AAPL",
    caseSensitive: true,
  },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const source = {
  viewport: { replace: () => undefined },
  totalRows: 0,
  version: 0,
  status: "loading",
} as const;

const props = {
  tableId: "orders",
  columns,
  initialOrderBy: [
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ] satisfies BrunoTableSortBy<Columns>,
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const invalidProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  // @ts-expect-error emitted Server props preserve source-owned row identity.
  getRowId: (row: Order) => row.id,
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const invalidColumn = [
  {
    // @ts-expect-error emitted declarations preserve the uppercase identity contract.
    columnId: "COL_ID_price",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;

const missingHeaderName = [
  // @ts-expect-error emitted declarations require an explicit header name.
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    valueType: "text",
  },
] satisfies BrunoTableColumns<Order>;

const invalidFilter = [
  // @ts-expect-error emitted declarations keep computed columns out of automatic filtering.
  { columnId: "COL_ID_DOUBLE_QUANTITY", type: "greaterThan", filter: 10n },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidNumericSensitivity = [
  {
    columnId: "COL_ID_PRICE",
    type: "equals",
    filter: 10,
    // @ts-expect-error emitted numeric filters reject text-only sensitivity flags.
    caseSensitive: true,
  },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

type FeatureFlag = { readonly enabled: boolean };

const featureFlagColumns = [
  {
    columnId: "COL_ID_ENABLED",
    field: "enabled",
    headerName: "Enabled",
    valueType: "boolean",
  },
] satisfies BrunoTableColumns<FeatureFlag>;

const invalidBooleanSensitivity = [
  {
    columnId: "COL_ID_ENABLED",
    type: "equals",
    filter: true,
    // @ts-expect-error emitted boolean filters reject text-only sensitivity flags.
    accentSensitive: true,
  },
] satisfies BrunoTableFilterExpressions<FeatureFlag, typeof featureFlagColumns>;

const invalidMixedColumnCompoundFilter = [
  {
    type: "OR",
    // @ts-expect-error emitted declarations reject mixed-identity compound filters.
    conditions: [
      { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 },
      { columnId: "COL_ID_SYMBOL", type: "startsWith", filter: "A" },
    ],
  },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

// @ts-expect-error emitted declarations preserve the non-empty sorting invariant.
const invalidEmptySort = [] satisfies BrunoTableSortBy<Columns>;

const invalidComputedDependency = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_DOUBLE_QUANTITY",
    fields: ["quantity"],
    headerName: "Double quantity",
    valueType: "bigint",
    valueGetter: ({ row }) => {
      // @ts-expect-error emitted declarations restrict getters to declared dependencies.
      void row.price;
      return row.quantity * 2n;
    },
  }),
] satisfies BrunoTableColumns<Order>;

const builtInValueType: BrunoTableBuiltInValueType = "bigint";

void (0 as unknown as Price);
void (0 as unknown as DoubleQuantity);
void (0 as unknown as Filterable);
void filters;
void props;
void invalidProps;
void invalidColumn;
void missingHeaderName;
void invalidFilter;
void invalidNumericSensitivity;
void invalidBooleanSensitivity;
void invalidMixedColumnCompoundFilter;
void invalidEmptySort;
void invalidComputedDependency;
void builtInValueType;
