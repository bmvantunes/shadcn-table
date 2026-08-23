# Keep Row Selection outside user column state

## Decision

The optional Client Row Selection Column is a BrunoTable-owned sticky utility gutter with fixed private identity `COL_ID_BRUNO_TABLE_ROW_SELECTION`. It is not inserted into the normalized consumer column tuple. The renderer accounts for its compact width before pinned-start and virtualized data, while Row Selection owns a separate Row Identity-keyed runtime and narrow header/per-row subscriptions.

## Consequences

The gutter remains available beside pinned and virtualized data without entering Logical Column Order, Active Cell navigation, clipboard exchange, query semantics, or persisted column order, visibility, widths, and pinning. `rowSelection?: true` installs both the private runtime and gutter only in an ordinary `BrunoTableClient`; Server and grouped projections omit the UI, command seam, and state entirely. A future first Group By transition must clear the runtime before changing projection rather than retaining dormant selection.

Treating the gutter as an ordinary TanStack or consumer column would simplify some table markup, but it would make a command-only capability observable in public inference and user preferences. Keeping it private preserves the deeper table interface at the cost of one explicit renderer geometry seam.
