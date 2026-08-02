# TanStack Store vs XState for Editable Client Tables

## Status

Research snapshot: 2026-08-02.

This note compares three different tools that are easy to conflate:

- TanStack Store, the signals-based reactive primitive used by TanStack Table v9;
- XState Store, the small event-based store from the XState project; and
- XState core, the state-machine and actor runtime for discrete workflows and asynchronous orchestration.

The recommendation is provisional only where post-save undo semantics remain a product decision. TanStack Table is pinned to [`9.0.0-beta.74` at `1b70a17`](https://github.com/TanStack/table/tree/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7). The locally installed TanStack Store is `0.11.0`; the current XState Store documentation describes v4 and npm publishes `4.2.2` ([TanStack Store npm](https://www.npmjs.com/package/@tanstack/store), [XState Store npm](https://www.npmjs.com/package/@xstate/store)).

## Executive recommendation

Use the tools for different jobs rather than choosing one global state system:

| Owner                                       | Responsibility                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Table and its TanStack Store atoms | Table-owned state: cell selection, sorting, filtering, column order, visibility, sizing, and pinning. Keep these implementation details private behind BrunoTable.        |
| XState Store                                | BrunoTable-owned, pure, sparse edit data: drafts, validation results, conflicts, and atomic edit commands with bounded undo/redo history.                                 |
| XState core                                 | Discrete workflows: editor lifecycle, Immediate or Batch save legality, asynchronous save, retry, conflict resolution, dialog state, and persistent failure notification. |
| Imperative geometry engine                  | Scroll, measurement, hit testing, live resize geometry, and pointer/drag previews. These do not belong in either store's React render path.                               |

Do not add a second BrunoTable-owned TanStack Store merely to imitate TanStack's spreadsheet history example. TanStack Table already owns its table-state atoms. XState Store is a better semantic fit for BrunoTable edit commands because it is event based and has a first-party undo/redo extension. Full XState remains necessary because XState Store's own documentation directs complex state and orchestration to XState core ([XState Store overview](https://stately.ai/docs/xstate-store)).

This split is internal. BrunoTable consumers should not receive TanStack or XState objects in the public API.

## What TanStack's Spreadsheet example actually does

The TanStack Table v9 Spreadsheet example does support undo and redo, but the capability is not part of Table core and is not implemented with TanStack Store.

Its `useSpreadsheetHistory` hook uses a React reducer containing `rows`, `past`, and `future`. One `SpreadsheetCommand` contains an array of cell patches; executing a command clears the redo stack, undo applies each patch's `before` value, and redo applies its `after` value. History is capped at 100 commands ([local history hook](../../../.repos/table/examples/react/spreadsheet/src/useSpreadsheetHistory.ts#L8-L110), [official source](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/examples/react/spreadsheet/src/useSpreadsheetHistory.ts#L8-L110)). Applying a command copies the outer rows array and clones only affected rows, preserving unchanged row references ([local patch application](../../../.repos/table/examples/react/spreadsheet/src/useSpreadsheetHistory.ts#L113-L140)). The example's tests verify atomic cell-edit undo/redo ([local test](../../../.repos/table/examples/react/spreadsheet/tests/e2e/spreadsheet.spec.ts#L201-L215)).

TanStack React Store is used separately for the Table-owned cell-selection atom ([local Spreadsheet setup](../../../.repos/table/examples/react/spreadsheet/src/Spreadsheet.tsx#L163-L175)). The history hook's only state dependency is React itself. Therefore the lesson to copy is the command model—one logical user action containing all affected cell patches—not the example's particular React reducer.

For BrunoTable, a single edit, paste, fill, or clear should produce one typed `applyCommand` event containing every patch. That gives one notification and one undo unit. XState Store's `getTransactionId` can group several events, but it is unnecessary when the command boundary is modeled correctly in the first place ([XState Store undo/redo transactions](https://stately.ai/docs/xstate-store/undo-redo#transactions)).

## Why the two stores are not interchangeable

### TanStack Store

TanStack Store is a framework-independent signals implementation with stores, atoms, derived values, subscriptions, and explicit notification batching ([official quick start](https://tanstack.com/store/latest/docs/quick-start)). The installed `Store` API is essentially `setState`, `get`, and `subscribe` ([installed source](../../../node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/src/store.ts#L15-L57)). Its `batch` function defers subscriber flushing until the outer batch completes ([installed atom source](../../../node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/src/atom.ts#L60-L71)). That is notification batching, not an undo transaction.

The installed package contains no undo, redo, history, or transaction-history API. BrunoTable would have to maintain command history itself, as the Spreadsheet example does.

### XState Store

XState Store is a typed event-to-context store. Its first-party `undoRedo` extension offers two strategies:

- event history replays deterministic events from the initial snapshot;
- snapshot history stores past and future snapshots directly.

It also supports transaction identifiers, skipped events, snapshot deduplication, and a snapshot history limit ([official undo/redo documentation](https://stately.ai/docs/xstate-store/undo-redo)). These semantics fit sparse typed edit commands more directly than bare `setState`.

XState Store transitions are still synchronous. Effects may perform asynchronous work, but their result must send a later event back to the store; the documentation explicitly preserves deterministic state changes around events ([XState Store effects](https://stately.ai/docs/xstate-store#effects)). BrunoTable should keep the edit-history store pure and must not place `onSaveEdits` or other network effects inside replayable history transitions.

### XState core

Full XState models states, actors, and lifecycle. An invoked Promise actor has explicit success and error transitions, is stopped with the state that invoked it, and discards a result that arrives after that state is exited ([XState invoke documentation](https://stately.ai/docs/invoke)). Those are the required semantics for `saving`, `saveFailed`, `conflicted`, retry, dialog visibility, and similar workflows. A flat reactive store alone does not make illegal workflow combinations impossible.

## React Compiler and performance implications

Both store families can expose narrow React selectors with an equality function. TanStack React Store's installed `useSelector` is implemented with `useSyncExternalStoreWithSelector`, so a component rerenders only when its selected result changes ([installed React selector](../../../node_modules/.pnpm/@tanstack+react-store@0.11.0_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/@tanstack/react-store/src/useSelector.ts#L19-L66)). XState Store React exposes the same selector-and-compare boundary and documents that a component rerenders when the selected value changes ([XState Store React](https://stately.ai/docs/xstate-store/react)).

For TanStack-owned state, use `table.Subscribe`, the standalone `Subscribe`, or a narrowly selected atom. This is also a React Compiler correctness boundary: stable TanStack row, cell, header, and column objects can hide reactive getter reads from the compiler. TanStack documents explicit subscriptions for those nested renderer cases ([local Table state guide](../../../.repos/table/docs/framework/react/guide/table-state.md#L186-L243)). Keep that adapter private so BrunoTable renderers do not leak TanStack types.

For BrunoTable-owned edits, select the smallest useful immutable value, such as one draft/conflict/validation record by stable Cell Identity. A selector that returns the same reference must not rerender the cell. However, equality prevents rendering, not selector execution: every subscriber to one broad map source may still run its projection whenever that source notifies. Benchmark a single sparse map against row- or cell-partitioned atoms with realistic mounted row and column counts before freezing the store topology.

Prefer one command event containing all patches for multi-cell operations. TanStack Store has explicit cross-update notification batching; XState Store does not document a general equivalent. A single event avoids several observable intermediate snapshots and matches the upstream example's atomic command design.

No store choice changes the high-frequency rule. Scroll, pointer movement, drag preview, measurement, and live resizing remain outside React state and are batched with `requestAnimationFrame`. Stores publish immutable snapshots only for UI that must render a durable state change.

## Undo strategy caveats

Do not select XState Store's default event-history strategy merely because it is the default.

Event replay is attractive when edit transitions are pure, deterministic, and based on a stable initial context. It becomes unsafe when authoritative row replacements, row-version changes, server canonicalization, validation results, or network effects are mixed into the same event log. Skipping such events from history does not automatically define how old edit commands rebase over the new authoritative base.

Snapshot history makes undo constant-work and supports a finite history limit, but snapshots can retain significant data. It is acceptable only if the history context is sparse and preserves immutable references; full client row datasets must not be duplicated into every history entry.

The initial design should therefore preserve TanStack's explicit command patches, keep authoritative rows in the row store, and keep history bounded. Before implementation, prototype and benchmark these candidates:

1. XState Store event history over pure sparse commands, with an explicit rebase/reset rule when authoritative base data changes.
2. XState Store snapshot history over sparse drafts and conflicts, with a strict limit.
3. A small explicit command stack inside XState Store if neither extension strategy can express server reconciliation safely.

Regardless of storage strategy, undo equality and patch coalescing must use the normalized column's Value Semantics. Formatted display text must never decide whether a draft or undo command is a no-op.

## Provisional post-save undo semantics

Batch mode is straightforward before Save: undo and redo change the local accumulated net draft, and Save submits the remaining non-empty Save Change Set.

Immediate mode has an unresolved boundary. Once an edit has saved successfully, a purely local undo would lie: the server has already accepted the new value. There are only two coherent policies:

1. **Save boundary:** successful save commits the command and prevents undo from crossing that boundary.
2. **Compensating command:** undo creates a new Save Change Set that restores the prior semantic value using the latest accepted Row Version. It uses the ordinary optimistic-concurrency save path and can fail or produce a conflict. Redo is another new save, not a resurrection of the old response.

The provisional recommendation is the compensating-command policy because the product requirement calls for real undo/redo rather than a local visual illusion. It must remain a named decision ticket before implementation, especially for in-flight Immediate saves, server canonicalization, validation, and conflict resolution. Until that decision is accepted, do not expose a guarantee that history crosses a successful save boundary.

This caveat is also why edit history and save orchestration need separate owners. The XState Store can apply or reverse a pure command; the XState machine decides whether that reversal is locally legal, must invoke `onSaveEdits`, is waiting for a response, failed, or entered conflict resolution.
