# Grid requirements

## Product goal

Build a dense, desktop-class data grid that feels native under heavy usage and improves on AG Grid in several areas:

- global visibility of active filters and sorts
- proactive conflict resolution
- mandatory identities
- better TypeScript inference
- explicit server-side capability policies
- coherent keyboard navigation across pinned columns, headers, and body
- React Compiler compatibility
- 120 Hz interaction targets

## TypeScript strictness

BrunoTable must compile under the repository's full strict profile, including exact optional properties and unchecked indexed-access protection.

The public interface must:

- expose no `any`
- preserve literal Column Identity and per-column value types
- reject invalid fields, operators, values, source props, and capability combinations
- correlate edit, validation, and conflict values with their exact Column Identity
- require no casts for ordinary valid usage
- decode persisted and external values at runtime instead of asserting them into trusted types

Every public inference guarantee requires source-level type tests and an emitted-package consumer test.

Grid Filter state is internally owned in V1. An optional typed `initialFilters` prop supplies the one-time baseline for a new Table Instance; it is not a React-controlled value and later prop changes do not overwrite user intent. Valid persisted filters take precedence during restoration. Clearing produces no Grid Filters, while resetting returns to `initialFilters`. A Server condition that users must not remove is an External Filter rather than an Initial Grid Filter.

Every table requires a non-empty typed `initialOrderBy` keyed by Column Identity. Each `columnId` must be the exact literal union of sortable identities inferred from that table's `columns` tuple, so consumers receive autocomplete and compile-time rejection of unknown, misspelled, computed, or explicitly nonsortable identities. Duplicate identities do not require specialized compile-time tuple validation; one-time normalization retains their first, highest-priority occurrence. A valid non-empty persisted `orderBy` wins during restoration; otherwise the grid uses the initial baseline. Later prop changes do not control current ordering, and Reset returns to `initialOrderBy`. Active sorting may contain any number of entries from one through the number of sortable columns; UI and command surfaces may add or remove entries within that range but must disable or reject removal of the final entry. No table state, command, persistence document, or UI cycle may represent an empty unsorted order.

## Public export naming

Every BrunoTable-owned public export carries the `BrunoTable` brand. Exported types, components, classes, helpers, and constants use the `BrunoTable...` form, including foundational types such as `BrunoTableColumnId`, `BrunoTableRegion`, and `BrunoTableSortBy`. Separate packages keep their own vocabulary; `@bruno/shadcn/button` exports `Button`.

Do not export names such as `BrunoColumnId`, `GridRegion`, `GridSorting`, or other bare grid vocabulary. Concise unprefixed names may exist internally, but they must be renamed before crossing the package boundary. Type-level export-surface tests must prevent accidental unprefixed exports.

## Operating modes

The public row-model variants have deliberately different editing capabilities.

### Row model

- Client row model through `BrunoTableClient`
- Server viewport row model through `BrunoTableServer`

### Editing

- `BrunoTableClient` may be read-only or editable.
- `BrunoTableServer` is always read-only.

This creates three valid combinations:

| Row model       | Read-only | Editable |
| --------------- | --------: | -------: |
| Client          |       Yes |      Yes |
| Server viewport |       Yes |       No |

Viewport editing, drafts, conflicts, paste, drag fill, and local undo/redo are intentionally absent. An incomplete sparse row space cannot honestly retain or operate on every affected cell. Shared column definitions may still contain `isEditable` declarations for reuse by `BrunoTableClient`; `BrunoTableServer` does not activate them or mount editing chrome. Destructive cell Clear/Delete commands are absent from V1 in both row models.

## Live-by-default data contract

Any mounted BrunoTable surface that claims to show current source data must remain live for its complete lifetime. This applies to visible cells, row and result counts, filtering results, Quick Filter results, Set Filter values and counts, toolbar projections, conflict review, Reset Review, and every `Server now` presentation. Opening an on-demand surface acquires only the narrow source subscription it needs; closing or unmounting it releases that subscription. Do not capture a one-time array or dialog-opening snapshot and continue presenting it as current.

Live does not mean broad React subscriptions. Streaming publications update the relevant external store, and each cell, count, filter surface, or review row selects only the exact projection it renders. A live update that does not change that projection must not notify or rerender it.

Historical base values, the user's raw editor candidate, sparse drafts, undo commands, and an immutable in-flight Save Change Set are deliberate records rather than current-source displays. They remain stable until their owning workflow reconciles or discards them. Everything labelled or understood as latest server state stays subscribed and current.

Expose the row models as explicit public variants, not as a `mode` prop:

```tsx
<BrunoTableClient clientSource={orders} {...commonProps} />
<BrunoTableServer viewportSource={viewportSource} {...commonProps} />
```

Both variants use the same column definitions, filter and sort controls, rendering, keyboard-navigation infrastructure, layout, and preference model. Client-only editing and range operations install optional capabilities into the shared Grid Runtime; the Server composition root never installs them. The row-pipeline Adapter owns the differences in row processing and source lifecycle.

## Continuous scrolling contract

Both variants present one uninterrupted virtual row space. There are no pagination controls, page-number indicators, page-size selectors, page-index props, cursors, or load-more buttons in BrunoTable's public interface.

Do not register TanStack Table's row-pagination feature in either variant. `Page Up` and `Page Down` are viewport-relative keyboard navigation commands, not pagination operations.

The shared renderer owns one vertical scroll container and virtualizer:

- The Client Table virtualizes the complete locally filtered and sorted row model.
- The Server Table virtualizes the exact `totalRows` reported by the Viewport Source, renders sparse placeholders for unloaded indexes, and sends the visible range plus overscan to the source as one indexed window.

