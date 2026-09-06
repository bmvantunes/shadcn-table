# React Compiler boundaries

React Compiler is enabled with the shared strict policy in every BrunoTable and shadcn React build,
source Browser, production Browser, and emitted-consumer Browser configuration. Library packing uses
the same compiler factory as source transforms. The executable contract lives in
`packages/table/src/internal/react-compiler-contract.test.ts` and rejects an uncompiled React plugin
registration or an unlisted `"use no memo"` directive.

## Current escape-hatch allowlist

| Private function                                                     | Reason                                                                                                                                                                                                                         | Removal follow-up                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `useBrunoTableServerFacetHookSource` in `react-compiler-adapters.ts` | The Server source supplies a hook method through a stable source object. The bridge must read and commit that changing method explicitly so React Compiler cannot freeze the previous hook behind stable source identity.      | [#96 — Remove the Server facet React Compiler escape hatches](https://github.com/bmvantunes/shadcn-table/issues/96) |
| `useBrunoTableServerWholeResult` in `server-facet.tsx`               | The View Server integration invokes a consumer-owned hook discovered through an opaque source object. React Compiler cannot prove the reflective hook call's reactive dependencies without a source-owned declarative Adapter. | [#96 — Remove the Server facet React Compiler escape hatches](https://github.com/bmvantunes/shadcn-table/issues/96) |

Issue #96 owns the declarative, source-owned Server facet Adapter needed to remove both escape
hatches. The executable allowlist requires its immutable tracker URL for every retained boundary and
rejects missing or malformed follow-up links.

On every React, React Compiler, TanStack Table, or View Server integration upgrade, rerun the
compiler-on Browser suites and attempt to remove both directives before retaining this allowlist.
