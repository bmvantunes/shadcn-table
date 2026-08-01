# Public TypeScript API design

## Design goals

The public API must preserve inference across:

- row types
- row identity
- columns
- field values
- accessor values
- filters
- sort models
- editors
- parsers
- validators
- changes
- conflicts
- server requests
- data-source responses

Consumers should not repeatedly specify the same generics.

## Grid definition

Preferred shape:

```ts
type Order = {
  id: string;
  symbol: string;
  price: number;
  quantity: bigint;
  status: "open" | "filled" | "cancelled";
  createdAt: Date;
};

const column = createColumnHelper<Order>();

const columns = [
  column.field("symbol", {
    filterable: true,
    editable: false,
  }),

  column.field("price", {
    filterable: true,
    sortable: true,
    editable: true,
    editor: {
      type: "number",
      min: 0,
    },
    valueFormatter: ({ value }) => value.toFixed(2),
  }),

  column.field("status", {
    filterable: true,
    editable: true,
    editor: {
      type: "select",
      options: ["open", "filled", "cancelled"],
    },
  }),

  column.accessor("notional", {
    accessor: (row) => row.price * Number(row.quantity),
    sortable: true,
    filterable: false,
  }),
] as const;

const ordersGrid = defineGrid({
  tableId: "orders",
  getRowId: (row: Order) => row.id,
  columns,
});
```

Then:

```tsx
<DataGrid
  definition={ordersGrid}
  rowModel={{
    type: "server",
    dataSource,
  }}
/>
```

The definition should carry all required generic information.

## Mandatory fields

```ts
type GridDefinitionInput<TRow, TColumns> = {
  tableId: string;
  getRowId: (row: TRow) => string;
  columns: TColumns;
};
```

Potential future refinement:

- branded row IDs
- row-ID generic inferred from `getRowId`

## Field columns

Field names must be real fields:

```ts
column.field("price", {});
```

This must fail:

```ts
column.field("prices", {});
```

The value type is inferred:

```ts
price -> number
status -> "open" | "filled" | "cancelled"
```

## Accessor columns

Computed columns require an explicit stable ID:

```ts
column.accessor("notional", {
  accessor: (row) => row.price * Number(row.quantity),
});
```

The accessor return type becomes the column value type.

## Column IDs and capabilities

The columns tuple should derive unions:

```ts
type ColumnIdOf<TColumns> = ...
type SortableColumnId<TColumns> = ...
type FilterableColumnId<TColumns> = ...
type EditableColumnId<TColumns> = ...
type ColumnValue<TColumns, TColumnId> = ...
```

Capabilities must remove columns from the corresponding models.

An action column with `sortable: false` must not appear in the sort model type.

## Typed filters

Filter operators should derive from the column value type.

```ts
type FilterFor<T> = T extends string
  ? StringFilter
  : T extends number
    ? NumberFilter<number>
    : T extends bigint
      ? NumberFilter<bigint>
      : T extends Date
        ? DateFilter
        : T extends boolean
          ? BooleanFilter
          : EqualityFilter<T>;
```

Examples:

```ts
type StringFilter =
  | { operator: "equals"; value: string }
  | { operator: "notEquals"; value: string }
  | { operator: "contains"; value: string }
  | { operator: "startsWith"; value: string }
  | { operator: "endsWith"; value: string }
  | { operator: "isEmpty" };

type NumberFilter<T extends number | bigint> =
  | { operator: "equals"; value: T }
  | { operator: "notEquals"; value: T }
  | { operator: "greaterThan"; value: T }
  | { operator: "greaterThanOrEqual"; value: T }
  | { operator: "lessThan"; value: T }
  | { operator: "lessThanOrEqual"; value: T }
  | { operator: "between"; min: T; max: T };
```

This must compile:

```ts
{
  columnId: "price",
  operator: "greaterThan",
  value: 100,
}
```

This must fail:

```ts
{
  columnId: "price",
  operator: "contains",
  value: "100",
}
```

## Typed editors

Editor configuration must match the column value.

```ts
type EditorFor<T> = T extends string
  ? TextEditorConfig<T> | SelectEditorConfig<T>
  : T extends number
    ? NumberEditorConfig
    : T extends bigint
      ? BigIntEditorConfig
      : T extends Date
        ? DateEditorConfig
        : T extends boolean
          ? CheckboxEditorConfig
          : CustomEditorConfig<T>;
```

A number column must reject a date editor.

A string-literal union select must reject options outside the union.

## Typed callbacks

For a price column:

```ts
column.field("price", {
  valueFormatter: ({ value, row }) => {
    // value: number
    // row: Order
    return value.toFixed(2);
  },

  editable: ({ row, value }) => {
    // value: number
    return row.status === "open";
  },
});
```

## Typed edit changes

Avoid this public shape:

```ts
type CellChange = {
  columnId: string;
  before: unknown;
  after: unknown;
};
```

Derive a discriminated union from the exact column tuple:

```ts
type CellChange<TColumns> = {
  [K in ColumnIdOf<TColumns>]: {
    rowId: string;
    columnId: K;
    before: ColumnValue<TColumns, K>;
    after: ColumnValue<TColumns, K>;
  };
}[ColumnIdOf<TColumns>];
```

## Typed conflicts

```ts
type CellConflict<TColumns> = {
  [K in ColumnIdOf<TColumns>]: {
    rowId: string;
    columnId: K;
    baseValue: ColumnValue<TColumns, K>;
    serverValue: ColumnValue<TColumns, K>;
    userValue: ColumnValue<TColumns, K>;
    baseVersion: string;
    serverVersion: string;
  };
}[ColumnIdOf<TColumns>];
```

## Server query types

Derive query types from the grid definition:

```ts
type ServerGridRequest<TGrid> = {
  startRow: number;
  endRow: number;
  sorting: SortModel<TGrid>;
  filters: FilterModel<TGrid>;
};
```

The datasource should be created through the grid definition:

```ts
const dataSource = ordersGrid.defineViewportDataSource({
  connect({ sink }) {
    // fully inferred
  },
});
```

Avoid forcing users to repeat:

```ts
ServerViewportDataSource<Order, OrdersQuery, OrderColumns>;
```

## Updates

Avoid exposing unrestricted `Partial<TRow>` as the primary typed update API.

Prefer typed field or column changes where possible.

Distinguish:

- complete row snapshots
- sparse positional rows
- identity-based value updates
- invalidations
- row moves
- row removals

The exact update union should preserve column/value correlation.

## Runtime validation

Compile-time types do not validate server responses.

The core should accept an optional generic decoder:

```ts
interface RowDecoder<TRow> {
  decode(input: unknown): TRow;
}
```

Provide adapters for:

- Effect Schema
- Zod
- Valibot
- custom decoders

Do not make a schema library mandatory.

## Type-level tests

Use `tsd`, `expect-type`, or equivalent compile-time tests for:

- valid and invalid field names
- accessor return inference
- filter operators
- filter value types
- editor types
- select options
- sort column IDs
- edit changes
- conflicts
- server requests
- disabled capabilities
- row-ID inference
- nested optional values
