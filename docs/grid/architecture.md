# Architecture

## High-level structure

```text
Grid Core
├── grid definition
├── column model
├── row-model interface
├── command bus
├── capability and policy engine
├── persistence slices
├── plugin registry
└── diagnostics

Row Models
├── ClientRowModel
└── ServerViewportRowModel

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
├── vertical virtualization
├── horizontal virtualization
├── pinned regions
├── overlays
├── accessibility
└── React Compiler adapter boundary
```

## Framework-independent core

The grid engine should not depend directly on React.

React should consume immutable snapshots and issue commands.

Conceptual core API:

```ts
interface GridApi<TRow> {
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
  | { type: "column.resize.commit"; columnId: ColumnId; width: number }
  | { type: "column.move.commit"; columnId: ColumnId; targetIndex: number }
  | { type: "selection.extend"; target: GridCoordinate }
  | { type: "editing.start"; cell: CellCoordinate }
  | { type: "editing.commit"; value: unknown }
  | { type: "edit.transaction.apply"; transaction: GridEditTransaction }
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

## Technology split

### TanStack Table v9

Use for:

- column definitions
- header groups
- column state
- sorting and filtering configuration
- visibility
- sizing
- order
- pinning

Do not force the complete logical server dataset into a TanStack Table `data` array.

### Virtualization

Need true two-axis virtualization.

Preferred initial approach:

- vertical row virtualizer
- horizontal centre-column virtualizer
- pinned columns rendered outside horizontal virtualization
- one scroll container
- fixed row height fast path

If the React adapter is not React Compiler compatible, isolate it in a small `"use no memo"` component and pass immutable virtual-item snapshots into compiled descendants.

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

Server mode should conceptually maintain:

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
