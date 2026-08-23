import { Schema } from "effect";
import { ViewServerId, defineViewServerConfig } from "effect-view-server/config";
import { createViewServerReact } from "effect-view-server/react";
import { SourceAdapter } from "effect-view-server/source-adapter";
import type {
  LiveQueryViewportBaseRow,
  LiveQueryViewportCompleteRawSelect,
} from "effect-view-server/react/viewport-base-row";
import {
  BrunoTableBigIntColumn,
  BrunoTableBooleanColumn,
  BrunoTableClient,
  BrunoTableActiveFilterCount,
  BrunoTableActiveSortCount,
  BrunoTableComputedColumn,
  BrunoTableFilterControl,
  BrunoTableLoadedRowCount,
  BrunoTableQuickFilter,
  BrunoTableResultRowCount,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableServer,
  BrunoTableTextColumn,
  BrunoTableToolbar,
  type BrunoTableBuiltInValueType,
  type BrunoTableClientProps,
  type BrunoTableCommonProps,
  type BrunoTableColumnField,
  type BrunoTableColumnId,
  type BrunoTableColumnValue,
  type BrunoTableColumns,
  type BrunoTableDecodeResult,
  type BrunoTableEditingCapability,
  type BrunoTableFilterableColumnId,
  type BrunoTableGridFilterCommandCapability,
  type BrunoTableFilterExpressions,
  type BrunoTablePersistedState,
  type BrunoTableQuickFilterField,
  type BrunoTableQuickFilterFields,
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
const emittedSelectionReservedColumnIdRejected: Expect<
  Equal<BrunoTableColumnId<"COL_ID_BRUNO_TABLE_ROW_SELECTION">, never>
> = true;
void emittedSelectionReservedColumnIdRejected;

type Order = {
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly revision: bigint;
  readonly active: boolean;
  readonly status: "open" | "closed";
  readonly multiplier: number;
  readonly hiddenLabel: string;
};

const emittedServerConfig = defineViewServerConfig({
  topics: {
    orders: {
      schema: Schema.Struct({
        id: ViewServerId,
        symbol: Schema.String,
        price: Schema.Number,
        quantity: Schema.BigInt,
        revision: Schema.BigInt,
        active: Schema.Boolean,
        status: Schema.Literals(["open", "closed"]),
        multiplier: Schema.Number,
        hiddenLabel: Schema.String,
      }),
    },
    positions: {
      schema: Schema.Struct({
        id: ViewServerId,
        symbol: Schema.String,
        price: Schema.Number,
        quantity: Schema.BigInt,
        revision: Schema.BigInt,
        active: Schema.Boolean,
        status: Schema.Literals(["open", "closed"]),
        multiplier: Schema.Number,
        hiddenLabel: Schema.String,
        account: Schema.String,
      }),
    },
  },
});
const emittedServerReact = createViewServerReact(emittedServerConfig);
const source = emittedServerReact.useLiveQueryViewport("orders");
const mismatchedSource = emittedServerReact.useLiveQueryViewport("positions");
const emittedLeasedAdapter = SourceAdapter.make({
  identity: { name: "emitted-bruno-table-route" },
  failure: Schema.Never,
  materialized: undefined,
  leased: {
    metrics: Schema.Struct({ observed: Schema.BigInt }),
    rejectionLocation: Schema.Struct({ offset: Schema.BigInt }),
    definitionOptions: SourceAdapter.definitionOptions<undefined>(),
  },
});
const emittedLeasedSource = createViewServerReact(
  defineViewServerConfig({
    topics: {
      orders: {
        schema: emittedServerConfig.topics.orders.schema,
        source: emittedLeasedAdapter.leasedSource(["status", "revision"], undefined),
      },
    },
  }),
).useLiveQueryViewport("orders");
declare const emittedUnsafeAnyViewport: any;
declare const emittedUnsafeUnknownViewport: unknown;
declare const emittedUnsafeUnwitnessedViewport: Readonly<{ readonly destroy: () => void }>;
declare const emittedUnsafeBroadViewport: Readonly<Record<string, (_row: Order) => Order>>;

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
const emittedRawSelectionReservedColumns = [
  {
    columnId: "COL_ID_BRUNO_TABLE_ROW_SELECTION",
    field: "price",
    headerName: "Selection",
    valueType: "number",
  },
] as const satisfies BrunoTableColumns<Order>;
void BrunoTableClient({
  tableId: "invalid-emitted-selection-reserved-identity",
  // @ts-expect-error Emitted raw columns reject the private Row Selection identity.
  columns: emittedRawSelectionReservedColumns,
  initialOrderBy: [{ columnId: "COL_ID_BRUNO_TABLE_ROW_SELECTION", direction: "asc" }],
  getRowId: (row) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
});
const emittedInvalidSelectionReservedHelperOptions = {
  columnId: "COL_ID_BRUNO_TABLE_ROW_SELECTION",
  field: "price",
  headerName: "Selection",
} as const;
const emittedInvalidSelectionReservedHelperColumn = [
  // @ts-expect-error Emitted helpers reject the private Row Selection identity.
  BrunoTableNumberColumn(emittedInvalidSelectionReservedHelperOptions),
] satisfies BrunoTableColumns<Order>;
void emittedInvalidSelectionReservedHelperColumn;

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

void BrunoTableClient({
  tableId: "invalid-emitted-selection-reserved-initial-order",
  columns,
  // @ts-expect-error Emitted declarations never admit the private Row Selection identity in sorting.
  initialOrderBy: [{ columnId: "COL_ID_BRUNO_TABLE_ROW_SELECTION", direction: "asc" }],
  getRowId: (row) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready",
  },
});

