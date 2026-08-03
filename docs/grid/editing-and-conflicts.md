# Editing, validation, conflicts, and save workflow

## Table editing capability and modes

Only `BrunoTableClient` uses a strict discriminated editing interface:

```ts
type BrunoTableReadOnlyCapability = {
  editable?: false;
  onSaveEdits?: never;
};

type BrunoTableEditableCapability<TRow, TColumns extends BrunoTableColumns<TRow>> = {
  editable: true;
  onSaveEdits: BrunoTableSaveEditsHandler<TRow, TColumns>;
};
```

`editable: true` enables the Editable Table capability and makes `onSaveEdits` mandatory. False or omitted editing makes edit-only props invalid. Column `isEditable` declarations identify potentially editable columns and still decide whether a particular row/cell can enter a Cell Edit Session; table-level editing does not override them.

At least one column must declare `isEditable: true` or an `isEditable` predicate. Reject `editable: true` at compile time when the literal columns prove that no column is potentially editable, and diagnose it at runtime when widened input prevents static proof. Do not evaluate predicates across all Client rows to discover the capability or rescan changing data merely to show chrome. Shared definitions may carry these declarations into `BrunoTableServer`, but the Server Table never activates them and its props reject the editing capability.

An Editable Table owns a compact `Batch editing` switch in its top-right grid chrome: off is Immediate and on is Batch. The end user owns this choice; consumers cannot provide a default or controlled Edit Mode prop. The switch starts off for each table session, is visible because the column definitions declare potential editability, subscribes only to the Edit Mode and a compact `canChangeEditMode` boolean, and never subscribes to row contents. Edit Mode is session state, not a persisted grid preference.

Changing Edit Mode while an editor, drafts, validation, conflicts, or a save operation are active is blocked. The user completes or cancels the editor and uses Save or Reset before switching; BrunoTable must not silently persist, discard, or reinterpret pending work during a mode change.

`onSaveEdits` receives a non-empty Save Change Set and returns the typed optimistic-concurrency result. The exact item/result shapes must preserve row, column, value, and Row Version correlation. Effect may implement a consumer Adapter, but the public handler does not require Effect.

- Immediate mode invokes `onSaveEdits` once per committed edit transaction. A normal cell commit usually produces one change; paste, drag fill, and multi-cell clear produce one atomic call containing every change in that transaction.
- Batch mode accumulates drafts and invokes the same handler only after Save. Coalesce repeated edits to the same cell into one net change from its accepted base to its latest draft; do not send raw undo history.

The handler never changes shape based on Edit Mode and is never called once per cell for a multi-cell transaction.

Every Save Change Set is atomic. The complete immutable set succeeds or fails together; there is no public partial-success outcome. A rejection may carry per-cell or per-row diagnostic details, canonical latest server values, and conflicts for review, but it never reports that a valid prefix was persisted. Consumers that require several writes must provide a transactional application seam behind `onSaveEdits`.

Immediate mode supports multiple concurrent save operations over disjoint Cell Identities. Each operation owns a unique Operation Identity and one immutable Save Change Set, which may itself contain many cells from one paste, fill, or clear gesture. Maintain an operation registry plus a reverse Cell Identity-to-operation index: a cell belongs to at most one active operation, while unrelated cells may commit new operations without waiting. Do not model Immediate persistence with one table-level `isSaving` boolean.

While an Immediate operation is in flight, lock only its complete owned cell set. While a Batch Save is in flight, install one table-wide edit mutation lock so no cell can begin or commit another mutation. A saving cell uses a distinct non-color presentation plus an accessible progress state and a small compositor-driven border tracer or spinner; the prototype should compare treatments. Do not drive the animation through React or XState frame events, and respect reduced-motion preferences.

An atomic success keeps all accepted canonical values and flashes every affected cell green for two seconds. Rejection reconciliation is mode-specific even though the server outcome remains atomic:

- Immediate rejection restores every operation-owned cell to its latest live canonical server value immediately, marks each with the non-color server-rejected presentation and a red treatment for five seconds, and records one failed operation rather than one failure per cell.
- Batch rejection preserves the complete submitted draft set, conflicts, validation evidence, and both history stacks. Release the table-wide mutation lock, mark the diagnosed cells or complete submitted set as failed, and allow the user to correct, retry, inspect conflicts, or open Reset Review. The Batch failure presentation remains until the relevant user action, retry, successful reconciliation, or Reset rather than disappearing while rejected drafts remain.

