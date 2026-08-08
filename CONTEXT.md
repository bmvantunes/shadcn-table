# BrunoTable Grid

BrunoTable is a strongly typed, desktop-class data grid whose user preferences and interactions remain stable across rendering, virtualization, and server-backed data.

## Identity and columns

**Table Identity**:
The required stable, serializable `tableId` that identifies one logical table definition and namespaces its persisted preferences and diagnostics.
_Avoid_: Table Instance Identity, optional table name, display title, Symbol

**Table Instance Identity**:
The private transient identity of one mounted table runtime. It distinguishes simultaneous instances without becoming persisted user intent.
_Avoid_: Table Identity, persistence key

**Persisted Grid Preferences**:
A versioned, JSON-safe snapshot of one Table Identity's Grid Filter Expressions, normal sorting, ordered Group By intent, grouped sorting, column order, visibility, widths, and pinning. BrunoTable accepts an optional one-time initial snapshot and emits a complete replacement snapshot through `onPersistChange` after every committed preference change. The application owns storage and transport.
_Avoid_: Quick Filter, External Filter, Feed Route, edit state, built-in storage adapter, React-controlled table state

**Column Identity**:
The required stable, serializable `columnId` that identifies one grid column within a Table Identity. It uses the `COL_ID_${UPPERCASE_NAME}` namespace, is independent of headers and row fields, and is never inferred.
_Avoid_: Field name as identity, header-derived ID, generated column ID, Symbol

**Field Column**:
A column whose value comes directly from a named row field. Its `field` is the default data and server-query mapping, while its Column Identity remains `columnId`.
_Avoid_: Accessor column, field ID

**Computed Column**:
A column whose value is produced by `valueGetter` from an explicit non-empty `fields` dependency tuple rather than one direct row field. The tuple limits what the getter can read and supplies Server Table projection dependencies. A Computed Column is never filterable, sortable, or editable in V1.
_Avoid_: Field column, implicit dependency discovery, queryable column, editable derived value

**Group Key Cell**:
A grouped-summary cell that presents one active Group By field's exact value through its originating Column Identity. It represents a group key rather than any source row.
_Avoid_: Raw row cell, representative row, fabricated source row

**Group By Region**:
The accessible table-owned control surface containing the ordered active Group Key columns. Its add, remove, and reorder commands are authoritative; drag-and-drop is only one optional way to invoke them.
_Avoid_: Drop zone, drag-only grouping, grouped column order

**Aggregate Cell**:
A grouped-summary cell produced by one Field Column's `aggFunc`. It retains that column's Column Identity and source-field meaning while presenting the aggregate result; multiple Aggregate Cells may use one source field when their Column Identities differ.
_Avoid_: Renamed result field, public aggregate alias, fabricated source row

**Rows System Column**:
The BrunoTable-owned grouped-summary column whose exact `bigint` value is the count of filtered source rows represented by one group. Its reserved Column Identity remains stable when callers customize its label or presentation.
_Avoid_: Consumer Field Column, aggregate alias, configurable identity, ordinary row-count field

**Value Type**:
The explicit runtime category or custom descriptor that selects one column's value behavior. A raw value-bearing column declares it directly, while a Column Helper supplies it.
_Avoid_: Sampled data type, TypeScript-only field type, column style

**Column Value Semantics**:
The stable rules that define equality, ordering, canonical text, and persisted identity for one column's values. Visual formatting may present those values differently without changing their meaning.
_Avoid_: Value formatter, sampled data type, JavaScript coercion

**Column Helper**:
An optional typed constructor for a standard column family such as text, number, bigint, boolean, select, or BigDecimal. It supplies coherent behavior and presentation defaults while producing an ordinary column definition.
_Avoid_: Required builder, string column type, generated column identity

**Column Preset**:
A reusable specialization of a Column Helper that captures application-wide domain conventions such as Price formatting, title, width, alignment, editor, and filter defaults.
_Avoid_: Copied column configuration, global mutable defaults, string preset registry

**Cell Presentation**:
The visible text, styling, and rendered content of a cell. It may vary without changing the cell's underlying value or Column Value Semantics.
_Avoid_: Cell value, persisted value, query operand

**Exact Numeric Domain**:
One numeric domain whose values and operands remain `number`, `bigint`, or BigDecimal throughout a grid operation. Different numeric domains are never mixed implicitly.
_Avoid_: Numeric-like value, number coercion, mixed numeric domain

**Grid Filter Expression**:
A filter expression whose leaves refer to Column Identity. It is persisted as user intent and translated through current column definitions before reaching a server.
_Avoid_: View Server filter, field-keyed persisted filter

