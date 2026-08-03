# Confirm every multi-cell paste shape mismatch

A clipboard source larger than 1×1 never silently changes the destination shape. When its row or column count differs from the current destination—including the ordinary one-Active-Cell case—BrunoTable opens one modal paste confirmation workflow. A 1×1 source remains the only exception and broadcasts immediately across the selected rectangle after normal target preflight.

The confirmation uses the vendored Base UI `AlertDialog` from `@bruno/shadcn/alert-dialog` because the decision may overwrite several cells. It includes an accessible `AlertDialogTitle`, a dimension-specific `AlertDialogDescription`, a `Cancel` control, and one explicit action such as `Paste 3×2`. It never uses an ambiguous `OK` label and never offers tiling, repetition, transposition, clipping, or partial paste.

For one Active Cell, the proposed source-sized rectangle starts there. For a mismatched multi-cell selection, it starts at the selection's current top-left logical coordinate rather than whichever cell happens to be Active after keyboard traversal. The dialog shows the copied shape, selected shape, proposed shape, and human-readable proposed start/end coordinates so the user knows exactly what will change.

The workflow is:

```text
paste requested
  -> parse bounded TSV shape
  -> source is 1×1: preflight and broadcast
  -> destination shape matches: preflight and paste
  -> destination shape differs: open Paste Confirmation
       -> Cancel/Escape: close, restore grid focus, apply nothing
       -> Paste {rows}×{columns}: rerun current target preflight
            -> valid: one atomic paste transaction, close, restore focus
            -> invalid: remain open with one accessible inline reason
```

XState owns the discrete dialog lifecycle, cancellation, confirmation, and legal transition into the existing atomic paste command. The external clipboard command retains only the bounded raw text matrix and immutable shape/anchor metadata required for that user gesture. Opening the dialog creates no draft, Batch history, save actor, or persistence call.

Confirmation never trusts the opening preflight. It resolves the complete destination again against current rows, visible Logical Column Order, editability, locks, and validation before application. If that revalidation fails, the AlertDialog stays open and uses the shared `Alert` presentation for the specific inline reason; it does not also emit a redundant toast. The user cancels, corrects the grid state, and explicitly pastes again. A successful or cancelled workflow releases the retained clipboard matrix.
