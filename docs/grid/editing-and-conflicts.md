# Editing, validation, conflicts, and save workflow

## Table editing capability and modes

Only `BrunoTableClient` uses a strict discriminated editing interface:

```ts
type BrunoTableReadOnlyCapability<TColumns> = BrunoTableGroupingCapability<TColumns> & {
  editable?: false;
  getRowVersion?: never;
  onSaveEdits?: never;
  projectEditRow?: never;
};

type BrunoTableEditRowPatch<TRow, TColumns> = Readonly<
  Partial<Pick<TRow, PotentiallyEditableField<TRow, TColumns>>>
>;

type BrunoTableEditRowProjectorInput<TRow, TColumns> = Readonly<{
  row: TRow;
  patch: BrunoTableEditRowPatch<TRow, TColumns>;
}>;

type BrunoTableEditRowProjectionCapability<TRow, TColumns> =
  ExactColumnsRequireProjectedRow<TColumns> extends true
    ? {
        projectEditRow: (input: BrunoTableEditRowProjectorInput<TRow, TColumns>) => TRow;
      }
    : {
        projectEditRow?: (input: BrunoTableEditRowProjectorInput<TRow, TColumns>) => TRow;
      };

type BrunoTableEditableCapability<
  TRow,
  TColumns extends BrunoTableColumns<TRow>,
  TRowVersion,
> = BrunoTableNoGroupingCapability &
  BrunoTableEditRowProjectionCapability<TRow, TColumns> & {
    editable: true;
    getRowVersion: (row: TRow) => TRowVersion;
    onSaveEdits: BrunoTableSaveEditsHandler<TRow, TColumns, TRowVersion>;
  };
```

`editable: true` enables the Editable Table capability and makes both `getRowVersion` and `onSaveEdits` mandatory. The exact return type of `getRowVersion`, including `bigint`, becomes the Row Version type for every draft base, safely rebased Save Change Set, conflict, and Accepted Overlay. False or omitted editing makes those props and `projectEditRow` invalid. Column `isEditable` declarations identify potentially editable columns and still decide whether a particular row/cell can enter a Cell Edit Session; table-level editing does not override them.

An exact finite Column tuple also makes `projectEditRow` mandatory when a potentially editable Field Column declares `valueFormatter`, callback `cellClassName`, or `cellRenderer`, because those presentation callbacks may read the complete Row. Widened Columns keep the projector optional in the TypeScript interface because the tuple can no longer prove the requirement, but Client construction rejects missing configuration when normalized Columns reveal that the seam is needed. Value-only edit review does not require this seam.

`projectEditRow({ row, patch })` is the consumer-owned adapter at the edit-review Row projection seam. BrunoTable passes the current source Row plus an exact sparse patch whose keys are limited to potentially editable fields and whose values remain native, including `bigint` and a present `undefined`. The adapter returns an authentic `TRow` suitable for the consumer's row-aware formatter, class callback, and renderer. Plain records may merge the patch; class or prototyped Rows should use a domain constructor or method that preserves their invariants. The projected Row is presentation evidence only: it never becomes canonical source data, a Row Version, a draft base, or Save Change Set evidence, and it must preserve the source Row Identity.

BrunoTable may reuse its cached projected Row when the source Row reference, opaque Row Version, projector configuration, and exact patch are unchanged. A consumer adapter may likewise return the same memoized immutable Row for those identical inputs, including when a review closes and later reopens. A changed source Row or patch invokes the adapter again and requires a fresh immutable Row replacement so every row-aware presentation can observe the new evidence.

Missing required `projectEditRow` configuration is an explicit construction error. Before a Row has published one valid projection, a projector throw, null or non-object result, source-Row result for a non-empty patch, `getRowId` throw, changed Row Identity, or reused historical result is also an explicit configuration error. Once that Row has published a valid projection, any of those failure classes during a later changed-input call instead withdraws the projected Row and renders row-aware Yours as `Unavailable`. Exact Mine, Base, and Server evidence remains intact, the review workflow remains coherent, and BrunoTable never retains a possibly mutated object or substitutes Server evidence for Yours. An unavailable or unreadable current source Row likewise makes row-aware Yours unavailable without fabricating a replacement. See [ADR 0032](../adr/0032-project-edit-review-rows-through-a-consumer-seam.md).

