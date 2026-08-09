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

TanStack Table is pinned to v9 stable. Do not rely on remembered APIs or make assumptions based on earlier versions. Before designing or changing table behavior, verify the relevant implementation, types, tests, and recommended patterns in `.repos/table`, including its examples. Treat those examples as a primary implementation reference.

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

## Review convergence gate

Before opening or updating a pull request with repository changes, follow the local review loop in `docs/agents/code-review.md`:

1. Run three independent, read-only reviewers in parallel against one pinned merge base:
   - Standards and architecture
   - Specification and domain correctness
   - Verification, public API, and regression safety
2. Require every reviewer to label findings as blocking or non-blocking and to report explicit counts.
3. Fix every blocking finding, rerun the relevant validation, then restart all three reviewers from the updated diff.
4. Commit and push only after one complete round reports zero blockers from all three reviewers and required local checks pass.
5. Wait for required GitHub checks and GitHub Codex review. Treat pending review as incomplete work.
6. After any code or documentation change made for remote feedback, rerun local validation and the complete three-reviewer loop before pushing again.
7. Merge only when local reviewers, required checks, and required GitHub reviewers are clean.

Do not make review ceremonial. Every blocking finding needs concrete evidence, a repository rule or requirement it violates, and a smallest credible fix. Non-blocking suggestions do not prevent publication unless the user promotes them to requirements.

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
2. `getRowId` is mandatory for `BrunoTableClient` and forbidden for `BrunoTableServer`; every Server row identity comes authoritatively from the Viewport Source.
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
27. Immediate and Batch Edit Modes invoke the same `onSaveEdits` operation with a non-empty row-grouped Save Change Set and receive only `PromiseLike<void>`. Immediate mode preserves multi-cell paste and fill as one call; Batch mode sends accumulated net cell changes. Canonical values and Row Versions arrive only through the live Client Source.
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
40. Normal rows and grouped summaries own separate durable `orderBy` and `groupOrderBy` contexts. Grouping never rewrites normal sorting; grouped sorting admits only active keys, the reserved `COL_ID_BRUNO_TABLE_ROWS` System Column, and visible participating aggregates, and compiles aggregate targets through private aliases.
41. Client `getRowId` identifies raw `TRow` records only, while Client grouped summaries derive private identity from the complete group-key tuple. Server raw rows and grouped summaries both consume effect-view-server's authoritative viewport row key. Never expose Server `getRowId` or `getGroupedRowId`, never use row indexes as identity, and never reconstruct Server identity from result values.
42. effect-view-server is a first-party collaborating module. When BrunoTable needs missing source-owned semantics, change the upstream contract and require the compatible release; do not add consumer props, duplicate schema logic, reconstruct canonical values or keys, or ship weaker local fallbacks.
43. Aggregate Cells remain keyed by their originating Column Identity and retain their source `field`; private View Server aliases never cross the Adapter seam. Distinct columns may aggregate the same field when their `columnId` values differ.
44. Raw-row-aware `valueFormatter`, conditional `cellClassName`, and `cellRenderer` callbacks never receive fabricated grouped rows. Aggregate Cells use compiled aggregate-result Value Type presentation by default and optional typed `aggregateValueFormatter`, `aggregateCellClassName`, and `aggregateCellRenderer` overrides whose context contains no raw `TRow` or sibling Group Key evidence.
45. Group Key Cells use compiled field Value Type presentation by default and optional typed `groupKeyValueFormatter`, `groupKeyCellClassName`, and `groupKeyCellRenderer` overrides. Their column-level context contains the exact field value, owning Column Identity, and row count, but no raw `TRow` or sibling Group Key evidence. Exact ordered Group Key evidence may be exposed only at a table-bound seam that owns the actual Column tuple.
46. Group Key presentation overrides require `groupBy: true`; Aggregate presentation overrides require a valid `aggFunc`. Helpers and presets preserve their exact callback types without widening to `unknown`.
47. The Rows System Column has fixed identity `COL_ID_BRUNO_TABLE_ROWS`, exact `bigint` value semantics, and no field, filter, hide, or edit capability. Optional `groupRowsColumn` configuration changes only its label, baseline width, and presentation.
48. A committed user resize of Rows persists under its reserved identity and remains dormant while ungrouped. A valid persisted width wins over the `groupRowsColumn` baseline, while Rows never enters base column order, visibility, or pinning preferences.
49. Grouping and aggregation are Read-only Table capabilities. `BrunoTableServer` always qualifies; `BrunoTableClient` qualifies only when `editable` is false or omitted. An Editable Table installs no grouping feature, UI, command, grouped row model, or aggregate execution.
50. Shared columns may declare `isEditable`, `groupBy`, and `aggFunc` for reuse across Table Instances, but one instance never activates editing and grouping together. Editable Client props reject `groupRowsColumn`, and restoration drops Group By state, grouped sorting, and Rows width conservatively.
51. Row Selection represents ordinary Client source Row Identities only. Activating the first Group By key atomically clears selected IDs and the Shift anchor; grouped views expose no row checkbox, header Select All, group-selection command, selected-row count, or hidden dormant selection. Ungrouping restores an empty Row Selection capability.
52. A grouped read-only Client retains one-axis Cell Range Selection and copy over its complete resident grouped result. Every Group By add, remove, or reorder cancels an active range gesture and clears the previous range before changing row/column shape; a fresh grouped range is copy-only. Server Tables remain Active-Cell-only.
53. Every Group By add, remove, or reorder resets the logical Active Cell after deriving the new projection: row zero plus its first visible navigable Logical Column, or no Active Cell for an empty result. Never infer raw-to-group focus correspondence, persist the coordinate, or steal DOM focus from the initiating Group By control.
54. A Client Cell Range retains the exact ordered Row and Column Identity span selected by the user. Value-only publications preserve it. Sorting, filtering, live data, or column-structure changes clear it before Copy only when an endpoint disappears or the identities covered between its endpoints change; never silently retarget stable corners across a different span.
55. Copy is atomic. One Copy command captures one immutable Clipboard Snapshot containing its validated identities and canonical values, finishes serialization from only that snapshot, and submits the already-finalized payload to the browser. Live publications during serialization or the asynchronous clipboard write may update the grid but never mix versions inside the payload.
56. With an unchanged Group By tuple, live grouped updates reconcile Active Cell by Group Row Identity first and do not auto-reveal moves. If that identity disappears, target the new row at its previous display index, clamped to the last row, and retain its Column Identity when valid; clear only when no grouped rows remain.
57. A semantic View Server query change starts a clean Query Generation: release the old generation, invalidate its rows and total, render fixed-height loading rows for the new projection, and ignore late old deliveries. Window-only movement stays inside the generation, retains overlapping slots, and loads only missing indexes. Same-generation stale/error lifecycle may retain its last coherent rows.
58. Group By never requires drag-and-drop. Eligible inactive columns are addable through an Add Group combobox and column-menu command; active chips expose Remove and scoped `Alt+ArrowLeft/Right` reorder commands with accessible position announcements. Pointer drag dispatches the same commands, and no keyboard pickup/drop mode exists.
59. Source lifecycle presentation is persistent and source-authoritative. Loading uses fixed-height skeleton rows; stale, closed, and error states retain same-generation rows when available and otherwise use shared status or empty-state chrome. A manual Retry control exists only when the source supplies an optional Source Retry Capability; BrunoTable never invents, schedules, awaits, or interprets reconnect work.
60. Each Save Change Set is a non-empty tuple of row changes. Every row change carries `rowId`, the safely rebased `baseRow`, its exact `expectedVersion`, and a non-empty cell-change tuple; every cell change preserves exact `columnId`, `field`, `before`, and `after` correlation. It contains no projected after-row or UI-origin metadata.
61. Save preflight may rebase a dirty row to the latest live Row Version only after every edited field remains semantically equal to its recorded base. Any edited-field divergence enters Conflict Review; the application compare-and-set remains the final race authority.
62. Promise resolution creates Accepted Overlays and a two-second success flash but no canonical result. An overlay has no timeout and yields when its submitted value converges, its opaque Row Version differs from `expectedVersion`, or the row authoritatively disappears. Promise rejection uses an ordinary safe `Error` explanation; later complete live convergence supersedes the ambiguous failure.
63. Immediate mode deliberately permits concurrent operations over disjoint Cell Identities, locks only operation-owned cells, and accepts same-row compare-and-set rejection as the cost of aggressive editing. Resolved Immediate cells unlock per row as live confirmation arrives. Batch Save globally locks edit mutations until every submitted row reconciles after resolution; rejection unlocks while preserving unconverged drafts and history. Non-editing interactions remain enabled in both modes.
64. XState actors are private workflow brains, never React subscription sources. Every actor decision publishes one coherent observable projection through BrunoTable-owned TanStack Store state; renderers subscribe only to the smallest store projection they need and never combine actor and store snapshots.
65. Batch undo/redo records one bounded command per user gesture using reversible sparse cell-state patches that include Draft and Conflict evidence, not value-only pairs or full-row snapshots. Live convergence prunes that Cell Identity from both history stacks, and mode switching remains blocked while either stack contains edit-owned work.
66. Save-operation records are bounded. Pending, awaiting-source, and rejected operations retain only the immutable submitted evidence needed for reconciliation; completed records are removed after their flash or notification lifecycle rather than accumulating for the Table Instance lifetime.
67. Keep columns as one plain array checked with `satisfies BrunoTableColumns<TRow>`. Global `BrunoTable...Column` helpers infer the row from that outer context; do not add a row-bound helper factory or repeated row generic. Raw Field Columns remain valid, while strict Computed Columns use a global Value Type helper or equivalently typed custom constructor so their non-empty `fields` tuple restricts `valueGetter.row` to the corresponding `Pick`.
68. The renderer has one native two-axis scroll owner. Virtualize rows and centre columns, keep start/end columns in separate mounted sticky regions while pinning is active, and reveal a keyboard destination with the minimum geometry delta after active pinned/header insets; do not use nearest-index scrolling or a second Scroll Area viewport. Before measurement, any layout with pinned columns suspends pinning into one bounded start → centre → end virtual window with zero pinned insets. After measurement, suspension continues while a mixed layout would leave less than 80 CSS pixels for its centre region or while a centreless pinned layout exceeds the viewport; restore sticky regions automatically when the active pinned layout fits.
69. The View Server Adapter owns semantic Query Generation. Use `viewport.replace` only for meaningful Feed Route, projection, filter, sort, grouping, or aggregate changes; use `generation.setWindow` for scroll/reveal movement, retain only same-generation overlap, and never treat `setRowCount` lifecycle hints as generation authority.
70. Empty Set Filter inclusion intent means Match None for current and future values. Compile it through a source-native Match-None Filter Expression; do not enumerate or negate the current facet domain and do not rely on an empty `in` form that the source normalizes away.
71. Editable Client Tables use one persistent full-width Edit Safety Footer with compact status controls at the start and Reset/Save at the end. Complete sparse edit collections belong in on-demand live reviews, not a permanent side ledger or bottom inspector. Persistent notifications must expose an assistive-technology-accessible Close control.

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
  - bounded sparse Batch history and save-operation evidence
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
