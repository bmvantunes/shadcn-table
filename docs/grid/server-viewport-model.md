# Server viewport row model

## Goal

Implement AG Grid-style viewport behaviour without copying its exact API.

The grid owns a long-lived indexed row store.

The grid tells a datasource session which logical indexed range is visible and required.

The datasource pushes row ranges, updates, row counts, failures, and invalidations into a grid-owned sink.

React does not own the complete row collection in component state.

## Core model

```text
React renderer
    ↓ reads immutable snapshots
Grid row store
    ↔ long-lived datasource session
View server
```

## Public consumer shape

Consumers pass a long-lived `viewportSource` directly to `BrunoTableServer`:

```tsx
type Order = TopicRow<typeof viewServer.topics, "orders">;

const columns = [
  { columnId: "COL_ID_SYMBOL", field: "symbol" },
  { columnId: "COL_ID_PRICE", field: "price" },
] satisfies BrunoTableColumns<Order>;

const getOrderRowId = (row: Order) => row.id;

function OrdersTable() {
  const viewportSource = useLiveQueryViewport("orders");

  return (
    <BrunoTableServer
      tableId="orders"
      getRowId={getOrderRowId}
      columns={columns}
      viewportSource={viewportSource}
    />
  );
}
```

Do not require consumers to construct `defineGrid`, `rowModel`, or datasource-session objects. The source and columns must carry enough type information for `BrunoTableServer` to infer the topic row and valid query capabilities.

## View Server Translation Adapter

Grid-owned filters, sorts, and layouts use `columnId`. effect-view-server knows topic fields. The Adapter resolves each queryable `columnId` through the current column definition immediately before replacing the Live Query Viewport query.

```text
Grid state              Column registry             effect-view-server
columnId condition  ->  field + capability      ->  where field condition
columnId sort       ->  field + capability      ->  orderBy field entry
rendered columns    ->  field dependencies      ->  explicit select
```

Rules:

- Field columns provide the default View Server field mapping.
- `valueGetter`-only columns have no automatic server filter, sort, or projection semantics.
- Filter and sort mappings are separate capabilities because View Server supports nested filter paths but only top-level raw sort fields.
- Persisted grid state never stores backend fields as identity.
- Invalid or stale mappings are dropped conservatively during preference restoration and rejected if they reach query compilation.
- The Adapter must include row-identity and optimistic-concurrency fields required by grid infrastructure.

The exact exceptional mapping and projection-dependency property names remain open public-interface decisions.

## Internal source seam

`BrunoTableServer` adapts the public Viewport Source to an internal long-lived session and grid-owned sparse sink. Conceptually, the internal session still needs operations equivalent to:

```ts
interface ServerViewportSession<TQuery> {
  setQuery(request: { generation: number; query: TQuery }): void;
  setViewport(request: { generation: number; visible: IndexRange; required: IndexRange }): void;
  refresh(request: { generation: number; range?: IndexRange }): void;
  dispose(): void;
}
```

This is an internal seam, not an object the ordinary `BrunoTableServer` consumer constructs.

## Why a long-lived object

The datasource session and sink should be created once per grid instance.

They must not be recreated by ordinary React renders.

The view server can call the sink directly when data arrives.

Avoid:

```tsx
const [rows, setRows] = useState<Row[]>([]);
```

for every server batch.

Instead:

```ts
rowStore.applyMessage(message);
```

Then notify only relevant subscribers.

## Indexed storage

The logical model is index-addressable.

Do not use only:

```ts
Record<number, TRow>;
```

because the store also needs:

- loading state
- failures
- versions
- query generations
- eviction metadata
- placeholders

Suggested internal structure:

```ts
type RowSlot<TRow> =
  | { status: "empty" }
  | { status: "loading"; requestId: string }
  | {
      status: "loaded";
      rowId: string;
      version: string;
      row: TRow;
      revision: number;
    }
  | { status: "error"; error: unknown };

type RowBlock<TRow> = {
  blockIndex: number;
  startIndex: number;
  slots: Array<RowSlot<TRow>>;
  queryGeneration: number;
  lastAccessedAt: number;
};
```

