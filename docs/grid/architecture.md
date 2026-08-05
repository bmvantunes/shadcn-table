# Architecture

## High-level structure

```text
Public React Variants
├── BrunoTableClient
└── BrunoTableServer

Grid Core
├── table configuration
├── column model
├── compiled column value semantics
├── grid-runtime interface
├── command bus
├── capability and policy engine
├── persistence slices
├── plugin registry
└── diagnostics

Row Pipelines
├── ClientRowPipelineAdapter (complete-data local processing)
└── ViewportRowPipelineAdapter (server processing and sparse windows)

Interaction
├── navigation engine
├── row selection
├── cell editing
├── range selection
├── drag fill
├── clipboard
├── undo/redo
├── column drag
└── column resize

Data Integrity
├── drafts
├── validation
├── optimistic versions
├── conflicts
├── batch save
└── server reconciliation

Rendering
├── shared BrunoTableView
├── vertical virtualization
├── horizontal virtualization
├── pinned regions
├── overlays
├── accessibility
└── React Compiler adapter boundary
```

## Explicit public variants

Expose two public React composition roots:

```tsx
<BrunoTableClient tableId={...} getRowId={...} columns={...} clientSource={...} />
<BrunoTableServer tableId={...} columns={...} viewportSource={...} />
```

Do not expose one component with a row-model flag or incompatible source union. The two variants have materially different data ownership and lifecycles, so the public seam should make that difference explicit.

Both variants construct the same Grid Runtime and render the same `BrunoTableView`. Each supplies one row-pipeline Adapter:

```text
BrunoTableClient    -> Client Row Pipeline   --+
                                                +-> Grid Runtime -> BrunoTableView
BrunoTableServer    -> Viewport Row Pipeline --+
```

`BrunoTableView` owns common rendering and interaction. It dispatches grid commands and consumes fine-grained runtime subscriptions; it does not import client or View Server implementations and does not branch on a mode flag.

Both public sources expose common lifecycle chrome: total rows, version, status, optional status code, optional message, and an optional Source Retry Capability. The shared view renders this state consistently. The Client Row Pipeline supplies complete rows; the Viewport Row Pipeline supplies the sparse viewport controller and row store. The capability is a source-owned `run` command plus its `pending` state; the shared view may present it for closed or errored sources but never owns reconnect policy or changes lifecycle state in anticipation of the source.

Lifecycle rendering is one narrow shared island built from `@bruno/shadcn`: fixed-height Skeleton rows for loading, compact persistent Alerts above retained coherent rows for stale/closed/error, and full-body Empty states for terminal states without rows. Only closed and error states may render the optional Retry Button; pending decoration comes directly from the capability. This island subscribes to the minimal chrome selector, while row islands subscribe to row state independently, so a diagnostic or pending transition does not replace the Grid Runtime or notify unrelated cells.

Grouping and aggregation are V1 capabilities of both read-only composition roots, not every mounted row pipeline. BrunoTable owns one shared flat grouped-summary contract, but execution follows data ownership: a read-only Client Adapter processes the complete resident source locally, while the always-read-only Viewport Adapter delegates to effect-view-server and consumes the indexed grouped result. The Viewport Adapter never aggregates its sparse cache. The read-only Client Adapter must normalize any TanStack grouping machinery to the same one-row-per-group-key-tuple shape returned by the View Server; it must not expose a private hierarchical row model, expansion state, or child rows through the shared view.

## Toolbar composition seam

Both public composition roots render optional children into a toolbar region inside BrunoTable's provider and above the shared scroll surface. `BrunoTableToolbar` owns consistent layout only; it does not own page-specific filter state or receive a TanStack table instance.

The provider exposes a stable private Grid Runtime reference rather than a broad changing snapshot. BrunoTable-owned compound controls subscribe to capability-specific selectors for exactly the state they render. Consumer toolbar components receive only their ordinary props and do not become grid subscribers merely because they are children.

Toolbar state access follows the same ownership and subscription rules as the rest of the grid:

- a row-count control selects semantic row metrics from the Client or Viewport Row Pipeline, including the authoritative result count and, when useful, the separately named loaded count;
- an active-filter control selects the validated Grid Filter Expression and Quick Filter from the Grid Runtime, not a field-keyed server query;
- sort, selection, dirty-edit, validation, and conflict controls select only their own compact count or presentation model;
- control actions dispatch typed Grid Commands rather than mutating TanStack atoms or arbitrary runtime state;
- one control changing must not rerender sibling controls, the table root, or the mounted body unless their own selected value also changes.

The private TanStack Adapter may implement TanStack-owned parts with `table.Subscribe` or the standalone React `Subscribe` component. BrunoTable-owned source, row, edit, validation, and conflict state uses Grid Runtime selectors. Lowercase `table.store.subscribe(...)` and atom subscriptions are imperative observers and are reserved for work that should bypass React rendering. None of these mechanisms enter BrunoTable's public interface.

`BrunoTableQuickFilter` is command-first. Its in-progress text is local input state. Its event handler dispatches through the stable Grid Runtime without reading a changing grid snapshot. It subscribes only to the committed Quick Filter primitive when an external filter reset must update the displayed text. Streaming row changes never notify that subscription. Quick Filter state is session-only and is absent from preference and saved-view snapshots.

Grid Filter, Quick Filter, Clear, and Reset commands enter the same editor commit gate used by sorting before mutating filter state. Rejection returns focus to the editor and publishes no filter command. Batch acceptance records the local transaction first; Immediate acceptance creates the operation first. The filter command then proceeds without awaiting transport, while sparse drafts and operation notifications remain independent of row visibility.

Each typed filter overlay owns an ephemeral raw candidate outside persisted filter state. Exact Value Type parsing precedes Pacer publication. Parse failure updates only that overlay's compact validation snapshot; the last committed filter atom and row pipeline remain untouched. Closing discards the candidate. This validation state never enters table-root React state, query compilation, or `onPersistChange`.

Pacer sits only on continuous text and numeric candidate publication. Discrete checkbox and valid operator commands bypass it. Bulk Set Filter actions calculate one normalized include/exclude result and dispatch one command, so preference encoding and row-pipeline generation happen at most once regardless of facet cardinality.

The built-in numeric-control adapter uses native Number input only for the JavaScript Number Value Type and still routes native validity plus the raw candidate through compiled semantics. BigInt and BigDecimal controls remain string-valued text inputs with input-mode hints until their exact parser succeeds; the adapter never calls `valueAsNumber` for exact domains. This keeps browser assistance behind the same private semantic seam rather than making DOM control behavior the trusted value model.

After the editor gate is clear, filtering does not query or gate on global edit cleanliness. Sparse edit selectors derive footer counts, Save Change Sets, and review projections independently from the filtered row pipeline, so hidden dirty rows remain represented without forcing body subscriptions or a confirmation workflow. Filter Clear and Reset dispatch no edit-store command.

