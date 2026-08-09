# Public TypeScript interface

## Status

This document is the canonical public-interface direction. It replaces the earlier `defineGrid`, `createColumnHelper`, `definition`, `rowModel`, and single-mode `BrunoTable` shapes.

The consumer interface should feel like AG Grid: declare one typed column array, obtain rows or a Viewport Source, and render the explicit table variant. BrunoTable hides TanStack Table, virtualization, stores, and query translation behind two small interfaces.

The public server composition root is named `BrunoTableServer`. `Viewport` remains precise internal row-model and effect-view-server transport vocabulary, but it is not the BrunoTable component brand.

## Design goals

The public interface must preserve inference across:

- topic and row types
- row and column identity
- field and computed values
- filters and sorts
- editors, parsers, and validators
- edits and conflicts
- client and viewport row sources

Consumers must not repeat generic parameters, construct an intermediate grid definition, or understand TanStack Table state to render a table.

## TypeScript strictness contract

BrunoTable is strict by construction. Compiler configuration alone is insufficient; the public interface must make invalid table configurations unrepresentable wherever TypeScript can prove them.

Required compiler checks include `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, and declaration generation.

Public type rules:

- no `any` in exported types, generic defaults, callback parameters, or inference paths
- no broad `string` where Column Identity, field names, operators, statuses, or capability IDs are known
- do not erase heterogeneous column value types into `unknown`
- preserve literal column tuples through `satisfies BrunoTableColumns<TRow>`
- use discriminated unions and correlated mapped unions for edits, conflicts, commands, and capability-specific state
- model mutually exclusive definitions and component sources as mutually exclusive types
- use `unknown` only at real untrusted or plugin seams, then decode or narrow before values reach typed callbacks
- never require consumer casts to make an ordinary valid table compile

Type tests are part of the interface test surface. Every accepted inference guarantee needs a positive assertion, and every rejected configuration needs a negative assertion. Emitted declarations must also be tested from a consumer fixture so implementation-only inference does not hide a broken package interface.

## Public export naming

Every BrunoTable-owned public export carries the `BrunoTable` brand. Exported types, components, classes, helpers, and constants use the `BrunoTable...` form. Separate packages preserve their own vocabulary; in particular, `@bruno/shadcn/button` exports the canonical shadcn `Button` rather than a `BrunoTableButton` wrapper.

Examples:

- `BrunoTableColumnId`, never `BrunoColumnId` or `ColumnId`
- `BrunoTableRegion`, never `GridRegion`
- `BrunoTableSortBy`, never `GridSorting`
- `BrunoTableCellChange`, never `CellChange`

Concise names may be used inside deep internal modules, but they must remain internal. If an internal symbol becomes public, rename it before exporting it. Add an export-surface type test so an unprefixed package-owned symbol cannot slip into the published entry point.

## Shared columns

```tsx
import {
  BrunoTableBigIntColumn,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableTextColumn,
  type BrunoTableColumns,
} from "@bruno/table";
import type { TopicRow } from "effect-view-server/config";

type Order = TopicRow<typeof viewServer.topics, "orders">;

const columns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  BrunoTableNumberColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    isEditable: ({ row }) => row.status === "open",
    valueFormatter: ({ value }) => value.toFixed(2),
  }),
  BrunoTableBigIntColumn({
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    isEditable: ({ row }) => row.status === "open",
  }),
  BrunoTableSelectColumn({
    columnId: "COL_ID_STATUS",
    field: "status",
    headerName: "Status",
    options: ["open", "closed"],
    isEditable: ({ row }) => row.status === "open",
  }),
  BrunoTableBigIntColumn({
    columnId: "COL_ID_DOUBLE_QUANTITY",
    headerName: "Double quantity",
    fields: ["quantity"],
    valueGetter: ({ row }) => row.quantity * 2n,
  }),
] satisfies BrunoTableColumns<Order>;

const getOrderRowId = (row: Order) => row.id;
```

The same `columns` are accepted by both public variants. `getOrderRowId` belongs only to `BrunoTableClient`; `BrunoTableServer` receives authoritative identity from its Viewport Source.

Static columns, Column Helpers, and Column Presets should normally live at module scope. Consumers should not need `useMemo` or a `defineGrid` call. Helpers are optional constructors for ordinary column definitions, not a prerequisite for using BrunoTable.

## Canonical client usage

The caller can obtain the complete row collection with effect-view-server's `useLiveQuery` and pass the complete result to the client table. Filtering and sorting initiated by the grid remain local:

```tsx
export function OrdersClientTable() {
  const orders = useLiveQuery("orders", {
    select: ["id", "revision", "symbol", "price", "quantity", "status"],
    where: [],
    orderBy: [],
  });

  return (
    <BrunoTableClient
      tableId="orders"
      getRowId={getOrderRowId}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
      quickFilterFields={["symbol", "status"]}
      clientSource={orders}
    />
  );
}
```

Do not add `limit` or `offset` to this query. A Client Source must contain the complete working set so local filtering, sorting, selection, and clipboard operations remain honest.

`useLiveQuery` is an integration choice made outside BrunoTable. The grid accepts a structural Client Source rather than importing Effect or the concrete `LiveQueryResult` type. Other query libraries and static-data Adapters can provide the same small shape.

## Canonical viewport usage

The caller obtains the long-lived source with `useLiveQueryViewport`. The viewport table owns query replacement and sparse range delivery through that source:

```tsx
export function OrdersServerTable() {
  const viewportSource = useLiveQueryViewport("orders");

  return (
    <BrunoTableServer
      tableId="orders"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
      quickFilterFields={["symbol", "status"]}
      viewportSource={viewportSource}
    />
  );
}
```

Each component must infer `Order`, the exact column IDs, field value types, filterable columns, and sortable columns from its `columns` and row source. `BrunoTableClient` additionally infers editable columns when its editing capability is enabled. `BrunoTableServer` may reuse those same definitions but ignores their editing declarations.

## Explicit public variants

The base properties and explicit source variants have this conceptual shape. The strict editing capability is defined below and intersects only the Client variant:

```ts
type BrunoTableSortingCapability<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = [BrunoTableSortableColumnId<TColumns>] extends [never]
  ? { initialOrderBy?: never }
  : { initialOrderBy: BrunoTableSortBy<TColumns> };

type BrunoTableClientSortingCapability<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = { initialOrderBy: BrunoTableSortBy<TColumns> };

type BrunoTablePersistedSortingCapability<
  TColumns extends readonly { readonly columnId: BrunoTableColumnId }[],
> = [BrunoTableSortableColumnId<TColumns>] extends [never]
  ? { orderBy?: never }
  : { orderBy: BrunoTableSortBy<TColumns> };

type BrunoTableBaseProps<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  tableId: string;
  columns: TColumns;
  initialFilters?: BrunoTableFilterExpressions<TRow, TColumns>;
  quickFilterFields?: BrunoTableQuickFilterFields<TRow>;
  initialPersistedState?: BrunoTablePersistedState<TRow, TColumns>;
  onPersistChange?: (state: BrunoTablePersistedState<TRow, TColumns>) => void;
  children?: React.ReactNode;
};

type BrunoTableQuickFilterFields<TRow> = readonly [
  BrunoTableStringQueryField<TRow>,
  ...BrunoTableStringQueryField<TRow>[],
];

type BrunoTableExternalFilters<TRow> = readonly BrunoTableExternalFilterExpression<TRow>[];

type BrunoTableGroupingCapability<TColumns> = {
  groupRowsColumn?: BrunoTableGroupRowsColumnOptions<TColumns>;
};

type BrunoTableNoGroupingCapability = {
  groupRowsColumn?: never;
};

type BrunoTablePersistedState<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly version: number;
  readonly tableId: string;
  readonly filters: BrunoTablePersistedFilterExpressions<TRow, TColumns>;
  readonly groupOrderBy?: BrunoTableGroupSortBy<TColumns>;
  readonly groupBy: readonly BrunoTableGroupableColumnId<TColumns>[];
  readonly columnOrder: readonly BrunoTableColumnIdOf<TColumns>[];
  readonly columnVisibility: Readonly<Partial<Record<BrunoTableColumnIdOf<TColumns>, boolean>>>;
  readonly columnWidths: Readonly<
    Partial<Record<BrunoTableColumnIdOf<TColumns> | BrunoTableRowsColumnId, number>>
  >;
  readonly columnPinning: BrunoTablePersistedColumnPinning<TColumns>;
} & BrunoTablePersistedSortingCapability<TColumns>;

type BrunoTableClientProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion = never,
> = BrunoTableBaseProps<TRow, TColumns> &
  BrunoTableClientSortingCapability<TColumns> &
  BrunoTableEditingCapability<TRow, TColumns, TRowVersion> & {
    getRowId: (row: TRow) => BrunoTableRowId;
    clientSource: BrunoTableClientSource<TRow>;
    externalFilters?: never;
  };

type BrunoTableServerProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TViewport = unknown,
> = BrunoTableBaseProps<TRow, TColumns> &
  BrunoTableSortingCapability<TColumns> &
  BrunoTableGroupingCapability<TColumns> & {
    getRowId?: never;
    viewportSource: BrunoTableServerSource<TViewport>;
    externalFilters?: BrunoTableExternalFilters<TRow>;
    editable?: never;
    getRowVersion?: never;
    onSaveEdits?: never;
  };

type BrunoTableSourceStatus = "loading" | "ready" | "stale" | "closed" | "error";

type BrunoTableSourceRetry = {
  readonly run: () => void;
  readonly pending: boolean;
};

type BrunoTableSourceChrome = {
  readonly totalRows: number;
  readonly version: number;
  readonly status: BrunoTableSourceStatus;
  readonly statusCode?: string | undefined;
  readonly message?: string | undefined;
  readonly retry?: BrunoTableSourceRetry | undefined;
};

type BrunoTableClientSource<TRow> = BrunoTableSourceChrome & {
  readonly rows: readonly TRow[];
};

