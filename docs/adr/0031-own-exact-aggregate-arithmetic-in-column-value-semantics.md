# ADR 0031: Own Exact Aggregate Arithmetic in Column Value Semantics

## Status

Accepted

## Context

Client grouping must reproduce BrunoTable and View Server exact-value behavior without coercing
`bigint`, Effect BigDecimal, or a custom exact domain through JavaScript `number`. Existing Column
Value Semantics already declares which aggregate result domain each operation produces, but result
metadata alone cannot execute `sum` or `avg`. Comparison and canonical identity are sufficient for
`min`, `max`, and `countDistinct`; they cannot define exact addition or division.

TanStack Table's stock aggregation functions are not a semantic authority for this contract. Its
numeric functions are JavaScript-number-oriented, its grouped model is hierarchical, and its
synthetic rows do not match BrunoTable's flat grouped-summary model or private tuple identity.

The View Server returns Effect BigDecimal for `sum(number)` and every `avg`, while `sum(bigint)`
remains `bigint`. BrunoTable's root package must remain usable without Effect, so the root Number
Value Type cannot expose `sum` or `avg`, and the root BigInt Value Type cannot expose `avg`.

## Decision

`BrunoTableValueType` retains exact `aggregateResults` capability metadata and may additionally own
a branded `BrunoTableAggregateAlgebra<TValue>`. The algebra contains exact `add` and optional
`divideByCount` operations:

- advertising `sum: "self"` requires `add`;
- advertising `avg: "self"` requires both `add` and `divideByCount`;
- `countDistinct`, `min`, and `max` require no algebra.

Column normalization snapshots the algebra's function references. Every arithmetic result re-enters
the owning Value Type's existing `decodeRuntime` boundary. A throw or failed decode produces one
deterministic invalid grouped projection rather than escaping into React.

BrunoTable core owns the one-pass aggregate executor. It derives extrema from explicit
`Missing | Present(value)` ordering plus compiled `compare`, derives distinct counts from a tagged
Missing identity plus canonical Present identity, and owns the positive exact `bigint` Rows count
separately. It observes own-enumerable field presence before reading the admitted cached value, so
Missing remains distinct from Present `null` or Present `undefined`. It allocates no per-group value
arrays; only `countDistinct` owns a Map.

Presence identity uses collision-free framed tags for Missing, Present null, Present undefined, and
Present canonical value. Presence ordering is total and consistent across keys, extrema, and grouped
sorting: Missing, then Present null, then Present undefined, then non-nullish Present values ordered
by the compiled Value Type comparator. Canonical text such as `"null"` or `"undefined"` therefore
cannot collide with the corresponding nullish value.

The advertised built-in matrix is:

- Text, Boolean, and Number: `countDistinct`, `min`, `max`;
- BigInt: `countDistinct`, `sum`, `min`, `max`;
- optional Effect BigDecimal: `countDistinct`, `sum`, `min`, `max`, `avg`.

The optional Effect entry point supplies `BigDecimal.sum` and
`BigDecimal.divideUnsafe(total, BigDecimal.fromBigInt(count))`. Effect's fixed default division
precision remains authoritative; BrunoTable adds no rounding option. Root code and declarations do
not import or name Effect.

Custom Value Types may derive `countDistinct`, `min`, and `max` without an algebra. They may expose
`sum` only with exact addition and `avg` only with exact addition and division. This Client contract
does not assume future Server support for an arbitrary custom algebra.

Built-in Number admission normalizes negative zero to positive zero. Non-finite numbers remain
invalid. Nullable or optional `sum` and `avg` remain forbidden. No empty group is emitted, Rows is
always a positive `bigint`, all-Missing extrema return `undefined`, and Present `null` remains null.

## Consequences

- Exact arithmetic stays adjacent to the Value Type that can validate its outputs.
- Optional Effect support remains isolated while the Client grouping executor stays generic.
- Adding a future arithmetic-capable domain requires an explicit algebra rather than a type switch
  or number coercion.
- Server support for custom arithmetic requires a separate source-owned contract; Client support
  does not imply it.
- Aggregate failures become ordinary invalid source projections that can retain coherent rows under
  the existing lifecycle policy.

## Rejected alternatives

### Use TanStack stock aggregation functions

Rejected because their numeric and row-model semantics do not preserve BrunoTable's exact domains,
flat projection, presence model, or private identity contract.

### Switch on runtime values inside the Client executor

Rejected because sampling values rediscovers domain semantics, makes custom exact types impossible,
and risks coercion or divergent Client/Server behavior.

### Import Effect from the root package

Rejected because Effect is optional for consumers and must remain isolated behind
`@bruno/table/effect`.

### Let each Column Definition provide an aggregate callback

Rejected because aggregation is a Value-Type semantic operation, not presentation or per-column
business logic. Column `aggFunc` remains a closed built-in operation name.
