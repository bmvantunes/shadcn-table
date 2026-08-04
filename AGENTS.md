<!-- intent-skills:start -->

## Skill Loading

Before editing files for a substantial task:

- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

## Agent skills

### Issue tracker

Issues, specifications, and Wayfinder maps live in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses one BrunoTable domain context rooted at `CONTEXT.md`, with architectural decisions under `docs/adr/`. See `docs/agents/domain.md`.

## Vendored Source Repositories

Source repositories used for implementation research live under `.repos/` as Git submodules:

- `.repos/ag-grid` contains the AG Grid source from `git@github.com:ag-grid/ag-grid.git`.
- `.repos/table` contains the TanStack Table source from `git@github.com:TanStack/table.git`.

TanStack Table is tracking v9, which is still in beta. Do not rely on remembered APIs or make assumptions based on earlier versions. Before designing or changing table behavior, verify the relevant implementation, types, tests, and recommended patterns in `.repos/table`, including its examples. Treat those examples as a primary implementation reference.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Project intent

Build a high-performance, strongly typed, AG Grid-class data grid for React.

The grid must support:

- React Compiler
- 120 Hz interaction targets on capable hardware
- horizontal and vertical virtualization
- pinned columns
- client and server viewport row models
- editable and read-only grids
- batch editing with conflict detection and resolution
- first-class keyboard navigation
- persistent grid preferences
- excellent TypeScript inference
- pluggable capabilities and policies

## Non-negotiable constraints

1. `tableId` is mandatory.
2. `getRowId` is mandatory.
3. Every column has a stable explicit identity.
4. Row indexes are positions, never identities.
5. Persist user preferences only:
   - filters
   - sorting
   - ordered grouping
   - column order
   - column visibility
   - column widths
   - column pinning
6. Do not persist:
   - scroll position
   - loaded blocks
   - pagination or viewport position
   - focused or selected cells
   - open menus
   - drag state
   - transient validation state
