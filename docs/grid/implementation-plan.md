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
- mandatory Client `getRowId` and a Server type-level prohibition on that prop
- mandatory explicit `` `COL_ID_${Uppercase<string>}` `` identity on every leaf column
- mandatory explicit non-empty `headerName` on every leaf column
- mandatory explicit runtime `valueType` on raw value-bearing columns, with no row sampling
- mandatory non-empty Column Identity-keyed `initialOrderBy`
- separate typed `BrunoTableGroupSortBy` persistence for grouped summaries, including the reserved Rows System Column Identity
- optional typed `BrunoTableGroupRowsColumnOptions` for the fixed Rows label, baseline width, and exact-`bigint` presentation
- Rows-aware persisted-width typing that admits the reserved identity only in `columnWidths`
- a strict Read-only Table grouping capability that makes `groupRowsColumn` invalid when Client `editable: true`
- mutually exclusive field and computed columns
- direct `field` value inference
- computed non-empty `fields` dependency tuples, `Pick`-restricted getter inputs, projection compilation, and `valueGetter` return inference
- typed formatters
- optional typed `BrunoTableTextColumn`, `BrunoTableNumberColumn`, `BrunoTableBigIntColumn`, `BrunoTableBooleanColumn`, and `BrunoTableSelectColumn` helpers that return ordinary definitions
- reusable `withDefaults` Column Presets with built-in, preset, then individual-option precedence
- optional Effect entry-point `BrunoTableBigDecimalColumn`
- typed `valueFormatter`, conditional cell-class, and cell-renderer presentation overrides on raw, helper, and preset columns
- typed `groupKeyValueFormatter`, `groupKeyCellClassName`, and `groupKeyCellRenderer` overrides with exact field values and no fabricated raw-row context
- capability-derived typed `aggregateValueFormatter`, `aggregateCellClassName`, and `aggregateCellRenderer` overrides with no fabricated raw-row context
- compiled Column Value Semantics with capability-derived filter operands
- built-in explicit `bigint` semantics without `number` coercion
- optional-integration type seam that keeps Effect out of root declarations
- capability derivation for editing, sorting, and filtering
- default-enabled filtering and sorting for eligible Field Columns, with explicit per-column opt-outs
- independent Field Column `groupBy: true` eligibility and one capability-derived built-in `aggFunc`
- support for one column to declare both grouping eligibility and aggregation, with active-group-key precedence
- rejection of `aggFunc` arrays, arbitrary aggregation callbacks, and unsupported Value Type/function pairs
- exclusion of field-level `aggFunc: "count"` in favor of the grouped Rows System Column
- rejection of Rows configuration that attempts to redefine identity or structural column capabilities
- computed columns excluded from filter, sort, and edit capabilities in V1
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
- two aggregate columns may reference one field only when they have distinct Column Identities, while one column cannot declare multiple aggregate functions
- `editable: true` together with `groupRowsColumn` fails compilation
- one columns tuple containing edit and grouping metadata remains reusable by separate Editable and Read-only Table Instances
- group-key callbacks infer the exact field value and cannot access `row: TRow`
- aggregate callbacks infer the selected function's exact result domain and cannot access `row: TRow`
- grouped conditional class hooks share their role's exact context, return `string | undefined`, and do not install subscriptions
- `aggFunc: "count"` fails while field-level `countDistinct` remains capability-checked
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
- `BrunoTableQuickFilter` backed by an explicit non-empty `quickFilterFields` tuple of string-valued Query Fields
- complete View Server operator parity per built-in Value Type
- default live Set Filters for Boolean and Select Field Columns, with explicit high-cardinality opt-in for Text, Number, BigInt, and BigDecimal fields
- complete Client faceting and separate live whole-result Server facet subscriptions that exclude their own column filter
- 150 ms TanStack Pacer filter debounce with no Apply or Reset buttons
- toolbar filter controls that dispatch the same typed filter commands as header filters
- active filter count
- active sort count
- hidden column count
- reset actions
- live resize widths applied through frame-batched CSS variables outside React reconciliation
- isolated reactive state for resize handles and accessibility output
- one-time `initialPersistedState` restoration supplied by the application
- complete JSON-safe `onPersistChange` snapshots after committed preference changes
- ordered Group By persistence beside one durable base Column Order and Column Pinning snapshot
- independent durable normal `orderBy` and grouped `groupOrderBy` contexts, with no `initialGroupOrderBy` prop
- one-time `initialFilters` baseline with persisted-state precedence and distinct Clear-versus-Reset behavior
- mandatory non-empty `initialOrderBy` baseline with valid persisted `orderBy` precedence and no unsorted state
- schema versioning and sanitization
- tagged, versioned JSON-safe codecs for exact filter operands

