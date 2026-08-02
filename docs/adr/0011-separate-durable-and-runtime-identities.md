# Separate durable identity from runtime instance identity

BrunoTable keeps Table Identity (`tableId`) and Column Identity (`columnId`) as stable serializable strings because they key persisted user intent and must survive reloads, SSR and worker boundaries, diagnostics, storage Adapters, and database records. JavaScript Symbols are rejected for these public identities: a unique Symbol solves only in-memory collision and cannot reproduce a durable key. Each mounted table runtime instead receives a private Symbol-backed Table Instance Identity, so simultaneous instances have collision-free ownership while compatible instances may intentionally share one Table Identity and its preferences.

## Consequences

- A stable column-definition set is compiled and validated once during table-runtime construction; duplicate `columnId` values fail before TanStack Table or persistence restoration can observe them.
- React renders, cell renders, row updates, and interactions never rescan the column array for duplicate identities. A genuinely replacement definition set is compiled and validated once before installation.
- Development diagnostics report simultaneous reuse of one `tableId` with incompatible column schemas. Compatible instances may deliberately reuse the same `tableId`; their private Table Instance Identities remain distinct.
- Durable identities remain readable, searchable, JSON-safe, and suitable for versioned persisted formats.
