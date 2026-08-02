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

## Public export naming

Every BrunoTable-owned public export carries the `BrunoTable` brand. Exported types, components, classes, helpers, and constants use the `BrunoTable...` form, including foundational types such as `BrunoTableColumnId`, `BrunoTableRegion`, and `BrunoTableSortBy`. Separate packages keep their own vocabulary; `@bruno/shadcn/button` exports `Button`.

Do not export names such as `BrunoColumnId`, `GridRegion`, `GridSorting`, or other bare grid vocabulary. Concise unprefixed names may exist internally, but they must be renamed before crossing the package boundary. Type-level export-surface tests must prevent accidental unprefixed exports.

## Operating modes

The grid has two independent dimensions.

### Row model

- Client row model through `BrunoTableClient`
- Server viewport row model through `BrunoTableServer`

### Editing

- Read-only
- Editable

This creates four valid combinations:

| Row model       | Read-only | Editable |
| --------------- | --------: | -------: |
| Client          |       Yes |      Yes |
| Server viewport |       Yes |      Yes |

Editing must not be coupled to the row model.

## Live-by-default data contract

Any mounted BrunoTable surface that claims to show current source data must remain live for its complete lifetime. This applies to visible cells, row and result counts, filtering results, Quick Filter results, Set Filter values and counts, toolbar projections, conflict review, Reset Review, and every `Server now` presentation. Opening an on-demand surface acquires only the narrow source subscription it needs; closing or unmounting it releases that subscription. Do not capture a one-time array or dialog-opening snapshot and continue presenting it as current.

Live does not mean broad React subscriptions. Streaming publications update the relevant external store, and each cell, count, filter surface, or review row selects only the exact projection it renders. A live update that does not change that projection must not notify or rerender it.

Historical base values, the user's raw editor candidate, sparse drafts, undo commands, and an immutable in-flight Save Change Set are deliberate records rather than current-source displays. They remain stable until their owning workflow reconciles or discards them. Everything labelled or understood as latest server state stays subscribed and current.

Expose the row models as explicit public variants, not as a `mode` prop:

```tsx
<BrunoTableClient clientSource={orders} {...commonProps} />
<BrunoTableServer viewportSource={viewportSource} {...commonProps} />
```

Both variants use the same column definitions, filter and sort controls, rendering, keyboard navigation, selection, clipboard, and editing experience. The row-pipeline Adapter behind the shared Grid Runtime owns the differences in row processing and source lifecycle.

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

A `valueGetter`-only column has no automatic server filter or sort capability because it has no query field.

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

Helpers provide coherent Value Type, renderer, editor, filter, sort, clipboard, accessibility, and theme defaults but return ordinary column definitions. Raw and helper-created columns may coexist. Helpers never infer or generate `columnId`, never infer a server field, and never introduce a string-keyed registry or per-cell dispatch.

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
- arithmetic series fill is a separate optional capability and cannot be inferred merely from ordering.

Exact input parsing is an untrusted boundary. Apply bounded text and bulk-operation policies, return parse failures as data, and validate once before values enter trusted row, filter, draft, or save-result state. Mounted cells must not repeatedly reflect over value objects.

## Persistence

Persist only intentional user preferences:

- filters
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
- storage-adapter based

Persisted filters, sorts, and layouts refer to `columnId`, never directly to backend fields. Server Adapters translate valid restored state through current column definitions immediately before issuing a query.

Runtime filters retain native exact operands. Persisted exact numeric operands use a tagged codec ID, codec version, and JSON-safe canonical string. Restoration must require the current Column Identity, value-semantics codec, operator capability, and server mapping to agree; otherwise drop that filter leaf conservatively. Never stringify a native `bigint`, use a BigDecimal object's diagnostic `toJSON`, or guess a stale numeric domain from its text.

Supported storage targets should include:

- local storage
- URL
- server
- composed or layered storage

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
- A search or Quick Filter input owns transient keystroke text locally. It may observe only the committed Quick Filter primitive to reflect an external reset, controlled-state change, or restored view; row-content changes must neither notify nor rerender it.
- Partition notification sources by capability. Selector equality alone is insufficient if it still causes every unrelated selector to execute for each hot row update.
- TanStack tables, atoms, stores, subscriptions, and state shapes remain private implementation details. Page-owned children do not receive them through props or context.
- The optional toolbar augments rather than replaces required overlays, the right-side tool rail, or the editable safety footer.
- A custom control must explicitly choose whether it updates persisted Grid Filter intent or an application-owned, non-persisted Source Constraint. BrunoTable never infers ownership from toolbar placement.

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

The sorting panel should show sort priority.

## Table editing capability and modes

Both public variants expose a strict discriminated editing interface:

- `editable: true` requires `onSaveEdits` and enables the Editable Table capability;
- false or omitted `editable` rejects `onSaveEdits` and other edit-only table props;
- at least one column must be potentially editable through `isEditable: true` or an `isEditable` predicate;
- column policy remains the authority for exact cell eligibility; the table-level capability never makes a read-only cell editable.

An Editable Table renders a compact `Batch editing` switch in its top-right grid chrome: off is Immediate and on is Batch. Determine its visibility from static column capability, not by evaluating row predicates over complete client data or incomplete server data. The toggle subscribes only to Edit Mode and whether switching is currently legal.

The end user owns Edit Mode. Do not expose default or controlled Edit Mode props to the consumer. Each table session starts in Immediate mode, and the user's switch selection remains internal session state rather than a persisted grid preference. Block switching modes while an editor, drafts, validation, conflicts, or saving are active; never silently persist or discard work while switching.

Both modes call the same `onSaveEdits` operation with a non-empty Save Change Set:

- a normal Immediate cell commit usually sends one change;
- Immediate paste, drag fill, and multi-cell clear send one atomic multi-change call;
- Batch Save sends accumulated net changes, coalesced to one entry per dirty cell.

Never split a multi-cell edit transaction into one persistence call per cell. Never expose raw undo history as the Batch Save payload.

Each Save Change Set is atomic and has no partial-success outcome. Accepted means every change was persisted; rejected means none was persisted and returns typed diagnostic and latest-server evidence. Immediate mode may have many concurrent operations over disjoint cells, and each operation may own many cells from one gesture. Lock only the owned cells for each Immediate operation. Batch Save permits only one operation and locks all edit mutations until it settles.

Successful operations flash every affected cell green for two seconds. Rejected operations restore every affected cell to its latest live server value immediately, retain a red non-color-accessible rejected treatment for five seconds, and enter one table-scoped persistent failure notification workflow. Aggregate concurrent failures into one manually dismissed toast with operation-level details; do not stack a persistent toast per cell or per failure.

Editable tables also require an explicit Row Version capability. It must preserve the actual version type, including `bigint`, and the Server Table projection must include its source field even when it has no visible column. The Viewport Source's top-level `version` is a Query Version for the read result and must never become a row's `expectedVersion`.

`onSaveEdits` must cross an application write or RPC seam that atomically checks the Row Version. Do not implement it by calling effect-view-server's current unconditional runtime `patch`. Successful and conflicting results return decoded canonical values and the next typed Row Version before reconciliation.

## Edit safety footer

An Editable Table mounts a persistent bottom Edit Safety Footer in either public variant.

The left side shows conditional status controls:

- unsaved change count
- validation error count
- conflict count, only when greater than zero

The right side shows exactly two default actions:

- Reset, with the accessible name `Reset edits`
- Save

Reset clears only edit-owned state back to the latest canonical server snapshots. It does not reset filters, sorting, layout, selection, or preferences.

Activating the conflict count opens the same conflict-resolution modal and actor used when Save encounters unresolved conflicts. Save remains activatable when conflicts exist but must not invoke `onSaveEdits` until every conflict and blocking validation error is resolved.

