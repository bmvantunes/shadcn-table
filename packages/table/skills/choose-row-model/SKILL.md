---
name: choose-row-model
description: >
  Choose and configure BrunoTableClient versus BrunoTableServer, Client Source versus Viewport
  Source ownership, identity, sorting/filtering/grouping, virtualization, and source lifecycle.
  Load when wiring data, changing queries, or diagnosing sparse Server behavior.
metadata:
  type: core
  library: "@bruno/table"
  library_version: "0.0.0"
  skill_version: "1.0.0"
sources:
  - "bmvantunes/shadcn-table:packages/table/README.md"
  - "bmvantunes/shadcn-table:docs/grid/requirements.md"
  - "bmvantunes/shadcn-table:docs/grid/server-viewport-model.md"
  - "bmvantunes/shadcn-table:docs/adr/0002-expose-client-and-server-table-variants.md"
---

# Choose a BrunoTable row model

Use `BrunoTableClient` when the application supplies the complete resident Client Source and the
table may process rows locally. Use `BrunoTableServer` when an effect-view-server Viewport Source
owns a sparse indexed result and executes whole-result queries. Both variants expose one continuous
virtual row space; neither exposes pagination.

Both variants require a stable serializable string `tableId` for durable Table Identity; do not
substitute a Symbol or per-render generated identity.

## Client Table

- `getRowId` is mandatory and identifies raw `TRow` records. Row indexes are positions, never
  identities.
- Filtering and normal sorting operate over the complete admitted Client Source.
- A read-only Client may group and aggregate over its complete source. An Editable Client installs
  editing instead and has no grouping capability.
- Row Selection applies only to ordinary ungrouped source rows. First Group By activation atomically
  clears selected identities and the Shift anchor before showing grouped rows. Grouped views expose
  no row-selection surfaces, counts, bulk actions, or commands; ungrouping restores the optional
  capability empty, with no anchor or dormant selection.
- Keep unchanged row references stable across source publications.

## Grouping and Copy

Both read-only variants expose one flat summary row per complete ordered group-key tuple, never
expandable hierarchies, disclosure controls, nested children, drill-down, or per-group loading.
Group By add/remove/reorder cancels and clears the Client Cell Range before changing shape, then
resets Active Cell to row zero and the first visible navigable Logical Column (or none for an empty
result). Keep DOM focus on the initiating control; do not infer raw-to-group focus correspondence.

Grouping never requires drag: expose Add Group through a combobox and column-menu command, chip
Remove actions, and scoped `Alt+ArrowLeft/Right` reordering with accessible position announcements.
Pointer drag dispatches those same commands, not a separate keyboard pickup/drop workflow.

Copy validates the complete selected identity span and captures identities plus canonical values in
one immutable Clipboard Snapshot before serialization. Serialize only that snapshot and submit only
the finalized payload, never incremental live reads. Value-only publications preserve a Client range;
clear it before Copy when endpoints disappear or the ordered identities between them change.

## Server Table

- Install `effect-view-server@4.2.8` at the application's source boundary; BrunoTable does not
  install it for consumers. Require its source-owned semantics rather than reconstructing missing
  behavior through local fallbacks.
- `getRowId` and `getGroupedRowId` are forbidden. Raw and grouped identities come authoritatively
  from the source's sparse row-key map.
- Filtering, sorting, grouping, aggregation, and complete-domain faceting remain source-owned. Never
  process only the loaded viewport window locally.
- An empty Set Filter inclusion set is committed Match-None intent for current and future values.
  Compile it through the source-native Match-None expression, never empty `in`, current-facet
  enumeration, or negation of the current facet domain.
- A semantic Feed Route, projection, filter, sort, grouping, or aggregate change starts a clean Query
  Generation with `viewport.replace`. Scroll and reveal movement use `generation.setWindow` inside
  the same generation and retain overlap.
- The source's top-level Query Version is not a Row Version and cannot be used for optimistic writes.
- A Server Table is always read-only: no editing, paste, drag fill, conflicts, or Batch history.
- Server has neither Row Selection nor Cell Range Selection; Copy uses only its one loaded Active
  Cell. Choose a Client Table for one-axis Cell Range Selection and range copying, including in
  read-only grouped views.

## Source lifecycle

Loading publications render fixed-height skeletons, never candidate row data. Stale, closed, and
error publications retain previously coherent rows when available, with persistent status chrome;
without rows, use the corresponding shared empty/error presentation. Server retention never crosses
a semantic Query Generation boundary.

Closed and error states expose Retry only when the source supplies a Source Retry Capability.
One explicit activation invokes its `run` once; its `pending` flag owns disabling and progress.
BrunoTable never invents or schedules retries, awaits or interprets their results, or changes source
status optimistically. Loading and stale states expose no Retry, and this capability is never reused
for Save Operations.

## Shared renderer constraints

Use one native two-axis scroll owner. Virtualize rows and centre columns, keeping fitting pinned
columns in sticky start/end regions. Suspend pinning before measurement, when a measured mixed layout
leaves less than 80 CSS pixels for its centre, or when a centreless pinned layout exceeds the viewport.
Suspension uses one bounded start → centre → end virtual window with zero pinned insets; restore
pinning automatically once the layout fits, without changing Logical Column Order. Geometry,
scrolling, measurement, and hit-testing stay outside top-level React state.

Read the cited current source-lifecycle and viewport rules before changing Adapter behavior; do not
reconstruct missing source authority inside the table.

## Task-specific references

This entry point is not a replacement specification. Before implementing the corresponding behavior,
read the relevant sections of the bundled [requirements](../references/docs/grid/requirements.md):
“Grouping and aggregation execution”, “Selection and server-side capability policies”, “Continuous
scrolling contract” for virtualization and fixed-geometry reveal, “Accessibility and keyboard
navigation”, or “Persistence”. For sparse-source changes also read the bundled
[Server viewport model](../references/docs/grid/server-viewport-model.md). These references carry the
complete transition, lifecycle, and preference contracts; use only the sections relevant to the task.
