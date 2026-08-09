# `@bruno/table`

The React data-grid package for BrunoTable.

The public interface is intentionally small and BrunoTable-owned. TanStack Table, virtualization,
stores, and server-query translation are private implementation details.

The package establishes strict TypeScript contracts for columns, client sources, server viewport
sources, filters, sorts, and the `BrunoTableClient` composition root. `BrunoTableClient` is the
first live read-only Client renderer; the Server composition root remains future work.

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

Effect BigDecimal support is isolated behind the optional entry point. Applications that use it
install the compatible Effect peer and import only that subpath:

```tsx
import * as BigDecimal from "effect/BigDecimal";
import { BrunoTableBigDecimalColumn, BrunoTableBigDecimalValueType } from "@bruno/table/effect";
import type { BrunoTableColumns } from "@bruno/table";

type PriceRow = { readonly price: BigDecimal.BigDecimal };

const columns = [
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    aggFunc: "sum",
    aggregateValueFormatter: ({ value }) => BigDecimal.format(value),
  }),
] satisfies BrunoTableColumns<PriceRow>;

void BrunoTableBigDecimalValueType;
```

The BigDecimal Value Type keeps canonical text, persisted operands, equality, and ordering exact. It
accepts only effect-view-server-compatible wire-safe values, treats differently scaled
representations as equal, and never compares by aligning scales through a power of ten. Importing
`@bruno/table` does not import or require Effect; `effect@4.0.0-beta.100` is an optional peer used
only by `@bruno/table/effect`. The integration is built against the public, versioned
`effect-view-server@2.3.0/value-semantics` contract. Admitted cross-bundle wire values are copied
into owned local BigDecimals and receive opaque source-owned comparison metadata before BrunoTable
exposes the full Effect value type. That focused runtime is inlined into `@bruno/table/effect`;
applications do not install effect-view-server merely to use BigDecimal columns. BigDecimal columns
support `countDistinct`, `sum`, `min`, `max`, and
`avg`; aggregate callbacks receive the exact result (`bigint` for `countDistinct`, BigDecimal for
the others), owning Column Identity, aggregate function, and row count, but never sibling Group Key
evidence or a fabricated raw source row.
`sum` and `avg` are intentionally unavailable for optional or nullable fields because the View
Server rejects those aggregate domains; `min` and `max` preserve the field's nullish result type.
Canonical and persisted BigDecimal text is rejected above 4,096 UTF-16 code units before parsing,
which bounds synchronous coefficient work on browser input paths.

Raw field definitions remain fully supported for grouping and aggregation. A raw custom Value Type
must structurally declare the selected function in `aggregateResults`; unsupported pairs fail both
TypeScript and runtime normalization. BrunoTable's optional typed Column Helpers provide the same
ordinary definitions with contextual callback inference and reusable defaults.

The private column compiler already converts a stable definition array into one frozen, trusted
Field-or-Computed representation and rejects malformed widened input. The first runtime root is
owned by issue #7 and must install that compiler once when constructing or replacing its definition
set; issue #3 deliberately exposes no consumer-side grid-definition or compilation API.

The Client renderer uses one continuous virtual row space, one native scroll owner, and no pagination
state or controls. Server-side runtime virtualization remains planned backlog work.

The Client root accepts optional children for page-specific toolbar composition; absent children do
not reserve vertical space.

## Application styles

Import the canonical shadcn stylesheet once from an application CSS entry point, include the
installed table bundle as a Tailwind source, and enable the Tailwind Vite plugin in the application
build:

```css
@import "@bruno/shadcn/styles.css";

@source "../node_modules/@bruno/table/dist";
```

```ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [tailwindcss()] });
```

The stylesheet owns BrunoTable's shared design tokens, while the explicit source directive emits
the utilities used by BrunoTable's renderer. The table package does not inject global CSS at
runtime.
