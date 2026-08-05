# Server viewport row model

## Goal

Implement AG Grid-style viewport behaviour without copying its exact API.

The public experience is one continuous virtual row space shared with `BrunoTableClient`. There is no page navigation, page index, page size, or load-more interaction.

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
import { BrunoTableBigIntColumn, BrunoTableTextColumn, type BrunoTableColumns } from "@bruno/table";

type Order = TopicRow<typeof viewServer.topics, "orders">;

const columns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  BrunoTableBigIntColumn({
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
  }),
] satisfies BrunoTableColumns<Order>;

function OrdersTable() {
  const viewportSource = useLiveQueryViewport("orders");

  return (
    <BrunoTableServer
      tableId="orders"
      columns={columns}
      quickFilterFields={["symbol"]}
      viewportSource={viewportSource}
    />
  );
}
```

Do not require consumers to construct `defineGrid`, `rowModel`, or datasource-session objects. The source and columns must carry enough type information for `BrunoTableServer` to infer the topic row and valid query capabilities.

## Leased feed routing

effect-view-server leased sources declare one authoritative non-empty Route Field tuple when the source is configured:

```ts
routeBy: ["region", "desk"];
```

That declaration derives the exact Feed Route object required by every Live Query. BrunoTable never asks the consumer to duplicate the field-name tuple. It accepts only the current values, inferred from the Viewport Source:

```tsx
const viewportSource = useLiveQueryViewport("regionalOrders");

<BrunoTableServer
  tableId="TABLE_ID_REGIONAL_ORDERS"
  columns={columns}
  viewportSource={viewportSource}
  routeBy={{ region: selectedRegion, desk: selectedDesk }}
/>;
```

For leased topics, `routeBy` is mandatory and contains all and only the source-declared Route Fields with their exact row-field value types. For materialized or source-free topics it is forbidden. This conditional capability must be inferred without exposing TanStack objects or making Effect mandatory for the root package.

The Feed Route chooses one upstream leased feed. It is not a Grid Filter Expression, Set Filter, External Filter, projection declaration, or Column Identity mapping. A Route Field need not appear in `select`, have a visible column, or support filtering. The Adapter forwards the snapshotted route unchanged in every replacement query:

```ts
viewportSource.viewport.replace({
  window,
  query: {
    routeBy,
    select: compiledProjection,
    where: compiledFilters,
    orderBy: compiledSorting,
  },
  sink,
});
```

Do not add `routeByFields` to BrunoTable. The source declaration is the only field-list authority. Do not infer a Feed Route from a single-choice Set Filter: filtering occurs inside the selected feed and cannot substitute for routing.

When the Feed Route changes semantically, release the old query generation, invalidate the complete sparse indexed cache, clear transient focus/selection/scroll state, and start the new logical row space at index zero. Preserve compatible grid preferences because route values are application state, not persisted grid intent. Route snapshots and equality must use the effect-view-server Adapter's exact query semantics so `bigint`, BigDecimal, and other admitted native values are never coerced or compared by React object identity.

`externalFilters` is a separate optional Server-only input containing field-keyed View Server conditions. It defaults to no conditions and may reference valid filter fields that have no visible column. The Adapter combines External Filters, Quick Filter, and compiled Grid Filters through `AND`; it never translates External Filter fields through Column Identity. A semantic External Filter change releases the old query generation, invalidates the sparse indexed cache, clears transient focus/selection/scroll state, and starts at row zero while preserving compatible grid preferences and the current Feed Route. Compare filters through exact query semantics rather than React object identity so an equivalent freshly allocated array does not restart the viewport.

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
- Computed Columns contribute their explicit non-empty `fields` dependency tuple to projection but have no server filter or sort semantics.
- Filter and sort mappings are separate capabilities because View Server supports nested filter paths but only top-level raw sort fields.
- Persisted grid state never stores backend fields as identity.
- Invalid or stale mappings are dropped conservatively during preference restoration and rejected if they reach query compilation.
- Server Row Identity never forces a field into projection; the Viewport Source delivers its authoritative key out of band beside each row.

The public effect-view-server Viewport Source preserves TypeScript row/query types but exposes no runtime schema or field-semantics registry. Raw columns therefore declare Value Type explicitly, while typed Column Helpers such as `BrunoTableBigIntColumn` supply it. The Adapter must never inspect the first loaded row, because the source is sparse, a field may initially be nullish, and behavior cannot depend on scroll position. A future effect-view-server contract may provide an opaque precompiled registry, but that is an optional concision improvement rather than a correctness fallback.

All Server row identity is source-owned. BrunoTable requires the additive key-delivery contract specified in [effect-view-server#405](https://github.com/bmvantunes/effect-view-server/issues/405) and landed in [effect-view-server#407](https://github.com/bmvantunes/effect-view-server/pull/407): every changed sparse raw or grouped row map is accompanied atomically by an authoritative sparse row-key map over exactly the same absolute indexes. The Adapter stores each row and key together. `BrunoTableServer` rejects `getRowId`; the Adapter does not reconstruct a key from selected fields, group fields, or aggregate aliases and never treats an index as identity. The Server variant must fail its compatibility check clearly when the source cannot provide keys rather than silently installing weaker identity semantics.

effect-view-server is a first-party collaborating module at this seam. If BrunoTable needs another missing source-owned semantic, change the upstream contract and require the compatible release. Do not add a compensating consumer prop, duplicate schema semantics, reconstruct canonical source values or keys, or ship a weaker local fallback.

Runtime Grid Filter operands remain native values. Translation changes `columnId` to the current Query Field and passes native `bigint` or BigDecimal operands to `viewport.replace`; effect-view-server owns schema-aware wire encoding. Client and Server Tables share half-open `inRange` semantics: `filter <= value < filterTo`.

Quick Filter uses the caller's explicit non-empty `quickFilterFields` tuple of string-valued Query Fields, never Column Identities or an inference from visible columns. The Adapter emits one `contains` leaf per field, combines those leaves with `OR`, and combines that group with External Filters and Grid Filters through `AND`. These fields need not have visible columns. Neither the tuple nor committed Quick Filter text is persisted.

An open Server Set Filter does not facet the sparse viewport cache. It owns a separate narrow live whole-result subscription that carries the current Feed Route, External Filters, Quick Filter, and every other active Grid Filter while excluding the filter for its own Column Identity. Boolean and Select columns enable this surface by default; Text, Number, BigInt, and BigDecimal columns require explicit opt-in. Live distinct values and counts remain native and update only the open overlay's compact store. Closing the overlay releases the subscription.

An empty Set Filter inclusion set is a committed Match-None Filter Expression, not no filter. It must exclude current and future values without enumerating the facet domain. The Adapter requires the explicit source-native semantic tracked in [effect-view-server#409](https://github.com/bmvantunes/effect-view-server/issues/409); it must not send an empty `in` condition that View Server normalizes away or emulate Match None with `NOT(in(currentFacetValues))`.

V1 exposes no exceptional computed filter or sort mapping. A Computed Column's `fields` tuple is its complete projection dependency declaration.

## Internal source seam

`BrunoTableServer` adapts the public Viewport Source to a grid-owned sparse sink. The existing effect-view-server source already provides the required long-lived lifecycle. The Adapter uses it conceptually as:

```ts
const generation = viewportSource.viewport.replace({
  query,
  window: { firstRow, lastRow },
  sink,
});

