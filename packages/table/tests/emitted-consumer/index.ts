import {
  BrunoTableBigIntColumn,
  BrunoTableBooleanColumn,
  BrunoTableClient,
  BrunoTableComputedColumn,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableTextColumn,
  BrunoTableToolbar,
  type BrunoTableBuiltInValueType,
  type BrunoTableClientProps,
  type BrunoTableColumnField,
  type BrunoTableColumnId,
  type BrunoTableColumnValue,
  type BrunoTableColumns,
  type BrunoTableDecodeResult,
  type BrunoTableEditingCapability,
  type BrunoTableFilterableColumnId,
  type BrunoTableFilterExpressions,
  type BrunoTableGroupKeyCellParams,
  type BrunoTableSaveCellChange,
  type BrunoTableSaveChangeSet,
  type BrunoTableServerProps,
  type BrunoTableSortableColumnId,
  type BrunoTableSortBy,
  type BrunoTableValueType,
} from "@bruno/table";
import type { LiveQueryResult } from "effect-view-server/config/query";

type Equal<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2
    ? true
    : false;

type Expect<TValue extends true> = TValue;

const emittedWhitespaceColumnIdRejected: Expect<Equal<BrunoTableColumnId<"COL_ID_A B">, never>> =
  true;
void emittedWhitespaceColumnIdRejected;
const emittedReservedColumnIdRejected: Expect<
  Equal<BrunoTableColumnId<"COL_ID_BRUNO_TABLE_ROWS">, never>
> = true;
void emittedReservedColumnIdRejected;

type Order = {
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly revision: bigint;
  readonly active: boolean;
  readonly status: "open" | "closed";
  readonly multiplier: number;
};

const emittedInvalidWhitespaceHelperOptions = {
  columnId: "COL_ID_UNIT PRICE",
  field: "price",
  headerName: "Unit price",
} as const;
const emittedInvalidWhitespaceHelperColumn = [
  // @ts-expect-error Emitted Column Helper declarations reject whitespace identities.
  BrunoTableNumberColumn(emittedInvalidWhitespaceHelperOptions),
] satisfies BrunoTableColumns<Order>;
void emittedInvalidWhitespaceHelperColumn;
const emittedInvalidReservedHelperOptions = {
  columnId: "COL_ID_BRUNO_TABLE_ROWS",
  field: "price",
  headerName: "Rows",
} as const;
const emittedInvalidReservedHelperColumn = [
  // @ts-expect-error Emitted Column Helper declarations reject the reserved Rows identity.
  BrunoTableNumberColumn(emittedInvalidReservedHelperOptions),
] satisfies BrunoTableColumns<Order>;
void emittedInvalidReservedHelperColumn;

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
    isEditable: true,
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

const emittedClientProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] satisfies readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready" as const,
  },
} satisfies BrunoTableClientProps<Order, Columns>;
const emittedCallableProps: Parameters<typeof BrunoTableClient<Order, Columns>>[0] =
  emittedClientProps;
const emittedNamedProps: BrunoTableClientProps<Order, Columns> = emittedCallableProps;
void BrunoTableClient(emittedNamedProps);

declare const emittedViewServerResult: LiveQueryResult<Order>;
const emittedViewServerClient = BrunoTableClient<Order, Columns>({
  tableId: "view-server-orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: emittedViewServerResult,
});
void emittedViewServerClient;

const emittedPriceColumn = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  width: 112,
  format: { minimumFractionDigits: 2 },
});

const emittedStatusColumn = BrunoTableSelectColumn.withDefaults({
  headerName: "Status",
  options: ["open", "closed"],
});

const emittedComputedNumberColumn = BrunoTableNumberColumn.withDefaults({
  headerName: "Calculated price",
  enableFilter: true,
  enableSorting: true,
  isEditable: true,
});

const emittedComputedPresetColumns = [
  emittedComputedNumberColumn({
    columnId: "COL_ID_COMPUTED_PRICE",
    fields: ["price", "multiplier"],
    valueGetter: ({ row }) => row.price * row.multiplier,
  }),
] satisfies BrunoTableColumns<Order>;

type ComputedPresetOmitsFiltering = Expect<
  Equal<(typeof emittedComputedPresetColumns)[0]["enableFilter"], undefined>
>;
type ComputedPresetOmitsSorting = Expect<
  Equal<(typeof emittedComputedPresetColumns)[0]["enableSorting"], undefined>
