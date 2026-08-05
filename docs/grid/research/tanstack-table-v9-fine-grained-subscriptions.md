# TanStack Table v9 fine-grained React subscriptions

Research snapshot: 2026-08-02.

## Conclusion

TanStack Table v9's fine-grained subscription model is real and relevant to BrunoTable, but the React API is **`table.Subscribe`** (capital `S`) or the standalone React **`Subscribe`** component. There is no lowercase React `table.subscribe` render API in stable v9.0.0. Lowercase `table.subscribe` is a Lit template helper. The other lowercase forms in React are imperative TanStack Store subscriptions: `table.store.subscribe(...)` and `table.atoms.<slice>.subscribe(...)`.

BrunoTable should use narrow reactive islands throughout its private renderer, not only in cells. That does **not** mean mechanically mounting one TanStack subscription for every cell. The appropriate boundary depends on the invalidation shape:

- exact-cell state such as a draft, validation result, or conflict can invalidate one cell;
- row-shaped selection drawing can use one compact derived key per mounted row;
- sorting, filtering, and pinning affordances can invalidate one header or control;
- structural slices can invalidate a header/body/viewport boundary;
- high-frequency geometry such as live column widths should bypass React and update CSS variables imperatively.

TanStack itself recommends starting with the default `useTable` selector and adding fine-grained boundaries where render cost matters. BrunoTable has stronger requirements than a general-purpose example—React Compiler correctness, nested renderer components, and a 120 Hz target—so these boundaries should be designed in from the first vertical slice and then measured. Selectors must encode every state dependency used by the rendered island; an underspecified selector produces stale UI.