Quick Filter fields are immutable table configuration, not reactive grid state. The optional explicit non-empty `quickFilterFields` tuple contains string-valued Query Fields rather than Column Identities and is never inferred from current visibility, order, or headers. The row-pipeline Adapter compiles committed text to `OR(contains(field, text), ...)`, then combines that group with External Filters and Grid Filters through `AND`. Client and Server pipelines preserve the same semantics without routing the expression through TanStack's global-filter contract.

Preference persistence is an outbound notification seam, not a storage subsystem or React-controlled state path. The preference slice accepts one sanitized `initialPersistedState` snapshot when the Grid Runtime is created. Its deterministic, browser-independent initialization permits the same JSON-safe snapshot to produce the server render and hydrated client runtime without a default-layout frame or hydration echo. After a committed Grid Filter, sort, grouping, order, visibility, width, or pinning command changes semantic preference state, it encodes one complete immutable JSON-safe snapshot and invokes the latest `onPersistChange` callback outside the mutation path. Initial restoration, hydration, and non-preference commands emit nothing. Pointer and scroll frames never encode or notify; resize and reorder notify once when their gestures commit. The callback return value cannot block, roll back, or replace Grid Runtime state.

Keep the public Module deep:

- compose page-specific UI through children instead of adding feature booleans to table props;
- expose focused BrunoTable-owned controls such as Quick Filter or edit actions instead of a public all-powerful table controller;
- keep TanStack atoms, stores, contexts, and instance methods private;
- keep Grid Filters separate from External Filters even when controls for both are visually adjacent.

## Editable-table seam

The `editable: true` discriminant installs the Save Capability only in the `BrunoTableClient` composition root and causes `BrunoTableView` to mount the top-right Edit Mode toggle and shared Edit Safety Footer. `getRowVersion` and `onSaveEdits` are mandatory in this branch, and the getter's inferred return type flows through the complete optimistic-concurrency contract. The toggle and footer are not toolbar children, and pages do not wire their mode, counts, buttons, or modal. `BrunoTableServer` rejects edit-only props and never installs this capability.

That same discriminant selects a no-grouping composition. The Editable Client root does not register TanStack grouping or aggregation features, create the grouped projection, render Group By controls, or admit grouped commands. Its preference sanitizer drops `groupBy`, `groupOrderBy`, and the reserved Rows width before runtime initialization. Column normalization may preserve dormant `groupBy` and `aggFunc` metadata because definitions can be reused, but no editable runtime path consumes it.

Potential editability is compiled once from column definitions. A declared `isEditable` boolean or predicate makes a column potentially editable; the predicate itself runs only for a concrete Client cell. Never scan changing Client rows to decide whether edit chrome exists. The Server composition may reuse the normalized column's read-only presentation but does not install its editor capability.

Live row updates re-evaluate editability only for affected dirty Cell Identities when relevant row inputs change. The sparse edit store retains a blocked marker beside the draft rather than deleting it. Save preflight treats any blocked draft as a hard gate, and the exact cell subscriber renders its explanation. Returning permission clears only the marker; semantic convergence or explicit Reset owns draft removal.

Source removal of a Row Identity with committed Batch drafts marks only those sparse records as blocked missing-row work and removes the ordinary body projection. Footer and review selectors derive bounded counts and rows from that sparse collection; Save preflight rejects it. Reappearance of the identity reconnects through the latest typed Row Version and the same reconciliation path, while explicit undo, targeted discard, or Reset owns removal.

Edit Mode has its own compact runtime source initialized to Immediate for each table session. Only the end-user toggle dispatches mode changes; consumer props neither initialize nor control it. The toggle selects only the current `"immediate" | "batch"` value and `canChangeEditMode`; row publications do not notify it. Mode changes are rejected while the active editor, drafts, validation, conflicts, or save state are non-clean, and Edit Mode never enters persisted preferences.

The footer dispatches `edits.reset`, `save.request`, and `conflicts.review.open` Grid Commands. It never calls the consumer operation directly from a button handler. The Save Workflow actor commits or rejects the active editor, evaluates validation and conflicts, opens the shared review workflow when blocked, and invokes the latest `onSaveEdits` operation only from its ready-to-save transition. Updating the consumer callback reference must not replace the Grid Runtime or resubscribe the mounted grid.

The Save Adapter receives one non-empty row-grouped Save Change Set in both modes. Each row entry contains its identity, safely rebased immutable source snapshot, exact expected Row Version, and non-empty exact cell changes carrying Column Identity, source field, before, and after. Immediate mode forwards one whole committed transaction, including every cell changed by paste or fill. Batch mode derives one net change per dirty Cell Identity from sparse drafts. Do not loop over either tuple and invoke the consumer operation once per cell or row.

Before construction, Save preflight groups drafts by Row Identity and safely rebases each group to one latest source snapshot only when every edited field remains semantically equal to its recorded base. Any edited-field divergence routes to Conflict Review. This keeps `baseRow`, `expectedVersion`, and exact `before` values coherent even when cells were edited across several source versions, while the application compare-and-set remains final authority for the post-preflight race.

The Immediate operation actor ignores Client Source membership changes for its owned Row Identities while its Promise is pending. Resolution or rejection settles the application call, but canonical outcome evidence remains source-owned. No cancellation signal, automatic retry, or phantom body projection is installed for this case. After resolution, disappearance from a complete ready or stale Client Source reconciles that row and releases its cell locks; disappearance before settlement proves nothing.

The Client clipboard command resolves paste shape before value parsing. A source with both dimensions greater than one is rejected because BrunoTable supports only one-axis bulk operations. One cell may broadcast along the selected Linear Cell Range, and a horizontal or vertical source with matching orientation and length may proceed directly. Every supported linear mismatch—including one Active Cell as the current destination—enters the XState-owned Paste Confirmation workflow with one proposed source-oriented range. This imperative command performs no two-dimensional expansion, tiling, clipping, transposition, or partial target application. After direct or confirmed preflight, it resolves the complete identity-keyed destination vector, parses and validates every cell, and publishes at most one immutable edit transaction without lifting candidates into React state.

Rejected direct paste commands publish one bounded immutable `Paste rejected` diagnostic to a table-scoped toast channel. The channel retains at most one paste diagnostic: a later rejection replaces it, an accepted paste clears it, and explicit dismissal clears it. It is not the save-operation notification actor and exposes no Retry command. Paste Confirmation owns mismatch explanation; failed confirmation preflight stays in its AlertDialog with one inline `Alert` instead of duplicating a toast. Toast and dialog rendering subscribe only to compact workflow/diagnostic snapshots; row publications, selection movement, and scrolling do not notify them.

Rejected Drag Fill preflight publishes the same bounded diagnostic shape to a separate one-item fill channel with title `Fill rejected`. It retains the first deterministic row/column reason plus an additional count, replaces an earlier fill rejection, clears on accepted fill or dismissal, and exposes no Retry command. The Base UI toast renders error presentation, description, and Close through `@bruno/shadcn/toast`; it does not subscribe to rows or become a save-operation notification. The fill actor removes its preview and returns to idle without creating edit or save state.