Editing and grouping are mutually exclusive Table Instance capabilities. The editable branch rejects `groupRowsColumn`, installs no grouping or aggregation feature, exposes no Group By UI or command, and discards restored `groupBy`, `groupOrderBy`, and Rows width during preference sanitization. Shared columns may retain `groupBy` and `aggFunc` declarations for a separate read-only Client or Server Table; those declarations are dormant here.

At least one column must declare `isEditable: true` or an `isEditable` predicate. Reject `editable: true` at compile time when the literal columns prove that no column is potentially editable, and diagnose it at runtime when widened input prevents static proof. Do not evaluate predicates across all Client rows to discover the capability or rescan changing data merely to show chrome. Shared definitions may carry these declarations into `BrunoTableServer`, but the Server Table never activates them and its props reject the editing capability.

An Editable Table owns a compact `Batch editing` switch in its top-right grid chrome: off is Immediate and on is Batch. The end user owns this choice; consumers cannot provide a default or controlled Edit Mode prop. The switch starts off for each table session, is visible because the column definitions declare potential editability, subscribes only to the Edit Mode and a compact `canChangeEditMode` boolean, and never subscribes to row contents. Edit Mode is session state, not a persisted grid preference.

Changing Edit Mode while an editor, drafts, validation, conflicts, either Batch history stack, or a Save Operation are active is blocked. Even a zero-draft state reached through Undo may retain Redo intent; the user redoes, starts a new command that clears Redo, or uses Reset before switching. BrunoTable must not silently save, discard, or reinterpret edit-owned work during a mode change.

`onSaveEdits` receives a non-empty row-grouped Save Change Set and returns `PromiseLike<void>`. Resolution means the application accepted the complete Save Operation; rejection means the call failed and enters the ordinary failure workflow. The callback returns no canonical rows, Row Versions, conflicts, validation details, or result discriminant. The live Client Source is the sole canonical outcome authority. Effect may implement a consumer Adapter, but the public handler does not require Effect.

- Immediate mode invokes `onSaveEdits` once per committed edit transaction. A normal cell commit usually produces one change; paste and drag fill produce one atomic call containing every change in that transaction.
- Batch mode accumulates drafts and invokes the same handler only after Save. Coalesce repeated edits to the same cell into one net change from its accepted base to its latest draft; do not send raw undo history.

The handler never changes shape based on Edit Mode and is never called once per cell for a multi-cell transaction.

Every Save Change Set is atomic. The complete immutable set is accepted or rejected together; there is no public partial-success outcome. Consumers that require several writes must provide one transactional application seam behind `onSaveEdits`. Promise rejection should use an ordinary `Error` with a non-empty user-safe message. BrunoTable safely normalizes unknown rejection values to `The save could not be confirmed` and defines no exported save-error or save-result protocol.

Immediate mode supports multiple concurrent Save Operations over disjoint Cell Identities. Each operation owns a unique Operation Identity and one immutable Save Change Set, which may itself contain many cells from one paste or fill gesture. Maintain a bounded operation registry plus a reverse Cell Identity-to-operation index: a cell belongs to at most one active operation, while unrelated cells may commit new operations without waiting. Pending, awaiting-source, and rejected records retain submitted evidence only while reconciliation or notification needs it; completed records disappear after their bounded flash/notification lifecycle. Do not model Immediate saving with one table-level `isSaving` boolean or retain every historical operation for the Table Instance lifetime.

Immediate mode deliberately remains aggressive: while an operation is pending or awaiting live confirmation, lock only its complete owned cell set. Other cells, including different cells in the same row, may start concurrent operations. Two operations that race from the same Row Version may cause one compare-and-set rejection; BrunoTable accepts that server-authoritative outcome rather than secretly queuing or serializing Immediate edits. A saving cell uses a distinct non-color presentation plus an accessible progress state and a small compositor-driven border tracer or spinner. Do not drive the animation through React or XState frame events, and respect reduced-motion preferences.

Batch Save installs one table-wide edit mutation lock from invocation until rejection or complete post-resolution live reconciliation. No cell may begin or commit another mutation while it is held. Sorting, filtering, scrolling, navigation, menus, inspection, and Copy remain enabled in both Edit Modes; the locks constrain only edit mutations.