Atomicity means the application persisted every submitted change or none of them. It does not authorize BrunoTable to discard a rejected Batch.

The table owns one persistent failure notification workflow. Concurrent Immediate failures aggregate into a single table-scoped toast such as `10 save operations failed`, with expandable operation details; a rejected Batch enters that same workflow as one operation without losing its drafts. The toast never auto-dismisses; the user explicitly closes it. XState coordinates operation lifecycles, legal locks, aggregation, and dismissal, while the sparse external edit store owns per-cell operation references and presentation state. Neither XState nor the toast subscribes to row contents or participates in scroll, geometry, or animation frames.

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

A Cell Edit Commit parses and validates the candidate, then records it in the sparse draft model. It does not necessarily send a server mutation: Immediate and Batch Edit Modes decide when committed changes enter the Save Workflow.

Tab commits and moves to the next editable cell; Shift+Tab commits and moves to the previous editable cell. Enter always commits, while any movement after Enter is a separate explicit navigation policy.

A pointer press outside the editor attempts to commit before logical focus moves or the clicked action runs. If parsing or validation rejects the candidate, the editor remains active and the candidate is preserved rather than being discarded by blur.

An invalid candidate cannot leave the Cell Edit Session through Enter, Tab, Shift+Tab, or an outside pointer action. The editor keeps the raw candidate, retains logical focus, sets `aria-invalid`, and opens an accessible error popover anchored to the cell. The popover uses the invalid visual treatment and a text explanation; color alone is never the error signal. Escape is the explicit cancellation path: it discards the raw candidate, restores the latest accepted typed value, closes the error presentation, and exits edit mode.