Persist only:

- Grid Filter Expressions
- non-empty normal `orderBy`
- grouped `groupOrderBy` once established
- ordered Group By state
- order
- visibility
- widths
- pinning

Success criteria:

- new/removed columns reconcile safely
- restored `orderBy` sanitization can never produce an empty order; it falls back to `initialOrderBy`
- grouped restoration and every Group By or aggregate-visibility change retain valid `groupOrderBy` priorities and fall back to all active keys ascending when no entry survives
- clearing grouping restores untouched normal `orderBy`, while re-entering a compatible grouping may restore its dormant grouped order
- grouped sort IDs autocomplete from potential group keys, aggregate columns, and Rows, then runtime validation admits only active keys, Rows, and visible participating aggregates
- the Viewport Adapter maps grouped key identities to fields and grouped result identities to private aggregate aliases without leaking aliases into persistence
- duplicate sort identities normalize quietly by retaining the first, highest-priority occurrence rather than requiring complex tuple-uniqueness typing
- pointer, Shift-pointer, keyboard, panel, command, and reset paths allow one through all sortable columns while always retaining at least one active sort; the Sort panel disables removal of the final entry
- Shift-add appends at lowest priority, Shift-direction toggles preserve priority, plain activation of an existing sorted column toggles it while making it the sole priority-one sort, and Sort panel priority reordering works through both pointer drag and keyboard actions
- every committed ordering change resets both row models to vertical row zero, preserves horizontal scroll, layout, drafts, and conflicts, clears position-based cell selection, and retains focus on the initiating sort control
- live sort-key row movement never resets scroll or retargets the old index; it follows stable identity without forced reveal when possible and safely clears unknown Server activation or newly noncontiguous Client ranges
- a live sort-key move of the active Client editor row preserves its visual Y-coordinate through frame-coalesced fixed-height scroll anchoring while the row remains correctly sorted and surrounding rows move
- a live-filtered active editor row survives as one anchored presentation exception with accessible status and full reconciliation until valid commit or Escape, without changing filter state or row counts
- deletion of the active editor row creates a recoverable anchored tombstone that cannot save, supports Escape and accessible cancellation, and reconnects only if the same Row Identity returns before cancellation
- deletion of a row with committed Batch drafts preserves sparse history as blocked missing-row work, projects no phantom body row, disables Save, and exposes explicit review, undo, discard, Reset, or same-identity reconnection
- disappearance of a row with an in-flight Immediate operation causes no special transition; only the ordinary accepted, rejected, or invocation-failed result settles it
- sorting through an active editor is rejected with editor focus restored when validation fails; a valid Batch draft or Immediate save operation commits first and then sorting proceeds without awaiting transport
- source JSX and emitted-package consumer type tests prove that `initialOrderBy.columnId` is the exact autocomplete-friendly union of sortable IDs and rejects unknown, misspelled, computed, and explicitly nonsortable IDs
- Quick Filter and toolbar-created Grid Filters appear in global active-filter review
- Quick Filter fields are never inferred from columns, compile to `OR`-combined `contains` leaves whose group is `AND`-combined with External Filters and Grid Filters, and neither their configuration nor committed text is persisted
- filter overlays expose only operators valid for their exact Value Type, and cross-column leaves combine with `AND`
- invalid typed filter drafts retain the last committed filter, show inline accessible errors, emit no row/query/persistence command, and may be discarded on close without trapping focus
- JavaScript Number controls use native `type="number" step="any"` plus semantic validation, while BigInt and BigDecimal preserve raw text with input-mode hints and never use `valueAsNumber`
- Grid Filter, Quick Filter, Clear, and Reset commands reject invalid active editors with focus restored, or commit valid Batch/Immediate work before filtering without awaiting transport
- existing edit-owned work never blocks filtering or requires hidden-draft confirmation; complete sparse footer, Save, and review projections remain independent of filtered and mounted rows
- an open Server Set Filter remains live over the complete result rather than loaded blocks and releases its subscription on close
- explicit Set Filter include/exclude values survive facet disappearance as reversible zero-count entries and recover live counts if they return; absent values with no explicit intent may be dropped
- Select All and manually selecting the final available value both normalize to no filter, partial state preserves include/exclude intent for future values, and passive facet updates never rewrite that intent
- continuous filter input debounces for 150 ms, discrete valid choices apply immediately, and Select All/Clear All each produce one atomic command, query generation, and persistence snapshot
- Server Set Filters may use value checkboxes and value Select All without installing or implying forbidden Server Row Selection
- Text, Number, BigInt, and BigDecimal columns never open an automatic unbounded-cardinality facet without explicit opt-in
- External Filters are never serialized as grid preferences, included in BrunoTable's active-filter count, or cleared by grid filter reset
- no ephemeral state is serialized
- stale, wrong-codec, wrong-column, or invalid exact operands are dropped rather than coerced
- restoration does not echo `onPersistChange`, one atomic command emits at most one snapshot, and pointer/scroll frames emit none
- the same server-provided `initialPersistedState` produces hydration parity without browser storage access or a default-layout frame
- drag commits once
- live resize does not rerender the mounted body on each pointer frame
- drag animation stays within frame budget