If an Immediate operation's Row Identity disappears from the live Client Source before its Promise settles, make no operation-state transition and infer nothing from the disappearance. Await `onSaveEdits`; do not cancel, retry, create a phantom row, or manufacture a special missing-row failure. After resolution, disappearance from a complete ready or stale Client Source is authoritative reconciliation: remove that row's overlays, release its Immediate cell locks, and count it as reconciled for Batch global-lock release.

Promise resolution converts submitted values to Accepted Overlays, removes Batch drafts/conflicts/validation/history immediately, and flashes every currently mounted affected cell green for two seconds. The overlay is not a draft and has no arbitrary timeout. It retains the submitted value until the live field becomes semantically equal, the opaque Row Version differs from `expectedVersion`, or the row authoritatively disappears. At that point the latest live row wins even when the application normalized the value or a later update already superseded it. Immediate cells release independently as each affected row reconciles; Batch releases its global edit lock only after every submitted row reconciles. A source lifecycle delay may therefore retain locks, with ordinary stale/closed/error chrome explaining why. Resolution never emits a success toast, and unmounted affected cells complete quietly.

Promise rejection reconciliation is mode-specific even though the Save Change Set remains atomic:

- Immediate rejection restores every operation-owned cell to its latest live canonical server value immediately, marks each with the non-color server-rejected presentation and a red treatment for five seconds, and records one failed operation rather than one failure per cell.
- Batch rejection preserves every unconverged draft, conflict, validation record, and history patch. Release the table-wide mutation lock, mark the remaining submitted set as failed, and allow the user to correct, retry, inspect conflicts, or open Reset Review. The Batch failure presentation remains until the relevant user action, retry, live convergence, or Reset rather than disappearing while rejected drafts remain.

Atomicity is an application contract for the complete Save Change Set. It does not authorize BrunoTable to discard a rejected Batch or claim that a rejected Promise proves the authoritative data did not change.

The table owns one persistent failure notification workflow. Concurrent Immediate rejections aggregate into a single table-scoped toast such as `10 save operations failed`, with expandable operation details; a rejected Batch enters that same workflow as one operation without losing its unconverged drafts. The toast never auto-dismisses merely with time; the user may close it. It contains no Retry, Save, or other mutation action. A rejected request, timeout, disconnect, HTTP failure, or ordinary application error says that the call was not confirmed; it does not claim that authoritative data remained unchanged. XState coordinates operation lifecycles, legal locks, aggregation, and dismissal privately, while BrunoTable-owned TanStack Store state owns observable per-cell operation references and presentation state. React subscribes only to compact store projections, never directly to actors or a joined actor/store snapshot. Neither the actor nor the toast subscribes to row contents or participates in scroll, geometry, or animation frames.

Because the notification persists until explicit dismissal, its Close control must remain named,
focusable, and exposed to assistive technology. A visually present control marked `aria-hidden` does
not satisfy this contract. Verify the exact imported Base UI toast behavior in browser tests.

A rejected operation retains the compact immutable submitted cell set already owned by it. Live reconciliation emits operation-specific convergence events when affected canonical values become semantically equal. If every submitted value converges, authoritative live evidence supersedes the ambiguous rejection: clear its failure notification, drafts, locks, and Batch history evidence, then use the ordinary success presentation. If only some values independently converge, prune those cells normally while retaining the operation failure and remaining Batch work. Never infer complete convergence from global `changes.length === 0`: Reset can make that count zero without source confirmation, and unrelated later edits can keep it nonzero after the rejected operation fully converges.

## Cell edit lifecycle

A Cell Edit Session is distinct from the Save Workflow. The accepted default interaction is:

```text
focused editable cell
    -> Enter or F2: edit current value
    -> printable text input: replace with produced text
active editor
    -> Enter, Tab, Shift+Tab, or accepted outside pointer action
Cell Edit Commit
    -> sparse draft + one cell-edit transaction
```

