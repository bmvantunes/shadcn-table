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
- mandatory explicit non-empty `headerName` on every leaf column
- mandatory explicit runtime `valueType` on raw value-bearing columns, with no row sampling
- mutually exclusive field and computed columns
- direct `field` value inference
- computed `valueGetter` return inference
- typed formatters
- optional typed `BrunoTableTextColumn`, `BrunoTableNumberColumn`, `BrunoTableBigIntColumn`, `BrunoTableBooleanColumn`, and `BrunoTableSelectColumn` helpers that return ordinary definitions
- reusable `withDefaults` Column Presets with built-in, preset, then individual-option precedence
- optional Effect entry-point `BrunoTableBigDecimalColumn`
- typed `valueFormatter`, conditional cell-class, and cell-renderer presentation overrides on raw, helper, and preset columns
- compiled Column Value Semantics with capability-derived filter operands
- built-in explicit `bigint` semantics without `number` coercion
- optional-integration type seam that keeps Effect out of root declarations
- capability derivation for editing, sorting, and filtering
- computed columns excluded from automatic filter and sort capabilities
- type-level tests
- emitted-package consumer type tests

No rendering sophistication yet.

Success criteria:

- no `defineGrid`, required column helper, `definition`, or `rowModel` prop
- no single public component with a client/viewport mode flag or source union
- lowercase and unprefixed column identities fail compilation
- missing header names fail compilation, while dynamic missing, non-string, or blank names fail runtime normalization
- invalid fields fail compilation
- raw columns without a Value Type fail compilation, while helpers supply the matching type
- applying a helper to an incompatible field value fails compilation
- helper and preset calls preserve literal identity, computed values, and exact row/value callback types without casts or repeated row generics
- built-in, preset, and individual-option precedence is covered by behavioral tests
- computed values infer correctly
- simultaneous `field` and `valueGetter` fails compilation
- invalid filter operators fail
- `bigint` filters accept only `bigint` operands and mixed numeric domains receive no automatic ordering capability
- a consumer fixture imports the root package successfully without Effect installed
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
- semantic `<th>` rendering whose default visible and accessible label comes from `headerName`
- the Client Row Pipeline Adapter
- optional toolbar children rendered inside the stable grid provider
- `BrunoTableToolbar` layout primitive with no empty region when absent
- client row model
- shared filter and sort commands with client row-model processing
- explicit exact-numeric client comparators and filters, including half-open `inRange`
- one continuous scroll surface with no pagination feature or controls
- fixed row height
- vertical virtualization
- horizontal centre-column virtualization
- pinned start and end columns
- one shared immutable centre-column window for header and body
- basic headers and cells
- helper-owned semantic layout defaults for start-aligned text, end-aligned numbers, centered checkboxes, and full-width select editors
- typed per-column `valueFormatter`, `cellClassName`, and `cellRenderer` overrides without changing underlying semantics
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
- a 150-column fixture mounts only pinned columns plus the visible and overscanned centre window for each mounted row
- header and body render identical centre-column identities, widths, and virtual padding after resize, reorder, visibility, and pinning changes
- the full processed client row model remains continuously scrollable without page state or row slicing
- no full-grid rerender on a single row replacement
- React Compiler tests prove nested builder-method UI stays current without subscribing the table root to every state slice
- compiler-on tests prove horizontal and vertical windows, column resizing, and keyboard reveal never freeze behind a memoized mutable getter
- production benchmarks compare the exact installed Virtual React Adapter, Virtual core, `directDomUpdates` modes, and `useFlushSync` policy before locking the private default
- smooth 120 Hz scrolling target on capable hardware
- exact-numeric hot paths perform no value-kind sampling, schema inspection, or per-cell registry lookup

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
- held-arrow repeat crosses multiple virtual boundaries without losing logical moves
- Client reveal performs no source fetch, page slice, or pagination transition
- Server reveal publishes bounded contiguous viewport windows and can retain an unloaded Active Cell
- geometry, scrolling, and repeated-key handling cause no top-level React update per command

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
- tagged, versioned JSON-safe codecs for exact filter operands

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
- stale, wrong-codec, wrong-column, or invalid exact operands are dropped rather than coerced
- drag commits once
- live resize does not rerender the mounted body on each pointer frame
- drag animation stays within frame budget

## Phase 5: Server viewport read-only model

Build:

- `<BrunoTableServer tableId getRowId columns viewportSource />`
- `viewportSource` support compatible with effect-view-server's Live Query Viewport
- conditional exact `routeBy` values inferred from the Viewport Source: required for leased topics and forbidden otherwise
- source-owned Route Field tuples with no duplicated `routeByFields` table configuration
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
- native exact operands preserved through query translation
- explicit typed Row Version projection kept separate from Query Version
- optional Effect BigDecimal semantics with effect-view-server wire-admission and comparator parity

Success criteria:

- consumers render `BrunoTableServer` with `columns`, `getRowId`, and `viewportSource` without an intermediate grid definition
- every leased `viewport.replace(...)` includes the exact application-owned Feed Route, while materialized and source-free topics reject it
- Route Fields do not require visible columns, projection, or filter capability, and Feed Routes are never inferred from Set Filters
- a meaningful Feed Route change releases the old generation, clears sparse and transient row-space state, and retains compatible user preferences
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
- Client and Server exact numeric filters/sorts agree at equality, null, tie, and half-open range boundaries
- pathological safe-scale BigDecimals compare without scale-dependent allocation
- no save Adapter treats `viewportSource.version` as Row Version or delegates optimistic saves to unconditional runtime `patch`

## Phase 6: Selection and capability policies

Build:

- Row Selection keyed by stable Row Identity
- inclusive Shift-click Row Selection in current logical display order
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

- Row Selection and Cell Range Selection remain separate capabilities and state models
- Client Shift-click Row Selection includes the complete current display-order interval
- Server Shift-click never silently omits unloaded rows from the requested interval
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
- strict `editable` capability union that requires `onSaveEdits` and at least one potentially editable column
- Immediate/Batch mode source and top-right toggle with clean-state transition guard
- one non-empty Save Change Set handler shared by both modes
- persistent Edit Safety Footer with status-left and Reset/Save-right layout
- unsaved count
- validation count
- client-row editing first
- exact semantic equality for dirtiness, convergence, and canonical save results
- explicit nullable clear policy so blank exact input never becomes zero

Success criteria:

- one paste/fill is one undo step
- row eviction cannot destroy edits
- edit state is identity-keyed
- editor arrows do not break text cursor behaviour
- an invalid editor candidate cannot exit through Enter, Tab, Shift+Tab, or an outside pointer action; it remains active with an accessible anchored error until corrected or cancelled with Escape
- failed parsing or local validation creates no draft, undo entry, Save Change Set, or `onSaveEdits` invocation
- one invalid target rejects a complete multi-cell edit gesture without applying a valid prefix
- false or omitted `editable` rejects edit-only props and renders no editing chrome
- `editable: true` without `onSaveEdits` or a potentially editable column fails type-level tests
- `editable: true` mounts the same mode toggle and footer in both public variants without overriding cell policy
- toggle visibility and updates require no all-row predicate evaluation or row-content subscription
- mode switching is blocked while any edit-owned work or save is active and is never persisted
- no consumer prop can initialize or control Edit Mode; each session starts Immediate and only the end-user toggle changes it
- Immediate single-cell commit calls `onSaveEdits` with a one-element array
- Immediate paste, drag fill, and multi-cell clear each call `onSaveEdits` once with the full transaction
- every Save Change Set is atomic: the complete operation is accepted or rejected with no partial-success result
- disjoint Immediate operations may run concurrently; each operation locks only its owned cell set and one operation may own many cells
- Batch Save installs one grid-wide edit mutation lock until its single atomic operation settles
- accepted operations flash all affected cells green for two seconds without React or XState animation-frame events
- rejected operations immediately restore all affected cells to their latest live server values, retain an accessible red rejection treatment for five seconds, and aggregate into one manually dismissed table-scoped toast
- Batch Save coalesces repeated cell edits and calls the same handler with current net dirty cells
- undo/redo exists only inside the current unsaved Batch session, records one command per user gesture regardless of cell count, clears after accepted Save, and survives rejected Save
- semantic server convergence removes the cell from drafts, conflicts, validation, and every undo/redo patch; empty history commands are pruned so undo cannot resurrect a converged value
- no-edit state keeps the footer mounted with Reset and Save disabled
- Reset with pending work opens a read-only Reset Review table over every pending changed cell and performs no mutation until `Reset All Changes` is confirmed
- Reset Review exposes only `Keep Editing` and `Reset All Changes`; confirmation clears edit-owned state and current-batch undo/redo history together while preserving grid preferences
- stable row updates do not notify or rerender footer controls when their compact projections are unchanged
- exact `bigint`, BigDecimal, and Row Version types survive editor, draft, transaction, handler, and result inference

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
- conflict bulk actions require explicit row selection, selecting all is deliberate, and one resolution action creates one Batch undo command regardless of selected cell count

## Phase 9: Clipboard and drag fill

Build:

- TSV copy/paste
- typed parsing
- canonical exact-numeric text kept separate from display formatting
- read-only skipping
- validation
- pattern fill
- fill preview
- loaded-range restrictions
- transaction batching
- server-assisted extension points

Success criteria:

- no accidental partial operations
- an invalid exact operand or missing clear policy aborts the whole paste/fill transaction
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

## Exact-numeric verification gates

Before enabling Effect BigDecimal support by default, add:

- type tests for exact operands, mixed-domain rejection, nullable clear policy, typed Row Version, and Effect-free root declarations;
- property tests for comparison laws and BigDecimal scale normalization;
- cross-repository contract tests against the pinned effect-view-server comparator, filters, admission rules, null placement, and row-ID ties;
- 100k-row client sort/filter benchmarks for large bigints, wide decimal coefficients, and pathological safe scales;
- a regression proving comparator work depends on coefficient digits rather than scale difference;
- clipboard and persistence round trips beyond `Number.MAX_SAFE_INTEGER`;
- conflict tests where differently scaled BigDecimals are semantically equal;
- save tests proving Query Version is never used as Row Version and unconditional runtime patch is never selected as the optimistic write path.

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
