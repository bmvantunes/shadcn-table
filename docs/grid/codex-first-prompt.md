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
- mandatory `getRowId`
- mandatory stable column IDs
- React Compiler support
- horizontal and vertical virtualization
- pinned columns in one logical navigation order
- 120 Hz interaction target on capable hardware
- first-class keyboard navigation
- client and server viewport row models
- preference persistence limited to filters, sorting, and column layout
- no persistence of scroll, viewport, selection, or transient interaction state
- no top-level React state updates for every scroll or server batch
- strong TypeScript inference without public `any`