**Quick Filter**:
A grid-owned free-text filter applied with `contains` across an explicit non-empty tuple of string-valued Query Fields supplied through `quickFilterFields`. Those fields combine with `OR`; the resulting expression combines with External Filters and Grid Filters through `AND`. Both its field configuration and committed text are session-only and never persisted.
_Avoid_: TanStack global filter, External Filter, page search, Column Identity list, automatically inferred text fields

**Initial Grid Filters**:
The optional one-time Grid Filter Expression baseline for a new Table Instance. Valid persisted user filters take precedence when restored; later prop changes do not overwrite user intent. Clearing removes all Grid Filters, while resetting returns to this baseline.
_Avoid_: Controlled filters, External Filter, mandatory filter, reactive prop synchronization

**Initial Order By**:
The non-empty `initialOrderBy` baseline for a sorting-capable Table Instance. The first live `BrunoTableClient` from issue #7 requires this baseline unconditionally and therefore rejects a Client definition with no sortable Column Identity. The broader common and Server design remains conditional: when no sorting capability is installed, that variant forbids `initialOrderBy` and owns no normal sorting state. Entries use Column Identity and admit only `asc` or `desc`; each `columnId` is inferred as the exact union of sortable identities from the table's `columns` tuple, providing autocomplete and compile-time rejection of unknown or nonsortable columns. A valid non-empty persisted `orderBy` takes precedence during restoration; later prop changes do not overwrite user intent, and resetting sorting returns to this baseline. Active sorting ranges from one entry through every sortable column and never reaches zero.
_Avoid_: Empty sorting in a sorting-capable table, sorting state in a sort-free table, Query Field identity, reactive prop synchronization, descending-first inference

**Set Filter**:
A Grid Filter surface for choosing one or more exact scalar values through the `in` operator. Boolean and Select Field Columns use it by default; Text, Number, BigInt, and BigDecimal Field Columns require explicit opt-in because their distinct-value cardinality may be unbounded. While open, its values and counts remain live under every other active constraint and filter.
_Avoid_: Feed Route selector, static option snapshot, loaded-window facet, always-on high-cardinality query

**Match-None Filter Expression**:
The exact server-query meaning of explicit Set Filter inclusion intent containing no values. It matches no current or future row until the user changes that filter intent.
_Avoid_: Empty `in` no-op, negation of current facet values, enumerated future domain

**Query Field**:
A row field or supported field path understood by a server query language. A Query Field is resolved from a column definition and is never used as persisted Column Identity.
_Avoid_: Column Identity, column ID

## Integration

**Client Table**:
The BrunoTable variant that receives a Client Source and owns filtering and sorting locally. A Client Table may be read-only or may install the Editable Table capability.
_Avoid_: Client mode, local flag

**Client Source**:
The current complete row collection together with its loading, freshness, failure, row-count, and version state.
_Avoid_: Row array, individual lifecycle props, Effect result

**Source Retry Capability**:
An optional source-owned manual recovery command together with its current pending state. A table may present this capability while the source is closed or errored, but never invents, schedules, or interprets reconnect work.
_Avoid_: Automatic retry, save retry, table-owned reconnect policy

**Server Table**:
The read-only `BrunoTableServer` variant that represents a sparse indexed row space while a server owns filtering, sorting, grouping, and row position. It exposes one Active Cell rather than Cell Range Selection.
_Avoid_: Viewport Table, server mode, viewport flag, paginated table

**Viewport Source**:
The long-lived server-viewport input passed to a Server Table. It represents typed query replacement, sparse row delivery, total-row state, and lifecycle for one logical indexed row space.
_Avoid_: Row array, page datasource, paginated result

**Query Version**:
The revision of one live query result stream or snapshot. It describes the read model as a whole and is not a concurrency token for any row.
_Avoid_: Row Version, expected version

**Query Generation**:
One logical indexed row space produced by one semantically stable View Server query. Changing routing, projection, filtering, ordering, grouping, or aggregation creates a new generation, while moving its viewport window does not.
_Avoid_: Query Version, viewport window, page

**Row Version**:
The row-specific token extracted by an Editable Table's mandatory `getRowVersion` function and compared atomically by a Save Operation before applying a mutation. It retains its inferred source type and is independent of Query Version.
_Avoid_: Query Version, viewport version, hard-coded string revision

**External Filter**:
An application-controlled, field-keyed condition passed through a Server Table's `externalFilters` prop and applied before user Grid Filter Expressions. External Filters are reactive, never persisted, never included in BrunoTable's active-filter count, and cannot be changed or cleared by BrunoTable controls.
_Avoid_: Grid Filter Expression, Quick Filter, security rule, `externalWhere`

**Route Field**:
One source-declared row field that participates in the exact address of an upstream leased feed. The complete non-empty Route Field tuple belongs to the source definition.
_Avoid_: Grid Filter field, visible column, duplicated table configuration