generation.setWindow({ firstRow, lastRow });
generation.release();
```

`replace` is used when filter, sort, or projection semantics change. `setWindow` moves the active indexed window as the user scrolls. `release` runs on replacement or unmount. This is an internal Adapter seam, not an object the ordinary `BrunoTableServer` consumer constructs.

The Adapter, not the source callback flags, owns the Query Generation token. It allocates one token before `replace`, closes that token over the sink, and rejects every delivery after release or replacement. The optional `keepRenderedRows` argument passed to `setRowCount` is a delivery hint inside the current source controller; it never authorizes old-row retention across a semantic generation boundary.

The compatible View Server React binding must install and deactivate this controller without invoking consumer sink callbacks from `useInsertionEffect`. The published `2.1.0` package currently warns on active viewport unmount because insertion-effect cleanup reaches `sink.setRowCount`; [effect-view-server#408](https://github.com/bmvantunes/effect-view-server/issues/408) tracks the upstream lifecycle fix. BrunoTable must not hide it with deferred sink publication or warning suppression.

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
  localRevision: number;
};
```

Benefits:

- row moves retain stable identity
- live updates are direct
- query blocks can be invalidated independently
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

Every semantic View Server query change creates a new logical index space. Compare the normalized Feed Route, `select`, combined `where`, `orderBy`, `groupBy`, and `aggregates` by the Adapter's exact query semantics; equivalent newly allocated inputs do not create work.

Use a generation number:

```ts
let queryGeneration = 0;
```

On query change:

1. increment generation
2. abort or obsolete old requests
3. clear every old sparse row, identity/index mapping, and authoritative row count
4. reset the viewport to the top when required by the initiating semantic command
5. expose provisional fixed-height loading rows for the required viewport
6. replace the source query with the initial required window

Bind each sink instance to its query generation. The public effect-view-server sink messages do not need an extra generation field; the Adapter ignores writes from a sink whose generation is no longer active.

Ignore stale responses.

Do not use the previous generation's `totalRows` to manufacture new scrollbar authority. Before the first new row-count delivery, provisional loading geometry covers the current required fixed-height window. A terminal new-generation error with no accepted rows replaces loading presentation with error chrome; it never revives old rows.

A window-only `setWindow` call stays inside the active Query Generation. It keeps overlapping loaded slots and their references, requests the newly required range, and renders stable loading slots only for missing indexes. A same-generation lifecycle transition to stale, closed, or error may retain its last coherent rows with shared status treatment. Row retention never crosses a semantic query boundary.