The Save Workflow actor manages discrete atomic operation lifecycles. Immediate mode may spawn many concurrent operations with disjoint owned-cell sets, including different cells in the same row; it accepts compare-and-set rejection as the deliberate cost of aggressive editing rather than installing a hidden row queue. Batch mode admits at most one operation and derives a grid-wide edit mutation lock. Each operation receives one immutable Save Change Set and observes `PromiseLike<void>` resolution or rejection. A sparse external-store reverse index maps only active Cell Identities to their Operation Identity so affected cells can select progress, Accepted Overlay, success, or rejection without a table render or one actor per cell.

The notification actor aggregates rejected operations into one table-scoped persistent toast and owns explicit dismissal. XState is the brain for legal transitions, operation ownership, aggregation, and dialog/toast lifecycles. The sparse external store is the memory for drafts, history, conflicts, operation references, and per-cell presentation deadlines. CSS owns the border-tracer and flash animation; neither actor nor store emits frame-by-frame events.

Promise resolution clears submitted Batch drafts and history immediately, starts the two-second success flash, and converts submitted values into Accepted Overlays. An overlay remains without a timeout until its live value converges, its opaque Row Version differs from the submitted `expectedVersion`, or the row authoritatively disappears. Immediate cell locks release per reconciled row; Batch retains its global edit lock until every submitted row reconciles. Non-editing interactions remain available throughout.

The rejected transition dispatches different reconciliation commands by Edit Mode. Immediate rejection replaces unconverged operation-owned presentation with the latest canonical source values and a bounded failure deadline. Batch rejection releases the global mutation lock but preserves unconverged drafts and history, records persistent failure evidence, and returns the workflow to an inspect/correct/retry state. A non-empty ordinary `Error.message` supplies the user explanation; unsafe or unknown rejection values normalize to one bounded generic message. There is no exported error or result protocol.

The Save Workflow stores `initiatedFrom` as Footer or Conflict Review. Failure returns to that same mounted surface; it never opens or closes Conflict Review merely because transport failed. Success closes Conflict Review only when that surface initiated the successful attempt. No actor, Effect schedule, Adapter, or notification action retries automatically. A later explicit Save event reruns live preflight and creates a new operation rather than reusing a stale Save Change Set.

Promise rejection drives failure presentation and releases the Batch global lock but makes no assertion about canonical data. Batch drafts remain in the sparse store until live source reconciliation converges them, conflicts them, or the user resets them. Do not add a separate durable `unconfirmed` product state: the live View Server is the outcome oracle.

The notification actor keeps a compact operation-indexed convergence record after rejection. Canonical updates for an affected Cell Identity compare through compiled Column Value Semantics and dispatch a narrow convergence event. When every submitted value converges, live authority supersedes the ambiguous Promise rejection: clear that operation's notification and remaining edit evidence and use the ordinary success presentation. Partial independent convergence prunes only matching cells. Global draft count is never used as proof, and unrelated row publications do not notify the actor.

Footer render boundaries remain independent:

- the conflict control selects only `conflictCount` and is absent when that count is zero;
- the blocked control selects only `blockedCount` and opens its sparse live review only when activated;
- unsaved and invalid summaries select only their own compact counts;
- Reset selects only `canReset` and `isSaving`, then dispatches a command;
- Save selects only `canSave`, `isSaving`, and the minimal blocking-summary presentation it renders;
- the conflict modal reads sparse conflict records only while open.
- Blocked Changes Review reads sparse blocked records only while open; its internal selection exists solely for one targeted discard command.

Row publications that preserve these projections do not notify any footer source. The footer remains mounted but its actions are disabled when there are no pending edits.

Live-by-default is a source-lifecycle rule across the runtime. A mounted surface that presents current source state owns a narrow subscription for as long as it is mounted: grid cells, counts, filter results, open Set Filter facets, Reset Review rows, conflict rows, and `Server now` values all update from the active source generation. Closing an overlay or dialog releases subscriptions that exist only for that surface. Immutable edit bases, undo records, and submitted Save Change Sets remain snapshots because they are workflow evidence, not claims about current source state.

Set Filter faceting follows row-pipeline ownership. A Client Table derives complete live facets locally. A Server Table opens a separate narrow whole-result facet subscription rather than reading its sparse viewport cache. Boolean and Select Field Columns install this surface by default; Text, Number, BigInt, and BigDecimal columns require explicit opt-in. The facet query applies Feed Route, External Filters, Quick Filter, and all other active Grid Filters while excluding its own column filter. Its values and counts are native typed semantics, not display strings. Merge the live facet projection with compact include-or-exclude intent so explicitly included or excluded values missing from current results remain reversible at count zero; absent values with no explicit intent require no retained record. Select All and a user command selecting the final available value both remove the filter atomically, but source publications never trigger that normalization. Checkbox options and Select All live entirely inside this filter projection and dispatch filter-value commands; they never install the Server-forbidden row-selection capability. Closing the overlay releases the subscription.

Do not implement this by feeding full live datasets through React context or dialog-local copies. Keep canonical data in external stores and let the smallest useful render boundary select its row, cell, count, or facet projection. A filter input that only dispatches text still does not subscribe to row publications merely because the filtered result is live elsewhere.

## Continuous row-space Adapter

`BrunoTableView` owns one vertical scroll container and one vertical virtualizer for both variants. It consumes a private row-space interface shaped conceptually like:

```ts
interface RowSpace<TRow> {
  getRowCount(): number;
  getRowSlot(index: number): RowSlot<TRow>;
  setRequiredRange(range: IndexRange): void;
}
```

The Client Row Pipeline exposes the complete final TanStack row model through that interface. Every index resolves to a loaded row, and `setRequiredRange` changes rendering geometry only; it never fetches or slices a page.

The Viewport Row Pipeline exposes the source's exact `totalRows` and a sparse indexed row store. An unloaded index resolves to a stable placeholder slot. The visible range plus velocity-aware overscan becomes an inclusive effect-view-server window passed to the active generation's `setWindow`. A scrollbar jump can therefore request the destination window directly without loading every preceding row.

The Viewport Adapter distinguishes semantic query replacement from window movement. A change to Feed Route, `select`, combined `where`, `orderBy`, `groupBy`, or `aggregates` releases the old Query Generation and atomically invalidates its sparse rows, index mappings, and `totalRows`. The renderer immediately presents the new projection with enough fixed-height loading rows to cover its required window until the new generation publishes authoritative count and slots; it never renders old-generation values under new semantics. A late old sink write is ignored. Equivalent normalized queries reuse the generation.

