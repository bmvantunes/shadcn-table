import { describe, expectTypeOf, it } from "vitest";

import type { ReactElement, ReactNode } from "react";
import type { LiveQueryResult } from "effect-view-server/config/query";

import {
  BrunoTableBigIntColumn,
  BrunoTableBooleanColumn,
  BrunoTableClient,
  BrunoTableComputedColumn,
  BrunoTableQuickFilter,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableTextColumn,
  BrunoTableToolbar,
} from "./index";

import type {
  BrunoTableClientProps,
  BrunoTableClientSource,
  BrunoTableCommonProps,
  BrunoTableColumnField,
  BrunoTableColumnId,
  BrunoTableColumnIdOf,
  BrunoTableColumns,
  BrunoTableColumnValue,
  BrunoTableDecodeResult,
  BrunoTableEditableColumnId,
  BrunoTableEditingCapability,
  BrunoTableFilterableColumnId,
  BrunoTableFilterExpressions,
  BrunoTableQuickFilterField,
  BrunoTableQuickFilterFields,
  BrunoTableFieldColumnDefinition,
  BrunoTableGroupKeyCellParams,
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
  readonly hiddenLabel: string;
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

const directViewServerResult = null as unknown as LiveQueryResult<Order>;
const directClientSource: BrunoTableClientSource<Order> = directViewServerResult;
const directViewServerClient = BrunoTableClient({
  tableId: "view-server-orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});
void directClientSource;
void directViewServerClient;

const rawGroupSymbol = {
  columnId: "COL_ID_GROUP_SYMBOL",
  field: "symbol",
  headerName: "Symbol group",
  valueType: "text",
  groupBy: true,
  groupKeyValueFormatter: ({ value }) => value,
} satisfies BrunoTableFieldColumnDefinition<
  Order,
  "symbol",
  "text",
  { readonly groupBy: true },
  "COL_ID_GROUP_SYMBOL"
>;

const rawMaximumPrice = {
  columnId: "COL_ID_MAX_PRICE",
  field: "price",
  headerName: "Maximum price",
  valueType: "number",
  aggFunc: "max",
  aggregateValueFormatter: ({ value }) => value.toFixed(2),
} satisfies BrunoTableFieldColumnDefinition<
  Order,
  "price",
  "number",
  { readonly aggFunc: "max" },
  "COL_ID_MAX_PRICE"
>;

const rawGroupedColumns = [rawGroupSymbol, rawMaximumPrice] satisfies BrunoTableColumns<Order>;
void rawGroupedColumns;

type OnlySymbolGroupEvidence = readonly [
  {
    readonly columnId: "COL_ID_GROUP_SYMBOL";
    readonly field: "symbol";
    readonly groupBy: true;
  },
];

type UnsafelyNarrowGroupedCallbackParams = BrunoTableGroupKeyCellParams<
  string,
  "COL_ID_GROUP_SYMBOL"
> & { readonly groupKeys: OnlySymbolGroupEvidence };

const unsafelyNarrowGroupedCallback = (_params: UnsafelyNarrowGroupedCallbackParams) => "symbol";

BrunoTableTextColumn({
  columnId: "COL_ID_UNSAFE_GROUP_SYMBOL",
  // @ts-expect-error Narrow sibling evidence makes the grouped callback overload invalid.
  field: "symbol",
  headerName: "Unsafe symbol group",
  groupBy: true,
  groupKeyValueFormatter: unsafelyNarrowGroupedCallback,
});

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

void BrunoTableClient({
  tableId: "invalid-unknown-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error Client component preserves exact Column Identity inference.
    { columnId: "COL_ID_UNKNOWN", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-misspelled-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error Client component rejects misspelled Column Identities.
    { columnId: "COL_ID_SYMBOOL", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-sort-direction",
  columns,
  initialOrderBy: [
    {
      columnId: "COL_ID_SYMBOL",
      // @ts-expect-error Client component admits only asc and desc directions.
      direction: "ascending",
    },
  ],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-computed-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error Computed columns have no automatic Client sort mapping.
    { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-nonsortable-sort",
  columns: capabilityColumns,
  initialOrderBy: [
    // @ts-expect-error Client component excludes explicitly nonsortable identities.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});

const sortingTypeTestViewportSource = {
  viewport: {},
  totalRows: 0,
  version: 1,
  status: "ready",
} as const;

const invalidServerUnknownSort = {
  tableId: "invalid-server-unknown-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error Server props preserve exact Column Identity inference.
    { columnId: "COL_ID_UNKNOWN", direction: "asc" },
  ],
  viewportSource: sortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, Columns>;
void invalidServerUnknownSort;

const invalidServerMisspelledSort = {
  tableId: "invalid-server-misspelled-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error Server props reject misspelled Column Identities.
    { columnId: "COL_ID_SYMBOOL", direction: "asc" },
  ],
  viewportSource: sortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, Columns>;
void invalidServerMisspelledSort;

const invalidServerComputedSort = {
  tableId: "invalid-server-computed-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error Computed columns have no automatic Server sort mapping.
    { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
  ],
  viewportSource: sortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, Columns>;
void invalidServerComputedSort;

const invalidServerNonsortableSort = {
  tableId: "invalid-server-nonsortable-sort",
  columns: capabilityColumns,
  initialOrderBy: [
    // @ts-expect-error Server props exclude explicitly nonsortable identities.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  viewportSource: sortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, CapabilityColumns>;
void invalidServerNonsortableSort;

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

expectTypeOf<BrunoTableColumnId<"COL_ID_A B">>().toEqualTypeOf<never>();
expectTypeOf<BrunoTableColumnId<"COL_ID_A\tB">>().toEqualTypeOf<never>();
expectTypeOf<BrunoTableColumnId<"COL_ID_A\u3000B">>().toEqualTypeOf<never>();
expectTypeOf<BrunoTableColumnId<"COL_ID_BRUNO_TABLE_ROWS">>().toEqualTypeOf<never>();

const rawWhitespaceIdentityColumns = [
  {
    columnId: "COL_ID_UNIT PRICE",
    field: "price",
    headerName: "Unit price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;
void BrunoTableClient({
  tableId: "invalid-raw-whitespace-identity",
  // @ts-expect-error Raw Column Identity literals are validated after tuple inference.
  columns: rawWhitespaceIdentityColumns,
  initialOrderBy: [{ columnId: "COL_ID_UNIT PRICE", direction: "asc" }],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});

const invalidWhitespaceHelperOptions = {
  columnId: "COL_ID_UNIT PRICE",
  field: "price",
  headerName: "Unit price",
} as const;
const invalidWhitespaceHelperColumn = [
  // @ts-expect-error Column Helper inputs reject whitespace in literal identities.
  BrunoTableNumberColumn(invalidWhitespaceHelperOptions),
] satisfies BrunoTableColumns<Order>;
void invalidWhitespaceHelperColumn;

const invalidWhitespaceComputedOptions = {
  columnId: "COL_ID_UNIT\u3000PRICE",
  fields: ["price"],
  headerName: "Unit price",
  valueType: "number",
  valueGetter: ({ row }: { readonly row: Pick<Order, "price"> }) => row.price,
} as const;
const invalidWhitespaceComputedColumn = [
  // @ts-expect-error Computed Column inputs reject Unicode whitespace in literal identities.
  BrunoTableComputedColumn(invalidWhitespaceComputedOptions),
] satisfies BrunoTableColumns<Order>;
void invalidWhitespaceComputedColumn;

const rawReservedIdentityColumns = [
  {
    columnId: "COL_ID_BRUNO_TABLE_ROWS",
    field: "price",
    headerName: "Rows",
    valueType: "number",
  },
] as const satisfies BrunoTableColumns<Order>;
void BrunoTableClient({
  tableId: "invalid-raw-reserved-identity",
  // @ts-expect-error Consumers cannot claim the Rows System Column identity.
  columns: rawReservedIdentityColumns,
  initialOrderBy: [{ columnId: "COL_ID_BRUNO_TABLE_ROWS", direction: "asc" }],
  getRowId: (row) => row.id,
  clientSource: directViewServerResult,
});

const invalidReservedHelperOptions = {
  columnId: "COL_ID_BRUNO_TABLE_ROWS",
  field: "price",
  headerName: "Rows",
} as const;
const invalidReservedHelperColumn = [
  // @ts-expect-error Column Helper inputs reject the reserved Rows identity.
  BrunoTableNumberColumn(invalidReservedHelperOptions),
] satisfies BrunoTableColumns<Order>;
void invalidReservedHelperColumn;

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
  it("infers the strict live Client component surface without exposing a table object", () => {
    const props = {
      tableId: "orders",
      columns,
      initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      getRowId: (row: Order) => row.id,
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    } satisfies BrunoTableClientProps<Order, Columns>;
    const callableProps: Parameters<typeof BrunoTableClient<Order, Columns>>[0] = props;
    const namedProps: BrunoTableClientProps<Order, Columns> = callableProps;
    const rendered = BrunoTableClient(namedProps);

    expectTypeOf(rendered).toEqualTypeOf<ReactNode>();
    expectTypeOf(callableProps).toMatchTypeOf<BrunoTableClientProps<Order, Columns>>();
    expectTypeOf(BrunoTableToolbar({ children: "Filters" })).toEqualTypeOf<ReactNode>();
    expectTypeOf(BrunoTableQuickFilter).toExtend<() => ReactNode>();
    expectTypeOf(BrunoTableQuickFilter).toEqualTypeOf<() => ReactElement | null>();

    const validQuickFilterFields = [
      "symbol",
      "status",
      "hiddenLabel",
    ] as const satisfies BrunoTableQuickFilterFields<Order>;
    expectTypeOf(validQuickFilterFields).toEqualTypeOf<
      readonly ["symbol", "status", "hiddenLabel"]
    >();
    expectTypeOf<BrunoTableQuickFilterField<Order>>().toEqualTypeOf<
      "id" | "symbol" | "status" | "hiddenLabel"
    >();
    void BrunoTableClient({
      ...props,
      quickFilterFields: validQuickFilterFields,
    });
    void BrunoTableClient({
      ...props,
      // @ts-expect-error Quick Filter fields must be a non-empty tuple.
      quickFilterFields: [],
    });
    void BrunoTableClient({
      ...props,
      // @ts-expect-error Numeric row fields are not Quick Filter fields.
      quickFilterFields: ["price"],
    });
    void BrunoTableClient({
      ...props,
      // @ts-expect-error Misspelled source fields are rejected.
      quickFilterFields: ["descrption"],
    });
    void BrunoTableClient({
      ...props,
      // @ts-expect-error Column Identities are not source fields.
      quickFilterFields: ["COL_ID_SYMBOL"],
    });

    const missingTableId = {
      columns,
      initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      getRowId: (row: Order) => row.id,
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    };
    // @ts-expect-error tableId is mandatory for every public Client Table.
    const invalidMissingTableId: BrunoTableClientProps<Order, Columns> = missingTableId;
    void invalidMissingTableId;

    const missingRowIdentity = {
      tableId: "orders",
      columns,
      initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }] as const,
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    };
    // @ts-expect-error Client identity is mandatory and cannot be replaced by a row index.
    const invalidMissingRowIdentity: BrunoTableClientProps<Order, Columns> = missingRowIdentity;
    void invalidMissingRowIdentity;

    // @ts-expect-error the first Client renderer requires a non-empty typed order baseline.
    void BrunoTableClient({
      tableId: "orders",
      columns,
      getRowId: (row: Order) => row.id,
      clientSource: {
        rows: [] as readonly Order[],
        totalRows: 0,
        version: 1,
        status: "ready",
      },
    });

    void BrunoTableClient({
      ...props,
      // @ts-expect-error BrunoTable owns the table runtime and exposes no controller prop.
      table: {},
    });
    void BrunoTableClient({
      ...props,
      // @ts-expect-error BrunoTable exposes no row-model option.
      rowModel: {},
    });
  });

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

  it("rejects a Client renderer when no column can supply its required order", () => {
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
    } as const;

    // @ts-expect-error BrunoTableClient always requires a typed non-empty Initial Order By.
    const invalidProps: BrunoTableClientProps<Order, NoSortingColumns> = props;

    expectTypeOf(invalidProps).toEqualTypeOf<BrunoTableClientProps<Order, NoSortingColumns>>();
  });

  it("keeps widened runtime columns conservatively editable", () => {
    const widenedColumns: BrunoTableColumns<Order> = columns;

    expectTypeOf<
      BrunoTableEditableColumnId<typeof widenedColumns>
    >().toEqualTypeOf<BrunoTableColumnId>();

    const widenedEditableCapability = {
      editable: true,
      getRowVersion: (row: Order) => row.revision,
      onSaveEdits: (changes) => {
        expectTypeOf(changes[0].changes[0]).not.toBeNever();
        return Promise.resolve();
      },
    } satisfies BrunoTableEditingCapability<Order, typeof widenedColumns, bigint>;

    expectTypeOf(widenedEditableCapability.getRowVersion).returns.toEqualTypeOf<bigint>();
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

    const emptyCompound = [
      {
        type: "OR",
        // @ts-expect-error Compound filter conditions are non-empty.
        conditions: [],
      },
    ] satisfies BrunoTableFilterExpressions<Order, Columns>;
    void emptyCompound;
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
    expectTypeOf(serverProps.viewportSource.viewport).toEqualTypeOf<typeof viewport>();

    void BrunoTableClient({
      ...clientProps,
      initialOrderBy: [{ columnId: "COL_ID_PRICE", direction: "asc" }],
    });
    const missingColumns = {
      tableId: "orders",
      getRowId: (row: Order) => row.id,
      initialOrderBy: [{ columnId: "COL_ID_PRICE", direction: "asc" }] as const,
      clientSource: clientProps.clientSource,
    };
    // @ts-expect-error A Client Table cannot omit its column definitions.
    const invalidMissingColumns: BrunoTableClientProps<Order, Columns> = missingColumns;
    void invalidMissingColumns;

    const missingClientSource = {
      tableId: "orders",
      columns,
      getRowId: (row: Order) => row.id,
      initialOrderBy: [{ columnId: "COL_ID_PRICE", direction: "asc" }] as const,
    };
    // @ts-expect-error A Client Table cannot omit its live Client Source.
    const invalidMissingClientSource: BrunoTableClientProps<Order, Columns> = missingClientSource;
    void invalidMissingClientSource;
    void BrunoTableClient({
      ...clientProps,
      // @ts-expect-error initialOrderBy is a non-empty typed tuple.
      initialOrderBy: [],
    });

    const noSortColumns = [
      {
        columnId: "COL_ID_SYMBOL",
        field: "symbol",
        headerName: "Symbol",
        valueType: "text",
        isEditable: true,
        enableSorting: false,
      },
    ] as const satisfies BrunoTableColumns<Order>;
    // @ts-expect-error BrunoTableClient cannot omit its required non-empty Initial Order By.
    void BrunoTableClient<Order, typeof noSortColumns>({
      tableId: "orders-no-sort",
      columns: noSortColumns,
      getRowId: (row: Order) => row.id,
      clientSource: clientProps.clientSource,
    });
    void BrunoTableClient<Order, typeof noSortColumns>({
      tableId: "orders-no-sort",
      columns: noSortColumns,
      // @ts-expect-error a Client definition without a sortable Column Identity is invalid.
      initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
      getRowId: (row: Order) => row.id,
      clientSource: clientProps.clientSource,
    });
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

const computedPriceColumn = BrunoTableNumberColumn.withDefaults({
  headerName: "Calculated price",
  enableFilter: true,
  enableSorting: true,
  isEditable: true,
});

const computedPresetColumns = [
  computedPriceColumn({
    columnId: "COL_ID_COMPUTED_PRICE",
    fields: ["price", "multiplier"],
    valueGetter: ({ row }) => row.price * row.multiplier,
  }),
] satisfies BrunoTableColumns<HelperRow>;

expectTypeOf<(typeof computedPresetColumns)[0]["enableFilter"]>().toEqualTypeOf<undefined>();
expectTypeOf<(typeof computedPresetColumns)[0]["enableSorting"]>().toEqualTypeOf<undefined>();
expectTypeOf<(typeof computedPresetColumns)[0]["isEditable"]>().toEqualTypeOf<undefined>();

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

const exactAmountValueType = {
  codecId: "test/exact-amount",
  codecVersion: 1,
  filterFamily: "numeric",
  editorFamily: "text",
  cellAlign: "end",
  editorLayout: "inline",
  defaultWidth: 120,
  decodeRuntime: (input): BrunoTableDecodeResult<ExactAmount> =>
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
} satisfies BrunoTableValueType<ExactAmount, "numeric", "text">;

const customValueColumns = [
  {
    columnId: "COL_ID_AMOUNT",
    field: "amount",
    headerName: "Amount",
    valueType: exactAmountValueType,
  },
] satisfies BrunoTableColumns<AmountRow>;

const customComputedValueColumns = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_AMOUNT_COPY",
    fields: ["amount"],
    headerName: "Amount copy",
    valueType: exactAmountValueType,
    valueGetter: ({ row }) => {
      expectTypeOf(row).toEqualTypeOf<Pick<AmountRow, "amount">>();
      return row.amount;
    },
    valueFormatter: ({ value }) => value.minor.toString(10),
  }),
] satisfies BrunoTableColumns<AmountRow>;

expectTypeOf<
  BrunoTableColumnValue<AmountRow, typeof customComputedValueColumns, "COL_ID_AMOUNT_COPY">
>().toEqualTypeOf<ExactAmount>();

const customNumericFilter = [
  { columnId: "COL_ID_AMOUNT", type: "greaterThan", filter: { minor: 10n } },
] satisfies BrunoTableFilterExpressions<AmountRow, typeof customValueColumns>;

void customNumericFilter;
void customComputedValueColumns;

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

const invalidBooleanSetFilter = [
  // @ts-expect-error Boolean Set Filter inclusion is deferred to issue #13.
  { columnId: "COL_ID_ENABLED", type: "in", filter: [true] },
] satisfies BrunoTableFilterExpressions<FeatureFlag, typeof featureFlagColumns>;

const invalidSelectSetFilter = [
  // @ts-expect-error Select Set Filter inclusion is deferred to issue #13.
  { columnId: "COL_ID_STATUS", type: "in", filter: ["open"] },
] satisfies BrunoTableFilterExpressions<HelperRow, HelperColumns>;

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
const invalidEditableClientWithoutSave: BrunoTableEditingCapability<Order, Columns, bigint> =
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
const invalidReadOnlyClientWithSave: BrunoTableClientProps<Order, Columns> = readOnlyClientWithSave;

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
  editable: true,
  getRowVersion: (row: Order) => row.revision,
  onSaveEdits: () => Promise.resolve(),
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error no column exposes editable capability.
const invalidClientWithoutEditableColumnsAssignment: BrunoTableEditingCapability<
  Order,
  typeof nonEditableColumns,
  bigint
> = invalidClientWithoutEditableColumns;
void invalidClientWithoutEditableColumnsAssignment;

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
const invalidEditableClientWithGrouping: BrunoTableEditingCapability<Order, Columns, bigint> =
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

const serverWithoutInitialOrderBy = {
  tableId: "orders",
  columns,
  viewportSource: {
    viewport: {},
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} as const;

// @ts-expect-error every Server Table requires a non-empty Initial Order By baseline.
const invalidServerWithoutInitialOrderBy: BrunoTableServerProps<Order, Columns> =
  serverWithoutInitialOrderBy;
void invalidServerWithoutInitialOrderBy;

// @ts-expect-error exported Common props also require a non-empty Initial Order By baseline.
const invalidCommonWithoutInitialOrderBy: BrunoTableCommonProps<Order, Columns> = {
  tableId: "orders",
  columns,
};
void invalidCommonWithoutInitialOrderBy;

const invalidInitialOrderByWithoutSortingCapability = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  // @ts-expect-error every table requires a sortable Column Identity for Initial Order By.
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} satisfies BrunoTableClientProps<Order, NoSortingColumns>;

const invalidServerWithoutSortingCapability = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  initialOrderBy: [
    // @ts-expect-error every Server Table requires a sortable Column Identity.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  viewportSource: {
    viewport: {},
    totalRows: 0,
    version: 1,
    status: "ready",
  },
} satisfies BrunoTableServerProps<Order, NoSortingColumns>;
void invalidServerWithoutSortingCapability;

const invalidCommonWithoutSortingCapability = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  initialOrderBy: [
    // @ts-expect-error public Common props reject definitions without a sortable Column Identity.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
} satisfies BrunoTableCommonProps<Order, NoSortingColumns>;
void invalidCommonWithoutSortingCapability;

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

const invalidIdentityPreset = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error a reusable preset can never own Column Identity.
  columnId: "COL_ID_PRICE",
});

const invalidFieldPreset = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error a reusable preset can never own server field mapping.
  field: "price",
});

const invalidValueTypePreset = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error a reusable preset cannot replace a helper's exact Value Type.
  valueType: "text",
});

const invalidUnknownPresetOption = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error presets reject configuration outside their explicit surface.
  mysteryOption: true,
});

const strictPricePreset = BrunoTableNumberColumn.withDefaults({ headerName: "Price" });
const invalidPresetInvocationWithoutColumnId = strictPricePreset({
  // @ts-expect-error the final preset invocation still requires Column Identity.
  field: "price",
});

const invalidNumberHelperValueType = BrunoTableNumberColumn({
  columnId: "COL_ID_PRICE",
  // @ts-expect-error a Number helper cannot be changed into another Value Type.
  field: "price",
  headerName: "Price",
  valueType: "text",
});

const narrowPriceFormatter = ({
  row,
  value,
}: {
  readonly row: HelperRow & { readonly secret: string };
  readonly value: number;
}) => `${row.secret}:${value}`;

const invalidNarrowPresentationCallback = [
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    // @ts-expect-error BrunoTable may pass any HelperRow, not a narrower row subtype.
    valueFormatter: narrowPriceFormatter,
  },
] satisfies BrunoTableColumns<HelperRow>;

