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
import type { TopicRow } from "effect-view-server/config";

type Order = TopicRow<typeof viewServer.topics, "orders">;

const columns = [
  {
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    isEditable: ({ row }) => row.status === "open",
    valueFormatter: ({ value }) => value.toFixed(2),
  },
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueSemantics: "bigint",
    isEditable: ({ row }) => row.status === "open",
  },
  {
    columnId: "COL_ID_STATUS",
    field: "status",
    headerName: "Status",
    isEditable: ({ row }) => row.status === "open",
  },
  {
    columnId: "COL_ID_DOUBLE_QUANTITY",
    headerName: "Double quantity",
    valueGetter: ({ row }) => row.quantity * 2n,
  },
] satisfies BrunoTableColumns<Order>;

const getOrderRowId = (row: Order) => row.id;
```

The same `columns` and `getOrderRowId` are accepted by both public variants.

Static columns should normally live at module scope. Consumers should not need `useMemo`, a column helper, or a `defineGrid` call.

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
      viewportSource={viewportSource}
    />
  );
}
```

Each component must infer `Order`, the exact column IDs, field value types, editable columns, filterable columns, and sortable columns from its `columns` and row source.

## Explicit public variants

The base properties and explicit source variants have this conceptual shape. The strict editing capability is defined below and intersects both variants:

```ts
type BrunoTableBaseProps<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  tableId: string;
  getRowId: (row: TRow) => string;
  columns: TColumns;
  children?: React.ReactNode;
};

type BrunoTableClientProps<TRow, TColumns extends BrunoTableColumns<TRow>> = BrunoTableBaseProps<
  TRow,
  TColumns
> &
  BrunoTableEditingCapability<TRow, TColumns> & {
    clientSource: BrunoTableClientSource<TRow>;
  };

type BrunoTableServerProps<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TViewport = unknown,
> = BrunoTableBaseProps<TRow, TColumns> &
  BrunoTableEditingCapability<TRow, TColumns> & {
    viewportSource: BrunoTableServerSource<TViewport>;
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
- `clientSource` is one coherent rows-and-lifecycle value; do not spread its fields into individual table props.
- Client and Viewport Sources expose the same lifecycle chrome. The shared view owns loading, stale, closed, and error presentation; the row-pipeline Adapters own only their different payloads and lifecycles.
- A ready or stale Client Source is complete only when `rows.length === totalRows`. Treat a mismatch as a configuration error rather than silently applying supposedly global operations to a partial collection.
- Preserve unchanged row references between source versions and replace only changed rows.
- `loading` with no rows shows the loading overlay. `stale`, `closed`, or `error` with retained rows keeps those rows visible and adds the appropriate non-destructive status treatment.
- `viewportSource` is a long-lived source, not a row array copied into React state.
- Both variants expose one continuous virtual row space. Do not add pagination, page-index, page-size, cursor, fetch-next-page, or load-more props.
- Internal server windows may compile to `offset` and `limit`, but those values never enter the public interface or persisted grid state.
- Optional children render inside the grid provider as page-specific toolbar content. When absent, no toolbar region is mounted.
- Do not replace children composition with page-specific boolean props or expose TanStack state to custom toolbar components.

## Optional toolbar composition

The same toolbar composition works with both public variants:

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

The toolbar is a composition seam, not a broad controller seam. Built-in toolbar controls access narrow private Grid Runtime selectors. A page-specific component should receive page-owned state through its ordinary props. When a custom control needs to own grid filter state, use the eventual typed controlled-filter interface at the table root rather than a public TanStack table or untyped imperative handle.

Controls that only dispatch user intent have no grid-state subscription. `BrunoTableQuickFilter`, for example, keeps transient input text locally and dispatches through a stable command capability. It observes only the committed Quick Filter primitive when external resets or restored views must be reflected; streaming row-content changes are outside its notification domain.

Distinguish filter ownership explicitly:

- Grid Filter Expressions and the Quick Filter are user grid intent, appear in global active-filter UI, and participate in filter persistence.
- Source Constraints define the page's working set before grid filters, are supplied by the application/source integration, and are not persisted or cleared as grid preferences.
- Toolbar placement alone changes neither ownership nor persistence.

## Strict editable capability

Both public variants accept the same discriminated editing capability, shaped conceptually as:

```ts
type BrunoTableSaveChangeSet<TRow, TColumns extends BrunoTableColumns<TRow>> = readonly [
  BrunoTableSaveChange<TRow, TColumns>,
  ...BrunoTableSaveChange<TRow, TColumns>[],
];