type BrunoTableServerSource<TViewport = unknown> = BrunoTableSourceChrome & {
  readonly viewport: TViewport;
};
```

Expose `BrunoTableClient` and `BrunoTableServer`. Do not expose one component with `mode`, `serverSide`, or a union containing both `clientSource` and `viewportSource`. The variants are explicit composition roots with no impossible source combinations.

Rules:

- `tableId` is mandatory and namespaces persistence and diagnostics.
- `getRowId` is mandatory only for `BrunoTableClient`, where it identifies ordinary `TRow` records. Read-only Client flat grouped-summary rows use private Adapter-owned identity and never invoke this callback. `BrunoTableServer` rejects the prop and receives authoritative raw and grouped row keys from its Viewport Source. Row indexes are never identities.
- `columns` is a stable typed array.
- `initialFilters` is an optional one-time baseline for internally owned Grid Filter state. Valid restored user preferences take precedence. Later prop changes never overwrite user changes; Clear removes all Grid Filters, while Reset returns to this baseline.
- Issue #7's first live `BrunoTableClient` uses `BrunoTableClientSortingCapability`: `initialOrderBy` is always a mandatory non-empty Column Identity-keyed baseline, so a sort-free Client definition is rejected. The broader common and Server design retains `BrunoTableSortingCapability`; there, no sortable identity means `initialOrderBy` and persisted normal `orderBy` are forbidden and no normal sorting state, persistence, command, or UI is installed. A valid non-empty restored `orderBy` takes precedence; later prop changes never overwrite user sorting, and Reset returns to the baseline. An empty, fully invalid, or stale restored order falls back to `initialOrderBy`, so a sorting-capable normal table is never unsorted. Grouped summaries use the separate persisted `groupOrderBy` context described below; grouping never overwrites a normal baseline or current order when that capability exists.
- `quickFilterFields` is an optional explicit non-empty tuple of string-valued Query Fields. BrunoTable never infers it from visible columns or accepts Column Identities in its place. Omitting it means the table has no Quick Filter capability.
- `initialPersistedState` is an optional one-time, versioned, JSON-safe snapshot obtained by the application. BrunoTable sanitizes it against `tableId`, current columns, capabilities, and codecs before the table becomes interactive. It is not a controlled prop; later prop changes do not overwrite user state.
- `onPersistChange` receives the complete current JSON-safe snapshot after each committed Grid Filter, sort, Group By add/remove/reorder, column-order, visibility, width, or pinning change. It does not fire for Quick Filter, External Filters, Feed Route, selection, scroll, or edit state, and it does not echo initial restoration. BrunoTable neither awaits the callback nor interprets its return value; publishing, retries, failure handling, Kafka, View Server, and every other storage concern belong to the application.
- `clientSource` is one coherent rows-and-lifecycle value; do not spread its fields into individual table props.
- Client and Viewport Sources expose the same lifecycle chrome. The shared view owns loading, stale, closed, and error presentation; the row-pipeline Adapters own only their different payloads and lifecycles.
- `retry` is an optional source-owned manual recovery capability. Its `run` callback begins one source recovery attempt, while its `pending` flag is the sole authority for disabling and decorating the control. BrunoTable calls `run` once per explicit activation but never awaits it, interprets its result, changes source status optimistically, schedules another attempt, or reuses this capability for Save Operations. A plain effect-view-server hook result remains directly assignable because the capability is optional; an application that can reconnect may add it at its source-Adapter boundary without making Effect part of BrunoTable's public contract.
- A ready or stale Client Source is complete only when `rows.length === totalRows`. Treat a mismatch as a configuration error rather than silently applying supposedly global operations to a partial collection.
- Preserve unchanged row references between source versions and replace only changed rows.
- Every `loading` publication renders fixed-height `Skeleton` rows from `@bruno/shadcn/skeleton` so virtual geometry remains stable, even when it contains a complete candidate row array. Loading candidates never become coherent display evidence; the Client Adapter may retain only previously accepted coherent evidence privately for a later stale, closed, or error publication. Loading does not render a fake Retry action.
- `stale` retains every coherent row, including a valid empty result, and adds one compact non-dismissible warning `Alert` titled `Live data delayed`. It never offers Retry because the source remains live and may recover itself.
- `closed` retains coherent rows with a compact non-dismissible warning `Alert` titled `Live updates stopped`; without rows it uses a full-body `Empty` state with the same title.
- `error` retains coherent rows with a compact non-dismissible destructive `Alert` titled `Live data error`; without rows it uses a full-body destructive `Empty` state. `statusCode` and bounded plain-text `message` may appear as supporting diagnostics, never as markup.
- Closed and error presentation includes a `Button` titled `Retry` only while `retry` exists. The button is disabled while `retry.pending` is true and then includes the shared `Spinner`. Recovery removes the presentation only when a later source snapshot says so; the lifecycle chrome is not dismissible and a click never fabricates a `loading` or `ready` state. Source-level Retry is unrelated to the edit Save Workflow, whose notifications continue to expose no Retry action.
- Lifecycle components subscribe only to the compact source chrome they render, not row contents. They use appropriate status/alert semantics, preserve focus across source publications, and never replace the Grid Runtime or force unrelated mounted cells to rerender.
- `viewportSource` is a long-lived source, not a row array copied into React state.
- A semantic Server query change—Feed Route, projection, filters, sorting, Group By, or aggregates—creates a clean private Query Generation. Old rows and `totalRows` are never shown under the new semantics; fixed-height loading rows cover the required viewport until authoritative delivery. Window-only movement retains overlapping slots, and lifecycle retention is permitted only for coherent rows from the same generation. No generation or loading-policy prop enters the public API.
- `externalFilters` is an optional Server-only application-controlled field-keyed expression. It uses the same value-aware operator vocabulary as View Server `where`, may reference valid fields without visible columns, and is always `AND`-combined with Quick Filter and Grid Filters. It is reactive but never persisted, counted, reviewed, reset, or cleared by BrunoTable. Client Tables reject the prop because their complete `clientSource` already defines the caller's working set.
- `BrunoTableServer` exposes no Row Selection or Cell Range Selection interface: no checkbox column, selected-row callback/state, Shift-click row selection, row Select All, or range operation. Its only cell cursor is the private logical Active Cell used by navigation and single-loaded-cell copy. This prohibition does not apply to checkbox options or value-level Select All inside a Set Filter overlay; those controls select filter values and never rows.
- `BrunoTableClient` Cell Range Selection is permanently limited to zero or one contiguous Linear Cell Range: horizontal `1×N` or vertical `N×1`. No prop, callback, command, or state shape can represent a two-axis target, additive ranges, subtractive holes, or disconnected regions; a new selection replaces the previous range.
- A Client range retains the exact ordered Row and Column Identity span selected by the user across value-only publications. Sorting, filtering, live membership/order, visibility, and column-order changes preserve it only when both endpoints and the complete intervening identity sequence remain equal; otherwise the private runtime clears it before Copy. Changes outside the span do not disturb it, and no range state or reconciliation callback enters the public API.
- Every accepted Copy command uses one internally consistent immutable Clipboard Snapshot. Live updates continue normally but cannot mix versions inside the copied payload; snapshot capture, serialization, and browser clipboard handling remain private and add no consumer callback or controller.
- Both variants expose one continuous virtual row space. Do not add pagination, page-index, page-size, cursor, fetch-next-page, or load-more props.
- Internal server windows may compile to `offset` and `limit`, but those values never enter the public interface or persisted grid state.
- Optional children render inside the grid provider as page-specific toolbar content. When absent, no toolbar region is mounted.
- Client Row Selection is an explicit opt-in capability for ordinary ungrouped source rows and defaults off. Its enabled header checkbox addresses the complete currently filtered Client row model, never only mounted rows. Stable selected Row Identities survive being filtered out, while header-checkbox state reflects only the current filtered set. Select All snapshots the matching identities at that gesture; later inserts are not auto-selected and deleted rows are pruned. Activating the first Group By key atomically clears selected identities and the Shift anchor, then suppresses every row-selection surface until grouping clears. The capability returns empty rather than reviving a hidden selection. The Server interface exposes no corresponding capability.
- A read-only Client keeps one-axis Cell Range Selection while grouped because its complete grouped result is resident. Every Group By add, remove, or reorder cancels an active range gesture and clears the previous range before the logical shape changes; the user may then select and copy a fresh horizontal or vertical grouped range. Group Key, Aggregate, and Rows cells use their compiled clipboard exchange semantics rather than display formatting. Grouped ranges are read-only and cannot paste, fill, or edit. Server Tables still expose only Active-Cell copy.
- Every Group By add, remove, or reorder resets the private logical Active Cell after the new projection is derived. A non-empty grouped projection starts at row zero and its first active group-key column; returning to ordinary rows starts at row zero and the first visible navigable column in restored Logical Column Order. An empty result has no Active Cell. BrunoTable never asks consumers for raw-to-group focus mapping, and the reset does not move DOM focus away from the Group By control that initiated the command.
- With the Group By tuple unchanged, a live grouped update follows a surviving private Group Row Identity to its new index without auto-reveal. If that identity disappears, navigation uses the row at the previous display index, clamped to the new final row, and preserves its column when valid; only an empty result clears Active Cell. The sparse Server Adapter may target a loading slot and exposes no consumer reconciliation callback.
- Do not replace children composition with page-specific boolean props or expose TanStack state to custom toolbar components.

Persistence is callback-based rather than storage-adapter based:

```tsx
<BrunoTableServer
  tableId="orders"
  columns={columns}
  viewportSource={viewportSource}
  initialPersistedState={savedPreferences}
  onPersistChange={(nextPreferences) => {
    publishPreferences(nextPreferences);
  }}