One Enter starts editing; a double key press or double click is not required. Enter and F2 initialize the editor from the cell's current pre-session typed value. The exception is Navigation Mode inside a multi-cell Linear Cell Range with at least two currently editable cells, where Enter retains the range and advances its Active Cell along the selected axis instead. F2 remains the edit-current-value path there. Printable text input on an eligible Active Cell starts the editor in replace mode: the produced text becomes the complete initial raw candidate, so typing `bye` over `hello` produces `bye`, not `hellobye`. Subsequent input continues normally in the mounted editor.

Replace-on-type applies only to a currently editable `BrunoTableClient` cell whose compiled editor accepts direct text input. It affects only the Active Cell even if a Cell Range Selection is present. Command shortcuts that produce no text, navigation keys, function keys, `Delete`, and `Backspace` never seed this path. AltGr/Option characters, IME composition, and dead-key sequences must enter as the browser-produced text rather than being rejected because a modifier is present or duplicated from intermediate `keydown` fragments.

Escape cancels the active editor without committing its candidate value and restores the exact pre-session value, including an existing Batch draft. Starting replace mode does not itself create a draft, transaction, undo entry, or save operation; those remain Cell Edit Commit consequences.

A Cell Edit Commit parses and validates the candidate, then records it in the sparse draft model. It does not necessarily send a server mutation: Immediate and Batch Edit Modes decide when committed changes enter the Save Workflow.

Tab commits and moves to the next currently editable body cell; Shift+Tab commits and moves to the previous one. Traversal follows Logical Column Order across pinned regions, skips non-editable cells, and wraps across logical rows. At the first or last eligible table cell it leaves the grid through normal backward or forward browser focus instead of cycling into a keyboard trap. An active multi-cell Linear Cell Range with at least two currently editable cells is the selected-range exception: retain the range and cycle its Active Cell through eligible cells along the range's one axis. Tab and Enter move forward; Shift+Tab and Shift+Enter move backward. Escape after editing has closed collapses that range to the Active Cell and restores ordinary body traversal. Without that range, a locally accepted Enter commit moves the Active Cell one logical body row down in the same column and Shift+Enter moves it one logical body row up. Movement happens after local parsing, validation, and transaction creation; Immediate mode does not wait for the Save Operation to settle. The virtualizers reveal an off-screen destination. Ordinary Enter movement does not wrap at the first or last logical row, and rejected parsing or validation leaves the editor and Active Cell in place.

A pointer press outside the editor attempts to commit before logical focus moves or the clicked action runs. If parsing or validation rejects the candidate, the editor remains active and the candidate is preserved rather than being discarded by blur.

A sort command while an editor is active uses that same commit gate before changing ordering. Invalid parsing or validation cancels the sort command, keeps the candidate mounted, and restores focus to the editor with its accessible error presentation. A valid Batch candidate commits synchronously to the sparse local draft and then sorts immediately. A valid Immediate candidate creates its identity-keyed save operation and then sorts immediately without awaiting transport settlement; the operation and any later failure notification survive even when the reordered row is no longer mounted. Sorting never discards drafts or cancels an in-flight operation.

Every user-triggered Grid Filter or Quick Filter command uses the same active-editor commit gate, including Clear and Reset. Invalid parsing or validation rejects the filter command and restores editor focus. A valid Batch candidate commits synchronously before the filter applies; a valid Immediate candidate starts its identity-keyed save operation before the filter applies without awaiting transport. Once the editor closes, an ordinary filter result may hide that row; identity-keyed drafts remain in the Edit Safety Footer and operation failures remain in the persistent notification workflow.

Existing Batch drafts, conflicts, validation, blocked records, and history never block later filter commands or trigger a hide-dirty-work confirmation. Filters may hide every affected body row, but the Edit Safety Footer counts, Save preflight, and Conflict, Blocked, and Reset Reviews continue to address their complete sparse collections rather than only filtered or mounted rows. Grid Filter Clear and Reset and Quick Filter changes mutate no edit-owned state.

A live Client update may change an active editor row's current sort position without being a sort command. Keep the row fully sorted and preserve the editor by anchoring that Row Identity to its current visual Y-coordinate: fixed-height geometry compensates the row's index delta through a frame-coalesced `scrollTop` adjustment while surrounding rows move. This is instantaneous scroll anchoring, not temporary sort suppression, smooth scrolling, or delayed pursuit of the row. Release the anchor when the Cell Edit Session commits or cancels.