>;
type ComputedPresetOmitsEditing = Expect<
  Equal<(typeof emittedComputedPresetColumns)[0]["isEditable"], undefined>
>;

const helperColumns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  emittedPriceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    width: 144,
    valueFormatter: ({ value }) => value.toFixed(2),
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
  emittedStatusColumn({
    columnId: "COL_ID_STATUS",
    field: "status",
  }),
  BrunoTableNumberColumn({
    columnId: "COL_ID_WEIGHTED_PRICE",
    fields: ["price", "multiplier"],
    headerName: "Weighted price",
    valueGetter: ({ row }) => row.price * row.multiplier,
  }),
] satisfies BrunoTableColumns<Order>;

type HelperColumns = typeof helperColumns;

type NarrowEmittedGroupParams = BrunoTableGroupKeyCellParams<string, "COL_ID_NARROW_GROUP"> & {
  readonly groupKeys: readonly [{ readonly field: "symbol"; readonly value: string }];
};

const narrowEmittedGroupFormatter = (_params: NarrowEmittedGroupParams) => "symbol";

BrunoTableTextColumn({
  columnId: "COL_ID_NARROW_GROUP",
  // @ts-expect-error Emitted helpers reject callbacks that require unavailable sibling evidence.
  field: "symbol",
  headerName: "Narrow group",
  groupBy: true,
  groupKeyValueFormatter: narrowEmittedGroupFormatter,
});

type HelperPrice = Expect<
  Equal<BrunoTableColumnValue<Order, HelperColumns, "COL_ID_PRICE">, number>
>;
type HelperQuantity = Expect<
  Equal<BrunoTableColumnValue<Order, HelperColumns, "COL_ID_QUANTITY">, bigint>
>;
type HelperStatus = Expect<
  Equal<BrunoTableColumnValue<Order, HelperColumns, "COL_ID_STATUS">, "open" | "closed">
>;
type HelperWeightedPrice = Expect<
  Equal<BrunoTableColumnValue<Order, HelperColumns, "COL_ID_WEIGHTED_PRICE">, number>
>;

type ExactAmount = { readonly minor: bigint };
type AmountRow = { readonly amount: ExactAmount };

const exactAmountValueType = {
  codecId: "consumer/exact-amount",
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
  decodePersisted: (input) =>
    typeof input === "object" &&
    input !== null &&
    "minor" in input &&
    typeof input.minor === "string"
      ? { _tag: "Success", value: { minor: BigInt(input.minor) } }
      : { _tag: "Failure", message: "Expected persisted exact amount." },
} satisfies BrunoTableValueType<ExactAmount, "numeric", "text">;

type OtherAmount = { readonly major: number };
const otherAmountValueType = {
  codecId: "consumer/other-amount",
  codecVersion: 1,
  filterFamily: "numeric",
  editorFamily: "text",
  cellAlign: "end",
  editorLayout: "inline",
  defaultWidth: 120,
  decodeRuntime: (input): BrunoTableDecodeResult<OtherAmount> =>
    typeof input === "object" &&
    input !== null &&
    "major" in input &&
    typeof input.major === "number"
      ? { _tag: "Success", value: { major: input.major } }
      : { _tag: "Failure", message: "Expected another amount." },
  equivalent: (left, right) => left.major === right.major,
  compare: (left, right) => (left.major === right.major ? 0 : left.major < right.major ? -1 : 1),
  formatCanonicalText: (value) => String(value.major),
  parseCanonicalText: (text) =>
    /^\d+(?:\.\d+)?$/u.test(text)
      ? { _tag: "Success", value: { major: Number(text) } }
      : { _tag: "Failure", message: "Expected another amount." },
  formatDisplay: (value) => String(value.major),
  encodePersisted: (value) => ({ major: value.major }),
  decodePersisted: () => ({ _tag: "Failure", message: "Not used in this type proof." }),
} satisfies BrunoTableValueType<OtherAmount, "numeric", "text">;

const invalidEmittedCodecPairing = [
  // @ts-expect-error Emitted declarations reject a codec paired with another field domain.
  {
    columnId: "COL_ID_WRONG_AMOUNT_CODEC",
    field: "amount",
    headerName: "Wrong amount codec",
    valueType: otherAmountValueType,
  },
] satisfies BrunoTableColumns<AmountRow>;
void invalidEmittedCodecPairing;