type BrunoTableSaveEditsHandler<TRow, TColumns extends BrunoTableColumns<TRow>> = (
  changes: BrunoTableSaveChangeSet<TRow, TColumns>,
) => PromiseLike<BrunoTableSaveResult<TRow, TColumns>>;

type BrunoTableReadOnlyCapability = {
  editable?: false;
  onSaveEdits?: never;
};

type BrunoTableEditableCapability<TRow, TColumns extends BrunoTableColumns<TRow>> =
  BrunoTableEditableColumnId<TColumns> extends never
    ? never
    : {
        editable: true;
        onSaveEdits: BrunoTableSaveEditsHandler<TRow, TColumns>;
      };

type BrunoTableEditingCapability<TRow, TColumns extends BrunoTableColumns<TRow>> =
  BrunoTableReadOnlyCapability | BrunoTableEditableCapability<TRow, TColumns>;
```

`editable` is a capability discriminant, not a styling toggle: TypeScript makes `onSaveEdits` mandatory when true and rejects edit-only props otherwise. Exact literal columns that contain no potentially editable Column Identity make the editable branch `never`; widened runtime inputs receive the corresponding runtime diagnostic. This avoids impossible half-configured states while allowing the same columns to be reused in an explicitly read-only table.

Use `onSaveEdits`, not `onEditSaveClick`: the operation represents persistence regardless of whether the Save Workflow came from a pointer, keyboard, accessibility activation, Immediate transaction, Batch Save, or retry. The exact save-item and result types remain to be finalized with the optimistic-concurrency field declaration, but they must retain exact row, Column Identity, editable-value, and version correlation without `any` or `unknown` in inference paths.

The handler always receives the same non-empty array:

- Immediate Cell Edit Commit normally supplies one change.
- Immediate paste, drag fill, and multi-cell clear supply every change in one transaction-level call.
- Batch Save supplies the accumulated net dirty cells, coalescing repeated edits of one cell rather than exposing undo history.

`editable: true` automatically renders BrunoTable's top-right Edit Mode toggle and persistent Edit Safety Footer in both variants. Static column capability controls toggle visibility; never scan rows or execute row predicates globally. The footer owns Reset and Save, conflict/validation presentation, progress, and entry into conflict resolution; pages do not receive drafts or reproduce the workflow with toolbar children.

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
}
```

The prefix deliberately distinguishes durable grid identity from a row field. The uppercase suffix keeps identifiers conspicuous and searchable in definitions, persisted fixtures, commands, and diagnostics.

Never derive `columnId` from:

- `field`
- header text
- array position
- `valueGetter`
- a generated counter

Lowercase or unprefixed literals must fail compilation under `satisfies BrunoTableColumns<TRow>`. Dynamic or restored values must be validated at runtime. `columnId` must also be unique within a table; duplicate IDs are configuration errors and must fail during table construction. The public column shape should preserve literal IDs for downstream inference, while runtime validation remains authoritative for uniqueness.

All grid-owned and persisted state uses `columnId`:

- order, width, visibility, and pinning
- filters and sorts
- focus and selection
- drafts, validation, and conflicts
- clipboard and fill transactions
- diagnostics

Persisted identity is scoped by `tableId + columnId`.

## Mandatory column name

