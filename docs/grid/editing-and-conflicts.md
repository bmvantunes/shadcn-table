# Editing, validation, conflicts, and save workflow

## Editing modes

Support at least:

```ts
type BrunoTableSaveMode =
  { type: "immediate" } | { type: "debounced"; delayMs: number } | { type: "batch" };
```

The primary design focus is batch mode.

## Batch save capability

Both `BrunoTableClient` and `BrunoTableServer` accept an optional `onSaveEdits` operation. Its presence activates the Batch Save Capability and the BrunoTable-owned Edit Safety Footer. The name describes domain intent rather than a mouse event: pointer activation, keyboard activation, accessibility activation, or a retry all enter the same Save Workflow.

`onSaveEdits` receives the typed optimistic-concurrency request assembled from committed drafts and returns the typed save result. The exact request/result shape must preserve row, column, value, and version correlation. Effect may implement a consumer Adapter, but the public handler does not require Effect.

Column `isEditable` policies still decide which cells can enter a Cell Edit Session. The Batch Save Capability decides whether committed drafts can enter a consumer-backed Save Workflow; it does not make otherwise read-only columns editable.

## Cell edit lifecycle

A Cell Edit Session is distinct from the Save Workflow. The accepted default interaction is:

```text
focused editable cell
    -> Enter or F2
active editor
    -> Enter, Tab, Shift+Tab, or accepted outside pointer action
Cell Edit Commit
    -> sparse draft + one cell-edit transaction
```

One Enter starts editing; a double key press or double click is not required. Escape cancels the active editor without committing its candidate value.

A Cell Edit Commit parses and validates the candidate, then records it in the sparse draft model. It does not necessarily send a server mutation: immediate, debounced, and batch Save Modes decide when committed drafts enter the Save Workflow.

Tab commits and moves to the next editable cell; Shift+Tab commits and moves to the previous editable cell. Enter always commits, while any movement after Enter is a separate explicit navigation policy.

A pointer press outside the editor attempts to commit before logical focus moves or the clicked action runs. If parsing or validation rejects the candidate, the editor remains active and the candidate is preserved rather than being discarded by blur.

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

## Edit safety footer

Supplying `onSaveEdits` mounts a persistent bottom footer in either public table variant:

```text
3 conflicts · 2 invalid · 12 unsaved changes                         Reset | Save
```

The left side contains status controls and the right side contains exactly two default actions: Reset and Save. Use `Reset edits` as the accessible name when the visible label is shortened to `Reset`.

Render the conflict control only when the count is greater than zero. Activating it opens the same conflict-resolution modal and actor used when Save finds unresolved conflicts. Save must remain activatable when conflicts exist so it can enter that workflow; it must not invoke `onSaveEdits` while unresolved conflicts remain.

Reset discards the active edit candidate, sparse drafts, edit-owned validation, and conflict resolutions back to the latest canonical server snapshots. It does not reset filters, sorting, layout, selection, or other grid preferences.

The footer remains mounted when no edits exist, with Reset and Save disabled. During saving, prevent duplicate Save and Reset activation and expose progress accessibly.

The footer shell never subscribes to rows or the complete edit store. Status controls subscribe independently to compact counts; buttons subscribe only to the booleans and progress state they render. Streaming row updates that do not change those projections must neither notify nor rerender the footer.

Pages do not reimplement this footer through toolbar children. The optional toolbar augments it.

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

In a Server Table:

- cell editing requires a loaded row identity
- drag fill requires a fully loaded target unless server-assisted
- paste requires a fully loaded target unless server-assisted
- local clear/delete requires loaded targets
- drafts survive block eviction
- conflicts survive block eviction
