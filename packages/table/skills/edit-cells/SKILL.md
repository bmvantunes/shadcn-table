---
name: edit-cells
description: >
  Implement or consume BrunoTable Editable Client behavior: Edit Modes, Save Change Sets, live-source
  reconciliation, conflicts, paste, Drag Fill, Batch undo/redo, and Edit Safety Footer behavior.
  Load for onSaveEdits, getRowVersion, editor, save, conflict, paste, or fill work.
metadata:
  type: sub-skill
  library: "@bruno/table"
  library_version: "0.0.0"
  skill_version: "1.0.0"
requires:
  - "@bruno/table#choose-row-model"
sources:
  - "bmvantunes/shadcn-table:docs/grid/requirements.md"
  - "bmvantunes/shadcn-table:packages/table/README.md"
  - "bmvantunes/shadcn-table:docs/grid/editing-and-conflicts.md"
  - "bmvantunes/shadcn-table:docs/adr/0032-project-edit-review-rows-through-a-consumer-seam.md"
  - "bmvantunes/shadcn-table:docs/grid/research/editable-safety-ui-prototype.md"
  - "bmvantunes/shadcn-table:docs/adr/0022-reconcile-void-save-operations-through-live-source.md"
  - "bmvantunes/shadcn-table:docs/adr/0021-use-repetition-only-drag-fill.md"
---

# Edit BrunoTable cells

This skill builds on `@bruno/table#choose-row-model`. Editing belongs only to an Editable Client
Table. Set `editable: true`, provide `getRowVersion`, and implement `onSaveEdits`; at least one column
must declare static or predicate `isEditable` capability.

`getRowVersion` is a pure function of the complete current row, returning its exact opaque Row
Version. Never generate tokens per call or close over the source's top-level Query Version; version
comparison is equality, not numeric ordering.

Also provide `projectEditRow({ row, patch, rowVersion })` when a potentially editable Field Column
declares `valueFormatter`, callback `cellClassName`, or `cellRenderer`. Exact finite Column tuples
require this prop in TypeScript; widened/runtime Columns still require it at construction when
normalization reveals those row-aware callbacks. Value-only edit review does not require it.

The projector must return an authentic immutable `TRow` with the same Row Identity, applying the
exact sparse patch without mutating the source Row. Preserve native values and present `undefined`;
use a domain constructor or method for class/prototyped Rows. Changed inputs require a fresh Row;
identical inputs may reuse a memoized projection. Treat the opaque `rowVersion` only as cache-key
evidence. The projected Row is presentation evidence, never canonical data or save evidence.

## Save contract

`onSaveEdits` receives one non-empty row-grouped Save Change Set and returns only
`PromiseLike<void>`. Every operation must eventually resolve or reject: an indefinitely pending
offline-queue promise leaves Immediate operation-owned cells locked, or all Batch edit mutations
locked. Every row change carries stable `rowId`, safely rebased `baseRow`, exact
`expectedVersion`, and a non-empty cell-change tuple preserving `columnId`, `field`, `before`, and
`after`. Never return canonical rows from the save operation: the live Client Source is the only
canonical result authority.

Accept or reject the complete immutable Save Change Set atomically. Several underlying writes need
one transactional application seam behind `onSaveEdits`; independent sequential writes cannot
represent partial success through this contract.

Never automatically retry failed or ambiguous saves through actors, Effect, transport policy, or
notifications. Only explicit activation of the authoritative Save control starts a new attempt,
with fresh preflight over current values, Row Versions, validation, and conflicts. Failure
notifications are explanatory and dismissible, with an accessible Close control and no mutation action.

Reject failures with an ordinary `Error` whose non-empty message is safe to show to the user;
do not forward raw transport or server details. BrunoTable normalizes unknown rejection values to
`The save could not be confirmed` rather than exposing a public save-error protocol.

