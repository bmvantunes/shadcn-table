import { describe, expectTypeOf, it } from "vitest";

import {
  BrunoTableBigIntColumn,
  BrunoTableBooleanColumn,
  BrunoTableComputedColumn,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableTextColumn,
} from "./index";

import type {
  BrunoTableClientProps,
  BrunoTableColumnField,
  BrunoTableColumnId,
  BrunoTableColumnIdOf,
  BrunoTableColumns,
  BrunoTableColumnValue,
  BrunoTableEditableColumnId,
  BrunoTableFilterableColumnId,
  BrunoTableFilterExpressions,
  BrunoTableSaveCellChange,
  BrunoTableSaveChangeSet,
  BrunoTableServerProps,
  BrunoTableSortableColumnId,
  BrunoTableSortBy,
  BrunoTableValueType,
} from "./index";

type Order = {
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly status: "open" | "closed";
  readonly revision: bigint;
};

const columns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    isEditable: true,
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    isEditable: ({ row, value }) => row.status === "open" && value > 0,
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

const capabilityColumns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    enableSorting: false,
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    enableFilter: false,
  },
] satisfies BrunoTableColumns<Order>;

type CapabilityColumns = typeof capabilityColumns;

const noSortingColumns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    enableSorting: false,
  },
] satisfies BrunoTableColumns<Order>;

type NoSortingColumns = typeof noSortingColumns;

const validColumnId: BrunoTableColumnId = "COL_ID_PRICE";
void validColumnId;

const validUnicodeColumnId: BrunoTableColumnId = "COL_ID_AÉTAT";
void validUnicodeColumnId;

// @ts-expect-error A stable column identity must have a non-empty suffix.
const emptyColumnId: BrunoTableColumnId = "COL_ID_";
void emptyColumnId;

// @ts-expect-error The suffix must begin with an ASCII uppercase letter, digit, or underscore.
const invalidUnicodeStartColumnId: BrunoTableColumnId = "COL_ID_ÉTAT";
void invalidUnicodeStartColumnId;

// @ts-expect-error Every character after the prefix must already be uppercase.
const invalidMixedCaseColumnId: BrunoTableColumnId = "COL_ID_Price";
void invalidMixedCaseColumnId;