type MixedAmountRow = { readonly amount: ExactAmount | { readonly major: number } };
const invalidNarrowCustomValueType = [
  // @ts-expect-error a custom Value Type must accept the field's complete exact value domain.
  {
    columnId: "COL_ID_AMOUNT",
    field: "amount",
    headerName: "Amount",
    valueType: exactAmountValueType,
  },
] satisfies BrunoTableColumns<MixedAmountRow>;

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

const invalidCustomComputedDependency = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_AMOUNT_COPY",
    fields: ["amount"],
    headerName: "Amount copy",
    valueType: exactAmountValueType,
    valueGetter: ({ row }) => {
      // @ts-expect-error custom Computed Columns expose only declared dependencies.
      void row.otherAmount;
      return row.amount;
    },
  }),
] satisfies BrunoTableColumns<AmountRow>;

const invalidIncompleteSelectDomain = [
  // @ts-expect-error the rejected Select helper result cannot enter the typed column tuple.
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
void invalidBooleanSetFilter;
void invalidSelectSetFilter;
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
void invalidIdentityPreset;
void invalidFieldPreset;
void invalidValueTypePreset;
void invalidUnknownPresetOption;
void invalidPresetInvocationWithoutColumnId;
void invalidNumberHelperValueType;
void invalidNarrowPresentationCallback;
void invalidNarrowCustomValueType;
void invalidHelperComputedDependency;
void invalidCustomComputedDependency;
void invalidIncompleteSelectDomain;
void invalidCustomNumericOperand;