Every leaf column definition also requires an explicit, non-empty `headerName`. It is the default visible text and accessible name for the semantic column header:

```ts
{
  columnId: "COL_ID_PRICE",
  field: "price",
  headerName: "Price",
}
```

`headerName` is descriptive metadata, not identity. Never use it for persisted state, filtering, sorting, row access, or View Server queries, and never infer it from `columnId` or `field`. Runtime normalization rejects absent, non-string, or whitespace-only names from dynamic inputs.

A future custom header renderer may replace the visible content, but `headerName` remains the stable human-readable fallback for screen readers and grid-owned UI such as menus, choosers, and conflict details. Icon-only and action columns still provide a meaningful name such as `"Actions"`; their renderer may hide the text visually without removing its semantics.

## Column kinds

### Shared definition

The minimal shared shape is conceptually:

```ts
type BrunoTableColumnBase<TRow, TValue, TColumnId extends BrunoTableColumnId> = {
  columnId: TColumnId;
  headerName: string;
  valueSemantics?: "bigint" | BrunoTableValueSemantics<TValue>;
  isEditable?: boolean | ((params: { row: TRow; value: TValue }) => boolean);
  valueFormatter?: (params: { row: TRow; value: TValue }) => string;
};
```

The implementation may normalize static and callback capabilities once, but it must not turn ordinary cell rendering into a broad state subscription.

### Column Value Semantics

Column Value Semantics are the authority whenever BrunoTable must interpret a value rather than merely read it. The normalized plan contains semantic equality, order, canonical text, parsing, a versioned preference codec, and explicit capability markers. It is compiled once and reused by editing, client filtering/sorting, clipboard, persistence, drafts, and conflicts.

Exact numeric columns select a preset rather than repeating functions:

```ts
import { BrunoTableEffectBigDecimalValueSemantics } from "@bruno/table/effect";

const columns = [
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueSemantics: "bigint",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueSemantics: BrunoTableEffectBigDecimalValueSemantics,
  },
] satisfies BrunoTableColumns<Order>;
```

The root package owns `"bigint"`. The optional `@bruno/table/effect` entry point owns `BrunoTableEffectBigDecimalValueSemantics` and has Effect as an optional peer. Importing the root entry point neither loads Effect nor exposes Effect-specific declarations.

Do not sample rows to infer exact value semantics. TypeScript value types are erased, a Server Table begins sparse, and the public effect-view-server Viewport Source does not expose runtime field semantics. A future source Adapter may supply an opaque compiled semantics registry, but explicit column semantics remain the portable interface.

Rules:

- `number`, `bigint`, and BigDecimal operands never mix implicitly.
- Mixed-domain unions have no automatic ordered-numeric capability.
- `valueFormatter` changes visual presentation only.
- Default edit and clipboard text is canonical, exact, and locale-independent.
- Blank input is resolved by an explicit nullable clear policy before numeric parsing; it is never silently zero.
- BigDecimal equality and comparison match effect-view-server, including differently scaled equal values and extreme safe scales.
- Numeric filter operators derive from semantics capabilities rather than `Extract<TValue, number | bigint>`.
- Series-fill arithmetic is an optional capability separate from comparison.

The conceptual `BrunoTableValueSemantics<TValue>` symbol is a deep interface, not an invitation for ordinary consumers to implement many callbacks. First-party built-ins and integration presets hide those details. Its final construction interface must be proven with type-level tests before export, while the `valueSemantics` column selection and exact behavior above are accepted.

### Field columns

A field column reads a real row field directly:

```ts
{
  columnId: "COL_ID_PRICE",
  field: "price",
  headerName: "Price",
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
  },
] satisfies BrunoTableColumns<Order>;
```

### Computed columns

A computed column has `valueGetter` instead of `field`:

```ts
{
  columnId: "COL_ID_DOUBLE_QUANTITY",
  headerName: "Double quantity",
  valueGetter: ({ row }) => row.quantity * 2n,
}
```

