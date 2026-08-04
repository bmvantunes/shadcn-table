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
- default-enabled filtering and sorting for eligible Field Columns, with explicit per-column opt-outs
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
- one-time `initialFilters` baseline with persisted-state precedence and distinct Clear-versus-Reset behavior
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
- `BrunoTableServer` rejects `editable`, `onSaveEdits`, and every edit-only prop while still accepting shared column definitions that declare Client editability

## Phase 6: Selection and capability policies

Build:

- opt-in Client Row Selection, default off, keyed by stable Row Identity
- Client header checkbox selection over the complete currently filtered row model rather than mounted rows
- Client inclusive Shift-click Row Selection in current logical display order
- Client logical one-axis range selection
- Client drag selection
- autoscroll
- capability engine
- Server Active Cell without Row Selection or Cell Range Selection
- Server single-loaded-cell copy restriction
- clear user messaging for disabled operations
- query-revision handling
- cell-selection state excluded from the table-root subscription
- derived row-level selection subscriptions for range styling and selection edges

Success criteria:

- Row Selection and Cell Range Selection remain separate capabilities and state models
- Client Cell Range Selection owns at most one contiguous horizontal `1×N` or vertical `N×1` Linear Cell Range; new gestures replace it and Ctrl/Cmd never creates two-axis, additive, subtractive, or disconnected ranges
- public types and private normalized state contain one optional discriminated horizontal-or-vertical range rather than a general rectangle, `ranges[]`, or include/exclude operations
- the first accepted range extension locks one axis; pointer drag slop publishes no range, greater absolute displacement wins after the threshold, an exact tie stays `1×1`, parallel movement may resize through the anchor, and perpendicular movement is projected away until collapse
- drag autoscroll remains off before axis acquisition and enables only the matching horizontal or vertical channel afterward; perpendicular and pinned-region edge proximity cannot scroll the other axis
- Escape and `pointercancel` stop range autoscroll and restore the exact pre-gesture Active Cell/range snapshot without also applying ordinary Escape collapse
- pointer capture keeps outside release authoritative: selection retains its last projected range, while leaving the grid alone never cancels the gesture
- Client Row Selection is absent by default and its enabled Select All operation includes filtered virtualized rows outside the mounted DOM window
- filtering preserves selected Client Row Identities while the header checkbox computes its state against only the current filtered set
- Client Select All snapshots matching identities at the gesture; later inserts remain unselected and deletions prune removed identities
- Client Shift-click Row Selection includes the complete current display-order interval
- Server mounts no row checkbox, selected-row state, Shift-click row interval, Select All command, or cell range; it copies only its loaded Active Cell
- Server cell interaction exposes no paste, fill, or editing; V1 exposes no destructive cell Clear/Delete command in either row model
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
- blocked-change count and live Blocked Changes Review
- client-row editing only
- exact semantic equality for dirtiness, convergence, and canonical save results
- explicit nullable clear policy so blank exact input never becomes zero

Success criteria:

- one paste/fill is one undo step
- edit state is identity-keyed
- editor arrows do not break text cursor behaviour
- an invalid editor candidate cannot exit through Enter, Tab, Shift+Tab, or an outside pointer action; it remains active with an accessible anchored error until corrected or cancelled with Escape
- failed parsing or local validation creates no draft, undo entry, Save Change Set, or `onSaveEdits` invocation
- one invalid target rejects a complete multi-cell edit gesture without applying a valid prefix
- printable text over an eligible focused Client cell starts a replace-mode editor seeded with only the produced text, while Enter/F2 preserve the current pre-session value
- replace-on-type targets only the Active Cell, ignores non-text commands, `Delete`, and `Backspace`, and preserves AltGr/Option/IME/dead-key produced text exactly once
- Escape after replace-on-type restores the pre-session value or Batch draft without creating a transaction
- a locally accepted Enter commit moves one logical body row down and Shift+Enter moves one row up in the same column without waiting for Immediate persistence
- Enter movement reveals virtualized destinations, never wraps at the first or last logical row, and invalid input never moves
- Editable Client Tab and Shift+Tab traverse currently editable cells across one pinned-aware Logical Column Order, skip ineligible cells, wrap across rows, and reveal virtualized destinations
- terminal Tab movement leaves the grid through browser focus order; read-only Client and Server Tables never trap Tab for internal navigation
- one multi-cell Client Linear Cell Range with at least two eligible cells remains selected while Tab and Enter cycle its Active Cell forward along the selected axis and Shift+Tab and Shift+Enter cycle backward
- selected-range traversal wraps within that one axis; range-navigation Enter moves without opening an editor while F2 and printable text retain editing roles
- Escape cancels an active editor before a following Escape collapses range traversal; ranges with fewer than two eligible cells fall back to ordinary traversal
- false or omitted `editable` rejects edit-only props and renders no editing chrome
- `editable: true` without `onSaveEdits` or a potentially editable column fails type-level tests
- `editable: true` mounts the mode toggle and footer only in `BrunoTableClient`; `BrunoTableServer` rejects edit-only props and mounts no editing chrome
- toggle visibility and updates require no all-row predicate evaluation or row-content subscription
- mode switching is blocked while any edit-owned work or save is active and is never persisted
- no consumer prop can initialize or control Edit Mode; each session starts Immediate and only the end-user toggle changes it
- Immediate single-cell commit calls `onSaveEdits` with a one-element array
- Immediate paste and drag fill each call `onSaveEdits` once with the full transaction
- V1 exposes no cell Clear/Delete command, menu item, public capability, or `Delete`/`Backspace` shortcut; a value changes only through an editor, an explicit paste transaction, or repetition-only Drag Fill
- every Save Change Set is atomic: the complete operation is accepted or rejected with no partial-success result
- disjoint Immediate operations may run concurrently; each operation locks only its owned cell set and one operation may own many cells
- Batch Save installs one grid-wide edit mutation lock until its single atomic operation settles
- accepted operations flash all affected cells green for two seconds without React or XState animation-frame events
- rejected Immediate operations restore owned cells to their latest live server values, retain an accessible red rejection treatment for five seconds, and aggregate into one manually dismissed table-scoped toast
- rejected Batch Save preserves every draft, conflict, validation record, and history command, unlocks editing, and keeps affected cells failed until correction, retry, successful reconciliation, or Reset
- no XState actor, Effect schedule, transport Adapter, or toast action automatically retries a save; only the current surface's explicit Save control can start a fresh live-preflight operation
- a failed Conflict Review save leaves the modal open, while a failed Footer save with no conflicts leaves it closed; the next Save may open it only after current live conflict detection
- a thrown request or transport failure never claims that nothing committed; Batch drafts remain until live View Server reconciliation converges them, conflicts them, or the user resets them
- transport-failure toast resolution is operation-specific: every submitted cell must converge semantically through live canonical data; never infer confirmation from global pending-change count
- Batch Save coalesces repeated cell edits and calls the same handler with current net dirty cells
- undo/redo exists only inside the current unsaved Batch session, records one command per user gesture regardless of cell count, clears after accepted Save, and survives rejected Save
- semantic server convergence removes the cell from drafts, conflicts, validation, and every undo/redo patch; empty history commands are pruned so undo cannot resurrect a converged value
- a live `isEditable` transition to false preserves the dirty cell and history, blocks editing and Batch Save with an accessible explanation, and clears only when permission returns, semantic convergence occurs, or Reset is confirmed
- Blocked Changes Review supports explicit selected-row `Discard Selected Changes` as one local undoable Batch command and never calls `onSaveEdits`
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
- explicit selected-row Mine or Server resolution
- optimistic concurrency
- save results
- canonical server reconciliation
- explicit fresh-preflight resubmission after conflict resolution

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

