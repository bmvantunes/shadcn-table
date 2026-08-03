# Allow only one contiguous Linear Cell Range

BrunoTable supports one Active Cell or one contiguous one-axis Cell Range Selection: horizontal `1×N` or vertical `N×1`. Both dimensions may never exceed one at the same time, so `2×2`, `3×2`, `5×3`, and every other two-dimensional selection or bulk operation are permanently unsupported rather than deferred.

The normalized multi-cell state is a discriminated union, not a general rectangle:

```ts
type BrunoTableCellRange =
  | {
      axis: "horizontal";
      rowId: BrunoTableRowId;
      anchorColumnId: BrunoTableColumnId;
      focusColumnId: BrunoTableColumnId;
    }
  | {
      axis: "vertical";
      columnId: BrunoTableColumnId;
      anchorRowId: BrunoTableRowId;
      focusRowId: BrunoTableRowId;
    };
```

The Active Cell represents `1×1`; `BrunoTableCellRange` exists only when at least two cells participate. A new range replaces the old one, no additive or subtractive state exists, and private TanStack rectangle primitives must be normalized through this union so a two-axis range cannot cross the Adapter boundary.

The first accepted extension away from the Active Cell chooses the range axis and locks it for that range. Pointer selection remains `1×1` inside a small drag-slop threshold. After crossing it, compare absolute pointer displacement from the gesture origin: greater horizontal movement chooses horizontal, greater vertical movement chooses vertical, and an exact tie remains `1×1` until one axis wins. Further keyboard or pointer movement may extend, shrink, or cross the anchor only on that axis; perpendicular movement is ignored rather than switching axes or creating a two-dimensional intermediate state. Once locked, diagonal pointer movement is projected onto the chosen axis: a horizontal range follows the pointer's logical column while retaining its row, and a vertical range follows the pointer's logical row while retaining its column. Collapsing back to the Active Cell removes the axis lock, and a new selection gesture may choose either axis.

Drag autoscroll is inactive until an axis is acquired and then operates only on that axis. A horizontal range may trigger horizontal autoscroll but never vertical autoscroll; a vertical range may trigger vertical autoscroll but never horizontal autoscroll. Proximity to a perpendicular viewport edge is ignored.

Escape or a browser `pointercancel` cancels an in-progress pointer gesture and stops autoscroll. Range selection restores the exact pre-gesture Active Cell and optional Linear Cell Range. Drag Fill discards its preview and creates no edit transaction, draft, Batch history command, save operation, or partial change.

The grid holds pointer capture for the gesture. A normal pointer release outside the grid therefore completes the last visible projected result rather than cancelling merely because the pointer crossed a DOM boundary. Range selection retains that projected Linear Cell Range. Drag Fill may preflight and atomically apply only an acquired, currently valid preview; release with no acquired axis or valid preview is a no-op.

Copy, paste, Drag Fill, preview, validation, edit transactions, and Batch undo operate only on `1×1`, `1×N`, or `N×1`. A two-dimensional clipboard matrix is rejected with one explanatory toast and never enters Paste Confirmation. A supported linear clipboard source may paste directly into an equal axis and length, while any other linear destination mismatch uses Paste Confirmation to propose one source-oriented linear range. A 1×1 source may broadcast along either selected axis.

Within a selected Linear Cell Range, Tab and Enter both advance through currently editable cells along its one locked axis; Shift+Tab and Shift+Enter reverse that order. Drag Fill resolves and locks one axis before previewing any target. Ordinary body Tab/Enter behaviour outside Cell Range Selection remains unchanged.

This supersedes ADR 0016, the selected-range traversal portions of ADR 0015, and the two-dimensional paste-shape rules in ADR 0017. ADR 0019 remains the confirmation workflow for supported linear shape mismatches only.