Virtualization is mandatory for both variants. Keyboard navigation addresses logical row and column coordinates independently of which cells are mounted. When a held Arrow key moves beyond the visible boundary, the renderer minimally scrolls to reveal the new Active Cell. Client reveal mounts an already resident row; Server reveal updates the active viewport window and may temporarily focus a stable loading slot until the row arrives. Neither path creates page state.

Horizontal virtualization is equally mandatory. A table with 150 centre columns must not mount all 150 cells for every visible row merely because its rows are virtualized. One grid-level horizontal virtualizer windows the currently visible centre columns; pinned-start and pinned-end columns remain mounted outside that window and participate in the same Logical Column Order. Header and body consume the same immutable column-window snapshot so widths, virtual padding, hit testing, and keyboard reveal cannot drift.

Internal range alignment, buffering, and transport `offset`/`limit` values must remain invisible implementation details. They must not become persisted state or public pagination vocabulary.

## Client row model

The client receives the complete dataset.

`BrunoTableClient` accepts a complete `clientSource`. An effect-view-server `useLiveQuery(...)` result is directly assignable by structure, but the component itself does not require Effect:

```tsx
const orders = useLiveQuery("orders", completeQuery);

<BrunoTableClient clientSource={orders} {...commonProps} />;
```

The Client Source contains `rows`, `totalRows`, `version`, `status`, optional `statusCode`, and optional `message`. Do not spread these into separate required table props. The lifecycle fields match the Viewport Source chrome so the shared view can render loading, stale, closed, and error states consistently.

Queries used as Client Sources must not use `limit` or `offset`. When a ready or stale source reports `rows.length !== totalRows`, treat it as incomplete configuration rather than silently claiming whole-dataset client operations.

The grid performs locally:

- filtering
- sorting
- optional grouping and aggregation
- virtualization
- editing
- undo and redo
- clipboard operations
- drag fill
- selection

The virtualizer count is the length of the final locally processed row model. Scrolling never slices that model into pages; virtualization limits mounted DOM, not client data ownership.

The client row model may apply transactions without replacing the full row array.

## Server viewport row model

The grid represents a logical indexed row space where only visible and nearby ranges are loaded.

`BrunoTableServer` accepts the long-lived result of `useLiveQueryViewport` as its `viewportSource`.

For an effect-view-server leased topic, its source definition remains the single authority for the non-empty exact Route Field tuple, such as `routeBy: ["region", "desk"]`. Do not repeat that tuple in BrunoTable props, columns, filters, or persisted state. The Viewport Source type must instead make `BrunoTableServer` require the current exact Feed Route value object:

```tsx
const viewportSource = useLiveQueryViewport("regionalOrders");

<BrunoTableServer
  tableId="TABLE_ID_REGIONAL_ORDERS"
  getRowId={getOrderRowId}
  columns={columns}
  viewportSource={viewportSource}
  routeBy={{ region: selectedRegion, desk: selectedDesk }}
/>;
```

The conditional public contract is strict: leased topics require every Route Field with its exact row-field value type and reject missing or extra fields; materialized and source-free topics reject `routeBy`. The root BrunoTable package remains structurally typed and does not import Effect or effect-view-server merely to enforce this capability.

The View Server Adapter snapshots the Feed Route and includes it unchanged in every `viewport.replace(...)` query together with the grid-compiled `select`, `where`, and `orderBy`. Route Fields need not have visible columns, participate in projection, or be filterable. Never derive Feed Route values from Grid Filters, Set Filters, loaded rows, Column Identity, or Query Fields.

A meaningful Feed Route change selects a new logical indexed row space. Release the previous generation, clear sparse blocks and transient focus/selection/scroll state, and begin the new route at row zero while retaining compatible user preferences. Route comparison and snapshotting belong to the effect-view-server Adapter and must preserve native exact values; do not use React object identity, generic `JSON.stringify`, or numeric coercion.

The server owns:

- filtering
- sorting
- row count
- range loading
- global row position
- canonical saved values
- optimistic concurrency decisions

The UI presents the same continuous infinite-scrolling surface as the Client Table. There is no visible or public page navigation.

The grid internally requests indexed ranges based on the visible viewport and overscan.

## Mandatory identity

Every grid requires:

```ts
type BrunoTableRowId = string;
type BrunoTableId = string;

tableId: BrunoTableId;
getRowId: (row: TRow) => BrunoTableRowId;
```

`tableId` and `columnId` are durable semantic identities and remain serializable strings. Do not use JavaScript Symbols for either: persisted preferences, diagnostics, SSR boundaries, workers, storage Adapters, and database records must be able to reproduce and inspect the same identity after a reload. Each mounted table runtime may create a private Symbol-backed Table Instance Identity for collision-free in-memory ownership, but that token is transient and never enters public state or persistence.

Two compatible mounted instances may intentionally reuse one `tableId` and therefore share persisted preferences. Development diagnostics must reject or prominently diagnose simultaneous reuse of one `tableId` with incompatible column schemas; a private Table Instance Identity keeps their runtime resources distinct regardless.

Every leaf column definition requires an explicit stable `columnId` with this type:

```ts
type BrunoTableColumnId = `COL_ID_${Uppercase<string>}`;
```

Never infer column identity from a field, header, array position, or generated counter. Lowercase or unprefixed literals must fail compilation. External values must be validated at runtime. Duplicate `columnId` values are configuration errors.

Compile and validate one stable column-definition set when constructing its table runtime. During this pass, reject every duplicate `columnId` before TanStack Table, persistence restoration, or rendering can observe the definitions. Do not rescan column identities on React renders, cell renders, or row updates. If the consumer supplies a genuinely replacement definition set, compile and validate that new set once before installing it.