type Columns = typeof columns;

type EmittedViewportBaseRow = Expect<
  Equal<LiveQueryViewportBaseRow<typeof source.viewport>, Order>
>;
const emittedViewportBaseRow: EmittedViewportBaseRow = true;
void emittedViewportBaseRow;
type EmittedCompleteRawSelect = Expect<
  Equal<typeof source.completeRawSelect, LiveQueryViewportCompleteRawSelect<typeof source.viewport>>
>;
const emittedCompleteRawSelect: EmittedCompleteRawSelect = true;
void emittedCompleteRawSelect;

const emittedWitnessedServerProps = {
  tableId: "TABLE_ID_EMITTED_WITNESSED_SERVER",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  viewportSource: source,
} as const satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;
BrunoTableServer(emittedWitnessedServerProps);
BrunoTableServer({
  ...emittedWitnessedServerProps,
  externalFilters: [{ field: "quantity", type: "inRange", filter: 1n, filterTo: 10n }],
});
BrunoTableServer({
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  routeBy: { status: "open", revision: 1n },
});
const emittedAnnotatedLeasedProps: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  routeBy: { status: "open", revision: 1n },
  externalFilters: [{ field: "quantity", type: "inRange", filter: 1n, filterTo: 10n }],
};
void emittedAnnotatedLeasedProps;
// @ts-expect-error emitted Server Props expose exactly Row, Columns, and Viewport generics.
type InvalidEmittedServerRouteOverride = BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport,
  never
>;
const invalidEmittedServerRouteOverride = null as unknown as InvalidEmittedServerRouteOverride;
void invalidEmittedServerRouteOverride;
void BrunoTableServer<
  // @ts-expect-error emitted Server component exposes no Route/Where override generic.
  typeof emittedLeasedSource.viewport,
  Columns,
  typeof emittedAnnotatedLeasedProps,
  never
>;
// @ts-expect-error the emitted direct three-generic leased Props alias requires Feed Route.
const emittedAnnotatedMissingRoute: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = { ...emittedWitnessedServerProps, viewportSource: emittedLeasedSource };
void emittedAnnotatedMissingRoute;
const emittedAnnotatedMissingRouteField: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  // @ts-expect-error emitted direct alias requires every Route field.
  routeBy: { status: "open" },
};
void emittedAnnotatedMissingRouteField;
const emittedAnnotatedExtraRouteField: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  // @ts-expect-error emitted direct alias rejects extra Route fields.
  routeBy: { status: "open", revision: 1n, desk: "rates" },
};
void emittedAnnotatedExtraRouteField;
const emittedAnnotatedWrongRouteValue: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  // @ts-expect-error emitted direct alias preserves exact Route values.
  routeBy: { status: "open", revision: 1 },
};
void emittedAnnotatedWrongRouteValue;
const emittedAnnotatedWrongExternalField: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  routeBy: { status: "open", revision: 1n },
  // @ts-expect-error emitted direct alias rejects unknown External Filter fields.
  externalFilters: [{ field: "missing", type: "equals", filter: "open" }],
};
void emittedAnnotatedWrongExternalField;
const emittedAnnotatedWrongExternalOperand: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  routeBy: { status: "open", revision: 1n },
  // @ts-expect-error emitted direct alias preserves exact operand domains.
  externalFilters: [{ field: "quantity", type: "equals", filter: 1 }],
};
void emittedAnnotatedWrongExternalOperand;
const emittedAnnotatedMixedExternalRange: BrunoTableServerProps<
  Order,
  Columns,
  typeof emittedLeasedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  routeBy: { status: "open", revision: 1n },
  // @ts-expect-error emitted direct alias keeps both bigint range bounds exact.
  externalFilters: [{ field: "quantity", type: "inRange", filter: 1n, filterTo: 10 }],
};
void emittedAnnotatedMixedExternalRange;
const emittedAnnotatedMaterializedRoute: BrunoTableServerProps<
  Order,
  Columns,
  typeof source.viewport
