# Grid mechanics prototype

Throwaway prototype for the highest-risk BrunoTable rendering seam:

- TanStack Table v9 stable owns logical column order and cell navigation.
- TanStack Virtual owns the bounded row and center-column windows.
- Two start-pinned columns and one end-pinned column remain in the same keyboard path.
- Exact geometry performs the smallest reveal needed for the newly focused cell.
- Selection subscribes per mounted row; the grid owner does not subscribe to selection.
- One native scroll element owns geometry. Base UI scroll chrome is not a second scroll authority.
- Vite runs the React Compiler and rejects compiler diagnostics in checks.

Run it with:

```sh
vp run @bruno/grid-mechanics-prototype#dev
```

Use `?variant=A`, `?variant=B`, or `?variant=C` to compare the three shells. Focus the grid and hold the arrow keys to exercise pinned-boundary navigation and scroll reveal.

## Verdict

The seam is viable with the following constraints:

1. Keep a single native scroll element as the geometry authority. A styled Base UI scroll area may be composed around it later only if it exposes that same viewport; it must not introduce another scroll owner.
2. Virtualize rows and center columns only. Render start- and end-pinned columns continuously inside separate sticky regions while preserving TanStack Table's logical `start + center + end` order.
3. Do not use `scrollToIndex` for keyboard reveal. Compute the smallest scroll delta from known fixed geometry and the sticky start/end insets.
4. Subscribe to cell selection per mounted row. The grid owner subscribes only to structural table state, so moving focus does not rerender the full grid.
5. Guard one-time initial focus. A dependency-driven initialization effect can reset focus when a virtual window rerenders.
6. Isolate `useVirtualizer` behind the renderer adapter. Version 3.14.9 passes the repository's React Compiler check and runs correctly here, but the library API should not leak through BrunoTable.

Observed in the live prototype:

- Horizontal held-arrow reveal moved by the exact exposed column widths (`22`, then `124`, `140`, `92`, `108`, and so on), never by several guessed indexes.
- Vertical held-arrow reveal used the initial partial delta (`7`) and then exactly one `28 px` row per move.
- Moving from the end-pinned Actions column to its adjacent final center column reached the maximum center scroll, and moving back to Actions caused no additional scroll.
- At a 1280 × 720 viewport, the grid mounted 28 rows and 15 columns instead of 5,000 rows and 150 columns.

This proves the ownership and navigation design, not the final 120 Hz budget. Production work still needs an automated interaction benchmark on representative hardware.
