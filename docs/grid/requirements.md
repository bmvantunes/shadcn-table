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

tableId: string;
getRowId: (row: TRow) => BrunoTableRowId;
```

Every leaf column definition requires an explicit stable `columnId` with this type:

```ts
type BrunoTableColumnId = `COL_ID_${Uppercase<string>}`;
```

Never infer column identity from a field, header, array position, or generated counter. Lowercase or unprefixed literals must fail compilation. External values must be validated at runtime. Duplicate `columnId` values are configuration errors.

Keep column identity separate from row data and server query fields:

```ts
{
  columnId: "COL_ID_DISPLAY_PRICE",
  field: "unitPrice",
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
- false or omitted `editable` rejects `onSaveEdits`, `defaultEditMode`, and other edit-only table props;
- at least one column must be potentially editable through `isEditable: true` or an `isEditable` predicate;
- column policy remains the authority for exact cell eligibility; the table-level capability never makes a read-only cell editable.

An Editable Table renders a compact `Batch editing` switch in its top-right grid chrome: off is Immediate and on is Batch. Determine its visibility from static column capability, not by evaluating row predicates over complete client data or incomplete server data. The toggle subscribes only to Edit Mode and whether switching is currently legal.

Edit Mode is session state and is not persisted. `defaultEditMode` selects its initial value and defaults to Immediate. Block switching modes while an editor, drafts, validation, conflicts, or saving are active; never silently persist or discard work while switching.

Both modes call the same `onSaveEdits` operation with a non-empty Save Change Set:

- a normal Immediate cell commit usually sends one change;
- Immediate paste, drag fill, and multi-cell clear send one atomic multi-change call;
- Batch Save sends accumulated net changes, coalesced to one entry per dirty cell.

Never split a multi-cell edit transaction into one persistence call per cell. Never expose raw undo history as the Batch Save payload.

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

One paste or fill operation should be one undo step.

Clipboard support must define:

- TSV parsing
- raw versus formatted values
- read-only columns
- invalid values
- partially loaded ranges
- large operations

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