Calling `setWindow` for scrolling, keyboard reveal, or overscan does not replace the generation. Overlapping loaded slots retain their exact references, newly required absent indexes render loading rows, and cache retention/eviction remains a private transport policy. Likewise, a same-generation source that becomes stale, closed, or errored after publishing coherent rows may retain those rows with shared lifecycle chrome. Retention never crosses a semantic Query Generation boundary.

Keyboard navigation uses this same row-space seam. The navigation engine records the logical Active Cell before asking the view to reveal it. The view frame-batches geometry and scroll work; the row-space Adapter receives the latest required range for that frame. In a Client Table this only changes which resident rows are mounted. In a Server Table it may replace the active source window, while the logical Active Cell remains valid on a stable loading slot until sparse delivery fills that index.

Held-key repeat is semantic input, not scroll sampling. Every valid Arrow command advances the logical coordinate, while repeated reveal writes and Server range publications may be coalesced. No navigation command waits for a mounted cell or a source response, and no per-repeat update is lifted into top-level React state.

Do not allocate a placeholder row object or TanStack row for every server index. The virtualizer owns total scroll geometry; the sparse store owns only loaded, loading, retained, or failed slots. Internal window alignment and buffer sizing are transport optimizations, not pagination state.

Scroll events update geometry outside React state and publish range changes at most once per animation frame. A filter or sort change creates a new logical index generation, clears incompatible positional mappings, resets vertical scroll to the start, and requests the first required window. In a Server Table the new generation renders loading rows rather than retained values from the old query. A sort change applies the reset rule to both Client and Server pipelines, preserves horizontal geometry and column layout, clears position-based Active Cell state, reconciles a Client Linear Cell Range against its exact selected identity span, and retains identity-keyed drafts and conflicts.

A live row publication that changes current sort-key values is not a sorting command and never resets scroll. Reconcile navigation by stable Row Identity plus Column Identity rather than retaining an absolute index that may now contain a different row. When the new position is known, update the logical coordinate without auto-revealing it. During a Client Cell Edit Session, install a geometry-owned row anchor: allow the row model to place the edited Row Identity at its correct new sorted index, calculate the fixed-height offset delta, and compensate `scrollTop` in the same animation frame so the editor retains its visual Y-coordinate while surrounding rows move. Coalesce rapid moves to the latest frame and never implement this as row freezing, delayed smooth-scroll chasing, React state, or XState frame events. When a Server row moves outside the known sparse window, clear the Active Cell while keeping DOM focus on the grid root.

Grouped read-only navigation narrows that final rule while the Group By tuple is unchanged. A surviving active Group Row Identity follows its new logical index without reveal. If it disappears, the row-space owner uses the old display index against the new flat grouped result and clamps only when that index is beyond the new end; it retains the active Column Identity when still navigable and otherwise chooses the first grouped navigable column. An empty result clears Active Cell. The Client Adapter resolves identity from its complete grouped model. The Server Adapter follows an identity only when authoritative sparse delivery resolves its new index; otherwise it targets the same clamped index as a loaded or loading slot without reconstructing identity from values. This is one narrow navigation publication and no React-root update.

The Client range controller commits the exact ordered Row and Column Identity span covered by the range rather than relying only on TanStack's identity corners. The structural row/column projection reuses its immutable snapshot for value-only publications. When sorting, filtering, live membership/order, visibility, or column ordering creates a new structural snapshot, reconcile only the range's relevant axis: retain it if both endpoints and the complete ordered identity span are equal; clear it if an endpoint or intervening identity differs. Changes outside the span do not disturb it. This comparison runs once at the structural owner, never in every mounted cell or on every value update, and emits at most one narrow selection notification. Clearing preserves a still-valid Active Cell and otherwise delegates to ordinary Active Cell reconciliation.

Copy preflight reads one immutable structural snapshot and verifies the range against its committed span before expanding values. If stale corners would now cover a different sequence, clear the range and return no clipboard payload. An accepted command captures one Clipboard Snapshot containing the validated identities and every resolved canonical value from one coherent row/edit projection, then serializes exclusively from that snapshot. The browser clipboard API receives an already-finalized string; live publications that arrive during serialization or while its promise is pending may update the grid but cannot change, partially replace, or append to that payload. TanStack's private corner-based range state may inform hit testing, but it cannot be the authority that silently re-expands a BrunoTable range after a structural change.

Clipboard capture is an imperative command boundary, not a React subscription. It reads the immutable row, grouped-value, and edit snapshots once, materializes only the requested one-axis values, and retains no live subscription after capture. Large-range implementation may be optimized or scheduled only if every chunk still reads the same retained Clipboard Snapshot; it must never trade responsiveness for a mixed-version payload.

The Client presentation projection may retain one active editor row that has fallen outside current filters as an edit-owned anchored exception. This does not mutate filter intent or feed the row back into the ordinary filtered model. It projects the same identity-keyed editor and live reconciliation state with an accessible out-of-filter status until commit or cancellation releases it. Keep this exception in the narrow presentation/geometry seam rather than contaminating TanStack filter state, persisted preferences, row counts, or general selection semantics.

When that active Row Identity disappears from the Client Source, the same narrow projection becomes an anchored tombstone rather than unmounting the editor. The tombstone owns only the recoverable raw candidate and missing-row status; it cannot construct a Save Change Set. Escape or accessible cancellation releases it. Reappearance of the same identity before cancellation reattaches the session to the newly published row and typed Row Version, then routes through ordinary reconciliation.

## Framework-independent core

The grid engine should not depend directly on React.

React should consume immutable snapshots and issue commands.

Conceptual runtime interface:

```ts
interface GridReadable<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}

interface GridRuntime<TRow> {
  readonly tableId: string;
  dispatch(command: GridCommand): void;
  readonly sources: {
    readonly filters: GridReadable<GridFilterSnapshot>;
    readonly sorting: GridReadable<GridSortSnapshot>;
    readonly rowMetrics: GridReadable<GridRowMetrics>;
    readonly sourceStatus: GridReadable<GridSourceStatus>;
    readonly selection: GridReadable<GridSelectionSnapshot>;
    readonly editMode: GridReadable<GridEditModeSnapshot>;
    readonly edits: GridReadable<GridEditSummary>;
    readonly rows: GridRowStore<TRow>;
  };
}
```

These are internal notification domains, not public React context state. A source publishes only when its own semantic snapshot changes. Row-record replacement must not notify filter, sort, row-metric, source-status, selection, or edit sources unless the corresponding value also changed. Within each domain, React consumers still use the narrowest selector required by their output.

Command-only descendants consume the stable `dispatch` capability and create no readable-state subscription. Do not allow features to modify arbitrary state directly.

## Commands and transactions

Use commands for discrete user intent:

```ts
type GridCommand =
  | { type: "column.resize.commit"; columnId: BrunoTableColumnId; width: number }
  | { type: "column.move.commit"; columnId: BrunoTableColumnId; targetIndex: number }
  | { type: "selection.extend"; target: BrunoTableCoordinate }
  | { type: "editing.start"; cell: CellCoordinate }
  | { type: "editing.commit"; value: unknown }
  | { type: "edit.transaction.apply"; transaction: BrunoTableEditTransaction }
  | { type: "preferences.reset"; scope: PreferenceResetScope };
```