The return type of `valueGetter` is the column value type.

The initial package scaffold deliberately rejects `valueFormatter` on computed columns until the no-helper array interface can correlate a getter's inferred return type into a sibling callback without exposing `unknown`. Field-column formatters are fully typed. Do not weaken the computed formatter callback to `unknown` merely to accept the property; resolve this type-design problem before the renderer depends on it.

Accepted default rule: a `valueGetter`-only column has no automatic filtering or sorting. There is no field to send to the View Server, and BrunoTable must never execute, inspect, or reverse-engineer arbitrary JavaScript to manufacture query semantics.

A computed column may later opt into:

- an explicit client-side filter or comparator
- an explicit server filter-field mapping
- an explicit server sort-field mapping
- explicit selected field dependencies

Those are separate capabilities. They must be declared and type-checked explicitly; their final property names are not yet accepted.

Until those capabilities exist, a computed column is excluded from `BrunoTableFilterableColumnId<TColumns>` and `BrunoTableSortableColumnId<TColumns>`.

### Field and computed definitions are exclusive

The initial definition should not accept both `field` and `valueGetter`. That combination makes the displayed value, edited value, filter value, sort value, and server field ambiguous. Use a field column plus `valueFormatter` when only presentation differs.

## Capability derivation

The exact column tuple should derive:

```ts
type BrunoTableColumnIdOf<TColumns> = ...;
type BrunoTableColumnValue<TColumns, TColumnId> = ...;
type BrunoTableEditableColumnId<TColumns> = ...;
type BrunoTableFilterableColumnId<TColumns> = ...;
type BrunoTableSortableColumnId<TColumns> = ...;
```

Having a `field` makes a column eligible for default field-based query semantics. Whether the filtering or sorting UI is enabled by default is a separate product-default decision and must not be confused with whether a valid mapping exists.

Capabilities must remove invalid columns from their state models. A computed or action column without explicit filter semantics cannot appear in the filter model merely because a caller writes its `columnId`.

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
- recursive `AND` and `OR` groups
- unary `NOT`
- an implicit-AND root array
- operator and operand types derived from the column value

For example, `contains` must be rejected for a numeric column and `greaterThan` must be rejected for a nonnumeric column.

`inRange` is half-open in both variants: `filter <= value < filterTo`. Client filtering must install the compiled exact comparator instead of TanStack's inclusive `inNumberRange` helper. Runtime filters retain native typed operands; the Server Adapter changes only Column Identity to Query Field and lets effect-view-server own schema-aware transport encoding.

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
- The Adapter must include infrastructure fields required by `getRowId`, the explicit Row Version capability, and live reconciliation.
- A computed column cannot reveal its dependencies automatically.
- A computed column must eventually declare selected dependencies or map to a real server-projected field.

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
- computed columns excluded from automatic filter and sort IDs
- filter operators and operands correlated with column values
- recursive filter expressions
- sort column IDs and priority
- `isEditable` callback inference
- edit and conflict value correlation
- `editable: true` requires `onSaveEdits` and at least one potentially editable column
- read-only capability rejects `onSaveEdits`
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

- the product default for enabling filter and sort UI on eligible field columns
- the names and shapes of explicit computed-column client and server semantics
- the no-helper correlated type shape for computed-column formatters
- how computed-column selected dependencies are declared
- the exact property shape for declaring and projecting the typed Row Version; the accepted invariant is that it is row-specific and never the Viewport Source Query Version
- the visual treatment and retry actions for Client Source lifecycle states
- the exact `BrunoTableSaveChange` and `BrunoTableSaveResult` shapes after optimistic-concurrency fields are declared; the non-empty change-set handler, strict `editable` capability, two Edit Modes, owned mode toggle, and footer behaviour are accepted

These decisions must extend the accepted small interface rather than restoring an intermediate grid-definition object.
