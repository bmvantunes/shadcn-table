# Editable safety UI prototype verdict

Research and prototype verdict: 2026-08-06.

Primary source: throwaway [`codex/prototype-editable-safety-ui` prototype at `ded377c`](https://github.com/bmvantunes/shadcn-table/tree/ded377c/packages/editable-safety-prototype).

## Question

Which layout keeps a high-density editable trading grid primary while making drafts, validation,
concurrent Immediate saves, Batch locking, conflicts, destructive Reset, and failed Save Operations
obvious and recoverable?

The prototype compares three structurally different layouts over one seeded state model:

- **A — Footer safety rail** keeps the grid full width and puts conflict status, Reset, and Save in a
  persistent bottom rail. Reviews open on demand.
- **B — Side ledger** keeps a complete sparse change ledger visible beside the grid.
- **C — Bottom inspector** docks Changes, Conflicts, and Operations tabs below the grid.

All three use real `@bruno/shadcn` Base UI components and remain switchable with
`?variant=A|B|C`. The throwaway model deliberately does not claim to prove the production XState,
TanStack Store, or 120 Hz architecture.

## Verdict

Use **A — Footer safety rail** as the V1 default.

It preserves the complete horizontal budget for centre-column virtualization and pinned regions,
keeps the small number of authoritative actions continuously discoverable, and moves large sparse
collections into on-demand reviews. The side ledger visibly competes with wide tables. The bottom
inspector competes with the vertical row window and places important state below the ordinary
viewport. A future opt-in expanded inspector may borrow C's tabs, but it is not V1 default chrome.

Conflict Review remains a table-shaped, read-only internal `BrunoTableClient`. This preserves the
source column's exact formatting and alignment across heterogeneous values while pinning identity
and resolution controls around the comparison. Reset uses a separate live review because it is a
destructive all-change action, not a conflict-resolution path.

## Browser evidence

The browser run validated:

- invalid BigInt input retained editor focus after Enter and Tab, showed a text error, and exited
  only through Escape;
- three Immediate operations ran concurrently over disjoint cells without a table lock;
- Batch Save exposed one table-wide edit lock while leaving the table presentation intact;
- HTTP 500 produced one persistent explanatory notification, preserved work, and offered no Retry
  mutation action;
- every conflict required an explicit Mine/Server decision before Save became available;
- a failed Save initiated from Conflict Review left the dialog open and retained decisions;
- Reset opened a complete review with only Keep Editing and Reset All Changes;
- prototype arrow navigation changed variants but did not steal arrow keys from an active editor.

## Production constraints

- Footer status controls and actions remain independent fine-grained subscribers; the footer shell
  never observes rows or the complete edit store.
- Saving, success, failure, dirty, conflict, and invalid states require non-color cues. CSS owns
  tracer and flash frames and respects reduced motion.
- Conflict and Reset reviews acquire their sparse live projections only while mounted.
- Persistent notifications must remain keyboard and assistive-technology dismissible. The current
  imported toast rendered its visible Close control with `aria-hidden="true"` during the prototype
  run; production must verify and fix that component behavior before relying on it.
- The prototype validates interaction composition, not performance. Production browser benchmarks
  must exercise real virtualization, compiled value presentations, and store selectors.