describe("BrunoTable public types", () => {
  it("preserves exact identities and values", () => {
    expectTypeOf<"COL_ID_Price" extends BrunoTableColumnId ? true : false>().toEqualTypeOf<false>();
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
    expectTypeOf<BrunoTableEditableColumnId<Columns>>().toEqualTypeOf<
      "COL_ID_SYMBOL" | "COL_ID_PRICE"
    >();
    expectTypeOf<
      BrunoTableFilterableColumnId<CapabilityColumns>
    >().toEqualTypeOf<"COL_ID_SYMBOL">();
    expectTypeOf<BrunoTableSortableColumnId<CapabilityColumns>>().toEqualTypeOf<"COL_ID_PRICE">();
    expectTypeOf<BrunoTableSortableColumnId<NoSortingColumns>>().toBeNever();
  });

  it("omits sorting props when no column exposes sorting capability", () => {
    const props = {
      tableId: "unsortable-orders",
      columns: noSortingColumns,
      getRowId: (row: Order) => row.id,
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    } satisfies BrunoTableClientProps<Order, NoSortingColumns>;

    expectTypeOf(props.columns).toEqualTypeOf<NoSortingColumns>();
  });

  it("keeps widened runtime columns conservatively editable", () => {
    const widenedColumns: BrunoTableColumns<Order> = columns;

    expectTypeOf<
      BrunoTableEditableColumnId<typeof widenedColumns>
    >().toEqualTypeOf<BrunoTableColumnId>();

    const widenedEditableProps = {
      tableId: "orders",
      columns: widenedColumns,
      initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      getRowId: (row: Order) => row.id,
      editable: true,
      getRowVersion: (row: Order) => row.revision,
      onSaveEdits: (changes) => {
        expectTypeOf(changes[0].changes[0]).not.toBeNever();
        return Promise.resolve();
      },
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    } satisfies BrunoTableClientProps<Order, typeof widenedColumns, bigint>;

    expectTypeOf(widenedEditableProps.getRowVersion).returns.toEqualTypeOf<bigint>();
  });

  it("correlates row-grouped saves with source fields and exact row versions", () => {
    expectTypeOf<BrunoTableColumnField<Columns, "COL_ID_PRICE">>().toEqualTypeOf<"price">();
    expectTypeOf<BrunoTableSaveCellChange<Order, Columns>>().toEqualTypeOf<
      | {
          readonly columnId: "COL_ID_SYMBOL";
          readonly field: "symbol";
          readonly before: string;
          readonly after: string;
        }
      | {
          readonly columnId: "COL_ID_PRICE";
          readonly field: "price";
          readonly before: number;
          readonly after: number;
        }
    >();
    expectTypeOf<BrunoTableSaveChangeSet<Order, Columns, bigint>[number]>().toEqualTypeOf<{
      readonly rowId: string;
      readonly baseRow: Order;
      readonly expectedVersion: bigint;
      readonly changes: readonly [
        BrunoTableSaveCellChange<Order, Columns>,
        ...BrunoTableSaveCellChange<Order, Columns>[],
      ];
    }>();
  });

  it("types recursive filters and ordered sorts", () => {
    const filters = [
      { columnId: "COL_ID_PRICE", type: "greaterThanOrEqual", filter: 100 },
      {
        columnId: "COL_ID_SYMBOL",
        type: "equals",
        filter: "AAPL",
        caseSensitive: true,
      },
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
      columns,
      initialFilters: [
        { columnId: "COL_ID_SYMBOL", type: "startsWith", filter: "A" },
      ] satisfies BrunoTableFilterExpressions<Order, Columns>,
      initialOrderBy: [
        { columnId: "COL_ID_PRICE", direction: "desc" },
      ] satisfies BrunoTableSortBy<Columns>,
    } as const;

    const clientProps = {
      ...common,
      getRowId: (row: Order) => row.id,
      children: "Page-specific toolbar content",
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    } satisfies BrunoTableClientProps<Order, Columns>;

    const editableClientProps = {
      ...common,
      editable: true,
      getRowId: (row: Order) => row.id,
      getRowVersion: (row: Order) => row.revision,
      onSaveEdits: (changes) => {
        expectTypeOf(changes[0].expectedVersion).toEqualTypeOf<bigint>();
        const [change] = changes[0].changes;
        if (change.columnId === "COL_ID_PRICE") {
          expectTypeOf(change.field).toEqualTypeOf<"price">();
          expectTypeOf(change.after).toEqualTypeOf<number>();
        } else {
          expectTypeOf(change.field).toEqualTypeOf<"symbol">();
          expectTypeOf(change.after).toEqualTypeOf<string>();
        }
        return Promise.resolve();
      },
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    } satisfies BrunoTableClientProps<Order, Columns, bigint>;

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
    expectTypeOf(clientProps.initialFilters[0]!.columnId).toEqualTypeOf<"COL_ID_SYMBOL">();
    expectTypeOf(clientProps.children).toEqualTypeOf<string>();
    expectTypeOf(editableClientProps.getRowVersion).returns.toEqualTypeOf<bigint>();
    expectTypeOf(serverProps.viewportSource.viewport).toEqualTypeOf<typeof viewport>();
  });
});

type HelperRow = {
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly active: boolean;
  readonly status: "open" | "closed";
  readonly multiplier: number;
};

const priceColumn = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  width: 112,
  format: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
});

const statusColumn = BrunoTableSelectColumn.withDefaults({
  headerName: "Status",
  options: ["open", "closed"],
});

