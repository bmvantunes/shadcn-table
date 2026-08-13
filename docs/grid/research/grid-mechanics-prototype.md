# Pinned virtual grid mechanics prototype verdict

Research and prototype verdict: 2026-08-05.

Primary source: throwaway [`codex/prototype-grid-mechanics` prototype at `81f9f12`](https://github.com/bmvantunes/shadcn-table/tree/81f9f12/packages/grid-mechanics-prototype).

## Question

Can the private renderer combine TanStack Table v9 stable, TanStack Virtual 3.14.9, React Compiler, fixed-height row virtualization, centre-column virtualization, simultaneous start/end pinning, fine-grained Cell Selection subscriptions, and held-arrow navigation without reproducing the spreadsheet example's multi-column reveal jump?

## Verdict

Yes, with a custom renderer Adapter and exact reveal geometry. TanStack Table correctly supplies one `start + centre + end` Logical Column Order and one-step Cell navigation. TanStack Virtual correctly bounds the mounted row and centre-column windows. BrunoTable must own the seam between them instead of calling the example's broad `scrollToIndex` reveal.

The prototype uses 5,000 rows and 150 columns with two start-pinned columns and one end-pinned column. At a 1280 × 720 viewport it mounted 28 rows and 15 columns. The exact installed React Virtual hook passed the repository's compiler-on lint/type check and ran correctly in the browser. Keep it behind a private Adapter because this prototype validates the current release, not every future release or configuration.

## Findings

### One scroll authority

One native two-axis element must own `scrollTop`, `scrollLeft`, dimensions, and virtualizer observation. A Base UI Scroll Area may provide visual chrome only if it exposes and decorates that exact viewport. Composing another hidden viewport would split geometry authority and is rejected.

### Pinned regions

Individually sticky end cells naturally collapse beside the start cells when centre cells are absolutely positioned. The working composition renders the end-pinned columns inside one sticky end-region container and positions its cells within that region. Start and end regions remain continuously mounted; only centre columns are virtualized.

### Exact keyboard reveal

For each axis, the renderer compares the destination bounds with the visible band after sticky insets. A fully visible target causes no movement. A hidden leading or trailing edge produces the smallest clamped offset that reveals that edge.

Live held-arrow observations showed:

- horizontal movement first exposed the partially clipped column by `22 px`, then advanced by the exact next column widths (`124`, `140`, `92`, `108`, and so on);
- vertical movement first exposed the partially clipped row by `7 px`, then advanced by the exact fixed `28 px` row height;
- end-pinned Actions → final centre column reached the maximum centre offset, and the adjacent move back to Actions caused a `0 px` horizontal delta.

This is cell-by-cell reveal, not index alignment or a guessed multi-column jump.

### Subscription and initialization boundaries

The table owner selects only structural pinning/order/visibility state. Committed widths and live
resize previews belong to BrunoTable's layout runtime. Each mounted row selects the active Column
Identity for only that Row Identity from `table.atoms.cellSelection`; focus movement therefore does
not subscribe the grid root to Cell Selection.

The live test also caught a repeating initialization effect: after the first virtual-window scroll render it reset focus to the first cell. Initial Active Cell installation must be guarded as one-shot initialization or installed directly in the owned store, never replayed from changing row/column arrays.

## Production constraints

- Keep TanStack Table and Virtual types out of public BrunoTable APIs.
- Keep one shared immutable column-window snapshot for header, body, hit testing, and reveal.
- Cache centre-column geometry when production layout width/order/visibility state changes; do not rebuild it inside every key repeat.
- Drive scroll readouts, measurement, and other high-frequency diagnostics outside React state.
- Treat this as architectural and interaction proof, not proof of the final 120 Hz budget. Add automated browser interaction benchmarks with production cell renderers and representative hardware.
