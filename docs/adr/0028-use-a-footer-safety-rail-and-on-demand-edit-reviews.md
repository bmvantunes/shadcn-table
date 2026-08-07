# Use a footer safety rail and on-demand edit reviews

Editable Client Tables use one persistent full-width Edit Safety Footer as their default edit
chrome. Compact status controls sit at the start; Reset and Save sit at the end. Complete change,
conflict, validation, blocked, and operation collections do not occupy a permanent side ledger or
bottom inspector. They open as on-demand live review surfaces.

Conflict Review and Reset Review are read-only internal `BrunoTableClient` instances so they can
reuse the source table's compiled heterogeneous Cell Presentation. Preserve the grid's horizontal
and vertical row budgets for its primary data surface. An application-specific optional inspector
may be composed later, but it is not required V1 chrome and cannot replace the footer's safety
actions.

This decision is validated by the
[editable safety UI prototype](../grid/research/editable-safety-ui-prototype.md).
