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

The same `columns` and `getOrderRowId` are accepted by both public variants.

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
      getRowId={getOrderRowId}
      columns={columns}
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
type BrunoTableBaseProps<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  tableId: string;
  getRowId: (row: TRow) => string;
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

type BrunoTablePersistedState<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  readonly version: number;
  readonly tableId: string;
  readonly filters: BrunoTablePersistedFilterExpressions<TRow, TColumns>;
  readonly sorting: BrunoTableSortBy<TColumns>;
  readonly columnOrder: readonly BrunoTableColumnIdOf<TColumns>[];
  readonly columnVisibility: Readonly<Partial<Record<BrunoTableColumnIdOf<TColumns>, boolean>>>;
  readonly columnWidths: Readonly<Partial<Record<BrunoTableColumnIdOf<TColumns>, number>>>;
  readonly columnPinning: BrunoTablePersistedColumnPinning<TColumns>;
};

type BrunoTableClientProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion = never,
> = BrunoTableBaseProps<TRow, TColumns> &
  BrunoTableEditingCapability<TRow, TColumns, TRowVersion> & {
    clientSource: BrunoTableClientSource<TRow>;
  };

type BrunoTableServerProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TViewport = unknown,
> = BrunoTableBaseProps<TRow, TColumns> & {
  viewportSource: BrunoTableServerSource<TViewport>;
  editable?: never;
  getRowVersion?: never;
  onSaveEdits?: never;
};

type BrunoTableSourceStatus = "loading" | "ready" | "stale" | "closed" | "error";