Failed parsing or local validation creates no draft, edit transaction, undo entry, or Save Change Set and never invokes `onSaveEdits`. For example, `"hello"` entered into a Number column remains editor text and can never enter the typed edit model. A multi-cell paste, fill, or clear gesture validates the complete candidate matrix before applying anything; one invalid target rejects the whole gesture and creates no partial transaction.

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
type BrunoTableCellDraft<TValue, TRowVersion> = {
  originalServerValue: TValue;
  originalServerVersion: TRowVersion;
  editedValue: TValue;
  editedAt: number;
};
```

## Conflict shape

```ts
type BrunoTableCellConflict<TValue, TRowVersion> = {
  baseValue: TValue;
  baseVersion: TRowVersion;
  serverValue: TValue;
  serverVersion: TRowVersion;
  userValue: TValue;
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

Equality must be column-aware and must come from the normalized Column Value Semantics plan.

## Exact value editing and reconciliation

Exact numeric values remain native throughout the edit workflow. A `bigint` draft contains a `bigint`; an Effect BigDecimal draft contains a BigDecimal. Do not convert either to `number`, persist them as strings in the edit store, JSON-clone them, or use object identity for dirtiness.

The editor holds incomplete input as text. On Cell Edit Commit it:

1. resolves the column's explicit blank/clear policy;
2. parses canonical text through the compiled Column Value Semantics;
3. validates the exact native value;
4. records the typed draft only after parsing and validation succeed.

Blank input is never silently `0n` or decimal zero. A nullable exact column must declare whether clear means `null` or `undefined`; ambiguous `T | null | undefined` columns require an explicit choice.

Draft dirtiness, three-way reconciliation, and successful-save cleanup all use semantic equivalence. Therefore BigDecimal base `1.50`, server `1.5`, and user `1.500` converge automatically. Display text does not participate in this decision.

The conflict modal formats Base, Server now, and Yours through the column's presentation channel, but its selection and resolution state retain the native typed values. A localized display formatter can never change the save payload.

## Visual behaviour

When a conflict arrives:

- continue showing the user's draft
- mark the cell as conflicted
- retain all three values
- expose a conflict tooltip or inspector

Validation errors and conflicts should not use indistinguishable visuals.

An invalid active editor uses an anchored error popover with an explicit message and accessible invalid state. It remains open while the invalid candidate blocks commit and closes only after the candidate becomes valid or the user cancels with Escape. The prototype should compare icons and treatments for invalid, dirty, saving, conflicted, accepted, and server-rejected states while preserving non-color cues for every state.

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

Setting `editable: true` on `BrunoTableClient` mounts a persistent bottom footer:

```text
3 conflicts · 2 invalid · 12 unsaved changes                         Reset | Save
```

The left side contains status controls and the right side contains exactly two default actions: Reset and Save. Use `Reset edits` as the accessible name when the visible label is shortened to `Reset`.

Render the conflict control only when the count is greater than zero. Activating it opens the same conflict-resolution modal and actor used when Save finds unresolved conflicts. Save must remain activatable when conflicts exist so it can enter that workflow; it must not invoke `onSaveEdits` while unresolved conflicts remain.

Reset is disabled when no edit-owned work exists. When work is pending, activating Reset opens the Reset Review dialog rather than discarding anything immediately. Confirming Reset discards the active edit candidate, sparse drafts, edit-owned validation, conflict resolutions, and current-batch undo/redo history back to the latest canonical server snapshots. It begins a new clean batch context and does not reset filters, sorting, layout, selection, or other grid preferences.

The footer remains mounted when no edits exist, with Reset and Save disabled. In Immediate mode this is normally the clean state after successful persistence; pending failures or conflicts remain accessible through the same safety surface. During saving, prevent duplicate Save and Reset activation and expose progress accessibly.

The footer shell never subscribes to rows or the complete edit store. Status controls subscribe independently to compact counts; buttons subscribe only to the booleans and progress state they render. Streaming row updates that do not change those projections must neither notify nor rerender the footer.

Pages do not reimplement this footer through toolbar children. The optional toolbar augments it.

## Reset Review dialog

The Reset Review dialog shows the complete pending change set before destructive confirmation. It reuses a read-only internal `BrunoTableClient`, the source table's compiled-column registry, and the same heterogeneous value-presentation mechanism as the conflict modal so numbers, BigDecimals, bigints, booleans, select labels, and custom domain values appear exactly as they do in the source table.

Render one row per pending changed cell. Pin Row and Column to the start, and compare the latest canonical server value with the user's current value. A compact Status presentation may distinguish an ordinary draft, invalid active candidate, or conflict without providing per-row resolution controls. There are no Mine, Server, per-column, or bulk-resolution buttons in this dialog.

The dialog footer exposes exactly two actions:

- `Keep Editing` closes the dialog without changing the active batch, its drafts, conflicts, validation, or history.
- `Reset All Changes` is the destructive confirmation. It clears all edit-owned state and current-batch history together, restores the latest canonical server values, closes the dialog, and returns focus to the originating grid.

The destructive action states the number of affected cells in its accessible description. Opening and closing the dialog must not copy the complete edit store into React state; the internal table reads the sparse pending-change projection while mounted.

Reset Review remains live while open. Incoming source updates immediately refresh every `Server now` value. When the latest server value becomes semantically equal to the user's value, reconciliation removes that pending change and its review row. If no pending work remains, keep the dialog stable, show that all changes now match the server, and disable `Reset All Changes`; do not unexpectedly close a surface the user is reviewing.

## Conflict modal

The conflict modal renders a normal internal `BrunoTableClient` over the complete in-memory conflict collection. It omits the table-level `editable` capability, so every conflict cell remains read-only even when the source column declares `isEditable`. It has its own stable internal Table Identity, no editing footer or Edit Mode switch, and no durable preference persistence.

Use one conflict row per conflicted source cell. Pin Row and Column to the start and Resolution to the end so identity and decisions remain visible while the comparison values scroll:

| Region | Row       | Column   | Base | Server now | Yours | Resolution |
| ------ | --------- | -------- | ---: | ---------: | ----: | ---------- |
| Start  | Order 481 | Price    |  100 |        102 |   105 | Mine       |
| Start  | Order 912 | Quantity |   50 |         40 |    60 | Server     |

Base remains part of the three-way conflict record even when the primary comparison emphasizes Server now and Yours. It explains how both sides diverged and supports a detailed Git-diff-like inspector for complex values.

The Base, Server now, and Yours columns are heterogeneous: adjacent conflict rows may represent a number, BigDecimal, bigint, boolean, select value, or custom domain value. Their cell renderer resolves the row's source `columnId` through the source table's stable compiled-column registry and delegates to that column's read-only Cell Presentation. This reuses its Value Type, `valueFormatter`, alignment, styling, select labels, and custom read-only renderer without invoking its editor. The dynamic dispatch is per conflict row, while the registry and compiled presentations remain stable.

Server now renders against the latest authoritative source-row view. Yours renders against the projected row with drafts and applied resolutions. Base always retains and formats the exact stored base value; BrunoTable does not duplicate an entire historical dataset merely to recreate row-dependent decoration around that value. Heterogeneous value erasure, if required by the internal registry, stays private and never weakens the typed public column, edit, or conflict APIs.

The conflict collection and every `Server now` value remain live while the modal is open. Reconciliation updates or removes conflict rows as source values change; convergence between Server now and Yours clears the draft and conflict automatically. If the last conflict resolves externally, keep the modal stable with an all-current empty state rather than closing it unexpectedly.

Actions:

- keep mine
- accept server
- select one or more conflict rows
- apply mine to the explicit selection
- apply server to the explicit selection
- cancel
- apply resolutions

There are no blind global `Keep all mine` or `Accept all server values` actions. A user may deliberately select every conflict row and then apply one decision to that explicit selection. One individual resolution click is one Batch history gesture; one selected-row bulk resolution is also one gesture regardless of selected cell count. Every resolution remains undoable within the current Batch session. Use user-facing labels rather than Git terminology.

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
type BrunoTableRowPatch<TChanges, TRowVersion> = {
  rowId: BrunoTableRowId;
  expectedVersion: TRowVersion;
  changes: TChanges;
};
```

The server is the final concurrency authority.

Row Version is an explicit typed editing capability and may itself be `bigint`. It is independent of the Viewport Source's top-level Query Version. The Query Version describes one live read result; it is not an `expectedVersion` for any row.

The complete editable Client Source must retain the Row Version even when no visible column uses it. `onSaveEdits` must call an application write or RPC seam that performs an atomic compare-and-set. effect-view-server's current runtime `patch` accepts no expected version and must not be used as a convenience save implementation.

Even after local conflict resolution, a newer server version may arrive before save.

"Keep mine" means:

- acknowledge the latest known server version
- submit the user value against that version
- conflict again if the version changes before commit

Do not silently force unconditional last-write-wins.

## Save results

One operation has exactly one atomic outcome:

- accepted: every change was applied, with decoded canonical values and new typed Row Versions for the complete set;
- rejected: no change was applied, with a typed conflict, validation, permission, or transient failure and the latest canonical server evidence needed for reconciliation.

A rejected result may describe several affected rows or cells without becoming a partial-success result. Semantic equivalence decides whether canonical accepted values clear submitted drafts.

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
- explicit selected-row resolutions
- unresolved count
- modal lifecycle
- applying decisions

Avoid one actor per cell for all rows.

Use sparse active edit state.

### Save operation manager

The Save Workflow owns a bounded dynamic set of Immediate operation actors and at most one Batch operation. Each operation receives an immutable Save Change Set and reports one accepted or rejected terminal outcome. The manager maintains cell ownership, derives the Batch global mutation lock, aggregates failed-operation notification details, and removes settled operations after their cell presentation deadlines expire. Per-cell progress and flash presentation remains sparse store state selected directly by affected cells.

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

## Batch-scoped undo and redo

Undo and redo exist only in Batch mode. History begins empty at the current accepted server baseline. One user gesture creates one history command regardless of its cell count: five separate edits require five undo operations, while one 500-cell paste requires one. Undo may travel only to the beginning of the current unsaved batch, and redo may travel only within that batch.

A successful Batch Save establishes a new baseline and clears both history stacks. A rejected save preserves the complete batch and its history. The first edit after a successful Save therefore creates exactly one available undo command. Immediate mode exposes no undo or redo because reversing an already-persisted mutation would require a new server operation rather than local history.

Live semantic convergence erases the converged Cell Identity as though the user had never changed that cell in the current batch. Remove its draft, conflict, validation, and every patch for that cell from both undo and redo history. If pruning makes a multi-cell history command empty, remove the command; otherwise it remains one gesture over its surviving cells. Undo must never resurrect a user value after the latest server value has already converged with it.

## Validation

Column definitions may provide:

- parser
- sync validator
- async validator
- server validator

Async validation must be cancellable when the user edits again.

Do not conflate validation with conflict detection.

## Server viewport exclusion

`BrunoTableServer` is always read-only. It does not install the editor, drafts, validation, save operations, conflict workflow, Batch switch, Edit Safety Footer, paste, drag fill, clear/delete, or undo/redo. Shared columns may declare `isEditable` for a Client Table without enabling any of those capabilities in the Server composition root.

Server keyboard navigation still owns one Active Cell across pinned and virtualized regions. Copy operates only on that one loaded cell. Cell Range Selection is absent, so BrunoTable never claims that an unloaded rectangle was selected or copied.