Commands enable:

- deterministic tests
- undo and redo
- auditability
- batching
- plugin interception
- diagnostics
- controlled and uncontrolled modes

## State ownership

### React-local state

Use React state only for local, disposable UI details:

- a menu open flag
- local input composition
- temporary editor text before parsing

### External grid state

Use external fine-grained stores for:

- preferences
- selection
- focus
- drafts
- conflicts
- validation
- row snapshots
- loaded ranges
- query lifecycle

### Imperative runtime state

Keep high-frequency geometry outside React and XState context:

- scroll offsets
- pointer coordinates
- row measurements
- column offsets
- visible ranges
- drag transforms
- hit-testing data

## React render subscription policy

TanStack Table v9 exposes three different mechanisms that must not be confused:

- `table.atoms.<slice>.get()` and `table.store.state` read current snapshots without subscribing React.
- `table.Subscribe` and the standalone React `Subscribe` component create selector-based React render boundaries.
- `table.store.subscribe()` is an imperative observer. It requires explicit cleanup and is not the normal React rendering primitive.

Keep these mechanisms behind BrunoTable's private TanStack Adapter. Consumers never receive a TanStack table, store, atom, or subscription API.

Use TanStack subscriptions only for state owned or derived by the private TanStack model. BrunoTable-owned rows, drafts, validation, conflicts, focus, and source lifecycle use Grid Runtime selectors with the same narrow-boundary rule; they are not copied into TanStack state merely to reuse `table.Subscribe`.

The component that constructs the private TanStack table should select only structural state that genuinely changes the mounted tree. High-frequency state such as drag selection and live resize state must not invalidate that root. Place reactive render boundaries at the smallest useful invalidation domain:

- a Client selection checkbox may select one row's boolean;
- an editable cell may select only its own draft, validation, and conflict state;
- drag-range presentation should use a per-row derived key when one change affects several cells and neighbouring selection edges;
- a header may select only its own sort, filter, pin, resize, or menu presentation;
- overlays, toolbars, footers, and status indicators subscribe independently to the values they render.

Do not add a subscription to a component that only renders stable row data. Prefer a single slice atom as the source. When a render island depends on several slices, project the smallest primitive or shallow-stable object that completely describes its output.

The selection-checkbox and range-presentation islands exist only when the Client composition root installs their capabilities. Client Cell Range Selection owns one optional discriminated horizontal-or-vertical range; the Active Cell represents the single-cell case. The selection command chooses an axis on the first accepted extension and retains it until collapse or replacement. Pointer hit-testing publishes no multi-cell state inside drag slop, then compares absolute displacement from the gesture origin; an exact tie stays pending. It resolves a winning axis before publishing a range, then projects later hits onto that axis by retaining only the parallel logical coordinate. The geometry controller enables only the matching autoscroll channel after acquisition and ignores perpendicular edge zones. The drag actor retains one immutable pre-gesture selection snapshot and owns pointer capture. Escape or `pointercancel` stops geometry work and restores that snapshot atomically; ordinary pointer release completes the last projected result even outside the grid. Perpendicular keyboard or pointer movement never publishes an intermediate range. The private TanStack Adapter must not leak or preserve a two-axis rectangle, include/exclude operation list, additive range, subtractive hole, or disconnected region. A replacement selection publishes one new immutable Linear Cell Range snapshot, and row presentation derives its compact edge key from only that snapshot. `BrunoTableServer` installs neither Row Selection nor Cell Range Selection, so it creates no checkbox, selection store, Shift-click anchor, Select All command, or range-decoration subscription. Its Active Cell belongs to keyboard navigation rather than selection state.

TanStack row, cell, column, and header builder methods hide state reads from React Compiler. Any nested compiled component that calls such a method must sit behind an explicit subscription boundary for every state dependency it renders. This is a correctness rule as well as a performance rule.

Some hot presentation state should avoid React reconciliation entirely. During live column resize, subscribe imperatively to the sizing atom, write width CSS variables on the grid root, batch writes per animation frame, and unsubscribe on teardown. React render islands remain appropriate for the small pieces that must change semantically, such as the active resize handle.

## Row-pipeline Adapter seam

The Grid Runtime owns one validated filter state plus two validated Column Identity-keyed sort contexts: normal-row `orderBy` and grouped-summary `groupOrderBy`. Only one sort context is active in the row pipeline at a time. Filter and sort controls dispatch `filters.replace`, `sorting.normal.replace`, or `sorting.grouped.replace` commands without knowing which Adapter executes them.

The Client Row Pipeline ingests a complete Client Source and responds to filter/sort commands by recomputing local TanStack row-model stages over its rows. Source lifecycle changes update shared overlays without placing the source envelope or full row collection in React context.

The Viewport Row Pipeline responds by resolving Column Identity through current column definitions, replacing the View Server query, advancing the query generation, and treating delivered sparse rows as already filtered and sorted. Raw ordering compiles identities to Query Fields. Grouped ordering compiles active-key identities to grouped fields and Rows or aggregate-column identities to private aggregate aliases; no alias crosses the Adapter seam.

This is a real seam because there are two implementations. Keep source ownership, query replacement, and sparse-cache lifecycle behind the Adapter rather than spreading client/viewport branches through headers, cells, navigation, or filtering code. Editing and range-clipboard capabilities are installed only by the Client composition root; the shared renderer receives capability presence rather than testing the row-model variant throughout its implementation.

## Column construction seam

Raw definitions, built-in Column Helpers, and application Column Presets all converge into the same validated normalized-column representation before TanStack columns or render plans are created. Helpers are construction-time modules, not runtime column kinds: normalized cells do not branch on whether their definition came from `BrunoTableNumberColumn`, `priceColumn`, or a raw object.

A raw value-bearing column declares `valueType`. A built-in helper supplies that Value Type together with coherent presentation and interaction defaults. Application presets specialize helpers for domain conventions without creating a string registry. Every path still requires explicit Column Identity and either one direct `field` or a non-empty `fields` dependency tuple paired with `valueGetter`. A normalized Field Column independently records Group By eligibility and at most one built-in aggregate function. These are construction-time capabilities, not per-cell lookups.

Construction-time precedence is fixed:

```text
built-in helper defaults -> Column Preset defaults -> individual column options
```

The normalized column stores direct renderer, editor, formatter, class, comparator, parser, and capability references. Numeric alignment, checkbox centering, and full-width select editors resolve to semantic layout tokens consumed by the renderer and theme; they do not allocate style objects or execute helper lookup logic per cell.

`valueFormatter`, `cellClassName`, and `cellRenderer` are typed raw-row Cell Presentation overrides. The formatter produces visible text, a conditional class changes presentation, and the renderer is the full React escape hatch. They never replace the normalized value-semantics functions. Because these callbacks receive `TRow`, the grouped render plan never invokes them with a fabricated summary row. A custom representation used for edit or clipboard round trips must declare the paired parse/exchange capability explicitly.

