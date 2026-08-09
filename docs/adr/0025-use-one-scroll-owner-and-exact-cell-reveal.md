# Use one scroll owner and exact Cell reveal

The shared renderer owns one native two-axis scroll element as the sole authority for offsets, viewport dimensions, virtual windows, pinned insets, measurement, and hit testing. A visual Scroll Area may decorate or expose that same viewport, but it may not introduce a second scroll owner. TanStack Virtual windows rows and centre columns behind a private Adapter; start- and end-pinned columns remain continuously mounted in separate sticky regions while TanStack Table supplies their single Logical Column Order.

Decorative scrollbar tracks derive from the same immutable geometry without becoming another authority. A horizontal track spans only the effective centre region after pinned-start and pinned-end insets; a vertical track excludes the sticky header and any visible horizontal scrollbar. Per-scroll thumb metrics are frame-batched and written only to the isolated overlay subtree that reads them, never to inherited custom properties on the grid root that would invalidate every mounted row and cell.

Keyboard navigation never delegates destination reveal to a nearest-index `scrollToIndex` heuristic. For fixed geometry, the renderer computes the destination cell's logical bounds, subtracts the sticky header/start/end insets, and applies only the minimum clamped `scrollTop` and `scrollLeft` deltas. Initial Active Cell installation is one-shot state initialization and must not replay after a virtual-window render.

The reviewed external implementation references and explicit non-goals are recorded in [ReUI data-grid patterns](../grid/research/reui-data-grid-patterns.md).