Every leaf column also requires an explicit non-empty `headerName`. It is the default visible text and accessible name for the semantic column header. It is descriptive metadata, not identity: never use it for persistence, grid state, row access, or server queries, and never infer it from `columnId` or `field`. A future custom header renderer may replace the visible content, but `headerName` remains the stable human-readable fallback for accessibility and grid-owned UI. Icon-only and action columns still provide a meaningful name such as `"Actions"`, even if the renderer visually hides it.

Keep column identity separate from row data and server query fields:

```ts
{
  columnId: "COL_ID_DISPLAY_PRICE",
  field: "unitPrice",
  headerName: "Price",
  valueType: "number",
}
```

Use `columnId` for all grid state and persistence. Resolve it through the current column definition to `field` only when reading row data or compiling a server query.

A Computed Column declares a non-empty `fields` tuple together with `valueGetter`. Every dependency is a valid row field, the getter receives only the corresponding `Pick` of the row, and a Server Table adds those fields to its explicit projection. It is always non-filterable, non-sortable, and non-editable in V1.

A Field Column with valid Value Type semantics enables filtering and sorting by default. Consumers may opt either capability out explicitly per column. A Computed Column cannot opt into filtering, sorting, or editing in V1.

Indexes are positions under a query, not row identities.

Stable identity is required for:

- editing
- conflicts
- selections
- drag fill
- row updates
- server block eviction
- focus restoration
- optimistic concurrency
- live updates
- transaction history

## Column construction and presentation

Every raw value-bearing column declares an explicit runtime `valueType`. TypeScript field types are erased, the Server Table begins sparse, and behavior must never depend on which row happens to load first. Built-in Value Types initially include text, number, bigint, and boolean; typed select and optional Effect BigDecimal support add their own explicit semantics.

BrunoTable also provides optional typed Column Helpers as the recommended construction path:

- `BrunoTableTextColumn` start-aligns cell content;
- `BrunoTableNumberColumn` and `BrunoTableBigIntColumn` end-align display and editing controls;
- `BrunoTableBooleanColumn` centers its checkbox and keyboard interaction target;
- `BrunoTableSelectColumn` makes its editable control fill the available cell width;
- `BrunoTableBigDecimalColumn` is exported only from `@bruno/table/effect` and preserves exact values.

Helpers provide coherent Value Type, renderer, editor, filter, sort, clipboard, accessibility, and theme defaults but return ordinary column definitions. Raw and helper-created columns may coexist. Helpers never infer or generate `columnId`, never infer a direct server field, and never introduce a string-keyed registry or per-cell dispatch. A helper-created Computed Column still declares every projection dependency through its non-empty `fields` tuple.

Applications may specialize a helper with `withDefaults` into a reusable Column Preset for domain conventions such as Price title, fraction digits, width, alignment, editor, filter, and validation policy. Merge order is built-in helper defaults, then preset defaults, then individual column options. Presets and final columns live at module scope.

Every helper and preset retains typed per-column `valueFormatter`, `cellClassName`, and `cellRenderer` overrides. `valueFormatter` changes visible text only; conditional classes and custom rendering change Cell Presentation only. None may redefine equality, ordering, parsing, clipboard exchange, preference codecs, draft/conflict reconciliation, or server query operands. A custom display representation that must round-trip requires an explicit paired parser/exchange capability or custom Value Type.

Type tests must prove that helpers and presets preserve literal Column Identity, field/value compatibility, computed getter return values, exact callback row/value types, and individual override precedence without casts or repeated row generics. Applying a number helper to a string, bigint, or BigDecimal field must fail compilation.

## Column value semantics and exact numeric values

Every column capability that interprets a value must use one compiled Column Value Semantics plan. The same plan governs equality, ordering, canonical text, editing, client filters, clipboard exchange, preference codecs, and conflict reconciliation. `valueFormatter` is visual presentation only.

Exact numeric raw columns declare their Value Type explicitly; their corresponding helpers supply the same selection. Do not inspect or sample rows to discover it:

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

Requirements:

- native `bigint` is a root-package built-in;
- Effect `BigDecimal` is provided only through an optional Effect entry point or Adapter;
- importing `@bruno/table` must neither load Effect nor mention Effect in its emitted declarations;
- `number`, `bigint`, and BigDecimal remain separate operand domains and are never implicitly converted between one another;
- mixed numeric unions receive no automatic ordered-numeric capability;
- no exact numeric operation may pass through JavaScript `number`;
- client filtering and sorting use explicit exact functions, never TanStack automatic numeric/object inference;
- `inRange` is half-open: `filter <= value < filterTo`;
- BigDecimal equality is numeric, so differently scaled forms such as `1.5` and `1.50` are equivalent;
- unrestricted View Server BigDecimals use effect-view-server-compatible digit comparison, not Effect's scale-aligning comparator;
- a blank editor or pasted value is never silently numeric zero; nullable columns require an explicit clear representation;
- default clipboard text is locale-independent and round-trippable; display-formatted clipboard text requires an explicit paired parser;
- Drag Fill repeats source values and never requests or infers arithmetic from ordering.

Exact input parsing is an untrusted boundary. Apply bounded text and bulk-operation policies, return parse failures as data, and validate once before values enter trusted row, filter, draft, or save-result state. Mounted cells must not repeatedly reflect over value objects.

## Persistence

Persist only intentional user preferences:

- Grid Filter Expressions
- sorting
- column order
- column visibility
- column widths
- column pinning

Do not persist:

- scroll position
- server cache blocks
- viewport position
- pagination cursor
- current focus
- cell selection
- open tools panel
- drag state
- temporary edits
- conflicts
- transient errors
- validation state

Persisted state must be:

- namespaced by `tableId`
- versioned
- sanitised against current column definitions
- migration-capable
- JSON-safe
- emitted as a complete replacement snapshot through `onPersistChange`

Persisted filters, sorts, and layouts refer to `columnId`, never directly to backend fields. Server Adapters translate valid restored state through current column definitions immediately before issuing a query.

Quick Filter is the deliberate exception to filter persistence. Neither its application-provided `quickFilterFields` tuple nor its committed text is serialized, restored, or included in saved views. Every new Table Instance starts with an empty Quick Filter even when other Grid Filter preferences restore successfully.

Runtime filters retain native exact operands. Persisted exact numeric operands use a tagged codec ID, codec version, and JSON-safe canonical string. Restoration must require the current Column Identity, value-semantics codec, operator capability, and server mapping to agree; otherwise drop that filter leaf conservatively. Never stringify a native `bigint`, use a BigDecimal object's diagnostic `toJSON`, or guess a stale numeric domain from its text.

BrunoTable owns no storage adapter, provider, Local Storage access, URL synchronization, network request, Kafka producer, or retry workflow. The application may pass one optional `initialPersistedState` snapshot when mounting the Table Instance and receives the complete current snapshot through `onPersistChange` after every committed Grid Filter, sort, column-order, visibility, width, or pinning change. Restoration does not echo a callback. Quick Filter, External Filters, Feed Route, selection, scroll, and edit state never trigger it.

The callback is a non-blocking notification boundary. BrunoTable neither awaits it nor reacts to its return value or failures. Applications own publication ordering, retries, error reporting, user/tenant keys, authorization, and transport. One atomic grid command emits at most one snapshot. Pointer-move and scroll frames emit none; resize and reorder emit only on gesture commit.

`initialPersistedState` is SSR-safe. An application may load the JSON-safe snapshot on the server and pass the identical value to the first server and client renders. Sanitization is deterministic from the snapshot and current column definitions. Hydration must neither reapply the snapshot, visually jump from defaults to restored layout, access browser storage, nor invoke `onPersistChange`.

## Column management

Users must be able to:

- drag columns to reorder
- resize columns
- show and hide columns
- pin columns left or right
- reset column order
- reset widths
- reset visibility
- reset pinning
- reset the entire layout

Column dragging should use a projected layout and transform animation rather than rewriting committed order on every pointer move.

Pinned columns remain part of one logical navigation order.

## Optional toolbar composition

`BrunoTableClient` and `BrunoTableServer` accept optional children for page-specific toolbar content. When no children are supplied, render no toolbar region and consume no vertical space.

The recommended composition is:

```tsx
<BrunoTableServer {...tableProps}>
  <BrunoTableToolbar>
    <PageSpecificFilters />
    <BrunoTableQuickFilter />
    <BrunoTableToolbarSpacer />
    <BrunoTableEditActions />
  </BrunoTableToolbar>
</BrunoTableServer>
```

`PageSpecificFilters` is illustrative consumer code; no field name, filter, or toolbar position is privileged by BrunoTable.

Rules:

- Prefer children composition over `showSearch`, `showSave`, `showFilters`, or other page-specific boolean props.
- `BrunoTableToolbar` supplies consistent shadcn/Base UI layout, responsive overflow, and accessibility semantics.
- Arbitrary consumer components may appear beside BrunoTable-owned controls.
- BrunoTable-owned controls can observe semantic grid state and dispatch typed grid actions from anywhere inside the provider. This includes separately named result-row, loaded-row, selected-row, active-filter, active-sort, dirty-cell, validation, and conflict counts where the control needs them.
- Each BrunoTable-owned control consumes only the narrow state it renders; adding toolbar content must not subscribe the grid body or table root to broad changing state, and one control's update must not rerender unrelated sibling controls.
- A command-only control has zero grid-state subscriptions. Event handlers use a stable command dispatcher rather than subscribing to values needed only while handling an event.
- A search or Quick Filter input owns transient keystroke text locally. It may observe only the committed Quick Filter primitive to reflect an external reset; row-content changes must neither notify nor rerender it.
- Partition notification sources by capability. Selector equality alone is insufficient if it still causes every unrelated selector to execute for each hot row update.
- TanStack tables, atoms, stores, subscriptions, and state shapes remain private implementation details. Page-owned children do not receive them through props or context.
- The optional toolbar augments rather than replaces required overlays, the right-side tool rail, or the editable safety footer.
- A custom control must explicitly choose whether it updates persisted Grid Filter intent or application-controlled, non-persisted External Filters. BrunoTable never infers ownership from toolbar placement.

## Right-side tool rail

Vertical space is premium.

Use a compact right-side tool rail for universal grid management rather than rendering a permanent top toolbar on every table. The optional toolbar is present only on pages that compose children.

The rail should show:

- active filter count
- active sort count
- hidden-column count
- columns panel
- reset actions
- optional saved views

The grid must expose active filters globally even when their columns are horizontally scrolled away or hidden.

Suggested labels:

- Filters 3
- Sorts 2
- 4 hidden

The filters panel should support:

- reviewing all active filters
- removing individual filters
- clearing all filters

Each eligible Field Column exposes every operator supported by its Value Type and the View Server contract. Text includes equality, `in`, contains/not-contains, starts/ends-with, blank/not-blank, and case/accent sensitivity. Number, BigInt, and BigDecimal include equality, `in`, ordered comparisons, half-open `inRange`, and blank/not-blank. Boolean and other scalar domains include equality, `in`, and blank/not-blank.

Boolean and Select Field Columns use live Set Filters by default. Text, Number, BigInt, and BigDecimal Field Columns expose `in` but require explicit opt-in before mounting a live distinct-value Set Filter, because their cardinality may be unbounded. Client facets cover the complete processed Client row model. Server facets use their own live whole-result subscription and never derive values or counts from loaded sparse blocks. The open facet applies every other active Grid Filter plus External Filters while excluding its own column filter; closing it releases the subscription.

