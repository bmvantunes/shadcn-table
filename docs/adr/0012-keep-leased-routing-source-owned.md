# Keep leased routing source-owned

The effect-view-server leased-source declaration is the single authority for its non-empty exact Route Field tuple. BrunoTable does not duplicate that list in columns or a `routeByFields` prop; `BrunoTableServer` accepts only the current exact Feed Route value object inferred from its Viewport Source and forwards the snapshotted route unchanged in every viewport replacement. This preserves effect-view-server's required/forbidden and all-and-only field guarantees without confusing routing with filtering, projection, or persisted grid intent.

## Consequences

- Leased topics require `routeBy` with every source-declared field and exact row-field value type; materialized and source-free topics forbid it.
- Route Fields need not be visible, selected, filterable, or represented by BrunoTable columns.
- Feed Route values are application state and are never inferred from Grid Filters, Set Filters, External Filters, or loaded rows.
- A meaningful Feed Route change replaces the logical indexed row space, releases the prior generation, clears sparse and transient row-space state, and retains compatible user preferences.
- Exact route snapshotting and comparison stay in the effect-view-server Adapter so native `bigint`, BigDecimal, and other admitted values are not coerced or compared by object identity.
