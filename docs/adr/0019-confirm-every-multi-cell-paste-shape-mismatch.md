# Confirm every supported Linear Cell Range paste mismatch

A supported horizontal `1×N` or vertical `N×1` clipboard source never silently changes the destination axis or length. When either differs from the current destination—including the ordinary one-Active-Cell case—BrunoTable opens one modal paste confirmation workflow. A 1×1 source remains the only exception and broadcasts immediately along the selected Linear Cell Range after normal target preflight. A source with both dimensions greater than one is unsupported and receives a rejection toast rather than confirmation.

The confirmation uses the vendored Base UI `AlertDialog` from `@bruno/shadcn/alert-dialog` because the decision may overwrite several cells. It includes an accessible `AlertDialogTitle`, an orientation-and-length-specific `AlertDialogDescription`, a `Cancel` control, and one explicit action such as `Paste 3 horizontally`. It never uses an ambiguous `OK` label and never offers a two-dimensional target, tiling, repetition, transposition, clipping, or partial paste.

For one Active Cell, the proposed source-oriented range starts there. For a mismatched Linear Cell Range, it starts at the selection's logical start coordinate—the leftmost cell for horizontal selection or topmost cell for vertical selection—rather than whichever cell happens to be Active after keyboard traversal. The dialog shows the copied orientation and length, selected orientation and length, proposed orientation and length, and human-readable proposed start/end coordinates so the user knows exactly what will change.

The workflow is:

```text
paste requested
  -> parse bounded TSV shape
  -> both source dimensions exceed one: reject with explanation toast
  -> source is 1×1: preflight and broadcast
  -> linear destination axis and length match: preflight and paste
  -> linear destination differs: open Paste Confirmation
       -> Cancel/Escape: close, restore grid focus, apply nothing
       -> Paste {length} {orientation}: rerun current target preflight
            -> valid: one atomic paste transaction, close, restore focus
            -> invalid: remain open with one accessible inline reason
```

XState owns the discrete dialog lifecycle, cancellation, confirmation, and legal transition into the existing atomic paste command. The external clipboard command retains only the bounded raw text vector, orientation, length, and immutable start metadata required for that user gesture. Opening the dialog creates no draft, Batch history, save actor, or Save Operation.

Confirmation never trusts the opening preflight. It resolves the complete destination again against current rows, visible Logical Column Order, editability, locks, and validation before application. If that revalidation fails, the AlertDialog stays open and uses the shared `Alert` presentation for the specific inline reason; it does not also emit a redundant toast. The user cancels, corrects the grid state, and explicitly pastes again. A successful or cancelled workflow releases the retained clipboard vector.
