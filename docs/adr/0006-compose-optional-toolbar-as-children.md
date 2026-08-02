# Compose an optional toolbar as children

`BrunoTableClient` and `BrunoTableServer` accept optional children rendered in a grid-owned toolbar region. Pages compose arbitrary controls inside `BrunoTableToolbar`, while BrunoTable-owned filter, editing, and layout controls consume narrow private context subscriptions; the library does not grow page-specific boolean props or expose its TanStack instance.

The toolbar is absent when no children are supplied and augments rather than replaces the global filter/sort rail, overlays, or editable safety footer. Rendering location does not determine state ownership: Grid Filters and the Quick Filter are grid intent, while application-owned Source Constraints remain outside persisted grid preferences.

BrunoTable-owned toolbar controls may read and change semantic grid state through private, capability-specific subscriptions and commands. Each control selects only what it renders—for example result-row count, loaded-row count, active filters, active sorts, selected-row count, dirty-cell count, or conflict count. TanStack's stores, atoms, and `Subscribe` components remain implementation details; arbitrary consumer children do not receive a TanStack instance or become broad grid subscribers.

Controls that only issue commands do not subscribe at all. In particular, the Quick Filter input keeps its transient keystroke buffer locally and dispatches filter commands through a stable dispatcher; it may subscribe only to the committed Quick Filter value when it must reflect an external reset or restored view. Reactive sources are partitioned by capability so a hot row-record update does not even notify unrelated toolbar selectors.
