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
├── ClientRowPipelineAdapter
└── ViewportRowPipelineAdapter

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
<BrunoTableServer tableId={...} getRowId={...} columns={...} viewportSource={...} />
```

Do not expose one component with a row-model flag or incompatible source union. The two variants have materially different data ownership and lifecycles, so the public seam should make that difference explicit.

Both variants construct the same Grid Runtime and render the same `BrunoTableView`. Each supplies one row-pipeline Adapter:

```text
BrunoTableClient    -> Client Row Pipeline   --+
                                                +-> Grid Runtime -> BrunoTableView
BrunoTableServer    -> Viewport Row Pipeline --+
```

`BrunoTableView` owns common rendering and interaction. It dispatches grid commands and consumes fine-grained runtime subscriptions; it does not import client or View Server implementations and does not branch on a mode flag.

Both public sources expose common lifecycle chrome: total rows, version, status, optional status code, and optional message. The shared view renders this state consistently. The Client Row Pipeline supplies complete rows; the Viewport Row Pipeline supplies the sparse viewport controller and row store.

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

`BrunoTableQuickFilter` is command-first. Its in-progress text is local input state. Its event handler dispatches through the stable Grid Runtime without reading a changing grid snapshot. It subscribes only to the committed Quick Filter primitive when external filter reset, controlled state, or saved-view restoration must update the displayed text. Streaming row changes never notify that subscription.

Keep the public Module deep:

- compose page-specific UI through children instead of adding feature booleans to table props;
- expose focused BrunoTable-owned controls such as Quick Filter or edit actions instead of a public all-powerful table controller;
- keep TanStack atoms, stores, contexts, and instance methods private;
- keep Grid Filters separate from Source Constraints even when controls for both are visually adjacent.

## Editable-table seam

The `editable: true` discriminant installs the Edit Persistence Capability in either public composition root and causes `BrunoTableView` to mount the top-right Edit Mode toggle and shared Edit Safety Footer. `onSaveEdits` is mandatory in this branch. The toggle and footer are not toolbar children, and pages do not wire their mode, counts, buttons, or modal.

Potential editability is compiled once from column definitions. A declared `isEditable` boolean or predicate makes a column potentially editable; the predicate itself runs only for a concrete cell. Never scan changing Client rows or incomplete Server rows to decide whether edit chrome exists.

Edit Mode has its own compact runtime source initialized to Immediate for each table session. Only the end-user toggle dispatches mode changes; consumer props neither initialize nor control it. The toggle selects only the current `"immediate" | "batch"` value and `canChangeEditMode`; row publications do not notify it. Mode changes are rejected while the active editor, drafts, validation, conflicts, or save state are non-clean, and Edit Mode never enters persisted preferences.

The footer dispatches `edits.reset`, `save.request`, and `conflicts.review.open` Grid Commands. It never calls the consumer operation directly from a button handler. The Save Workflow actor commits or rejects the active editor, evaluates validation and conflicts, opens the shared review workflow when blocked, and invokes the latest `onSaveEdits` operation only from its ready-to-persist transition. Updating the consumer callback reference must not replace the Grid Runtime or resubscribe the mounted grid.

The persistence Adapter receives one non-empty Save Change Set in both modes. Immediate mode forwards one whole committed transaction, including every cell changed by paste, fill, or clear. Batch mode derives one net change per dirty Cell Identity from sparse drafts. Do not loop over the array and invoke the consumer operation once per cell.

Footer render boundaries remain independent:

- the conflict control selects only `conflictCount` and is absent when that count is zero;
- unsaved and invalid summaries select only their own compact counts;
- Reset selects only `canReset` and `isSaving`, then dispatches a command;
- Save selects only `canSave`, `isSaving`, and the minimal blocking-summary presentation it renders;
- the conflict modal reads sparse conflict records only while open.

Row publications that preserve these projections do not notify any footer source. The footer remains mounted but its actions are disabled when there are no pending edits.

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

Do not allocate a placeholder row object or TanStack row for every server index. The virtualizer owns total scroll geometry; the sparse store owns only loaded, loading, retained, or failed slots. Internal window alignment and buffer sizing are transport optimizations, not pagination state.

Scroll events update geometry outside React state and publish range changes at most once per animation frame. A filter or sort change creates a new logical index generation, clears incompatible positional mappings, resets vertical scroll to the start, and requests the first required window.

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

- a selection checkbox may select one row's boolean;
- an editable cell may select only its own draft, validation, and conflict state;
- drag-range presentation should use a per-row derived key when one change affects several cells and neighbouring selection edges;
- a header may select only its own sort, filter, pin, resize, or menu presentation;
- overlays, toolbars, footers, and status indicators subscribe independently to the values they render.

Do not add a subscription to a component that only renders stable row data. Prefer a single slice atom as the source. When a render island depends on several slices, project the smallest primitive or shallow-stable object that completely describes its output.

TanStack row, cell, column, and header builder methods hide state reads from React Compiler. Any nested compiled component that calls such a method must sit behind an explicit subscription boundary for every state dependency it renders. This is a correctness rule as well as a performance rule.

Some hot presentation state should avoid React reconciliation entirely. During live column resize, subscribe imperatively to the sizing atom, write width CSS variables on the grid root, batch writes per animation frame, and unsubscribe on teardown. React render islands remain appropriate for the small pieces that must change semantically, such as the active resize handle.

## Row-pipeline Adapter seam

The Grid Runtime owns one validated filter state and one validated sort state, both keyed by Column Identity. Filter and sort controls only dispatch `filters.replace` and `sorting.replace` commands.

The Client Row Pipeline ingests a complete Client Source and responds to filter/sort commands by recomputing local TanStack row-model stages over its rows. Source lifecycle changes update shared overlays without placing the source envelope or full row collection in React context.

The Viewport Row Pipeline responds by resolving Column Identity through current column definitions, replacing the View Server query, advancing the query generation, and treating delivered sparse rows as already filtered and sorted.

This is a real seam because there are two implementations. Keep source ownership, query replacement, and sparse-cache lifecycle behind the Adapter rather than spreading client/viewport branches through headers, cells, navigation, editing, or clipboard code.

## Column construction seam

Raw definitions, built-in Column Helpers, and application Column Presets all converge into the same validated normalized-column representation before TanStack columns or render plans are created. Helpers are construction-time modules, not runtime column kinds: normalized cells do not branch on whether their definition came from `BrunoTableNumberColumn`, `priceColumn`, or a raw object.

A raw value-bearing column declares `valueType`. A built-in helper supplies that Value Type together with coherent presentation and interaction defaults. Application presets specialize helpers for domain conventions without creating a string registry. Every path still requires explicit Column Identity and an explicit `field` or `valueGetter` mapping.

Construction-time precedence is fixed:

```text
built-in helper defaults -> Column Preset defaults -> individual column options
```

The normalized column stores direct renderer, editor, formatter, class, comparator, parser, and capability references. Numeric alignment, checkbox centering, and full-width select editors resolve to semantic layout tokens consumed by the renderer and theme; they do not allocate style objects or execute helper lookup logic per cell.

`valueFormatter`, `cellClassName`, and `cellRenderer` are typed Cell Presentation overrides. The formatter produces visible text, a conditional class changes presentation, and the renderer is the full React escape hatch. They never replace the normalized value-semantics functions. A custom representation used for edit or clipboard round trips must declare the paired parse/exchange capability explicitly.

Factories and static column arrays live at module scope. Their types must preserve literal Column Identity, field/value correlation, computed getter values, and row/value callback parameters without consumer casts or repeated row generics. TanStack helper types may inform the implementation, but BrunoTable's helpers and normalized definitions remain the public interface.

## Column Value Semantics seam

Every normalized leaf column owns one compiled internal value-semantics plan. It is the single authority for that column's:

- runtime admission at untrusted boundaries;
- semantic equality and total ordering of valid values;
- canonical, locale-independent edit and clipboard text;
- editor and paste parsing;
- versioned JSON-safe filter-operand codec;
- exact numeric filter capability;
- optional arithmetic used by series fill.

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

The internal semantics interface is deep: one small column selection hides rendering, parsing, comparison, persistence, and integration details. Consumers normally select a built-in or first-party preset instead of implementing each operation. Arithmetic is an optional capability because copy fill needs equality and canonical text, while numeric series fill additionally needs exact addition and subtraction.

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

Do not persist View Server fields as grid identity, send `columnId` as a query field by coincidence, or infer server semantics from `valueGetter`.

### Virtualization

Need true two-axis virtualization.

Preferred initial approach:

- vertical row virtualizer
- horizontal centre-column virtualizer
- pinned columns rendered outside horizontal virtualization
- one scroll container
- fixed row height fast path

If the React adapter is not React Compiler compatible, isolate it in a small `"use no memo"` component and pass immutable virtual-item snapshots into compiled descendants.

The public variants must be separate unconditional hook compositions. Do not choose `useClientGridRuntime` versus `useViewportGridRuntime` behind a runtime flag. Provide `BrunoTableView` with a stable runtime reference, and let cells and headers subscribe to narrow external-store selectors instead of placing changing table snapshots in one React context value.

Long-term option:

- use virtualization core
- expose immutable snapshots through `useSyncExternalStore`
- remove the compiler escape hatch

### XState

Use XState for workflows with legal transitions:

- editing
- drag selection
- drag fill
- column drag
- column resize
- save
- conflict resolution
- async validation

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

- stable edits when rows move
- stable conflict records
- live row updates
- safe cache invalidation
- multiple positional references to one entity
- block eviction without losing drafts

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