const invalidEmittedComputedCodecPairing = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_WRONG_COMPUTED_CODEC",
    fields: ["amount"],
    headerName: "Wrong computed codec",
    valueType: otherAmountValueType,
    // @ts-expect-error Emitted declarations reject a computed getter paired with another domain.
    valueGetter: ({ row }) => row.amount,
  }),
] satisfies BrunoTableColumns<AmountRow>;
void invalidEmittedComputedCodecPairing;

const exactAmountColumns = [
  {
    columnId: "COL_ID_AMOUNT",
    field: "amount",
    headerName: "Amount",
    valueType: exactAmountValueType,
  },
] satisfies BrunoTableColumns<AmountRow>;

const exactAmountComputedColumns = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_AMOUNT_COPY",
    fields: ["amount"],
    headerName: "Amount copy",
    valueType: exactAmountValueType,
    valueGetter: ({ row }) => row.amount,
    valueFormatter: ({ value }) => value.minor.toString(10),
  }),
] satisfies BrunoTableColumns<AmountRow>;

type ExactComputedAmount = Expect<
  Equal<
    BrunoTableColumnValue<AmountRow, typeof exactAmountComputedColumns, "COL_ID_AMOUNT_COPY">,
    ExactAmount
  >
>;

const exactAmountFilters = [
  { columnId: "COL_ID_AMOUNT", type: "greaterThan", filter: { minor: 10n } },
] satisfies BrunoTableFilterExpressions<AmountRow, typeof exactAmountColumns>;

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

const invalidUnknownSortProps = {
  tableId: "invalid-unknown-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted Client component preserves exact Column Identity inference.
    { columnId: "COL_ID_UNKNOWN", direction: "asc" },
  ],
  getRowId: (row: Order) => row.id,
  clientSource: emittedViewServerResult,
} satisfies BrunoTableClientProps<Order, Columns>;
void invalidUnknownSortProps;
const invalidMisspelledSortProps = {
  tableId: "invalid-misspelled-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted Client component rejects misspelled Column Identities.
    { columnId: "COL_ID_SYMBOOL", direction: "asc" },
  ],
  getRowId: (row: Order) => row.id,
  clientSource: emittedViewServerResult,
} satisfies BrunoTableClientProps<Order, Columns>;
void invalidMisspelledSortProps;
const invalidComputedSortProps = {
  tableId: "invalid-computed-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted computed columns have no automatic Client sort mapping.
    { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
  ],
  getRowId: (row: Order) => row.id,
  clientSource: emittedViewServerResult,
} satisfies BrunoTableClientProps<Order, Columns>;
void invalidComputedSortProps;
const invalidNonsortableSortProps = {
  tableId: "invalid-nonsortable-sort",
  columns: capabilityColumns,
  initialOrderBy: [
    // @ts-expect-error emitted Client component excludes explicitly nonsortable identities.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  getRowId: (row: Order) => row.id,
  clientSource: emittedViewServerResult,
} satisfies BrunoTableClientProps<Order, CapabilityColumns>;
void invalidNonsortableSortProps;

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
type Price = Expect<Equal<BrunoTableColumnValue<Order, Columns, "COL_ID_PRICE">, number>>;
type DoubleQuantity = Expect<
  Equal<BrunoTableColumnValue<Order, Columns, "COL_ID_DOUBLE_QUANTITY">, bigint>
>;
type Filterable = Expect<
  Equal<BrunoTableFilterableColumnId<Columns>, "COL_ID_SYMBOL" | "COL_ID_PRICE">
>;
type OptedFilterable = Expect<
  Equal<BrunoTableFilterableColumnId<CapabilityColumns>, "COL_ID_SYMBOL">
>;
type OptedSortable = Expect<Equal<BrunoTableSortableColumnId<CapabilityColumns>, "COL_ID_PRICE">>;
type NoSortable = Expect<Equal<BrunoTableSortableColumnId<NoSortingColumns>, never>>;
type MixedCaseColumnIdRejected = Expect<
  Equal<"COL_ID_Price" extends import("@bruno/table").BrunoTableColumnId ? true : false, false>
>;
type PriceField = Expect<Equal<BrunoTableColumnField<Columns, "COL_ID_PRICE">, "price">>;
type CorrelatedSaves = Expect<
  Equal<
    BrunoTableSaveCellChange<Order, Columns>,
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
  >
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
  initialFilters: filters,
  initialOrderBy: [
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ] satisfies BrunoTableSortBy<Columns>,
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const emittedClient = BrunoTableClient<Order, Columns>({
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] satisfies readonly Order[],
    totalRows: 0,
    version: 0,
    status: "ready",
  },
});
void emittedClient;