/>
```

The application may obtain `savedPreferences` from Kafka through View Server, an HTTP request, a database, SSR, or any other mechanism. If loading is asynchronous, it should finish loading before mounting the Table Instance. Because the snapshot is JSON-safe, an SSR application may pass it directly into the first server render and hydrate with the identical value. BrunoTable performs no browser-storage read, does not reapply the snapshot after hydration, and does not emit `onPersistChange` merely because the server-rendered Table Instance hydrated. BrunoTable emits a full replacement document rather than a delta so compacted logs and ordinary key-value stores can retain one authoritative value per application-defined user/table key. Multiple mutations committed as one grid command emit one snapshot, and high-frequency pointer frames never call `onPersistChange`; column resize and reorder publish only when the gesture commits.

## Optional toolbar composition

The toolbar composition seam works with both public variants, while edit controls require the Client editing capability:

```tsx
<BrunoTableClient {...tableProps}>
  <BrunoTableToolbar>
    <PageSpecificFilters />
    <BrunoTableQuickFilter />
    <BrunoTableToolbarSpacer />
    <BrunoTableEditActions />
  </BrunoTableToolbar>
</BrunoTableClient>
```

Names beginning with `PageSpecific...` are illustrative consumer components, not BrunoTable requirements. Library-owned exported components retain the `BrunoTable...` brand.

The toolbar is a composition seam, not a broad controller seam. Built-in toolbar controls access narrow private Grid Runtime selectors. A page-specific component should receive page-owned state through its ordinary props. A custom control that needs to change Grid Filter state uses a focused typed BrunoTable command/control surface rather than taking ownership through React-controlled filter props, receiving a public TanStack table, or using an untyped imperative handle.

Controls that only dispatch user intent have no grid-state subscription. `BrunoTableQuickFilter`, for example, keeps transient input text locally and dispatches through a stable command capability. It observes only the committed Quick Filter primitive when an external reset must be reflected; streaming row-content changes are outside its notification domain.

Distinguish filter ownership explicitly:

- Grid Filter Expressions are user grid intent, appear in global active-filter UI, and participate in preference persistence.
- Quick Filter is user grid intent and appears in global active-filter UI, but its field configuration and committed text are session-only and never persisted or included in saved views.
- External Filters define an application-controlled Server working-set condition before Grid Filters, are supplied through `externalFilters`, and are not persisted, counted, reviewed, reset, or cleared as grid preferences.
- Toolbar placement alone changes neither ownership nor persistence.

For effect-view-server leased topics, keep Feed Route ownership separate from both categories above. The source declaration owns the exact non-empty Route Field tuple. `BrunoTableServer` receives only the current exact `routeBy` value object, inferred conditionally from `viewportSource`: leased sources require all and only their declared fields, while materialized and source-free sources forbid the prop. Do not expose a duplicated `routeByFields` list.

The View Server Adapter snapshots `routeBy` with exact source semantics and carries it unchanged into every `viewport.replace(...)` query. It never derives route values from columns, Grid Filters, Set Filters, External Filters, or loaded rows. Route Fields need not be projected or represented by visible columns. A meaningful route change replaces the complete sparse logical row space but does not alter or persist compatible user grid preferences.

## Strict editable capability

Only `BrunoTableClient` accepts the discriminated editing capability, shaped conceptually as:

```ts
type BrunoTableSaveCellChange<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly [TColumnId in BrunoTableEditableColumnId<TColumns>]: {
    readonly columnId: TColumnId;
    readonly field: BrunoTableColumnField<TColumns, TColumnId>;
    readonly before: BrunoTableColumnValue<TRow, TColumns, TColumnId>;
    readonly after: BrunoTableColumnValue<TRow, TColumns, TColumnId>;
  };
}[BrunoTableEditableColumnId<TColumns>];

type BrunoTableSaveCellChangeSet<TRow, TColumns extends BrunoTableColumns<TRow>> = readonly [
  BrunoTableSaveCellChange<TRow, TColumns>,
  ...BrunoTableSaveCellChange<TRow, TColumns>[],
];

type BrunoTableSaveRowChange<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> = {
  readonly rowId: BrunoTableRowId;
  readonly baseRow: TRow;
  readonly expectedVersion: TRowVersion;
  readonly changes: BrunoTableSaveCellChangeSet<TRow, TColumns>;
};

type BrunoTableSaveChangeSet<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> = readonly [
  BrunoTableSaveRowChange<TRow, TColumns, TRowVersion>,
  ...BrunoTableSaveRowChange<TRow, TColumns, TRowVersion>[],
];

type BrunoTableSaveEditsHandler<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> = (
  changes: BrunoTableSaveChangeSet<TRow, TColumns, TRowVersion>,
) => PromiseLike<void>;

type BrunoTableReadOnlyCapability<TColumns> = BrunoTableGroupingCapability<TColumns> & {
  editable?: false;
  getRowVersion?: never;
  onSaveEdits?: never;
};

type BrunoTableEditableCapability<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> =
  BrunoTableEditableColumnId<TColumns> extends never
    ? never
    : BrunoTableNoGroupingCapability & {
        editable: true;
        getRowVersion: (row: TRow) => TRowVersion;
        onSaveEdits: BrunoTableSaveEditsHandler<TRow, TColumns, TRowVersion>;
      };

type BrunoTableEditingCapability<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> =
  | BrunoTableReadOnlyCapability<TColumns>
  | BrunoTableEditableCapability<TRow, TColumns, TRowVersion>;
