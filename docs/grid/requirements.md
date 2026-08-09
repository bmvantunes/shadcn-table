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

The first live `BrunoTableClient` from issue #7 always requires a non-empty typed `initialOrderBy` keyed by Column Identity and rejects a Client definition with no sortable Column Identity. The broader common and Server contract remains capability-conditional: a variant whose compiled definitions expose no sortable identity forbids `initialOrderBy` and installs no normal sorting state, persistence, command, or UI. Each enabled `columnId` must be the exact literal union of sortable identities inferred from that table's `columns` tuple, so consumers receive autocomplete and compile-time rejection of unknown, misspelled, computed, or explicitly nonsortable identities. Duplicate identities do not require specialized compile-time tuple validation; one-time normalization retains their first, highest-priority occurrence. For a sorting-capable table, a valid non-empty persisted `orderBy` wins during restoration; otherwise the grid uses the initial baseline. Later prop changes do not control current ordering, and Reset returns to `initialOrderBy`. Active sorting may contain any number of entries from one through the number of sortable columns; UI and command surfaces may add or remove entries within that range but must disable or reject removal of the final entry. Plain header activation creates one priority-one sort and toggles that column's direction when it was already present anywhere in the order; Shift-activation appends new sorts or toggles existing directions without changing priority, and the Sort panel supports pointer and keyboard priority reordering. Whenever normal sorting capability exists, no table state, command, persistence document, or UI cycle may represent an empty unsorted order.

Raw rows and grouped summaries have separate durable sorting contexts. When normal sorting capability exists, `orderBy` remains the untouched normal-row order; otherwise that context is absent. `groupOrderBy` records grouped-summary order independently. Entering grouping sanitizes a restored grouped order against the active group keys, Rows, and currently visible participating aggregate columns; when no valid entry survives, every active group key becomes ascending in Group By priority order. Grouped header, Shift-header, keyboard, panel, and command interactions mutate only `groupOrderBy` and preserve the same non-empty, direction, and priority rules as a sorting-capable normal context. Removing or reordering group keys or hiding an aggregate drops newly invalid grouped entries while retaining valid priorities; if none remain, the active group-key fallback restores a non-empty order. Clearing grouping leaves the grouped preference dormant and restores the unchanged normal `orderBy` when that context exists.

A committed sorting change resets both row models to vertical row zero while preserving horizontal scroll and column layout. It clears position-based Active Cell and Linear Cell Range state, preserves drafts and conflicts by stable Row Identity plus Column Identity, and leaves keyboard focus on the header or Sort panel control that initiated the command.

Live data that changes a current sort key may reorder rows without creating a user sorting command. It must never reset vertical scroll or transfer the Active Cell to a different Row Identity merely because that row inherited the old index. Follow `rowId + columnId` to the new position when known without forcing scroll. While a Client Cell Edit Session is active, a sort-key move keeps the edited row at the same visual Y-coordinate through immediate fixed-row-height scroll anchoring: the row enters its correct sorted index and surrounding rows move, while frame-coalesced geometry adjusts `scrollTop` by the corresponding offset delta. Do not freeze the row out of sort order, animate after it, or drive anchoring through React or XState. If a Server row moves outside the known sparse window and its new index is unavailable, clear the Active Cell while retaining focus on the grid root. A Client Linear Cell Range follows its stable row identities only while they still form one contiguous range; otherwise clear it rather than inventing a disconnected selection.

If a live update makes the active Client editor row fail current filters, keep it visible at the same anchored Y-coordinate as one temporary edit-owned presentation exception. Expose a non-color `Row no longer matches current filters` status, continue live canonical and conflict reconciliation, and preserve the raw candidate. End the exception only after valid commit or Escape, then allow the row to disappear normally. Never auto-commit or discard input merely to restore filter presentation.

If the active Client editor row is deleted from the live Source, keep an anchored tombstone that preserves the raw candidate and exposes an accessible `This row was removed from the server. Changes cannot be saved.` status. Block commit and never call `onSaveEdits` for the missing row. Permit text recovery plus Escape or an explicit accessible `Cancel editing` action. If the same Row Identity reappears before cancellation, attach the session to its latest row and Row Version and apply normal reconciliation.

Sorting while a cell editor is active must first run the normal parse-and-validation commit gate. An invalid candidate blocks the sort and restores focus to the editor. A valid Batch candidate commits locally before sorting immediately; a valid Immediate candidate begins its identity-keyed Save Operation before sorting immediately without awaiting settlement. Reordering must neither discard edit state nor orphan an operation or notification when its row leaves the mounted viewport.

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

Live does not mean broad React subscriptions. Streaming publications update the relevant external store, and each cell, count, filter surface, or review row selects only the exact projection it renders. A live update that does not change that projection must not notify or rerender it. XState actors are private decision owners rather than React sources; renderers observe only coherent BrunoTable-owned TanStack Store projections and never combine independently subscribed actor and store snapshots.

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

The shared renderer owns one native two-axis scroll container as the sole authority for offsets, viewport dimensions, measurement, hit testing, row virtualization, and centre-column virtualization. A styled Scroll Area may decorate or expose that exact viewport but must not add another scrolling element or geometry owner:

- The Client Table virtualizes the complete locally filtered and sorted row model.
- The Server Table virtualizes the exact `totalRows` reported by the Viewport Source, renders sparse placeholders for unloaded indexes, and sends the visible range plus overscan to the source as one indexed window.

Virtualization is mandatory for both variants. Keyboard navigation addresses logical row and column coordinates independently of which cells are mounted. When a held Arrow key moves beyond the visible boundary, the renderer minimally scrolls to reveal the new Active Cell. Client reveal mounts an already resident row; Server reveal updates the active viewport window and may temporarily focus a stable loading slot until the row arrives. Neither path creates page state.

Horizontal virtualization is equally mandatory. A table with 150 centre columns must not mount all 150 cells for every visible row merely because its rows are virtualized. One grid-level horizontal virtualizer windows the currently visible centre columns; pinned-start and pinned-end columns remain mounted in separate sticky regions outside that window and participate in the same Logical Column Order. Header and body consume the same immutable column-window snapshot so widths, virtual padding, hit testing, and keyboard reveal cannot drift.

Fixed-geometry keyboard reveal compares the destination bounds with the visible band after sticky header, pinned-start, and pinned-end insets, then applies only the smallest clamped scroll delta needed to expose the target. Do not use a virtualizer's nearest-index alignment for Cell navigation. A fully visible or pinned destination causes no scroll. Initial Active Cell installation is one-shot and must not replay when a virtual window rerenders.

Internal range alignment, buffering, and transport `offset`/`limit` values must remain invisible implementation details. They must not become persisted state or public pagination vocabulary.

## Client row model

The client receives the complete dataset.

`BrunoTableClient` accepts a complete `clientSource`. An effect-view-server `useLiveQuery(...)` result is directly assignable by structure, but the component itself does not require Effect:

```tsx
const orders = useLiveQuery("orders", completeQuery);

<BrunoTableClient clientSource={orders} {...commonProps} />;
```

The Client Source contains `rows`, `totalRows`, `version`, `status`, optional `statusCode`, optional `message`, and an optional source-owned Source Retry Capability. Do not spread these into separate required table props. The lifecycle fields match the Viewport Source chrome so the shared view can render loading, stale, closed, and error states consistently. The optional capability contains `run: () => void` plus source-authoritative `pending: boolean`; ordinary effect-view-server hook results remain directly assignable without it.

The shared lifecycle UI uses components from `@bruno/shadcn`. Loading without authoritative rows renders fixed-height `Skeleton` rows. Stale results retain their coherent rows, including valid empty results, under a compact persistent warning `Alert` titled `Live data delayed`. Closed results retain rows under `Live updates stopped`, or show a full-body `Empty` state when none are available. Error results retain rows under a destructive `Live data error` Alert, or show a full-body destructive Empty state without rows. Supporting status codes and messages are bounded plain text. These states are source-authoritative and non-dismissible; recovery removes them only through a later source snapshot.