Edit Mode belongs to the end user. Each session starts in Immediate mode; only BrunoTable's toggle
changes it. Do not add controlled/default mode props, persist the mode, or synchronize it from the
application. Block switching while any editor, draft, validation, conflict, either Batch history
stack, or Save Operation remains active; zero drafts may still retain Redo intent. Switching never
silently saves or discards work.

- Immediate mode submits one user gesture as one operation and permits concurrent disjoint-cell
  operations. Rejection restores unconverged operation-owned cells to their latest canonical values
  and releases their locks, with five-second accessible rejected treatment.
- Batch mode accumulates net changes and globally locks edit mutations while a submitted batch
  reconciles. Rejection releases that lock but preserves unconverged drafts, conflicts, validation,
  and undo/redo history. Later live convergence of a rejected operation's complete submitted cell set
  supersedes its ambiguous failure in either mode; unrelated edits or Reset do not prove success.
- Promise resolution creates Accepted Overlays, not canonical data. Currently mounted affected cells
  flash green for two seconds; offscreen cells complete quietly and no success toast is emitted.
  An overlay yields only to live convergence, changed Row Version, or authoritative disappearance.
- Before rebasing a dirty row, verify every edited field still equals its recorded Base. Divergence
  enters Conflict Review; the application's compare-and-set remains the final race authority.

Conflict count opens the same workflow proactively. Do not call `onSaveEdits` while conflicts or
blocking validation remain unresolved. Mine/Server resolution acts on one row or an explicit selected
set; no blind global overwrite action, and selecting all must itself be deliberate.

If live eligibility is lost or a row carrying Batch drafts disappears, retain sparse drafts and
history as blocked work, block Batch Save, and never fabricate a body row. Reconnect current row and
version authority if it returns; semantic convergence may retire the work. Otherwise removal requires
explicit undo, targeted discard, or Reset—not automatic pruning because permissions or rows vanished.

Keep Save Operation records bounded: pending, awaiting-source, and rejected records retain only
immutable evidence needed for reconciliation or notification. Remove completed records after their
flash or notification lifecycle, rather than retaining submitted rows for the Table Instance lifetime.

## Multi-cell gestures and history

Paste and Drag Fill are atomic gestures in both modes. Paste rejects sources whose row and column
counts both exceed one. Only `1×1` broadcasts along the selected Linear Cell Range; other linear
sources apply directly only for an exact orientation-and-length match. Other supported linear
mismatches require Paste Confirmation, proposing exactly the source length and orientation from
the Active Cell or range's logical start. Never tile, transpose, clip, or create a rectangular target;
confirmation reruns complete current preflight before applying anything.

Drag Fill repeats the exact source sequence
cyclically along one axis; it never infers arithmetic or date series. Batch undo/redo stores one
bounded sparse command per gesture with complete Draft and Conflict evidence. Live convergence
prunes that Cell Identity from both stacks.

## Ownership boundaries

XState actors own discrete workflows but are never React subscription sources. Renderers subscribe
to narrow BrunoTable-owned TanStack Store projections. Do not put pointer movement, scrolling,
geometry, or source batches into top-level React state. The persistent Edit Safety Footer exposes
compact status plus Reset/Save; full sparse collections open only on demand.

Before implementing an editing workflow, read its complete section in the bundled
[editing and conflicts specification](../references/docs/grid/editing-and-conflicts.md): “Table editing
capability and modes” for save outcomes, “Live editability and permission changes” and “Blocked Changes
Review” for retained work, “Conflict modal” and “Save workflow” for conflict admission, or “Transactions”
and “Batch-scoped undo and redo” for gestures/history. The concise rules here do not replace those
mode-specific transitions. Read the linked ADRs in that specification when changing their decisions.

Before clipboard or fill work, also read “Undo, redo, clipboard, and fill” in the bundled
[requirements](../references/docs/grid/requirements.md), including the V1 exclusion of Cut and
destructive Clear/Delete commands.
