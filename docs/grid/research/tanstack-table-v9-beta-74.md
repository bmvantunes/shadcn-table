# TanStack Table v9 beta.74 update

Research snapshot: 2026-08-02.

> Historical snapshot. TanStack Table v9 became stable on 2026-08-05 and this repository now pins `9.0.0`. See [TanStack Table v9 stable update](./tanstack-table-v9-stable.md).

## Version status

The npm `latest` tag still points to TanStack Table v8 (`8.21.3`). The v9 `beta` tag now points to `9.0.0-beta.74`; npm does not publish an untagged `9.0.0` package yet. The vendored source tracks commit [`1b70a17`](https://github.com/TanStack/table/tree/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7), and `@bruno/table` pins that exact beta.

## Relevant changes through beta.74

- beta.70 added cell and header spanning, including span-aware cell-selection geometry.
- beta.71 added opt-in sorting auto-reset. Sorting is preserved across data-reference changes by default; `autoResetSorting: true` or an explicit `autoResetAll` enables resetting.
- TanStack's row-selection handler supports inclusive Shift-range selection in current logical display order. This capability was already present in the source pinned by beta.71; Kevin Van Cott highlighted it publicly on 2026-08-02 as part of the v9 row-selection work.
- beta.72 fixed the sub-row selected state when a row has no selectable descendants.
- beta.73 fixed row pinning after ungrouping.
- beta.74 makes select-all paths honor row/sub-row selection rules and adds an opt-in `deselectParents` policy for clearing stale selected ancestor IDs when a descendant is deselected.

The beta.71-to-beta.74 diff does not change the React subscription APIs, cell-selection geometry, filtering, sorting, or the React spreadsheet example. The existing BrunoTable conclusions for those areas remain valid.

Primary local references:

- [React cell-selection guide](../../../.repos/table/docs/framework/react/guide/cell-selection.md)
- [React cell-selection example](../../../.repos/table/examples/react/cell-selection/src/main.tsx)
- [Cell-selection feature types](../../../.repos/table/packages/table-core/src/features/cell-selection/cellSelectionFeature.types.ts)
- [Cell-selection geometry](../../../.repos/table/packages/table-core/src/features/cell-selection/cellSelectionGeometry.ts)
- [React row-selection guide](../../../.repos/table/docs/framework/react/guide/row-selection.md)
- [Row-selection feature types](../../../.repos/table/packages/table-core/src/features/row-selection/rowSelectionFeature.types.ts)
- [Row-selection range tests](../../../.repos/table/packages/table-core/tests/implementation/features/row-selection/rowSelectionRange.test.ts)
- [Cell-spanning feature](../../../.repos/table/packages/table-core/src/features/cell-spanning/cellSpanningFeature.types.ts)
- [Sorting auto-reset implementation](../../../.repos/table/packages/table-core/src/features/row-sorting/rowSortingFeature.utils.ts)

## Two distinct selection capabilities

Do not conflate row range selection with cell range selection.

### Cell range selection

TanStack's cell-selection feature stores ordered include/exclude rectangle operations keyed by stable Row and Column Identities. Its React example demonstrates drag selection, Shift extension, additive and subtractive ranges, pinned and reordered columns, keyboard movement, clipboard extraction, and fine-grained row subscriptions.

BrunoTable deliberately adopts only the stable identity, pinned-order, and interaction techniques that survive its stricter normalization boundary. Its permanent public and internal contract permits at most one horizontal `1×N` or vertical `N×1` Linear Cell Range. A private Adapter must discard or reject two-axis rectangles, additive operations, subtractive holes, and disconnected multi-range state rather than leaking TanStack's more general model.

This remains the first implementation candidate for pointer selection, identity handling, and pinned-column ordering, but not for BrunoTable's normalized range state. The Adapter should reuse proven mechanics where useful while projecting every accepted gesture into the one-axis discriminated union and preventing two-dimensional geometry from crossing the boundary.

### Row range selection

TanStack's row-selection feature stores selected Row Identities and keeps a table-local interaction anchor. An ordinary interaction through `row.getToggleSelectedHandler()` establishes the anchor; Shift-clicking another row selects or deselects the inclusive interval in current display order and moves the anchor to the clicked endpoint.

That order includes client filtering, sorting, grouping, and expansion. It can cross client-side pages because those rows exist in the pre-pagination model. It cannot include unloaded manual/server rows, because TanStack has neither their Row objects nor their stable Row Identities.

BrunoTable should reuse the handler semantics for the Client Table. The Server Table still needs a BrunoTable-owned capability policy and logical selection representation for unloaded indexes and all-matching-query intent; TanStack's loaded-row implementation cannot silently stand in for that contract.

## BrunoTable implications

TanStack remains a private implementation candidate rather than BrunoTable's public selection contract:

- never export TanStack column definitions, feature registration, table instances, atoms, selection state, or handler types;
- map BrunoTable Row and Column Identities into the private features;
- keep row selection and cell range selection as separate semantic capabilities;
- do not persist either selection kind;
- keep keyboard navigation as BrunoTable core infrastructure, even when it delegates private movement primitives;
- use an external store or private atom rather than top-level React state for drag updates;
- batch visual pointer work with `requestAnimationFrame` where profiling requires it;
- bind row-selection UI through the supported toggle handler so its table-local Shift anchor is maintained;
- do not claim unloaded Server Table Shift ranges or select-all behavior merely because the client feature supports loaded rows.

TanStack documents that cell dragging emits an update whenever the pointer crosses a cell boundary. Its React example excludes selection from the top-level `useTable` selector and subscribes at a fine-grained row boundary with a compact derived key. That matches BrunoTable's 120 Hz architecture and should be preserved through the Adapter.

See [TanStack Table v9 fine-grained React subscriptions](./tanstack-table-v9-fine-grained-subscriptions.md) for the exact APIs, React Compiler implications, selection and resizing patterns, and recommended BrunoTable subscription map.

Sorting must remain stable while live client rows or sparse server windows change. The v9 default already does this, but BrunoTable should set the private option deliberately so a future TanStack default cannot alter grid behaviour.

Cell spanning is not needed for the first vertical slice. When added, the renderer must skip body cells whose computed row or column span is zero; emitting HTML `rowspan="0"` has different browser semantics and would be incorrect.