Filter changes auto-apply through a 150 ms TanStack Pacer debounce. Filter overlays contain no Apply or Reset buttons. Grid Filters across different columns always combine with `AND`; compound conditions within one column may use `AND`, `OR`, and `NOT`. Quick Filter remains a separate OR across its eligible fields.

Quick Filter is an explicit optional capability configured by a non-empty `quickFilterFields` tuple of string-valued Query Fields. BrunoTable never derives that tuple from visible columns and never accepts Column Identities in its place. Each field receives a `contains` condition, the conditions combine with `OR`, and the resulting group combines with External Filters and Grid Filters through `AND`. Both the configured fields and committed text are session-only and never persisted; a new Table Instance starts empty. Rendering a Quick Filter control without configured fields is a development-time configuration error.

`BrunoTableServer` alone accepts optional `externalFilters`. They are application-controlled, field-keyed View Server conditions and may reference valid fields without visible columns. They are always `AND`-combined with Quick Filter and Grid Filters but never persisted, counted, reviewed, reset, or cleared by BrunoTable. A semantic change starts a new viewport generation at row zero and preserves compatible preferences and Feed Route. Equivalent newly allocated input must not restart the viewport. `BrunoTableClient` rejects this prop because its complete Client Source already reflects application-owned query conditions.

Sorting cycles only between ascending and descending. A plain pointer or keyboard activation on a new column replaces the current order and starts ascending; activating the current column toggles direction. Shift-activation adds a new ascending column or toggles an existing member while preserving the other sort entries; it never removes a member. No sequence of pointer, Shift-pointer, or keyboard actions can leave zero active sorts. The sorting panel, command layer, restoration sanitizer, and reset path enforce the same invariant. Numeric columns do not default to descending first. Every sorted header and the sorting panel show direction and one-based priority.

## Table editing capability and modes

Only `BrunoTableClient` exposes the strict discriminated editing interface:

- `editable: true` requires `getRowVersion` and `onSaveEdits` and enables the Editable Table capability;
- false or omitted `editable` rejects `getRowVersion`, `onSaveEdits`, and other edit-only table props;
- at least one column must be potentially editable through `isEditable: true` or an `isEditable` predicate;
- column policy remains the authority for exact cell eligibility; the table-level capability never makes a read-only cell editable.

An Editable Client Table renders a compact `Batch editing` switch in its top-right grid chrome: off is Immediate and on is Batch. Determine its visibility from static column capability, not by evaluating predicates over the complete client dataset. The toggle subscribes only to Edit Mode and whether switching is currently legal.

The end user owns Edit Mode. Do not expose default or controlled Edit Mode props to the consumer. Each table session starts in Immediate mode, and the user's switch selection remains internal session state rather than a persisted grid preference. Block switching modes while an editor, drafts, validation, conflicts, or saving are active; never silently persist or discard work while switching.

Both modes call the same `onSaveEdits` operation with a non-empty Save Change Set:

- a normal Immediate cell commit usually sends one change;
- Immediate paste and drag fill send one atomic multi-change call;
- Batch Save sends accumulated net changes, coalesced to one entry per dirty cell.

Never split a multi-cell edit transaction into one persistence call per cell. Never expose raw undo history as the Batch Save payload.

Each Save Change Set is atomic and has no partial-success outcome. Accepted means every change was persisted; rejected means none was persisted and returns typed diagnostic and latest-server evidence. Immediate mode may have many concurrent operations over disjoint cells, and each operation may own many cells from one gesture. Lock only the owned cells for each Immediate operation. Batch Save permits only one operation and locks all edit mutations until it settles.

When a live Client row update makes `isEditable` false for a dirty cell, preserve its complete draft and history, mark it blocked with an accessible explanation, prevent further editing, and block Batch Save. Never discard it automatically. Re-enable the draft unchanged if permission returns; remove it through ordinary semantic convergence if the server reaches Mine; discard it only through explicit Reset. Evaluate only affected concrete dirty cells rather than rescanning the dataset.

Successful operations flash every affected cell green for two seconds. Immediate rejection restores every operation-owned cell to its latest live server value immediately and retains a red non-color-accessible rejected treatment for five seconds. Batch rejection preserves all drafts, conflicts, validation evidence, and undo/redo history; it unlocks editing and keeps the affected cells marked until correction, retry, successful reconciliation, or Reset. Both modes enter one table-scoped persistent failure notification workflow. Aggregate concurrent Immediate failures into one manually dismissed toast with operation-level details; do not stack a persistent toast per cell or per failure. Atomic server rejection means no submitted value was persisted, not that BrunoTable may discard a Batch.

Never retry a save automatically through XState, Effect, transport policy, or a toast action. The persistent toast is explanatory and dismissible but exposes no Retry or Save mutation. Only explicit activation of the current authoritative Save button begins another attempt, and every activation performs a fresh preflight against live values, current Row Versions, validation, and conflicts before constructing a new Save Change Set. Failure preserves the initiating surface: Conflict Review stays open when it initiated Save, while a Footer attempt that had no conflicts keeps the modal closed. A later Footer Save may open it if live reconciliation now discovers conflicts.

A thrown request, timeout, disconnect, or HTTP failure is not a typed atomic rejection and must not make the toast claim that nothing committed. Preserve the Batch and let live View Server publications reconcile the real outcome. Values that arrive equal to drafts converge and disappear from pending changes and history; different values become conflicts; absent confirmation leaves the drafts available for a later explicit Save. This live reconciliation is the authority, so BrunoTable needs no durable user-facing `unconfirmed` state.

