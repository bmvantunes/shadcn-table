---
name: define-columns
description: >
  Define strongly typed BrunoTable columns, Value Types, helpers, presets, filters, sorting, grouping,
  and presentation callbacks. Load when creating or changing a BrunoTable column tuple or when
  TypeScript inference, Column Identity, exact numeric behavior, or customization precedence matters.
metadata:
  type: core
  library: "@bruno/table"
  library_version: "0.0.0"
  skill_version: "1.0.0"
sources:
  - "bmvantunes/shadcn-table:packages/table/README.md"
  - "bmvantunes/shadcn-table:docs/grid/public-api-design.md"
  - "bmvantunes/shadcn-table:docs/grid/research/reui-data-grid-patterns.md"
  - "bmvantunes/shadcn-table:docs/grid/research/strict-column-api-prototype.md"
  - "bmvantunes/shadcn-table:docs/adr/0001-require-explicit-column-identity.md"
---

# Define BrunoTable columns

Keep one plain `columns` tuple and check it with `satisfies BrunoTableColumns<TRow>`. Every leaf
column needs an explicit stable `columnId`, a non-empty `headerName`, and runtime `valueType` evidence
for raw values. Use the exported `BrunoTable...Column` helpers when their built-in semantics fit; they
return ordinary definitions and infer `TRow` from the outer tuple.

```tsx
const columns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
  }),
  BrunoTableBigIntColumn({
    columnId: "COL_ID_BALANCE",
    field: "balance",
    headerName: "Balance",
    enableSorting: true,
  }),
] satisfies BrunoTableColumns<AccountRow>;
```

## Invariants

- Column Identity is durable intent. Never derive it from `field`, headers, array positions, or a
  generated value. Renaming a backend field may retain the identity only when meaning stays stable.
  Identities must be unique and start with `COL_ID_`, followed by a non-empty suffix whose first
  character is an ASCII uppercase letter, decimal digit, or underscore and whose remainder satisfies
  TypeScript's `Uppercase<string>` constraint. Validate widened/external strings with the same grammar.
- `COL_ID_BRUNO_TABLE_ROWS` is reserved for the generated exact-`bigint` Rows System Column; consumer
  definitions cannot claim it. Read-only Tables customize only its label, baseline width, and
  presentation through `groupRowsColumn`, never its identity or capabilities.
- Keep `number`, `bigint`, and BigDecimal separate. Never route `bigint` or BigDecimal through
  JavaScript `number` for comparison, display, clipboard, persistence, or edits.
  Compile Value Semantics once from explicit column metadata, never sampled rows; Client exact-numeric
  filtering and sorting use explicit exact functions, not TanStack automatic numeric/object inference.
- Import `BrunoTableBigDecimalColumn` and `BrunoTableBigDecimalValueType` from
  `@bruno/table/effect`, not the root, and install the compatible optional
  `effect@4.0.0-rc.111` peer. The root remains usable without Effect.
- Formatting and styling are presentation only. They never redefine equality, ordering, parsing,
  clipboard exchange, conflicts, or persisted operands.
  Round-trippable custom text requires an explicit paired parser/exchange capability or custom
  Value Type with coherent canonical formatting, parsing, and exchange; `valueFormatter` is never
  assumed reversible.
- Built-in helper defaults apply first, reusable preset defaults second, and individual column
  options last.
- Raw Field Columns declare `field` and `valueType`. Strict Computed Columns declare a non-empty
  `fields` dependency tuple and are not filterable, sortable, or editable in V1.
- Group Key presentation requires `groupBy: true`; Aggregate presentation requires a valid
  `aggFunc`. Their callbacks never receive a fabricated raw row.
  Each Aggregate Cell retains its originating `columnId` and source `field`; two columns over one
  field remain distinct. Map private View Server aliases back at the Adapter seam—never expose them
  to rendering, callback contexts, sorting intent, or persistence.

## Sorting and filtering

Every public Table is always sorted. Supply a non-empty `initialOrderBy` whose identities are
sortable members of the tuple. Do not add an unsorted state. Grid Filter state is internally owned;
`initialFilters` is a one-time baseline, while Server-only application constraints are External
Filters. The `inRange` interval is half-open: `filter <= value < filterTo`.

Grouped summaries use a separate durable `groupOrderBy`; grouping never rewrites normal `orderBy`.
Admit only active group keys, Rows, and visible participating aggregates. Sanitize invalid targets
while preserving surviving priorities; on first grouping or when none survive, sort every active
group key ascending in Group By order. Clearing grouping restores untouched normal sorting and
retains grouped intent dormant for a compatible future grouping.

Custom Value Types use a stable domain-specific `codecId` and explicit `codecVersion` for persisted
operands. Bump the version deliberately when the persisted format or its semantic interpretation
changes; do not reinterpret old operands under a reused codec identity/version. `encodePersisted`
must produce JSON-safe evidence, and `decodePersisted` must reject malformed or incompatible values
conservatively. Restoration drops stale, unknown, or incompatible operands rather than guessing
their domain or coercing exact values.

For complete definitions and callback types, consult the current package README and public API
design cited in `sources`; do not substitute remembered TanStack Table v8 shapes.

Before changing column normalization, presentation, grouping, or query translation, read the matching
sections of the bundled [public API design](../references/docs/grid/public-api-design.md): “Mandatory
column identity”, “Value Types, Column Helpers, and Column Presets”, “Column kinds” (including “Column
Value Semantics” and “Computed columns”), “Grouping and aggregation column capabilities”, or “View
Server translation”. The entry-point invariants do not replace those complete
contracts or the [package examples](../references/packages/table/README.md).