An eligible groupable normalized Field Column may store typed `groupKeyValueFormatter`, `groupKeyCellClassName`, and `groupKeyCellRenderer` overrides. The grouped render plan supplies the exact field value, Column Identity, ordered group-key values, and exact row count without a raw `TRow`. When absent, the compiled field Value Type supplies default Group Key Cell presentation.

An aggregate-capable normalized Field Column may additionally store typed `aggregateValueFormatter`, `aggregateCellClassName`, and `aggregateCellRenderer` overrides. The grouped render plan supplies the aggregate result, aggregate function, Column Identity, ordered group-key values, and exact row count without a raw `TRow`. When absent, the compiled aggregate-result Value Type supplies default presentation. Aggregate result typing belongs to the selected function and Value Type rather than being assumed equal to the source field type.

Grouped class overrides are normalized as either one static token or one direct conditional function reference. The renderer evaluates a conditional only for a mounted cell, appends its result to the semantic and interaction-state class set, and creates no subscription or React state. A class override never enters Column Value Semantics.

Factories and static column arrays live at module scope. Their types must preserve literal Column Identity, field/value correlation, computed getter values, and row/value callback parameters without consumer casts or repeated row generics. TanStack helper types may inform the implementation, but BrunoTable's helpers and normalized definitions remain the public interface.

When grouping is active, the ordered Group By Region supplies the flat group-key field tuple. An active key column contributes its field value and suppresses its own configured aggregate; every other configured aggregate column contributes its single aggregate result. Client and Viewport Adapters consume this same normalized plan without exposing TanStack aggregation definitions or View Server aggregate objects to the consumer.

The grouped render plan chooses presentation by the normalized cell's role, not by inspecting a row shape. An active key selects the Group Key Cell presentation path; a non-key participating aggregate selects the Aggregate Cell path. A column declaring both capabilities can therefore switch roles without either callback family receiving the other's value type or a fabricated raw row.

Row Identity deliberately differs behind the two row-pipeline Adapters while preserving one private runtime contract. The Client Adapter invokes the mandatory consumer `getRowId` for raw `TRow` records and derives a stable key for grouped summaries from the complete ordered group-key tuple using compiled exact-value semantics. The Viewport Adapter receives effect-view-server's authoritative key beside every raw or grouped row in the same sparse indexed delivery and stores the pair atomically. `BrunoTableServer` rejects `getRowId`: the Adapter never reconstructs source identity or keys a row by viewport position. The key-delivery contract was specified in [effect-view-server#405](https://github.com/bmvantunes/effect-view-server/issues/405) and landed in [effect-view-server#407](https://github.com/bmvantunes/effect-view-server/pull/407); Server support requires a compatible release containing it.

effect-view-server is treated as a first-party collaborating module at this seam. If BrunoTable needs another missing source-owned semantic, the design must change effect-view-server upstream and raise BrunoTable's compatible-version requirement. It must not compensate with another consumer prop, duplicated schema semantics, reconstructed canonical values or keys, or a weaker local fallback.

Aggregate aliases, aggregate values, Rows, sort state, and positions are excluded from logical grouped identity. A grouped record can therefore update or move without retargeting identity-owned state. A group-key change removes the old identity and creates a new one. Changing the Group By tuple advances the complete logical generation and clears incompatible position-based state rather than attempting cross-shape reconciliation.

The grouped render plan always adds one visible BrunoTable-owned Rows System Column. Its Value Type is exact `bigint` and its value counts filtered source rows in the group. It is not synthesized from `getRowId` and does not require Row Identity to map to a Query Field. The Client Adapter computes it over the complete filtered source; the Viewport Adapter compiles an unconditional native View Server `count` aggregate under a reserved internal alias. Consumer aggregate capability excludes `count`, while field-specific `countDistinct` remains available.

Column normalization compiles optional `groupRowsColumn` input into that fixed internal definition once. Callers may replace the non-empty header label, numeric baseline width, and exact-count formatter, conditional class, or renderer, but cannot replace its identity or structural capabilities. The callback context contains the exact `bigint` count and ordered group keys without a raw row or transport alias. Conditional classes run only for mounted Rows cells and create no store subscription.

The preference Module admits the reserved Rows identity only in its column-width slice. A committed resize replaces the baseline, remains dormant while the grouped render plan is absent, and is restored on a later grouped projection. Sanitization retains the width only while the current normalized registry has grouping capability. Column order, visibility, and pinning sanitizers reject the reserved identity, so customizing or resizing Rows cannot create a second layout authority.

The grouped render plan also owns a derived column-layout snapshot. It places active group keys at logical start in Group By order, then Rows, then participating aggregate columns in their base relative order. Reordering the Group By state regenerates both this snapshot and the Adapter's ordered grouping tuple. It never dispatches a base `columns.reorder` command.

The normalized grouped projection includes no other consumer columns. A non-key column participates only through its explicit single `aggFunc`; columns without grouped semantics are absent rather than filled from an arbitrary source row. This projection is derived without mutating visibility preferences. Client and Viewport Adapters receive only its requested aggregates plus the mandatory Rows count, keeping work proportional to explicit grouped output rather than the full raw definition count.

The projection's visibility selector force-includes active keys and Rows, then includes aggregate columns only when base Column Visibility is not explicitly false. This is a pure derived snapshot: it dispatches no visibility command and never writes the forced inclusions into persisted state. Normal visibility remains the sole authority restored when grouping clears.

The first Group By activation is also a Row Selection domain transition. The grouping command clears ordinary selected Row Identities and the private Shift anchor in the same transaction before publishing the grouped projection. The grouped capability snapshot reports Row Selection unavailable, so the derived selection column, checkboxes, Select All, counts, and row actions are absent and selection commands are rejected. The empty state is authoritative rather than dormant; clearing the final group key re-enables ordinary Client Row Selection without restoring IDs or an anchor. This produces at most one narrow selection notification and no additional preference event beyond the Group By commit.

Cell Range Selection has a different grouped capability. The read-only Client keeps its one-axis range engine and canonical Copy command over the complete resident grouped projection, but any Group By add, remove, or reorder first cancels the active pointer session and autoscroll and clears the old range. This prevents identity-based corners from being re-expanded across a different logical order. The new grouped projection may then own a fresh horizontal or vertical range across Group Key, Aggregate, and Rows cells. Its capability mask rejects Paste, fill, and edit commands. The Viewport Adapter remains Active-Cell-only for raw and grouped results.

After deriving that new projection, the same command resets the navigation source to row zero plus the projection's first visible navigable Logical Column. Grouped layout therefore chooses the first active key; ungrouped layout chooses the first visible navigable column in restored base order. An empty authoritative row space clears Active Cell, while a Server generation may expose its row-zero loading slot until it reports zero rows. The navigation engine performs no raw/group identity translation. Reveal runs only if the body owns focus, so the private destination changes without moving DOM focus away from the initiating Group By control. This transient reset creates no persistence event.