This distinction was exercised against `effect-view-server@2.1.0`: moving a 20-row window by five rows retained one generation, reused all 15 overlapping records, and wrote only five new slots. Three rapid Quick Filter drafts produced one debounced replacement and one new generation.

The source `version` used by snapshot/delta delivery is a Query Version for this logical index space. It may reject stale read publications, but it must never be copied into a cell draft or save request as Row Version.

## Viewport requests

The virtualizer reports:

- visible range
- overscan range

The row model expands the visible range using overscan, clamps it to `totalRows`, optionally aligns it to a small window quantum, and sends the resulting inclusive range to the active generation with `setWindow` only when it changes.

Example:

```text
Visible: 950-1030
Required: 920-1060
Block size: 200

Requested source window: 920-1060

Retained cache blocks: 800-999 and 1000-1199
```

The cache may use blocks internally for retention and eviction, but effect-view-server receives one active contiguous window. Its internal query translation may use `offset` and `limit`; those are transport details and do not create page state. A large scrollbar jump replaces the active window directly rather than fetching all preceding blocks.

Keyboard reveal follows the same rule. Holding Arrow Down advances the logical Active Cell by absolute row index and causes the virtualizer to reveal it. The range planner should use source overscan to request upcoming rows before the Active Cell reaches the final visible row. When the user outruns delivery, the requested index remains active as a fixed-height loading slot and the latest required contiguous window is sent to the active generation. Do not issue a request per repeated key event, wait for each row before accepting the next event, or model the operation as fetching a next page.

Live View Server publications may move a row when an active sort key changes. Such movement does not restart the generation or reset scroll. If the Active Cell's Row Identity remains in the known sparse window, reconcile its absolute index without automatically scrolling after it. If that identity leaves the known window and the source does not expose its new index, clear the Active Cell and retain browser focus on the grid root; never transfer activation to the different row now occupying the old index.

## Sink responses

The effect-view-server Viewport Sink writes the AG Grid-compatible sparse row map plus its additive aligned authoritative-key map:

```ts
sink.setRowCount(totalRows, keepRenderedRows);
sink.setRowData(
  {
    [absoluteRowIndex]: row,
  },
  {
    [absoluteRowIndex]: rowKey,
  },
);
```

`keepRenderedRows` does not participate in Adapter generation logic. Only the Adapter's accepted semantic command decides whether rows belong to the current logical space.

The Adapter accepts those sparse absolute-index maps only when they contain exactly the same index set. It rejects missing, extra, invalid, or out-of-range key entries, stores each row/key pair atomically, groups contiguous entries for efficient internal writes, and updates only affected row-slot subscribers. Position and identity remain separate even though they arrive in one delivery.

This shape is a deliberate fast path: each own key is already the absolute logical row index. The Adapter does not append an array, reconstruct indexes from a page offset, or replace the complete loaded window. It validates each key, resolves the corresponding sparse slot directly, preserves every unchanged row reference, and publishes one batched notification to only the affected mounted slots. A delivery containing `k` rows therefore performs work proportional to that delivery rather than `totalRows` or the retained cache size.

## Row count

The initial effect-view-server integration requires the exact numeric `totalRows` exposed by the Viewport Source. That count defines the virtualizer's complete scroll height even though most row slots are unloaded.

This affects:

- status text
- Page Down
- scrollbar geometry
- end-of-data detection

An unknown-length append-only feed is a different future source capability. Do not emulate it with fake sentinel rows or weaken the initial viewport contract.

## Live updates

The view server may push:

- row value updates
- row removals
- row moves
- range invalidations
- count changes

Start with safe range invalidation when a live update affects active sorting or filtering.

Explicit row moves can be added later if benchmarks justify the complexity.

## Read-only interaction contract

`BrunoTableServer` is always read-only. Its composition root does not install editing, drafts, validation, conflicts, Batch mode, paste, drag fill, or undo/redo. Column definitions may still declare Client editing semantics for reuse, but Server cells normalize them to read-only presentation. Destructive cell Clear/Delete commands are absent from V1 in both row models.

The Server Table maintains one logical Active Cell for keyboard navigation across pinned, virtualized, and temporarily unloaded coordinates. Cell Range Selection is disabled. Copy is available only when the Active Cell is loaded and serializes that one value; it never claims to copy an unloaded range, row, or column.

Live updates may move a row or remove it from the current server-filtered and sorted result. Reconcile focus by stable Row Identity when authoritative sparse delivery resolves its new index. In an unchanged grouped projection, an unresolved or removed active identity falls back to the row at its previous display index, clamped to the new final row, while retaining its valid column; the destination may remain a loading slot. Clear only when the authoritative result is empty. Never reconstruct identity from displayed values. There are no local dirty rows to preserve or reposition.

## Fixed row height

Initial server viewport mode should require fixed row height.

This enables deterministic indexed geometry for unloaded rows.

Variable row heights can be investigated later as an advanced estimated mode.
