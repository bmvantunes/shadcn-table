# Expose client and viewport table variants

BrunoTable exposes `BrunoTableClient` and `BrunoTableViewport` instead of one public component with a row-model mode or a union of incompatible source props. Both variants use the same columns, interaction model, renderer, and grid-state interface, while each installs a distinct row-pipeline Adapter for local processing or sparse server ownership. This keeps consumer intent explicit and prevents row-model conditionals from spreading through shared UI code.

## Consequences

- `BrunoTableClient` receives one complete `clientSource` containing rows and lifecycle state, and performs filtering and sorting locally.
- effect-view-server's `LiveQueryResult` satisfies the Client Source structurally; BrunoTable does not import Effect or require consumers to spread lifecycle fields into separate props.
- A ready or stale Client Source whose `rows.length` differs from `totalRows` is incomplete and cannot safely claim whole-dataset client operations.
- `BrunoTableViewport` receives a long-lived `viewportSource` and delegates filtering, sorting, row count, and range loading to the server.
- Shared filter and sort UI dispatches the same grid commands in both variants; the installed row-pipeline Adapter decides how those commands affect rows.
- A shared internal renderer consumes a stable grid-runtime interface and does not branch on a client-versus-viewport flag.