That hard reset applies only when the Group By tuple changes. Aggregate-value, Rows-count, membership, and grouped-sort movement within one tuple preserve a surviving active Group Row Identity. If membership removes it, navigation falls back to the same clamped display index rather than row zero. Neither path auto-reveals a live move; the next navigation command reveals its destination through the ordinary geometry seam.

The column-visibility control reads the all-normalized-columns registry so an omitted hidden aggregate remains discoverable. Ordinary visibility commands stay enabled only for aggregate columns while grouped; they mutate the same base visibility state and publish the same persistence event used outside grouping. Capability checks reject active-key and Rows hide commands. No grouped-only visibility store or reconciliation path exists.

The grouping projection also derives the eligible grouped-sort registry: active keys, the reserved `COL_ID_BRUNO_TABLE_ROWS` System Column, and visible participating aggregate columns. The persisted preference Module keeps normal `orderBy` and optional grouped `groupOrderBy` independently. Entering or changing grouping sanitizes only the grouped context, retaining surviving priorities and falling back to every active group key ascending in Group By order when none survive. Hiding a sorted aggregate applies the same sanitizer. Clearing grouping leaves the grouped context dormant and reactivates normal `orderBy` without mutation.

The Group By Region is command-first and fully operable without drag-and-drop. Its Add Group combobox lists only inactive eligible Column Identities using `headerName` as presentation; the same add/remove commands appear in the eligible column's menu. Each active chip exposes an explicit Remove action. A focused chip handles scoped `Alt+ArrowLeft` and `Alt+ArrowRight` as one-position reorder commands while retaining focus, and a polite live region announces its label and new one-based position. Removing a chip focuses the nearest surviving chip or Add Group when none remain. There is no keyboard pickup/drop actor.

Pointer header-to-region drag and chip drag-reorder are convenience gestures that resolve to the same `grouping.add`, `grouping.remove`, or `grouping.move` Grid Commands. The command validates current eligibility and position, replaces the ordered Group By tuple once, emits one complete preference snapshot, and creates at most one Server Query Generation. Grouping controls subscribe only to the normalized eligible-column registry and ordered active tuple; live rows, aggregate values, scrolling, and selection do not rerender them.

The read-only Client Adapter compares flat grouped key and aggregate values through the same compiled Column Value Semantics used elsewhere. The Viewport Adapter emits `{ field, direction }` for an active key and `{ aggregate, direction }` for Rows or an aggregate column. It generates one private aggregate alias per participating Column Identity, then maps the returned value back to that identity before the grouped render plan sees it. This makes multiple aggregate columns over one source field ordinary while preventing aliases or invented names such as `averagePrice` from entering callbacks, state, or persistence. Both active sort contexts enforce at least one entry; grouped sorting can use a grouping or aggregate capability even when the raw column's ordinary `sortable` capability is false.

Grouped layout has one unpinned region in V1. The renderer does not apply ordinary start/end pinning until grouping is cleared. Base Column Order and Column Pinning remain immutable inputs to the derivation, so entering, reordering, or leaving grouping never destroys or rewrites them. A Group By command may publish the changed ordered grouping preference, but it must not masquerade as a Column Order or Column Pinning mutation.

Ordinary header reorder commands are rejected while the Group By tuple is non-empty. Only Group By chip reordering is legal; aggregate-column order continues to derive from the base Column Order. The persisted preference Module owns exactly one base `columnOrder`, one base `columnPinning`, and one ordered `groupBy` list. It never snapshots the derived visual order or an `orderBeforeFirstGroupBy` duplicate. SSR restoration reconstructs the same grouped view from those authoritative inputs, and clearing the final key simply exposes the already-restored base layout.

## Column Value Semantics seam

Every normalized leaf column owns one compiled internal value-semantics plan. It is the single authority for that column's:

- runtime admission at untrusted boundaries;
- semantic equality and total ordering of valid values;
- canonical, locale-independent edit and clipboard text;
- editor and paste parsing;
- versioned JSON-safe filter-operand codec;
- exact numeric filter capability.

The plan is resolved once during column normalization and stored as direct functions on the internal column. Cell rendering, client filtering, sorting, draft reconciliation, conflicts, clipboard, and preference restoration call those functions directly. They do not inspect schema ASTs, look up a global registry, or detect value kinds during every row or cell operation.

`valueFormatter` remains a row-aware visual presentation override. It cannot silently redefine equality, ordering, edit text, clipboard text, persistence encoding, or View Server query operands. Localized currency text such as `£1,234.50` is presentation; the canonical exchange value remains exact and locale-independent unless the column explicitly supplies a paired exchange formatter and parser.

The accepted public direction for exact numeric columns is explicit and requires no per-column comparator boilerplate:

```ts
import { BrunoTableBigDecimalValueType } from "@bruno/table/effect";

const columns = [
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: BrunoTableBigDecimalValueType,
  },
] satisfies BrunoTableColumns<Order>;
```

`"bigint"` is implemented by the root package. The Effect preset is exported only from an optional entry point whose implementation imports Effect; the root `@bruno/table` entry point and its declarations do not. A future source Adapter may supply an already-compiled opaque field-semantics registry to remove repetitive declarations, but the current effect-view-server Viewport Source exposes no such runtime metadata. Never replace that missing contract with row sampling.

The internal semantics interface is deep: one small column selection hides rendering, parsing, comparison, persistence, and integration details. Consumers normally select a built-in or first-party preset instead of implementing each operation. Drag Fill uses canonical exchange text and target parsing to repeat source values; it never asks the value-semantics plan for arithmetic or series inference.

### Exact numeric invariants

- `number`, `bigint`, and BigDecimal are separate domains. Mixed-domain unions have no automatic ordered-numeric capability.
- Native `bigint` uses exact equality and relational comparison, signed base-10 canonical text, and a tagged string persistence codec. It never passes through `Number`.
- BigDecimal equality is numeric, so differently scaled representations such as `1.5` and `1.50` converge.
- The Effect preset admits only values compatible with effect-view-server's injective JSON wire rules and uses a comparator whose work depends on coefficient digits, not scale difference.
- BrunoTable must not use Effect's general scale-aligning `BigDecimal.Order` or `BigDecimal.Equivalence` for unrestricted View Server values, because extreme safe-integer scale differences can attempt to materialize an impossible power of ten.
- `inRange` is half-open everywhere: `lower <= value < upper`.
- Client exact filters and sorts are explicit TanStack functions or grid-owned processing. TanStack automatic functions are never the semantic authority.
- Runtime filter state retains native operands. Only preference persistence encodes them, and restoration requires the current Column Identity, codec ID, codec version, operator, and capability to agree.
- Default clipboard text is canonical and round-trippable. Display-formatted copy is an explicit paired capability.