Track convergence against each failed operation's immutable submitted cell set, not global pending-change count. Only when every submitted cell receives a semantically equal live canonical value may the persistent toast change to a non-error `Changes now reflected by the server` state. It still requires explicit dismissal. Reset, undo, or later unrelated edits neither prove nor prevent operation-specific convergence, and reconciliation must not scan the full table or draft repository.

Editable Client Tables also require `getRowVersion`, a pure function from the complete current row to its Row Version. Its return type is inferred exactly, including `bigint`, and flows into expected versions, conflicts, and save results without repeated consumer generics. The complete Client Source must retain the value even when no visible column renders it. A source result's top-level `version` is a Query Version for the complete read result and must never become a row's `expectedVersion`.

`onSaveEdits` must cross an application write or RPC seam that atomically checks the Row Version. Do not implement it by calling effect-view-server's current unconditional runtime `patch`. Successful and conflicting results return decoded canonical values and the next typed Row Version before reconciliation.

## Edit safety footer

An Editable Client Table mounts a persistent bottom Edit Safety Footer. `BrunoTableServer` never renders the Batch switch, footer, conflict workflow, or any edit-owned notification.

The left side shows conditional status controls:

- unsaved change count
- validation error count
- conflict count, only when greater than zero
- blocked-change count, only when greater than zero

The right side shows exactly two default actions:

- Reset, with the accessible name `Reset edits`
- Save

Reset clears only edit-owned state back to the latest canonical server snapshots. It does not reset filters, sorting, layout, selection, or preferences.

Activating the conflict count opens the same conflict-resolution modal and actor used when Save encounters unresolved conflicts. Save remains activatable when conflicts exist but must not invoke `onSaveEdits` until every conflict and blocking validation error is resolved.

Users must also be able to open and resolve conflicts proactively without first activating Save.

Conflict resolution supports one row or an explicit selected set. Do not expose blind global Mine or Server actions; selecting all conflicts must itself be a deliberate user gesture. One resolution action is one current-Batch undo command regardless of the selected cell count.

Activating the blocked count opens a live read-only Blocked Changes Review with Row, Column, Server now, Mine, and blocking reason. It may use explicit internal row selection for `Discard Selected Changes`. That local discard restores the selected cells to latest canonical server values, invokes no save operation, and creates one undoable Batch command regardless of selected cell count. Ordinary `Ctrl+Z` remains gesture-based and may affect a larger original paste or fill; targeted discard exists only as a rare precise escape hatch.

The footer remains present with disabled actions when no edits exist. Its controls use independent compact subscriptions; row-content updates that leave their displayed counts and booleans unchanged must not notify or rerender them.

## Selection and server-side capability policies

Keep Client Row Selection and Cell Range Selection distinct:

- Row Selection is stable Row Identity intent, usually exposed through row checkboxes or row actions.
- Cell Range Selection is one contiguous Linear Cell Range keyed by Row and Column Identity: horizontal `1×N` or vertical `N×1`, never both axes at once.

Cell Range Selection is singular, contiguous, and one-axis by permanent contract. `BrunoTableClient` owns one Active Cell plus zero or one multi-cell horizontal-or-vertical range, never a general rectangle, an array of disconnected ranges, or include/exclude operations. A new click or drag replaces the previous range. The first accepted Shift or pointer extension chooses the range axis; subsequent movement may resize or cross the stable anchor only on that axis, while perpendicular extension commands are ignored. Pointer selection remains at the Active Cell inside drag slop. Once the threshold is crossed, greater absolute horizontal displacement chooses horizontal and greater vertical displacement chooses vertical; an exact tie publishes no range until one wins. After lock, diagonal pointer movement is projected onto the selected axis: horizontal follows only the logical column and vertical follows only the logical row, so the range remains fluid without changing axes. Collapsing to the Active Cell releases the axis so a later extension may choose again. Ctrl/Cmd-modified cell gestures do not add, toggle, or subtract another region. No public interface, clipboard operation, fill operation, mutation transaction, preview, or private selection command may represent a range where both dimensions exceed one, even transiently. This restriction does not limit the separate Row Selection capability.

Pointer selection and Drag Fill do not autoscroll while the axis is pending. After acquisition, autoscroll is parallel-only: horizontal gestures may scroll the centre viewport horizontally, vertical gestures may scroll the row viewport vertically, and perpendicular edge proximity is ignored. Pinned-column geometry does not create a second scroll axis.

Escape or browser `pointercancel` cancels the active pointer gesture and immediately stops its autoscroll. Cancelling range selection restores the exact pre-gesture Active Cell and optional Linear Cell Range. Cancelling Drag Fill removes its preview and applies nothing: no draft, edit transaction, Batch undo entry, XState save operation, or `onSaveEdits` call. Gesture cancellation takes precedence over Navigation Mode Escape, so one Escape cancels the drag without also collapsing the restored range.

Pointer capture keeps a gesture authoritative when the pointer leaves the grid DOM. A normal outside pointer release completes the last visible projected result: range selection retains its projected Linear Cell Range, while Drag Fill reruns current preflight and atomically applies only its acquired valid preview. A fill release with no acquired axis, no preview, or an empty extension is a no-op and creates no transaction or user notification. Leaving the element is never itself cancellation; Escape and `pointercancel` remain the explicit cancellation paths.

If Drag Fill release preflight finds an unavailable, stale, non-editable, save-locked, unparseable, or invalid target, reject the complete fill, remove its preview, and apply nothing. Publish one bounded immutable diagnostic to a table-scoped Base UI `toast` from `@bruno/shadcn/toast` with error presentation, the title `Fill rejected`, a description naming the first deterministic user-facing row/column failure plus a bounded additional count, and Close. The toast has no Retry or mutation action, remains until dismissal or the next accepted fill, and is replaced by a later fill rejection rather than stacking per-cell messages. Rejection creates no draft, transaction, Batch history, save actor, or persistence call and never also emits a save-failure notification.

