# Use canonical clipboard text by default

BrunoTable copies canonical, locale-independent, round-trippable text by default. `valueFormatter` remains Cell Presentation and does not silently become clipboard serialization. A column may opt into display-formatted clipboard text only by declaring an explicit paired clipboard formatter and parser, or by selecting a custom Value Type whose compiled Column Value Semantics provides the equivalent reversible exchange capability.

This intentionally differs from AG Grid's default of applying the value formatter during copy and expecting a value parser during paste. The deviation protects exact `bigint`, Effect BigDecimal, localized numbers, currency, accounting negatives, and arbitrary custom presentation from silent precision loss or irreversible text conversion. For example, a cell displayed as `(5.5)` copies as canonical `-5.5` unless its column explicitly provides a reversible accounting-format clipboard pair.

## Consequences

- Native `bigint` and BigDecimal values never pass through JavaScript `number` during clipboard exchange.
- Copy, paste, fill, parsing, and semantic equality reuse the compiled Column Value Semantics rather than guessing from display text.
- `valueFormatter` can remain row-aware and visually expressive without being required to parse in reverse.
- Formatted clipboard exchange is available, but its reversibility is explicit and testable.
- V1 exposes no Cut or destructive cell Clear/Delete capability and registers no `Ctrl/Cmd+X`, `Delete`, or `Backspace` mutation handler. A value changes only through an editor or explicit paste transaction.
- A 1×1 clipboard source may broadcast along a selected Linear Cell Range. A supported `1×N` or `N×1` source proceeds directly only into the same axis and length; any other supported linear destination requires explicit confirmation of one described source-oriented range. A clipboard matrix with both dimensions greater than one is rejected.
- A multi-cell paste parses and validates the complete linear candidate set before applying one atomic gesture; one invalid target applies nothing.
- Clipboard tests cover exact values beyond `Number.MAX_SAFE_INTEGER`, BigDecimal scale variants, localized formatting, accounting negatives, and custom paired exchange.