For BigDecimal, the preferred integration is a public effect-view-server value-semantics authority reused by the optional Adapter. Until that exists, the optional Adapter may carry the audited digit comparator only with cross-repository parity tests against the vendored effect-view-server source. Do not import its private `@effect-view-server/effect-utils` workspace package.

### Exact-value performance

Exactness stays out of React state. Parse filter operands once when filter state changes, reuse direct comparator references, and cache BigDecimal canonical text/comparison metadata by immutable object identity where profiling justifies it. Client sort benchmarks must cover large coefficients and pathological safe scales; a regression gate must prove comparator cost is independent of scale difference.

## Technology split

### TanStack Table v9

Use for:

- the internal column model adapted from `BrunoTableColumns`
- header groups
- column state
- sorting and filtering configuration
- visibility
- sizing
- order
- pinning

Do not force the complete logical server dataset into a TanStack Table `data` array.

Do not expose TanStack's inferred column identities through the public interface. Map every mandatory namespaced public `columnId` to TanStack's explicit `id`.

The client variant installs client filtered and sorted row models. The viewport variant retains the same filter/sort state and header capabilities but enables manual processing, because its sparse rows are already positioned and processed by the server. Shared UI never calls the row-model implementations directly; it dispatches common grid commands.

### View Server Translation Adapter

The effect-view-server integration sits at a translation seam:

```text
BrunoTable state       current column definitions       View Server query
columnId filters  ->   columnId -> field/capability  -> field conditions
columnId sorts    ->   columnId -> field/capability  -> field ordering
```

The Adapter also derives the explicit projection required by the current table and binds viewport windows to the caller-owned `viewportSource`.

For leased sources, the effect-view-server source definition is the sole authority for the Route Field tuple. The Adapter's conditional capability requires the caller's exact Feed Route values through `BrunoTableServer`, snapshots them with effect-view-server semantics, and adds them unchanged to every viewport replacement. It never duplicates the field tuple or derives routing from column definitions, filters, loaded rows, or projection. Changing the Feed Route creates a new logical indexed row space and invalidates the old sparse cache and transient interaction state.

Do not persist View Server fields as grid identity, send `columnId` as a query field by coincidence, or infer server semantics from `valueGetter`.

### Virtualization

Need true two-axis virtualization.

Required layout:

- vertical row virtualizer
- one grid-level horizontal centre-column virtualizer, never one per row
- pinned columns rendered outside horizontal virtualization
- one scroll container
- fixed row height fast path
- one immutable column-window snapshot shared by headers and every mounted row
- bounded mounted cells proportional to mounted rows multiplied by pinned plus virtual centre columns, never total centre-column count

Rows and columns are virtualized for both Client and Server Tables. The Client Row Pipeline provides the complete final row count and resident rows. The Viewport Row Pipeline provides exact `totalRows` geometry and sparse indexed slots. The horizontal path is identical for both variants: it virtualizes the current visible centre-column sequence after order, visibility, and pinning have been applied. Pinned-start and pinned-end columns remain mounted and contribute to viewport insets, keyboard reveal, and mounted-cell instrumentation.

### React Compiler virtualization boundary

TanStack Table and TanStack Virtual expose stable objects with mutable internals and getter methods. A compiled component can memoize a getter call against the stable object reference and render stale geometry. The current vendored TanStack Table experimental column-virtualization example keeps React Compiler disabled specifically because `header.getSize()` can be frozen this way.

Treat compiler isolation as an initial correctness requirement, not an emergency whole-grid opt-out:

- only a small private Virtualizer Adapter may call `useVirtualizer`, read mutable virtualizer getters, or coordinate imperative measurement
- mark that adapter function `"use no memo"` while the installed version requires it, with a tracked removal test
- never pass mutable TanStack Table, Row, Cell, Column, Header, or Virtualizer instances into compiled cell, row, header, toolbar, or overlay descendants
- publish immutable vertical and horizontal window snapshots through narrow external-store subscriptions
- share one horizontal snapshot across header and body so every mounted row renders the same centre-column indexes and virtual padding
- keep scroll offsets, measurements, and pointer geometry outside React state
- preserve the private Adapter seam so `@tanstack/react-virtual` can be replaced by `@tanstack/virtual-core` without changing BrunoTable's public API or Grid Runtime

Current TanStack Virtual React options such as `directDomUpdates`, `directDomUpdatesMode`, and `useFlushSync` remain private Adapter policy. Benchmark their exact installed behavior in production builds before selecting defaults. Direct DOM positioning can reduce scroll-only React renders, but transform mode creates stacking contexts that can affect pinned layers, while disabling `flushSync` trades synchronous accuracy for React 19 compatibility and batching. None is a substitute for immutable snapshots or compiler-on correctness tests.

The public variants must be separate unconditional hook compositions. Do not choose `useClientGridRuntime` versus `useViewportGridRuntime` behind a runtime flag. Provide `BrunoTableView` with a stable runtime reference, and let cells and headers subscribe to narrow external-store selectors instead of placing changing table snapshots in one React context value.

On every TanStack Table, TanStack Virtual, React, or React Compiler upgrade, rerun the compiler-on geometry suite. Remove the escape hatch only after column resize, reorder, pinning, scrolling, keyboard reveal, and both virtual ranges remain live with compilation enabled.

### XState

Use XState for workflows with legal transitions:

- editing
- drag selection
- drag fill
- column drag
- column resize
- save
- conflict resolution

Do not send every pointer coordinate or scroll event through XState.

### Effect

Effect is optional.

Use it at boundaries:

- RPC
- WebSocket lifecycle
- typed failures
- retries
- cancellation
- schemas
- resource management
- optional BigDecimal parsing, schema codecs, and hostile-input admission

Do not use it for:

- rendering
- measurement
- cell lookup
- geometry
- every pointer move
- every scroll event
- discovering value kinds during cell rendering

## Logical layout

Pinned columns are visual regions, not separate logical tables.

```text
pinned start | virtualized centre | pinned end
```

The logical visible leaf-column order remains one ordered sequence.

A move right from the final pinned-start column enters the first centre column.

A move right from the final centre column enters the first pinned-end column.

## Row identity and row position

Keep identity and position separate.

```ts
type RowId = string;
type RowIndex = number;
```

A Server Table should conceptually maintain:

```text
query + row index -> row ID
row ID -> row record
```

This allows:

- stable identity when rows move
- live row updates
- safe cache invalidation
- multiple positional references to one entity
- block eviction without losing canonical row identity

## Plugin architecture

Features should be pluggable.

A plugin may contribute:

- commands
- state slices
- selectors
- keyboard handlers
- context menu items
- side panels
- persistence slices
- cell decorations
- capability checks
- diagnostics

Potential plugins:

- editing
- clipboard
- range selection
- drag fill
- column tools
- server viewport
- export
- grouping
- aggregation
- pivot
- saved views