- Client TSV copy/paste
- immediate rejection with one explanatory toast when clipboard row and column counts both exceed one
- exact orientation-and-length matching for direct `1×N` or `N×1` paste, with 1×1 as the only no-confirmation broadcast source
- an XState-owned Base UI AlertDialog for every supported linear mismatch, including one Active Cell or an opposite-axis selection, proposing exactly one source-oriented range from the Active Cell or the selected range's logical start
- no Cut command, menu item, public capability, or `Ctrl/Cmd+X` binding
- typed parsing
- canonical exact-numeric text kept separate from display formatting
- whole-gesture rejection for read-only or otherwise unavailable targets
- one replaceable table-scoped `Paste rejected` toast for direct rejection, while mismatch and confirmed-preflight errors remain in the AlertDialog surface
- one replaceable table-scoped Base UI `Fill rejected` toast for Drag Fill preflight rejection, with error presentation, Close, and no Retry action
- validation
- one-axis repetition-only Drag Fill
- one-axis fill preview
- transaction batching

Success criteria:

- no accidental partial operations
- no paste tiling, repetition, transposition, clipping, two-dimensional target, or equal-cell-count coercion, including after confirmation
- a two-dimensional clipboard source is rejected before target parsing; 1×1 broadcasts along the selected Linear Cell Range; a supported linear mismatch opens confirmation and can apply only to one explicitly described source-oriented range
- confirmation displays copied, selected, and proposed orientations and lengths plus proposed start/end coordinates; Cancel/Escape applies nothing and restores grid focus
- confirm reruns current preflight; out-of-bounds, unavailable, read-only, locked, invalid, or stale destinations keep the dialog open with one inline reason
- direct rejected paste reports the first deterministic failing row/column plus a bounded additional count; repeated failures never stack per-cell toasts
- paste rejection creates no draft, history, save actor, or persistence call, and its toast does not subscribe to row updates
- browser clipboard success can never trigger implicit destructive clearing
- an invalid exact operand or missing clear policy aborts the whole paste/fill transaction
- one-cell fill repeats that value and multi-cell fill repeats the exact source sequence cyclically in both directions, phase-aligned to the source's logical start
- Drag Fill performs no numeric, BigInt, BigDecimal, date, text-suffix, or trend inference; modifier keys and public APIs cannot enable series generation
- repeated values pass through canonical exchange text, destination parsing, and whole-vector validation, so incompatible heterogeneous targets reject atomically
- Drag Fill publishes no preview inside drag slop, uses the same dominant-displacement and exact-tie rule to acquire an axis, projects later diagonal movement onto it, and cannot switch axes or publish a two-dimensional intermediate target
- Drag Fill autoscroll is inactive before axis acquisition and parallel-only afterward
- Escape and `pointercancel` discard the Drag Fill preview, stop autoscroll, and create no candidate validation, draft, transaction, history, save actor, or persistence call
- ordinary pointer release outside the grid reruns preflight and applies the last valid projected fill preview atomically; no acquired axis or non-empty preview is a silent no-op
- rejected Drag Fill preflight removes its preview, applies nothing, reports the first deterministic row/column failure plus a bounded additional count, and creates no edit, history, save, or persistence state
- later fill rejection replaces the existing fill toast, accepted fill clears it, and row updates never notify its rendering subscriber
- large operations do not emit one event per cell
- undo remains transaction-level

## Phase 10: Advanced capabilities

Potential later work:

- asynchronous per-cell validation, only after a new product and architecture decision proves the atomic save seam insufficient
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
