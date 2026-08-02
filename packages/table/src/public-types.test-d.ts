import { describe, expectTypeOf, it } from "vitest";

import type {
  BrunoTableCellChange,
  BrunoTableClientProps,
  BrunoTableColumnIdOf,
  BrunoTableColumns,
  BrunoTableColumnValue,
  BrunoTableEditableColumnId,
  BrunoTableFilterableColumnId,
  BrunoTableFilterExpressions,
  BrunoTableServerProps,
  BrunoTableSortableColumnId,
  BrunoTableSortBy,
} from "./index";

type Order = {
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly status: "open" | "closed";
};

const columns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    isEditable: ({ row, value }) => row.status === "open" && value > 0,
    valueFormatter: ({ value }) => value.toFixed(2),
  },
  {
    columnId: "COL_ID_DOUBLE_QUANTITY",
    valueGetter: ({ row }) => row.quantity * 2n,
  },
] satisfies BrunoTableColumns<Order>;

type Columns = typeof columns;

describe("BrunoTable public types", () => {
  it("preserves exact identities and values", () => {
    expectTypeOf<BrunoTableColumnIdOf<Columns>>().toEqualTypeOf<
      "COL_ID_SYMBOL" | "COL_ID_PRICE" | "COL_ID_DOUBLE_QUANTITY"
    >();
    expectTypeOf<BrunoTableColumnValue<Order, Columns, "COL_ID_SYMBOL">>().toEqualTypeOf<string>();
    expectTypeOf<BrunoTableColumnValue<Order, Columns, "COL_ID_PRICE">>().toEqualTypeOf<number>();
    expectTypeOf<
      BrunoTableColumnValue<Order, Columns, "COL_ID_DOUBLE_QUANTITY">
    >().toEqualTypeOf<bigint>();
  });

  it("derives capabilities instead of guessing computed server semantics", () => {
    expectTypeOf<BrunoTableFilterableColumnId<Columns>>().toEqualTypeOf<
      "COL_ID_SYMBOL" | "COL_ID_PRICE"
    >();
    expectTypeOf<BrunoTableSortableColumnId<Columns>>().toEqualTypeOf<
      "COL_ID_SYMBOL" | "COL_ID_PRICE"
    >();
    expectTypeOf<BrunoTableEditableColumnId<Columns>>().toEqualTypeOf<"COL_ID_PRICE">();
  });

  it("correlates edits with editable column values", () => {
    expectTypeOf<BrunoTableCellChange<Order, Columns>>().toEqualTypeOf<{
      readonly rowId: string;
      readonly columnId: "COL_ID_PRICE";
      readonly before: number;
      readonly after: number;
    }>();
  });

  it("types recursive filters and ordered sorts", () => {
    const filters = [
      { columnId: "COL_ID_PRICE", type: "greaterThanOrEqual", filter: 100 },
      {
        type: "OR",
        conditions: [
          { columnId: "COL_ID_SYMBOL", type: "startsWith", filter: "A" },
          { type: "NOT", condition: { columnId: "COL_ID_SYMBOL", type: "blank" } },
        ],
      },
    ] satisfies BrunoTableFilterExpressions<Order, Columns>;

    const sorting = [
      { columnId: "COL_ID_PRICE", direction: "desc" },
      { columnId: "COL_ID_SYMBOL", direction: "asc" },
    ] satisfies BrunoTableSortBy<Columns>;

    expectTypeOf(filters).toBeArray();
    expectTypeOf(sorting).toBeArray();
  });

  it("accepts direct client and opaque server viewport source envelopes", () => {
    const common = {
      tableId: "orders",
      getRowId: (row: Order) => row.id,
      columns,
    } as const;

    const clientProps = {
      ...common,
      children: "Page-specific toolbar content",
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    } satisfies BrunoTableClientProps<Order, Columns>;

    const viewport = {
      replace: () => ({ setWindow: () => undefined, release: () => undefined }),
      destroy: () => undefined,
    };
    const serverProps = {
      ...common,
      viewportSource: {
        viewport,
        totalRows: 0,
        version: 1,
        status: "loading",
      },
    } satisfies BrunoTableServerProps<Order, Columns, typeof viewport>;

    expectTypeOf(clientProps.clientSource.rows).toEqualTypeOf<readonly Order[]>();
    expectTypeOf(clientProps.children).toEqualTypeOf<string>();
    expectTypeOf(serverProps.viewportSource.viewport).toEqualTypeOf<typeof viewport>();
  });
});

const invalidColumnIds = [
  {
    // @ts-expect-error column identities are namespaced and uppercase.
    columnId: "price",
    field: "price",
  },
  {
    // @ts-expect-error lowercase suffixes are rejected.
    columnId: "COL_ID_price",
    field: "price",
  },
] satisfies BrunoTableColumns<Order>;

const invalidField = [
  {
    columnId: "COL_ID_PRICES",
    // @ts-expect-error field must be a real row key.
    field: "prices",
  },
] satisfies BrunoTableColumns<Order>;

const ambiguousColumn = [
  // @ts-expect-error field and valueGetter are mutually exclusive.
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    valueGetter: ({ row }: { readonly row: Order }) => row.price,
  },
] satisfies BrunoTableColumns<Order>;

const invalidNumericFilter = [
  // @ts-expect-error contains is not a numeric operator.
  { columnId: "COL_ID_PRICE", type: "contains", filter: "10" },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidComputedFilter = [
  // @ts-expect-error computed columns have no automatic filter mapping.
  { columnId: "COL_ID_DOUBLE_QUANTITY", type: "greaterThan", filter: 10n },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidSort = [
  // @ts-expect-error computed columns have no automatic sort mapping.
  { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
] satisfies BrunoTableSortBy<Columns>;

const invalidPaginatedClient = {
  tableId: "orders",
  getRowId: (row: Order) => row.id,
  columns,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
  // @ts-expect-error Client Tables expose one continuous row space, not page size.
  pageSize: 100,
} satisfies BrunoTableClientProps<Order, Columns>;

const invalidPaginatedServer = {
  tableId: "orders",
  getRowId: (row: Order) => row.id,
  columns,
  viewportSource: {
    viewport: {},
    totalRows: 0,
    version: 1,
    status: "ready",
  },
  // @ts-expect-error Server Tables expose one continuous row space, not page index.
  pageIndex: 0,
} satisfies BrunoTableServerProps<Order, Columns>;

void invalidColumnIds;
void invalidField;
void ambiguousColumn;
void invalidNumericFilter;
void invalidComputedFilter;
void invalidSort;
void invalidPaginatedClient;
void invalidPaginatedServer;
