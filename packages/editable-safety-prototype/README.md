# Editable safety UI prototype

Three radically different presentations of the same BrunoTable editable safety workflow,
switchable with `?variant=A`, `?variant=B`, or `?variant=C`.

- **A — Footer safety rail:** the table remains primary and all edit safety appears in a compact
  footer plus modal reviews.
- **B — Side ledger:** an always-visible right rail exposes sparse changes, conflicts, and operation
  ownership beside the table.
- **C — Bottom inspector:** a docked tabbed inspector makes Changes, Conflicts, and Operations
  explorable without permanently narrowing the grid.

Run the throwaway prototype with:

```sh
vp run @bruno/editable-safety-prototype#dev
```

The prototype uses seeded local state and real `@bruno/shadcn` Base UI primitives. It does not use
the future BrunoTable production state machine or store.

## Verdict

Use **A — Footer safety rail** as the production default:

- it preserves the horizontal space needed by wide and column-virtualized grids;
- conflicts remain visible beside Reset and Save without making the table secondary;
- the conflict review naturally becomes a formatted, read-only BrunoTableClient;
- the same review opens from either the conflict count or Save;
- reset gets its own explicit review instead of turning the footer into a change ledger.

Do not use the permanent side ledger from B by default: it competes with wide tables. Do not keep
the bottom inspector from C permanently open: it consumes too much vertical space. A future
opt-in expanded inspector may reuse C's tabs for especially complex trading screens.

## Browser-validated behavior

- Invalid BigInt input retained focus after Enter and Tab; Escape canceled the edit.
- Three immediate saves ran concurrently and locked only their cells.
- Batch save locked editing across the grid until the operation settled.
- HTTP 500 produced a persistent explanatory toast with no Retry action and preserved changes.
- Mine/Theirs was required for every conflict before Save became available.
- Failed conflict save kept the modal open and preserved its decisions.
- Reset opened a complete change review with Keep editing and Reset all changes.
- Arrow keys switched prototype variants except while focus was inside an editor.

## Follow-up found by the prototype

The current shadcn/Base UI toast renders the persistent notification's visual close control with
`aria-hidden="true"`. Production must verify or fix the close control so a persistent failure is
dismissible by assistive-technology users.
