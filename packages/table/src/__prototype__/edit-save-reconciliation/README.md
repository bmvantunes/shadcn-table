# PROTOTYPE — edit/save reconciliation

This throwaway logic prototype asks one question:

> Can XState own the legal Immediate/Batch workflow while TanStack Store owns sparse row-, cell-, and operation-indexed memory, including concurrent Immediate saves, atomic Batch locking, conflicts, undo/redo, `PromiseLike<void>` settlement, and authoritative live-source reconciliation?

It deliberately does not render React, call a server, persist state, or attempt production abstractions. The terminal shell drives one portable model and prints the complete relevant state after every command.

Run it from the repository root:

```sh
vp run prototype:edit-save
```

Useful hostile paths:

1. Run two Immediate edits against different cells in row `A`, resolve both, then publish one live row version.
2. Enter Batch mode, edit cells across rows, save, resolve, then confirm the rows one at a time.
3. Reject a Batch save, then publish the submitted values to prove live convergence supersedes the ambiguous rejection.
4. Create a Batch draft, publish a different server value, resolve with Mine or Server, and save again.

The prototype is finished only when those paths reveal whether the ownership split is coherent. Its code is evidence, not production code.

## Verdict

Yes—the ownership split is coherent, including concurrent Immediate operations, Batch-wide locking, timeout-free Accepted Overlays, rejection followed by authoritative convergence, safe row-level rebase, conflict resolution, row disappearance, and per-row Batch confirmation.

The prototype exposed three constraints that the production design must retain:

1. XState stays private. It decides whether commands are legal and owns operation lifecycles, but React subscribes only to compact TanStack Store projections. Subscribing independently to both authorities would expose transient cross-store ordering.
2. Batch history records reversible sparse cell-state patches, including Draft and Conflict evidence—not only old/new displayed values. Otherwise Mine/Server conflict resolutions cannot be undone correctly after rebasing or discarding a Draft.
3. The operation repository needs identity indexes and bounded cleanup. Active and rejected operations retain immutable submitted evidence for reconciliation; completed presentation records must be pruned after their flash/notification lifecycle rather than accumulating forever.

The prototype also confirmed that no Save Operation result payload is needed. Promise settlement and live-source evidence are independent events, and the model handles either arrival order without converting source rows into write responses.