Closed and error states render a shared `Retry` Button only when the source supplies the Source Retry Capability. Each explicit activation invokes `run` once. `pending` disables the button and displays the shared Spinner. BrunoTable never invents a retry, schedules automatic attempts, awaits or interprets the callback, changes lifecycle status optimistically, or reuses the control for Save Operations. Stale state has no Retry control because its still-live source owns recovery. Lifecycle chrome subscribes only to the compact source fields it renders and must not replace the Grid Runtime or rerender unrelated cells.

Queries used as Client Sources must not use `limit` or `offset`. When a ready or stale source reports `rows.length !== totalRows`, treat it as incomplete configuration rather than silently claiming whole-dataset client operations.

The grid performs locally:

- filtering
- sorting
- grouping and aggregation when configured on a read-only Client Table
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
  columns={columns}
  viewportSource={viewportSource}
  routeBy={{ region: selectedRegion, desk: selectedDesk }}
/>;
```

The conditional public contract is strict: leased topics require every Route Field with its exact row-field value type and reject missing or extra fields; materialized and source-free topics reject `routeBy`. The root BrunoTable package remains structurally typed and does not import Effect or effect-view-server merely to enforce this capability.

The View Server Adapter snapshots the Feed Route and includes it unchanged in every `viewport.replace(...)` query together with the grid-compiled `select`, `where`, and `orderBy`. Route Fields need not have visible columns, participate in projection, or be filterable. Never derive Feed Route values from Grid Filters, Set Filters, loaded rows, Column Identity, or Query Fields.

A meaningful Feed Route change selects a new logical indexed row space. Release the previous generation, clear sparse blocks and transient focus/selection/scroll state, and begin the new route at row zero while retaining compatible user preferences. Route comparison and snapshotting belong to the effect-view-server Adapter and must preserve native exact values; do not use React object identity, generic `JSON.stringify`, or numeric coercion.

Every semantic View Server query change starts a new Query Generation. Semantic inputs are the normalized Feed Route, `select`, combined `where`, `orderBy`, `groupBy`, and `aggregates`; an equivalent freshly allocated value must not restart the source. Release the old generation, invalidate all old sparse rows, identity/index mappings, and `totalRows`, reset vertical row-space state as required by the initiating command, and render fixed-height loading rows for the new required window until its first authoritative count and row deliveries arrive. Do not retain old rows beneath new filter, sort, grouping, routing, projection, or aggregate semantics, and ignore every late old-generation sink write.

The View Server Adapter owns that generation token and closes it over each sink. `setRowCount` delivery hints such as `keepRenderedRows` never create, replace, or bridge Query Generations. A compatible Viewport Source must also deactivate without synchronously invoking consumer sink updates from React insertion effects; require the upstream lifecycle correction tracked in [effect-view-server#408](https://github.com/bmvantunes/effect-view-server/issues/408) instead of deferring BrunoTable store publication.

Viewport `setWindow` changes caused by scroll, overscan, or keyboard reveal are not semantic query changes. They retain overlapping loaded slots and stable references within the active generation, render loading rows only for newly required missing indexes, and do not reset scroll or Active Cell. If one unchanged generation later becomes `stale`, `closed`, or `error` after it has published coherent rows, retain those rows under the shared non-destructive lifecycle treatment. A new generation with no accepted rows shows loading or terminal lifecycle presentation rather than reviving the previous generation. Before authoritative `totalRows` arrives, provisional loading geometry covers only the required fixed-height viewport and never claims the old count.

The server owns:

- filtering
- sorting
- grouping and aggregation when configured
- row count
- range loading
- global row position
- canonical saved values
- optimistic concurrency decisions

The UI presents the same continuous infinite-scrolling surface as the Client Table. There is no visible or public page navigation.

The grid internally requests indexed ranges based on the visible viewport and overscan.

## Grouping and aggregation execution

Grouping and aggregation are V1 capabilities only for Read-only Table Instances. They are available behind both public components because every Server Table is read-only and a Client Table is read-only when `editable` is false or omitted. An Editable Client Table exposes neither capability.

Read-only Tables share BrunoTable-owned intent, column semantics, controls, formatting, and accessibility, while their row-pipeline Adapters execute that intent differently:

- a read-only `BrunoTableClient` groups and aggregates the complete resident Client Source locally;
- `BrunoTableServer` compiles grouping and aggregation into the effect-view-server query and consumes the resulting indexed grouped rows.

An Editable Client composition does not register grouping or aggregation features, render the Group By Region, admit grouped commands, or execute local aggregates. Shared column definitions may still contain `isEditable`, `groupBy`, and `aggFunc` metadata so one tuple can be reused by different Table Instances; static metadata does not activate both capabilities together.

The Server Table must never derive a grouped result or aggregate from its loaded sparse blocks. Loaded blocks are a viewport cache, not the complete result set. A grouped Server query uses the View Server's native `groupBy` and `aggregates` contract rather than pretending grouped output is an ordinary raw-row `select` projection.

Client implementations must match the documented View Server operation and exact-value semantics for the shared built-in aggregate operations. Any capability that cannot preserve that semantic contract must fail during configuration instead of silently producing different Client and Server answers.

V1 grouping produces a flat grouped-summary table in Server and read-only Client Tables. A multi-field grouping yields one logical row per distinct ordered group-key tuple, with the group fields and configured aggregate values presented as ordinary columns in that row. V1 has no expandable group hierarchy, group disclosure controls, nested child rows, leaf-row drill-down, or per-group child loading. TanStack's local hierarchical grouped row model must not leak a different read-only Client experience; its Adapter normalizes the result to the same flat contract supplied by the View Server.

Grouped-summary identity remains private and requires no consumer callback. A read-only `BrunoTableClient` invokes its mandatory `getRowId` only for ordinary `TRow` records, then derives grouped identity from the complete ordered group-key tuple through compiled exact-value semantics because it owns the complete grouping operation. `BrunoTableServer` rejects `getRowId`; its Viewport Adapter consumes effect-view-server's authoritative row key beside every sparse raw or grouped result. It must not reverse-engineer that key from returned fields, use a viewport index, or add `getGroupedRowId` to BrunoTable. The key-delivery contract was specified in [effect-view-server#405](https://github.com/bmvantunes/effect-view-server/issues/405) and landed in [effect-view-server#407](https://github.com/bmvantunes/effect-view-server/pull/407), so Server support depends on a compatible release containing it rather than a divergent fallback.

Aggregate values, Rows, sorting, and viewport positions never participate in logical grouped identity. Aggregate-only live updates and reordering retain identity, while a changed group key removes one logical group and creates another. Entering, leaving, or changing the Group By tuple creates a new logical row generation and clears incompatible transient row-space state. Group Row Identity is not persisted.

Every Group By add, remove, or reorder resets the logical Active Cell only after deriving the new row-and-column projection. When the new projection has at least one logical row, the destination is row zero plus its first visible navigable Logical Column: the first active group-key column while grouped, or the first visible navigable column in restored base order after clearing the final key. When the authoritative result is empty, Active Cell is absent. A Server Table may target the new generation's row-zero loading slot before its data arrives, but clears the coordinate if that generation reports `totalRows === 0`.

Do not derive raw-row-to-group correspondence from the previously active row, preserve a matching field opportunistically, or translate between old and reordered group-key tuples. Client and Server use the same deterministic reset. The command resets vertical geometry to row zero and reveals the destination when the body owns focus, but never steals DOM focus from the Group By chip, panel, or other control that initiated the change. The coordinate and reveal remain transient and emit no persistence event beyond the ordinary Group By preference commit. Initial persisted grouping creates no synthetic focus during SSR or hydration; the first body-focus interaction establishes the ordinary initial Active Cell.

Live grouped publications with an unchanged Group By tuple use identity-first Active Cell reconciliation rather than the shape-reset rule. If the active Group Row Identity survives, update its logical row index and retain its valid Column Identity without auto-revealing the move. If that group disappears, target the row now occupying its previous display index; when removal was at the end, clamp to the new final row. Preserve the same grouped Column Identity when it remains visible and navigable, otherwise use the first visible navigable grouped column. Clear Active Cell only when the authoritative grouped result has no rows. The fallback creates no toast, persistence event, or row-zero jump, and a later keyboard command performs ordinary reveal if needed.

The complete Client grouped model can resolve Group Row Identity directly. The sparse Server Adapter follows an identity when the authoritative viewport delivery resolves its new index; when the active identity is no longer resolvable in the current sparse projection, it applies the same clamped previous-index fallback, which may be a stable loading slot. It never scans loaded values or reconstructs identity from group fields.

## Mandatory identity

Every grid requires a durable Table Identity. Client Tables additionally require a raw Row Identity function:

```ts
type BrunoTableRowId = string;
type BrunoTableId = string;