type BrunoTableSourceChrome = {
  readonly totalRows: number;
  readonly version: number;
  readonly status: BrunoTableSourceStatus;
  readonly statusCode?: string | undefined;
  readonly message?: string | undefined;
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
- `getRowId` is mandatory; row indexes are never identities.
- `columns` is a stable typed array.
- `initialFilters` is an optional one-time baseline for internally owned Grid Filter state. Valid restored user preferences take precedence. Later prop changes never overwrite user changes; Clear removes all Grid Filters, while Reset returns to this baseline.
- `quickFilterFields` is an optional explicit non-empty tuple of string-valued Query Fields. BrunoTable never infers it from visible columns or accepts Column Identities in its place. Omitting it means the table has no Quick Filter capability.
- `initialPersistedState` is an optional one-time, versioned, JSON-safe snapshot obtained by the application. BrunoTable sanitizes it against `tableId`, current columns, capabilities, and codecs before the table becomes interactive. It is not a controlled prop; later prop changes do not overwrite user state.
- `onPersistChange` receives the complete current JSON-safe snapshot after each committed Grid Filter, sort, column-order, visibility, width, or pinning change. It does not fire for Quick Filter, Source Constraint, Feed Route, selection, scroll, or edit state, and it does not echo initial restoration. BrunoTable neither awaits the callback nor interprets its return value; publishing, retries, failure handling, Kafka, View Server, and every other storage concern belong to the application.
- `clientSource` is one coherent rows-and-lifecycle value; do not spread its fields into individual table props.
- Client and Viewport Sources expose the same lifecycle chrome. The shared view owns loading, stale, closed, and error presentation; the row-pipeline Adapters own only their different payloads and lifecycles.
- A ready or stale Client Source is complete only when `rows.length === totalRows`. Treat a mismatch as a configuration error rather than silently applying supposedly global operations to a partial collection.
- Preserve unchanged row references between source versions and replace only changed rows.
- `loading` with no rows shows the loading overlay. `stale`, `closed`, or `error` with retained rows keeps those rows visible and adds the appropriate non-destructive status treatment.
- `viewportSource` is a long-lived source, not a row array copied into React state.
- `BrunoTableServer` exposes no Row Selection or Cell Range Selection interface: no checkbox column, selected-row callback/state, Shift-click row selection, Select All, or range operation. Its only cell cursor is the private logical Active Cell used by navigation and single-loaded-cell copy.
- `BrunoTableClient` Cell Range Selection is permanently limited to zero or one contiguous Linear Cell Range: horizontal `1×N` or vertical `N×1`. No prop, callback, command, or state shape can represent a two-axis target, additive ranges, subtractive holes, or disconnected regions; a new selection replaces the previous range.
- Both variants expose one continuous virtual row space. Do not add pagination, page-index, page-size, cursor, fetch-next-page, or load-more props.
- Internal server windows may compile to `offset` and `limit`, but those values never enter the public interface or persisted grid state.
- Optional children render inside the grid provider as page-specific toolbar content. When absent, no toolbar region is mounted.
- Client Row Selection is an explicit opt-in capability and defaults off. Its enabled header checkbox addresses the complete currently filtered Client row model, never only mounted rows. Stable selected Row Identities survive being filtered out, while header-checkbox state reflects only the current filtered set. Select All snapshots the matching identities at that gesture; later inserts are not auto-selected and deleted rows are pruned. The Server interface exposes no corresponding capability.
- Do not replace children composition with page-specific boolean props or expose TanStack state to custom toolbar components.

Persistence is callback-based rather than storage-adapter based:

```tsx
<BrunoTableServer
  tableId="orders"
  getRowId={getOrderRowId}
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
- Source Constraints define the page's working set before grid filters, are supplied by the application/source integration, and are not persisted or cleared as grid preferences.
- Toolbar placement alone changes neither ownership nor persistence.

For effect-view-server leased topics, keep Feed Route ownership separate from both categories above. The source declaration owns the exact non-empty Route Field tuple. `BrunoTableServer` receives only the current exact `routeBy` value object, inferred conditionally from `viewportSource`: leased sources require all and only their declared fields, while materialized and source-free sources forbid the prop. Do not expose a duplicated `routeByFields` list.

The View Server Adapter snapshots `routeBy` with exact source semantics and carries it unchanged into every `viewport.replace(...)` query. It never derives route values from columns, Grid Filters, Set Filters, loaded rows, or Source Constraints. Route Fields need not be projected or represented by visible columns. A meaningful route change replaces the complete sparse logical row space but does not alter or persist compatible user grid preferences.

## Strict editable capability

Only `BrunoTableClient` accepts the discriminated editing capability, shaped conceptually as:

```ts
type BrunoTableSaveChangeSet<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> = readonly [
  BrunoTableSaveChange<TRow, TColumns, TRowVersion>,
  ...BrunoTableSaveChange<TRow, TColumns, TRowVersion>[],
];

type BrunoTableSaveEditsHandler<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> = (
  changes: BrunoTableSaveChangeSet<TRow, TColumns, TRowVersion>,
) => PromiseLike<BrunoTableSaveResult<TRow, TColumns, TRowVersion>>;

type BrunoTableReadOnlyCapability = {
  editable?: false;
  getRowVersion?: never;
  onSaveEdits?: never;
};

type BrunoTableEditableCapability<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> =
  BrunoTableEditableColumnId<TColumns> extends never
    ? never
    : {
        editable: true;
        getRowVersion: (row: TRow) => TRowVersion;
        onSaveEdits: BrunoTableSaveEditsHandler<TRow, TColumns, TRowVersion>;
      };

type BrunoTableEditingCapability<TRow, TColumns extends BrunoTableColumns<TRow>, TRowVersion> =
  BrunoTableReadOnlyCapability | BrunoTableEditableCapability<TRow, TColumns, TRowVersion>;
```

`editable` is a capability discriminant, not a styling toggle: TypeScript makes `getRowVersion` and `onSaveEdits` mandatory when true and rejects both otherwise. The return type of `getRowVersion` is inferred without a repeated JSX generic and becomes the exact `expectedVersion` and result-version type throughout the Save Workflow. Exact literal columns that contain no potentially editable Column Identity make the editable branch `never`; widened runtime inputs receive the corresponding runtime diagnostic. This avoids impossible half-configured Client states while allowing the same columns to be reused by a read-only Client or Server Table. `BrunoTableServerProps` makes `editable`, `getRowVersion`, and `onSaveEdits` `never` so Viewport editing cannot be enabled accidentally.

Use `onSaveEdits`, not `onEditSaveClick`: the operation represents persistence regardless of whether the Save Workflow came from a pointer, keyboard, accessibility activation, Immediate transaction, Batch Save, or retry. The exact save-item and result discriminants remain to be finalized, but they must retain exact row, Column Identity, editable-value, and `getRowVersion` return-type correlation without `any` or `unknown` in inference paths.

The handler always receives the same non-empty array:

- Immediate Cell Edit Commit normally supplies one change.
- Immediate paste and drag fill supply every change in one transaction-level call.
- Batch Save supplies the accumulated net dirty cells, coalescing repeated edits of one cell rather than exposing undo history.

`editable: true` automatically renders BrunoTable's top-right Edit Mode toggle and persistent Edit Safety Footer in `BrunoTableClient`. Static column capability controls toggle visibility; never scan rows or execute row predicates globally. The footer owns Reset and Save, conflict/validation presentation, progress, and entry into conflict resolution; pages do not receive drafts or reproduce the workflow with toolbar children. `BrunoTableServer` renders none of this chrome even when shared columns declare potential editability.

Edit Mode belongs to the end user, not the consumer interface. Do not expose default or controlled Edit Mode props. Each table session starts in Immediate mode; the top-right switch changes internal session state only. Switching is blocked while edit-owned work or saving is active. Reset is internal grid intent and requires no consumer callback. Only a ready-to-persist transition invokes `onSaveEdits`; unresolved conflicts and blocking validation enter their BrunoTable-owned review UI first.

## Mandatory column identity

Every leaf column definition requires an explicit `columnId` from this namespace:

```ts
type BrunoTableColumnId = `COL_ID_${Uppercase<string>}`;
```

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

The target `withDefaults` interface must preserve literal identity, exact field/value correlation, computed getter return types, and typed callbacks without casts or repeated row generics. Prove those properties with source and emitted-package type tests before exporting the helpers.

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
{
  columnId: "COL_ID_DOUBLE_QUANTITY",
  headerName: "Double quantity",
  valueType: "bigint",
  fields: ["quantity"],
  valueGetter: ({ row }) => row.quantity * 2n,
}
```

The return type of `valueGetter` is the column value type. Every dependency must be a valid row field, and the getter's `row` parameter is restricted to `Pick<TRow, TFields[number]>`; accessing an undeclared field must fail TypeScript. The Server Table unions this tuple into its explicit `select` projection, while the Client Table uses the same declaration over its complete resident row.

Computed raw columns and typed Column Helpers must preserve the getter's inferred return type in `valueFormatter`, `cellClassName`, and `cellRenderer` without exposing `unknown`. The exact plain-object type machinery must be proven before export; do not weaken any presentation callback merely to accept the property.

A Computed Column is presentation-only in V1. It is always excluded from `BrunoTableFilterableColumnId<TColumns>`, `BrunoTableSortableColumnId<TColumns>`, and `BrunoTableEditableColumnId<TColumns>`. BrunoTable never executes, inspects, or reverse-engineers arbitrary JavaScript to manufacture query or mutation semantics.

### Field and computed definitions are exclusive

The definition accepts exactly one of `field` or non-empty `fields` plus `valueGetter`. Supplying both paths, neither path, an empty dependency tuple, or `fields` without a getter is invalid. Use a Field Column plus `valueFormatter` when only presentation differs.

## Capability derivation

The exact column tuple should derive:

```ts
type BrunoTableColumnIdOf<TColumns> = ...;
type BrunoTableColumnValue<TColumns, TColumnId> = ...;
type BrunoTableEditableColumnId<TColumns> = ...;
type BrunoTableFilterableColumnId<TColumns> = ...;
type BrunoTableSortableColumnId<TColumns> = ...;
```

Having a `field` plus the required Value Type semantics makes a column eligible for default field-based query semantics. Filtering and sorting UI are enabled by default for such a Field Column, with explicit per-column opt-outs. A Computed Column remains excluded unless it declares explicit capability-specific semantics.

Capabilities must remove invalid columns from their state models. A Computed Column cannot appear in filter, sort, or edit state merely because a caller writes its `columnId`.

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

An open Set Filter is a live surface. Client Tables derive its values and counts from the complete locally processed row model. Server Tables acquire a narrow live facet subscription over the complete result domain rather than the loaded viewport window. The facet applies Source Constraints, Feed Route, Quick Filter, and every other active Grid Filter while excluding its own current column filter. Closing the surface releases the subscription. Incoming values and count changes update the open surface immediately without notifying the table root or body.

Filter edits auto-apply through a 150 ms TanStack Pacer debounce and expose no Apply or Reset buttons inside the overlay. Grid Filters from different columns always combine with `AND`. Compound `AND`, `OR`, or `NOT` expressions may combine conditions only within one Column Identity; Quick Filter retains its separate OR-across-eligible-fields semantics. Source Constraints keep their own query-expression model and are not Grid Filters.

Quick Filter eligibility comes only from the table's explicit `quickFilterFields` tuple. Every member must be a string-valued Query Field valid for `TRow`; visible columns, hidden columns, Column Identities, and column order do not implicitly change the tuple. The committed search text compiles to one `contains` leaf per configured field, those leaves combine with `OR`, and that group combines with Source Constraints and Grid Filters through `AND`. Client Tables evaluate the expression against their complete resident rows. Server Tables send the field-keyed expression to the View Server; filtering by a field does not require displaying a column for it. Both the field tuple and committed text are session-only: neither is persisted nor included in a saved view, and every new Table Instance starts with an empty Quick Filter. A `BrunoTableQuickFilter` rendered without the capability is a development-time configuration error rather than an automatic search over every text column.

TanStack Table's column-filter state may coordinate simple header-filter UI internally, but it is not BrunoTable's persisted filter contract.

## Sort state

Grid sort state also uses `columnId`:

```ts
const sorting = [
  { columnId: "COL_ID_PRICE", direction: "desc" },
  { columnId: "COL_ID_SYMBOL", direction: "asc" },
] satisfies BrunoTableSortBy<typeof columns>;
```

Array order is sort priority. A column without valid sort semantics cannot appear in this type.

## View Server translation

The View Server Translation Adapter compiles current grid state immediately before replacing the viewport query:

```text
grid filter leaf          current column definition       View Server condition
columnId + type + value   columnId -> field               field + type + value

grid sort                 current column definition       View Server order
columnId + direction      columnId -> field               field + direction
```

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

On restoration, sanitize every persisted filter and sort against:

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
- The Adapter must include infrastructure fields required by canonical row identity and live reconciliation.
- A Computed Column contributes every member of its explicit non-empty `fields` dependency tuple.
- Its getter receives only those declared fields at the public TypeScript boundary.

Do not invoke `getRowId` or `valueGetter` against fabricated rows to guess projection dependencies.

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
- local grouping and aggregation when enabled
- client transactions and the final processed row sequence

The Viewport Row Pipeline owns:

- the sparse indexed row store and loaded ranges
- View Server filter, sort, and projection translation
- query generations and stale-response rejection
- total-row state, range requests, block caching, and eviction

The shared filter and sort UI dispatches the same grid commands in both variants. For example, a header never checks the row-model kind:

```text
filter UI -> filters.replace command -> validated grid filter state
                                      -> Client Adapter: recompute local row model
                                      -> Viewport Adapter: compile and replace server query

sort UI   -> sorting.replace command -> validated grid sort state
                                      -> Client Adapter: recompute local row model
                                      -> Viewport Adapter: compile and replace server query
```

Do not implement a public `BrunoTableBase` or a shared renderer with `if (mode === ...)` branches. An internal React wrapper may exist, but `BrunoTableView` is the more precise role: it consumes a stable runtime interface and does not know which Adapter produced it.

## TanStack Table seam

TanStack Table v9 is an implementation detail behind BrunoTable's interface:

- `columnId` maps to TanStack's explicit column `id`.
- `field` maps to its direct accessor semantics.
- BrunoTable never accepts TanStack's header- or accessor-derived identity fallbacks.
- The client variant installs client filtered and sorted row models.
- The viewport variant keeps filtering and sorting state/UI features but uses manual processing; the Viewport Source supplies already processed sparse rows.
- Filter and sort state may use external atoms for fine-grained ownership and query generation.

Consumers should not need to register TanStack features or manipulate its table instance for the common grid path.

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

Edit and conflict models remain discriminated by exact `columnId`:

```ts
type BrunoTableCellChange<TColumns> = {
  [TColumnId in BrunoTableColumnIdOf<TColumns>]: {
    rowId: BrunoTableRowId;
    columnId: TColumnId;
    before: BrunoTableColumnValue<TColumns, TColumnId>;
    after: BrunoTableColumnValue<TColumns, TColumnId>;
  };
}[BrunoTableColumnIdOf<TColumns>];
```

The same correlation applies to `baseValue`, `serverValue`, and `userValue` in conflicts. Avoid public `columnId: string` plus `unknown` value shapes.

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
- `getRowVersion` return inference flows into every expected and returned Row Version without consumer casts or repeated JSX generics
- read-only capability rejects `onSaveEdits`
- read-only Client and Server Tables reject `getRowVersion`
- consumer props cannot set or control Edit Mode; the user-owned session starts Immediate
- `onSaveEdits` receives a non-empty, value-correlated Save Change Set in both Edit Modes
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
- the visual treatment and retry actions for Client Source lifecycle states
- the exact `BrunoTableSaveChange` and `BrunoTableSaveResult` shapes after optimistic-concurrency fields are declared; the non-empty change-set handler, strict `editable` capability, two Edit Modes, owned mode toggle, and footer behaviour are accepted

These decisions must extend the accepted small interface rather than restoring an intermediate grid-definition object.