> = {
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted direct source-free alias forbids Feed Route.
  routeBy: { status: "open" },
};
void emittedAnnotatedMaterializedRoute;
// @ts-expect-error emitted leased Server declarations require the exact Route tuple.
BrunoTableServer({ ...emittedWitnessedServerProps, viewportSource: emittedLeasedSource });
BrunoTableServer({
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  // @ts-expect-error emitted leased Server declarations reject missing Route fields.
  routeBy: { status: "open" },
});
BrunoTableServer({
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  // @ts-expect-error emitted leased Server declarations preserve exact Route value domains.
  routeBy: { status: "open", revision: 1 },
});
BrunoTableServer({
  ...emittedWitnessedServerProps,
  viewportSource: emittedLeasedSource,
  // @ts-expect-error emitted leased Server declarations reject extra Route fields.
  routeBy: { status: "open", revision: 1n, desk: "rates" },
});
BrunoTableServer({
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted External Filters reject unknown source fields.
  externalFilters: [{ field: "missing", type: "equals", filter: "open" }],
});
BrunoTableServer({
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted External Filters preserve exact known-field operand domains.
  externalFilters: [{ field: "quantity", type: "equals", filter: 1 }],
});
BrunoTableServer({
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted inRange bounds preserve one exact bigint operand domain.
  externalFilters: [{ field: "quantity", type: "inRange", filter: 1n, filterTo: 10 }],
});

const emittedMismatchedServerProps: BrunoTableServerProps<
  Order,
  Columns,
  typeof mismatchedSource.viewport
> = {
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted Props reject a different invariant base row, including extensions.
  viewportSource: mismatchedSource,
};
void emittedMismatchedServerProps;

const emittedAnySource = { ...source, viewport: emittedUnsafeAnyViewport };
// @ts-expect-error any erases the emitted authoritative viewport base-row witness.
BrunoTableServer({ ...emittedWitnessedServerProps, viewportSource: emittedAnySource });

const emittedUnknownSource = { ...source, viewport: emittedUnsafeUnknownViewport };
// @ts-expect-error unknown erases the emitted authoritative viewport base-row witness.
BrunoTableServer({ ...emittedWitnessedServerProps, viewportSource: emittedUnknownSource });

const emittedUnwitnessedSource = { ...source, viewport: emittedUnsafeUnwitnessedViewport };
// @ts-expect-error unwitnessed shapes cannot establish the emitted Server base row.
BrunoTableServer({ ...emittedWitnessedServerProps, viewportSource: emittedUnwitnessedSource });

const emittedBroadSource = { ...source, viewport: emittedUnsafeBroadViewport };
// @ts-expect-error broad dictionaries cannot impersonate the bundled source-owned witness.
BrunoTableServer({ ...emittedWitnessedServerProps, viewportSource: emittedBroadSource });

const { completeRawSelect: omittedCompleteRawSelect, ...sourceWithoutCompleteRawSelect } = source;
void omittedCompleteRawSelect;
BrunoTableServer({
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted Server Sources require the source-owned complete raw projection.
  viewportSource: sourceWithoutCompleteRawSelect,
});

const { useWholeResult: omittedUseWholeResult, ...sourceWithoutWholeResult } = source;
void omittedUseWholeResult;
BrunoTableServer({
  ...emittedWitnessedServerProps,
  // @ts-expect-error emitted Server Sources require the source-owned whole-result facet hook.
  viewportSource: sourceWithoutWholeResult,
});