tableId: BrunoTableId;

type BrunoTableClientIdentity<TRow> = {
  getRowId: (row: TRow) => BrunoTableRowId;
};

type BrunoTableServerIdentity = {
  getRowId?: never;
};
```

Client `getRowId` identifies only raw source rows. Client grouped summaries are not fabricated `TRow` values and never reach this callback. Server raw and grouped identity is delivered authoritatively and out of band by its Viewport Source, so a Server consumer must not restate it.

effect-view-server is a first-party collaborating module for Server source semantics. If BrunoTable needs a missing source-owned capability, change the upstream contract and require the compatible release. Do not enlarge BrunoTable's consumer interface, duplicate schema semantics, reconstruct canonical values or keys, or ship a weaker fallback to avoid an upstream change.

`tableId` and `columnId` are durable semantic identities and remain serializable strings. Do not use JavaScript Symbols for either: persisted preferences, diagnostics, SSR boundaries, workers, storage Adapters, and database records must be able to reproduce and inspect the same identity after a reload. Each mounted table runtime may create a private Symbol-backed Table Instance Identity for collision-free in-memory ownership, but that token is transient and never enters public state or persistence.

Two compatible mounted instances may intentionally reuse one `tableId` and therefore share persisted preferences. Development diagnostics must reject or prominently diagnose simultaneous reuse of one `tableId` with incompatible column schemas; a private Table Instance Identity keeps their runtime resources distinct regardless.

Every leaf column definition requires an explicit stable `columnId` with this type:

```ts
type BrunoTableColumnId = `COL_ID_${ColumnIdFirstCharacter}${Uppercase<string>}`;
```

`ColumnIdFirstCharacter` is an ASCII uppercase letter, decimal digit, or underscore. This
non-empty first character makes `COL_ID_` fail at compile time; the remaining suffix retains
TypeScript's uppercase-string constraint. Runtime validation applies the same grammar to widened
or external strings.

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

A direct Field Column may declare two independent grouping capabilities:

- `groupBy: true` makes that column eligible to be added to the Group By Region. Absence means it cannot become an active group key through BrunoTable UI.
- `aggFunc` declares the single built-in aggregate the column contributes while another column is actively grouping. V1 accepts exactly one of `countDistinct`, `sum`, `min`, `max`, or `avg`; an array or consumer callback is not accepted.

The same column may declare both properties. When it is itself an active group key, the flat grouped row exposes its field value and does not also emit that column's aggregate. If it is not an active key while another eligible column is grouping, its configured `aggFunc` contributes the aggregate value. Two different aggregates over the same source field use two distinct column definitions with distinct Column Identities. This is a supported column-centric case, not an exceptional compatibility mode.

An Aggregate Cell retains its originating Column Identity and source `field`; BrunoTable never renames `price` to a public `averagePrice`, `minimumPrice`, or transport-derived property. The Viewport Adapter may generate one private aggregate alias per participating Column Identity to satisfy the View Server query, but it must immediately map each result back to that identity. Private aliases never enter public callbacks, grouped state, persistence, diagnostics intended for consumers, or the logical grouped row interface.

An active Group Key Cell retains the originating Column Identity and exact source-field value type but does not represent a raw row. It uses the compiled field Value Type presentation by default. A groupable Field Column may override that presentation through typed `groupKeyValueFormatter`, `groupKeyCellClassName`, and `groupKeyCellRenderer` properties receiving the exact group-key `value`, owning Column Identity, and exact `rowCount`, but no raw `TRow` or sibling Group Key evidence. Exact ordered Group Key evidence may appear only at a table-bound seam that owns the actual Column tuple.

Ordinary `valueFormatter`, conditional `cellClassName`, and `cellRenderer` callbacks are raw-row-aware and receive `TRow`, so BrunoTable must never invoke them with either grouped cell kind or a fabricated source row. Aggregate Cells use the compiled aggregate-result Value Type presentation by default. A participating column may override that presentation through typed `aggregateValueFormatter`, `aggregateCellClassName`, and `aggregateCellRenderer` properties receiving the aggregate `value`, `aggFunc`, owning Column Identity, and exact `rowCount`, but no raw `TRow` or sibling Group Key evidence. Their `value` type is derived from the column's Value Type and selected aggregate function, including result-domain changes such as `countDistinct` producing `bigint`.

Each grouped class override accepts either a static class name or a conditional function returning a class name or `undefined`. It augments Cell Presentation only and cannot redefine value equality, ordering, filtering, clipboard exchange, persistence, or query semantics. Conditional class evaluation is limited to mounted grouped cells and must not install a subscription or top-level React update.

When a column declares both `groupBy: true` and `aggFunc`, its current role selects exactly one grouped presentation path. While active in Group By it renders a Group Key Cell and uses only the group-key presentation override; its aggregate is suppressed. While inactive as a key under another grouping it renders an Aggregate Cell and uses only the aggregate presentation override.

The public type surface admits `groupKeyValueFormatter`, `groupKeyCellClassName`, and `groupKeyCellRenderer` only on definitions with `groupBy: true`, and admits `aggregateValueFormatter`, `aggregateCellClassName`, and `aggregateCellRenderer` only alongside a valid `aggFunc`. Raw definitions, Column Helpers, and Column Presets must preserve the exact callback value and context types without casts or `unknown`.

Whenever grouping is active, BrunoTable adds one visible grid-owned System Column with the default header `Rows`. Its value is the exact `bigint` count of source rows that survive current pre-group filters and belong to that flat group. The Client Adapter computes the same count locally; the Viewport Adapter always emits one native View Server `{ aggFunc: "count" }` aggregate. This both makes group size a first-class live feature and satisfies the View Server's non-empty aggregate requirement even when no consumer column declares `aggFunc`.

Row count is group metadata rather than a field aggregation. Consumers cannot declare `aggFunc: "count"`; `countDistinct` remains available because it measures distinct values of a specific field. The automatic Rows column is non-filterable in V1 because the View Server does not support aggregate-result filtering.

Rows has the reserved persisted System Column Identity `COL_ID_BRUNO_TABLE_ROWS`. Consumer definitions cannot claim that identity. Grouped sorting may target an active group key, Rows, or a visible participating aggregate column even when the corresponding raw Field Column opted out of normal-row sorting. The Viewport Adapter translates active-key identities to group fields and Rows or aggregate-column identities to private aggregate aliases immediately before query replacement; those View Server details never enter persisted state.

`BrunoTableServer` and the read-only `BrunoTableClient` branch accept optional `groupRowsColumn` configuration for this BrunoTable-owned column; Editable Client props reject it. It may provide a non-empty `headerName`, a numeric baseline `width`, an exact-`bigint` `valueFormatter`, a static or conditional `cellClassName`, and a `cellRenderer`. The presentation callbacks receive the fixed Rows Column Identity, exact count value, and ordered group-key values without a raw `TRow`. Omitted properties use the `Rows` label, compiled `bigint` presentation, and implementation-owned default width.

`groupRowsColumn` never turns Rows into a consumer definition. It cannot change the reserved identity or configure a field, Value Type, aggregate, grouping, filter, hide, edit, pin, or sort capability. Its conditional presentation executes only for mounted Rows cells and creates no subscription.

Active grouping creates a temporary derived Logical Column Order:

```text
active group-key columns in Group By order -> Rows -> participating aggregate columns
```

That is also the complete grouped projection. A consumer column participates only while it is an active group key or, when not an active key, when it explicitly declares `aggFunc`. Every other ordinary, action, or presentation-only column is temporarily omitted because a grouped row has no truthful value for it. BrunoTable never invents `first`, `last`, an arbitrary representative source value, or another implicit aggregate. Clearing grouping restores every omitted column and its durable preferences unchanged.

`aggFunc` remains optional. Requiring it on every definition would force meaningless domain choices and make the Server Table maintain unused live aggregates proportional to raw column count. Each Adapter computes or requests only the explicitly participating aggregate columns plus the mandatory Rows count.

Grouped presentation derives visibility without mutating the durable Column Visibility preference:

- every active group key is forced visible while active, even if its normal visibility is false;
- Rows is always visible while grouping is active;
- an aggregate column is rendered only when its normal visibility is not false;
- a hidden aggregate column remains hidden, and every temporary override disappears when grouping clears.

Forcing an active key or Rows into the grouped projection emits no visibility preference mutation. Hidden columns must not be surfaced merely because they possess aggregate semantics.

The Column Visibility control remains available while grouped and enumerates the normalized column registry rather than only currently rendered cells. The user may show or hide aggregate-capable columns; each action updates the one durable Column Visibility preference, emits the ordinary committed persistence snapshot, and remains in force after grouping clears. Active group keys are non-hideable until removed from the Group By Region, and Rows is never hideable. BrunoTable owns no separate grouped-visibility state.

Reordering two columns in the Group By Region immediately reorders both the query's ordered `groupBy` field tuple and the corresponding rendered columns. This does not rewrite the user's normal Column Order.

The Group By Region is an accessible ordered control surface, not a drag-only drop target. An Add Group combobox lists inactive columns whose definitions declare `groupBy: true`, displaying `headerName` while dispatching stable Column Identity. Each eligible column menu exposes `Group by {headerName}` while inactive and `Remove {headerName} from grouping` while active. Each active chip presents its label, position, pointer drag handle, and explicit Remove action.

When an active chip owns focus, scoped `Alt+ArrowLeft` or `Alt+ArrowRight` moves it exactly one position in the corresponding direction and retains focus on that chip. Boundary commands are no-ops. A polite live announcement reports outcomes such as `Price moved to position 2 of 3`; removal reports the label and remaining count, then focuses the nearest surviving chip or Add Group when the tuple becomes empty. Do not implement a keyboard pickup/drop mode or require a drag gesture for any grouping operation. Visible instructions and accessible descriptions disclose the reorder keys.

Pointer header-to-region addition and chip reordering dispatch the same add/move commands as the non-drag controls. Every accepted add, remove, or move replaces the ordered tuple once, produces one Group By preference commit, and creates at most one Server Query Generation. Rejection caused by stale eligibility or a no-longer-valid target leaves state unchanged and uses the initiating control's ordinary disabled/status presentation rather than a row-level toast. Grouping controls subscribe only to eligible identities and the active tuple; live row and aggregate publications never notify them.

V1 suspends all ordinary start/end Column Pinning while grouping is active. A previously pinned-start, pinned-end, or centre column participates in the single unpinned grouped order above. Entering grouping must not clear, mutate, or persist this suspension as a preference change; clearing the final group key restores the exact normal Column Order and Column Pinning state.

Ordinary header-column rearrangement is disabled while grouping is active. The user may reorder only the chips in the Group By Region. Participating aggregate columns therefore retain their relative durable base order, and no grouped drag can ambiguously mutate both a temporary layout and the normal layout.

Persistence stores that durable base `columnOrder`, the durable base `columnPinning`, and the ordered active `groupBy` Column Identities. It never stores the temporary rendered grouped order and needs no `currentOrder`, `orderBeforeFirstGroupBy`, or equivalent duplicate snapshot. Restoring a grouped table first restores the base layout and ordered grouping intent, then derives the grouped presentation. Removing the final group key after a refresh therefore reveals the exact normal order and pinning the user had before grouping.

A Computed Column declares a non-empty `fields` tuple together with `valueGetter`. Every dependency is a valid row field, the getter receives only the corresponding `Pick` of the row, and a Server Table adds those fields to its explicit projection. It is always non-filterable, non-sortable, and non-editable in V1.

A Field Column with valid Value Type semantics enables filtering and sorting by default. Consumers may set `enableFilter: false` or `enableSorting: false` independently per column. Column compilation snapshots each flag exactly once and normalizes omitted flags to `true`; the exact filterable and sortable Column Identity unions exclude only literal opt-outs. A Computed Column normalizes both capabilities to `false` and cannot declare either flag or opt into filtering, sorting, or editing in V1.

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

Helpers provide coherent Value Type, renderer, editor, filter, sort, clipboard, accessibility, and theme defaults but return ordinary column definitions. Raw Field Columns and helper-created columns may coexist. Helpers never infer or generate `columnId`, never infer a direct server field, and never introduce a string-keyed registry or per-cell dispatch. Strict Computed Columns use a global Value Type helper or equivalently typed custom constructor as the generic boundary that captures their non-empty `fields` tuple and restricts the getter row to its exact `Pick`.

Applications may specialize a helper with `withDefaults` into a reusable Column Preset for domain conventions such as Price title, fraction digits, width, alignment, editor, filter, and validation policy. Merge order is built-in helper defaults, then preset defaults, then individual column options. Presets and final columns live at module scope.

Every helper and preset retains typed per-column `valueFormatter`, `cellClassName`, and `cellRenderer` overrides. `valueFormatter` changes visible text only; conditional classes and custom rendering change Cell Presentation only. None may redefine equality, ordering, parsing, clipboard exchange, preference codecs, draft/conflict reconciliation, or server query operands. A custom display representation that must round-trip requires an explicit paired parser/exchange capability or custom Value Type.

Type tests must prove that helpers and presets preserve literal Column Identity, field/value compatibility, computed getter return values, exact callback row/value types, and individual override precedence without casts or repeated row generics. They must also prove that a Computed getter cannot read an undeclared dependency. Applying a number helper to a string, bigint, or BigDecimal field must fail compilation.

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

Exact input parsing is an untrusted boundary. Apply bounded text and bulk-operation policies, return parse failures as data, and validate once before values enter trusted row, filter, draft, Save Change Set, or Accepted Overlay state. Mounted cells must not repeatedly reflect over value objects.

## Persistence

Persist only intentional user preferences:

- Grid Filter Expressions
- normal-row and grouped-summary sorting
- ordered grouping
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

Persisted filters, both sort contexts, grouping, and layouts refer to `columnId`, never directly to backend fields or aggregate aliases. Server Adapters translate valid restored state through current column definitions immediately before issuing a query.

Rows participates only in the persisted column-width map. A committed user resize is keyed by `COL_ID_BRUNO_TABLE_ROWS`, wins over the `groupRowsColumn.width` baseline, remains dormant while grouping is inactive, and is restored when grouping resumes. Sanitization retains that width while current definitions still provide grouping capability and otherwise drops it. The reserved identity never enters persisted column order, visibility, or pinning.

An Editable Client Table has no grouping capability, so restoration also drops every persisted `groupBy` entry, `groupOrderBy`, and reserved Rows width. Restoration never installs grouping transiently, opens a review, or emits `onPersistChange`; the next committed preference notification contains the sanitized non-grouped snapshot.

Quick Filter is the deliberate exception to filter persistence. Neither its application-provided `quickFilterFields` tuple nor its committed text is serialized, restored, or included in saved views. Every new Table Instance starts with an empty Quick Filter even when other Grid Filter preferences restore successfully.

Runtime filters retain native exact operands. Persisted exact numeric operands use a tagged codec ID, codec version, and JSON-safe canonical string. Restoration must require the current Column Identity, value-semantics codec, operator capability, and server mapping to agree; otherwise drop that filter leaf conservatively. Never stringify a native `bigint`, use a BigDecimal object's diagnostic `toJSON`, or guess a stale numeric domain from its text.

BrunoTable owns no storage adapter, provider, Local Storage access, URL synchronization, network request, Kafka producer, or retry workflow. The application may pass one optional `initialPersistedState` snapshot when mounting the Table Instance and receives the complete current snapshot through `onPersistChange` after every committed Grid Filter, sort, Group By add/remove/reorder, column-order, visibility, width, or pinning change. Restoration does not echo a callback. Quick Filter, External Filters, Feed Route, selection, scroll, and edit state never trigger it.

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

While Group By is active, ordinary column reordering is temporarily unavailable; only Group By chip reordering remains enabled. This lock does not affect the durable base order or the other column-management preferences restored when grouping clears.

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

Boolean and Select Field Columns use live Set Filters by default. Text, Number, BigInt, and BigDecimal Field Columns expose `in` but require explicit opt-in before mounting a live distinct-value Set Filter, because their cardinality may be unbounded. Client facets cover the complete processed Client row model. Server facets use their own live whole-result subscription and never derive values or counts from loaded sparse blocks. The open facet applies every other active Grid Filter plus External Filters while excluding its own column filter; closing it releases the subscription. A value explicitly retained by current inclusion or exclusion intent remains visible and reversible at count zero so source changes never mutate committed filter intent. Reappearance restores its live count; absent values with no explicit intent may disappear.

Both variants may render checkbox options and value-level Select All inside a Set Filter overlay. In a Server Table these controls select filter values only and do not violate the separate prohibition on row checkboxes, Row Selection, or row Select All.

Set Filter partial state retains whether the user means `only these` inclusion or `everything except these` exclusion. Select All removes the column filter. A user who begins from none and individually selects every currently available value reaches that identical no-filter state on the final selection; BrunoTable never persists an exhaustive `in` list as a substitute for no restriction. Future facet values follow the current mode, while passive facet changes never normalize or rewrite user intent.

Clear All commits empty inclusion intent and therefore matches no current or future row. Client evaluation has an explicit false predicate. Server translation requires the source-native Match-None Filter Expression tracked in [effect-view-server#409](https://github.com/bmvantunes/effect-view-server/issues/409); an empty `in` no-op or a negation of current facet values is not an acceptable substitute.

Continuous text and numeric filter input auto-applies through a 150 ms TanStack Pacer debounce. Discrete Set Filter checkbox changes and operator changes with valid required operands apply immediately. Select All and Clear All are each one atomic command with at most one query generation and one `onPersistChange` callback, never a loop over visible values. Filter overlays contain no Apply or Reset buttons. Grid Filters across different columns always combine with `AND`; compound conditions within one column may use `AND`, `OR`, and `NOT`. Quick Filter remains a separate OR across its eligible fields.

Filter overlays own raw input drafts locally and parse them through exact column semantics before publishing a debounced filter command. Invalid Number, BigInt, BigDecimal, range, or custom scalar input shows an accessible inline error while preserving the last valid committed filter. It causes no Client row recomputation, Server query, persistence callback, or focus trap. Escape and outside close discard the invalid draft and restore the last committed value.

Built-in JavaScript Number editors and filter inputs use `<input type="number" step="any">` as a native first-line floating-point guard, then inspect native bad-input state and run BrunoTable's Number Value Semantics before commit. BigInt and BigDecimal use text inputs with appropriate numeric or decimal `inputMode` and exact semantic parsing; never pass either through `valueAsNumber`. Native control behavior reduces invalid input but never replaces column validation, blank policy, range checks, or custom domain rules.

Every user Grid Filter, Quick Filter, Clear, and Reset command first runs the active Client editor's normal parse-and-validation commit gate. Invalid input rejects the filter command and restores editor focus. A valid Batch candidate commits locally before immediate filtering; a valid Immediate candidate starts its identity-keyed save operation before immediate filtering without awaiting settlement. If the closed editor row is then hidden, drafts remain represented in the Edit Safety Footer and failures remain represented in the persistent notification workflow.

Existing Batch drafts, conflicts, blocked records, validation, and undo/redo history do not prevent subsequent filtering or require confirmation when dirty rows become hidden. Edit Safety Footer counts, Save preflight, and Conflict, Blocked, and Reset Reviews always cover their complete sparse collections, independent of current filters and virtualization. Grid Filter and Quick Filter changes, Clear, and Reset never mutate edit-owned state.

Quick Filter is an explicit optional capability configured by a non-empty `quickFilterFields` tuple of string-valued Query Fields. BrunoTable never derives that tuple from visible columns and never accepts Column Identities in its place. Each field receives a `contains` condition, the conditions combine with `OR`, and the resulting group combines with External Filters and Grid Filters through `AND`. Both the configured fields and committed text are session-only and never persisted; a new Table Instance starts empty. Rendering a Quick Filter control without configured fields is a development-time configuration error.

`BrunoTableServer` alone accepts optional `externalFilters`. They are application-controlled, field-keyed View Server conditions and may reference valid fields without visible columns. They are always `AND`-combined with Quick Filter and Grid Filters but never persisted, counted, reviewed, reset, or cleared by BrunoTable. A semantic change starts a new viewport generation at row zero and preserves compatible preferences and Feed Route. Equivalent newly allocated input must not restart the viewport. `BrunoTableClient` rejects this prop because its complete Client Source already reflects application-owned query conditions.

Sorting cycles only between ascending and descending. A plain pointer or keyboard activation on a new column replaces the current order and starts ascending. Plain-activating a column already present at any priority makes it the sole priority-one sort and toggles its current direction. Shift-activation adds a new ascending column or toggles an existing member while preserving the other sort entries and its priority; it never removes a member. No sequence of pointer, Shift-pointer, or keyboard actions can leave zero active sorts. The sorting panel, command layer, restoration sanitizer, and reset path enforce the same invariant. Numeric columns do not default to descending first. Every sorted header and the sorting panel show direction and one-based priority.

## Table editing capability and modes

Only `BrunoTableClient` exposes the strict discriminated editing interface:

- `editable: true` requires `getRowVersion` and `onSaveEdits` and enables the Editable Table capability;
- false or omitted `editable` rejects `getRowVersion`, `onSaveEdits`, and other edit-only table props;
- at least one column must be potentially editable through `isEditable: true` or an `isEditable` predicate;
- column policy remains the authority for exact cell eligibility; the table-level capability never makes a read-only cell editable.

`editable: true` also selects the no-grouping branch. TypeScript rejects `groupRowsColumn`; the composition root installs no grouping or aggregation machinery; and restored Group By preferences are sanitized away. Column definitions may retain dormant grouping metadata for reuse by a different read-only Table Instance.

An Editable Client Table renders a compact `Batch editing` switch in its top-right grid chrome: off is Immediate and on is Batch. Determine its visibility from static column capability, not by evaluating predicates over the complete client dataset. The toggle subscribes only to Edit Mode and whether switching is currently legal.

The end user owns Edit Mode. Do not expose default or controlled Edit Mode props to the consumer. Each table session starts in Immediate mode, and the user's switch selection remains internal session state rather than a persisted grid preference. Block switching modes while an editor, drafts, validation, conflicts, either bounded Batch history stack, or saving are active; a zero-draft state may still retain Redo intent. Never silently persist or discard work while switching.

Both modes call the same `onSaveEdits` operation with a non-empty Save Change Set:

- a normal Immediate cell commit usually sends one change;
- Immediate paste and drag fill send one atomic multi-change call;
- Batch Save sends accumulated net changes, coalesced to one entry per dirty cell.

Never split a multi-cell edit transaction into one Save Operation per cell. Never expose raw undo history as the Batch Save payload.

The handler returns only `PromiseLike<void>`. Resolution means the application accepted the complete atomic Save Operation; rejection means the call failed. It returns no canonical row, Row Version, validation details, conflicts, or result discriminant. Canonical values and versions arrive only through the live Client Source. Rejections use ordinary user-safe `Error` messages; BrunoTable normalizes unknown values to a bounded generic explanation and exports no save-error type.

The Save Change Set is a non-empty tuple of row changes. Each row change carries `rowId`, the latest safely rebased immutable `baseRow`, its exact `expectedVersion`, and a non-empty `BrunoTableSaveCellChangeSet`. Every cell change preserves exact `columnId`, source `field`, `before`, and `after` correlation. The payload contains no projected `afterRow`, Edit Mode, gesture, initiating surface, or other UI metadata. The same source field may still be represented by distinct Column Identities without becoming ambiguous to either the application or BrunoTable.

Every Save activation performs safe row-level rebase before constructing that payload. Compare each edited field's latest canonical value with its recorded Base through compiled semantic equality. Only when every edited field remains equal may BrunoTable refresh `baseRow`, `expectedVersion`, and exact `before` values together to the latest row. Any divergence enters Conflict Review. This permits cells first edited under different source versions to become one coherent row patch without weakening the application's atomic compare-and-set. Row Versions are opaque equality tokens; no logic assumes that they numerically increase.

Each Save Change Set is atomic and has no partial-success application outcome. Immediate mode may have many concurrent operations over disjoint Cell Identities, and each operation may own many cells from one gesture. Lock only the complete owned cell set until Promise rejection or post-resolution live reconciliation; other cells, including another cell in the same row, may save concurrently. A same-row compare-and-set rejection is the accepted cost of aggressive Immediate editing and must not introduce a hidden queue. Batch Save permits only one operation and holds a table-wide edit mutation lock from invocation through rejection or complete post-resolution live reconciliation. Sorting, filtering, scrolling, navigation, menus, inspection, and Copy remain enabled because neither lock disables non-editing interaction. Bound the operation repository: retain pending, awaiting-source, and rejected submitted evidence only while reconciliation or notification needs it, then remove completed records after their flash or notification lifecycle.

Promise resolution immediately clears submitted Batch drafts, conflicts, validation evidence, and undo/redo history; returns the footer to zero pending changes; starts the two-second success flash; and creates Accepted Overlays for submitted values. An overlay is not a draft and has no timeout. It yields to authoritative source state when the live value semantically equals `after`, the Row Version differs from `expectedVersion`, or the row disappears from a complete ready or stale Client Source. The latest live row then wins even when the application normalized a value or a later update already superseded it. Immediate cells unlock independently as each affected row reconciles; Batch releases its global edit lock only when every submitted row reconciles. Source stale/closed/error chrome explains delayed confirmation.

Disappearance of an Immediate operation's Row Identity before Promise settlement changes nothing about the operation. Wait for `onSaveEdits`; the disappearance neither proves success nor failure and must not trigger cancellation, retry, or a phantom row. After resolution, authoritative disappearance is reconciliation and releases the corresponding locks. A Batch operation counts the missing row toward complete global-lock release.

When a live Client row update makes `isEditable` false for a dirty cell, preserve its complete draft and history, mark it blocked with an accessible explanation, prevent further editing, and block Batch Save. Never discard it automatically. Re-enable the draft unchanged if permission returns; remove it through ordinary semantic convergence if the server reaches Mine; discard it only through explicit Reset. Evaluate only affected concrete dirty cells rather than rescanning the dataset.

When a row with committed Batch drafts disappears from the Client Source, retain its sparse drafts and undo/redo history as blocked missing-row work without projecting a phantom body row. Include the affected cells in the Edit Safety Footer blocked count and live Blocked Changes Review, disable Batch Save, and permit explicit gesture undo, targeted discard, or Reset. If the same Row Identity returns before removal, reconnect its latest row and Row Version and resume normal convergence and conflict evaluation.

Resolved operations flash every currently mounted affected cell green for two seconds and never emit a success toast; an affected cell outside the mounted viewport completes quietly. Immediate rejection restores every unconverged operation-owned cell to its latest live server value immediately and retains a red non-color-accessible rejected treatment for five seconds. Batch rejection preserves all unconverged drafts, conflicts, validation evidence, and undo/redo history; it unlocks editing and keeps affected cells marked until correction, retry, live reconciliation, or Reset. Both modes enter one table-scoped persistent failure notification workflow. Aggregate concurrent Immediate failures into one manually dismissed toast with operation-level details; do not stack a persistent toast per cell or per failure. Promise rejection never authorizes BrunoTable to discard a Batch or claim that canonical data remained unchanged.

Never retry a save automatically through XState, Effect, transport policy, or a toast action. The persistent toast is explanatory and dismissible but exposes no Retry or Save mutation. Its Close control must remain named, focusable, and visible to assistive technology. Only explicit activation of the current authoritative Save button begins another attempt, and every activation performs a fresh preflight against live values, current Row Versions, validation, and conflicts before constructing a new Save Change Set. Failure preserves the initiating surface: Conflict Review stays open when it initiated Save, while a Footer attempt that had no conflicts keeps the modal closed. A later Footer Save may open it if live reconciliation now discovers conflicts.

A rejected request, timeout, disconnect, HTTP failure, or ordinary application error must not make the toast claim that canonical data remained unchanged. Preserve unconverged Batch work and let live View Server publications reconcile the real outcome. Values that arrive equal to drafts converge and disappear from pending changes and history; different values become conflicts; absent confirmation leaves the drafts available for a later explicit Save. This live reconciliation is the authority, so BrunoTable needs no durable user-facing `unconfirmed` state.

Track convergence against each rejected operation's immutable submitted cell set, not global pending-change count. When every submitted cell receives a semantically equal live canonical value, authoritative evidence supersedes the ambiguous rejection: remove that operation's failure toast and remaining edit evidence and use the ordinary success presentation. Partial independent convergence removes only matching drafts and history patches. Reset, undo, or later unrelated edits do not prove operation-specific convergence, and reconciliation must not scan the full table or draft repository.

Editable Client Tables also require `getRowVersion`, a pure function from the complete current row to its Row Version. Its return type is inferred exactly, including `bigint`, and flows into expected versions, conflicts, and Accepted Overlays without repeated consumer generics. The complete Client Source must retain the value even when no visible column renders it. A source result's top-level `version` is a Query Version for the complete read result and must never become a row's `expectedVersion`.

`onSaveEdits` must cross an application write or RPC seam that atomically checks each Row Version. Do not implement it by calling effect-view-server's current unconditional runtime `patch`. The application boundary resolves or rejects with no row payload; decoded canonical values and new Row Versions return through the live Client Source.

## Edit safety footer

An Editable Client Table mounts a persistent bottom Edit Safety Footer. `BrunoTableServer` never renders the Batch switch, footer, conflict workflow, or any edit-owned notification.

The footer spans the grid width and preserves both the centre-column and virtual-row viewport. Do
not install a permanent edit side ledger or docked bottom inspector. Complete sparse collections
open through on-demand live Conflict, Blocked, Reset, or operation-detail reviews.

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

The footer remains present with disabled actions when no edits exist. After a Batch Promise resolves and before all submitted rows reconcile, the left side shows `Save accepted · waiting for live confirmation` plus a compact remaining-row count while Reset and Save remain disabled. Its controls use independent compact subscriptions; row-content updates that leave their displayed counts and booleans unchanged must not notify or rerender them.

## Selection and server-side capability policies

Keep Client Row Selection and Cell Range Selection distinct:

- Row Selection is stable Row Identity intent, usually exposed through row checkboxes or row actions.
- Cell Range Selection is one contiguous Linear Cell Range keyed by Row and Column Identity: horizontal `1×N` or vertical `N×1`, never both axes at once.

Cell Range Selection is singular, contiguous, and one-axis by permanent contract. `BrunoTableClient` owns one Active Cell plus zero or one multi-cell horizontal-or-vertical range, never a general rectangle, an array of disconnected ranges, or include/exclude operations. A new click or drag replaces the previous range. The first accepted Shift or pointer extension chooses the range axis; subsequent movement may resize or cross the stable anchor only on that axis, while perpendicular extension commands are ignored. Pointer selection remains at the Active Cell inside drag slop. Once the threshold is crossed, greater absolute horizontal displacement chooses horizontal and greater vertical displacement chooses vertical; an exact tie publishes no range until one wins. After lock, diagonal pointer movement is projected onto the selected axis: horizontal follows only the logical column and vertical follows only the logical row, so the range remains fluid without changing axes. Collapsing to the Active Cell releases the axis so a later extension may choose again. Ctrl/Cmd-modified cell gestures do not add, toggle, or subtract another region. No public interface, clipboard operation, fill operation, mutation transaction, preview, or private selection command may represent a range where both dimensions exceed one, even transiently. This restriction does not limit the separate Row Selection capability.

A committed Client Cell Range owns the exact ordered identity span selected at that moment. A horizontal range records its one Row Identity and the ordered visible navigable Column Identities between its endpoints; a vertical range records its one Column Identity and the ordered displayed Row Identities between its endpoints. A value-only source publication that reuses that span preserves the range, including grouped aggregate-value and Rows-count updates. A sort, filter, column visibility/order change, or live source publication reconciles the range only when it changes the relevant structural projection. Retain the range when the exact ordered span remains equal, even if rows or columns outside it changed. If either endpoint disappears or any identity inside the span is inserted, removed, replaced, or reordered, cancel any active range gesture and autoscroll and clear the range before a later Copy, Paste, fill, or traversal command can observe it. Never keep stable TanStack corner identities and silently expand them over a different intervening sequence.

Structural reconciliation publishes at most one narrow range-selection update and no toast, dialog, or persistence event. Clearing the range retains its Active Cell when that coordinate is still valid; otherwise the existing Active Cell reconciliation policy applies. The row/column structural owner must distinguish value publications from ordered-identity changes so live values do not enumerate or invalidate a large range on every update. A clipboard command validates the range against one current immutable structural snapshot before resolving values; a mismatch clears the stale range and copies nothing rather than serializing a retargeted or partial span. Once accepted, the command captures one Clipboard Snapshot and cannot switch to a newer structural or value version partway through the payload.

A grouped read-only Client Table retains Cell Range Selection because the complete flat grouped result is resident. It may select and copy one horizontal or vertical sequence across Group Key, Aggregate, and Rows cells, including virtualized cells that are not currently mounted. Copy resolves every value through the same compiled clipboard exchange semantics used by ordinary cells; it never substitutes `valueFormatter` display text, a private View Server alias, or a fabricated raw row. Rows therefore copies canonical exact `bigint` text, and aggregate values retain their compiled result domains.

Every Group By add, remove, or reorder changes the logical row/column shape and is a hard Cell Range Selection boundary. Before publishing the new projection, cancel any active range gesture, release pointer capture, stop autoscroll, and clear the previous range in the same Grid Command. Do not reinterpret its old corner identities through the new render order or retain it dormant. Once the new projection is active, the user may create a fresh grouped range. Because the Table Instance is read-only, a grouped range supports selection and Copy only—never Paste, Drag Fill, editing, or another mutation command. Clearing the final Group By key applies the same reset before returning to ordinary Client rows.

Pointer selection and Drag Fill do not autoscroll while the axis is pending. After acquisition, autoscroll is parallel-only: horizontal gestures may scroll the centre viewport horizontally, vertical gestures may scroll the row viewport vertically, and perpendicular edge proximity is ignored. Pinned-column geometry does not create a second scroll axis.

Escape or browser `pointercancel` cancels the active pointer gesture and immediately stops its autoscroll. Cancelling range selection restores the exact pre-gesture Active Cell and optional Linear Cell Range. Cancelling Drag Fill removes its preview and applies nothing: no draft, edit transaction, Batch undo entry, XState save operation, or `onSaveEdits` call. Gesture cancellation takes precedence over Navigation Mode Escape, so one Escape cancels the drag without also collapsing the restored range.

Pointer capture keeps a gesture authoritative when the pointer leaves the grid DOM. A normal outside pointer release completes the last visible projected result: range selection retains its projected Linear Cell Range, while Drag Fill reruns current preflight and atomically applies only its acquired valid preview. A fill release with no acquired axis, no preview, or an empty extension is a no-op and creates no transaction or user notification. Leaving the element is never itself cancellation; Escape and `pointercancel` remain the explicit cancellation paths.

If Drag Fill release preflight finds an unavailable, stale, non-editable, save-locked, unparseable, or invalid target, reject the complete fill, remove its preview, and apply nothing. Publish one bounded immutable diagnostic to a table-scoped Base UI `toast` from `@bruno/shadcn/toast` with error presentation, the title `Fill rejected`, a description naming the first deterministic user-facing row/column failure plus a bounded additional count, and Close. The toast has no Retry or mutation action, remains until dismissal or the next accepted fill, and is replaced by a later fill rejection rather than stacking per-cell messages. Rejection creates no draft, transaction, Batch history, save actor, or Save Operation and never also emits a save-failure notification.

Drag Fill is repetition-only. A one-cell source repeats that source cell; a multi-cell Linear Cell Range repeats its exact source sequence cyclically along the already selected axis. The cycle is phase-aligned to the source's logical start in Logical Column Order or logical row order and uses Euclidean modulo in both directions, so extending before `[A, B]` places `B` immediately before `A`. A multi-cell source may extend only on its existing axis; an Active Cell source acquires either axis through the normal drag rule.

Drag Fill never increments or extrapolates numbers, BigInts, BigDecimals, dates, text suffixes, trends, or any other semantic series. Modifier keys do not change this behavior, and no public fill-strategy or arithmetic capability re-enables inference. Each repeated source cell supplies canonical exchange text to the target column's parser, followed by the normal complete-vector validation; incompatible heterogeneous columns therefore reject the whole fill instead of coercing or partially applying values. An application that needs generated values uses an explicit application command outside Drag Fill.

Client Row Selection is an explicit optional capability and defaults off. When enabled, its header checkbox selects or deselects the complete currently filtered Client row model, including virtualized rows that are not mounted. It never means only the visible DOM window. Selection remains keyed by stable Row Identity when filters hide selected rows; clearing or changing the filter reveals those rows still selected. The header checkbox's checked and indeterminate presentation is computed against the current filtered set rather than hidden selections. Select All records the matching Row Identities present at that user gesture; later live inserts are not silently selected, and live deletion prunes a removed identity from selection. Shift-clicking a second selectable row selects or deselects the inclusive interval from the previous row-selection anchor in the current logical display order. The Client Table can adapt TanStack Table v9's row-range handler over its complete ungrouped processed row model.

Row Selection applies only to ordinary ungrouped Client source rows. Activating the first Group By key atomically clears every selected Row Identity and the Shift-selection anchor before the grouped projection becomes visible. Grouped summaries render no row-selection column, row checkbox, header Select All, Shift-click interval, selected-row count, bulk row action, or command that could imply a group or its hidden member rows are selected. Selection is not retained as dormant state, and clearing the final Group By key restores the optional capability with an empty selection and no anchor.

This transition is one Grid Command: if selection was non-empty, its narrow selection source publishes one empty snapshot; Group By persistence still emits its ordinary single complete preference snapshot, while selection itself remains unpersisted. Entering grouping requires no confirmation or toast because the explicit grouping action changes the displayed row domain and discards only transient selection intent.

One active multi-cell Linear Cell Range with at least two currently editable cells owns Excel-style traversal along its one axis. Preserve the range and cycle only its Active Cell forward with either Tab or Enter; Shift+Tab and Shift+Enter reverse the same order. Skip cells whose current policy is not editable and wrap inside the range. In Navigation Mode, range-traversal Enter moves rather than starting an editor; F2 edits the current value and printable text starts replace mode. Escape in Navigation Mode collapses the range to the Active Cell and returns to ordinary body traversal; when editing, the first Escape cancels the editor and the next collapses the range. A range with fewer than two eligible cells falls back to ordinary body behaviour.

`BrunoTableServer` exposes neither Row Selection nor Cell Range Selection: no row checkboxes, selected-row state, Shift-click row interval, header checkbox, or row Select All command. It owns only one logical Active Cell for navigation and single-loaded-cell copy. Set Filter value checkboxes and value Select All remain permitted because they produce a filter expression rather than selected rows.

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

In an Editable Client Table, one Enter or F2 starts the focused cell from its current pre-session value when it is editable. Printable text input instead starts an eligible direct-text editor in replace mode with only the produced text as its raw candidate; it never appends to the previous value and affects only the Active Cell when a range exists. AltGr/Option characters, IME composition, and dead keys use the browser-produced text, not modifier heuristics or intermediate key values. Command shortcuts that produce no text, navigation and function keys, `Delete`, and `Backspace` do not enter replace mode. Enter, Shift+Enter, Tab, Shift+Tab, and an accepted pointer action outside the editor perform a Cell Edit Commit. After local acceptance, ordinary Enter moves one logical body row down in the same column and Shift+Enter moves one row up without wrapping. Tab moves forward and Shift+Tab moves backward through currently editable cells in Logical Column Order, skips row-specific non-editable targets, crosses pinned regions one step at a time, and wraps across logical rows. An active multi-cell Linear Cell Range with at least two eligible cells remains selected while both Tab and Enter cycle forward along its one axis; shifted forms reverse that order. Range-navigation Enter moves rather than editing, while F2 and printable text retain their edit-entry roles. Virtualizers reveal off-screen destinations and movement does not wait for an Immediate Save Operation to settle. At the final or first eligible cell in ordinary body traversal, Tab or Shift+Tab leaves the grid through normal browser focus order instead of cycling. A rejected parse or validation stays in the editor without moving. A Cell Edit Commit updates BrunoTable's draft/transaction state and is distinct from saving to the server. Escape restores the exact pre-session value without a transaction; once no editor is open, Escape collapses range traversal to the Active Cell. Read-only Client and Server Tables use Tab to cross the accessible composite boundary rather than as internal cell navigation; in a Server Table no key starts an editor, while arrow focus and single-cell copy remain available.

Logical focus must survive DOM unmounting caused by virtualization.

When an active read-only body cell contains interactive custom-renderer content, Enter or F2 moves
focus from the grid root to its first same-document interactive descendant. Embedded browsing
contexts remain outside ordinary Tab order but are excluded from automatic entry because their
keyboard events cannot bubble to the grid. All interactive descendants remain outside ordinary Tab
order so virtualization cannot create unstable tab stops. Escape returns focus to the grid root
without changing the Active Cell; same-document nested controls otherwise retain their native key
behavior.

## Undo, redo, clipboard, and fill

V1 supports Copy and Paste but no Cut or destructive cell Clear/Delete capability. Do not register `Ctrl/Cmd+X`, `Delete`, or `Backspace` as mutation shortcuts; do not clear cells after a browser clipboard write; and do not expose Cut or Clear/Delete through menus, commands, or the public interface. Editable Client users change a value only through an editor, an explicit paste transaction, or repetition-only Drag Fill. Deliberately entered, pasted, or repeated blank text is still subject to the destination column's explicit blank policy, parsing, atomic validation, Batch history, and save rules.

Paste is one-axis only. A clipboard source with both dimensions greater than one is rejected immediately with an explanatory toast and never enters confirmation. A 1×1 source may broadcast along the selected Linear Cell Range without confirmation. A horizontal `1×N` or vertical `N×1` source proceeds directly only when its orientation and length exactly match the selected range. Every other supported linear mismatch—including one Active Cell or the opposite selected axis—opens Paste Confirmation and proposes a source-oriented range of exactly that length, starting at the Active Cell or the current range's logical start. The user explicitly chooses `Paste {length} horizontally`, `Paste {length} vertically`, or `Cancel`; no option creates a two-dimensional target, tiles, transposes, clips, repeats a partial source, or applies along the mismatched destination axis.

Paste Confirmation uses the Base UI `AlertDialog` from `@bruno/shadcn/alert-dialog` with a required title, orientation-and-length-specific description, proposed human-readable start/end coordinates, Cancel, and one explicit Paste action. XState owns open, cancel, confirm, blocked, and applied states. Cancel/Escape restores grid focus and applies nothing. Confirm reruns complete current preflight along the proposed axis; any out-of-bounds, unavailable, non-editable, locked, invalid, or stale target keeps the dialog open with one accessible inline `Alert` reason and no redundant toast. Only successful preflight creates the atomic transaction and closes the dialog.

Every direct paste rejection outside Paste Confirmation shows one accessible table-scoped toast with its specific reason and confirms that nothing was applied. Target or value diagnostics identify the first deterministic user-facing row/column location and summarize a bounded count of additional failures rather than stacking messages or rendering an unbounded list. The toast has no Retry or mutation action, remains until dismissal or the next accepted paste, and is replaced by a later paste rejection. Mismatch dimensions and confirmed-preflight errors stay in the modal surface instead. Both are separate from operation-aware persistent save-failure notifications because rejection or cancellation creates no draft, history, save actor, or Save Operation.

All edits should normalize to transactions:

```ts
type BrunoTableEditTransaction = {
  id: string;
  source: "cell-edit" | "paste" | "drag-fill" | "discard-blocked";
  changes: readonly BrunoTableCellChange[];
};
```

Undo and redo exist only during an unsaved Batch session. One user gesture is one history command: one paste or fill operation is one undo step regardless of cell count. A successful Batch Save establishes a new baseline and clears both stacks; a rejected save preserves them. Immediate mode exposes no local undo or redo.

One Batch History Command represents one user gesture and stores reversible sparse before-and-after Draft and Conflict state for every affected Cell Identity. Do not reduce it to displayed value pairs or copy full canonical rows/store snapshots: Mine may rebase a Base without changing presentation, while Server may remove the Draft. Keep both stacks bounded.

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

Copy is one atomic read operation. After structural preflight succeeds, capture the selected identities and every canonical source value from one coherent immutable row/group/edit projection, serialize the complete TSV exclusively from that Clipboard Snapshot, and pass the already-finalized string to the browser clipboard API. Live source, aggregate, Rows-count, draft, or conflict publications that occur during serialization or while the asynchronous browser write is pending may update the grid but never alter the captured values or produce a half-old/half-new payload. Copy installs no live subscription, blocks no incoming updates, and never retries against a newer projection automatically. If an optimized large-range serializer yields between chunks, every chunk must still read the same retained Clipboard Snapshot.

For exact numeric values, canonical text is the default copy/paste representation. Validate one-axis shape and target availability before parsing, then parse and validate the entire target vector before applying it; any unavailable target, invalid exact operand, or missing clear policy aborts the whole transaction. Do not apply a valid prefix. Repetition-only Drag Fill uses canonical exchange text and target parsing but never exact arithmetic.

Grouped read-only Client ranges use this same canonical Copy path for their locally resident Group Key, Aggregate, and Rows values. They add no grouped Paste or fill path. Server raw and grouped results remain limited to copying the single loaded Active Cell.

## Validation

Separate:

- parse errors
- synchronous local validation errors
- rejected atomic Save Operations, including asynchronous business validation reported through a user-safe `Error`
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