const helperColumns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  priceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    width: 144,
    format: { maximumFractionDigits: 4 },
    isEditable: ({ row, value }) => {
      expectTypeOf(row).toEqualTypeOf<HelperRow>();
      expectTypeOf(value).toEqualTypeOf<number>();
      return row.status === "open" && value >= 0;
    },
    valueFormatter: ({ row, value }) => `${row.symbol} ${value.toFixed(2)}`,
    cellClassName: ({ value }) => (value < 0 ? "text-destructive" : undefined),
    cellRenderer: ({ row, value }) => `${row.symbol}:${value}`,
  }),
  BrunoTableBigIntColumn({
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
  }),
  BrunoTableBooleanColumn({
    columnId: "COL_ID_ACTIVE",
    field: "active",
    headerName: "Active",
  }),
  statusColumn({
    columnId: "COL_ID_STATUS",
    field: "status",
  }),
  BrunoTableNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    fields: ["price", "multiplier"],
    headerName: "Weighted price",
    valueGetter: ({ row }) => {
      expectTypeOf(row).toEqualTypeOf<Pick<HelperRow, "price" | "multiplier">>();
      return row.price * row.multiplier;
    },
    valueFormatter: ({ value }) => value.toFixed(2),
  }),
] satisfies BrunoTableColumns<HelperRow>;

type HelperColumns = typeof helperColumns;
type PriceHelperColumn = Extract<HelperColumns[number], { readonly columnId: "COL_ID_PRICE" }>;
type QuantityHelperColumn = Extract<
  HelperColumns[number],
  { readonly columnId: "COL_ID_QUANTITY" }
>;
type ActiveHelperColumn = Extract<HelperColumns[number], { readonly columnId: "COL_ID_ACTIVE" }>;
type StatusHelperColumn = Extract<HelperColumns[number], { readonly columnId: "COL_ID_STATUS" }>;

describe("BrunoTable Column Helpers", () => {
  it("preserves identities, values, defaults, presets, and individual overrides", () => {
    expectTypeOf<BrunoTableColumnIdOf<HelperColumns>>().toEqualTypeOf<
      | "COL_ID_SYMBOL"
      | "COL_ID_PRICE"
      | "COL_ID_QUANTITY"
      | "COL_ID_ACTIVE"
      | "COL_ID_STATUS"
      | "COL_ID_WEIGHTED_PRICE"
    >();
    expectTypeOf<
      BrunoTableColumnValue<HelperRow, HelperColumns, "COL_ID_PRICE">
    >().toEqualTypeOf<number>();
    expectTypeOf<
      BrunoTableColumnValue<HelperRow, HelperColumns, "COL_ID_QUANTITY">
    >().toEqualTypeOf<bigint>();
    expectTypeOf<BrunoTableColumnValue<HelperRow, HelperColumns, "COL_ID_STATUS">>().toEqualTypeOf<
      "open" | "closed"
    >();
    expectTypeOf<
      BrunoTableColumnValue<HelperRow, HelperColumns, "COL_ID_WEIGHTED_PRICE">
    >().toEqualTypeOf<number>();

    expectTypeOf<PriceHelperColumn["width"]>().toEqualTypeOf<144>();
    expectTypeOf<PriceHelperColumn["cellAlign"]>().toEqualTypeOf<"end">();
    expectTypeOf<QuantityHelperColumn["cellAlign"]>().toEqualTypeOf<"end">();
    expectTypeOf<ActiveHelperColumn["cellAlign"]>().toEqualTypeOf<"center">();
    expectTypeOf<StatusHelperColumn["editorLayout"]>().toEqualTypeOf<"fullWidth">();
  });
});

type ExactAmount = { readonly minor: bigint };
type AmountRow = { readonly amount: ExactAmount };

const exactAmountValueType: BrunoTableValueType<ExactAmount, "numeric", "text"> = {
  codecId: "test/exact-amount",
  codecVersion: 1,
  filterFamily: "numeric",
  editorFamily: "text",
  cellAlign: "end",
  editorLayout: "inline",
  defaultWidth: 120,
  decodeRuntime: (input) =>
    typeof input === "object" &&
    input !== null &&
    "minor" in input &&
    typeof input.minor === "bigint"
      ? { _tag: "Success", value: { minor: input.minor } }
      : { _tag: "Failure", message: "Expected an exact amount." },
  equivalent: (left, right) => left.minor === right.minor,
  compare: (left, right) => (left.minor === right.minor ? 0 : left.minor < right.minor ? -1 : 1),
  formatCanonicalText: (value) => value.minor.toString(10),
  parseCanonicalText: (text) =>
    /^-?\d+$/u.test(text)
      ? { _tag: "Success", value: { minor: BigInt(text) } }
      : { _tag: "Failure", message: "Expected integer minor units." },
  formatDisplay: (value) => value.minor.toString(10),
  encodePersisted: (value) => ({ minor: value.minor.toString(10) }),
  decodePersisted: () => ({ _tag: "Failure", message: "Not used in this type proof." }),
};

