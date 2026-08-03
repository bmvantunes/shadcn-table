# Require exact paste shapes except single-cell broadcast

BrunoTable never tiles, repeats, transposes, clips, or partially applies a clipboard matrix. Clipboard shape is semantic: a 3×2 source is compatible with a selected 3×2 destination, not a 2×3 or any larger rectangle merely because its cell count is related.

There are exactly three destination rules:

1. A 1×1 source pasted into one Active Cell targets that cell.
2. A 1×1 source pasted into a multi-cell Client range broadcasts that one candidate to every cell in the selected rectangle.
3. A source containing more than one cell either:
   - maps to a selected multi-cell rectangle with exactly the same row and column counts; or
   - when only one Active Cell exists, treats it as the top-left anchor and infers one destination rectangle with exactly the source dimensions.

All other shape combinations are rejected before target parsing. No exact-multiple repetition exists: 2×2 into 4×4 is an error, as are 3×2 into 2×3, 3×2 into 6×1, and 3×2 into 3×3.

Destination expansion uses current logical body-row order and visible Logical Column Order across pinned-start, centre, and pinned-end regions. Hidden columns are not invisible paste targets. If the inferred or selected rectangle crosses a row or column boundary, contains an unavailable row, or includes any non-editable, locked, unparseable, or invalid cell, reject the entire gesture. Live identity reconciliation must succeed for every selected target before application.

Only after shape and availability checks succeed does BrunoTable parse and validate the complete candidate matrix. One accepted paste creates one immutable edit transaction, one Batch undo command, and one Immediate `onSaveEdits` operation regardless of cell count. Rejection creates none of them and reports one accessible table-scoped toast with a clear bounded shape or target diagnostic.
