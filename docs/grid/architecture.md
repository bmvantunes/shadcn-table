# Architecture

## High-level structure

```text
Public React Variants
├── BrunoTableClient
└── BrunoTableServer

Grid Core
├── table configuration
├── column model
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
interface GridRuntime<TRow> {
  readonly tableId: string;

  dispatch(command: GridCommand): void;

  subscribe<T>(selector: (state: GridState<TRow>) => T, listener: (value: T) => void): () => void;
}
```

Do not allow features to modify arbitrary state directly.

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

Do not use it for:

- rendering
- measurement
- cell lookup
- geometry
- every pointer move
- every scroll event

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