If a live update makes the active editor row fail the current Client filters, retain that row at the same anchored visual position as one temporary edit-owned presentation exception. Mark it with a non-color status explaining that the row no longer matches current filters, while continuing canonical-value and conflict reconciliation. The exception never discards or auto-commits the raw candidate. A valid commit or Escape ends the Cell Edit Session, releases the exception, and lets the row disappear through the ordinary filtered model.

If the active editor row disappears from the live Client Source entirely, replace the anchored exception with a tombstone presentation that preserves the raw candidate and states `This row was removed from the server. Changes cannot be saved.` Commit is blocked and `onSaveEdits` is never invoked for that candidate. The user may copy the editor text and leave through Escape or an accessible `Cancel editing` action. If the same Row Identity reappears before cancellation, reconnect the session to its latest row and Row Version and run ordinary live reconciliation rather than inventing a new edit session.

An invalid candidate cannot leave the Cell Edit Session through Enter, Tab, Shift+Tab, or an outside pointer action. The editor keeps the raw candidate, retains logical focus, sets `aria-invalid`, and opens an accessible error popover anchored to the cell. The popover uses the invalid visual treatment and a text explanation; color alone is never the error signal. Escape is the explicit cancellation path: it discards the raw candidate, restores the latest accepted typed value, closes the error presentation, and exits edit mode.

Failed parsing or local validation creates no draft, edit transaction, undo entry, or Save Change Set and never invokes `onSaveEdits`. For example, `"hello"` entered into a Number column remains editor text and can never enter the typed edit model. A multi-cell paste or fill gesture validates the complete one-axis candidate vector before applying anything; one invalid target rejects the whole gesture and creates no partial transaction. Paste validates shape even earlier: a source whose row and column counts both exceed one is rejected with one explanatory toast. A 1×1 source may broadcast along the selected Linear Cell Range, while a `1×N` or `N×1` source either matches the selected orientation and length or opens Paste Confirmation for a proposed source-oriented Linear Cell Range. Opening or cancelling that dialog creates no target candidates or transaction. Direct paste rejection emits one accessible table-scoped toast with the specific bounded reason; failed confirmation preflight stays in the dialog with an inline reason. Neither surface offers Retry or stacks per-cell errors.

V1 exposes no destructive cell Clear/Delete capability: no public command, menu item, `Delete` key, or `Backspace` key clears a cell or selected range. Users change values through an editor or an explicit paste transaction, including deliberately entering or pasting blank text when the destination column's explicit blank policy permits it. Those paths retain normal parsing, validation, transaction, history, and save rules.

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

## Live editability and permission changes

Evaluate `isEditable` for a concrete dirty Client cell when a live row update changes inputs that may affect that predicate. If it becomes false, preserve Mine, Base, latest Server now, conflicts, validation, and history, but mark the draft as blocked and prevent it from entering a Batch Save Change Set. The cell cannot re-enter edit mode and exposes an accessible explanation that its row state or permission no longer permits editing. Never silently discard the trader's value.

If a row with committed Batch drafts disappears from the Client Source after its editor has closed, preserve every affected sparse draft and history patch as blocked missing-row work. Do not project a phantom body row. Include those cells in the footer's blocked count and Blocked Changes Review, disable Batch Save, and identify the missing Row Identity plus affected columns. Gesture undo, targeted discard, or Reset may explicitly remove the work. If the same Row Identity returns first, reconnect to its latest row and Row Version and run ordinary semantic convergence and conflict detection.

If the predicate becomes true again, remove the block without changing the draft. If the live canonical value becomes semantically equal to Mine, normal convergence removes the draft and its history. Reset remains the only explicit discard path. An Immediate operation already in flight keeps its operation lock and follows its normal Promise-settlement and live-reconciliation path; a mid-flight predicate change does not pretend to cancel an application write.

Re-evaluate only affected dirty cells through narrow row-update dependencies. Do not scan the complete dataset, all editable columns, or every draft on each publication.

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
- blocked
- read-only

## Edit safety footer

Setting `editable: true` on `BrunoTableClient` mounts a persistent bottom footer:

```text
3 conflicts · 2 blocked · 2 invalid · 12 unsaved changes             Reset | Save
```