## Phase 5: Server viewport read-only model

Build:

- `<BrunoTableServer tableId columns viewportSource />`
- `viewportSource` support compatible with effect-view-server's Live Query Viewport
- conditional exact `routeBy` values inferred from the Viewport Source: required for leased topics and forbidden otherwise
- source-owned Route Field tuples with no duplicated `routeByFields` table configuration
- the Viewport Row Pipeline Adapter behind the shared Grid Runtime
- Column Identity to Query Field translation
- typed recursive grid-filter compilation into View Server `where`
- typed grid-sort compilation into View Server `orderBy`
- explicit `select` projection from field columns and declared computed dependencies, with Row Identity delivered out of band
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
- explicit separation between the Server Table's Query Version and the Editable Client Table's `getRowVersion` return type
- optional Effect BigDecimal semantics with effect-view-server wire-admission and comparator parity

Success criteria:

- consumers render `BrunoTableServer` with `columns` and `viewportSource` without an intermediate grid definition or duplicated identity callback
- every leased `viewport.replace(...)` includes the exact application-owned Feed Route, while materialized and source-free topics reject it
- Route Fields do not require visible columns, projection, or filter capability, and Feed Routes are never inferred from Set Filters
- a meaningful Feed Route change releases the old generation, clears sparse and transient row-space state, and retains compatible user preferences
- server scrolling exposes no pagination state or controls and can jump directly to an arbitrary indexed window
- client and viewport tables render the same header, filter, sort, cell, and navigation Modules
- common UI contains no client-versus-viewport conditionals
- persisted filters and sorts remain keyed by `columnId`
- View Server queries contain validated fields resolved from current column definitions
- Computed Columns enter projection only through their declared `fields` dependencies and cannot enter server filters or sorts
- undeclared getter field access, empty dependency tuples, and `field`/`fields` combinations fail type tests
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
- exact ordered-identity span capture and structural reconciliation for Client ranges
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
- grouped read-only Client results retain fresh one-axis Cell Range Selection and canonical Copy, while grouped Server results remain Active-Cell-only
- value-only publications preserve a Client range without per-update enumeration; structural changes retain it only when its endpoints and complete ordered identity span remain exact, while any mismatch clears it before Copy without silent corner retargeting
- public types and private normalized state contain one optional discriminated horizontal-or-vertical range rather than a general rectangle, `ranges[]`, or include/exclude operations
- the first accepted range extension locks one axis; pointer drag slop publishes no range, greater absolute displacement wins after the threshold, an exact tie stays `1×1`, parallel movement may resize through the anchor, and perpendicular movement is projected away until collapse
- drag autoscroll remains off before axis acquisition and enables only the matching horizontal or vertical channel afterward; perpendicular and pinned-region edge proximity cannot scroll the other axis
- Escape and `pointercancel` stop range autoscroll and restore the exact pre-gesture Active Cell/range snapshot without also applying ordinary Escape collapse
- pointer capture keeps outside release authoritative: selection retains its last projected range, while leaving the grid alone never cancels the gesture
- Client Row Selection is absent by default and its enabled Select All operation includes filtered virtualized rows outside the mounted DOM window
- filtering preserves selected Client Row Identities while the header checkbox computes its state against only the current filtered set
- Client Select All snapshots matching identities at the gesture; later inserts remain unselected and deletions prune removed identities
- Client Shift-click Row Selection includes the complete current display-order interval
- entering Group By clears selected Client Row Identities and the Shift anchor atomically; grouped summaries expose no Row Selection capability and ungrouping returns empty
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
- `editable: true` without `getRowVersion`, `onSaveEdits`, or a potentially editable column fails type-level tests
- `getRowVersion` infers the exact optimistic-concurrency type without a repeated JSX generic, including `bigint`
- read-only Client and Server Tables reject `getRowVersion`
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
- accepted operations flash currently mounted affected cells green for two seconds without React or XState animation-frame events, emit no success toast, and complete quietly when an affected cell is unmounted
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