const invalidPrivateRuntimeProps = {
  tableId: "private-runtime",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client API exposes no table controller.
  table: {},
} satisfies BrunoTableClientProps<Order, Columns>;
void invalidPrivateRuntimeProps;
const invalidPrivateRowModelProps = {
  tableId: "private-row-model",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client API exposes no TanStack row-model factory.
  getCoreRowModel: () => ({}),
} satisfies BrunoTableClientProps<Order, Columns>;
void invalidPrivateRowModelProps;

const missingTableIdProps = {
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client component requires tableId.
} satisfies BrunoTableClientProps<Order, Columns>;
void missingTableIdProps;
const missingColumnsProps = {
  tableId: "orders",
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client component requires columns.
} satisfies BrunoTableClientProps<Order, Columns>;
void missingColumnsProps;
const missingGetRowIdProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client component requires getRowId.
} satisfies BrunoTableClientProps<Order, Columns>;
void missingGetRowIdProps;
const missingClientSourceProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  // @ts-expect-error emitted Client component requires clientSource.
} satisfies BrunoTableClientProps<Order, Columns>;
void missingClientSourceProps;
const missingInitialOrderByProps = {
  tableId: "orders",
  columns,
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client component requires initialOrderBy.
} satisfies BrunoTableClientProps<Order, Columns>;
void missingInitialOrderByProps;
const emptyInitialOrderByProps = {
  tableId: "orders",
  columns,
  // @ts-expect-error emitted Client component rejects an empty initialOrderBy.
  initialOrderBy: [],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] satisfies readonly Order[], totalRows: 0, version: 0, status: "ready" },
} satisfies BrunoTableClientProps<Order, Columns>;
void emptyInitialOrderByProps;
const emittedToolbar = BrunoTableToolbar({ children: "Filters" });
void emittedToolbar;

type EmittedEditableClientProps<TColumns extends BrunoTableColumns<Order>> = Omit<
  BrunoTableClientProps<Order, TColumns>,
  "editable" | "getRowVersion" | "onSaveEdits"
> &
  BrunoTableEditingCapability<Order, TColumns, bigint>;

const editableProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  editable: true,
  getRowVersion: (row: Order) => row.revision,
  onSaveEdits: (changes) => {
    const version: bigint = changes[0].expectedVersion;
    const [change] = changes[0].changes;
    const field: "price" | "symbol" = change.field;
    void version;
    void field;
    return Promise.resolve();
  },
  clientSource: {
    rows: [] satisfies readonly Order[],
    totalRows: 0,
    version: 0,
    status: "ready",
  },
} satisfies EmittedEditableClientProps<Columns>;

const noSortingProps = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] satisfies readonly Order[],
    totalRows: 0,
    version: 0,
    status: "ready",
  },
} as const;

// @ts-expect-error emitted Client props always require a typed non-empty Initial Order By.
const invalidNoSortingProps: BrunoTableClientProps<Order, NoSortingColumns> = noSortingProps;

const widenedColumns: BrunoTableColumns<Order> = columns;
const widenedEditableProps = {
  tableId: "widened-orders",
  columns: widenedColumns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  editable: true,
  getRowVersion: (row: Order) => row.revision,
  onSaveEdits: (changes) => {
    const field: keyof Order = changes[0].changes[0].field;
    void field;
    return Promise.resolve();
  },
  clientSource: {
    rows: [] satisfies readonly Order[],
    totalRows: 0,
    version: 0,
    status: "ready",
  },
} satisfies EmittedEditableClientProps<typeof widenedColumns>;

const invalidProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  // @ts-expect-error emitted Server props preserve source-owned row identity.
  getRowId: (row: Order) => row.id,
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const invalidServerEditing = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  viewportSource: source,
  // @ts-expect-error emitted Server props forbid editing.
  editable: true,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const editablePropsWithGrouping = {
  ...editableProps,
  groupRowsColumn: { headerName: "Rows" },
} as const;

// @ts-expect-error emitted editable Client props reject grouping for non-fresh objects.
const invalidEditableGrouping: EmittedEditableClientProps<Columns> = editablePropsWithGrouping;

const invalidCrossedSaveCell = {
  columnId: "COL_ID_SYMBOL",
  field: "price",
  before: "AAPL",
  after: "MSFT",
} as const;