source.viewport.replace({
  window: { firstRow: 0, lastRow: 9 },
  query: {
    select: source.completeRawSelect,
    where: [],
    orderBy: [{ field: "symbol", direction: "asc" }],
  },
  sink: {
    setRowCount: () => undefined,
    setRowData: (rows) => {
      type EmittedCompleteRow = Expect<Equal<(typeof rows)[number], Order>>;
      const emittedCompleteRow: EmittedCompleteRow = true;
      void emittedCompleteRow;
    },
  },
});

source.viewport.replace({
  window: { firstRow: 0, lastRow: 9 },
  query: {
    groupBy: ["status"],
    aggregates: { rowCount: { aggFunc: "count" } },
    where: [],
    orderBy: [{ aggregate: "rowCount", direction: "desc" }],
  },
  sink: { setRowCount: () => undefined, setRowData: () => undefined },
});
type EmittedGroupedViewportBaseRow = Expect<
  Equal<LiveQueryViewportBaseRow<typeof source.viewport>, Order>
>;
const emittedGroupedViewportBaseRow: EmittedGroupedViewportBaseRow = true;
void emittedGroupedViewportBaseRow;

const emittedClientProps = {
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  quickFilterFields: ["symbol", "hiddenLabel"],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 1,
    status: "ready" as const,
  },
} satisfies BrunoTableClientProps<Order, Columns>;
const emittedCallableProps: Parameters<typeof BrunoTableClient<Order, Columns>>[0] =
  emittedClientProps;
const emittedNamedProps: BrunoTableClientProps<Order, Columns> = emittedCallableProps;
void BrunoTableClient(emittedNamedProps);
const emittedPersistedState = {
  version: 1,
  tableId: "TABLE_ID_EMITTED_PREFERENCES",
  filters: [],
  orderBy: [{ columnId: "COL_ID_SYMBOL", direction: "desc" }],
  groupBy: [],
  groupOrderBy: [],
  columnOrder: ["COL_ID_PRICE", "COL_ID_SYMBOL", "COL_ID_DOUBLE_QUANTITY"],
  columnVisibility: { COL_ID_SYMBOL: true },
  columnWidths: { COL_ID_PRICE: 222 },
  columnPinning: { start: ["COL_ID_PRICE"], end: [] },
} as const satisfies BrunoTablePersistedState<Order, Columns>;
void emittedPersistedState;
const emittedInvalidPersistedSelectionWidth = {
  ...emittedPersistedState,
  columnWidths: {
    // @ts-expect-error Emitted declarations keep the private Row Selection width out of preferences.
    COL_ID_BRUNO_TABLE_ROW_SELECTION: 40,
  },
} satisfies BrunoTablePersistedState<Order, Columns>;
void emittedInvalidPersistedSelectionWidth;
const emittedInvalidPersistedSelectionGroupOrder = {
  ...emittedPersistedState,
  groupOrderBy: [
    // @ts-expect-error Emitted declarations keep Row Selection out of grouped sorting.
    { columnId: "COL_ID_BRUNO_TABLE_ROW_SELECTION", direction: "asc" },
  ],
} satisfies BrunoTablePersistedState<Order, Columns>;
void emittedInvalidPersistedSelectionGroupOrder;
const emittedPersistedTextSearch = {
  ...emittedPersistedState,
  filters: [
    {
      columnId: "COL_ID_SYMBOL",
      type: "contains",
      codecId: "@bruno/table/text",
      codecVersion: 1,
      filter: "AAPL",
    },
  ],
} as const satisfies BrunoTablePersistedState<Order, Columns>;
void emittedPersistedTextSearch;
const emittedInvalidPersistedTextSearch = {
  ...emittedPersistedTextSearch,
  filters: [
    {
      columnId: "COL_ID_SYMBOL",
      type: "contains",
      codecId: "@bruno/table/text",
      codecVersion: 1,
      // @ts-expect-error Emitted persisted Text searches require raw string operands.
      filter: ["AAPL"],
    },
  ],
} as const satisfies BrunoTablePersistedState<Order, Columns>;
void emittedInvalidPersistedTextSearch;
const emittedInvalidPersistedState = {
  ...emittedPersistedState,
  // @ts-expect-error Emitted persisted identities retain exact tuple autocomplete.
  columnPinning: { start: ["COL_ID_UNKNOWN"], end: [] },
} satisfies BrunoTablePersistedState<Order, Columns>;
void emittedInvalidPersistedState;
const emittedInvalidPersistedFilter = {
  ...emittedPersistedState,
  filters: [
    // @ts-expect-error Emitted persisted filters retain operator-family inference.
    {
      columnId: "COL_ID_PRICE",
      type: "contains",
      codecId: "@bruno/table/number",
      codecVersion: 1,
      filter: { value: "10" },
    },
  ],
} satisfies BrunoTablePersistedState<Order, Columns>;
void emittedInvalidPersistedFilter;
const emittedPersistedProps = {
  ...emittedClientProps,
  initialPersistedState: emittedPersistedState,
  onPersistChange: (state) => {
    const exactState: Expect<Equal<typeof state, BrunoTablePersistedState<Order, Columns>>> = true;
    void exactState;
  },
} satisfies BrunoTableClientProps<Order, Columns>;
void emittedPersistedProps;
const emittedQuickFields = [
  "symbol",
  "hiddenLabel",
] as const satisfies BrunoTableQuickFilterFields<Order>;
type EmittedQuickField = Expect<
  Equal<BrunoTableQuickFilterField<Order>, "id" | "symbol" | "status" | "hiddenLabel">
