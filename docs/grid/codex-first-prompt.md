# First Codex prompt

Read `AGENTS.md` and every document under `docs/grid/`.

This repository is intended to contain a strongly typed AG Grid-style data grid built around TanStack Table v9, React Compiler, XState, two-axis virtualization, client and server viewport row models, batch editing, conflict resolution, persistent user preferences, and first-class keyboard navigation.

Do not implement anything yet.

First:

1. Inspect the existing repository and identify relevant packages, conventions, constraints, and existing abstractions.
2. Review the proposed architecture critically.
3. Identify contradictions, underspecified APIs, React Compiler risks, virtualization risks, performance risks, and TypeScript inference problems.
4. Produce a phased implementation plan with dependency order.
5. Propose the smallest vertical slice that validates the architecture without prematurely building every feature.
6. Sketch the public TypeScript API for that slice.
7. List required type-level tests, behavioural tests, accessibility tests, and performance benchmarks.
8. Recommend package boundaries.
9. Call out any decision that should be captured as an ADR.

Treat the documents as the current product direction, not infallible implementation details.

Challenge details where necessary, but preserve these hard requirements:

- mandatory `tableId`
- mandatory Client `getRowId`; Server rejects it and consumes authoritative raw and grouped row keys from its Viewport Source
- mandatory explicit `columnId` on every leaf column, typed as `` `COL_ID_${Uppercase<string>}` ``, with no inferred identities
- mandatory explicit non-empty `headerName` on every leaf column, used as the default visible and accessible label but never as identity or query mapping
- mandatory explicit runtime `valueType` for raw value-bearing columns, with no row sampling
- optional first-class typed `BrunoTable...Column` helpers and reusable presets that return ordinary definitions, preserve strict inference, and keep individual formatting/styling/rendering escape hatches
- every BrunoTable-owned public export carries the `BrunoTable` prefix; for example, `BrunoTableColumnId`, `BrunoTableRegion`, and `BrunoTableSortBy`
- explicit `BrunoTableClient` and `BrunoTableServer` public variants over a shared internal grid runtime and renderer
- React Compiler support
- horizontal and vertical virtualization
- pinned columns in one logical navigation order
- 120 Hz interaction target on capable hardware
- first-class keyboard navigation
- client and server viewport row models
- explicit compiled Column Value Semantics for exact `bigint` and optional Effect BigDecimal support, with no `number` coercion or row sampling
- Column Identity-keyed Group Key and Aggregate Cells that never fabricate raw rows; Aggregate Cells may share a source field, never expose private aliases, and both cell kinds provide typed grouped-presentation escape hatches
- one fixed-identity exact-`bigint` Rows System Column while grouped, with optional `groupRowsColumn` label, baseline-width, and presentation configuration plus reserved-identity width persistence
- grouping and aggregation only on Read-only Table Instances: always available to eligible Server Tables and available to Client Tables only when `editable` is false or omitted
- Row Selection only for ordinary ungrouped Client rows; entering Group By clears selected Row Identities and the Shift anchor, and grouped summaries never acquire row checkboxes, Select All, or implicit leaf selection
- one-axis Cell Range Selection and copy remain available over complete resident grouped Client results, with every Group By shape change clearing the previous range first; Server Tables remain Active-Cell-only
- Client Cell Ranges preserve their exact ordered identity span across value-only publications and survive structural changes only when that full span remains equal; stale corners clear before Copy instead of silently selecting different cells
- every Copy command captures one immutable Clipboard Snapshot and serializes only that version, so live updates can never produce a half-old/half-new payload
- deterministic Active Cell reset after every Group By add, remove, or reorder: row zero and the first visible column in the new projection, with no raw/group focus mapping or DOM-focus theft
- identity-first Active Cell reconciliation for live grouped updates inside an unchanged Group By tuple, with no auto-reveal and a clamped previous-index fallback only when the active group disappears
- clean loading rows for every semantic View Server Query Generation change, never old rows under new route/filter/sort/projection/group/aggregate semantics; window-only movement retains overlapping slots and same-generation lifecycle may retain coherent rows
- source-authoritative lifecycle chrome built from shared shadcn Skeleton, Alert, Empty, Button, and Spinner components; manual Retry appears only for closed/error sources that explicitly supply a run command plus pending state, with no invented or automatic retries
- Group By is fully operable without drag-and-drop through Add Group, column-menu actions, explicit chip removal, and scoped `Alt+ArrowLeft/Right` reorder with focus retention and accessible position announcements; pointer drag dispatches the same commands
- half-open `inRange` parity between Client and Server Tables
- typed Row Version kept separate from the Viewport Source Query Version for optimistic saves
- preference persistence limited to filters, sorting, and column layout
- no persistence of scroll, viewport, selection, or transient interaction state
- no top-level React state updates for every scroll or server batch
- strong TypeScript inference without public `any`
- full strict TypeScript checks, including exact optional properties and unchecked indexed access
- positive and negative type tests plus emitted-package consumer tests for every public inference guarantee
- if BrunoTable needs source-owned semantics missing from effect-view-server, fix the upstream contract and require the compatible release instead of adding a consumer workaround or reconstructing canonical source data