// @ts-expect-error emitted declarations preserve Column Identity and field correlation.
const invalidCrossedSaveCellAssignment: BrunoTableSaveCellChange<Order, Columns> =
  invalidCrossedSaveCell;

const invalidWidenedSaveCell = {
  columnId: "COL_ID_PRICE",
  field: "price",
  before: "not a number",
  after: "still not a number",
} as const;

// @ts-expect-error emitted widened columns retain field/value correlation.
const invalidWidenedSaveCellAssignment: BrunoTableSaveCellChange<Order, typeof widenedColumns> =
  invalidWidenedSaveCell;

// @ts-expect-error emitted Save Change Sets are non-empty.
const invalidEmptySave = [] satisfies BrunoTableSaveChangeSet<Order, Columns, bigint>;

const invalidColumn = [
  {
    // @ts-expect-error emitted declarations preserve the uppercase identity contract.
    columnId: "COL_ID_price",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;

// @ts-expect-error emitted declarations reject mixed-case Column Identity suffixes.
const invalidMixedCaseColumnId: import("@bruno/table").BrunoTableColumnId = "COL_ID_Price";
void invalidMixedCaseColumnId;

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

const invalidOptedOutFilter = [
  // @ts-expect-error emitted declarations exclude explicitly non-filterable identities.
  { columnId: "COL_ID_PRICE", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<Order, CapabilityColumns>;

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

const invalidEmptyCompoundFilter = [
  {
    type: "OR",
    // @ts-expect-error emitted compound filter conditions are non-empty.
    conditions: [],
  },
] satisfies BrunoTableFilterExpressions<Order, Columns>;
void invalidEmptyCompoundFilter;

// @ts-expect-error emitted declarations preserve the non-empty sorting invariant.
const invalidEmptySort = [] satisfies BrunoTableSortBy<Columns>;

const invalidOptedOutSort = [
  // @ts-expect-error emitted declarations exclude explicitly nonsortable identities.
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<CapabilityColumns>;

const invalidNoCapabilitySort = [
  // @ts-expect-error emitted declarations expose no order for a table without sortable columns.
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<NoSortingColumns>;

const invalidInitialOrderByWithoutSortingCapability = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  // @ts-expect-error no valid Initial Order By exists when sorting capability is absent.
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] satisfies readonly Order[],
    totalRows: 0,
    version: 0,
    status: "ready",
  },
} satisfies BrunoTableClientProps<Order, NoSortingColumns>;

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

const invalidNumberHelperField = [
  // @ts-expect-error the rejected helper result cannot enter the emitted typed column tuple.
  BrunoTableNumberColumn({
    columnId: "COL_ID_SYMBOL",
    // @ts-expect-error emitted Number helper rejects a string field.
    field: "symbol",
    headerName: "Symbol",
  }),
] satisfies BrunoTableColumns<Order>;

const invalidHelperWithoutColumnId = [
  // @ts-expect-error emitted helpers still require an explicit Column Identity.
  BrunoTableTextColumn({ field: "symbol", headerName: "Symbol" }),
] satisfies BrunoTableColumns<Order>;

const invalidIdentityPreset = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error emitted presets can never own Column Identity.
  columnId: "COL_ID_PRICE",
});

const invalidFieldPreset = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error emitted presets can never own server field mapping.
  field: "price",
});

const invalidValueTypePreset = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error emitted presets cannot replace exact Value Types.
  valueType: "text",
});

const invalidUnknownPresetOption = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  // @ts-expect-error emitted presets reject unknown configuration.
  mysteryOption: true,
});

const emittedStrictPricePreset = BrunoTableNumberColumn.withDefaults({ headerName: "Price" });
const invalidPresetInvocationWithoutColumnId = emittedStrictPricePreset({
  // @ts-expect-error emitted preset calls still require explicit Column Identity.
  field: "price",
});

const invalidNumberHelperValueType = BrunoTableNumberColumn({
  columnId: "COL_ID_PRICE",
  // @ts-expect-error emitted Number helpers cannot change exact Value Type.
  field: "price",
  headerName: "Price",
  valueType: "text",
});

const narrowPriceFormatter = ({
  row,
  value,
}: {
  readonly row: Order & { readonly secret: string };
  readonly value: number;
}) => `${row.secret}:${value}`;

const invalidNarrowPresentationCallback = [
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
    // @ts-expect-error emitted presentation callbacks reject narrower row annotations.
    valueFormatter: narrowPriceFormatter,
  },
] satisfies BrunoTableColumns<Order>;

