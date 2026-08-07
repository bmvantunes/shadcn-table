# `@bruno/table`

The React data-grid package for BrunoTable.

The public interface is intentionally small and BrunoTable-owned. TanStack Table, virtualization,
stores, and server-query translation are private implementation details.

The package establishes strict TypeScript contracts for columns, client sources, server viewport
sources, filters, sorts, and the future `BrunoTableClient` and `BrunoTableServer` composition roots.
Runtime table components are not exported yet.

Use one plain column array with `satisfies`. Optional helpers supply coherent exact value semantics
and presentation defaults without generating identity or hiding the resulting column definition:

```tsx
import {
  BrunoTableBigIntColumn,
  BrunoTableNumberColumn,
  BrunoTableSelectColumn,
  BrunoTableTextColumn,
  type BrunoTableColumns,
} from "@bruno/table";

type Order = {
  readonly symbol: string;
  readonly price: number;
  readonly quantity: bigint;
  readonly status: "open" | "closed";
};

const priceColumn = BrunoTableNumberColumn.withDefaults({
  headerName: "Price",
  width: 112,
  format: { minimumFractionDigits: 2 },
});

const columns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
  }),
  priceColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    width: 144,
  }),
  BrunoTableBigIntColumn({
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
  }),
  BrunoTableSelectColumn({
    columnId: "COL_ID_STATUS",
    field: "status",
    headerName: "Status",
    options: ["open", "closed"],
  }),
] satisfies BrunoTableColumns<Order>;
```

Helper precedence is built-in defaults, reusable preset defaults, then individual column options.
Display callbacks such as `valueFormatter`, `cellClassName`, and `cellRenderer` do not change exact
equality, sorting, clipboard text, parsing, persistence, or conflict comparison. Custom exact domains
use an explicit `BrunoTableValueType` with paired canonical text and persistence codecs.

The private column compiler already converts a stable definition array into one frozen, trusted
Field-or-Computed representation and rejects malformed widened input. The first runtime root is
owned by issue #7 and must install that compiler once when constructing or replacing its definition
set; issue #3 deliberately exposes no consumer-side grid-definition or compilation API.

The contracts reserve one continuous virtual row space and expose no pagination state or controls.
Runtime virtualization for Client and Server Tables remains planned backlog work.

The future roots' prop contracts accept optional children for page-specific toolbar composition.
Runtime toolbar rendering remains planned backlog work.
