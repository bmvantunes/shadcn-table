import { describe, expectTypeOf, it } from "vitest";

import { BrunoTableComputedColumn } from "./index";

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
    expectTypeOf<BrunoTableEditableColumnId<Columns>>().toEqualTypeOf<
      "COL_ID_SYMBOL" | "COL_ID_PRICE"
    >();
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
    expectTypeOf(clientProps.children).toEqualTypeOf<string>();
    expectTypeOf(editableClientProps.getRowVersion).returns.toEqualTypeOf<bigint>();
    expectTypeOf(serverProps.viewportSource.viewport).toEqualTypeOf<typeof viewport>();
  });
});

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

void invalidColumnIds;
void invalidField;
void ambiguousColumn;
void missingHeaderName;
void invalidValueType;
void invalidComputedDependency;
void invalidEmptyComputedDependencies;
void invalidNumericFilter;
void invalidNumericSensitivity;
void invalidBooleanSensitivity;
void invalidComputedFilter;
void invalidMixedColumnCompoundFilter;
void invalidSort;
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