```

The shape above is the editing-capable end state. Issue #7's first live read-only slice exports
`BrunoTableClientProps<TRow, TColumns>` as the exact props accepted by the current
`BrunoTableClient` component: `editable` may be false or omitted, while `getRowVersion` and
`onSaveEdits` are rejected. The component and named props alias expand together only when the
editing workflow is implemented.

`editable` is a capability discriminant, not a styling toggle: TypeScript makes `getRowVersion` and `onSaveEdits` mandatory when true and rejects both otherwise. It also rejects `groupRowsColumn` on the editable branch. The return type of `getRowVersion` is inferred without a repeated JSX generic and becomes the exact `expectedVersion` type throughout the Save Workflow. Exact literal columns that contain no potentially editable Column Identity make the editable branch `never`; widened runtime inputs receive the corresponding runtime diagnostic. This avoids impossible half-configured Client states while allowing the same columns to be reused by a read-only Client or Server Table. `BrunoTableServerProps` makes `editable`, `getRowVersion`, and `onSaveEdits` `never` so Viewport editing cannot be enabled accidentally.

Grouping and editing are mutually exclusive Table Instance capabilities. `BrunoTableServer` always installs the read-only branch. `BrunoTableClient` installs grouping and aggregation only when `editable` is false or omitted; when true, its composition root does not register grouping or aggregation features, expose a Group By Region, accept grouped commands, or execute aggregate work. Shared definitions may still declare `isEditable`, `groupBy`, and `aggFunc` because the same tuple may serve different Table Instances. A restored editable instance conservatively drops `groupBy`, `groupOrderBy`, and the reserved Rows width rather than retaining unreachable grouping intent.

Use `onSaveEdits`, not `onEditSaveClick`: the operation saves one atomic Change Set regardless of whether the Save Workflow came from a pointer, keyboard, accessibility activation, Immediate transaction, Batch Save, or retry. It returns `PromiseLike<void>` rather than canonical rows or a result discriminant. Resolution says the application accepted the Save Operation; rejection enters the failure workflow. Only the live Client Source supplies canonical values and Row Versions.

The outer Save Change Set groups changes by Row Identity because optimistic concurrency is row-scoped. Each row entry contains one safely rebased `baseRow`, its exact `expectedVersion`, and a non-empty typed Cell Change Set. Each cell entry contains both the grid-owned Column Identity used by BrunoTable and the exact source `field` used by the application write boundary, together with exact correlated `before` and `after` values. Editable Computed Columns remain impossible, so BrunoTable never asks consumers to reverse-map Column Identity to a field. The payload contains no projected `afterRow`, Edit Mode, gesture, initiating surface, or other UI metadata.

`baseRow` is the latest immutable canonical source-row snapshot that passed Save preflight, not a deep clone and not the row as first edited. Preflight may safely rebase all changes for one row to its latest Row Version only when every edited field remains semantically equal to its recorded base. It then refreshes `baseRow`, `expectedVersion`, and each semantically equal `before` value together. Any edited-field divergence enters Conflict Review instead. This produces one coherent row patch even when its cells were edited across several source versions, while the application's atomic compare-and-set still closes the race after preflight.

Promise rejection has no exported error protocol. A non-empty ordinary `Error.message` becomes the persistent user explanation; an unknown or unsafe rejection receives a bounded generic `The save could not be confirmed` message. Effect-based applications translate typed failures at their Adapter boundary and run the Effect there; Effect is not part of the handler type.

The handler always receives the same non-empty array:

- Immediate Cell Edit Commit normally supplies one change.
- Immediate paste and drag fill supply every change in one transaction-level call.
- Batch Save supplies the accumulated net dirty cells, coalescing repeated edits of one cell rather than exposing undo history.

`editable: true` automatically renders BrunoTable's top-right Edit Mode toggle and persistent Edit Safety Footer in `BrunoTableClient`. Static column capability controls toggle visibility; never scan rows or execute row predicates globally. The footer owns Reset and Save, conflict/validation presentation, progress, and entry into conflict resolution; pages do not receive drafts or reproduce the workflow with toolbar children. `BrunoTableServer` renders none of this chrome even when shared columns declare potential editability.

Edit Mode belongs to the end user, not the consumer interface. Do not expose default or controlled Edit Mode props. Each table session starts in Immediate mode; the top-right switch changes internal session state only. Switching is blocked while edit-owned work or saving is active. Reset is internal grid intent and requires no consumer callback. Only a ready-to-save transition invokes `onSaveEdits`; unresolved conflicts and blocking validation enter their BrunoTable-owned review UI first.

## Mandatory column identity

Every leaf column definition requires an explicit `columnId` from this namespace:

```ts
type BrunoTableColumnId = `COL_ID_${ColumnIdFirstCharacter}${Uppercase<string>}`;
```

`ColumnIdFirstCharacter` is an ASCII uppercase letter, decimal digit, or underscore. Requiring it
excludes the empty `COL_ID_` identity during `satisfies` checks; runtime normalization validates
the same first-character and uppercase-suffix grammar for widened or restored values and rejects
whitespace anywhere in the identity. `BrunoTableColumnId<TLiteral>` is available when a boundary
needs to validate a specific literal type for that whitespace rule. BrunoTable's callable Column
Helpers and Computed Column constructor apply that literal validation during inference. A plain
array checked with `satisfies BrunoTableColumns<TRow>` intentionally remains the primary raw-column
shape; TypeScript cannot subtract the open Unicode whitespace set from an unbounded template-literal
type at that contextual boundary, so runtime normalization remains authoritative for raw arrays and
for widened or restored identities.

```ts
{
  columnId: "COL_ID_PRICE",
  field: "price",
  headerName: "Price",
  valueType: "number",
}
```

The prefix deliberately distinguishes durable grid identity from a row field. The uppercase suffix keeps identifiers conspicuous and searchable in definitions, persisted fixtures, commands, and diagnostics.

Never derive `columnId` from:

- `field`
- header text
- array position
- `valueGetter`
- a generated counter

Lowercase or unprefixed literals must fail compilation under `satisfies BrunoTableColumns<TRow>`. Dynamic or restored values must be validated at runtime. `columnId` must also be unique within a table; duplicate IDs are configuration errors and must fail during the one-time compilation of a stable definition set, before TanStack Table construction or persistence restoration. The public column shape should preserve literal IDs for downstream inference, while runtime validation remains authoritative for uniqueness. Never rescan IDs from React render, cell render, row-update, or interaction paths; a genuinely replacement definition set receives one new compilation pass.

All grid-owned and persisted state uses `columnId`:

- order, width, visibility, and pinning
- filters and sorts
- focus and selection
- drafts, validation, and conflicts
- clipboard and fill transactions
- diagnostics

Persisted identity is scoped by `tableId + columnId`.

Both parts of that durable identity are serializable strings, not Symbols. A Symbol would guarantee uniqueness only for one JavaScript runtime and could not reproduce the same layout key after reload, cross a worker or SSR boundary, or be stored in JSON or a database. BrunoTable instead creates a private Symbol-backed Table Instance Identity for each mounted runtime. Development diagnostics compare concurrently mounted uses of a `tableId` and report incompatible column schemas, while compatible instances may deliberately share preferences.

## Mandatory column name

Every leaf column definition also requires an explicit, non-empty `headerName`. It is the default visible text and accessible name for the semantic column header:

```ts
{
  columnId: "COL_ID_PRICE",
  field: "price",
  headerName: "Price",
  valueType: "number",
}
```

`headerName` is descriptive metadata, not identity. Never use it for persisted state, filtering, sorting, row access, or View Server queries, and never infer it from `columnId` or `field`. Runtime normalization rejects absent, non-string, or whitespace-only names from dynamic inputs.

A future custom header renderer may replace the visible content, but `headerName` remains the stable human-readable fallback for screen readers and grid-owned UI such as menus, choosers, and conflict details. Icon-only and action columns still provide a meaningful name such as `"Actions"`; their renderer may hide the text visually without removing its semantics.

## Value Types, Column Helpers, and Column Presets

TypeScript preserves a field's static value type but does not emit runtime metadata. A Server Table also begins sparse, and a computed column may have no loaded values. Every raw value-bearing column therefore declares an explicit `valueType`; BrunoTable never samples rows to infer rendering, Client editing, filtering, sorting, clipboard, or persistence behavior:

```ts
const columns = [
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;
```

The raw built-in Value Types initially include `"text"`, `"number"`, `"bigint"`, and `"boolean"`. Select columns add typed option semantics over their actual value domain. Date/time and other built-ins may be added only with explicit runtime semantics. A custom `BrunoTableValueType<TValue>` supplies a typed, declarative selection that is compiled into the internal Column Value Semantics plan.

Most consumers should prefer the optional built-in Column Helpers:

```ts
const columns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  BrunoTableNumberColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    format: {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  }),
  BrunoTableBooleanColumn({
    columnId: "COL_ID_ACTIVE",
    field: "active",
    headerName: "Active",
  }),
] satisfies BrunoTableColumns<Order>;
```

Helpers supply the Value Type plus coherent renderer, editor, filter, sort, clipboard, accessibility, and layout defaults. Text cells are start-aligned; numeric values and numeric editors are end-aligned; boolean checkboxes are centered; select editors fill the available cell width. These are semantic layout defaults compiled into the normalized column and rendered through BrunoTable's theme, not CSS callbacks repeated in every mounted cell.

Root exports include `BrunoTableTextColumn`, `BrunoTableNumberColumn`, `BrunoTableBigIntColumn`, `BrunoTableBooleanColumn`, and `BrunoTableSelectColumn`. The optional `@bruno/table/effect` entry point exports `BrunoTableBigDecimalColumn` and its raw BigDecimal Value Type without causing the root package or declarations to import Effect.

Column Helpers never infer or generate `columnId`. A final helper invocation still requires explicit Column Identity plus either one direct `field` or a non-empty `fields` dependency tuple with `valueGetter`, and its result is an ordinary definition that enters the same validation and normalization path as raw configuration. Helper-created, preset-created, and raw columns may coexist in one array. There is no grid-level string registry such as `type: "price"` and no per-cell helper dispatch.

Applications specialize a helper into a reusable domain Column Preset when title, formatting, width, alignment, editor, filter, or validation policy repeats across tables:

```ts
export const priceColumn = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  format: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
  width: 120,
});

const columns = [
  priceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
  }),
] satisfies BrunoTableColumns<Order>;
```

The [strict column API prototype](./research/strict-column-api-prototype.md) proved that `withDefaults` can preserve literal identity, exact field/value correlation, computed getter return types, and typed callbacks without casts or repeated row generics. Production keeps the same global-helper shape and adds source and emitted-package type tests before exporting it.

Configuration precedence is deterministic:

```text
built-in Column Helper defaults
    -> reusable Column Preset defaults
    -> individual column options
```

Individual helper calls and raw definitions retain fully typed presentation escape hatches:

```ts
BrunoTableNumberColumn({
  columnId: "COL_ID_PROFIT",
  field: "profit",
  headerName: "Profit",
  valueFormatter: ({ value }) => (value < 0 ? `(${Math.abs(value).toFixed(1)})` : value.toFixed(1)),
  cellClassName: ({ value }) => (value < 0 ? "text-destructive" : undefined),
});
```

`valueFormatter` returns visible text. `cellClassName` applies static or value/row-aware presentation, and `cellRenderer` remains the fully custom React rendering escape hatch. Each callback preserves the exact row and column value type. These properties change Cell Presentation only: the example still sorts, filters, edits, saves, and reconciles `-5.5` as the numeric value `-5.5`, not the string `"(5.5)"`.

If custom display text must round-trip through editing, paste, or formatted clipboard exchange, the column must provide an explicit paired parser/exchange capability or a custom Value Type. BrunoTable never assumes that a `valueFormatter` is reversible.

## Column kinds

### Shared definition

The minimal shared shape is conceptually:

```ts
type BrunoTableColumnBase<TRow, TValue, TColumnId extends BrunoTableColumnId> = {
  columnId: TColumnId;
  headerName: string;
  valueType: "text" | "number" | "bigint" | "boolean" | BrunoTableValueType<TValue>;
  isEditable?: boolean | ((params: { row: TRow; value: TValue }) => boolean);
  valueFormatter?: (params: { row: TRow; value: TValue }) => string;
  cellClassName?: string | ((params: { row: TRow; value: TValue }) => string | undefined);
  cellRenderer?: BrunoTableCellRenderer<TRow, TValue>;
};
```

The implementation may normalize static and callback capabilities once, but it must not turn ordinary cell rendering into a broad state subscription.

### Column Value Semantics

Column Value Semantics are the authority whenever BrunoTable must interpret a value rather than merely read it. The normalized plan contains semantic equality, order, canonical text, parsing, a versioned preference codec, and explicit capability markers. It is compiled once and reused by editing, client filtering/sorting, clipboard, persistence, drafts, and conflicts.

Exact numeric raw columns select a Value Type rather than repeating functions:

```ts
import { BrunoTableBigDecimalValueType } from "@bruno/table/effect";