const customValueColumns = [
  {
    columnId: "COL_ID_AMOUNT",
    field: "amount",
    headerName: "Amount",
    valueType: exactAmountValueType,
  },
] satisfies BrunoTableColumns<AmountRow>;

const customNumericFilter = [
  { columnId: "COL_ID_AMOUNT", type: "greaterThan", filter: { minor: 10n } },
] satisfies BrunoTableFilterExpressions<AmountRow, typeof customValueColumns>;

void customNumericFilter;

const invalidColumnIds = [
  {
    // @ts-expect-error column identities are namespaced and uppercase.
    columnId: "price",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
  {
    // @ts-expect-error lowercase suffixes are rejected.
    columnId: "COL_ID_price",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;

const invalidField = [
  {
    columnId: "COL_ID_PRICES",
    // @ts-expect-error field must be a real row key.
    field: "prices",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;

const ambiguousColumn = [
  // @ts-expect-error field and valueGetter are mutually exclusive.
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    valueGetter: ({ row }: { readonly row: Order }) => row.price,
  },
] satisfies BrunoTableColumns<Order>;

const missingHeaderName = [
  // @ts-expect-error every leaf column requires an explicit header name.
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    valueType: "text",
  },
] satisfies BrunoTableColumns<Order>;

const invalidValueType = [
  // @ts-expect-error a number field requires number Value Semantics.
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "text",
  },
] satisfies BrunoTableColumns<Order>;

const invalidCapabilityFlags = [
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    // @ts-expect-error filtering capability accepts only a boolean opt-out.
    enableFilter: "no",
  },
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
    // @ts-expect-error sorting capability accepts only a boolean opt-out.
    enableSorting: 0,
  },
] satisfies BrunoTableColumns<Order>;

const invalidComputedDependency = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_DOUBLE_QUANTITY",
    fields: ["quantity"],
    headerName: "Double quantity",
    valueType: "bigint",
    valueGetter: ({ row }) => {
      // @ts-expect-error undeclared fields are absent from the Computed Column getter row.
      void row.price;
      return row.quantity * 2n;
    },
  }),
] satisfies BrunoTableColumns<Order>;

const invalidEmptyComputedDependencies = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_DOUBLE_QUANTITY",
    // @ts-expect-error a Computed Column requires a non-empty dependency tuple.
    fields: [],
    headerName: "Double quantity",
    // @ts-expect-error no Value Type overload accepts an empty dependency tuple.
    valueType: "bigint",
    // @ts-expect-error no getter overload accepts an empty dependency tuple.
    valueGetter: () => 0n,
  }),
] satisfies BrunoTableColumns<Order>;

