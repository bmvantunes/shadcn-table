# `@bruno/table`

The React data-grid package for BrunoTable.

The public interface is intentionally small and BrunoTable-owned. TanStack Table, virtualization,
stores, and server-query translation are private implementation details.

The initial package slice establishes the strict TypeScript contracts for columns, client sources,
server viewport sources, filters, sorts, and the two explicit composition roots:
`BrunoTableClient` and `BrunoTableServer`.

Both roots present one continuous virtual row space. BrunoTable exposes no pagination state or
controls: the Client Table virtualizes its complete processed dataset, while the Server Table loads
the indexed viewport window required by the current scroll position.

Both roots also accept optional children for page-specific toolbar composition. When no children are
provided, BrunoTable renders no toolbar region.