The footer is a full-width safety rail attached to the grid rather than a permanent side ledger or
docked change inspector. This preserves horizontal space for wide and column-virtualized tables and
vertical space for the virtual row window. Complete sparse collections remain available through
on-demand live reviews. A future opt-in inspector may augment this surface, but it cannot replace
the footer's conflict, Reset, or Save intentions. This layout is validated by the
[editable safety UI prototype](research/editable-safety-ui-prototype.md).

The left side contains status controls and the right side contains exactly two default actions: Reset and Save. Use `Reset edits` as the accessible name when the visible label is shortened to `Reset`.

Render conflict and blocked controls only when their counts are greater than zero. Activating the conflict count opens the same conflict-resolution modal and actor used when Save finds unresolved conflicts. Activating the blocked count opens Blocked Changes Review. Save must remain activatable when conflicts exist so it can enter that workflow, but it must not invoke `onSaveEdits` while unresolved conflicts, blocked drafts, or validation errors remain.

Reset is disabled when no edit-owned work exists. When work is pending, activating Reset opens the Reset Review dialog rather than discarding anything immediately. Confirming Reset discards the active edit candidate, sparse drafts, edit-owned validation, conflict resolutions, and current-batch undo/redo history back to the latest canonical server snapshots. It begins a new clean batch context and does not reset filters, sorting, layout, selection, or other grid preferences.

The footer remains mounted when no edits exist, with Reset and Save disabled. In Immediate mode this is normally the clean state after resolved Save Operations and live reconciliation; pending failures or conflicts remain accessible through the same safety surface. While a resolved Batch is still awaiting one or more authoritative rows, its left status reads `Save accepted · waiting for live confirmation` with a compact remaining-row count, and Reset and Save stay disabled under the global edit lock. During a pending Promise, prevent duplicate Save and Reset activation and expose progress accessibly.

The footer shell never subscribes to rows or the complete edit store. Status controls subscribe independently to compact counts; buttons subscribe only to the booleans and progress state they render. Streaming row updates that do not change those projections must neither notify nor rerender the footer.

Pages do not reimplement this footer through toolbar children. The optional toolbar augments it.

## Blocked Changes Review

Blocked Changes Review is a live read-only internal `BrunoTableClient` over the sparse blocked-draft collection. It shows Row, Column, latest Server now, Mine, and the current blocking reason using the source column's compiled read-only presentation. It enables explicit internal row selection only for the rare targeted recovery action; the source table's selection state is unrelated and unaffected.

The user may close the dialog and wait for permission to return, use ordinary gesture-based Batch undo, open Reset Review for the complete batch, or select one or more blocked rows and activate `Discard Selected Changes`. Targeted discard restores those cells to their latest canonical server values and records one Batch history command regardless of selected cell count. `Ctrl+Z` can restore those blocked drafts because this was an explicit user discard rather than automatic server convergence. The action is disabled with no selected rows and never calls `onSaveEdits`.

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

Every Save activation performs a fresh preflight against the latest live canonical values and Row Versions: commit or reject the active editor, reconcile converged drafts, evaluate local and retained server validation, derive current conflicts, and only then construct one new immutable Save Change Set. BrunoTable, XState, Effect integration, and the transport Adapter never schedule an automatic save retry or blindly replay a previous request. A retry exists only when the user explicitly activates the authoritative Save control again.

The Save Workflow records its initiating surface internally without adding it to the Save Change Set:

- A Save started inside Conflict Review keeps that modal mounted throughout the attempt. Promise resolution closes it; rejection leaves it open with all drafts, resolutions, live Server-now values, and diagnostics intact.
- A Save started from the Edit Safety Footer with no conflicts keeps Conflict Review closed if the attempt fails. The next explicit Footer Save runs the complete live preflight again and opens Conflict Review only when conflicts exist at that later moment.

The persistent toast explains the failure but never becomes a second Save surface. This keeps every attempt on one state-machine path and prevents a stale notification action from bypassing current conflict and validation checks.

## Optimistic concurrency

The client sends expected versions.

Conceptual row patch:

```ts
type BrunoTableSaveRowChange<TRow, TChanges, TRowVersion> = {
  readonly rowId: BrunoTableRowId;
  readonly baseRow: TRow;
  readonly expectedVersion: TRowVersion;
  readonly changes: TChanges;
};
```

