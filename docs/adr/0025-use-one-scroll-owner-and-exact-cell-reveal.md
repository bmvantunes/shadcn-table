# Use one scroll owner and exact Cell reveal

The shared renderer owns one native two-axis scroll element as the sole authority for offsets, viewport dimensions, virtual windows, pinned insets, measurement, and hit testing. A visual Scroll Area may decorate or expose that same viewport, but it may not introduce a second scroll owner. TanStack Virtual windows rows and centre columns behind a private Adapter; start- and end-pinned columns remain continuously mounted in separate sticky regions while TanStack Table supplies their single Logical Column Order.

Keyboard navigation never delegates destination reveal to a nearest-index `scrollToIndex` heuristic. For fixed geometry, the renderer computes the destination cell's logical bounds, subtracts the sticky header/start/end insets, and applies only the minimum clamped `scrollTop` and `scrollLeft` deltas. Initial Active Cell installation is one-shot state initialization and must not replay after a virtual-window render.