7. Keyboard navigation is core infrastructure, not an optional feature.
8. Pinned columns must participate in one logical column order.
9. Header and body navigation must form one coherent navigation space.
10. No top-level React state update for every scroll, pointer move, row update, or server batch.
11. Keep geometry, scrolling, measurement, and hit-testing outside React state.
12. Use immutable snapshots and fine-grained subscriptions at React boundaries.
13. Keep unchanged row references stable; replace references only for changed rows.
14. Avoid `any` in public APIs and inference paths.
15. Do not make Effect mandatory for grid consumers.
16. Use XState for discrete interaction workflows, not raw high-frequency geometry.
17. Fixed row height is the default and initial server-viewport fast path.
18. React Compiler incompatibilities must be isolated behind small adapter boundaries.
19. Every persisted format is versioned and sanitized against current column definitions.
20. Any server-side mutation must use stable row identity and optimistic concurrency.
21. Every BrunoTable-owned public export carries the `BrunoTable` brand. Exported types, components, classes, helpers, and constants use `BrunoTable...`; unprefixed grid symbols remain internal.
22. The `@bruno/shadcn` package preserves canonical shadcn export names such as `Button` and exposes components through direct subpaths such as `@bruno/shadcn/button`.
23. Both public table variants expose one continuous virtual row space. Do not expose pagination state or controls, and do not register TanStack's row-pagination feature.
24. Page-specific table controls compose through optional toolbar children. Do not add page-specific `show...` props, expose a broad table controller, or leak TanStack context.
25. Command-only controls have zero grid-state subscriptions. Partition reactive notification sources so hot row updates do not wake unrelated toolbar, status, filter, preference, or edit subscribers.
26. Grid editing is a strict discriminated capability: `editable: true` requires `onSaveEdits`; false or omitted editing rejects edit-only props. Column `isEditable` policies identify potentially editable columns and decide exact cell eligibility.
27. Immediate and Batch Edit Modes invoke the same `onSaveEdits` operation with a non-empty Save Change Set. Immediate mode preserves multi-cell paste, fill, and clear as one call; Batch mode sends accumulated net cell changes.
28. The end user owns Edit Mode through BrunoTable's toggle; consumers cannot set a default or controlled mode prop. The toggle uses static column capability, never an all-row scan, and unresolved conflicts enter the same workflow from Save or the conflict-count control.
29. Keep `number`, `bigint`, and BigDecimal as separate exact numeric domains. Never coerce `bigint` or BigDecimal through JavaScript `number` for rendering, editing, filtering, sorting, clipboard, persistence, saves, or conflicts.
30. Compile explicit Column Value Semantics once during column normalization. Do not sample rows to discover exact value kinds, and do not use TanStack automatic filter or sort functions for exact numeric columns.
31. Native `bigint` semantics belong to BrunoTable core. Effect `BigDecimal` support belongs to an optional entry point or Adapter; the root package and its declarations remain usable without Effect installed.
32. Runtime filter state keeps native exact operands. Persist exact operands only through tagged, versioned, JSON-safe column codecs and drop stale or invalid operands conservatively.
33. `inRange` is half-open in both Client and Server Tables: `filter <= value < filterTo`.
34. Query Version and Row Version are distinct. Never use a Viewport Source's top-level version as optimistic concurrency, and never implement `onSaveEdits` with an unconditional server patch.
35. Every leaf column has an explicit non-empty `headerName`. It is the default visible and accessible header label, never identity, persistence, or query mapping, and is not inferred.
36. Every raw value-bearing column declares an explicit runtime `valueType`; built-in Column Helpers supply it. TypeScript field types are not runtime metadata, and neither table variant samples rows to infer value behavior.
37. BrunoTable provides optional typed `BrunoTable...Column` helpers and reusable presets for coherent rendering, layout, editing, filtering, clipboard, and styling defaults. Helpers return ordinary column definitions, never generate `columnId`, and never become a string-keyed registry.
38. Column customization precedence is built-in helper defaults, then reusable preset defaults, then individual column options. Typed `valueFormatter`, conditional cell styling, and custom cell rendering remain available at the individual column level.
39. Display formatting and styling never redefine value equality, ordering, parsing, clipboard exchange, persistence, conflicts, or server query operands. Round-trippable custom text requires an explicit paired parser/exchange capability or custom Value Type.

## Preferred technology split

- TanStack Table v9:
  - column semantics
  - table state primitives
  - sorting/filtering configuration
  - header groups
  - column sizing, visibility, order, and pinning
- TanStack Virtual or a custom adapter:
  - vertical and horizontal virtualization
  - isolated from React Compiler if required
- XState:
  - cell editing lifecycle
  - drag selection
  - drag fill
  - column drag and resize workflows
  - conflict resolution
  - save workflow
- External stores:
  - row store
  - grid preferences
  - sparse drafts
  - sparse conflicts
  - validation state
- Effect:
  - optional data-source/RPC adapter
  - schemas and transport boundaries
  - not rendering, measurement, or per-cell hot paths

## Performance rules

Target 120 Hz for:

- scrolling
- column resize
- column reorder
- range selection
- drag fill preview
- keyboard navigation

A 120 Hz frame budget is 8.33 ms. During active interaction:

- keep grid JavaScript work well below the full frame budget
- batch pointer and scroll work with `requestAnimationFrame`
- use transforms for animated motion
- avoid full-grid rerenders
- avoid full-row rerenders for isolated cell changes where profiling proves it matters
- cap mounted rows and columns through two-axis virtualization
- benchmark realistic workloads, not toy examples

## Working rules for Codex

Before implementing a major subsystem:

1. Read all documents under `docs/grid/`.
2. Inspect the existing repository.
3. Identify conflicts between the repository and these documents.
4. Produce a brief implementation plan.
5. Prefer a small vertical slice over broad scaffolding.
6. Add type-level tests for inference-heavy APIs.
7. Add behavioural tests for navigation and interaction state.
8. Add performance instrumentation for virtualization and updates.
9. Do not silently weaken requirements to simplify implementation.
10. Document any architectural deviation.
