# Require explicit namespaced column identity

BrunoTable requires a stable `columnId` on every leaf column, typed as `` `COL_ID_${ColumnIdFirstCharacter}${Uppercase<string>}` ``, where `ColumnIdFirstCharacter` is an ASCII uppercase letter, decimal digit, or underscore. The required first character makes the suffix non-empty. BrunoTable never derives identity from `field`, a header, or array position. All grid state and persisted user intent use `columnId`; server Adapters resolve it through current column definitions to row fields when compiling queries. The explicit namespace makes identifiers conspicuous and searchable while preventing accidental row-field names from leaking into saved layouts, filters, sorts, edits, conflicts, and navigation.

## Consequences

- Duplicate `columnId` values are configuration errors and must fail during table construction.
- Lowercase or unprefixed column identities fail at compile time for literals and at runtime for external values.
- A `field` identifies row data and default query semantics, not the column.
- A `valueGetter`-only column has no automatic server filter or sort capability.
- Backend field renames can preserve user intent when `columnId` and the column's meaning remain stable.
