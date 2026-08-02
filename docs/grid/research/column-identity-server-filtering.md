# Column identity and server query fields

Research date: 2026-08-02

Sources inspected:

- AG Grid `latest`, commit [`2610291`](https://github.com/ag-grid/ag-grid/tree/26102912f3d5f90dab8e6c4fe3264a31e5fb8410) (`36.0.0-beta.20260731.1136`)
- TanStack Table `beta`, commit [`958551d`](https://github.com/TanStack/table/tree/958551dbbc28752345033c40e6b4c88d592e8120) (`9.0.0-beta.71`)
- effect-view-server, commit [`0e09abb`](https://github.com/bmvantunes/effect-view-server/tree/0e09abb1384b899279ea07b15f0bcb3c852284b9)
- Kevin Van Cott's [2026-08-02 X post](https://x.com/KevinVanCott/status/2083714340679512098) and attached screenshot

## Decision

`BrunoTable` should make `columnId` mandatory for every leaf column. It is the durable identity of a **grid column**, scoped by `tableId`, and should key all persisted column preferences, filters, and sorts. The accepted public identifier grammar is `` `COL_ID_${Uppercase<string>}` ``.

`field` should identify a **row/query field**, not a column. For an ordinary data-backed column it is the cheap direct cell-value path and the default effect-view-server field used when compiling a filter or sort. A computed/action column can omit `field`, but then server filtering and sorting must be disabled unless that column declares an explicit server-query mapping.

The important correction to the initial hypothesis is that AG Grid does **not** persist or send ordinary filter state keyed by `field`. Its filter model and sort model are keyed by column ID. They only appear field-keyed in most examples because AG Grid defaults `colId` to `field` when no explicit `colId` is supplied.

Therefore the boundary should be:

```text
persisted/user state       current column definitions       effect-view-server query
columnId + operator/value  columnId -> field/capabilities   field + operator/value
columnId + direction       columnId -> field/capabilities   field + direction
```

## What AG Grid actually does

### `colId` is the grid identity

AG Grid documents `colId` as the ID used by APIs for sorting and filtering. It is optional in AG Grid: the grid falls back to `field`, then generates an ID if both are absent. Its current column-tree builder uses `colId ?? field` as the base identity and suffixes collisions. See [`ColDef`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/entities/colDef.ts#L306-L319), the [column ID documentation](https://www.ag-grid.com/javascript-data-grid/configuration/#column-ids), and [`buildColumnTree.ts`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/columns/buildColumnTree.ts#L175-L215).

AG Grid's `ColumnState` contains a mandatory `colId`; ordering is restored from the order of that state array when `applyOrder` is enabled. See [`ColumnState`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/columns/columnStateUtils.ts#L30-L81) and the [Column State order example](https://www.ag-grid.com/javascript-data-grid/column-state/#applying-partial-state).

### Filters and sorts are keyed by `colId`, including SSRM

AG Grid's `FilterModel` is explicitly an object keyed by column ID, and the implementation builds it from a map keyed by column ID. See [`FilterModel`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/interfaces/iFilter.ts#L407-L425) and [`ColumnFilterService.getModel`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/filter/columnFilterService.ts#L290-L316).

AG Grid's sort entries are `{ colId, sort }`; the implementation reads the runtime column's `colId`. See [`SortModelItem`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/interfaces/iSortModelItem.ts#L1-L10) and [`_getSortModel`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/sort/sortService.ts#L385-L397).

The Server-Side Row Model request forwards those same `filterModel` and `sortModel` shapes. It does not add a `field` translation. See [`IServerSideGetRowsRequest`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/interfaces/iServerSideDatasource.ts#L12-L41), [SSRM filtering](https://www.ag-grid.com/javascript-data-grid/server-side-model-filtering/), and [SSRM sorting](https://www.ag-grid.com/javascript-data-grid/server-side-model-sorting/).

Consequently, an AG Grid backend often treats a received `colId` as a database field only by convention. If an application gives a column `colId: "displayPrice"` and `field: "price"`, its server adapter must know how to map `displayPrice` back to `price`.

### `field` is value access, not durable identity

AG Grid defines `field` as the row-object path used to obtain cell data, including dotted paths. Its hot value resolver runs `valueGetter` when one exists; otherwise it reads `field`. See [`ColDef.field`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/entities/colDef.ts#L315-L319) and [`ValueService.resolveCoreValue`](https://github.com/ag-grid/ag-grid/blob/26102912f3d5f90dab8e6c4fe3264a31e5fb8410/packages/ag-grid-community/src/valueService/valueService.ts#L355-L446).

This separation permits multiple distinct columns over one field and lets display identity survive a backend field rename. It also explains why relying on AG Grid's implicit `field -> colId` fallback is unsafe for saved views.

## What TanStack Table v9 and Kevin's post mean

TanStack Table also keys its state by column identity:

- column filters are `{ id: string, value: unknown }` ([source](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/packages/table-core/src/features/column-filtering/columnFilteringFeature.types.ts#L33-L41));
- sorts are `{ id: string, desc: boolean }` ([source](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/packages/table-core/src/features/row-sorting/rowSortingFeature.types.ts#L12-L22));
- column order is an array of column IDs ([source](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/packages/table-core/src/features/column-ordering/columnOrderingFeature.types.ts#L5-L27)).

TanStack derives a column ID from explicit `id`, then `accessorKey`, then a string header. `accessorKey` also creates the row value accessor. See [`constructColumn`](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/packages/table-core/src/core/columns/constructColumn.ts#L45-L90). `BrunoTable` should map mandatory `columnId` to TanStack's explicit `id` instead of accepting these fallbacks.

TanStack's “server-side filtering” remains a manual ownership boundary, not a server query compiler. `manualFiltering` skips the filtered row model and assumes the supplied data is already filtered; `manualSorting` does the equivalent for sorting. Applications own the state and use it to issue their own queries. See the current v9 [filtering guide](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/docs/framework/react/guide/column-filtering.md#L48-L87), [sorting guide](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/docs/framework/react/guide/sorting.md#L144-L175), [`manualFiltering`](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/packages/table-core/src/features/column-filtering/columnFilteringFeature.types.ts#L257-L273), and [`manualSorting`](https://github.com/TanStack/table/blob/65712b74fdb8eb83af1b322885bf7fba0fd5981d/packages/table-core/src/features/row-sorting/rowSortingFeature.types.ts#L232-L246).

Kevin's post is a documentation-design question. He notes that each feature guide repeats a client-versus-server section and asks whether TanStack should add “dedicated guides for manual server processing.” The attached image is the existing Column Filtering Guide section. It is **not** an announcement of a new server-side filter engine, field mapping API, or backend protocol.

## effect-view-server requires the translation seam

effect-view-server queries use topic row fields explicitly:

- raw `where` is an array of typed field conditions and recursive `AND`/`OR`/`NOT` expressions;
- raw `orderBy` entries are `{ field, direction }`;
- filter fields may be supported nested scalar paths, while raw sort fields are top-level topic row keys.

See [`FilterExpression` and `Where`](https://github.com/bmvantunes/effect-view-server/blob/0e09abb1384b899279ea07b15f0bcb3c852284b9/packages/config/src/query-filter.ts#L230-L279), [`OrderBy`](https://github.com/bmvantunes/effect-view-server/blob/0e09abb1384b899279ea07b15f0bcb3c852284b9/packages/config/src/query-sort.ts#L1-L18), [`RawQuery`](https://github.com/bmvantunes/effect-view-server/blob/0e09abb1384b899279ea07b15f0bcb3c852284b9/packages/config/src/raw-query-contract.ts#L42-L48), and [Query Semantics](https://github.com/bmvantunes/effect-view-server/blob/0e09abb1384b899279ea07b15f0bcb3c852284b9/docs/query-semantics.md#L3-L78).

The viewport API accepts a query plus a sparse row sink and turns the window into `offset`/`limit`; the grid adapter therefore has a natural place to compile current column state into the effect-view-server query. See [`LiveQueryViewport`](https://github.com/bmvantunes/effect-view-server/blob/0e09abb1384b899279ea07b15f0bcb3c852284b9/packages/react/src/live-query-viewport.ts#L32-L116) and [`queryWithWindow`](https://github.com/bmvantunes/effect-view-server/blob/0e09abb1384b899279ea07b15f0bcb3c852284b9/packages/react/src/live-query-viewport.ts#L275-L287).

### Persistence and compilation rule

Persist user intent using `columnId`:

```ts
const preferences = {
  filters: [{ columnId: "COL_ID_PRICE", type: "greaterThanOrEqual", filter: 10 }],
  sorting: [{ columnId: "COL_ID_PRICE", direction: "desc" }],
  columnOrder: ["symbol", "price", "quantity"],
} as const;
```

Compile immediately before replacing the viewport query using the **current** column definitions:

```ts
const columns = [
  {
    columnId: "COL_ID_PRICE",
    field: "unitPrice",
    headerName: "Price",
    // filter/edit/render configuration
  },
] as const;

// Runtime query produced from the persisted columnId through the current definition:
const query = {
  where: [{ field: "unitPrice", type: "greaterThanOrEqual", filter: 10 }],
  orderBy: [{ field: "unitPrice", direction: "desc" }],
};
```

On restore, sanitize every persisted leaf against the current `columnId` registry and that column's current operator/value schema. Drop a leaf conservatively when the column is missing, the operation is no longer enabled, no server field mapping exists, or its operand is invalid. Never send `columnId` directly as an effect-view-server field merely because the strings currently happen to match.

If a backend field is renamed without changing the column's meaning, keep `columnId` stable and update `field`; saved user intent will compile to the new field. If the semantic meaning or value domain changes, change the column identity or persisted-format version so stale filters are not silently reinterpreted.

### Column shape implication

The common path should remain terse and cheap:

```ts
{
  columnId: "COL_ID_PRICE",
  field: "price",
  headerName: "Price",
  isEditable: ({ row }) => row.status === "open",
}
```

The type should distinguish it from computed/display columns:

```ts
{
  columnId: "COL_ID_NOTIONAL",
  headerName: "Notional",
  valueGetter: ({ row }) => row.price * row.quantity,
  // no field: not server-filterable or server-sortable by default
}
```

If a computed/display column really has server semantics, require an explicit capability-specific mapping (for example `server.filterField`, `server.sortField`, or a typed translator). Do not infer a server predicate from `valueGetter`, and do not execute that function to construct a query.

Because effect-view-server accepts nested filter paths but only top-level raw sort fields, the final TypeScript design should type-check filtering and sorting capabilities separately even if both default from one ordinary `field` in the common case.

### Separate projection consequence

`field` also gives the viewport adapter an obvious `select` entry for an ordinary data-backed column, but it does not make an arbitrary `valueGetter` queryable. effect-view-server raw queries require an explicit non-empty top-level `select`, so a computed column must either consume explicitly declared selected dependencies or map to a real server-projected field. The adapter must also include infrastructure fields required for row identity and optimistic concurrency. Do not execute or inspect a `valueGetter` to guess those dependencies.

## Remaining uncertainty

The naming of the exceptional mapping (`server`, `query`, `filterField`/`sortField`, or typed translator functions) is still a public-API design choice. The identity boundary is not uncertain: persisted/TanStack state uses `columnId`; effect-view-server wire queries use validated topic fields resolved through current column definitions.
