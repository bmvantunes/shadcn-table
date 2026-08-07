# `@bruno/table`

The React data-grid package for BrunoTable.

The public interface is intentionally small and BrunoTable-owned. TanStack Table, virtualization,
stores, and server-query translation are private implementation details.

The initial package slice establishes strict TypeScript contracts for columns, client sources,
server viewport sources, filters, sorts, and the future `BrunoTableClient` and `BrunoTableServer`
composition roots. Runtime table components are not exported yet.

The private column compiler already converts a stable definition array into one frozen, trusted
Field-or-Computed representation and rejects malformed widened input. The first runtime root is
owned by issue #7 and must install that compiler once when constructing or replacing its definition
set; issue #3 deliberately exposes no consumer-side grid-definition or compilation API.

The contracts reserve one continuous virtual row space and expose no pagination state or controls.
Runtime virtualization for Client and Server Tables remains planned backlog work.

The future roots' prop contracts accept optional children for page-specific toolbar composition.
Runtime toolbar rendering remains planned backlog work.
