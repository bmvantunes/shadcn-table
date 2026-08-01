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

## Operating modes

The grid has two independent dimensions.

### Row model

- Client row model
- Server viewport row model

### Editing

- Read-only
- Editable

This creates four valid combinations:

| Row model       | Read-only | Editable |
| --------------- | --------: | -------: |
| Client          |       Yes |      Yes |
| Server viewport |       Yes |      Yes |

Editing must not be coupled to the row model.

## Client row model

The client receives the complete dataset.

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

The client row model may apply transactions without replacing the full row array.

## Server viewport row model

The grid represents a logical indexed row space where only visible and nearby ranges are loaded.

The server owns:

- filtering
- sorting
- row count
- range loading
- global row position
- canonical saved values
- optimistic concurrency decisions

The UI presents infinite scrolling. There is no visible page navigation.

The grid internally requests indexed ranges based on the visible viewport and overscan.

## Mandatory identity

Every grid requires:

```ts
tableId: string;
getRowId: (row: TRow) => RowId;
```

Every column requires a stable ID.

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

## Right-side tool rail

Vertical space is premium.

Use a compact right-side tool rail rather than a permanent top toolbar.

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

## Edit footer

Editable batch grids should have a persistent bottom footer showing:

- unsaved change count
- conflict count
- validation error count
- revert action
- save action

The conflict count must be clickable.

Clicking it opens the same conflict-resolution UI used when Save encounters unresolved conflicts.

Users must be able to resolve conflicts before attempting to save.

## Selection and server-side capability policies

Server mode cannot assume all selected rows are loaded.

Represent selection logically, but distinguish selection from operations over the selection.

Possible capability states:

```ts
type ServerGridCapabilities = {
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

Logical focus must survive DOM unmounting caused by virtualization.

## Undo, redo, clipboard, and fill

All edits should normalize to transactions:

```ts
type GridEditTransaction = {
  id: string;
  source: "cell-edit" | "paste" | "drag-fill" | "clear";
  changes: readonly CellChange[];
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