type MixedAmountRow = { readonly amount: ExactAmount | { readonly major: number } };
const invalidNarrowCustomValueType = [
  // @ts-expect-error emitted custom Value Types cover the complete exact field domain.
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
      // @ts-expect-error emitted helper getters expose only declared dependencies.
      void row.status;
      return row.price * row.multiplier;
    },
  }),
] satisfies BrunoTableColumns<Order>;

const invalidCustomComputedDependency = [
  BrunoTableComputedColumn({
    columnId: "COL_ID_AMOUNT_COPY",
    fields: ["amount"],
    headerName: "Amount copy",
    valueType: exactAmountValueType,
    valueGetter: ({ row }) => {
      // @ts-expect-error emitted custom Computed Columns expose only declared dependencies.
      void row.otherAmount;
      return row.amount;
    },
  }),
] satisfies BrunoTableColumns<AmountRow>;

const invalidIncompleteSelectDomain = [
  // @ts-expect-error the rejected Select helper cannot enter the emitted typed column tuple.
  BrunoTableSelectColumn({
    columnId: "COL_ID_STATUS",
    // @ts-expect-error emitted Select options must cover the exact field domain.
    field: "status",
    headerName: "Status",
    options: ["open"],
  }),
] satisfies BrunoTableColumns<Order>;

const invalidCustomNumericOperand = [
  // @ts-expect-error emitted custom numeric Value Types keep their exact operand domain.
  { columnId: "COL_ID_AMOUNT", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<AmountRow, typeof exactAmountColumns>;

const builtInValueType: BrunoTableBuiltInValueType = "bigint";

declare const emittedPriceType: Price;
declare const emittedDoubleQuantityType: DoubleQuantity;
declare const emittedFilterableType: Filterable;
declare const emittedOptedFilterableType: OptedFilterable;
declare const emittedOptedSortableType: OptedSortable;
declare const emittedNoSortableType: NoSortable;
declare const emittedMixedCaseColumnIdRejectedType: MixedCaseColumnIdRejected;
declare const emittedPriceFieldType: PriceField;
declare const emittedCorrelatedSavesType: CorrelatedSaves;
declare const emittedHelperPriceType: HelperPrice;
declare const emittedHelperQuantityType: HelperQuantity;
declare const emittedHelperStatusType: HelperStatus;
declare const emittedHelperWeightedPriceType: HelperWeightedPrice;
declare const emittedExactComputedAmountType: ExactComputedAmount;
declare const emittedComputedPresetOmitsFilteringType: ComputedPresetOmitsFiltering;
declare const emittedComputedPresetOmitsSortingType: ComputedPresetOmitsSorting;
declare const emittedComputedPresetOmitsEditingType: ComputedPresetOmitsEditing;
void emittedPriceType;
void emittedDoubleQuantityType;
void emittedFilterableType;
void emittedOptedFilterableType;
void emittedOptedSortableType;
void emittedNoSortableType;
void emittedMixedCaseColumnIdRejectedType;
void emittedPriceFieldType;
void emittedCorrelatedSavesType;
void emittedHelperPriceType;
void emittedHelperQuantityType;
void emittedHelperStatusType;
void emittedHelperWeightedPriceType;
void emittedExactComputedAmountType;
void emittedComputedPresetOmitsFilteringType;
void emittedComputedPresetOmitsSortingType;
void emittedComputedPresetOmitsEditingType;
void filters;
void props;
void editableProps;
void noSortingProps;
void invalidNoSortingProps;
void widenedEditableProps;
void invalidProps;
void invalidServerEditing;
void invalidEditableGrouping;
void invalidCrossedSaveCell;
void invalidCrossedSaveCellAssignment;
void invalidWidenedSaveCell;
void invalidWidenedSaveCellAssignment;
void invalidEmptySave;
void invalidColumn;
void missingHeaderName;
void invalidFilter;
void invalidOptedOutFilter;
void invalidNumericSensitivity;
void invalidBooleanSensitivity;
void invalidMixedColumnCompoundFilter;
void invalidEmptySort;
void invalidOptedOutSort;
void invalidNoCapabilitySort;
void invalidInitialOrderByWithoutSortingCapability;
void invalidComputedDependency;
void helperColumns;
void exactAmountFilters;
void exactAmountComputedColumns;
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
void builtInValueType;