>;
const emittedQuickFieldCheck: EmittedQuickField = true;
const emittedQuickFilter = BrunoTableQuickFilter;
const emittedResultRowCount = BrunoTableResultRowCount;
const emittedLoadedRowCount = BrunoTableLoadedRowCount;
const emittedActiveFilterCount = BrunoTableActiveFilterCount;
const emittedActiveSortCount = BrunoTableActiveSortCount;
const emittedGridCommands = null as unknown as BrunoTableGridFilterCommandCapability<
  Order,
  typeof columns
>;
emittedGridCommands.clear("COL_ID_SYMBOL");
emittedGridCommands.replace({ columnId: "COL_ID_SYMBOL", type: "contains", filter: "A" });
BrunoTableFilterControl<Order, typeof columns>({
  ownership: "grid",
  children: (commands) => commands.clearAll().toString(),
});
BrunoTableFilterControl({ ownership: "external", children: "Application filter" });
void emittedQuickFieldCheck;
void emittedQuickFields;
void emittedQuickFilter;
void emittedResultRowCount;
void emittedLoadedRowCount;
void emittedActiveFilterCount;
void emittedActiveSortCount;
const emittedInvalidQuickFields = {
  ...emittedClientProps,
  // @ts-expect-error Emitted Quick Filter fields reject numeric source fields.
  quickFilterFields: ["price"],
} satisfies BrunoTableClientProps<Order, Columns>;
void emittedInvalidQuickFields;
const emittedEmptyQuickFields = {
  ...emittedClientProps,
  // @ts-expect-error Emitted Quick Filter fields require a non-empty tuple.
  quickFilterFields: [],
} satisfies BrunoTableClientProps<Order, Columns>;
void emittedEmptyQuickFields;
const emittedMisspelledQuickFields = {
  ...emittedClientProps,
  // @ts-expect-error Emitted Quick Filter fields reject misspelled source fields.
  quickFilterFields: ["descrption"],
} satisfies BrunoTableClientProps<Order, Columns>;
void emittedMisspelledQuickFields;
const emittedColumnIdentityQuickFields = {
  ...emittedClientProps,
  // @ts-expect-error Emitted Quick Filter fields reject Column Identity strings.
  quickFilterFields: ["COL_ID_SYMBOL"],
} satisfies BrunoTableClientProps<Order, Columns>;
void emittedColumnIdentityQuickFields;