## Phase 10: Grouping and aggregation

Grouping and aggregation are V1 capabilities for Read-only Table Instances behind both public components. Every Server Table is read-only; a Client Table participates only when `editable` is false or omitted. V1 uses one flat grouped-summary row per distinct ordered group-key tuple. The read-only Client Adapter derives private identity from that tuple; the Server Adapter requires effect-view-server's authoritative sparse viewport key contract specified in [effect-view-server#405](https://github.com/bmvantunes/effect-view-server/issues/405) and landed in [effect-view-server#407](https://github.com/bmvantunes/effect-view-server/pull/407). Neither path adds a consumer `getGroupedRowId`.

Build:

- one BrunoTable-owned typed grouping and aggregation intent
- read-only Client and Server capability composition that omits grouping and aggregation entirely from Editable Clients
- conservative Editable Client restoration that drops `groupBy`, `groupOrderBy`, and reserved Rows width
- first-key Group By transition that clears ordinary Client Row Selection and its Shift anchor before publishing grouped rows
- grouped capability suppression for row checkboxes, Select All, selected-row counts, row actions, and selection commands
- every Group By add, remove, or reorder cancels an active Cell Range gesture and clears its old range before changing logical shape
- grouped read-only Client range selection and canonical Copy across Group Key, Aggregate, and Rows cells, with Paste, fill, and editing rejected
- grouped value-only publications preserve an exact range, while grouped structural reconciliation uses the same ordered-identity span contract as ordinary Client rows
- post-projection Active Cell reset to row zero and the first visible navigable new-projection column after every Group By shape change
- an ordered Group By drop region containing only columns whose definitions declare `groupBy: true`
- one always-visible Rows System Column backed by exact `bigint` row count whenever grouping is active
- normalization of optional `groupRowsColumn` label, baseline width, formatter, conditional class, and renderer onto the fixed System Column
- committed Rows-width persistence under its reserved identity, including dormant ungrouped restoration and capability-aware sanitization
- a temporary derived grouped layout ordered as active keys, Rows, then participating aggregates
- temporary omission and exact restoration of columns with neither active-key nor explicit aggregate semantics
- derived grouped visibility that force-shows active keys and Rows while respecting aggregate-column visibility
- grouped Column Visibility controls over the full normalized registry, with one durable visibility state
- suspension and exact restoration of ordinary Column Pinning without mutating persisted layout state
- ordinary column-reorder lock while grouped, with Group By chip reorder as the sole ordering interaction
- capability-safe aggregate definitions derived from compiled Value Type semantics
- local Client grouping and aggregation over the complete resident source
- native effect-view-server `groupBy` and `aggregates` compilation for the Server Table
- atomic sparse raw-and-grouped row-plus-key ingestion from a compatible effect-view-server Viewport Source, with no consumer callback or reconstructed Server identity fallback
- separate durable normal and grouped sort contexts, with grouped eligibility derived from the current grouped projection
- grouped View Server result typing without casting aggregate rows to the raw source row type
- Column Identity-keyed aggregate result normalization, allowing distinct columns over one source field without exposing private View Server aliases
- default field Value Type presentation plus typed per-column Group Key Cell formatter, conditional class, and renderer overrides
- default aggregate-result Value Type presentation plus typed per-column aggregate formatter, conditional class, and renderer overrides
- flat Client result normalization with no hierarchical group rows or expansion state
- shared formatting, sorting controls, keyboard behavior, and accessibility for grouped results
- exact operation and result-domain parity between Client and Server built-in aggregates
- query-generation and stale-response handling for grouped Server viewports
- behavioural, type-level, cross-adapter parity, and realistic performance tests

Success criteria:

- grouping and aggregation work in read-only `BrunoTableClient` and every `BrunoTableServer`
- `editable: true` rejects `groupRowsColumn`, mounts no Group By UI, admits no grouped command, and executes no grouping or aggregate work
- shared definitions may contain both edit and grouping metadata without activating both capabilities in one Table Instance
- Editable Client restoration drops grouping, grouped sorting, and Rows width before initialization and never briefly renders a grouped view
- entering grouping clears any ordinary Client Row Selection in one transaction, retains no dormant IDs, and emits no selection-owned persistence event
- grouped summaries cannot be row-selected and clearing the final group key restores an empty ungrouped Row Selection capability
- a grouped read-only Client may select and copy one horizontal or vertical range across mounted or virtualized grouped cells without display-text or private-alias leakage
- Group By shape changes never reinterpret an old range's identity corners; they cancel gesture/autoscroll and clear the range before publishing the new projection
- grouped ranges expose no Paste, Drag Fill, or edit command, and grouped Server Tables remain limited to their loaded Active Cell
- every Group By add, remove, or reorder resets Active Cell deterministically instead of translating raw/group identity; grouped uses the first key, ungrouped uses the first restored visible navigable column, and an empty result has none
- Active Cell reset can target a Server row-zero loading slot, does not steal DOM focus from the initiating control, and emits no extra persistence event
- `groupBy: true` controls eligibility rather than initial active state, and `aggFunc` independently contributes at most one aggregate
- a column declaring both renders its group-field value rather than its own aggregate whenever it is an active key
- every grouped row shows the live count of filtered source rows it represents, even when no consumer aggregate column exists
- omitted Rows configuration uses the `Rows` label, compiled `bigint` presentation, and implementation default width in both Adapters
- Rows customization cannot alter its identity, semantics, or non-filterable, non-hideable, non-editable status
- a valid persisted Rows width wins over its configured baseline, survives an ungrouped period, and never enters column order, visibility, or pinning
- `aggFunc` remains optional; grouped output includes no arbitrary representative values or implicit per-field aggregates
- Server aggregate work scales with explicit participating aggregates rather than every raw column definition
- grouping never surfaces a normally hidden aggregate column, while forced active-key and Rows visibility never mutates the persisted visibility map
- grouped aggregate visibility changes persist and survive ungrouping; active keys and Rows reject hiding
- reordering Group By chips reorders the View Server field tuple and rendered key columns together
- active grouping renders one unpinned logical column region and clearing the final key restores the exact base order and pinning
- entering, changing, and leaving grouping do not masquerade as user Column Order or Column Pinning preference mutations
- persisted ordered `groupBy` plus one base layout recreates the grouped view after SSR/refresh and restores the exact base layout when grouping clears
- no persisted current rendered order, `orderBeforeFirstGroupBy`, or other duplicate layout authority exists
- the Client Table computes only from its complete source
- the Server Table delegates over the complete server result and never aggregates loaded sparse blocks
- grouped Server queries use native `groupBy` plus a non-empty aggregate definition instead of raw-row `select`
- the Server query always carries one native `count` aggregate, while the Client produces an equal exact `bigint` value
- Client and Server results agree for supported operations, null handling, and exact Number, BigInt, and BigDecimal result domains
- aggregate aliases and group fields sort through validated View Server query members
- two aggregate columns over one source field render, format, and sort independently through their distinct Column Identities
- Group Key Cell callbacks receive exact field values, ordered group keys, and row count without a fabricated `TRow`
- aggregate callbacks receive typed values, ordered group keys, and row count without a fabricated `TRow`, and private aliases never enter their context
- conditional grouped classes handle value-aware styling without requiring a custom renderer or causing non-mounted cell work
- a column declaring both capabilities selects only its group-key presentation while active as a key and only its aggregate presentation while participating as an aggregate
- grouped sorting accepts only active keys, Rows, and visible participating aggregates; sanitization preserves surviving priorities and falls back to every active key ascending rather than producing an unsorted state
- clearing grouping restores normal `orderBy` unchanged, and private View Server aggregate aliases never enter public or persisted state
- Client raw rows use `getRowId` and grouped rows derive stable identity from the complete exact group-key tuple; all Server rows use the source-owned viewport key
- aggregate-only changes and grouped movement retain identity, while key changes create a different logical group
- Client `getRowId` receives only raw `TRow`; Server rejects `getRowId`, no `getGroupedRowId` prop exists, and Group Row Identity is not persisted
- both read-only variants render one flat row per group-key tuple with no disclosure controls, nested children, or leaf-row drill-down
- virtualization and keyboard navigation operate on the chosen logical grouped-row space without introducing pagination

## Phase 11: Advanced capabilities

Potential later work:

- asynchronous per-cell validation, only after a new product and architecture decision proves the atomic save seam insufficient
- named views
- shared views
- group headers
- expandable grouped hierarchies and leaf-row drill-down
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
