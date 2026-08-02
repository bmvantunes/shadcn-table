# `@bruno/table`

The React data-grid package for BrunoTable.

The public interface is intentionally small and BrunoTable-owned. TanStack Table, virtualization,
stores, and server-query translation are private implementation details.

The initial package slice establishes the strict TypeScript contracts for columns, client sources,
server viewport sources, filters, sorts, and the two explicit composition roots:
`BrunoTableClient` and `BrunoTableServer`.