Use arrays inside blocks for efficient contiguous indexed data.

## Separate identity from position

Maintain conceptually:

```ts
class ViewportStore<TRow> {
  private indexToRowId = new Map<number, string>();
  private rowsById = new Map<string, RowRecord<TRow>>();
}
```

```ts
type RowRecord<TRow> = {
  row: TRow;
  serverVersion: string;
  localRevision: number;
};
```

Benefits:

- row moves do not destroy edits
- conflicts remain keyed by row identity
- live updates are direct
- query blocks can be invalidated independently
- dirty data survives cache eviction
- duplicate entity payloads can share references

## Stable references

Keep unchanged row references stable.

When a row changes, replace its row object:

```ts
const nextRow = {
  ...existingRow,
  price: nextPrice,
};
```

Do not invisibly mutate a stable row object and expect React to notice.

Desired structural sharing:

```text
unchanged row -> same reference
changed row   -> new reference
```

## React subscriptions

Do not make the entire viewport one snapshot.

The viewport renderer should subscribe to geometry and visible indexes.

Each mounted row should subscribe independently to its row slot.

Conceptually:

```ts
function useRowSlot(rowIndex: number) {
  return useSyncExternalStore(
    (listener) => store.subscribeIndex(rowIndex, listener),
    () => store.getIndexSnapshot(rowIndex),
    () => store.getServerSnapshot(rowIndex),
  );
}
```

Then a server update to one row notifies only that row's mounted subscriber.

Start with row-level subscriptions.

Add cell-level subscriptions only if realistic profiling proves row-level updates are too coarse.

## Query generation

Every filter or sort change creates a new logical index space.

Use a generation number:

```ts
let queryGeneration = 0;
```

On query change:

1. increment generation
2. abort or obsolete old requests
3. clear incompatible index mappings
4. reset the viewport to the top
5. request initial blocks

Every sink message carries its generation.

Ignore stale responses.

## Viewport requests

The virtualizer reports:

- visible range
- overscan range

The row model converts the required range to blocks and requests missing data.

Example:

```text
Visible: 950-1030
Required: 920-1060
Block size: 200

Needed:
block 4: 800-999
block 5: 1000-1199
```

## Range responses

For contiguous data, prefer:

```ts
provideRange({
  startIndex,
  rows,
});
```

over a sparse numeric object.

For sparse positional changes, use a separate method.

For identity-based data updates, use another separate method.

Do not overload one payload with ambiguous semantics.

## Row count

Support:

```ts
rowCount: number | "unknown";
```

Unknown totals require a growing estimated scroll range until the server reports the end.

This affects:

- status text
- Page Down
- select all
- scrollbar geometry
- end-of-data detection

## Live updates

The view server may push:

- row value updates
- row removals
- row moves
- range invalidations
- count changes

Start with safe range invalidation when a live update affects active sorting or filtering.

Explicit row moves can be added later if benchmarks justify the complexity.

## Editing

Drafts, conflicts, and validation do not live inside evictable row blocks.

Use sparse identity-keyed repositories:

```ts
type CellKey = `${string}:${string}`;

type EditRepository = {
  drafts: Map<CellKey, BrunoTableCellDraft>;
  conflicts: Map<CellKey, BrunoTableCellConflict>;
  validationErrors: Map<CellKey, ValidationError>;
};
```

When a row reloads, overlay drafts on top of canonical server data.

## Sorting and dirty rows

In a Viewport Table, a local edit may alter the active sort order.

Recommended policy:

- keep the dirty row visually stable until save or revert
- mark that it may move after save
- after save, apply canonical returned values
- refresh affected ranges if sort or filter fields changed

Do not attempt global local repositioning without server knowledge.

## Filter mismatch and dirty rows

A live server update may cause a dirty row to stop matching the active filter.

Recommended behaviour:

- retain it as a dirty exceptional row
- show that it no longer matches the filter
- keep its edits accessible
- resolve on save or revert

## Fixed row height

Initial server viewport mode should require fixed row height.

This enables deterministic indexed geometry for unloaded rows.

Variable row heights can be investigated later as an advanced estimated mode.