**Feed Route**:
The application-supplied object containing values for all and only the Route Fields of one leased source. It selects the upstream feed before External Filters or Grid Filter Expressions are applied.
_Avoid_: Grid Filter Expression, External Filter, selected column values

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

**Active Cell**:
The single logical body cell in the current row-and-column projection that receives keyboard navigation and single-cell commands. Within one row domain it follows a surviving Row Identity and uses a deterministic display-position fallback only when that identity disappears; it is never translated between ordinary and grouped row domains and does not imply Cell Range Selection or Row Selection.
_Avoid_: Selected range, selected row

**Active Cell Reveal**:
The operation that minimally scrolls the shared virtualized row and column space until the logical Active Cell can be rendered. Reveal never changes the cell's identity or turns navigation into pagination.
_Avoid_: Page navigation, DOM focus search, selection reset

**Row Selection**:
An optional Client Table intent keyed to ordinary source Row Identities. It never selects grouped summaries or implies selection of the source rows represented by a group.
_Avoid_: Group selection, Cell Range Selection, Active Cell

**Cell Range Selection**:
One contiguous one-axis cell intent used for multi-cell clipboard and, in an Editable Table, editing operations. It owns the exact ordered Row and Column Identity span selected by the user, may contain ordinary or grouped Client cells, and is either horizontal (`1×N`) or vertical (`N×1`). Value-only change does not retarget it, and a Server Table never creates it from its Active Cell.
_Avoid_: Rectangular selection, matrix selection, two-dimensional range, Active Cell, Row Selection

**Clipboard Snapshot**:
The immutable identities and canonical cell values captured by one accepted Copy command. One snapshot produces one internally consistent clipboard payload even while live table values continue changing.
_Avoid_: Live clipboard view, streaming copy

**Drag Fill**:
A Client gesture that extends an Active Cell or Linear Cell Range along one axis by repeating its exact source sequence. It never infers increments, trends, dates, or arithmetic series.
_Avoid_: Autofill, series fill, increment fill

**Cell Edit Session**:
The transient interaction in which one editable cell owns an active editor and candidate value.
_Avoid_: Save workflow, server mutation

**Cell Edit Commit**:
Acceptance of the active editor's parsed and validated value into BrunoTable's sparse draft and edit transaction. It does not by itself mean that the value was saved to the server.
_Avoid_: Submit, server save, blur side effect

**Save Workflow**:
The process that sends committed drafts through a Save Operation, coordinates Promise settlement and live-source reconciliation, and enters conflict resolution when canonical server values diverge.
_Avoid_: Cell Edit Commit, editor close

**Editable Table**:
A Client Table whose grid-level editing capability is enabled and whose definitions include at least one potentially editable column. Individual cell eligibility remains subject to its column policy, and grouping is unavailable for the complete Table Instance.
_Avoid_: Editable column, always-editable table

**Read-only Table**:
A Table Instance without the Editable Table capability. It is the only Table Instance that may activate grouping and aggregation; every Server Table is read-only, while a Client Table is read-only when `editable` is false or omitted.
_Avoid_: Server Table, disabled cell, read-only column

**Edit Mode**:
The current save-timing policy for an Editable Table: Immediate saves each committed edit transaction, while Batch accumulates net changes until Save.
_Avoid_: Cell Edit Session, Save Change Set

**Save Change Set**:
A non-empty atomic request that groups net cell changes by their source rows. It may contain one or many rows and cells in either Edit Mode.
_Avoid_: Raw edit history, one-change-only callback

**Batch History Command**:
A reversible user gesture within the current unsaved Batch that retains every affected cell's complete before-and-after editing state. Value changes and conflict resolutions each remain one undo unit regardless of cell count.
_Avoid_: Value-only undo entry, source-row snapshot, save payload

**Save Operation**:
The application-provided asynchronous operation that accepts one Save Change Set and resolves or rejects as a whole. Current canonical values and Row Versions arrive through the live Client Source rather than an operation result.
_Avoid_: Preference persistence, Save-button click handler, Cell Edit Commit

**Accepted Overlay**:
The temporary submitted-value projection retained after a Save Operation resolves and before the live Client Source reconciles that row. It is presentation evidence, not a draft or canonical server state.
_Avoid_: Optimistic draft, save result, server row

**Edit Safety Footer**:
The persistent full-width bottom safety rail that exposes compact pending-edit, conflict, validation, blocked, and Save Operation status together with Reset and Save intentions. Complete sparse collections open in on-demand reviews so the footer never becomes a permanent side ledger or bottom inspector.
_Avoid_: Page toolbar, layout reset controls, permanent change ledger

**Conflict Review**:
The read-only comparison workflow where the user reviews Base, Server Now, and Yours for each genuine conflict and chooses a resolution.
_Avoid_: Editable nested table, two-way overwrite prompt
