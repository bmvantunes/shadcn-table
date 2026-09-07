# Strict column API prototype verdict

Research and prototype verdict: 2026-08-05.

Primary source: throwaway [`codex/prototype-column-api` prototype at `77e8ce4`](https://github.com/bmvantunes/shadcn-table/tree/77e8ce4/packages/table/src/__prototype__/column-api).

## Question

Can BrunoTable keep the desired AG Grid-like consumer shape—one plain column array using optional global `BrunoTable...Column` helpers—while TypeScript strictly enforces Column Identity, field/value compatibility, row-aware callbacks, computed dependencies, preset precedence, editability, Row Version, and the atomic Save Change Set without exposing TanStack types?

## Verdict

Yes. The installed TypeScript 7 compiler propagates the outer `satisfies BrunoTableColumns<Order>` context into global helper calls. A consumer can use `BrunoTableNumberColumn({...})` directly inside the plain array while `row`, `value`, `field`, literal `columnId`, and helper value kind remain exact. BrunoTable does not need a row-bound `createColumnHelper`, a `defineGrid` call, repeated `<Order>` generics, `unknown`, or consumer casts.

The helper overload must retain the consumer's exact option object in its return type rather than returning one widened column interface. That preserves whether `isEditable` is actually present, literal Column Identity, individual overrides, and computed getter return types for later capability and Save Change Set derivation.

## Computed dependency finding

A Computed Column's overload must infer its non-empty `fields` tuple directly from the call parameter before contextually typing `valueGetter`. Hiding the tuple only inside a generic option constraint lets TypeScript widen it to every row field, which silently permits undeclared access. The corrected overload restricts `valueGetter.row` to `Pick<TRow, TFields[number]>`; the prototype proves that reading an undeclared `row.status` fails compilation.

A plain structural `BrunoTableColumns<TRow>` target has no generic call boundary from which to capture an arbitrary per-element dependency tuple. Strict Computed Columns therefore cross a typed construction boundary: a built-in Value Type uses its global helper, while a custom Value Type supplies an equivalently typed branded constructor. Plain raw Field Columns remain valid, and raw Field Columns, helper results, and presets still coexist in one ordinary array. This is not a row-bound factory and adds no grid definition object.

## Preset finding

`BrunoTableNumberColumn.withDefaults(...)` can remain row-independent and generic until its final call receives `TRow` from the outer array context. The prototype proves deterministic built-in → preset → individual precedence, including a nested number-format merge, while final row-aware callbacks retain their exact types.

Row-dependent defaults cannot be contextually typed before a final row type exists. Keep reusable preset defaults construction-oriented and row-independent; put row-aware policy callbacks on the final column invocation or behind an explicitly application-typed wrapper.

## Save payload finding

The exact helper-return tuple derives potentially editable Column Identities. The prototype then correlates each non-empty Save Cell Change across:

- Column Identity;
- exact source field;
- exact `before` and `after` value domain;
- complete immutable `baseRow`;
- exact `expectedVersion` inferred from `getRowVersion`.

The compiler rejects a Price change that claims the Quantity field, an editable Computed Column, an incompatible helper field, an empty computed dependency tuple, and an invalid Column Identity. Runtime normalization still validates duplicate Column Identities once because TypeScript cannot prove tuple uniqueness for every dynamic input.

## Production constraints

- Keep global helpers optional for Field Columns and mandatory as the strict generic boundary for Computed Columns.
- Preserve exact helper input options in the return type; do not widen early to `BrunoTableColumns<TRow>[number]`.
- Cross-element callback context cannot infer the eventual sibling tuple from a plain array checked
  with `satisfies BrunoTableColumns<TRow>`. Grouped presentation callbacks therefore keep their own
  Column Identity, value, and aggregate function exact but omit sibling Group Key evidence. Once
  `typeof columns` exists, `BrunoTableGroupKeyValues<TRow, typeof columns>` provides the exact
  groupable Column Identity union. A free callback generic is not a substitute: it would let
  callers claim a tuple unrelated to the Table Instance.
- Keep TanStack Table entirely below the normalization boundary.
- Compile helper, preset, and raw Field definitions into one ordinary normalized registry once.
- Add source and emitted-package type tests for every accepted and rejected case exercised by the prototype.
- Treat the prototype as evidence only; production code should implement the smaller reusable type machinery with the complete Value Type, grouping, Select, and optional Effect BigDecimal contracts.