Users must also be able to open and resolve conflicts proactively without first activating Save.

The footer remains present with disabled actions when no edits exist. Its controls use independent compact subscriptions; row-content updates that leave their displayed counts and booleans unchanged must not notify or rerender them.

## Selection and server-side capability policies

A Server Table cannot assume all selected rows are loaded.

Keep Row Selection and Cell Range Selection distinct:

- Row Selection is stable Row Identity intent, usually exposed through row checkboxes or row actions.
- Cell Range Selection is spreadsheet-style rectangular cell intent keyed by Row and Column Identity.

When Row Selection UI is enabled, Shift-clicking a second selectable row must select or deselect the inclusive interval from the previous row-selection anchor in the current logical display order. The Client Table can adapt TanStack Table v9's row-range handler over its complete processed row model. A Server Table must not delegate unloaded-range semantics to TanStack's loaded-row model and silently omit intervening rows; its declared capability must make the operation loaded-only, logical, server-assisted, or unavailable.

TanStack Table v9's row-range handler and cell-selection geometry are private implementation candidates. Their state, handlers, and feature types do not become BrunoTable's public contract, and neither selection kind is persisted.

Represent selection logically, but distinguish selection from operations over the selection.

Possible capability states:

```ts
type BrunoTableServerCapabilities = {
  rangeSelection: "disabled" | "loaded-only" | "logical";
  clipboard: "disabled" | "loaded-only" | "server-assisted";
  dragFill: "disabled" | "loaded-only" | "server-assisted";
  bulkEdit: "disabled" | "loaded-only" | "server-assisted";
  selectAll: "disabled" | "loaded-only" | "all-matching";
};
```

Initial recommended rules:

| Feature      | Client    | Server viewport          |
| ------------ | --------- | ------------------------ |
| Drag select  | Full      | Logical range            |
| Cell edit    | Full      | Loaded rows only         |
| Drag fill    | Full      | Fully loaded target only |
| Copy         | Full      | Fully loaded range only  |
| Paste        | Full      | Fully loaded target only |
| Clear/delete | Full      | Fully loaded target only |
| Select all   | Local IDs | All matching query       |
| Undo/redo    | Full      | Local edits only         |
| Conflicts    | Yes       | Yes                      |

Do not silently perform partial operations.

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

For editing, one Enter starts the focused cell when it is editable. Enter, Tab, Shift+Tab, and an accepted pointer action outside the editor perform a Cell Edit Commit; Tab then moves forward and Shift+Tab moves backward through editable cells. A Cell Edit Commit updates BrunoTable's draft/transaction state and is distinct from saving to the server.

Logical focus must survive DOM unmounting caused by virtualization.

## Undo, redo, clipboard, and fill

All edits should normalize to transactions:

```ts
type BrunoTableEditTransaction = {
  id: string;
  source: "cell-edit" | "paste" | "drag-fill" | "clear";
  changes: readonly BrunoTableCellChange[];
};
```

Undo and redo exist only during an unsaved Batch session. One user gesture is one history command: one paste or fill operation is one undo step regardless of cell count. A successful Batch Save establishes a new baseline and clears both stacks; a rejected save preserves them. Immediate mode exposes no local undo or redo.

Clipboard support must define:

- TSV parsing
- raw versus formatted values
- read-only columns
- invalid values
- partially loaded ranges
- large operations

For exact numeric values, canonical text is the default copy/paste representation. Parse and validate the entire target matrix before applying it; any unavailable target, invalid exact operand, or missing clear policy aborts the whole transaction. Do not apply a valid prefix. Copy/repeat fill may use equality and canonical text, while arithmetic series fill requires an explicit exact-arithmetic capability.

## Validation

Separate:

- parse errors
- local validation errors
- async validation errors
- server rejections
- conflicts
- permission errors

Validation must support synchronous and asynchronous rules.

Async validation must be cancellable.

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
