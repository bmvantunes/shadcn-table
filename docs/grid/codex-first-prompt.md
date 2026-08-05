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
- Column Identity-keyed Aggregate Cells that may share a source field, never expose private aggregate aliases, and use typed aggregate presentation callbacks without fabricated raw rows
- half-open `inRange` parity between Client and Server Tables
- typed Row Version kept separate from the Viewport Source Query Version for optimistic saves
- preference persistence limited to filters, sorting, and column layout
- no persistence of scroll, viewport, selection, or transient interaction state
- no top-level React state updates for every scroll or server batch
- strong TypeScript inference without public `any`
- full strict TypeScript checks, including exact optional properties and unchecked indexed access
- positive and negative type tests plus emitted-package consumer tests for every public inference guarantee
- if BrunoTable needs source-owned semantics missing from effect-view-server, fix the upstream contract and require the compatible release instead of adding a consumer workaround or reconstructing canonical source data