Drag Fill is repetition-only. A one-cell source repeats that source cell; a multi-cell Linear Cell Range repeats its exact source sequence cyclically along the already selected axis. The cycle is phase-aligned to the source's logical start in Logical Column Order or logical row order and uses Euclidean modulo in both directions, so extending before `[A, B]` places `B` immediately before `A`. A multi-cell source may extend only on its existing axis; an Active Cell source acquires either axis through the normal drag rule.

Drag Fill never increments or extrapolates numbers, BigInts, BigDecimals, dates, text suffixes, trends, or any other semantic series. Modifier keys do not change this behavior, and no public fill-strategy or arithmetic capability re-enables inference. Each repeated source cell supplies canonical exchange text to the target column's parser, followed by the normal complete-vector validation; incompatible heterogeneous columns therefore reject the whole fill instead of coercing or partially applying values. An application that needs generated values uses an explicit application command outside Drag Fill.

Client Row Selection is an explicit optional capability and defaults off. When enabled, its header checkbox selects or deselects the complete currently filtered Client row model, including virtualized rows that are not mounted. It never means only the visible DOM window. Selection remains keyed by stable Row Identity when filters hide selected rows; clearing or changing the filter reveals those rows still selected. The header checkbox's checked and indeterminate presentation is computed against the current filtered set rather than hidden selections. Select All records the matching Row Identities present at that user gesture; later live inserts are not silently selected, and live deletion prunes a removed identity from selection. Shift-clicking a second selectable row selects or deselects the inclusive interval from the previous row-selection anchor in the current logical display order. The Client Table can adapt TanStack Table v9's row-range handler over its complete processed row model.

One active multi-cell Linear Cell Range with at least two currently editable cells owns Excel-style traversal along its one axis. Preserve the range and cycle only its Active Cell forward with either Tab or Enter; Shift+Tab and Shift+Enter reverse the same order. Skip cells whose current policy is not editable and wrap inside the range. In Navigation Mode, range-traversal Enter moves rather than starting an editor; F2 edits the current value and printable text starts replace mode. Escape in Navigation Mode collapses the range to the Active Cell and returns to ordinary body traversal; when editing, the first Escape cancels the editor and the next collapses the range. A range with fewer than two eligible cells falls back to ordinary body behaviour.

`BrunoTableServer` exposes neither Row Selection nor Cell Range Selection: no row checkboxes, selected-row state, Shift-click row interval, header checkbox, or Select All command. It owns only one logical Active Cell for navigation and single-loaded-cell copy.

TanStack Table v9's row-range handler and cell-selection geometry are private implementation candidates. Their state, handlers, and feature types do not become BrunoTable's public contract, and neither selection kind is persisted.

Represent selection logically, but distinguish selection from operations over the selection.

The initial server capabilities are fixed rather than configurable promises the grid cannot honour:

```ts
type BrunoTableServerCapabilities = {
  cellRangeSelection: "disabled";
  clipboard: "single-loaded-cell";
  dragFill: "disabled";
  paste: "disabled";
  bulkEdit: "disabled";
  rowSelection: "disabled";
};
```

Initial recommended rules:

| Feature              | Client                       | Server viewport         |
| -------------------- | ---------------------------- | ----------------------- |
| Cell range selection | One contiguous linear range  | No                      |
| Cell edit            | Immediate or Batch           | No                      |
| Drag fill            | One locked axis              | No                      |
| Copy                 | Selected loaded linear range | Active loaded cell only |
| Paste                | Atomic one-axis targets      | No                      |
| Cell clear/delete    | No                           | No                      |
| Row selection        | Opt-in; filtered rows        | No                      |
| Undo/redo            | Current Batch only           | No                      |
| Conflicts            | Yes                          | No                      |

Do not silently perform partial operations or mount unavailable Server selection controls.

## Accessibility and keyboard navigation

Keyboard navigation is mandatory.

Pinned-start, centre, and pinned-end columns form one Logical Column Order. One horizontal key command moves exactly one navigable column, and centre scrolling reveals that destination with the minimum delta after accounting for both pinned-region widths.

Support at minimum:

- arrow keys
- Shift + arrows
- Ctrl/Cmd + arrows
- Tab and Shift+Tab
- Enter
- F2
- Escape
- Home and End
- Page Up and Page Down
- movement between headers and body
- movement across pinned and unpinned columns
- movement to virtualized cells
- movement to unloaded server rows

In an Editable Client Table, one Enter or F2 starts the focused cell from its current pre-session value when it is editable. Printable text input instead starts an eligible direct-text editor in replace mode with only the produced text as its raw candidate; it never appends to the previous value and affects only the Active Cell when a range exists. AltGr/Option characters, IME composition, and dead keys use the browser-produced text, not modifier heuristics or intermediate key values. Command shortcuts that produce no text, navigation and function keys, `Delete`, and `Backspace` do not enter replace mode. Enter, Shift+Enter, Tab, Shift+Tab, and an accepted pointer action outside the editor perform a Cell Edit Commit. After local acceptance, ordinary Enter moves one logical body row down in the same column and Shift+Enter moves one row up without wrapping. Tab moves forward and Shift+Tab moves backward through currently editable cells in Logical Column Order, skips row-specific non-editable targets, crosses pinned regions one step at a time, and wraps across logical rows. An active multi-cell Linear Cell Range with at least two eligible cells remains selected while both Tab and Enter cycle forward along its one axis; shifted forms reverse that order. Range-navigation Enter moves rather than editing, while F2 and printable text retain their edit-entry roles. Virtualizers reveal off-screen destinations and movement does not wait for Immediate persistence to settle. At the final or first eligible cell in ordinary body traversal, Tab or Shift+Tab leaves the grid through normal browser focus order instead of cycling. A rejected parse or validation stays in the editor without moving. A Cell Edit Commit updates BrunoTable's draft/transaction state and is distinct from saving to the server. Escape restores the exact pre-session value without a transaction; once no editor is open, Escape collapses range traversal to the Active Cell. Read-only Client and Server Tables use Tab to cross the accessible composite boundary rather than as internal cell navigation; in a Server Table no key starts an editor, while arrow focus and single-cell copy remain available.

