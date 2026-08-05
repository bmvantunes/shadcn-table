# Exact numeric values: `bigint` and Effect `BigDecimal`

## Status

Research completed against these source snapshots:

- BrunoTable workspace at the current working tree
- Effect `f4151e1937c26de14f1d64566f8126173f1b5014`
- TanStack Table v9 `1b70a17ce2ec6a88869e04d587dc6f5dee877ce7`
- AG Grid `26102912f3d5f90dab8e6c4fe3264a31e5fb8410`
- effect-view-server `0e09abb1384b899279ea07b15f0bcb3c852284b9`

This document defines the recommended exact-numeric direction. It does not make Effect a dependency of BrunoTable core and does not treat AG Grid or TanStack defaults as BrunoTable's public contract.

## Executive decision

BrunoTable should support native `bigint` as a built-in exact numeric value kind. Effect `BigDecimal` should be supported through an optional Effect integration that supplies the same value-semantics contract without being imported by the core package.

An exact numeric value must stay exact from row ingestion to rendering, editing, filtering, sorting, clipboard, preference persistence, Save Change Sets, live-source reconciliation, and conflicts. It must never pass through JavaScript `number`. Effect explicitly calls its conversion `toNumberUnsafe` because it can lose integer or fractional precision or become `Infinity` ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L1451-L1478)).

The central implementation rule is:

> Compile one explicit value-semantics plan per normalized column, then reuse its direct functions everywhere that column value crosses a grid capability.

The plan must provide semantic equality, a total comparison for valid values, exact canonical text, parsing, and a versioned JSON-safe persistence codec. Rendering may additionally use a row-aware display formatter, but display formatting must not become equality, comparison, clipboard, or persistence semantics.

Do not infer an exact numeric kind by sampling rows. TypeScript types are erased, a Server Table is sparse, and a valid column may initially contain only nullish values. AG Grid restricts its own inference to the Client-Side Row Model and requires explicit data types for other row models ([AG Grid cell data types](../../../.repos/ag-grid/documentation/ag-grid-docs/src/content/docs/cell-data-types/index.mdoc#L43-L71)); TanStack's current automatic filter selection also samples the first non-null core-row value and does not recognize `bigint` ([TanStack column filtering](../../../.repos/table/packages/table-core/src/features/column-filtering/columnFilteringFeature.utils.ts#L26-L89)).

## Why this needs a semantic capability, not a formatter

Effect `BigDecimal` is an object containing a `bigint` coefficient and numeric scale ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L27-L55)). Two different objects and storage representations can denote the same number. For example, `1.5` and `1.50` are semantically equal under Effect's documented equivalence ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L1090-L1143)). Reference equality, strict equality, generic object sorting, or stringifying an arbitrary object therefore cannot implement grid semantics.

One value kind affects all of these capabilities:

| Capability          | Exact-numeric requirement                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| Cell rendering      | Produce text without React attempting to render a `BigDecimal` object.     |
| Editor              | Keep transient input as text and produce the exact value only on commit.   |
| Draft dirtiness     | Compare the base and draft semantically.                                   |
| Conflict detection  | Compare base, server, and user values with the same equivalence.           |
| Client filtering    | Use exact operands and exact comparisons.                                  |
| Client sorting      | Use a safe total comparator, not object or `number` comparison.            |
| Server filtering    | Send the native typed operand to effect-view-server.                       |
| Clipboard           | Copy lossless canonical text and parse it back for the destination column. |
| Preferences         | Encode filter operands into tagged, versioned, JSON-safe data.             |
| Save Operation      | Preserve the exact native value in the typed change set.                   |
| Live reconciliation | Decode canonical source values before they enter row/draft stores.         |