const columns = [
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: BrunoTableBigDecimalValueType,
  },
] satisfies BrunoTableColumns<Order>;
```

The root package owns `"bigint"`. The optional `@bruno/table/effect` entry point owns `BrunoTableBigDecimalValueType` and has Effect as an optional peer. Importing the root entry point neither loads Effect nor exposes Effect-specific declarations.

Do not sample rows to infer exact value semantics. TypeScript value types are erased, a Server Table begins sparse, and the public effect-view-server Viewport Source does not expose runtime field semantics. A future source Adapter may supply an opaque compiled semantics registry, but explicit column semantics remain the portable interface.

Rules:

- `number`, `bigint`, and BigDecimal operands never mix implicitly.
- Mixed-domain unions have no automatic ordered-numeric capability.
- `valueFormatter` changes visual presentation only.
- Default edit and clipboard text is canonical, exact, and locale-independent.
- V1 exposes Copy and Paste but no Cut or cell Clear/Delete prop, command, or menu item. It registers no `Ctrl/Cmd+X`, `Delete`, or `Backspace` mutation handler; value changes enter through an editor, explicit paste transaction, or repetition-only Drag Fill transaction.
- Paste has no public tiling or mismatch policy. A source whose row and column counts both exceed one is rejected with one explanatory toast. A 1×1 source is the only no-confirmation broadcast shape; a supported `1×N` or `N×1` mismatch is resolved by BrunoTable's internal Paste Confirmation and can apply only to one explicitly described source-oriented Linear Cell Range.
- Blank input is resolved by an explicit nullable clear policy before numeric parsing; it is never silently zero.
- BigDecimal equality and comparison match effect-view-server, including differently scaled equal values and extreme safe scales.
- Numeric filter operators derive from semantics capabilities rather than `Extract<TValue, number | bigint>`.
- Drag Fill is fixed repetition-only behavior and exposes no series, arithmetic, inference, or fill-strategy capability in `BrunoTableValueType`, Column Helpers, or table props.

The public `BrunoTableValueType<TValue>` descriptor is a deep interface, not an invitation for ordinary consumers to implement many callbacks. First-party built-ins, Column Helpers, and integration presets hide those details and compile them into a private Column Value Semantics plan. Its final construction interface must be proven with type-level tests before export, while the `valueType` column selection and exact behavior above are accepted.

### Field columns

A field column reads a real row field directly:

```ts
{
  columnId: "COL_ID_PRICE",
  field: "price",
  headerName: "Price",
  valueType: "number",
}
```

Requirements:

- `field` must be a valid field for `TRow`.
- The column value type is `TRow[typeof field]`.
- Direct field access is the default cell-value fast path.
- `field` is the default projection, filter, and sort mapping for a View Server Adapter.
- `field` is not column identity and is never the key of persisted grid state.

This must fail:

```ts
const columns = [
  {
    columnId: "COL_ID_PRICE",
    field: "prices",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;
```

### Computed columns

A Computed Column has `valueGetter` plus an explicit non-empty `fields` dependency tuple instead of `field`:

```ts
BrunoTableBigIntColumn({
  columnId: "COL_ID_DOUBLE_QUANTITY",
  headerName: "Double quantity",
  fields: ["quantity"],
  valueGetter: ({ row }) => row.quantity * 2n,
});
```

The return type of `valueGetter` is the column value type. Every dependency must be a valid row field, and the getter's `row` parameter is restricted to `Pick<TRow, TFields[number]>`; accessing an undeclared field must fail TypeScript. The Server Table unions this tuple into its explicit `select` projection, while the Client Table uses the same declaration over its complete resident row.

Strict Computed Columns use a global Value Type helper, or an equivalently typed custom Value Type constructor, because the generic call boundary captures the exact per-column dependency tuple before contextually typing `valueGetter`. A plain structural array target cannot capture an arbitrary tuple from its own element closely enough to enforce the `Pick` restriction. Raw Field Columns remain valid and may coexist with helper and preset results. Every Computed constructor preserves the getter's inferred return type in `valueFormatter`, `cellClassName`, and `cellRenderer` without exposing `unknown`.

A Computed Column is presentation-only in V1. It is always excluded from `BrunoTableFilterableColumnId<TColumns>`, `BrunoTableSortableColumnId<TColumns>`, and `BrunoTableEditableColumnId<TColumns>`. BrunoTable never executes, inspects, or reverse-engineers arbitrary JavaScript to manufacture query or mutation semantics.

### Field and computed definitions are exclusive

The definition accepts exactly one of `field` or non-empty `fields` plus `valueGetter`. Supplying both paths, neither path, an empty dependency tuple, or `fields` without a getter is invalid. Use a Field Column plus `valueFormatter` when only presentation differs.

## Capability derivation

The exact column tuple should derive:

```ts
type BrunoTableColumnIdOf<TColumns> = ...;
type BrunoTableColumnValue<TColumns, TColumnId> = ...;
type BrunoTableColumnField<TColumns, TColumnId> = ...;
type BrunoTableEditableColumnId<TColumns> = ...;
type BrunoTableFilterableColumnId<TColumns> = ...;
type BrunoTableSortableColumnId<TColumns> = ...;
```

Having a `field` plus the required Value Type semantics makes a column eligible for default field-based query semantics. Filtering and sorting UI are enabled by default for such a Field Column, with explicit per-column opt-outs. A Computed Column remains excluded unless it declares explicit capability-specific semantics.

Capabilities must remove invalid columns from their state models. A Computed Column cannot appear in filter, sort, or edit state merely because a caller writes its `columnId`.

## Grouping and aggregation column capabilities

Grouping eligibility and aggregate behavior are independent opt-in properties on a Field Column:

```ts
type BrunoTableAggFunc = "countDistinct" | "sum" | "min" | "max" | "avg";

const columns = [
  {
    columnId: "COL_ID_REGION",
    headerName: "Region",
    field: "region",
    valueType: "text",
    groupBy: true,
    groupKeyValueFormatter: ({ value }) => value.toUpperCase(),
  },
  {
    columnId: "COL_ID_MIN_PRICE",
    headerName: "Minimum price",
    field: "price",
    valueType: "number",
    groupBy: true,
    aggFunc: "min",
    aggregateValueFormatter: ({ value }) => value.toFixed(2),
    aggregateCellClassName: ({ value }) => (value < 0 ? "text-destructive" : undefined),
  },
  {
    columnId: "COL_ID_MAX_PRICE",
    headerName: "Maximum price",
    field: "price",
    valueType: "number",
    aggFunc: "max",
    aggregateValueFormatter: ({ value }) => value.toFixed(2),
  },
] satisfies BrunoTableColumns<Order>;
```

`groupBy: true` means the user may add the column to BrunoTable's Group By Region; it does not mean the column starts actively grouped. The Region provides Add Group and column-menu commands in addition to pointer drag. `aggFunc` is one built-in function, never an array or arbitrary callback. Multiple aggregate presentations over one field are ordinary separate columns with separate `columnId` values. Supporting them requires no public renamed fields: both definitions above retain `field: "price"`, while their Column Identities distinguish their logical cells.

A column may provide both capabilities. While that column is an active group key, the flat grouped row contains its group-field value and suppresses its own aggregate output. When another column is grouping and this column is not an active key, its `aggFunc` contributes an aggregate output. The ordered active Group By Region determines the ordered field tuple sent to the View Server or evaluated by the Client Adapter.

The exact `aggFunc` union exposed for a concrete column must be capability-derived rather than universally assignable. For example, `sum` and `avg` require compatible numeric aggregation semantics. TypeScript and runtime normalization must reject unsupported column/function combinations before either row pipeline receives them.

Grouped presentation is also capability-derived. Its conceptual shape is:

```ts
type BrunoTableGroupKeyCellParams<TValue, TColumnId extends BrunoTableColumnId> = {
  readonly columnId: TColumnId;
  readonly value: TValue;
  readonly rowCount: bigint;
};

type BrunoTableGroupKeyPresentation<TValue, TColumnId> = {
  readonly groupKeyValueFormatter?: (
    params: BrunoTableGroupKeyCellParams<TValue, TColumnId>,
  ) => string;
  readonly groupKeyCellClassName?:
    string | ((params: BrunoTableGroupKeyCellParams<TValue, TColumnId>) => string | undefined);
  readonly groupKeyCellRenderer?: (
    params: BrunoTableGroupKeyCellParams<TValue, TColumnId>,
  ) => React.ReactNode;
};

type BrunoTableAggregateCellParams<
  TAggFunc extends BrunoTableAggFunc,
  TValue,
  TColumnId extends BrunoTableColumnId,
> = {
  readonly columnId: TColumnId;
  readonly aggFunc: TAggFunc;
  readonly value: TValue;
  readonly rowCount: bigint;
};

type BrunoTableAggregatePresentation<TAggFunc, TValue, TColumnId> = {
  readonly aggregateValueFormatter?: (
    params: BrunoTableAggregateCellParams<TAggFunc, TValue, TColumnId>,
  ) => string;
  readonly aggregateCellClassName?:
    | string
    | ((params: BrunoTableAggregateCellParams<TAggFunc, TValue, TColumnId>) => string | undefined);
  readonly aggregateCellRenderer?: (
    params: BrunoTableAggregateCellParams<TAggFunc, TValue, TColumnId>,
  ) => React.ReactNode;
};
```

The owning callback's `columnId`, `value`, and `aggFunc` remain literal and exact. Column-level
presentation callbacks deliberately do not receive sibling Group Key evidence: a plain array
checked with `satisfies BrunoTableColumns<TRow>` cannot contextually reference its own eventual
sibling tuple without circular inference. Publishing a row-wide approximation would admit
non-groupable fields, while accepting a consumer-supplied tuple would let the callback claim
columns that the Table does not own. Code outside the array that already has `typeof columns` may
use `BrunoTableGroupKeyValues<TRow, typeof columns>` where an exact groupable Column Identity union
is required. A future table-bound presentation seam may expose that evidence after it can bind the
actual tuple.

A Group Key Cell's `value` retains the exact field value type, but its presentation context intentionally omits `row: TRow` because the cell identifies a complete group rather than one representative source row. Without an override, BrunoTable formats it through the field's compiled Value Type presentation.

The exact aggregate result type follows the compiled Value Type and selected `aggFunc`; it is not assumed to equal the raw field type. Aggregate callbacks also omit `row: TRow`. Without an override, BrunoTable formats the aggregate through its compiled aggregate-result Value Type presentation. Ordinary raw-row `valueFormatter`, conditional `cellClassName`, and `cellRenderer` callbacks are never invoked with fabricated grouped data.

If one definition declares both grouping eligibility and aggregation, its active role selects the presentation family. An active key uses only its `groupKey...` overrides and suppresses its aggregate; under another active grouping it uses only its `aggregate...` overrides for the aggregate result.

The matching `groupKeyCellClassName` and `aggregateCellClassName` properties accept either a static class or a conditional function using the same honest context as their formatter and renderer. This keeps common styling such as negative aggregate values in `text-destructive` out of a custom React renderer. Grouped class names affect presentation only, run only for mounted cells, and do not create grid subscriptions.

The Viewport Adapter may compile `COL_ID_MIN_PRICE` and `COL_ID_MAX_PRICE` to distinct private aliases required by effect-view-server, but it maps each response value directly back to its Column Identity. The public column definitions, renderer, callbacks, sort state, and persistence never observe names such as `minimumPrice`, `maximumPrice`, or a generated aggregate alias.

Active grouping also installs one BrunoTable-owned System Column whose default header is `Rows`. It is not inferred from or attached to any consumer Field Column. Every flat grouped row contains its exact `bigint` source-row count after current pre-group filters. The Client Adapter calculates it from the complete filtered source; the Viewport Adapter always adds a native `{ aggFunc: "count" }` aggregate under a reserved internal alias.

The visible Rows column is the sole row-count representation. `BrunoTableAggFunc` therefore excludes `count`, avoiding duplicate counts and the false implication that row count belongs to an arbitrary field. `countDistinct` remains a field-level function. Because effect-view-server has no HAVING or aggregate-result filter contract, the System Column cannot participate in Grid Filters in V1.

Rows uses the reserved System Column Identity `COL_ID_BRUNO_TABLE_ROWS` in BrunoTable commands and persisted grouped sort state. Its exported type name is `BrunoTableRowsColumnId`; consumers cannot declare a column with that reserved identity. The Viewport Adapter maps it to its private `count` aggregate alias only while compiling a grouped query.

Consumers may customize this System Column through one optional base-table property without defining a fake Field Column:

```ts
type BrunoTableRowsColumnId = "COL_ID_BRUNO_TABLE_ROWS";

type BrunoTableRowsCellParams<TColumns> = {
  readonly columnId: BrunoTableRowsColumnId;
  readonly value: bigint;
  readonly groupKeys: BrunoTableGroupKeyValues<TColumns>;
};

type BrunoTableGroupRowsColumnOptions<TColumns> = {
  readonly headerName?: string;
  readonly width?: number;
  readonly valueFormatter?: (params: BrunoTableRowsCellParams<TColumns>) => string;
  readonly cellClassName?:
    string | ((params: BrunoTableRowsCellParams<TColumns>) => string | undefined);
  readonly cellRenderer?: (params: BrunoTableRowsCellParams<TColumns>) => React.ReactNode;
};
```

`headerName` defaults to `Rows` and must be non-empty when supplied. `width` is a numeric baseline in the same sizing domain as ordinary columns. The normal compiled `bigint` presentation and implementation-owned default width apply when their overrides are absent. The scoped formatter, class, and renderer receive the exact row count and ordered group keys, but no raw `TRow`, field, aggregate alias, or configurable identity.

```tsx
<BrunoTableServer
  tableId="regional-orders"
  columns={columns}
  initialOrderBy={initialOrderBy}
  viewportSource={viewportSource}
  groupRowsColumn={{
    headerName: "Orders",
    width: 112,
    valueFormatter: ({ value }) => value.toLocaleString(),
    cellClassName: "font-mono tabular-nums",
  }}
/>
```

The property is static definition input shared by Server and read-only Client Tables. Editable Client props reject it. It cannot configure `columnId`, `field`, `valueType`, grouping, aggregation, filtering, hiding, editing, pinning, or sorting capability. Changing the visible label never changes the reserved Column Identity or row-count meaning.

A committed user resize is the sole durable Rows layout preference. It is stored in `columnWidths` under `COL_ID_BRUNO_TABLE_ROWS`; a valid restored width wins over `groupRowsColumn.width`, remains dormant while grouping is inactive, and reappears when grouping resumes. Sanitization retains it while current definitions still expose grouping capability and drops it when they do not. Rows never appears in persisted `columnOrder`, `columnVisibility`, or `columnPinning`.

Grouping owns a derived rendered layout rather than mutating persisted column preferences. Its Logical Column Order is the active group-key columns in Group By order, followed by Rows, followed by participating aggregate columns in their normal relative order. Reordering Group By chips changes the group-key tuple and rendered key-column order together.

This sequence is the complete grouped projection. A non-key consumer column appears only when it explicitly declares `aggFunc`; every column without grouped semantics is temporarily omitted and restored unchanged afterward. `aggFunc` is deliberately optional. BrunoTable does not guess a field's domain meaning, expose arbitrary representative source values, or request unused aggregates merely to keep every raw column mounted.

The grouped projection applies Column Visibility asymmetrically and deliberately. Active group keys and Rows are forced visible as required grouped structure without changing the persisted visibility map. Aggregate columns continue to respect their normal visibility preference, so an aggregate-capable hidden column does not unexpectedly surface. Clearing grouping removes the forced presentation and reveals the unchanged normal visibility state.

Visibility controls remain operational while grouped and inspect all normalized columns, not merely the grouped visible-cell collection. Aggregate columns may be shown or hidden through the ordinary durable visibility command and that choice remains after grouping clears. Active group keys reject hiding until removed from Group By; the Rows System Column is non-hideable. There is no parallel grouped-visibility interface or persisted slice.

All start/end pinning is suspended in this derived grouped layout, including pinning previously assigned to a group key or aggregate column. The normal order and pinning snapshots remain intact and emit no preference change merely because grouping became active. Removing the last active group key restores them exactly.

While grouped, the ordinary header reorder interaction and command are unavailable. Only Group By chip reordering changes presentation order. Aggregate columns retain their relative durable base `columnOrder`.

The Group By Region exposes no public controller or callback. It derives eligible inactive columns from `groupBy: true`, presents them through an accessible Add Group combobox and column menus, gives every active chip an explicit Remove action, and supports scoped `Alt+ArrowLeft/Right` one-step reorder with focus retention and polite position announcements. Pointer drag invokes those same private commands; there is no keyboard pickup/drop mode. Each accepted action emits the ordinary single complete preference snapshot through `onPersistChange`.

The persisted `columnOrder` and `columnPinning` always describe the normal ungrouped layout. The persisted ordered `groupBy` list describes current grouping intent. BrunoTable never serializes the derived rendered order or a second `orderBeforeFirstGroupBy` copy. On restoration it sanitizes all three against current capabilities, restores the base layout plus Group By order, and derives the grouped presentation. Clearing grouping after hydration therefore restores the user's expected normal layout without a browser-only backup.

Grouped-summary sorting is a second durable context rather than a reinterpretation of raw-row `orderBy`. Its conceptual public types are:

```ts
type BrunoTableGroupedSortableColumnId<TColumns> =
  | BrunoTableGroupableColumnId<TColumns>
  | BrunoTableAggregatedColumnId<TColumns>
  | BrunoTableRowsColumnId;

type BrunoTableGroupSortBy<TColumns> = readonly [
  {
    readonly columnId: BrunoTableGroupedSortableColumnId<TColumns>;
    readonly direction: "asc" | "desc";
  },
  ...Array<{
    readonly columnId: BrunoTableGroupedSortableColumnId<TColumns>;
    readonly direction: "asc" | "desc";
  }>,
];
```

The static union provides autocomplete for every potentially valid grouped target. Runtime state narrows it to active group keys, Rows, and currently visible participating aggregate columns. Grouped eligibility is intentionally independent of normal-row `sortable`: an active group key and a produced aggregate result remain sortable even if their raw Field Column opted out of normal sorting.

On first grouping, or when restored `groupOrderBy` has no valid survivor, BrunoTable orders every active group key ascending in Group By order. Otherwise it preserves valid grouped entries and priorities. Removing or reordering group keys or hiding an aggregate sanitizes the grouped order; newly invalid entries are dropped, and the active-key fallback is applied only if the result would be empty. Clearing grouping retains this context dormant for a future compatible grouping and immediately restores the untouched `orderBy`. No `initialGroupOrderBy` prop is required in V1.

Consumers do not supply grouped-row identity. In a read-only `BrunoTableClient`, the local grouping plan derives a private identity from the complete ordered group-key tuple through compiled exact-value semantics. In `BrunoTableServer`, the Viewport Adapter consumes the source-owned authoritative row key delivered atomically beside every sparse raw or grouped result. It never reconstructs the View Server's canonical key from projected values. This upstream contract was specified in [effect-view-server#405](https://github.com/bmvantunes/effect-view-server/issues/405) and landed in [effect-view-server#407](https://github.com/bmvantunes/effect-view-server/pull/407); a compatible effect-view-server release containing it is a prerequisite for the Server variant.

`getRowId` remains mandatory for `BrunoTableClient` because it owns its complete raw `TRow` collection, but BrunoTable never calls it with a fabricated grouped result. `BrunoTableServer` rejects `getRowId` because the Viewport Source owns identity for both raw and grouped rows. There is no `getGroupedRowId` prop or public Group Row Identity field. Aggregate values, Rows, sorting, and positions do not define identity, so aggregate-only updates and grouped reordering preserve it. A changed group key produces a different group, while entering, leaving, or changing Group By advances the logical row generation and clears incompatible transient state. Group Row Identity is never persisted.

effect-view-server is a first-party collaborating module at the Server source seam. If BrunoTable needs missing source-owned semantics, change the upstream contract and require the compatible release. Do not enlarge BrunoTable's consumer interface, duplicate schema semantics, reconstruct canonical values or keys, or ship a weaker local fallback to avoid that change.

## Grid filter expressions

Persisted filters express user intent using `columnId`. They do not persist View Server fields or raw TanStack `unknown` values.

Leaf conditions should follow effect-view-server's operator vocabulary while replacing its `field` with `columnId`:

```ts
const filters = [
  {
    columnId: "COL_ID_PRICE",
    type: "greaterThanOrEqual",
    filter: 100,
  },
  {
    type: "OR",
    conditions: [
      { columnId: "COL_ID_STATUS", type: "equals", filter: "open" },
      { columnId: "COL_ID_STATUS", type: "equals", filter: "filled" },
    ],
  },
] satisfies BrunoTableFilterExpressions<typeof columns>;
```

The filter model must support:

- typed field conditions
- recursive `AND` and `OR` groups whose leaves all share one Column Identity
- unary `NOT` within that same-column expression
- an implicit-AND root array
- operator and operand types derived from the column value

The type must reject a compound group containing different Column Identities. Cross-column Grid Filter composition is always the implicit root `AND`; Quick Filter owns its separate OR-across-eligible-fields behavior.

For example, `contains` must be rejected for a numeric column and `greaterThan` must be rejected for a nonnumeric column.

`inRange` is half-open in both variants: `filter <= value < filterTo`. Client filtering must install the compiled exact comparator instead of TanStack's inclusive `inNumberRange` helper. Runtime filters retain native typed operands; the Server Adapter changes only Column Identity to Query Field and lets effect-view-server own schema-aware transport encoding.

The built-in filter UI exposes the complete operator vocabulary supported by the column's Value Type and effect-view-server:

- Text: `equals`, `notEqual`, `in`, `contains`, `notContains`, `startsWith`, `endsWith`, `blank`, and `notBlank`, plus case-sensitive and accent-sensitive options.
- Number, BigInt, and BigDecimal: `equals`, `notEqual`, `in`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, half-open `inRange`, `blank`, and `notBlank`.
- Boolean and other supported scalars: `equals`, `notEqual`, `in`, `blank`, and `notBlank`.

Boolean and Select Field Columns use a live Set Filter for `in` by default. Text, Number, BigInt, and BigDecimal Field Columns still expose `in`, but live distinct-value faceting requires explicit column opt-in so a high-cardinality field does not silently create an expensive subscription. The exact opt-in property belongs to the final column filter configuration design.

Set Filter overlays in both Client and Server Tables may use checkbox options and a value-level Select All control. These are local filter affordances and do not install Row Selection, selected-row state, a body checkbox column, or a server row-selection command.

Set Filter state preserves inclusion versus exclusion intent while the selection is partial. Select All means no column filter, not a frozen `in` list. Deselecting from All creates compact exclusion intent so future live values remain selected unless explicitly excluded; selecting upward from none creates inclusion intent so future values remain unselected unless explicitly included. Any user command that selects the final currently unselected facet value normalizes immediately to the same no-filter state as Select All, regardless of the click history. Passive facet updates never perform this normalization or otherwise rewrite intent.

Clear All stores empty inclusion intent and matches no current or future row. Client compilation emits an explicit false predicate; Server compilation emits the source-native Match-None Filter Expression tracked in [effect-view-server#409](https://github.com/bmvantunes/effect-view-server/issues/409). BrunoTable never substitutes an empty View Server `in` no-op, freezes the current facet domain, or negates only the values visible when the command occurred.

An open Set Filter is a live surface. Client Tables derive its values and counts from the complete locally processed row model. Server Tables acquire a narrow live facet subscription over the complete result domain rather than the loaded viewport window. The facet applies External Filters, Feed Route, Quick Filter, and every other active Grid Filter while excluding its own current column filter. Closing the surface releases the subscription. Incoming values and count changes update the open surface immediately without notifying the table root or body. A typed value explicitly retained by the current inclusion or exclusion intent remains visible and reversible with count zero when it disappears from the live facet; if it returns, its live count resumes. Absent values carrying no explicit intent require no overlay record.

Continuous text and numeric filter input auto-applies through a 150 ms TanStack Pacer debounce and exposes no Apply or Reset buttons inside the overlay. Discrete Set Filter checkbox choices and operator changes whose required operands are already valid apply immediately. Select All and Clear All each dispatch one atomic filter command, create at most one query generation, and emit at most one `onPersistChange` snapshot rather than looping through value-level commands. Grid Filters from different columns always combine with `AND`. Compound `AND`, `OR`, or `NOT` expressions may combine conditions only within one Column Identity; Quick Filter retains its separate OR-across-eligible-fields semantics. External Filters keep their field-keyed query-expression model and are not Grid Filters.

Typed filter controls keep raw in-progress input local to the open overlay and parse through the column's exact Value Type before debounce can publish a command. An invalid Number, BigInt, BigDecimal, range endpoint, or custom scalar draft displays an accessible inline error while the last valid committed filter remains authoritative. It triggers no Client recomputation, Server query, or `onPersistChange`. Escape or outside close may discard this non-mutating draft and restore the last committed presentation; unlike an invalid cell editor, an invalid filter never traps focus.

Built-in JavaScript Number editors and filter operands use `<input type="number" step="any">` for the browser's native floating-point input guard and appropriate mobile control. BrunoTable still inspects native bad-input state and parses through Number Value Semantics before commit; browser acceptance alone is not domain validation. BigInt and BigDecimal editors and filters instead use text inputs with the appropriate numeric or decimal `inputMode` so raw exact text survives until semantic parsing. They never read or round-trip through `valueAsNumber`. Custom Value Types choose their own control but remain subject to the same parse-before-commit contract.

If a Client editor is active when a user Grid Filter, Quick Filter, Clear, or Reset command commits, the command first passes through the ordinary editor parse-and-validation gate. An invalid candidate cancels the filter command and restores editor focus. A valid Batch candidate commits locally first; a valid Immediate candidate starts its save operation first. Filtering then proceeds immediately without awaiting transport, and any resulting hidden draft or operation remains available through its identity-keyed footer or notification surface.

Once no editor is active, existing edit-owned work does not gate filtering. Footer counts, Save payload derivation, and edit review surfaces operate over the complete sparse edit collections regardless of row visibility. Grid Filter and Quick Filter commands, including Clear and Reset, neither clear nor narrow drafts, history, conflicts, blocked records, or validation and do not open a confirmation merely because dirty rows become hidden.

Quick Filter eligibility comes only from the table's explicit `quickFilterFields` tuple. Every member must be a string-valued Query Field valid for `TRow`; visible columns, hidden columns, Column Identities, and column order do not implicitly change the tuple. The committed search text compiles to one `contains` leaf per configured field, those leaves combine with `OR`, and that group combines with External Filters and Grid Filters through `AND`. Client Tables evaluate the expression against their complete resident rows. Server Tables send the field-keyed expression to the View Server; filtering by a field does not require displaying a column for it. Both the field tuple and committed text are session-only: neither is persisted nor included in a saved view, and every new Table Instance starts with an empty Quick Filter. A `BrunoTableQuickFilter` rendered without the capability is a development-time configuration error rather than an automatic search over every text column.

TanStack Table's column-filter state may coordinate simple header-filter UI internally, but it is not BrunoTable's persisted filter contract.

## Sort state

Normal raw-row order state uses `columnId`, never View Server fields:

```ts
const orderBy = [
  { columnId: "COL_ID_PRICE", direction: "desc" },
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<typeof columns>;
```

`BrunoTableSortBy<TColumns>` is a non-empty tuple. Its `columnId` property is `BrunoTableSortableColumnId<TColumns>`: the exact literal union derived from the supplied `columns` tuple, never the broad `BrunoTableColumnId` pattern and never `string`. Consequently, a sorting-capable table's `initialOrderBy` receives contextual autocomplete for its sortable columns, while typos, unknown identities, and identities of computed or explicitly nonsortable columns fail compilation. Array order is sort priority. Both `initialOrderBy` and persisted normal-row `orderBy` use this shape when the capability exists. A common or Server variant with no sortable identity admits neither value; the first live Client instead rejects that column configuration because it cannot satisfy its mandatory tuple. The View Server Adapter resolves each Column Identity to its current Query Field only when compiling a raw `query.orderBy`. Dynamically restored values remain untrusted and are sanitized against the compiled columns at runtime. BrunoTable does not add complex tuple-uniqueness typing for duplicate sort identities; normalization quietly retains the first, highest-priority occurrence of each identity before state or query compilation.

Sorting has no unsorted state in any installed sorting context. A sorting-capable normal `orderBy` and active grouped `groupOrderBy` each may contain from one entry through every target eligible in that context. Plain activation, Shift activation, panel removal/reorder, keyboard behavior, direction toggling, duplicate normalization, visible priority, and the prohibition on removing the final entry are identical. A sort-free normal table installs no such context. BrunoTable does not infer a descending-first cycle for numeric Value Types.

Every committed ordering change creates a new logical row-position generation and resets vertical scroll to row zero in both Client and Server Tables. Horizontal scroll and column layout remain unchanged. Position-based Active Cell and Linear Cell Range state is cleared because its old indexes no longer describe the reordered row space, while drafts and conflicts survive through stable `rowId + columnId` identity. Keyboard focus stays on the header or Sort panel control that initiated the command rather than jumping into the body.

When an editor is active, a sort request first passes through the ordinary parse-and-validation commit gate. Rejection cancels sorting and returns focus to the invalid editor. A valid Batch candidate commits locally before the immediate reorder; a valid Immediate candidate starts its stable-identity save operation before the immediate reorder and does not make sorting wait for transport settlement. A successful operation flashes a still-mounted affected cell but never creates a success toast; an unmounted success completes quietly. Failure notifications remain authoritative even if the affected row moves outside the mounted viewport.

## View Server translation

The View Server Translation Adapter compiles current grid state immediately before replacing the viewport query:

```text
grid filter leaf          current column definition       View Server condition
columnId + type + value   columnId -> field               field + type + value

grid sort                 current column definition       View Server order
columnId + direction      columnId -> field               field + direction

grouped key sort          active grouping                 View Server grouped order
columnId + direction      columnId -> group field         field + direction

grouped result sort       grouped aggregate plan          View Server grouped order
columnId + direction      columnId -> private alias       aggregate + direction
```

`COL_ID_BRUNO_TABLE_ROWS` takes the grouped-result path and resolves to the private count alias. Persisted state never stores the alias. A grouped order entry never sends both `field` and `aggregate`.

Example:

```ts
const columns = [
  {
    columnId: "COL_ID_DISPLAY_PRICE",
    field: "unitPrice",
    headerName: "Price",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Order>;

// Grid-owned and persisted state
const filter = {
  columnId: "COL_ID_DISPLAY_PRICE",
  type: "greaterThan",
  filter: 100,
};

// View Server query generated through the current column definition
const where = {
  field: "unitPrice",
  type: "greaterThan",
  filter: 100,
};
```

Never send `columnId` directly as a View Server field merely because the strings happen to match.

On restoration, sanitize every persisted filter and both sort contexts against:

- the persisted format version
- the current `columnId` registry
- the column's current capability
- the current operator and operand type
- the current server-field mapping

An exact-numeric filter leaf additionally carries the current semantics codec ID and version plus a JSON-safe canonical string. Restore it only through that column's decoder. Never put a native `bigint` in JSON, use a BigDecimal object's diagnostic `toJSON`, or infer a stale operand domain from text that happens to look numeric.

Drop invalid state conservatively. If a backend field is renamed without changing the column's meaning, keep `columnId` stable and update `field`. If the meaning or value domain changes, change `columnId` or migrate the persisted format deliberately.

## View Server projection

effect-view-server raw queries require an explicit non-empty `select`.

- A field column contributes its `field` to the projected fields required for rendering.
- A Computed Column contributes every member of its explicit non-empty `fields` dependency tuple.
- Its getter receives only those declared fields at the public TypeScript boundary.
- Server Row Identity never forces a field into `select`; the Viewport Source delivers its authoritative key out of band beside each sparse row.

Client `getRowId` is not a Server projection declaration. Do not invoke `valueGetter` against fabricated rows to guess projection dependencies.

## Shared runtime and renderer

`BrunoTableClient` and `BrunoTableServer` are thin public composition roots. They construct different row-pipeline Adapters and then render the same internal grid experience:

```text
BrunoTableClient    -> Client Row Pipeline   --+
                                                +-> Grid Runtime -> BrunoTable View
BrunoTableServer    -> Viewport Row Pipeline --+
```

The shared Grid Runtime and BrunoTable View own:

- column normalization and preferences
- header, filter, and sort controls
- cell rendering and formatting
- keyboard navigation and focus
- selection, clipboard, and drag fill
- editing, validation, drafts, and conflicts
- row and column virtualization geometry
- command dispatch and fine-grained subscriptions

The Client Row Pipeline owns:

- complete Client Source and lifecycle-state ingestion
- local filtering and sorting
- local grouping and aggregation over the complete resident dataset when configured
- client transactions and the final processed row sequence

The Viewport Row Pipeline owns:

- the sparse indexed row store and loaded ranges
- View Server filter, sort, grouping, aggregation, and projection translation
- query generations and stale-response rejection
- total-row state, range requests, block caching, and eviction

Grouping and aggregation are V1 Read-only Table capabilities available behind both public components, not a Server-only extension. The public intent and column semantics remain BrunoTable-owned; consumers do not configure TanStack grouping APIs or effect-view-server query objects directly. A read-only Client Adapter executes the intent over its complete source. The Viewport Adapter sends native `groupBy` and `aggregates` query members and consumes the View Server's grouped result type. It must never aggregate sparse loaded blocks locally. An Editable Client Adapter installs neither execution path.

V1 exposes grouping as a flat grouped-summary result in Server and read-only Client Tables. Each distinct ordered group-key tuple produces one logical row containing the grouped fields and configured aggregate outputs. There are no expandable group rows, child-row fetches, or hidden leaf collections. The grouped result is modeled honestly rather than cast back to the raw `TRow`; the read-only Client Adapter derives its private tuple identity and the Viewport Adapter consumes the same source-owned key channel used for raw Server rows. No Server consumer identity callback exists.

The shared filter and sort UI dispatches the same grid commands in both variants. For example, a header never checks the row-model kind:

```text
filter UI -> filters.replace command -> validated grid filter state
                                      -> Client Adapter: recompute local row model
                                      -> Viewport Adapter: compile and replace server query

sort UI   -> active sort command -> validated normal or grouped sort context
                                 -> Client Adapter: recompute local row model
                                 -> Viewport Adapter: compile fields/aliases and replace server query
```

Do not implement a public `BrunoTableBase` or a shared renderer with `if (mode === ...)` branches. An internal React wrapper may exist, but `BrunoTableView` is the more precise role: it consumes a stable runtime interface and does not know which Adapter produced it.

## TanStack Table seam

TanStack Table v9 is an implementation detail behind BrunoTable's interface:

- `columnId` maps to TanStack's explicit column `id`.
- `field` maps to its direct accessor semantics.
- BrunoTable never accepts TanStack's header- or accessor-derived identity fallbacks.
- The client variant installs client filtered and sorted row models.
- The client variant executes configured grouping and aggregation over the complete resident source.
- The viewport variant keeps filtering, sorting, grouping, and aggregation state/UI features but uses manual processing; the Viewport Source supplies already processed sparse raw or grouped rows.
- Filter and sort state may use external atoms for fine-grained ownership and query generation.

Consumers should not need to register TanStack features or manipulate its table instance for the common grid path.

External implementation references may guide internal presentation without widening this seam. In particular, the [ReUI data-grid pattern note](research/reui-data-grid-patterns.md) records useful header-menu, Set Filter, skeleton, resize, and decorative-scrollbar ideas together with explicit prohibitions on copying ReUI's public TanStack table prop, broad layout boolean bag, pagination, append-only infinite loading, unsorted cycle, or destructive CRUD behavior.

## React Compiler and hot-path rules

- Module-scope column arrays are the default stable input.
- Do not require consumers to add defensive `useMemo` calls around static configuration.
- Keep the public variants as separate unconditional hook compositions; do not select hooks with a row-model flag.
- Provide the shared renderer a stable runtime reference, not a context value containing broad changing snapshots.
- Ingest `clientSource` at the Client composition root. Do not pass the changing source envelope or complete rows through shared React context.
- Direct field reads must stay on the cheapest cell path.
- `valueGetter` runs in a cell hot path and must be treated as pure.
- A cell must not subscribe to the complete table, row store, edit store, or selection store.
- Add fine-grained subscriptions only for state the mounted cell actually renders.
- Isolate any React Compiler-incompatible builder-method reads behind small subscription or adapter seams.
- Never expose or pass mutable TanStack Table, Row, Cell, Column, Header, or Virtualizer instances into compiled descendants; publish immutable selected snapshots instead.
- Keep any `"use no memo"` directive inside the smallest private Adapter function, document why it exists, and guard its eventual removal with compiler-on behavioural tests.
- Column virtualization is always available and automatic; 150-column consumers receive no public virtualization mode or TanStack configuration surface.

## Typed edits and conflicts

Edit and conflict models remain discriminated by exact `columnId`. Save cells additionally retain the correlated source field:

```ts
type BrunoTableSaveCellChange<TColumns> = {
  [TColumnId in BrunoTableEditableColumnId<TColumns>]: {
    columnId: TColumnId;
    field: BrunoTableColumnField<TColumns, TColumnId>;
    before: BrunoTableColumnValue<TColumns, TColumnId>;
    after: BrunoTableColumnValue<TColumns, TColumnId>;
  };
}[BrunoTableEditableColumnId<TColumns>];
```

The same value correlation applies to `baseValue`, `serverValue`, and `userValue` in conflicts. Avoid public `columnId: string`, `field: string`, plus `unknown` value shapes.

## Runtime decoding

Compile-time types do not validate arbitrary server responses. The core may accept a generic decoder Adapter, with integrations for Effect Schema, Zod, Valibot, and custom decoders. No schema library is mandatory for non-View-Server consumers.

## Required type-level tests

Cover at minimum:

- BrunoTable-owned public exports use the `BrunoTable...` prefix
- mandatory, literal-preserving, prefixed, uppercase `columnId`
- rejection of lowercase and unprefixed column identities
- invalid fields
- duplicate IDs at runtime and at compile time only where the public shape can prove them
- field value inference
- computed return inference
- rejection of simultaneous `field` and `valueGetter`
- computed columns excluded from filter, sort, and edit IDs
- filter operators and operands correlated with column values
- recursive filter expressions
- sort column IDs and priority
- `isEditable` callback inference
- edit and conflict value correlation
- `editable: true` requires `getRowVersion`, `onSaveEdits`, and at least one potentially editable column
- `getRowVersion` return inference flows into every expected Row Version and Accepted Overlay without consumer casts or repeated JSX generics
- read-only capability rejects `onSaveEdits`
- read-only Client and Server Tables reject `getRowVersion`
- consumer props cannot set or control Edit Mode; the user-owned session starts Immediate
- `onSaveEdits` receives a non-empty, value-correlated Save Change Set in both Edit Modes
- Save Cell Changes preserve exact `columnId` to `field` to `before`/`after` correlation and reject mismatched fields or values
- Save Row Changes require exact `baseRow` and inferred `expectedVersion`, while omitting either and adding `afterRow` or UI-origin metadata fail representative exact-shape tests
- `onSaveEdits` accepts `PromiseLike<void>` and no `BrunoTableSaveResult` export or result payload exists
- one multi-cell Immediate transaction remains one handler call rather than one call per cell
- Viewport Source topic/row compatibility
- `BrunoTableClient` accepts only a complete `clientSource`
- effect-view-server `LiveQueryResult<TRow>` is structurally assignable to `BrunoTableClientSource<TRow>`
- rejection of incomplete ready/stale Client Sources
- `BrunoTableServer` accepts only a `viewportSource`
- rejection of cross-variant source props
- rejection of repeated generic annotations at JSX usage
- rejection of `any` leaks in representative public inference paths
- emitted-package consumer inference, not only source-level inference

## Rejected public shapes

Do not reintroduce:

```ts
defineGrid(...);
createColumnHelper(...);
<DataGrid definition={...} rowModel={...} />;
<BrunoTable mode="client" ... />;
```

Also reject:

- implicit column IDs
- header text as identity
- raw TanStack state as the persistence contract
- View Server fields as persisted grid identity
- automatic server filtering or sorting for `valueGetter`-only columns
- executing consumer functions to infer query fields or projection dependencies
- one public component with client/viewport boolean modes or incompatible source unions
- spreading Client Source rows, status, version, and diagnostics into separate required table props
- accepting only client rows while discarding available source lifecycle state
- duplicated filter, sort, navigation, clipboard, or cell UI per row model

## Open interface decisions

The following remain deliberately unresolved:

- the no-helper correlated type shape for computed-column formatters

These decisions must extend the accepted small interface rather than restoring an intermediate grid-definition object.
