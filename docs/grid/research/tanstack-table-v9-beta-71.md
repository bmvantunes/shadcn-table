# TanStack Table v9 beta.71 update

Research snapshot: 2026-08-02.

## Version status

The npm `latest` tag still points to TanStack Table v8 (`8.21.3`). The v9 `beta` tag moved from the repository's previous `9.0.0-beta.65` dependency to `9.0.0-beta.71` today. The vendored source now tracks commit [`958551d`](https://github.com/TanStack/table/tree/958551dbbc28752345033c40e6b4c88d592e8120), and `@bruno/table` pins that exact beta.

## Relevant changes since beta.69

- beta.70 added cell and header spanning, including span-aware cell-selection geometry.
- beta.71 added opt-in sorting auto-reset. Sorting is preserved across data-reference changes by default; `autoResetSorting: true` or an explicit `autoResetAll` enables resetting.
- The React cell-selection example now demonstrates drag selection, Shift extension, additive and subtractive ranges, stable row/column identities, pinned and reordered columns, keyboard movement, clipboard extraction, and fine-grained subscription through an external atom.

Primary local references:

- [React cell-selection guide](../../../.repos/table/docs/framework/react/guide/cell-selection.md)
- [React cell-selection example](../../../.repos/table/examples/react/cell-selection/src/main.tsx)
- [Cell-selection feature types](../../../.repos/table/packages/table-core/src/features/cell-selection/cellSelectionFeature.types.ts)
- [Cell-selection geometry](../../../.repos/table/packages/table-core/src/features/cell-selection/cellSelectionGeometry.ts)
- [Cell-spanning feature](../../../.repos/table/packages/table-core/src/features/cell-spanning/cellSpanningFeature.types.ts)
- [Sorting auto-reset implementation](../../../.repos/table/packages/table-core/src/features/row-sorting/rowSortingFeature.utils.ts)

## BrunoTable implications

TanStack's cell-selection capability is now substantial enough to be the first implementation candidate for selection state and range geometry. BrunoTable should adapt it behind the private runtime instead of rebuilding rectangles, inclusion and exclusion operations, pinned-column ordering, and span expansion immediately.

That does not make TanStack's state public. BrunoTable still owns its branded `columnId`, stable row identity, commands, persistence rules, clipboard contract, focus semantics, and fine-grained React boundary. In particular:

- never export TanStack column definitions, feature registration, table instances, atoms, or selection types;
- map BrunoTable row and column identities into the private feature;
- do not persist selection, because it remains transient interaction state;
- keep keyboard navigation as BrunoTable core infrastructure, even if it calls private TanStack movement primitives;
- use an external store or private atom rather than top-level React state for drag updates;
- batch visual pointer work with `requestAnimationFrame` where profiling requires it.

The last point matters because TanStack documents that drag selection emits an update whenever the pointer crosses a cell boundary. Its React example deliberately excludes selection from the top-level `useTable` selector and subscribes at a fine-grained row boundary using a small derived selection key. That matches BrunoTable's 120 Hz architecture and should be preserved through the Adapter.

Sorting must remain stable while live client rows or sparse server windows change. The new v9 default already does this, but BrunoTable should set the private option deliberately so a future TanStack default cannot alter grid behaviour.

Cell spanning is not needed for the first vertical slice. When added, the renderer must skip body cells whose computed row or column span is zero; emitting HTML `rowspan="0"` has different browser semantics and would be incorrect.
