# BrunoTable Grid

BrunoTable is a strongly typed, desktop-class data grid whose user preferences and interactions remain stable across rendering, virtualization, and server-backed data.

## Identity and columns

**Table Identity**:
The required stable `tableId` that namespaces one table's persisted preferences and diagnostics.
_Avoid_: Optional table name, display title

**Column Identity**:
The required stable `columnId` that identifies one grid column within a Table Identity. It uses the `COL_ID_${UPPERCASE_NAME}` namespace, is independent of headers and row fields, and is never inferred.
_Avoid_: Field name as identity, header-derived ID, generated column ID

**Field Column**:
A column whose value comes directly from a named row field. Its `field` is the default data and server-query mapping, while its Column Identity remains `columnId`.
_Avoid_: Accessor column, field ID

**Computed Column**:
A column whose value is produced by `valueGetter` rather than a named row field. It has no automatic server filter or sort semantics.
_Avoid_: Field column, implicitly queryable column

**Grid Filter Expression**:
A filter expression whose leaves refer to Column Identity. It is persisted as user intent and translated through current column definitions before reaching a server.
_Avoid_: View Server filter, field-keyed persisted filter

**Quick Filter**:
A grid-owned free-text filter applied across explicitly eligible columns. It is part of grid filter intent, not an application data-scope constraint.
_Avoid_: TanStack global filter, Source Constraint, page search

**Query Field**:
A row field or supported field path understood by a server query language. A Query Field is resolved from a column definition and is never used as persisted Column Identity.
_Avoid_: Column Identity, column ID

## Integration

**Client Table**:
The BrunoTable variant that receives a Client Source and owns filtering and sorting locally.
_Avoid_: Client mode, local flag

**Client Source**:
The current complete row collection together with its loading, freshness, failure, row-count, and version state.
_Avoid_: Row array, individual lifecycle props, Effect result

**Server Table**:
The `BrunoTableServer` variant that represents a sparse indexed row space while a server owns filtering, sorting, and row position.
_Avoid_: Viewport Table, server mode, viewport flag, paginated table

**Viewport Source**:
The long-lived server-viewport input passed to a Server Table. It represents typed query replacement, sparse row delivery, total-row state, and lifecycle for one logical indexed row space.
_Avoid_: Row array, page datasource, paginated result

**Source Constraint**:
An application-owned condition that defines which rows belong to a table's working set before user grid filters are applied. It is not a persisted grid preference and cannot be cleared by BrunoTable's filter controls.
_Avoid_: Grid Filter Expression, Quick Filter, security rule

**Continuous Row Space**:
The uninterrupted vertical row sequence presented by both Client and Server Tables. It may be fully materialized or sparsely loaded, but the user never navigates pages.
_Avoid_: Paginated rows, page index, load-more list

**View Server Translation**:
The Adapter that resolves Column Identity to current Query Fields and compiles grid filters, sorts, and projections into effect-view-server queries.
_Avoid_: Sending column IDs as fields, adopting the View Server query language as persisted grid state

## Interaction

**Logical Column Order**:
The single navigable order formed by pinned-start columns, centre columns, and pinned-end columns. Pinning changes presentation regions, not keyboard adjacency.
_Avoid_: DOM order, separate pinned navigation loops

**Cell Edit Session**:
The transient interaction in which one editable cell owns an active editor and candidate value.
_Avoid_: Save workflow, server mutation

**Cell Edit Commit**:
Acceptance of the active editor's parsed and validated value into BrunoTable's sparse draft and edit transaction. It does not by itself mean that the value was saved to the server.
_Avoid_: Submit, server save, blur side effect

**Save Workflow**:
The process that sends committed drafts to the server, applies optimistic-concurrency results, and enters conflict resolution when canonical server values diverge.
_Avoid_: Cell Edit Commit, editor close