const emittedViewServerResult = null as unknown as LiveQueryResult<Order>;
const emittedViewServerClient = BrunoTableClient({
  tableId: "view-server-orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row) => row.id,
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
type ComputedPresetOmitsSetFiltering = Expect<
  Equal<
    "enableSetFilter" extends keyof (typeof emittedComputedPresetColumns)[0] ? true : false,
    false
  >
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

const exactAmountColumns = [
  {
    columnId: "COL_ID_AMOUNT",
    field: "amount",
    headerName: "Amount",
    valueType: exactAmountValueType,
  },
] satisfies BrunoTableColumns<AmountRow>;

const exactEqualityValueType = {
  ...exactAmountValueType,
  filterFamily: "equality",
} satisfies BrunoTableValueType<ExactAmount, "equality", "text">;

const optedInEqualitySetColumns = [
  {
    columnId: "COL_ID_AMOUNT",
    enableSetFilter: true,
    field: "amount",
    headerName: "Amount",
    valueType: exactEqualityValueType,
  },
] satisfies BrunoTableColumns<AmountRow>;

const acceptedEqualitySetFilters = [
  { columnId: "COL_ID_AMOUNT", type: "in", filter: [{ minor: 1n }] },
  { columnId: "COL_ID_AMOUNT", type: "matchNone" },
] satisfies BrunoTableFilterExpressions<AmountRow, typeof optedInEqualitySetColumns>;

void acceptedEqualitySetFilters;

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

const exactBuiltInFilters = [
  { columnId: "COL_ID_QUANTITY", type: "greaterThanOrEqual", filter: 10n },
  { columnId: "COL_ID_ACTIVE", type: "equals", filter: true },
  { columnId: "COL_ID_STATUS", type: "equals", filter: "open" },
] satisfies BrunoTableFilterExpressions<Order, HelperColumns>;

const invalidBigIntFilterOperand = [
  // @ts-expect-error Emitted BigInt filters preserve bigint operands.
  { columnId: "COL_ID_QUANTITY", type: "greaterThan", filter: 10 },
] satisfies BrunoTableFilterExpressions<Order, HelperColumns>;

const invalidBooleanFilterOperand = [
  // @ts-expect-error Emitted Boolean filters preserve boolean operands.
  { columnId: "COL_ID_ACTIVE", type: "equals", filter: "true" },
] satisfies BrunoTableFilterExpressions<Order, HelperColumns>;

const invalidSelectFilterOperand = [
  // @ts-expect-error Emitted Select filters admit only the exact configured value union.
  { columnId: "COL_ID_STATUS", type: "equals", filter: "pending" },
] satisfies BrunoTableFilterExpressions<Order, HelperColumns>;

void exactBuiltInFilters;
void invalidBigIntFilterOperand;
void invalidBooleanFilterOperand;
void invalidSelectFilterOperand;

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
    // @ts-expect-error emitted Client component preserves exact Column Identity inference.
    { columnId: "COL_ID_UNKNOWN", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: emittedViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-misspelled-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted Client component rejects misspelled Column Identities.
    { columnId: "COL_ID_SYMBOOL", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: emittedViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-sort-direction",
  columns,
  initialOrderBy: [
    {
      columnId: "COL_ID_SYMBOL",
      // @ts-expect-error emitted Client component admits only asc and desc directions.
      direction: "ascending",
    },
  ],
  getRowId: (row) => row.id,
  clientSource: emittedViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-computed-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted computed columns have no automatic Client sort mapping.
    { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: emittedViewServerResult,
});
void BrunoTableClient({
  tableId: "invalid-nonsortable-sort",
  columns: capabilityColumns,
  initialOrderBy: [
    // @ts-expect-error emitted Client component excludes explicitly nonsortable identities.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  getRowId: (row) => row.id,
  clientSource: emittedViewServerResult,
});

const emittedSortingTypeTestViewportSource = source;

const invalidEmittedServerUnknownSort = {
  tableId: "invalid-server-unknown-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted Server props preserve exact Column Identity inference.
    { columnId: "COL_ID_UNKNOWN", direction: "asc" },
  ],
  viewportSource: emittedSortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;
void invalidEmittedServerUnknownSort;

const invalidEmittedServerMisspelledSort = {
  tableId: "invalid-server-misspelled-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted Server props reject misspelled Column Identities.
    { columnId: "COL_ID_SYMBOOL", direction: "asc" },
  ],
  viewportSource: emittedSortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;
void invalidEmittedServerMisspelledSort;

const invalidEmittedServerComputedSort = {
  tableId: "invalid-server-computed-sort",
  columns,
  initialOrderBy: [
    // @ts-expect-error emitted computed columns have no automatic Server sort mapping.
    { columnId: "COL_ID_DOUBLE_QUANTITY", direction: "asc" },
  ],
  viewportSource: emittedSortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;
void invalidEmittedServerComputedSort;

const invalidEmittedServerNonsortableSort = {
  tableId: "invalid-server-nonsortable-sort",
  columns: capabilityColumns,
  initialOrderBy: [
    // @ts-expect-error emitted Server props exclude explicitly nonsortable identities.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  viewportSource: emittedSortingTypeTestViewportSource,
} satisfies BrunoTableServerProps<Order, CapabilityColumns, typeof source.viewport>;
void invalidEmittedServerNonsortableSort;

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

const props = {
  tableId: "orders",
  columns,
  initialFilters: filters,
  initialOrderBy: [
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ] satisfies BrunoTableSortBy<Columns>,
  children: BrunoTableFilterControl({
    ownership: "external",
    children: "Application-controlled filter",
  }),
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;

const emittedServerWithExternalFilters = {
  ...props,
  externalFilters: [{ field: "status", type: "equals", filter: "open" }],
} as const satisfies BrunoTableServerProps<Order, Columns, typeof source.viewport>;
void emittedServerWithExternalFilters;

type UnsupportedToolbarCountsStayAbsent = Expect<
  Equal<
    Extract<
      | "BrunoTableSelectedRowCount"
      | "BrunoTableDirtyCellCount"
      | "BrunoTableValidationCount"
      | "BrunoTableConflictCount",
      keyof typeof import("@bruno/table")
    >,
    never
  >
>;
const unsupportedToolbarCountsStayAbsent: UnsupportedToolbarCountsStayAbsent = true;
void unsupportedToolbarCountsStayAbsent;

const emittedServerWithoutInitialOrderBy = {
  tableId: "orders-without-order",
  columns,
  viewportSource: source,
} as const;

// @ts-expect-error emitted Server props always require a typed non-empty Initial Order By.
const invalidEmittedServerWithoutInitialOrderBy: BrunoTableServerProps<
  Order,
  Columns,
  typeof source.viewport
> = emittedServerWithoutInitialOrderBy;
void invalidEmittedServerWithoutInitialOrderBy;

// @ts-expect-error emitted Common props always require a typed non-empty Initial Order By.
const invalidEmittedCommonWithoutInitialOrderBy: BrunoTableCommonProps<Order, Columns> = {
  tableId: "orders-without-order",
  columns,
};
void invalidEmittedCommonWithoutInitialOrderBy;

const invalidEmittedServerWithoutSortingCapability = {
  tableId: "unsortable-server",
  columns: noSortingColumns,
  initialOrderBy: [
    // @ts-expect-error emitted Server props reject definitions without a sortable Column Identity.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
  viewportSource: source,
} satisfies BrunoTableServerProps<Order, NoSortingColumns, typeof source.viewport>;
void invalidEmittedServerWithoutSortingCapability;

const invalidEmittedCommonWithoutSortingCapability = {
  tableId: "unsortable-common",
  columns: noSortingColumns,
  initialOrderBy: [
    // @ts-expect-error emitted Common props reject definitions without a sortable Column Identity.
    { columnId: "COL_ID_SYMBOL", direction: "asc" },
  ],
} satisfies BrunoTableCommonProps<Order, NoSortingColumns>;
void invalidEmittedCommonWithoutSortingCapability;

const emittedClient = BrunoTableClient({
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
    totalRows: 0,
    version: 0,
    status: "ready",
  },
});
void emittedClient;

void BrunoTableClient({
  tableId: "private-runtime",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client API exposes no table controller.
  table: {},
});
void BrunoTableClient({
  tableId: "orders-no-external-filters",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client declarations reject Server-only External Filters.
  externalFilters: [{ field: "status", type: "equals", filter: "open" }],
});
void BrunoTableClient({
  tableId: "private-row-model",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
  // @ts-expect-error emitted Client API exposes no TanStack row-model factory.
  getCoreRowModel: () => ({}),
});

// @ts-expect-error emitted Client component requires tableId.
void BrunoTableClient({
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
});
// @ts-expect-error emitted Client component requires columns.
void BrunoTableClient({
  tableId: "orders",
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
});
// @ts-expect-error emitted Client component requires getRowId.
void BrunoTableClient({
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
});
// @ts-expect-error emitted Client component requires clientSource.
void BrunoTableClient({
  tableId: "orders",
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
});
// @ts-expect-error emitted Client component requires initialOrderBy.
void BrunoTableClient({
  tableId: "orders",
  columns,
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
});
void BrunoTableClient({
  tableId: "orders",
  columns,
  // @ts-expect-error emitted Client component rejects an empty initialOrderBy.
  initialOrderBy: [],
  getRowId: (row: Order) => row.id,
  clientSource: { rows: [] as readonly Order[], totalRows: 0, version: 0, status: "ready" },
});
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
    rows: [] as readonly Order[],
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
    rows: [] as readonly Order[],
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
    rows: [] as readonly Order[],
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

const acceptedBooleanSetFilters = [
  { columnId: "COL_ID_ENABLED", type: "in", filter: [true] },
  { columnId: "COL_ID_ENABLED", type: "matchNone" },
] satisfies BrunoTableFilterExpressions<FeatureFlag, typeof featureFlagColumns>;

const optedOutBooleanSetFilterColumns = [
  {
    columnId: "COL_ID_ENABLED",
    enableSetFilter: false,
    field: "enabled",
    headerName: "Enabled",
    valueType: "boolean",
  },
] satisfies BrunoTableColumns<FeatureFlag>;

const acceptedOptedOutBooleanInFilter = [
  { columnId: "COL_ID_ENABLED", type: "in", filter: [true] },
] satisfies BrunoTableFilterExpressions<FeatureFlag, typeof optedOutBooleanSetFilterColumns>;

const invalidOptedOutBooleanMatchNone = [
  // @ts-expect-error emitted Match None remains gated by the Set Filter surface.
  { columnId: "COL_ID_ENABLED", type: "matchNone" },
] satisfies BrunoTableFilterExpressions<FeatureFlag, typeof optedOutBooleanSetFilterColumns>;

void acceptedOptedOutBooleanInFilter;
void invalidOptedOutBooleanMatchNone;

const acceptedSelectSetFilters = [
  { columnId: "COL_ID_STATUS", type: "in", filter: ["open"] },
  { columnId: "COL_ID_STATUS", type: "matchNone" },
] satisfies BrunoTableFilterExpressions<Order, HelperColumns>;

const invalidDefaultTextMatchNone = [
  // @ts-expect-error emitted Text Set Filters require explicit opt-in.
  { columnId: "COL_ID_SYMBOL", type: "matchNone" },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const invalidSetFilterCapability = [
  {
    columnId: "COL_ID_SYMBOL",
    enableFilter: false,
    // @ts-expect-error emitted declarations reject Set Filter when filtering is disabled.
    enableSetFilter: true,
    field: "symbol",
    headerName: "Symbol",
    valueType: "text",
  },
] satisfies BrunoTableColumns<Order>;

const invalidEmptyInFilter = [
  // @ts-expect-error emitted declarations require non-empty `in` operands.
  { columnId: "COL_ID_SYMBOL", type: "in", filter: [] },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const acceptedTextInFilter = [
  { columnId: "COL_ID_SYMBOL", type: "in", filter: ["AAPL"] },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

const acceptedNumericInFilter = [
  { columnId: "COL_ID_PRICE", type: "in", filter: [10] },
] satisfies BrunoTableFilterExpressions<Order, Columns>;

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
  // @ts-expect-error every emitted table requires a sortable Column Identity for Initial Order By.
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<NoSortingColumns>;

const invalidInitialOrderByWithoutSortingCapability = {
  tableId: "unsortable-orders",
  columns: noSortingColumns,
  // @ts-expect-error no mandatory Initial Order By can exist without a sortable Column Identity.
  initialOrderBy: [{ columnId: "COL_ID_SYMBOL", direction: "asc" }],
  getRowId: (row: Order) => row.id,
  clientSource: {
    rows: [] as readonly Order[],
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

void (0 as unknown as Price);
void (0 as unknown as DoubleQuantity);
void (0 as unknown as Filterable);
void (0 as unknown as OptedFilterable);
void (0 as unknown as OptedSortable);
void (0 as unknown as NoSortable);
void (0 as unknown as MixedCaseColumnIdRejected);
void (0 as unknown as PriceField);
void (0 as unknown as CorrelatedSaves);
void (0 as unknown as HelperPrice);
void (0 as unknown as HelperQuantity);
void (0 as unknown as HelperStatus);
void (0 as unknown as HelperWeightedPrice);
void (0 as unknown as ExactComputedAmount);
void (0 as unknown as ComputedPresetOmitsFiltering);
void (0 as unknown as ComputedPresetOmitsSetFiltering);
void (0 as unknown as ComputedPresetOmitsSorting);
void (0 as unknown as ComputedPresetOmitsEditing);
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
void invalidEmptyInFilter;
void acceptedTextInFilter;
void acceptedNumericInFilter;
void acceptedBooleanSetFilters;
void acceptedSelectSetFilters;
void invalidDefaultTextMatchNone;
void invalidSetFilterCapability;
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
