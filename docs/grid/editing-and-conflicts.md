# Editing, validation, conflicts, and save workflow

## Editing modes

Support at least:

```ts
type BrunoTableSaveMode =
  { type: "immediate" } | { type: "debounced"; delayMs: number } | { type: "batch" };
```

The primary design focus is batch mode.

## Sparse edit model

Do not duplicate the complete dataset.

Store edits only for modified cells.

Each editable cell conceptually has:

- base value
- base version
- latest server value
- latest server version
- user draft value
- validation state
- conflict state

## Draft shape

```ts
type BrunoTableCellDraft<T> = {
  originalServerValue: T;
  originalServerVersion: string;
  editedValue: T;
  editedAt: number;
};
```

## Conflict shape

```ts
type BrunoTableCellConflict<T> = {
  baseValue: T;
  baseVersion: string;
  serverValue: T;
  serverVersion: string;
  userValue: T;
};
```

This is a three-way merge:

```text
base
server now
user draft
```

## Reconciliation cases

### User unchanged

```text
Base: 100
User: 100
Server: 102
```

Accept server.

### Server semantically unchanged

```text
Base: 100
User: 105
Server: 100
```

Keep draft.

### Both converge

```text
Base: 100
User: 105
Server: 105
```

Auto-resolve.

### Real conflict

```text
Base: 100
User: 105
Server: 102
```

Record conflict.

Equality must be column-aware.

## Visual behaviour

When a conflict arrives:

- continue showing the user's draft
- mark the cell as conflicted
- retain all three values
- expose a conflict tooltip or inspector

Validation errors and conflicts should not use indistinguishable visuals.

Define a status priority model for combinations such as:

- focused
- selected
- dirty
- invalid
- conflicted
- saving
- server-rejected
- read-only

## Edit footer

Editable batch mode has a persistent bottom footer:

```text
12 unsaved changes | 3 conflicts | 2 invalid | Revert all | Save
```

The conflict count is clickable.

Clicking it opens conflict resolution before Save.

## Conflict modal

The conflict modal should show:

| Row       | Column   | Base | Server now | Yours | Resolution |
| --------- | -------- | ---: | ---------: | ----: | ---------- |
| Order 481 | Price    |  100 |        102 |   105 | Mine       |
| Order 912 | Quantity |   50 |         40 |    60 | Server     |

Actions:

- keep mine
- accept server
- keep all mine
- accept all server values
- apply this decision to all conflicts in this column
- cancel
- apply resolutions

Use user-facing labels rather than Git terminology.

## Save workflow

```text
ready
├── validation errors -> show validation summary
├── conflicts -> open conflict modal
└── clean enough -> saving
```

After conflict choices are applied, the user may continue editing or save.

## Optimistic concurrency

The client sends expected versions.

Example row patch:

```ts
type BrunoTableRowPatch<TChanges> = {
  rowId: BrunoTableRowId;
  expectedVersion: string;
  changes: TChanges;
};
```

The server is the final concurrency authority.

Even after local conflict resolution, a newer server version may arrive before save.

"Keep mine" means:

- acknowledge the latest known server version
- submit the user value against that version
- conflict again if the version changes before commit

Do not silently force unconditional last-write-wins.

## Save results

A batch result should distinguish:

- applied rows
- conflicts
- validation failures
- permission failures
- transient failures

The server should return canonical values and new versions for applied rows.

## XState actors

Recommended actors:

### Editing actor

```text
idle
editing
dirty
validating
readyToSave
resolvingConflicts
saving
saveFailed
saved
```

### Drag selection actor

```text
idle
pointerDown
selecting
autoscrolling
committed
cancelled
```

### Drag fill actor

```text
idle
armed
dragging
previewing
validating
applying
cancelled
```

### Conflict actor

Manages:

- individual resolutions
- global resolutions
- unresolved count
- modal lifecycle
- applying decisions

Avoid one actor per cell for all rows.

Use sparse active edit state.

## Transactions

Normalize all changes:

```ts
type BrunoTableEditTransaction = {
  id: string;
  source: "cell-edit" | "paste" | "drag-fill" | "clear";
  changes: readonly BrunoTableCellChange[];
  createdAt: number;
};
```

A 5,000-cell fill is one transaction and one undo step.

Generate large fill/paste changes imperatively, then submit one meaningful actor event.

## Validation

Column definitions may provide:

- parser
- sync validator
- async validator
- server validator

Async validation must be cancellable when the user edits again.

Do not conflate validation with conflict detection.

## Server viewport restrictions

In a Viewport Table:

- cell editing requires a loaded row identity
- drag fill requires a fully loaded target unless server-assisted
- paste requires a fully loaded target unless server-assisted
- local clear/delete requires loaded targets
- drafts survive block eviction
- conflicts survive block eviction