const invalidNumericFilter = [
  // @ts-expect-error contains is not a numeric operator.
  { columnId: "COL_ID_PRICE", type: "contains", filter: "10" },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidNumericSensitivity = [
  {
    columnId: "COL_ID_PRICE",
    type: "equals",
    filter: 10,
    // @ts-expect-error case sensitivity belongs only to text filters.
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
    // @ts-expect-error accent sensitivity belongs only to text filters.
    accentSensitive: true,
  },
] satisfies BrunoTableFilterExpressions<FeatureFlag, typeof featureFlagColumns>;

const invalidComputedFilter = [
  // @ts-expect-error computed columns have no automatic filter mapping.
  { columnId: "COL_ID_DOUBLE_QUANTITY", type: "greaterThan", filter: 10n },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidOptedOutFilter = [
  // @ts-expect-error an explicitly non-filterable Field Column is absent from filter identities.
  { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<Order, CapabilityColumns>;

const invalidMixedColumnCompoundFilter = [
  {
    type: "OR",
    // @ts-expect-error compound filters may combine leaves from only one Column Identity.
    conditions: [
      { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 },
      { columnId: "COL_ID_SYMBOL", type: "startsWith", filter: "A" },
    ],
  },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidSort = [
  // @ts-expect-error computed columns have no automatic sort mapping.
  { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
] satisfies BrunoTableSortBy<Columns>;

const invalidOptedOutSort = [
  // @ts-expect-error an explicitly nonsortable Field Column is absent from sort identities.
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<CapabilityColumns>;

const invalidNoCapabilitySort = [
  // @ts-expect-error no sortable Column Identity exists for this table.
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<NoSortingColumns>;

// @ts-expect-error a table can never have an empty normal sort order.
const invalidEmptySort = [] satisfies BrunoTableSortBy<Columns>;

const invalidPaginatedClient = {
  tableId: "orders",
  getRowId: (row: Order) => row.id,
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
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
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  viewportSource: {
    viewport: {},
    totalRows: 0,
    version: 1,
    status: "ready",
  },
  // @ts-expect-error Server Tables expose one continuous row space, not page index.
  pageIndex: 0,
} satisfies BrunoTableServerProps<Order, Columns>;

const clientWithoutRowId = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error Client identity must be derived from the complete resident rows.
const invalidClientWithoutRowId: BrunoTableClientProps<Order, Columns> = clientWithoutRowId;

const invalidServerWithRowId = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  // @ts-expect-error Server identity is supplied by the Viewport Source, not the consumer.
  getRowId: (row: Order) => row.id,
  viewportSource: {
    viewport: {},
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} satisfies BrunoTableServerProps<Order, Columns>;

const invalidServerEditing = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  viewportSource: {
    viewport: {},
    totalRows: 0,
    version: 1,
    status: "ready",
  },
  // @ts-expect-error Server Tables cannot enable editing.
  editable: true,
} satisfies BrunoTableServerProps<Order, Columns>;

const editableClientWithoutSave = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  editable: true,
  getRowVersion: (row: Order) => row.revision,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error editable Client Tables require an onSaveEdits operation.
const invalidEditableClientWithoutSave: BrunoTableClientProps<Order, Columns, bigint> =
  editableClientWithoutSave;

const readOnlyClientWithSave = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  editable: false,
  getRowVersion: (row: Order) => row.revision,
  onSaveEdits: () => Promise.resolve(),
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error read-only Client Tables reject edit-only operations.
const invalidReadOnlyClientWithSave: BrunoTableClientProps<Order, Columns, bigint> =
  readOnlyClientWithSave;

const nonEditableColumns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
  },
] satisfies BrunoTableColumns<Order>;

const invalidClientWithoutEditableColumns = {
  tableId: "orders",
  columns: nonEditableColumns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  // @ts-expect-error no column exposes editable capability.
  editable: true,
  // @ts-expect-error no column exposes editable capability.
  getRowVersion: (row: Order) => row.revision,
  // @ts-expect-error no column exposes editable capability.
  onSaveEdits: () => Promise.resolve(),
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} satisfies BrunoTableClientProps<Order, typeof nonEditableColumns, bigint>;

const editableClientWithGrouping = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  editable: true,
  getRowVersion: (row: Order) => row.revision,
  onSaveEdits: () => Promise.resolve(),
  groupRowsColumn: { headerName: "Rows" },
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error editable Client Tables reject grouping even for non-fresh props objects.
const invalidEditableClientWithGrouping: BrunoTableClientProps<Order, Columns, bigint> =
  editableClientWithGrouping;

const invalidCrossedSaveCell = {
  columnId: "COL_ID_PRICE",
  field: "symbol",
  before: 1,
  after: 2,
} as const;

// @ts-expect-error a Column Identity is correlated with its exact source field.
const invalidCrossedSaveCellAssignment: BrunoTableSaveCellChange<Order, Columns> =
  invalidCrossedSaveCell;

const widenedColumns: BrunoTableColumns<Order> = columns;
const invalidWidenedSaveCell = {
  columnId: "COL_ID_PRICE",
  field: "price",
  before: "not a number",
  after: "still not a number",
} as const;

// @ts-expect-error widened columns retain field/value correlation for runtime validation.
const invalidWidenedSaveCellAssignment: BrunoTableSaveCellChange<Order, typeof widenedColumns> =
  invalidWidenedSaveCell;

// @ts-expect-error a Save Change Set is never empty.
const invalidEmptySaveChangeSet = [] satisfies BrunoTableSaveChangeSet<Order, Columns, bigint>;

// @ts-expect-error a row Save Cell Change Set is never empty.
const invalidEmptySaveCellChangeSet = [] satisfies BrunoTableSaveChangeSet<
  Order,
  Columns,
  bigint
>[number]["changes"];

const clientWithoutInitialOrderBy = {
  tableId: "orders",
  columns,
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error every table requires a non-empty Initial Order By baseline.
const invalidClientWithoutInitialOrderBy: BrunoTableClientProps<Order, Columns> =
  clientWithoutInitialOrderBy;

const invalidInitialOrderByWithoutSortingCapability = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  // @ts-expect-error a table with no sortable columns does not install an Initial Order By prop.
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} satisfies BrunoTableClientProps<Order, NoSortingColumns>;

const invalidNumberHelperField = [
  // @ts-expect-error the rejected helper result cannot enter the typed column tuple.
  BrunoTableNumberColumn({
    columnId: "COL_ID_SYMBOL",
    // @ts-expect-error the Number helper cannot target a string field.
    field: "symbol",
    headerName: "Symbol",
  }),
] satisfies BrunoTableColumns<HelperRow>;

const invalidHelperWithoutColumnId = [
  // @ts-expect-error every helper invocation still requires an explicit Column Identity.
  BrunoTableTextColumn({ field: "symbol", headerName: "Symbol" }),
] satisfies BrunoTableColumns<HelperRow>;

const invalidHelperComputedDependency = [
  BrunoTableNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    fields: ["price", "multiplier"],
    headerName: "Weighted price",
    valueGetter: ({ row }) => {
      // @ts-expect-error only declared dependencies exist in a Computed getter row.
      void row.status;
      return row.price * row.multiplier;
    },
  }),
] satisfies BrunoTableColumns<HelperRow>;

const invalidIncompleteSelectDomain = [
  BrunoTableSelectColumn({
    columnId: "COL_ID_STATUS",
    // @ts-expect-error Select options must cover the field's exact non-nullish value domain.
    field: "status",
    headerName: "Status",
    options: ["open"],
  }),
] satisfies BrunoTableColumns<HelperRow>;

const invalidCustomNumericOperand = [
  // @ts-expect-error a custom numeric Value Type retains its exact operand domain.
  { columnId: "COL_ID_AMOUNT", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<AmountRow, typeof customValueColumns>;

void invalidColumnIds;
void invalidField;
void ambiguousColumn;
void missingHeaderName;
void invalidValueType;
void invalidCapabilityFlags;
void invalidComputedDependency;
void invalidEmptyComputedDependencies;
void invalidNumericFilter;
void invalidNumericSensitivity;
void invalidBooleanSensitivity;
void invalidComputedFilter;
void invalidOptedOutFilter;
void invalidMixedColumnCompoundFilter;
void invalidSort;
void invalidOptedOutSort;
void invalidNoCapabilitySort;
void invalidEmptySort;
void invalidPaginatedClient;
void invalidPaginatedServer;
void invalidClientWithoutRowId;
void invalidServerWithRowId;
void invalidServerEditing;
void invalidEditableClientWithoutSave;
void invalidReadOnlyClientWithSave;
void invalidClientWithoutEditableColumns;
void invalidEditableClientWithGrouping;
void invalidCrossedSaveCell;
void invalidCrossedSaveCellAssignment;
void invalidWidenedSaveCell;
void invalidWidenedSaveCellAssignment;
void invalidEmptySaveChangeSet;
void invalidEmptySaveCellChangeSet;
void invalidClientWithoutInitialOrderBy;
void invalidInitialOrderByWithoutSortingCapability;
void invalidNumberHelperField;
void invalidHelperWithoutColumnId;
void invalidHelperComputedDependency;
void invalidIncompleteSelectDomain;
void invalidCustomNumericOperand;