Primary upstream snapshot: stable TanStack Table [`9.0.0` at `d4d91a6`](https://github.com/TanStack/table/tree/d4d91a6cd6caa96b8d3bdb327b894b6125605350). The React subscription implementation, table-state guide, and adapter tests are unchanged from the previously audited beta.74 snapshot.

## The four different APIs

### `useTable(options, selector?)`

The second argument selects the state observed by the component that creates the table:

```ts
useTable(options, (state) => selectedValue);
```

Omitting the selector subscribes the owner to all registered table state. A constant selector such as `() => null` opts the owner out of table-state rerenders, allowing subscriptions to move lower in the tree. The selected value is exposed as `table.state`. TanStack compares selected results shallowly before rerendering.

Sources:

- local implementation: [`.repos/table/packages/react-table/src/useTable.ts`](../../../.repos/table/packages/react-table/src/useTable.ts), lines 126-156 and 202-225;
- local guide: [`.repos/table/docs/framework/react/guide/table-state.md`](../../../.repos/table/docs/framework/react/guide/table-state.md), lines 96-130;
- official source: [`useTable.ts` at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/packages/react-table/src/useTable.ts#L126-L225).

### `<table.Subscribe>` and standalone `<Subscribe>`

These are React render-prop components. Without `source`, `table.Subscribe` uses `table.store` and requires a selector:

```tsx
<table.Subscribe selector={(state) => state.pagination.pageSize}>
  {(pageSize) => <output>{pageSize}</output>}
</table.Subscribe>
```

With `source`, it accepts an atom or store. A selector is optional; omitting it subscribes to that source's complete value:

```tsx
<table.Subscribe
  source={table.atoms.rowSelection}
  selector={(selection) => Boolean(selection[rowId])}
>
  {(selected) => <RowSelectionIndicator selected={selected} />}
</table.Subscribe>
```

The standalone component has the same runtime mechanism:

```tsx
import { Subscribe } from "@tanstack/react-table";

<Subscribe
  source={table.atoms.columnFilters}
  selector={(filters) => filters.find((filter) => filter.id === columnId)?.value}
>
  {(filterValue) => <ColumnFilter value={filterValue} />}
</Subscribe>;
```

`SubscribeSource<T>` is `Atom<T> | ReadonlyAtom<T> | Store<T> | ReadonlyStore<T>`. Internally, `Subscribe` calls TanStack React Store's `useSelector` with `compare: shallow`, then invokes its child function with the selected value. Therefore a table-state update rerenders this boundary only when the selected result is not shallowly equal to its previous result. A primitive selector is the clearest exact invalidation key; a small object is also appropriate when its members preserve references when unchanged.

The table-bound form supplies better JSX contextual typing. Inside TanStack cell/header render contexts the table is typed as core `Table`, which does not contain the React-only `table.Subscribe`; those contexts use the standalone import with an explicit `source`. BrunoTable can hide this distinction entirely inside its private adapter.

Sources:

- local implementation and overloads: [`.repos/table/packages/react-table/src/Subscribe.ts`](../../../.repos/table/packages/react-table/src/Subscribe.ts), lines 13-73 and 75-150;
- table-bound overloads and default source: [`.repos/table/packages/react-table/src/useTable.ts`](../../../.repos/table/packages/react-table/src/useTable.ts), lines 43-91 and 169-174;
- local guide: [`.repos/table/docs/framework/react/guide/table-state.md`](../../../.repos/table/docs/framework/react/guide/table-state.md), lines 132-184 and 230-243;
- isolation test: [`.repos/table/packages/react-table/tests/adapterReactivity.test.tsx`](../../../.repos/table/packages/react-table/tests/adapterReactivity.test.tsx), lines 283-399;
- official source: [`Subscribe.ts` at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/packages/react-table/src/Subscribe.ts#L13-L150), [`useTable.ts` at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/packages/react-table/src/useTable.ts#L43-L91).

### `table.store.subscribe(...)` and `table.atoms.<slice>.subscribe(...)`

These are imperative subscriptions, not React render APIs. They receive future source updates and return a subscription object with an `unsubscribe()` method. They are appropriate for side effects outside React, such as reflecting column widths into CSS custom properties:

```ts
const writeColumnWidths = () => {
  // Read current header geometry and write CSS variables.
};

writeColumnWidths();
const subscription = table.atoms.columnSizing.subscribe(writeColumnWidths);

return () => subscription.unsubscribe();
```

The initial write is explicit because the raw atom subscription does not invoke its observer on registration. Cleanup is mandatory. By contrast, `<Subscribe>` and `useSelector` use `useSyncExternalStoreWithSelector`; React owns their subscription cleanup. TanStack's React adapter tests confirm that isolated subscribers stop observing updates after unmount.

Use `table.store.subscribe` only when the side effect truly needs every table-state update. Prefer a per-slice atom for narrower notification and less full-store work.

Sources:

- performant resize implementation: [`.repos/table/examples/react/column-resizing-performant/src/main.tsx`](../../../.repos/table/examples/react/column-resizing-performant/src/main.tsx), lines 93-123;
- React Store hook implementation installed with beta.74: `node_modules/.pnpm/@tanstack+react-store@0.11.0_*/node_modules/@tanstack/react-store/src/useSelector.ts`, lines 43-66;
- TanStack Store atom subscription implementation: `node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/src/atom.ts`, lines 170-186;
- unmount test: [`.repos/table/packages/react-table/tests/adapterReactivity.test.tsx`](../../../.repos/table/packages/react-table/tests/adapterReactivity.test.tsx), lines 410-472;
- official example: [performant column resizing at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/examples/react/column-resizing-performant/src/main.tsx#L93-L123).

### Lit's lowercase `table.subscribe`

The lowercase render helper belongs to `@tanstack/lit-table`. It creates fine-grained Lit template islands and is not a React API. There are no `table.subscribe` matches in the React adapter, React guide, or React examples at beta.74.

Sources:

- local Lit controller: [`.repos/table/packages/lit-table/src/TableController.ts`](../../../.repos/table/packages/lit-table/src/TableController.ts), lines 33-65;
- local Lit guide: [`.repos/table/docs/framework/lit/guide/table-state.md`](../../../.repos/table/docs/framework/lit/guide/table-state.md), lines 112-130;
- official source: [`TableController.ts` at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/packages/lit-table/src/TableController.ts#L33-L65).

## What a selector can observe

`table.store` contains the flat state contributed by the table's registered features and custom feature/plugin state. Beta.71's stock state map includes cell selection, column filters, grouping, ordering, pinning, resizing, sizing, visibility, global filtering, row expansion, pagination, row pinning, row selection, and sorting. `table.atoms` exposes one readonly atom for each registered slice.

This is feature-dependent: a slice is absent when its feature is not registered. The selector type follows the actual feature set. A `source` prop can also point to an external TanStack atom/store, not only a table-owned source.

Table subscriptions do **not** automatically cover BrunoTable row data, sparse server-window contents, drafts, conflicts, validation, focus, viewport geometry, or other BrunoTable-owned state. Those need their own fine-grained stores and React boundaries. A TanStack selector can cause builder methods to be reevaluated, but the selector receives source state—not row values or row-model output.

Sources:

- local state map: [`.repos/table/packages/table-core/src/types/TableState.ts`](../../../.repos/table/packages/table-core/src/types/TableState.ts), lines 17-41;
- atom mapping: [`.repos/table/packages/table-core/src/core/table/coreTablesFeature.types.ts`](../../../.repos/table/packages/table-core/src/core/table/coreTablesFeature.types.ts), lines 40-66 and 220-247;
- official source: [`TableState.ts` at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/packages/table-core/src/types/TableState.ts#L17-L41).

## What it does and does not prevent

The beta.74 tests demonstrate the intended isolation:

- a table owner using `() => null` does not rerender for table-state changes;
- a selector for one row's boolean does not rerender when another row is added to the selection;
- a pagination subscriber does not rerender for row-selection changes;
- selecting an already-equal value produces no extra boundary render;
- unmount removes the underlying subscription.

This isolation is specifically from source updates whose selected result is shallowly equal. It is not an absolute memoization wall: if an ancestor rerenders and recreates the `<Subscribe>` element, ordinary React reconciliation still applies. Stable data, columns, table structure, and selectors with cheap projections remain necessary.

The selector itself runs when its source notifies. A very expensive selector repeated across thousands of subscribers can merely move the bottleneck. Mounted-count virtualization and compact keys are still essential.

Primary test: [`.repos/table/packages/react-table/tests/adapterReactivity.test.tsx`](../../../.repos/table/packages/react-table/tests/adapterReactivity.test.tsx), lines 283-399 and 410-472 ([official source](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/packages/react-table/tests/adapterReactivity.test.tsx#L283-L399)).

## React Compiler correctness

TanStack v9 deliberately returns a fresh React table wrapper when selected state changes because the React Compiler needs a visible reactive value. Nested renderer components are the remaining hazard: `row`, `cell`, `column`, and `header` instances are stable, while calls such as `row.getIsSelected()`, `column.getIsPinned()`, and `cell.getIsSelected()` hide their state dependencies from the compiler. The compiler can reuse nested JSX without reevaluating those getters.

TanStack documents `<Subscribe>` or `useSelector` as the supported explicit dependency boundary. This is not merely a performance optimization for BrunoTable; it is a correctness requirement anywhere a nested component renders state obtained through stable TanStack builder instances. The narrow selected value should correspond to every getter dependency used inside that island.

Sources:

- compiler-oriented table wrapper: [`.repos/table/packages/react-table/src/useTable.ts`](../../../.repos/table/packages/react-table/src/useTable.ts), lines 217-225;
- compiler guidance: [`.repos/table/docs/framework/react/guide/table-state.md`](../../../.repos/table/docs/framework/react/guide/table-state.md), lines 186-243;
- composable cell example: [`.repos/table/examples/react/composable-tables/src/components/cell-components.tsx`](../../../.repos/table/examples/react/composable-tables/src/components/cell-components.tsx), lines 11-35;
- official guide: [React table state at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/docs/framework/react/guide/table-state.md#L186-L243).

## The official performance patterns

### Cell drag selection: derive one key per mounted row

TanStack explicitly warns that wrapping the whole body in a cell-selection subscription rerenders every row on every drag update. Its recommended example places a subscription around each row and selects a compact string encoding only the selection geometry that changes that row's drawing: self/adjacent-row range membership, column bounds, and focused-cell ownership.

This is an important counterexample to “one subscription per cell.” A row is the better invalidation boundary when the whole row draws selection edges and the derived row key can stay unchanged while a range grows elsewhere. If BrunoTable later proves through profiling that an exact cell boundary is better for some appearance, it can select by stable Cell Identity; that is not the default conclusion from TanStack's example.

Sources:

- performance guide: [`.repos/table/docs/framework/react/guide/cell-selection.md`](../../../.repos/table/docs/framework/react/guide/cell-selection.md), lines 340-428;
- working example: [`.repos/table/examples/react/cell-selection/src/main.tsx`](../../../.repos/table/examples/react/cell-selection/src/main.tsx), lines 407-445 and 520-550;
- official guide: [cell-selection performance at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/docs/framework/react/guide/cell-selection.md#L340-L428).

### Column resizing: keep live widths outside React

The performant resizing example opts the table owner out of resize-state renders, imperatively subscribes to `table.atoms.columnSizing`, writes CSS variables, and gives only each resizer's active boolean a small `<table.Subscribe>` island. This keeps width changes off React's per-frame render path.

That pattern aligns directly with BrunoTable's existing rule that geometry, measurement, scrolling, and hit testing stay outside React state. Fine-grained React subscriptions are not a reason to route all high-frequency state through React.

Sources:

- guide: [`.repos/table/docs/framework/react/guide/column-resizing.md`](../../../.repos/table/docs/framework/react/guide/column-resizing.md), lines 239-249;
- example: [`.repos/table/examples/react/column-resizing-performant/src/main.tsx`](../../../.repos/table/examples/react/column-resizing-performant/src/main.tsx), lines 90-123 and 137-193;
- official guide: [advanced resizing performance at beta.74](https://github.com/TanStack/table/blob/1b70a17ce2ec6a88869e04d587dc6f5dee877ce7/docs/framework/react/guide/column-resizing.md#L239-L249).

## Recommended BrunoTable subscription map

| Concern                                                    | Recommended reactive boundary                     | Source and selector shape                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Row/cell data replacement                                  | Mounted row or exact cell, based on profiling     | BrunoTable row store selected by Row Identity and immutable row reference/version; not TanStack state                 |
| Draft value, validation, conflict                          | Exact edited/affected cell                        | BrunoTable sparse store selected by stable Cell Identity                                                              |
| Cell range drag and focus outline                          | Mounted row initially                             | `table.atoms.cellSelection` projected to a compact row drawing key that includes focus and adjacent-edge dependencies |
| Row selection checkbox                                     | Exact row/control                                 | `table.atoms.rowSelection` projected to `Boolean(selection[rowId])`                                                   |
| Sort/filter/pin/visibility affordance                      | Exact header/control                              | Relevant per-slice atom projected by Column Identity                                                                  |
| Header groups, visible column regions, row-model structure | Small structural owner around affected collection | `table.store` selector containing only the structural slices actually used                                            |
| Active column resizer styling                              | Exact resizer                                     | Boolean selector comparing the active resize Column Identity                                                          |
| Live column widths                                         | No React render                                   | Imperative `columnSizing` atom subscription writing CSS variables, with explicit cleanup                              |
| Scroll, measurement, hit testing, drag preview geometry    | No React render                                   | BrunoTable geometry engine plus `requestAnimationFrame`; publish immutable snapshots only where UI must render state  |
| Toolbar, status bar, and menus                             | The smallest owning control or panel              | Per-slice atom when one slice is sufficient; store selector for a small multi-slice projection                        |

The internal adapter should centralize these mappings so public BrunoTable renderers never import TanStack atoms, stores, or `Subscribe`.

## Maturity and stable-version boundary

This architecture arrived with the v9 TanStack Store rewrite on 2026-01-07. The subscription API then changed materially in April and May: the table store was split into feature atoms, the prop became `source`, and the default `useTable` selection changed to the full state. TanStack Table v9 is now stable, and `@tanstack/react-table` is pinned to exact version `9.0.0` in this repository. The stable release did not change the React subscription implementation or guidance audited here.

The implementation has targeted React tests for selection isolation, controlled-state publication, unmount cleanup, and concurrent rendering. That is enough to treat it as a serious private implementation candidate, not enough to freeze it into BrunoTable's public API. BrunoTable should:

- keep the TanStack subscription types and components private;
- pin the exact stable version and review subscription behavior on each upgrade;
- add BrunoTable-owned render-count and React Compiler behavioral tests;
- benchmark the actual virtualized workload instead of assuming more subscriptions are always faster;
- preserve an adapter seam so a future v9 API change does not affect consumers.

History references:

- v9 store rewrite: [`62af4f4`](https://github.com/TanStack/table/commit/62af4f4f55af42136143b5fc68cd35e1c79038aa);
- feature atoms and subscription refactor: [`19490e7`](https://github.com/TanStack/table/commit/19490e7f445e0e0d80cdc529949eb1555ffe1e04);
- default full-state selector and basic subscription example: [`c5c781a`](https://github.com/TanStack/table/commit/c5c781aa9999b7a6dc3f02562c2d618aba2c8e3c).
