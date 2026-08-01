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

Deliverables:

- dependency map
- package plan
- risk register
- benchmark harness plan
- type-test plan

## Phase 1: Typed grid definition

Build:

- `defineGrid`
- `createColumnHelper`
- mandatory `tableId`
- mandatory `getRowId`
- field columns
- accessor columns
- stable column IDs
- typed formatters
- typed sorting capability
- typed filtering capability
- type-level tests

No rendering sophistication yet.

Success criteria:

- invalid fields fail compilation
- accessor values infer correctly
- invalid filter operators fail
- invalid editor types fail
- no repeated generic annotation at JSX usage

## Phase 2: Client read-only vertical slice

Build:

- client row model
- fixed row height
- vertical virtualization
- horizontal centre-column virtualization
- pinned start and end columns
- basic headers and cells
- React Compiler boundary
- per-row subscriptions
- stable unchanged row references

Success criteria:

- 1 million logical rows in stress fixture
- 1,000 columns in stress fixture
- bounded mounted cells
- no full-grid rerender on a single row replacement
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
- active filter count
- active sort count
- hidden column count
- reset actions
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
- no ephemeral state is serialized
- drag commits once
- drag animation stays within frame budget

## Phase 5: Server viewport read-only model

Build:

- long-lived datasource session
- sink
- query generations
- indexed block cache
- stable identity store
- range loading
- row count and unknown count
- stale response rejection
- block eviction
- block errors and retry
- viewport-driven requests
- row-level subscriptions
- range invalidation

Success criteria:

- scrolling does not route row batches through top-level React state
- one row update rerenders only relevant subscribers
- stale query responses are ignored
- block cache is bounded
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

Success criteria:

- no partial silent copy/fill/edit
- selection can outlive mounted cells
- selection clears or reconciles on query change

## Phase 7: Editing foundation

Build:

- sparse drafts
- typed edit transactions
- editor lifecycle
- sync parsing
- sync validation
- undo/redo
- batch footer
- unsaved count
- validation count
- client-row editing first

Success criteria:

- one paste/fill is one undo step
- row eviction cannot destroy edits
- edit state is identity-keyed
- editor arrows do not break text cursor behaviour

## Phase 8: Conflicts and server save

Build:

- base/server/user triple
- conflict detection
- conflict cell visuals
- clickable conflict count
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