The server is the final concurrency authority.

Row Version is an explicit typed editing capability and may itself be `bigint`. It is independent of the Viewport Source's top-level Query Version. The Query Version describes one live read result; it is not an `expectedVersion` for any row.

`getRowVersion` reads that token from the complete current Client row whenever BrunoTable captures or refreshes a canonical edit base. It is a pure extraction function, not a request, subscription, equality function, or mutation callback. Row Versions are opaque equality tokens: BrunoTable checks whether one differs and never assumes it numerically increases.

Every Save activation safely rebases each dirty row to one coherent latest source snapshot before constructing its row-grouped payload. For every edited field, compare latest live value with the draft's recorded Base through compiled semantic equality. When all edited fields remain equal, refresh `baseRow`, `expectedVersion`, and the exact `before` values together from that latest row, even when individual cells were first edited under different versions. When any edited field differs, do not rebase or call the application; enter Conflict Review. The application's atomic compare-and-set remains the authority for a race after this preflight.

The complete editable Client Source must retain the Row Version even when no visible column uses it. `onSaveEdits` must call an application write or RPC seam that performs an atomic compare-and-set. effect-view-server's current runtime `patch` accepts no expected version and must not be used as a convenience save implementation.

Even after local conflict resolution, a newer server version may arrive before save.

"Keep mine" means:

- acknowledge the latest known server version
- submit the user value against that version
- conflict again if the version changes before commit

Do not silently force unconditional last-write-wins.

## Promise settlement and live reconciliation

One Save Operation has one Promise settlement: resolve with `void` or reject with an ordinary error. Neither settlement contains canonical row data. Do not introduce a durable user-facing `unconfirmed` edit state or guess canonical values from the Promise. Apply the mode-specific presentation and let the live View Server remain the reconciliation authority:

- if live canonical values become semantically equal to the drafts, convergence removes those changes and their history as though they were never locally pending;
- if live canonical values differ, normal conflict detection records the divergence;
- if no confirming update arrives, the drafts remain available for review and a later explicit fresh-preflight Save.

An Immediate operation still reverts to the latest currently known server values on Promise rejection; a later View Server publication is rendered and reconciled normally. Complete operation-specific live convergence suppresses or clears the failure because authoritative source state is stronger evidence than a failed response path.

## XState actors

Recommended actors:

### Editing actor

```text
idle
editing
dirty
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
preflighting
applying
rejected
cancelled
```

Drag Fill publishes no preview or autoscroll inside drag slop. After crossing the threshold, greater absolute pointer displacement from the gesture origin chooses and locks the axis; an exact tie remains armed without a preview until one axis wins. Once locked, diagonal pointer movement continues updating the preview through only its parallel logical coordinate rather than freezing, and only the corresponding parallel viewport edge can trigger autoscroll. Its source, preview, validated candidate vector, edit transaction, and Batch undo command are always horizontal `1×N` or vertical `N×1`; perpendicular movement and edge proximity never switch or scroll the other axis or create a two-dimensional target, even transiently.

Value generation is repetition-only. One source cell repeats; a multi-cell source repeats its exact logical sequence cyclically along that source range's existing axis, phase-aligned through Euclidean modulo so filling before the source continues the same pattern. Preview generation maps source canonical exchange text through each destination column's parser and never performs arithmetic, increment/decrement, date progression, suffix inference, or trend extrapolation. No modifier changes the algorithm.

Escape or browser `pointercancel` transitions the actor to `cancelled`, stops autoscroll, releases its preview, and returns to `idle` without applying. Cancellation creates no candidate validation, draft, edit transaction, history command, save actor, or Save Operation. Pointer release is the only gesture completion that may preflight and atomically apply the current preview.

The actor owns pointer capture, so an ordinary release outside the grid still completes the last visible projected preview. Completion reruns current target, lock, parsing, and validation preflight before creating one atomic transaction. If no axis was acquired, no non-empty preview exists, or the extension has returned to its source bounds, release is a silent no-op with no transaction, history, save actor, or notification.

