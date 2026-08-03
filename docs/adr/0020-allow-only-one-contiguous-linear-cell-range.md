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

Copy, paste, Drag Fill, preview, validation, edit transactions, and Batch undo operate only on `1×1`, `1×N`, or `N×1`. A two-dimensional clipboard matrix is rejected with one explanatory toast and never enters Paste Confirmation. A supported linear clipboard source may paste directly into an equal axis and length, while any other linear destination mismatch uses Paste Confirmation to propose one source-oriented linear range. A 1×1 source may broadcast along either selected axis.

Within a selected Linear Cell Range, Tab and Enter both advance through currently editable cells along its one axis; Shift+Tab and Shift+Enter reverse that order. Drag Fill and its preview remain on one locked axis. Ordinary body Tab/Enter behaviour outside Cell Range Selection remains unchanged.

This supersedes ADR 0016, the selected-range traversal portions of ADR 0015, and the two-dimensional paste-shape rules in ADR 0017. ADR 0019 remains the confirmation workflow for supported linear shape mismatches only.
