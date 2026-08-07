# TanStack Table v9 stable update

Research snapshot: 2026-08-05.

## Version status

The npm `latest` tag now points to `@tanstack/react-table@9.0.0` and `@tanstack/table-core@9.0.0`; the prerelease `beta` tag points to `9.0.0-beta.80`. `@bruno/table` pins stable `9.0.0` exactly, and the vendored source tracks the matching upstream release commit [`d4d91a6`](https://github.com/TanStack/table/tree/d4d91a6cd6caa96b8d3bdb327b894b6125605350).

The temporary pnpm release-age exceptions for beta.74 have been removed. The package tarball audit also requires the exact stable engine version, so a future dependency drift fails prepublication rather than silently changing the private grid engine.

## Revalidation against beta.74

The stable release preserves the React subscription architecture audited for BrunoTable:

- `useTable` still supports a selector at the owning component;
- `table.Subscribe` and standalone `Subscribe` remain the React render boundaries;
- `table.store.subscribe` and slice-atom subscriptions remain imperative APIs;
- the React adapter implementation, table-state guide, and adapter reactivity tests are unchanged from beta.74.

The beta.74-to-stable source delta does contain behavior changes relevant to later prototypes:

- cell-selection keyboard movement now uses the final row model, preventing navigation into rows that are not rendered by the current paginated model;
- filtering fixes cover number-range behavior, filter depth, automatic removal, and custom faceting semantics;
- sorting fixes cover state contents and toggle defaults;
- grouping and expansion received row-model, visibility, and reset corrections.

BrunoTable must therefore validate mechanics against this stable source rather than treating the previous beta findings as frozen behavior. Its deliberate product rules still win where they are stricter—for example, at least one sort is always active, selection is normalized to one axis, and TanStack remains private.

## Prototype baseline

All remaining BrunoTable prototypes start from stable v9.0.0. Before using a Table capability, load its installed TanStack Intent skill and inspect the matching implementation, types, tests, and examples under [`.repos/table`](../../../.repos/table). This keeps the experiments tied to the exact dependency consumers will receive.