If any preflight target is unavailable, stale, non-editable, save-locked, unparseable, or invalid, transition to `rejected`, remove the preview, and apply nothing. Publish one bounded `Fill rejected` diagnostic containing the first deterministic user-facing row/column reason and an additional failure count, then return to `idle`. The Base UI toast from `@bruno/shadcn/toast` renders it with error presentation, description, and Close; it has no Retry or mutation action, persists until dismissal or the next accepted fill, and a later rejection replaces it. No rejected fill creates a draft, edit transaction, Batch history command, save actor, Save Operation, or save-failure toast.

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

The Save Workflow owns a bounded dynamic set of Immediate operation actors and at most one Batch operation. Each operation receives an immutable Save Change Set, observes resolved or rejected Promise settlement, and then remains only while its live reconciliation evidence requires it. The manager maintains cell ownership, derives the Batch global mutation lock, records the initiating surface, aggregates rejected-operation notification details, and removes accepted operations after every submitted row reconciles. Per-cell progress, Accepted Overlay, and flash presentation remain sparse store state selected directly by affected cells. A rejected actor waits for no retry timer; a later explicit Save creates a new operation after fresh preflight.

The notification actor retains only the compact failed-operation evidence needed after the cell presentation deadline: Operation Identity, affected Cell Identities, submitted typed values or their existing immutable change references, and unresolved convergence count. A canonical update performs the column's compiled semantic equality for the affected cell and emits one narrow event; do not rescan the complete draft store or grid after every source publication.

## Transactions

Normalize all changes:

```ts
type BrunoTableEditTransaction = {
  id: string;
  source: "cell-edit" | "paste" | "drag-fill" | "discard-blocked";
  changes: readonly BrunoTableCellChange[];
  createdAt: number;
};
```

A 5,000-cell fill is one transaction and one undo step.

Generate large fill/paste changes imperatively, then submit one meaningful actor event.

## Batch-scoped undo and redo

Undo and redo exist only in Batch mode. History begins empty at the current accepted server baseline. One user gesture creates one history command regardless of its cell count: five separate edits require five undo operations, while one 500-cell paste requires one. Undo may travel only to the beginning of the current unsaved batch, and redo may travel only within that batch.

Each Batch History Command carries reversible before-and-after sparse edit state for every affected Cell Identity, including its Draft and Conflict evidence. A value-only `{ before, after }` pair is insufficient: choosing Mine can rebase the Draft's Base without changing the presented value, while choosing Server removes the Draft entirely. Restoring that complete cell state makes individual and selected-row conflict resolution one genuinely undoable gesture without copying canonical rows or the complete edit store into every command. Keep both stacks bounded.

A resolved Batch Save establishes a new local baseline and clears both history stacks immediately while Accepted Overlays retain submitted values through live confirmation. A rejected save preserves every unconverged part of the batch and its history. The first edit after a resolved Save therefore creates exactly one available undo command. Immediate mode exposes no undo or redo because reversing an already-accepted mutation would require a new Save Operation rather than local history.

Live semantic convergence erases the converged Cell Identity as though the user had never changed that cell in the current batch. Remove its draft, conflict, validation, and every patch for that cell from both undo and redo history. If pruning makes a multi-cell history command empty, remove the command; otherwise it remains one gesture over its surviving cells. Undo must never resurrect a user value after the latest server value has already converged with it.

## Validation

Column definitions may provide:

- parser
- synchronous local validator

Parsing and local validation run once at Cell Edit Commit or once over the complete one-axis candidate vector before an atomic multi-cell gesture. They never run as an asynchronous per-cell workflow or on every keystroke. Business, permission, cross-row, and other asynchronous authority belongs to the atomic `onSaveEdits` application seam and rejects its Promise with a user-safe `Error` without weakening all-or-nothing semantics.

Do not conflate validation with conflict detection.

## Server viewport exclusion

`BrunoTableServer` is always read-only. It does not install the editor, drafts, validation, save operations, conflict workflow, Batch switch, Edit Safety Footer, paste, drag fill, or undo/redo. Shared columns may declare `isEditable` for a Client Table without enabling any of those capabilities in the Server composition root. The V1-wide prohibition on destructive cell Clear/Delete commands applies to both table modes.

Server keyboard navigation still owns one Active Cell across pinned and virtualized regions. Copy operates only on that one loaded cell. Cell Range Selection is absent, so BrunoTable never claims that an unloaded range was selected or copied.
