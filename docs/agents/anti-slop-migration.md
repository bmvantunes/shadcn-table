# Anti-slop migration ledger

This ledger records the repository-wide anti-slop migration from the pinned
`origin/main` merge base `4249e9296bb92878aebed2cca6a81c4f63a96186`.

## Baseline and final evidence

The first complete `vp lint --format json` run found 321 diagnostics. The
committed [diagnostic summary](./anti-slop-diagnostics.json) records the exact
baseline categories, the intermediate rule review, and the final zero-
diagnostic result. It is intentionally a sanitized summary rather than a
checkout-specific temporary capture.

| Diagnostic category                                         |   Count |
| ----------------------------------------------------------- | ------: |
| `require-safety-comment-for-type-assertion`                 |     249 |
| `no-chained-type-assertions`                                |      66 |
| TypeScript migration fallout (`TS2578`, `TS2322`, `TS2307`) |       6 |
| **Total**                                                   | **321** |

The TypeScript diagnostics were fixed with explicit owner contracts,
inference-preserving types, and test-project boundary corrections. No rule was
disabled, excluded, downgraded, or suppressed.

## Rule corrections and focused evidence

The vendored generic rules were corrected only after focused fixtures captured
the relevant behavior:

- `no-object-parameters` reports both a bare `object` parameter and a union
  containing `object`.
- `no-unknown-parameters` permits only the `cause` parameter, the sole unknown
  parser input when the return type is a named `*DecodeResult`, and the
  parameter narrowed by an explicit type predicate; unrelated `unknown`
  parameters, including additional parser context, remain errors.
- `no-unknown-returns` reports explicit `unknown` and `Promise<unknown>` return
  contracts without a receiver-wide exception.
- `no-unknown-type-aliases` follows parenthesized, referenced, and union type
  constituents so an alias cannot hide `unknown` behind a larger union.
- `no-unsafe-dictionary-type` permits only a named interface explicitly marked
  with `@anti-slop-dictionary-owner` after its owner has established the
  boundary invariant; unmarked, nested, and anonymous unsafe dictionaries
  remain errors.
- `no-runtime-typeof` rejects extracted or indirect runtime tags while
  permitting direct comparisons against the eight JavaScript `typeof` tags.
  The direct comparison exception is the narrow runtime type-guard contract;
  arbitrary tags and raw tag extraction remain errors.
- `require-safety-comment-for-type-assertion` does not let a function-level
  comment justify assertions nested inside that function; the justification
  must be attached to the assertion or its direct statement owner.

The focused suite covers all 15 enabled rules, checks expected diagnostic codes
and locations, verifies package-local Vite+ configurations, and checks the
corrected bundled assets. It runs through `vp run test:anti-slop` from the root
and both package checks.

The exact source evidence for the 147 intermediate `no-runtime-typeof`
findings is preserved in the committed
[runtime-typeof evidence artifact](./anti-slop-runtime-typeof-evidence.json).

## Validation evidence

The latest standalone validation round completed before the local review round
and produced the following results:

| Gate                                                     | Result                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CI=true vp check`                                       | 257 formatted files; 177 files with no warnings, lint errors, or type errors |
| `vp lint --format json`                                  | 177 files, 127 rules, 0 diagnostics                                          |
| `vp run test:anti-slop`                                  | 10 focused files passed on this exact final worktree                         |
| Root Node suite (`CI=true vp test --project node --run`) | 30 files, 274 tests passed                                                   |
| Root Browser Mode suite                                  | 6 files, 236 tests passed                                                    |
| Root all-project aggregate (`vp run test`)               | 36 files, 510 tests passed                                                   |
| `@bruno/shadcn` Node/Browser suites                      | 10 files/63 tests; 3 files/25 tests passed                                   |
| `@bruno/table` Node/Browser suites                       | 15 files/194 tests; 3 files/211 tests passed                                 |
| Package builds and packed-output assertions              | `@bruno/shadcn` and `@bruno/table` passed                                    |
| Source and emitted consumer type tests                   | source project and both emitted projects passed                              |
| Emitted-package Browser Mode suite                       | 1 file, 4 tests passed                                                       |
| Column-management benchmark                              | completed with 100 samples per measured operation                            |

The installer intentionally refuses to overwrite an existing destination
unless the caller explicitly supplies `--force`; this migration inspected the
destination first and did not use `--force`, as required. The focused asset
test now verifies byte-for-byte parity for every installed implementation file
against the active vendored implementation, including both implementation file
lists. The 10-file focused count includes `no-unknown-type-aliases.test.mjs`
and `require-safety-comment.test.mjs`, which are part of the reviewed patch.

## Intermediate classification

The first rule-correction pass left 147 `no-runtime-typeof` diagnostics. The
committed summary lists the per-file counts. Of those findings, 125 were
direct runtime type guards in package code and 22 were equivalent capability
or test-environment checks in repository hooks and configuration. They were
reviewed as intentional direct comparisons, not silently suppressed project
exceptions. The corrected generic rule now rejects raw and indirect tags while
allowing only valid direct type-tag comparisons.
