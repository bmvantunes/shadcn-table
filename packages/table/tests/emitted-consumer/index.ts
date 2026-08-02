import type {
  BrunoTableColumnValue,
  BrunoTableColumns,
  BrunoTableFilterableColumnId,
  BrunoTableFilterExpressions,
  BrunoTableServerProps,
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
  { columnId: "COL_ID_SYMBOL", field: "symbol" },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    valueFormatter: ({ value }) => value.toFixed(2),
  },
  {
    columnId: "COL_ID_NOTIONAL",
    valueGetter: ({ row }) => row.price * Number(row.quantity),
  },
] satisfies BrunoTableColumns<Order>;

type Columns = typeof columns;
type Price = Expect<Equal<BrunoTableColumnValue<Order, Columns, "COL_ID_PRICE">, number>>;
type Notional = Expect<Equal<BrunoTableColumnValue<Order, Columns, "COL_ID_NOTIONAL">, number>>;
type Filterable = Expect<
  Equal<BrunoTableFilterableColumnId<Columns>, "COL_ID_SYMBOL" | "COL_ID_PRICE">
>;

const filters = [
  { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const source = {
  viewport: { replace: () => undefined },
  totalRows: 0,
  version: 0,
  status: "loading",
} as const;

const props = {
  tableId: "orders",
  getRowId: (row: Order) => row.id,
  columns,
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const invalidColumn = [
  {
    // @ts-expect-error emitted declarations preserve the uppercase identity contract.
    columnId: "COL_ID_price",
    field: "price",
  },
] satisfies BrunoTableColumns<Order>;

const invalidFilter = [
  // @ts-expect-error emitted declarations keep computed columns out of automatic filtering.
  { columnId: "COL_ID_NOTIONAL", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

void (0 as unknown as Price);
void (0 as unknown as Notional);
void (0 as unknown as Filterable);
void filters;
void props;
void invalidColumn;
void invalidFilter;
