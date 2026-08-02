# Provide typed column helpers and reusable presets

BrunoTable provides optional `BrunoTable...Column` helpers for standard value families and lets applications specialize them into reusable Column Presets. Helpers own coherent rendering, layout, editor, filter, clipboard, accessibility, and styling defaults but produce ordinary column definitions that pass through the same normalization path as raw configuration. Raw configuration remains fully supported; it declares an explicit runtime `valueType`, while helpers supply that declaration without sampling rows.

This chooses direct, TypeScript-native constructors over an AG Grid-style string registry. It preserves literal `columnId`, `field`, row, and value inference; keeps factories stable at module scope; and prevents shared conventions from becoming copied CSS and callbacks across many tables. Helpers and presets never generate Column Identity or infer server mappings.

## Consequences

- Core provides at least text, number, bigint, boolean, and select helpers; the optional Effect entry point provides BigDecimal helpers without making Effect a root dependency.
- Standard helpers encode semantic layout defaults: text cells are start-aligned, numeric values and editors are end-aligned, checkboxes are centered, and select editors fill the available cell width.
- Reusable preset defaults may include `headerName`, Value Type options, formatting, width, alignment, editor, filter, validation, and presentation configuration.
- Merge precedence is deterministic: built-in helper defaults, then Column Preset defaults, then individual column options.
- Individual columns retain fully typed `valueFormatter`, conditional cell-class, and custom cell-renderer escape hatches.
- Cell Presentation never changes equality, ordering, parsing, clipboard exchange, persistence, conflicts, or server operands. Custom round-trippable display text requires a paired parser/exchange capability or custom Value Type.
- Helper construction and preset specialization happen outside React render and add no per-cell dispatch or registry lookup.
