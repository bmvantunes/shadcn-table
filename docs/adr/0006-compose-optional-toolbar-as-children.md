# Compose an optional toolbar as children

`BrunoTableClient` and `BrunoTableServer` accept optional children rendered in a grid-owned toolbar region. Pages compose arbitrary controls inside `BrunoTableToolbar`, while BrunoTable-owned filter, editing, and layout controls consume narrow private context subscriptions; the library does not grow page-specific boolean props or expose its TanStack instance.

The toolbar is absent when no children are supplied and augments rather than replaces the global filter/sort rail, overlays, or editable safety footer. Rendering location does not determine state ownership: Grid Filters and the Quick Filter are grid intent, while application-owned Source Constraints remain outside persisted grid preferences.
