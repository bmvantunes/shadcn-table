# TanStack Store vs XState for Editable Client Tables

## Status

Research and prototype verdict: 2026-08-05.

This note compares three different tools that are easy to conflate:

- TanStack Store, the signals-based reactive primitive used by TanStack Table v9;
- XState Store, the small event-based store from the XState project; and
- XState core, the state-machine and actor runtime for discrete workflows and asynchronous orchestration.

TanStack Table is pinned to stable [`9.0.0` at `d4d91a6`](https://github.com/TanStack/table/tree/d4d91a6cd6caa96b8d3bdb327b894b6125605350). The locally installed TanStack Store is `0.11.0`; the current XState Store documentation describes v4 and npm publishes `4.2.2` ([TanStack Store npm](https://www.npmjs.com/package/@tanstack/store), [XState Store npm](https://www.npmjs.com/package/@xstate/store)). The final ownership decision was exercised by the throwaway [edit/save reconciliation prototype](https://github.com/bmvantunes/shadcn-table/tree/8d3f734/packages/table/src/__prototype__/edit-save-reconciliation).

## Executive recommendation

Use the tools for different jobs rather than choosing one global state system:

| Owner                                       | Responsibility                                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Table and its TanStack Store atoms | Table-owned state: cell selection, sorting, filtering, column order, visibility, sizing, and pinning. Keep these implementation details private behind BrunoTable.                                        |
| BrunoTable-owned TanStack Store state       | The single React-observable memory seam for sparse drafts, validation, conflicts, bounded Batch History Commands, operation evidence, and compact workflow projections.                                   |
| XState core                                 | Private decision ownership for editor lifecycle, Immediate or Batch save legality, Promise settlement, live reconciliation, explicit resave, conflict resolution, dialog state, and failure notification. |
| Imperative geometry engine                  | Scroll, measurement, hit testing, live resize geometry, and pointer/drag previews. These do not belong in either store's React render path.                                                               |

Use a BrunoTable-owned TanStack Store deliberately rather than exposing TanStack Table's internal atoms as edit memory. It holds explicit sparse command stacks beside observable edit projections. Do not use XState Store as a second observable authority: its history helpers do not solve live-source rebasing, and independently observing it beside XState core would introduce a cross-runtime consistency seam. Full XState remains necessary because XState Store's own documentation directs complex state and orchestration to XState core ([XState Store overview](https://stately.ai/docs/xstate-store)).

This split is internal. BrunoTable consumers should not receive TanStack or XState objects in the public API.

## What TanStack's Spreadsheet example actually does

The TanStack Table v9 Spreadsheet example does support undo and redo, but the capability is not part of Table core and is not implemented with TanStack Store.

Its `useSpreadsheetHistory` hook uses a React reducer containing `rows`, `past`, and `future`. One `SpreadsheetCommand` contains an array of cell patches; executing a command clears the redo stack, undo applies each patch's `before` value, and redo applies its `after` value. History is capped at 100 commands ([local history hook](../../../.repos/table/examples/react/spreadsheet/src/useSpreadsheetHistory.ts#L8-L110), [official source](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/examples/react/spreadsheet/src/useSpreadsheetHistory.ts#L8-L110)). Applying a command copies the outer rows array and clones only affected rows, preserving unchanged row references ([local patch application](../../../.repos/table/examples/react/spreadsheet/src/useSpreadsheetHistory.ts#L113-L140)). The example's tests verify atomic cell-edit undo/redo ([local test](../../../.repos/table/examples/react/spreadsheet/tests/e2e/spreadsheet.spec.ts#L201-L215)).

TanStack React Store is used separately for the Table-owned cell-selection atom ([local Spreadsheet setup](../../../.repos/table/examples/react/spreadsheet/src/Spreadsheet.tsx#L163-L175)). The history hook's only state dependency is React itself. Therefore the lesson to copy is the command model—one logical user action containing all affected cell patches—not the example's particular React reducer.

For BrunoTable, a single edit, paste, fill, or targeted blocked-draft discard should produce one typed `applyCommand` event containing every patch. That gives one notification and one undo unit. XState Store's `getTransactionId` can group several events, but it is unnecessary when the command boundary is modeled correctly in the first place ([XState Store undo/redo transactions](https://stately.ai/docs/xstate-store/undo-redo#transactions)). V1 later chose not to expose a destructive cell Clear/Delete command at all.

## Why the two stores are not interchangeable

### TanStack Store

TanStack Store is a framework-independent signals implementation with stores, atoms, derived values, subscriptions, and explicit notification batching ([official quick start](https://tanstack.com/store/latest/docs/quick-start)). The installed `Store` API is essentially `setState`, `get`, and `subscribe` ([installed source](../../../node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/src/store.ts#L15-L57)). Its `batch` function defers subscriber flushing until the outer batch completes ([installed atom source](../../../node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/src/atom.ts#L60-L71)). That is notification batching, not an undo transaction.

The installed package contains no undo, redo, history, or transaction-history API. BrunoTable would have to maintain command history itself, as the Spreadsheet example does.

### XState Store

XState Store is a typed event-to-context store. Its first-party `undoRedo` extension offers two strategies that were considered but not selected:

- event history replays deterministic events from the initial snapshot;
- snapshot history stores past and future snapshots directly.

It also supports transaction identifiers, skipped events, snapshot deduplication, and a snapshot history limit ([official undo/redo documentation](https://stately.ai/docs/xstate-store/undo-redo)). Those conveniences do not define how a historical command restores a rebased Draft plus Conflict evidence after authoritative live publications.

XState Store transitions are still synchronous. Effects may perform asynchronous work, but their result must send a later event back to the store; the documentation explicitly preserves deterministic state changes around events ([XState Store effects](https://stately.ai/docs/xstate-store#effects)). This remains useful prior art, but BrunoTable keeps its explicit history transitions pure in TanStack Store state and never places `onSaveEdits` or other network effects inside replayable commands.

### XState core

Full XState models states, actors, and lifecycle. An invoked Promise actor has explicit resolution and rejection transitions, is stopped with the state that invoked it, and discards a settlement that arrives after that state is exited ([XState invoke documentation](https://stately.ai/docs/invoke)). Those are the required semantics for `saving`, Accepted Overlays awaiting live reconciliation, `saveFailed`, `conflicted`, explicit resave, dialog visibility, and similar workflows. A flat reactive store alone does not make illegal workflow combinations impossible.

## React Compiler and performance implications

Both store families can expose narrow React selectors with an equality function. TanStack React Store's installed `useSelector` is implemented with `useSyncExternalStoreWithSelector`, so a component rerenders only when its selected result changes ([installed React selector](../../../node_modules/.pnpm/@tanstack+react-store@0.11.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@tanstack/react-store/src/useSelector.ts#L19-L66)). XState Store React exposes a similar selector-and-compare boundary ([XState Store React](https://stately.ai/docs/xstate-store/react)), but BrunoTable deliberately exposes only TanStack Store projections to React.

XState actors are private decision owners. A Grid Command crosses the actor seam, the actor chooses the legal transition, and BrunoTable publishes the resulting compact observable state through its TanStack Store. No renderer subscribes directly to an actor or joins independently observed actor and store snapshots, so cells cannot see workflow state from one command and edit memory from another.

For TanStack-owned state, use `table.Subscribe`, the standalone `Subscribe`, or a narrowly selected atom. This is also a React Compiler correctness boundary: stable TanStack row, cell, header, and column objects can hide reactive getter reads from the compiler. TanStack documents explicit subscriptions for those nested renderer cases ([local Table state guide](../../../.repos/table/docs/framework/react/guide/table-state.md#L186-L243)). Keep that adapter private so BrunoTable renderers do not leak TanStack types.

For BrunoTable-owned edits, select the smallest useful immutable value, such as one draft/conflict/validation record by stable Cell Identity. A selector that returns the same reference must not rerender the cell. However, equality prevents rendering, not selector execution: every subscriber to one broad map source may still run its projection whenever that source notifies. Benchmark a single sparse map against row- or cell-partitioned atoms with realistic mounted row and column counts before freezing the store topology.

Prefer one command containing all patches for multi-cell operations. TanStack Store has explicit cross-update notification batching; XState Store does not document a general equivalent. A single command avoids several observable intermediate snapshots and matches the upstream example's atomic command design.

No store choice changes the high-frequency rule. Scroll, pointer movement, drag preview, measurement, and live resizing remain outside React state and are batched with `requestAnimationFrame`. Stores publish immutable snapshots only for UI that must render a durable state change.

## Prototype verdict for undo strategy

Do not select XState Store's default event-history strategy merely because it is the default.

Event replay is attractive when edit transitions are pure, deterministic, and based on a stable initial context. It becomes unsafe when authoritative row replacements, row-version changes, server canonicalization, validation results, or network effects are mixed into the same event log. Skipping such events from history does not automatically define how old edit commands rebase over the new authoritative base.

Snapshot history makes undo constant-work and supports a finite history limit, but snapshots can retain significant data. It is acceptable only if the history context is sparse and preserves immutable references; full client row datasets must not be duplicated into every history entry.

The prototype selected a small explicit bounded command stack in BrunoTable-owned TanStack Store state. One Batch History Command contains reversible sparse before-and-after edit state for every affected Cell Identity, including its Draft and Conflict evidence. Value-only patches fail when Mine rebases a Base without changing the presented value or Server removes a Draft; full-store snapshots retain too much unrelated state. Authoritative rows remain solely in the row store.

Live semantic convergence prunes the Cell Identity from both history stacks and removes empty commands. A zero-draft state may still contain Redo intent, so Edit Mode switching remains blocked until redo, a new command that clears future history, or Reset disposes of it.

Regardless of storage strategy, undo equality and patch coalescing must use the normalized column's Value Semantics. Formatted display text must never decide whether a draft or undo command is a no-op.

## Accepted save-boundary undo semantics

Batch mode owns undo and redo only inside the current unsaved batch. Save submits the remaining non-empty row-grouped Save Change Set. Promise resolution clears both history stacks immediately and converts submitted values to Accepted Overlays until the live Client Source reconciles them; a rejected Promise preserves every unconverged draft and history patch.

Immediate mode exposes no undo or redo. Once its Save Operation resolves, reversing that application-accepted mutation would require another explicit Save Operation rather than local history. This boundary keeps edit history and save orchestration under separate owners: BrunoTable-owned TanStack Store state applies or reverses pure Batch commands, while private XState core actors own Promise settlement, locks, Accepted Overlays, live reconciliation, failure notification, and explicit later Save attempts. Pending, awaiting-source, and rejected operation records retain immutable submitted evidence only while reconciliation or notification needs it; completed records are removed after bounded presentation cleanup.
