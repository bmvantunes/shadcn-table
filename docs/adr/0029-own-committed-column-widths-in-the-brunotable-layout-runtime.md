# Own committed column widths in the BrunoTable layout runtime

Status: Accepted

## Context

BrunoTable presents one Logical Column Order across pinned-start, virtualized-centre, and
pinned-end regions. A committed resize is a user preference and must have one durable owner. The
Client Adapter also uses TanStack Table privately for column ordering, visibility, pinning, and
row-model projection, but the renderer's width preview and committed width snapshot already live
in BrunoTable's layout runtime.

Keeping a second authoritative width in TanStack's `columnSizing` state would create two mutable
owners for the same preference. It would also make the pointer fast path depend on React/TanStack
state publication, contrary to the geometry and 120 Hz interaction boundaries.

## Decision

BrunoTable's private layout runtime owns committed column widths. The runtime stores the immutable
width override keyed by Column Identity, clamps it to the compiled bounds, publishes one typed
`column.resize.commit` command at the end of a keyboard or pointer operation, and exposes the
result through its private column-command and layout snapshots.

The Client Adapter bridges the runtime's logical order, visibility, and pinning into controlled
TanStack inputs. It does not bridge committed widths into TanStack sizing state, and no TanStack
Table or Column object crosses the BrunoTable public boundary. The renderer reads the runtime width
for layout and applies the committed value to its CSS width variable.

During a pointer resize, BrunoTable writes the provisional width to the grid's CSS variable from
the imperative animation-frame path. Ordinary preview frames change neither React state nor the
durable runtime snapshot. If the preview crosses the deterministic narrow-width pinning-suspension
threshold, or if its recalculated centre window no longer fits inside the currently mounted slice,
the viewport may publish one bounded structural snapshot for that preview call so the mounted
start/centre/end regions remain geometrically valid. The latter covers, for example, shrinking a
wide first centre column until later columns must mount. When a preview window is a strict subset of
the retained mounted slice, the CSS padding is calculated from that retained slice rather than the
smaller prospective window; this keeps the imperative preview geometry aligned without publishing
one React update per pointer move. These are bounded region-shape transitions, not committed layout
updates. Finishing the gesture cancels any pending frame, clears the preview, and emits one final
typed command; if the last pointer coordinate has not completed an rAF, the synchronous release
fallback is measured and kept under the same bounded style-write rule. Cancelling or unmounting
emits none. Pointer reorder uses the same geometry-owned transform preview rule.

## Consequences

- There is one authority for committed widths and persistence notifications.
- TanStack remains useful for its private projection responsibilities without becoming a public
  state or object dependency.
- Width previews remain outside React rendering and can be coalesced to one animation frame.
- A width-only commit updates column-command/layout subscribers but does not publish a query or
  rebuild the row model.
- If TanStack's sizing API is used in a future implementation, it must be an implementation detail
  bridged from this runtime owner rather than an independent source of truth.
