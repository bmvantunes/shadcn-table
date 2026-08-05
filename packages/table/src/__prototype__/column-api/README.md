# BrunoTable column API prototype

Throwaway prototype branch: `codex/prototype-column-api`.

## Question

Can BrunoTable keep the desired AG Grid-like consumer shape—one plain column array using optional global helpers—while TypeScript strictly enforces Column Identity, field/value compatibility, row-aware callbacks, computed dependencies, preset precedence, editability, Row Version, and the atomic save payload without leaking TanStack types?

Run it from the workspace root:

```sh
vp run @bruno/table#prototype:column-api
```

The command first compiles the accepted and deliberately rejected type examples, then opens a small terminal viewer. Press `1` through `5` to inspect the normalized columns, preset layers, computed projection, atomic save shape, and compiler contract.

## Scope

This prototype intentionally covers the hard inference seam, not the complete production column model. It exercises text, number, bigint, boolean, one number preset, computed fields, and editable save correlation. Select columns, custom Value Types, grouping presentation, and the optional Effect BigDecimal entry point can apply the same result after the public construction shape is accepted.

No prototype symbol is exported from `@bruno/table`, and none of this code belongs on the main branch.

## Observed answer

Yes. The installed TypeScript 7 compiler propagates the outer `satisfies BrunoTableColumns<Order>` context into global helper calls, including row-aware callbacks, so the canonical API does not need a row-bound helper factory or repeated `<Order>` generic. A helper overload can infer a Computed Column's non-empty `fields` tuple directly and restrict `valueGetter.row` to the corresponding `Pick`.

Helpers and `withDefaults` presets return ordinary definitions. One construction-time merge produces the final semantic layout and formatting plan in built-in → preset → individual order. The typed tuple then derives editable identities and correlates each save cell's Column Identity, source field, and exact value domain; `getRowVersion` supplies the exact Row Version type to the non-empty row-grouped Save Change Set.

The compiler cannot prove that runtime column arrays contain no duplicate identities, so one-time column compilation still performs that validation before TanStack or persistence sees the definitions.
