# Use Excel-style Tab traversal without trapping browser focus

In an Editable `BrunoTableClient` body, Tab advances the Active Cell to the next currently editable cell and Shift+Tab moves to the previous one. The traversal follows one Logical Column Order across pinned-start, virtualized-centre, and pinned-end columns, skips cells whose current column/row policy is not editable, and wraps from the last eligible cell in one logical row to the first eligible cell in the next row. Reverse traversal wraps symmetrically into the previous row.

When a Cell Edit Session is active, Tab or Shift+Tab first attempts a local Cell Edit Commit and moves only after parsing and synchronous validation accept it. Movement does not wait for Immediate persistence to settle. Invalid input retains the editor and Active Cell. In Navigation Mode, the same keys traverse without fabricating a commit.

The destination may be horizontally or vertically virtualized. BrunoTable resolves its stable Row and Column Identities, updates logical focus, and performs the same minimum scroll-to-reveal used by arrow navigation. Pinned boundaries never cause a multi-column jump.

Traversal never wraps the complete table into a cycle. When no next editable body cell exists, forward Tab uses normal browser focus order to leave the grid; when no previous editable body cell exists, Shift+Tab leaves backwards. A read-only Client Table and every Server Table use the grid as an accessible composite: arrows navigate internally while Tab and Shift+Tab cross the component boundary.

TanStack Table v9's Spreadsheet example commits Tab with a left/right `moveCellSelection` command, while the current core step returns no destination at a row edge. BrunoTable therefore owns eligible-cell skipping, row wrapping, pinned-aware reveal, virtualization, and terminal browser-focus exit rather than treating the example's directional step as the full interaction contract ([Spreadsheet interaction](../../.repos/table/examples/react/spreadsheet/src/useGridInteractions.ts#L142-L155), [Tab handler](../../.repos/table/examples/react/spreadsheet/src/useGridInteractions.ts#L462-L473), [core coordinate step](../../.repos/table/packages/table-core/src/features/cell-selection/cellSelectionFeature.utils.ts#L901-L997)).

Traversal inside an existing multi-cell Cell Range Selection is a separate range-navigation rule; it must be decided explicitly rather than inferred from the unbounded body traversal above.
