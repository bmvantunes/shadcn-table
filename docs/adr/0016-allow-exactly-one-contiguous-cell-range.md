---
status: superseded by ADR-0020
---

# Allow exactly one contiguous Cell Range Selection

`BrunoTableClient` supports at most one contiguous rectangular Cell Range Selection. This is a permanent product invariant, not a V1 deferral: BrunoTable exposes no additive ranges, subtractive holes, disconnected rectangles, or multi-range mode.

The internal state shape is conceptually singular:

```ts
type BrunoTableCellRangeState = {
  range?: BrunoTableCellRange;
  activeCell: BrunoTableCellIdentity;
};
```

A new click or drag selection replaces the previous rectangle. Shift+arrow and the approved pointer extension gesture resize the one rectangle from its stable anchor. Ctrl/Cmd-modified cell selection never adds, toggles, or subtracts another region; an otherwise valid selection gesture still resolves to one replacement rectangle. Row Selection remains a separate capability and is unaffected.

Copy, paste, drag fill, keyboard traversal, visual edge derivation, and atomic edit transactions therefore operate over either one Active Cell or one rectangular range. No clipboard serialization or mutation operation needs to invent an ordering between disconnected areas.

TanStack Table v9 may internally represent cell selection as an ordered list of include/exclude rectangle operations, and its example demonstrates additive and subtractive ranges. BrunoTable may adapt its rectangle geometry and identity handling, but the private Adapter must normalize state to at most one positive rectangle and must not expose or install multi-range operations ([TanStack v9 cell-selection research](../grid/research/tanstack-table-v9-beta-74.md#cell-range-selection)).