Logical focus must survive DOM unmounting caused by virtualization.

## Undo, redo, clipboard, and fill

V1 supports Copy and Paste but no Cut or destructive cell Clear/Delete capability. Do not register `Ctrl/Cmd+X`, `Delete`, or `Backspace` as mutation shortcuts; do not clear cells after a browser clipboard write; and do not expose Cut or Clear/Delete through menus, commands, or the public interface. Editable Client users change a value only through an editor, an explicit paste transaction, or repetition-only Drag Fill. Deliberately entered, pasted, or repeated blank text is still subject to the destination column's explicit blank policy, parsing, atomic validation, Batch history, and save rules.

Paste is one-axis only. A clipboard source with both dimensions greater than one is rejected immediately with an explanatory toast and never enters confirmation. A 1×1 source may broadcast along the selected Linear Cell Range without confirmation. A horizontal `1×N` or vertical `N×1` source proceeds directly only when its orientation and length exactly match the selected range. Every other supported linear mismatch—including one Active Cell or the opposite selected axis—opens Paste Confirmation and proposes a source-oriented range of exactly that length, starting at the Active Cell or the current range's logical start. The user explicitly chooses `Paste {length} horizontally`, `Paste {length} vertically`, or `Cancel`; no option creates a two-dimensional target, tiles, transposes, clips, repeats a partial source, or applies along the mismatched destination axis.

Paste Confirmation uses the Base UI `AlertDialog` from `@bruno/shadcn/alert-dialog` with a required title, orientation-and-length-specific description, proposed human-readable start/end coordinates, Cancel, and one explicit Paste action. XState owns open, cancel, confirm, blocked, and applied states. Cancel/Escape restores grid focus and applies nothing. Confirm reruns complete current preflight along the proposed axis; any out-of-bounds, unavailable, non-editable, locked, invalid, or stale target keeps the dialog open with one accessible inline `Alert` reason and no redundant toast. Only successful preflight creates the atomic transaction and closes the dialog.

Every direct paste rejection outside Paste Confirmation shows one accessible table-scoped toast with its specific reason and confirms that nothing was applied. Target or value diagnostics identify the first deterministic user-facing row/column location and summarize a bounded count of additional failures rather than stacking messages or rendering an unbounded list. The toast has no Retry or mutation action, remains until dismissal or the next accepted paste, and is replaced by a later paste rejection. Mismatch dimensions and confirmed-preflight errors stay in the modal surface instead. Both are separate from operation-aware persistent save-failure notifications because rejection or cancellation creates no draft, history, save actor, or persistence call.

All edits should normalize to transactions:

```ts
type BrunoTableEditTransaction = {
  id: string;
  source: "cell-edit" | "paste" | "drag-fill" | "discard-blocked";
  changes: readonly BrunoTableCellChange[];
};
```

Undo and redo exist only during an unsaved Batch session. One user gesture is one history command: one paste or fill operation is one undo step regardless of cell count. A successful Batch Save establishes a new baseline and clears both stacks; a rejected save preserves them. Immediate mode exposes no local undo or redo.

When a live server update becomes semantically equal to a drafted cell, treat that cell as never changed in the current batch. Remove it from pending state and prune every patch for that Cell Identity from undo and redo history; remove history commands that become empty. Undo must not resurrect a value after server convergence.

Clipboard support must define:

- TSV parsing
- source orientation and length, with only 1×1 broadcast, direct rejection of two-dimensional input, and explicit confirmation for supported linear mismatch
- raw versus formatted values
- read-only columns
- invalid values
- partially loaded ranges
- large operations
- one bounded accessible direct-rejection toast, with mismatch and confirmed-preflight errors explained in Paste Confirmation instead

For exact numeric values, canonical text is the default copy/paste representation. Validate one-axis shape and target availability before parsing, then parse and validate the entire target vector before applying it; any unavailable target, invalid exact operand, or missing clear policy aborts the whole transaction. Do not apply a valid prefix. Repetition-only Drag Fill uses canonical exchange text and target parsing but never exact arithmetic.

## Validation

Separate:

- parse errors
- synchronous local validation errors
- typed atomic save rejections, including asynchronous business validation
- conflicts
- permission errors

Column definitions expose no asynchronous per-cell validator in v1. Parsing and local validation complete synchronously at gesture commit before any draft, history command, or Immediate save operation exists. Asynchronous business authority belongs to `onSaveEdits`, and rejection preserves atomic all-or-nothing semantics.

## Saved views

Persisted filters, sorts, and column layout naturally enable named views.

Distinguish:

- table identity
- view identity
- default view
- personal view
- shared view
- modified unsaved view state

Saved views are not required for the first vertical slice but the persistence model must not block them.

## Diagnostics

Provide a development diagnostics mode showing:

- visible row range
- visible column range
- loaded blocks
- mounted cell count
- query generation
- pending requests
- drafts
- conflicts
- validation errors
- render/update counts
