# Phased implementation plan

## Principle

Do not start by building every AG Grid feature.

Validate the riskiest foundations with small vertical slices.

## Phase 0: Repository and design validation

Before code:

1. inspect repository structure
2. identify package boundaries
3. identify styling, testing, and build conventions
4. confirm React and TypeScript versions
5. confirm React Compiler setup
6. confirm TanStack Table v9 compatibility
7. confirm virtualization library/compiler behaviour
8. create an architecture decision record for any deviations
9. enable and verify the repository's full strict TypeScript profile
10. define source-level and emitted-package type-test harnesses

Deliverables:

- dependency map
- package plan
- risk register
- benchmark harness plan
- type-test plan

## Phase 1: Typed public table and columns

Build:

- `BrunoTableColumns<TRow>` for plain object arrays used with `satisfies`
- the shared table-props interface
- explicit `BrunoTableClient` and `BrunoTableServer` prop interfaces
- mandatory `tableId`
- mandatory `getRowId`
- mandatory explicit `` `COL_ID_${Uppercase<string>}` `` identity on every leaf column
- mutually exclusive field and computed columns
- direct `field` value inference
- computed `valueGetter` return inference
- typed formatters
- capability derivation for editing, sorting, and filtering
- computed columns excluded from automatic filter and sort capabilities
- type-level tests
- emitted-package consumer type tests

No rendering sophistication yet.

Success criteria:

- no `defineGrid`, public column helper, `definition`, or `rowModel` prop
- no single public component with a client/viewport mode flag or source union
- lowercase and unprefixed column identities fail compilation
- invalid fields fail compilation
- computed values infer correctly
- simultaneous `field` and `valueGetter` fails compilation
- invalid filter operators fail
- invalid editor types fail
- no repeated generic annotation at JSX usage
- no `any` in exported declarations or representative inference paths
- no consumer casts for valid column, source, edit, filter, or sort usage

## Phase 2: Client read-only vertical slice

Build:

- `<BrunoTableClient tableId getRowId columns clientSource />`
- structurally typed Client Source integration, including direct `useLiveQuery(...)` results
- loading, stale, closed, and error lifecycle overlays without discarding retained rows
- incomplete-source detection for ready/stale results
- the shared Grid Runtime and `BrunoTableView`
- the Client Row Pipeline Adapter
- optional toolbar children rendered inside the stable grid provider
- `BrunoTableToolbar` layout primitive with no empty region when absent
- client row model
- shared filter and sort commands with client row-model processing
- one continuous scroll surface with no pagination feature or controls
- fixed row height
- vertical virtualization
- horizontal centre-column virtualization
- pinned start and end columns
- basic headers and cells
- React Compiler boundary
- private TanStack subscription Adapter
- dependency-shaped render boundaries for cells, rows, headers, and overlays
- per-row subscriptions
- stable unchanged row references

Success criteria:

- a complete effect-view-server `useLiveQuery` result passes directly as `clientSource` without an Adapter or Effect dependency in BrunoTable
- loading/error lifecycle changes do not replace the Grid Runtime or rerender unrelated mounted cells
- arbitrary toolbar children do not subscribe or rerender the grid body
- under a 20 Hz row-update fixture, a command-only toolbar control receives no grid notifications or React renders, and a Quick Filter control does not render unless its committed filter value changes
- row-record updates that preserve counts do not notify row-metric, filter, sort, preference, selection, source-status, or edit-summary channels
- ready/stale sources with `rows.length !== totalRows` fail visibly
- 1 million logical rows in stress fixture
- 1,000 columns in stress fixture
- bounded mounted cells
- the full processed client row model remains continuously scrollable without page state or row slicing
- no full-grid rerender on a single row replacement
- React Compiler tests prove nested builder-method UI stays current without subscribing the table root to every state slice
- smooth 120 Hz scrolling target on capable hardware

## Phase 3: Keyboard navigation

Build before editing:

- logical focus store
- navigation engine
- pinned/centre/pinned traversal
- header/body traversal
- scroll-into-view
- navigation to virtualized cells
- focus restoration after unmount
- accessibility roles and indices

Success criteria:

- all navigation invariants tested
- no DOM-order dependency
- no focus loss under virtualization
- arrows always reveal destination

## Phase 4: Column management and persistence

Build:

- animated drag reorder
- resize
- visibility
- pinning
- right-side tool rail
- `BrunoTableQuickFilter` with explicit eligible-column semantics
- toolbar filter controls that dispatch the same typed filter commands as header filters
- active filter count
- active sort count
- hidden column count
- reset actions
- live resize widths applied through frame-batched CSS variables outside React reconciliation
- isolated reactive state for resize handles and accessibility output
- local-storage adapter
- URL adapter
- schema versioning and sanitization

Persist only:

- filters
- sorts
- order
- visibility
- widths
- pinning

Success criteria:

- new/removed columns reconcile safely
- Quick Filter and toolbar-created Grid Filters appear in global active-filter review
- Source Constraints are never serialized as grid preferences or cleared by grid filter reset
- no ephemeral state is serialized
- drag commits once
- live resize does not rerender the mounted body on each pointer frame
- drag animation stays within frame budget

## Phase 5: Server viewport read-only model

Build:

- `<BrunoTableServer tableId getRowId columns viewportSource />`
- `viewportSource` support compatible with effect-view-server's Live Query Viewport
- the Viewport Row Pipeline Adapter behind the shared Grid Runtime
- Column Identity to Query Field translation
- typed recursive grid-filter compilation into View Server `where`
- typed grid-sort compilation into View Server `orderBy`
- explicit `select` projection from field columns plus infrastructure requirements
- long-lived datasource session
- sink
- query generations
- effect-view-server `replace` and generation `setWindow` lifecycle
- indexed block cache
- stable identity store
- range loading
- exact `totalRows` scroll geometry
- stale response rejection
- block eviction
- block errors and retry
- viewport-driven requests
- row-level subscriptions
- range invalidation

Success criteria:

- consumers render `BrunoTableServer` with `columns`, `getRowId`, and `viewportSource` without an intermediate grid definition
- server scrolling exposes no pagination state or controls and can jump directly to an arbitrary indexed window
- client and viewport tables render the same header, filter, sort, cell, and navigation Modules
- common UI contains no client-versus-viewport conditionals
- persisted filters and sorts remain keyed by `columnId`
- View Server queries contain validated fields resolved from current column definitions
- `valueGetter`-only columns cannot silently enter server filters, sorts, or projections
- scrolling does not route row batches through top-level React state
- one row update rerenders only relevant subscribers
- stale query responses are ignored
- block cache is bounded
- unloaded destination indexes render stable placeholders while their window is loading
- fixed-height geometry remains stable

## Phase 6: Selection and capability policies

Build:

- logical range selection
- drag selection
- autoscroll
- capability engine
- loaded-range checks
- server-side restrictions
- clear user messaging for disabled operations
- query-revision handling
- cell-selection state excluded from the table-root subscription
- derived row-level selection subscriptions for range styling and selection edges

Success criteria:

- no partial silent copy/fill/edit
- selection can outlive mounted cells
- selection clears or reconciles on query change
- extending a range rerenders only mounted rows whose derived selection presentation changes

## Phase 7: Editing foundation

Build:

- sparse drafts
- typed edit transactions
- editor lifecycle
- sync parsing
- sync validation
- undo/redo
- Batch Save Capability triggered by `onSaveEdits` on either public table variant
- persistent Edit Safety Footer with status-left and Reset/Save-right layout
- unsaved count
- validation count
- client-row editing first

Success criteria:

- one paste/fill is one undo step
- row eviction cannot destroy edits
- edit state is identity-keyed
- editor arrows do not break text cursor behaviour
- no `onSaveEdits` means no Edit Safety Footer
- supplying `onSaveEdits` mounts the same footer in both public variants without changing column editability
- no-edit state keeps the footer mounted with Reset and Save disabled
- Reset clears edit-owned state only
- stable row updates do not notify or rerender footer controls when their compact projections are unchanged

## Phase 8: Conflicts and server save

Build:

- base/server/user triple
- conflict detection
- conflict cell visuals
- conflict count mounted on the footer left only when non-zero
- merge-style modal
- all mine/all server
- column-wide resolution
- optimistic concurrency
- save results
- canonical server reconciliation
- conflict retry

Success criteria:

- server remains final authority
- unresolved conflicts block save
- Save with unresolved conflicts and direct conflict-count activation open the same modal and actor
- `onSaveEdits` is never invoked while conflicts or blocking validation remain
- proactive review works before Save
- stale versions can conflict again safely

## Phase 9: Clipboard and drag fill

Build:

- TSV copy/paste
- typed parsing
- read-only skipping
- validation
- pattern fill
- fill preview
- loaded-range restrictions
- transaction batching
- server-assisted extension points

Success criteria:

- no accidental partial operations
- large operations do not emit one event per cell
- undo remains transaction-level

## Phase 10: Advanced capabilities

Potential later work:

- async validation
- named views
- shared views
- group headers
- row grouping
- aggregation
- tree data
- detail rows
- variable row heights
- export
- pivot
- server-assisted bulk operations
- per-cell subscriptions for hot columns
- custom virtualization adapter without compiler escape hatch

## Initial Codex task

The first Codex task should not implement everything.

Use this prompt:

Read `AGENTS.md` and every file under `docs/grid/`.

Inspect the repository and produce:

1. a dependency and package map
2. architectural conflicts or missing constraints
3. a phased implementation plan adapted to the repository
4. a proposal for the smallest vertical slice
5. public TypeScript API sketches for that slice
6. required type-level, behavioural, and performance tests

Do not implement code yet.

Challenge underspecified details, but preserve the stated requirements unless a deviation is justified.