AG Grid reaches the same broad architectural conclusion with its cell data types: a data type coordinates rendering, editing, filtering, sorting, and import/export ([AG Grid cell data types](../../../.repos/ag-grid/documentation/ag-grid-docs/src/content/docs/cell-data-types/index.mdoc#L5-L15)). BrunoTable needs a stricter, typed, non-inferred version of that seam.

## Recommended public seam

The research led to the accepted explicit Value Type selection recorded in the architecture and ADR 0008. Raw columns use `valueType`; typed Column Helpers supply the same selection. The exact public construction interface for custom types still requires a type-design proof, but its capability split should be equivalent to the following conceptual interface. Every public symbol retains the required `BrunoTable...` brand.

```ts
export type BrunoTableOrdering = -1 | 0 | 1;

export type BrunoTableDecodeResult<TValue> =
  | { readonly _tag: "Success"; readonly value: TValue }
  | { readonly _tag: "Failure"; readonly message: string };

export type BrunoTableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BrunoTableJsonValue[]
  | { readonly [key: string]: BrunoTableJsonValue };

export type BrunoTableValueType<TValue> = {
  /** Stable identity for persisted operands and migrations. */
  readonly codecId: string;
  readonly codecVersion: number;

  /** Used only at ingestion and other untrusted boundaries, never on every paint. */
  readonly decodeRuntime: (input: unknown) => BrunoTableDecodeResult<TValue>;

  readonly equivalent: (left: TValue, right: TValue) => boolean;
  readonly compare: (left: TValue, right: TValue) => BrunoTableOrdering;

  /** Exact, locale-independent, round-trippable text. */
  readonly formatCanonicalText: (value: TValue) => string;
  readonly parseCanonicalText: (text: string) => BrunoTableDecodeResult<TValue>;

  readonly encodePersisted: (value: TValue) => BrunoTableJsonValue;
  readonly decodePersisted: (input: unknown) => BrunoTableDecodeResult<TValue>;
};
```

The real interface should expose capability markers so type-level filter operators can be derived without importing a concrete value library. An exact numeric Value Type needs at least `equality`, `order`, `canonicalText`, and `numericFilter` capabilities. Drag Fill is repetition-only and must not smuggle arithmetic into the required comparator contract. Any future aggregation arithmetic would be a separate capability justified by that feature, not by filling.

Recommended column usage:

```ts
import { BrunoTableBigDecimalValueType } from "@bruno/table/effect";

const columns = [
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
  },
  {
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    valueType: BrunoTableBigDecimalValueType,
  },
] satisfies BrunoTableColumns<Order>;
```

`"bigint"` is a core built-in. `BrunoTableBigDecimalValueType` and `BrunoTableBigDecimalColumn` come from the optional Effect entry point. The root `@bruno/table` entry point must not import `effect`, and its declarations must not mention Effect types. If an `@bruno/table/effect` subpath is used, `effect` should be an optional peer and only that subpath may import it.

Do not create a registry that executes package or application code to discover value semantics. Column normalization receives a value or built-in literal already selected by the consumer or source Adapter and compiles it once.

### Runtime metadata is currently missing

The current public column type preserves a field's TypeScript value type but emits no runtime value-kind metadata ([current `public-types.ts`](../../../packages/table/src/public-types.ts#L32-L73)). This already creates a deterministic-runtime gap for filter UI and editors, and exact numeric values make it impossible to ignore.

The effect-view-server Viewport Source also does not expose schema-derived field semantics. Its public result contains only the typed `viewport`, `totalRows`, query `version`, status, and diagnostics ([effect-view-server viewport source](../../../../effect-view-server/packages/react/src/live-query-viewport.ts#L81-L118)). The `replace` method keeps query operands precisely typed, but TypeScript precision is not runtime metadata ([effect-view-server viewport source](../../../../effect-view-server/packages/react/src/live-query-viewport.ts#L81-L97)).

There are two lawful solutions:

1. raw exact-numeric columns declare `valueType` explicitly, while their typed Column Helpers supply it; or
2. a source Adapter carries an opaque, already-compiled field-semantics registry that BrunoTable can consume without importing Effect.

The first solution can ship independently and should remain available for non-effect-view-server sources. The second would make the canonical `useLiveQueryViewport(...)` experience more concise, but requires a new effect-view-server public contract. Never fill this gap by scanning loaded rows.

## TypeScript model changes

The current filter model recognizes `number | bigint` as numeric ([current `public-types.ts`](../../../packages/table/src/public-types.ts#L129-L176)). It therefore already preserves native `bigint` operands, but it excludes `BigDecimal` and treats any union containing a numeric branch as automatically numeric.

Replace the hard-coded `Extract<TValue, number | bigint>` rule with capability-derived operands:

- built-in `number` semantics contributes `number` operands;
- built-in `bigint` semantics contributes `bigint` operands;
- the Effect adapter contributes `BigDecimal.BigDecimal` operands;
- a custom Value Type may contribute its exact operand type;
- a column with no ordered-numeric semantics cannot use numeric operators even if an unrelated union branch happens to be numeric.

Mixed domains deserve conservative handling. `number | bigint`, `string | bigint`, or `number | BigDecimal` must not receive automatic ordered-numeric semantics because cross-domain comparison and persistence identity are ambiguous. Require an explicit custom Value Type or omit numeric filter/sort capability. effect-view-server makes the same concern concrete: it rejects schema unions whose different runtime members encode to the same JSON value, including `string | bigint` ([effect-view-server ADR 0003](../../../../effect-view-server/docs/adr/0003-canonical-topic-row-value-semantics.md#L46-L54)).

Type tests should prove that:

- a `bigint` column accepts only `bigint` numeric filter operands;
- a BigDecimal column with the Effect semantics accepts only `BigDecimal` operands;
- a JavaScript `number` is rejected for both;
- `contains` is rejected for exact numeric columns;
- `greaterThan` is rejected when no ordered-numeric capability exists;
- edit changes keep exact `before` and `after` types by Column Identity;
- nullable exact numeric columns cannot silently choose a blank-input representation;
- the root package remains usable in a project where Effect is not installed.

## Native `bigint` semantics

The built-in `bigint` plan is straightforward and should have no Effect dependency:

- runtime guard: `typeof value === "bigint"`;
- equality: `left === right`;
- order: equality first, then `<`/`>`;
- canonical text: `value.toString(10)`;
- persisted form: a tagged base-10 string;
- editor/clipboard parser: signed base-10 digits only;
- no conversion to `number` at any point.

Effect's `BigIntFromString` likewise uses signed base-10 strings for decoding and encodes a `bigint` back to a decimal string ([Effect `Schema.ts`](../../../.repos/effect/packages/effect/src/Schema.ts#L12914-L12944)). Its string predicate is deliberately stricter than JavaScript's `BigInt(...)`: no leading plus, decimal point, exponent, separator, or hexadecimal notation ([Effect `Schema.ts`](../../../.repos/effect/packages/effect/src/Schema.ts#L6790-L6811)). BrunoTable should use this conservative grammar by default. A custom parser may accept more input, but its canonical formatter must still emit one unambiguous decimal representation.

AG Grid's implementation is useful corroboration: it uses a text editor, formats with `String(value)`, and compares parsed bigints directly ([AG Grid data-type service](../../../.repos/ag-grid/packages/ag-grid-community/src/columns/dataTypeService.ts#L691-L733), [AG Grid bigint comparator](../../../.repos/ag-grid/packages/ag-grid-community/src/columns/dataTypeService.ts#L899-L915)). Its documentation also preserves exact integer strings for clipboard and CSV and exports Excel values as Text by default to avoid precision loss ([AG Grid cell data types](../../../.repos/ag-grid/documentation/ag-grid-docs/src/content/docs/cell-data-types/index.mdoc#L105-L123)).

BrunoTable should not copy two AG Grid choices:

- do not infer `bigint` from the first row;
- do not accept a JavaScript `number` in the default parser, because it may already have lost precision before `BigInt(number)` runs.

## Effect `BigDecimal` semantics

### Canonical representation

Effect represents a decimal as `{ value: bigint, scale: number }`, normalizes trailing zeroes, and may produce a negative scale when the value has trailing integer zeroes ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L167-L218)). `BigDecimal.format` normalizes before emitting exact plain or scientific notation ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L1353-L1410)). Effect Schema's canonical JSON codec encodes a `BigDecimal` as a string and uses the same formatter and equivalence ([Effect `Schema.ts`](../../../.repos/effect/packages/effect/src/Schema.ts#L12251-L12308)).

The optional adapter should use that schema JSON representation at persistence and transport boundaries. It must not use `BigDecimal.prototype.toJSON()`, which emits a diagnostic object containing coefficient and scale rather than Effect Schema's canonical wire string ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L57-L75)).

Canonical formatting deliberately erases representational trailing zeroes. If `1.50` and `1.5` must remain different because scale is domain data, Effect `BigDecimal` alone is the wrong domain type. Model the scale explicitly in a branded/domain object and supply separate semantics.

### Empty input is not zero

`BigDecimal.fromString` and `Schema.BigDecimalFromString` treat an empty string as zero ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L1277-L1320), [Effect `Schema.ts`](../../../.repos/effect/packages/effect/src/Schema.ts#L12337-L12366)). That is unsuitable as BrunoTable's default editor policy.

The grid must resolve blank input before calling the numeric parser:

- non-nullable value: blank is a parse error;
- `T | null`: the column may explicitly choose `null` as its blank-input value;
- `T | undefined`: the column may explicitly choose `undefined`;
- `T | null | undefined`: the consumer must choose which representation accepted blank input means.

This keeps blank-input semantics distinct from numeric zero and prevents a blank edited or pasted cell from silently becoming `0n` or decimal zero. It does not imply a destructive Clear/Delete command; V1 accepts blank values only through an editor or explicit paste transaction.

### Comparator safety is the hard requirement

Do not directly use `BigDecimal.Order` or `BigDecimal.Equivalence` as BrunoTable's universal comparator/equality implementation for effect-view-server values. Both align differing scales by calling `BigDecimal.scale`; scale alignment computes a power of ten ([Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L255-L268), [Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L658-L673), [Effect `BigDecimal.ts`](../../../.repos/effect/packages/effect/src/BigDecimal.ts#L1103-L1113)). A scale can be any safe integer, so a valid but extreme difference can request an impossibly large bigint allocation.

effect-view-server explicitly avoids that path. Its comparator compares sign, decimal magnitude, and coefficient digits in `O(coefficient digits)` without materializing a power of ten ([wire-safe BigDecimal comparator](../../../../effect-view-server/packages/effect-utils/src/wire-safe-big-decimal.ts#L149-L227)). Its filtering and sorting paths use that comparator for BigDecimal equality, ranges, and row ordering ([raw predicate compiler](../../../../effect-view-server/packages/column-live-view-engine/src/raw-predicate-compiler.ts#L125-L198), [raw query plan](../../../../effect-view-server/packages/column-live-view-engine/src/raw-query-plan.ts#L122-L169)).

BrunoTable client filtering, sorting, draft equality, and conflict equality must use semantics equivalent to the server comparator. Otherwise a Client Table and Server Table can disagree, and an incoming pathological value can turn a comparison into a huge allocation.

The current implementation cannot lawfully import that function: `@effect-view-server/effect-utils` is a private workspace package ([effect-utils `package.json`](../../../../effect-view-server/packages/effect-utils/package.json#L1-L21)). Before shipping unrestricted effect-view-server BigDecimal support, choose one of these paths:

1. expose the safe semantics through a public effect-view-server value-semantics API and let the integration reuse it; or
2. implement the audited digit comparator in the optional BrunoTable Effect adapter and maintain cross-repository parity tests against effect-view-server.

The first path is preferred because it establishes one authority. A documented maximum scale could make ordinary Effect comparison safe for a deliberately bounded non-View-Server domain, but BrunoTable must not silently invent such a bound for values the View Server accepts.

### Wire safety

effect-view-server accepts BigDecimal query operands only when they round-trip injectively through Effect's JSON codec; it rejects values whose formatted exponent loses scale precision ([effect-view-server query semantics](../../../../effect-view-server/docs/query-semantics.md#L41-L60)). The optional adapter's hostile-input decoder and editor parser must apply the same admission rule before a value enters trusted grid state.

Rows already decoded by the official effect-view-server client arrive as native semantic values. Its protocol tests demonstrate JSON wire strings being decoded back into native `bigint`, Effect collections, classes, and BigDecimal values ([schema value wire test](../../../../effect-view-server/packages/protocol/src/schema-value-wire.test.ts#L1-L65)). BrunoTable should validate once at the source/adapter boundary, then keep those native values unchanged.

## Rendering and editing

The default exact numeric renderer should produce canonical text. A column `valueFormatter` may override visual presentation, but it remains a pure row-aware display operation. It must not implicitly redefine:

- semantic equality;
- client sort or filter order;
- editor parsing;
- clipboard round trips;
- persisted filter encoding;
- View Server query values.

This separation matters for localized formats such as `1,234.50`, currency labels, compact notation, or parentheses for negatives. They are useful display strings but are not necessarily invertible.

The editor lifecycle should be:

1. initialize a text editor with canonical edit text, not localized display text;
2. keep incomplete input as a string while the editor is active;
3. on Enter, Tab, or accepted outside pointer action, resolve blank policy;
4. parse to the exact native type;
5. run synchronous and asynchronous validation;
6. record the typed value in the sparse draft only after successful parsing;
7. leave the editor and its candidate open when parsing or validation fails.

This preserves the accepted Cell Edit Commit contract ([editing and conflicts](../editing-and-conflicts.md#L34-L54)) and keeps parse errors distinct from validation, server rejection, and conflict state ([grid requirements](../requirements.md#L433-L444)).

Default input grammar should be exact and locale-independent. Applications that want locale-aware entry should provide an explicit parser paired with canonical formatting. Parsing untrusted pasted/filter text should also apply configurable input budgets, such as maximum code units and coefficient digits, so an accidental multi-megabyte integer cannot monopolize the UI thread. A budget is an input policy, not a conversion to `number`, and server-originated values remain renderable even when they exceed the interactive entry policy.

## Semantic equality and conflicts

All draft and conflict reconciliation must call the normalized column's `equivalent` function. For each changed cell:

```text
equivalent(user, base)   -> user did not change it; accept server
equivalent(server, base) -> server did not change it; keep user draft
equivalent(server, user) -> both converged; auto-resolve
otherwise                -> record a three-way conflict
```

This is the existing column-aware three-way merge requirement ([editing and conflicts](../editing-and-conflicts.md#L55-L145)). With BigDecimal, base `1.50`, server `1.5`, and user `1.500` must converge rather than create a conflict.

The same equivalence must decide whether a draft is dirty and whether a successful canonical server response still differs from the submitted user value. Do not use:

- object identity;
- `===` for BigDecimal;
- formatted display strings;
- `JSON.stringify` of runtime objects;
- `Number(...)`.

The sparse draft and conflict stores retain native exact values. They are session state and are not persisted as preferences.

## Client sorting

TanStack v9 supports explicit sort functions and passes raw cell values into the configured comparator ([TanStack sorting functions](../../../.repos/table/packages/table-core/src/features/row-sorting/sortFns.ts#L14-L68)). BrunoTable should install one internal sort function per exact-numeric semantics plan.

Do not use TanStack's automatic or basic functions for BigDecimal. Auto sorting samples up to ten rows and falls back to `basic` for unrecognized objects ([TanStack row sorting](../../../.repos/table/packages/table-core/src/features/row-sorting/rowSortingFeature.utils.ts#L96-L165)); `basic` uses strict equality followed by JavaScript relational comparison ([TanStack sorting functions](../../../.repos/table/packages/table-core/src/features/row-sorting/sortFns.ts#L128-L141)). That is sufficient for native bigints but wrong for separately allocated semantically equal BigDecimals.

For parity with effect-view-server, the View Server integration should also adopt its null and tie behavior:

- nullish values rank before numeric values in ascending order;
- descending reverses that order;
- same-domain exact numeric values use the exact comparator;
- user sort ties end with canonical row `id` as the deterministic tie-breaker.

effect-view-server's value ranking and exact numeric comparison are defined in its query-value module ([effect-view-server query value](../../../../effect-view-server/packages/column-live-view-engine/src/query-value.ts#L120-L177)), and its query semantics specify the final `id` tie-breaker ([effect-view-server query semantics](../../../../effect-view-server/docs/query-semantics.md#L145-L151)). If BrunoTable intentionally chooses different null placement for generic sources, that choice must be explicit; an effect-view-server Client Table and Server Table should not reorder identical data merely because the row model changed.

A Server Table never locally re-sorts the loaded viewport window. It passes sort intent to the source, which owns the global row order.

## Client and server filtering

TanStack's built-in filters are not safe exact-numeric semantics:

- `equals` uses `===` ([TanStack filter functions](../../../.repos/table/packages/table-core/src/features/column-filtering/filterFns.ts#L70-L90));
- greater-than coerces with unary `+` and `Number(...)` ([TanStack filter functions](../../../.repos/table/packages/table-core/src/features/column-filtering/filterFns.ts#L482-L499));
- numeric range filtering parses endpoints with `parseFloat` and uses JavaScript numbers ([TanStack filter functions](../../../.repos/table/packages/table-core/src/features/column-filtering/filterFns.ts#L277-L312)).

BrunoTable must install custom exact filters for the Client Row Pipeline. TanStack's `resolveFilterValue` hook is useful because the operand can be parsed/normalized once before rows are tested ([TanStack filter functions](../../../.repos/table/packages/table-core/src/features/column-filtering/filterFns.ts#L10-L38)). Row-side comparison then calls the compiled semantics directly.

The Grid Filter model should keep native operands in memory. For the Server Row Pipeline, translation changes only `columnId` to the current `field`; the operand remains a native `bigint` or BigDecimal. effect-view-server's query types preserve `number`, `bigint`, and BigDecimal branches and correlate both `inRange` endpoints to the same numeric domain ([effect-view-server query filter](../../../../effect-view-server/packages/config/src/query-filter.ts#L178-L218)). The viewport `replace` request accepts that typed query directly and adds only `offset` and `limit` internally ([effect-view-server viewport source](../../../../effect-view-server/packages/react/src/live-query-viewport.ts#L58-L97), [window translation](../../../../effect-view-server/packages/react/src/live-query-viewport.ts#L275-L287)).

Do not pre-encode server filter operands as persistence strings and do not convert them to numbers. The effect-view-server protocol owns schema-aware wire encoding.

### `inRange` must be half-open

BrunoTable's public docs already choose effect-view-server's operator vocabulary, but the endpoint rule must be made explicit. effect-view-server defines `inRange` as:

```text
filter <= value < filterTo
```

([effect-view-server query semantics](../../../../effect-view-server/docs/query-semantics.md#L41-L56)). TanStack's built-in `inNumberRange` is inclusive at both ends ([TanStack filter functions](../../../.repos/table/packages/table-core/src/features/column-filtering/filterFns.ts#L277-L307)). Using it would make Client and Server Tables disagree at the upper endpoint. BrunoTable should implement half-open `inRange` in both paths, or introduce differently named operators; it must not leave the difference implicit.

## Clipboard, paste, fill, and blank values

Exact numeric clipboard defaults should use canonical text:

- `bigint`: signed base-10 digits;
- BigDecimal: the Effect-compatible canonical plain/scientific string;
- nullish blank values: empty text only when the destination column has an explicit blank policy.

Copying a display-formatted value should require an explicit clipboard formatter. If it is intended to round-trip, it also needs a matching clipboard parser. The safe default remains canonical exact text. AG Grid, by comparison, applies its display formatter on copy and parser on paste ([AG Grid clipboard](../../../.repos/ag-grid/documentation/ag-grid-docs/src/content/docs/clipboard/index.mdoc#L128-L138), [clipboard service](../../../.repos/ag-grid/packages/ag-grid-enterprise/src/clipboard/clipboardService.ts#L1138-L1179)); BrunoTable should separate the channels to prevent a localized display formatter from silently corrupting pasted values.

Paste processing should:

1. parse TSV into candidate text cells;
2. reject a source whose row and column counts both exceed one before target or exact-value parsing;
3. permit a 1×1 broadcast, allow an exact orientation-and-length match for a `1×N` or `N×1` source, and route every other supported linear mismatch to Paste Confirmation;
4. after direct or confirmed linear-range handling, resolve each loaded destination cell and exact column semantics;
5. parse and validate every target;
6. abort the whole transaction if any target fails or is unavailable;
7. otherwise submit one typed multi-cell transaction.

Do not tile, repeat, transpose, clip, construct a two-dimensional target, or coerce candidates by equal total cell count. Unsupported two-dimensional input and supported linear mismatch are identified before exact numeric parsing; linear parsing waits for explicit confirmation of the proposed source-oriented destination, preventing unnecessary hostile-input work for a gesture the user may cancel.

This follows the existing rule that server viewport operations must not silently perform partial work and that Immediate multi-cell operations remain one save call ([grid requirements](../requirements.md#L350-L382), [grid requirements](../requirements.md#L319-L325)).

Drag Fill repeats canonical source text through each target column's parser and complete-vector validation. It never increments, extrapolates, or performs arithmetic for `number`, `bigint`, BigDecimal, dates, text, or custom values. Exact numeric Value Types therefore need no fill-specific addition or subtraction capability.

## Preference persistence

Runtime filter state and persisted filter data need different representations. Runtime state should retain native typed operands for filtering and server query translation. Persisted state must be JSON-safe, versioned, and decodable from untrusted input.

Use an outer preferences format version plus a codec tag on any exact-numeric filter leaf. One possible wire shape is:

```json
{
  "formatVersion": 1,
  "filters": [
    {
      "columnId": "COL_ID_QUANTITY",
      "type": "greaterThan",
      "operandCodec": "bruno/bigint",
      "operandCodecVersion": 1,
      "filter": "9007199254740993"
    },
    {
      "columnId": "COL_ID_PRICE",
      "type": "inRange",
      "operandCodec": "effect/BigDecimal",
      "operandCodecVersion": 1,
      "filter": "1.25",
      "filterTo": "2.5"
    }
  ]
}
```

The exact envelope may change, but it must distinguish a string-valued filter from an encoded exact numeric filter. A naked `bigint` is not a strict JSON value ([effect-view-server ADR 0003](../../../../effect-view-server/docs/adr/0003-canonical-topic-row-value-semantics.md#L34-L44)), and BigDecimal persistence must use the schema codec rather than a runtime object's diagnostic `toJSON` shape. AG Grid similarly stores BigInt filter values as canonical decimal strings rather than native bigints ([AG Grid BigInt filter model](../../../.repos/ag-grid/packages/ag-grid-community/src/filter/provided/bigInt/iBigIntFilter.ts#L6-L19), [AG Grid BigInt filter documentation](../../../.repos/ag-grid/documentation/ag-grid-docs/src/content/docs/filter-bigint/index.mdoc#L37-L49)).

On restore:

1. decode the outer format version;
2. locate the current `columnId`;
3. require the column's current codec ID and version to match or run an explicit migration;
4. decode the operand through that column's semantics;
5. validate the current operator and capability;
6. validate the current server field mapping for a Server Table;
7. drop the leaf conservatively on any failure.

Never coerce a stale string with `Number`, `BigInt`, or a generic BigDecimal parser merely because it looks numeric. The persisted codec tag, current Column Identity, and current semantics must agree. This extends the accepted requirement to sanitize versioned filters against current definitions ([public API design](../public-api-design.md#L509-L517)).

Sorting contains no numeric operand, so its persisted shape remains `columnId + direction`. Drafts, conflicts, save attempts, row values, and source versions remain transient and are not preferences.

## effect-view-server transport

The integration boundary should preserve native values in both directions:

```text
restored preference string
  -> column persistence decoder
  -> native bigint / BigDecimal filter operand
  -> columnId-to-field translation
  -> viewport.replace(query with native operand)
  -> effect-view-server schema wire codec

wire row
  -> effect-view-server schema decoder
  -> native bigint / BigDecimal row value
  -> viewport sink
  -> BrunoTable row store
```

effect-view-server compiles schema-derived Topic Row semantics once, uses `Schema.toCodecJson` as its canonical wire authority, and reuses compiled codecs/equivalence functions ([effect-view-server ADR 0003](../../../../effect-view-server/docs/adr/0003-canonical-topic-row-value-semantics.md#L17-L32), [effect-view-server ADR 0003](../../../../effect-view-server/docs/adr/0003-canonical-topic-row-value-semantics.md#L56-L66)). BrunoTable should mirror that lifecycle: decode at ownership boundaries, compile column plans once, then keep trusted hot paths direct.

The source's top-level `version` is a query snapshot/delta version, not a per-row optimistic-concurrency token. Snapshot and delta events carry query versions around collections of row operations ([effect-view-server live protocol](../../../../effect-view-server/packages/config/src/live-protocol.ts#L1-L48)). BrunoTable must not use `viewportSource.version` as a row's `expectedVersion`.

Editable Client Tables therefore require `getRowVersion(row)`. Its inferred return type may itself be `bigint`; the save model derives and preserves that exact type rather than hard-coding `string`. The complete Client Source retains the token even when no visible column uses it.

There is also no compare-and-set argument in effect-view-server's current runtime `patch` API; it accepts `topic`, `key`, and a typed partial row only ([effect-view-server runtime client](../../../../effect-view-server/packages/config/src/runtime-contract.ts#L198-L218)). Source-owned topics reject direct runtime mutations as well. Consequently:

- `onSaveEdits` must call an application write/RPC boundary that enforces optimistic concurrency;
- the read-side viewport version cannot provide that guarantee;
- a convenience Effect adapter must not implement saves by blindly calling `runtime.client.patch`;
- the application write authority resolves or rejects the atomic Save Operation, while canonical values and new Row Versions arrive only through the live Client Source as required by the save workflow.

## Save and conflict workflows

`BrunoTableCellChange` already correlates `before` and `after` with the exact Column Identity value type ([current `public-types.ts`](../../../packages/table/src/public-types.ts#L207-L223)). Preserve that strength while adding exact source `field` correlation inside the final non-empty row-grouped Save Change Set.

The handler receives native exact values, not persisted strings:

```ts
type ExampleChange = {
  readonly columnId: "COL_ID_PRICE";
  readonly field: "price";
  readonly before: BigDecimal.BigDecimal;
  readonly after: BigDecimal.BigDecimal;
};
```

Each enclosing row change carries `rowId`, the latest safely rebased `baseRow`, and its exact `expectedVersion`. Serialization belongs to the application Adapter/RPC boundary. `onSaveEdits` returns only `PromiseLike<void>`; canonical exact values and Row Versions are decoded by the live Client Source before they enter trusted grid state. Application validation, permission, and transient failures reject with an ordinary user-safe `Error` rather than a typed result payload.

If a server canonicalizes `1.50` to `1.5`, semantic equality marks the successful edit clean. If a newer server value differs semantically, the grid uses the same three-way conflict workflow. Immediate and Batch modes continue to call the same handler shape; exact numeric support adds no mode branch.

## Performance design

Exactness does not require work on every frame.

### Compile once

During column normalization, resolve:

- runtime decoder;
- equality and comparator;
- canonical formatter/parser;
- persistence codec and version;
- TanStack client filter and sort bridges;
- blank/clear policy.

Store direct function references in the normalized internal column. Do not look up a registry by string, inspect schema ASTs, or detect `BigDecimal` inside every cell render/comparison.

### Validate at boundaries

Run hostile-input decoding for:

- restored preferences;
- editor and clipboard text;
- generic/untrusted source ingestion;
- live-source save reconciliation.

Official effect-view-server rows have already crossed its schema/protocol boundary. The Adapter may assert its contract once when ingesting a batch; mounted cells should not repeatedly reflect over object prototypes.

### Cache only where it pays

- Cache BigDecimal canonical text and comparison metadata by object identity in a `WeakMap` or the immutable row/cell snapshot.
- Do not use an unbounded global `Map<bigint, string>` for primitive bigints.
- Parse each filter operand once when filter state changes.
- Reuse canonical clipboard text within one bulk operation.
- Invalidate cell-local cached text only when the exact value reference/value changes.
- Preserve unchanged row references as required by the row-store architecture.

BigDecimal comparison should remain `O(coefficient digits)`. It must never become `O(scale difference)` or allocate a power-of-ten bigint. Client sorting still performs `O(n log n)` comparisons, so realistic benchmarks must include wide coefficients and not only two-digit prices.

### Keep React out of it

Value-semantics work belongs in normalized columns, row pipelines, edit transactions, and imperative clipboard operations. It creates no new top-level React state. A streaming exact numeric update notifies only the affected row/cell and any compact edit count whose projection actually changed.

## Security and failure policy

Editor input, clipboard text, persisted preferences, generic source values, and Save Operation rejection values are untrusted boundaries. Treat parser, decoder, and error-normalization failures as data, not exceptions escaping through React event handlers.

Rules:

- never call `toString`, `valueOf`, or a formatter on an unknown object before decoding it;
- never trust a BigDecimal-looking structural object based only on `{ value, scale }`;
- never use `Number` as validation;
- apply bounded work policies to user-provided text and bulk cell counts;
- reject or drop invalid persisted operands conservatively;
- abort multi-cell local operations atomically rather than applying a valid prefix;
- let the server validate and authorize every save; client parsers and editor hooks are convenience and feedback, not a security boundary.

effect-view-server's hostile BigDecimal inspection verifies the prototype brand, own enumerable coefficient/scale data, safe-integer scale, and canonical wire safety while catching reflection failure ([wire-safe BigDecimal inspection](../../../../effect-view-server/packages/effect-utils/src/wire-safe-big-decimal.ts#L20-L119)). BrunoTable should reuse a public version of that boundary or an equivalent audited decoder in the optional integration.

## Required verification matrix

### Type-level tests

- Exact `bigint` and BigDecimal value inference for field and computed columns.
- Correct numeric operators and exact operand types.
- Rejection of `number` operands for `bigint`/BigDecimal columns.
- Rejection of automatic ordered semantics for mixed numeric domains.
- Nullable clear-policy requirements.
- Exact edit, validation, conflict, Save Change Set, and Accepted Overlay correlation by Column Identity.
- Exact row-version inference, including `bigint` versions.
- No Effect import requirement from `@bruno/table` root declarations.

### Unit and property tests

- Bigints beyond `Number.MAX_SAFE_INTEGER` render, parse, compare, persist, and round-trip.
- Negative values, zero, leading-zero input, rejected plus/exponent/hex forms, and blank policy.
- BigDecimal `1.5`, `1.50`, and `1.500` are equivalent.
- Positive/negative zero and normalized negative scales.
- Plain and exponent-format round trips.
- Rejection of non-injective/unsafe BigDecimal wire values.
- Huge safe-integer scale differences compare without exponentiation, runaway allocation, or hanging.
- Ordering laws: reflexivity, antisymmetry, transitivity, and `compare === 0` iff equivalent.
- Half-open `inRange` boundaries.
- Null/missing ordering and final row-ID ties match effect-view-server.
- Tampered, stale-version, wrong-codec, and wrong-column persisted operands are dropped.
- Canonical clipboard copy/paste and atomic multi-cell failure.
- Conflict truth table with differently scaled but equivalent BigDecimals.
- Live canonical convergence clears semantically equivalent drafts.

### Cross-repository contract tests

For the optional effect-view-server integration, generate admitted BigDecimals and compare:

- BrunoTable client comparator versus effect-view-server ordering;
- BrunoTable client filters versus effect-view-server query results for every operator;
- canonical persistence decode versus effect-view-server query operand admission;
- BigDecimal equality used by drafts/conflicts versus View Server semantic equality;
- null placement and row-ID tie-breaking.

Include pathological safe scales and large coefficients, not only ordinary currency values. Pin the source snapshot or public semantics API version so upstream changes fail visibly.

### Performance gates

- 100k-row client sort for `bigint` and representative BigDecimal widths.
- Filter throughput with a precompiled operand.
- 120-row visible streaming updates at 20 Hz without toolbar/root rerenders.
- Large clipboard formatting/parsing within the existing bulk-operation budget.
- Memory behavior of BigDecimal `WeakMap` caches after row eviction.
- A regression test proving comparator work depends on coefficient digits, not scale difference.

## Implementation sequence

1. Add the public Value Type and internal Column Value Semantics vocabulary plus capability-derived filter typing.
2. Ship and test the core `bigint` semantics.
3. Separate display formatting from canonical edit/clipboard text.
4. Add tagged, versioned persistence encoding for exact filter operands.
5. Install custom TanStack client sort/filter functions, including half-open range semantics.
6. Route draft dirtiness and conflict reconciliation through column equivalence.
7. Finalize exact row-version typing, the void Save Operation boundary, and live-source reconciliation.
8. Expose or reproduce effect-view-server's wire-safe BigDecimal semantics with parity tests.
9. Ship the optional Effect BigDecimal adapter only after the safe-comparator and wire-admission tests pass.
10. Add realistic exact-numeric performance gates before enabling the feature by default.

## Rejected approaches

- Converting `bigint` or BigDecimal to `number` for rendering, sorting, filtering, charts, fill, persistence, or saves.
- Sampling the first loaded row to infer a value kind.
- Treating `valueFormatter` as equality, comparison, clipboard, persistence, or server-query semantics.
- Using `===`, generic object comparison, or JSON stringification for BigDecimal equality.
- Calling Effect's scale-aligning `Order`/`Equivalence` on unrestricted effect-view-server BigDecimals.
- Storing native `bigint` in persisted JSON.
- Using `BigDecimal.prototype.toJSON()` as the View Server/persistence codec.
- Mapping blank input to zero.
- Sending persistence strings instead of native operands to `viewport.replace`.
- Locally sorting or filtering only the loaded Server Table window.
- Using the Viewport Source's query version as a row concurrency token.
- Implementing `onSaveEdits` with effect-view-server's unconditional runtime `patch` call.
- Making Effect mandatory for core BrunoTable consumers.
- Executing or scanning row/package code to discover semantics.

## Final recommendation

`bigint` can be a first-class BrunoTable built-in now. Effect `BigDecimal` should be first-class through an optional adapter, but only after BrunoTable has a reusable exact value-semantics seam and shares effect-view-server's allocation-safe comparison and wire-admission rules.

The important product property is not merely that a cell can display `123.45`. It is that the same exact value means the same thing in a rendered cell, a filter, a sort, a pasted range, a persisted view, a save payload, and a three-way conflict—without precision loss, false conflicts, row-model divergence, or pathological scale allocations.
