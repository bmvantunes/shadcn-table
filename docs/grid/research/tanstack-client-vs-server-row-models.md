# TanStack client-side versus server-side row models

Research date: 2026-08-08

## Question

Does TanStack Table's new [Client-Side vs Server-Side Guide](https://tanstack.com/table/latest/docs/guide/client-side-vs-server-side) change BrunoTable's Client or Server architecture, and which details should its normative documents make explicit?

## Sources and scope

This review used only first-party sources:

- TanStack Table v9's new comparison guide, pinned in the vendored `9.0.0` source at commit [`d4d91a6`](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md)
- the pinned v9 [row-model pipeline](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/row-models.md#L158-L168) and [pipeline implementation](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/packages/table-core/src/core/row-models/coreRowModelsFeature.utils.ts#L49-L253)
- the pinned v9 [stable-data guidance](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/data.md#L192-L228) and the installed `@tanstack/table-core@9.0.0` declarations
- TanStack's v9 [With TanStack Query](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/examples/react/with-tanstack-query/src/main.tsx#L52-L83) and [Virtualized Infinite Scrolling](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/examples/react/virtualized-infinite-scrolling/src/main.tsx#L88-L178) examples
- TanStack's first-party [v9 memory benchmark explanation](https://tanstack.com/blog/tanstack-table-v9-memory-performance)
- effect-view-server `2.3.0`'s pinned [switch-latest Viewport contract](https://github.com/bmvantunes/effect-view-server/blob/1655f7bae897bcdd2a62b26b1e86737fbf400907/packages/effect-view-server/README.md#L88-L95)
- BrunoTable's current [requirements](../requirements.md), [public API design](../public-api-design.md), [architecture](../architecture.md), [server viewport model](../server-viewport-model.md), [implementation plan](../implementation-plan.md), and [domain context](../../../CONTEXT.md)

## Conclusion

The guide is useful, but it does **not** call for a different BrunoTable public API or row model. It mostly validates decisions already made:

- a Client Table receives the complete working set and owns whole-result processing locally;
- a Server Table receives a sparse authoritative result and delegates whole-result filtering, grouping, aggregation, sorting, and faceting to effect-view-server;
- rendering virtualization is independent from data-processing ownership;
- the Server variant is a continuous absolute-index viewport, not pagination or append-only infinite loading; and
- TanStack Table remains a private state and row-processing engine rather than BrunoTable's backend integration.

The most valuable additions are implementation guardrails: define exactly how server-owned TanStack stages are bypassed, prohibit partial local processing over sparse slots, distinguish View Server `totalRows` from TanStack pagination `rowCount`, and explicitly reject the append-only TanStack Query example as the Server implementation template.

## Finding matrix

| TanStack finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Classification for BrunoTable                                                                                                                                                                                                                                 | Recommendation                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filtering, grouping, sorting, aggregation, and pagination normally form one pipeline over one dataset. A local stage after a server subset processes only that subset. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L68-L76)                                                                                                                                                                                                       | The individual decisions are already correct, but the single whole-result invariant is not stated prominently.                                                                                                                                                | **Clarify.** State that `BrunoTableServer` never intentionally mixes a local whole-result stage into its sparse server pipeline.                                                                                                                    |
| A `manual*` option only bypasses a client transformation; it does not fetch, translate a query, or provide a server row model. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L78-L99)                                                                                                                                                                                                                                               | `public-api-design.md` says the Server variant uses manual processing, but does not define the private feature/row-model registration plan precisely.                                                                                                         | **Clarify and test.** Keep all flags private. Prefer a Server feature set that registers required state/APIs but omits local row-model factories; use the matching bypass when a shared internal configuration includes one.                        |
| `manualAggregation` is independent of `manualGrouping`; it disables local aggregation fallback such as `column.getAggregationValue()`. [Types](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/packages/table-core/src/features/row-aggregation/rowAggregationFeature.types.ts#L330-L337), [implementation](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/packages/table-core/src/features/row-aggregation/rowAggregationFeature.utils.ts#L414-L466) | This is a genuinely useful internal nuance. Manual grouping alone does not protect Server Aggregate Cells from an accidental local fallback.                                                                                                                  | **Adopt.** If the Server composition installs TanStack aggregation APIs, explicitly disable local aggregation and test that aggregates always come from the View Server result.                                                                     |
| Full-result facets must be server-owned when only a subset is resident. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L68-L76)                                                                                                                                                                                                                                                                                                      | Already covered strongly: an open Server Set Filter has a separate live whole-result facet subscription and never derives counts from sparse loaded slots.                                                                                                    | **No design change.** Add the comparison guide as traceability if the normative section is touched.                                                                                                                                                 |
| Server-owned state must participate in request identity, and stale slower results must not replace newer results. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L101-L109)                                                                                                                                                                                                                                                          | Already covered more completely by Query Generations: Feed Route, projection, External/Grid/Quick Filters, sorting, grouping, and aggregates define semantics; late old deliveries are ignored.                                                               | **No design change.** Keep BrunoTable's broader exact-semantic generation key instead of copying a TanStack Query key literally.                                                                                                                    |
| Table `data` and `columns` references are memoization inputs. A new `data` reference rebuilds core rows and cells plus downstream models; a new `columns` reference rebuilds column/header structures. [Data guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/data.md#L192-L228)                                                                                                                                                                                      | Stable module-scope columns and unchanged row references are already required. Stability of the complete array/projection passed into TanStack is less explicit.                                                                                              | **Clarify and benchmark.** Do not allocate an equivalent `data` array in render or for an unrelated source-chrome update. Change the array only for a meaningful source or processed-projection publication while preserving unchanged row objects. |
| Virtualization limits mounted rendering; it does not reduce fetched data or client row-model work. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L169-L176)                                                                                                                                                                                                                                                                         | Already covered by separate complete Client ownership, sparse Server ownership, and two-axis rendering virtualization.                                                                                                                                        | **No design change.** Preserve this separation in implementation and benchmarks.                                                                                                                                                                    |
| The official infinite example appends pages, flattens every fetched page, virtualizes `rows.length`, and fetches again near the bottom. [Example](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/examples/react/virtualized-infinite-scrolling/src/main.tsx#L88-L178)                                                                                                                                                                                                                 | This conflicts with BrunoTableServer's exact `totalRows`, random-access absolute indexes, direct scrollbar jumps, bounded sparse retention, and `generation.setWindow`.                                                                                       | **Explicitly reject as a Server template.** It is a valid append-only pattern, but it must not become BrunoTable's View Server Adapter.                                                                                                             |
| TanStack's `rowCount` and `pageCount` are inputs to manual pagination math. [Pagination types](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/packages/table-core/src/features/row-pagination/rowPaginationFeature.types.ts#L10-L41)                                                                                                                                                                                                                                                  | BrunoTable registers no pagination feature. View Server `totalRows` instead defines the sparse virtualizer's logical height and absolute end.                                                                                                                 | **Explicitly reject the mapping.** Never pass effect-view-server `totalRows` to TanStack pagination `rowCount`, and never register `rowPaginationFeature` merely to expose a count.                                                                 |
| TanStack Query is an optional fetching/cache companion; Table itself neither fetches nor supplies a server-side row model. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L95-L111)                                                                                                                                                                                                                                                  | The transferable ideas—one authority, complete request identity, intentional loading continuity, stale-result rejection—are already implemented by effect-view-server's live source and BrunoTable Query Generations. Adding Query would duplicate ownership. | **Reject for the first-party Server Adapter.** It may be relevant to a future generic request/page Adapter, but not as a wrapper around effect-view-server.                                                                                         |
| Generic request-driven tables should use a stable backend identifier through `getRowId`. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L167)                                                                                                                                                                                                                                                                                        | This is an apparent, not real, conflict. BrunoTableServer receives the stronger authoritative row-key channel from its Viewport Source, so consumer reconstruction would create a second identity authority.                                                  | **Explicitly retain the current rule.** `getRowId` stays mandatory for Client and forbidden for Server.                                                                                                                                             |
| v9 reports usable million-row stress tests and a roughly 10–16 million-row memory ceiling in narrow benchmarks. [Guide](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/docs/guide/client-side-vs-server-side.md#L43-L64), [benchmark explanation](https://tanstack.com/blog/tanstack-table-v9-memory-performance)                                                                                                                                                                     | This is genuinely new capacity evidence, but not evidence of 120 Hz interaction, low latency, or an acceptable complete-data fetch for BrunoTable. The published high-row memory cases use far fewer than 150 columns and isolate TanStack object memory.     | **Do not adopt a numeric cutoff.** Benchmark representative row widths, 150 columns, exact formatters, grouping/filter work, live churn, editing, target hardware, transfer size, memory, and the 8.33 ms frame budget.                             |

## Internal TanStack feature boundary

TanStack's built-in pipeline is:

```text
core -> filtered -> grouped -> sorted -> expanded -> paginated
```

When a stage is manual, its implementation returns the preceding model rather than invoking a backend. The v9 source performs that bypass independently for filtering, grouping, sorting, expanding, and pagination ([pipeline implementation](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/packages/table-core/src/core/row-models/coreRowModelsFeature.utils.ts#L49-L253)); aggregation has its own separate manual fallback guard.

That gives BrunoTable two private compositions:

```text
Client Source (complete)
  -> local filter
  -> local flat grouping + aggregation when read-only and active
  -> local sort
  -> complete continuous virtual row projection

Viewport Source (sparse, already processed)
  -> no local whole-result filter
  -> no local grouping or aggregate fallback
  -> no local whole-result sort
  -> no pagination stage
  -> sparse continuous virtual row projection
```

The Server composition may retain TanStack feature state and APIs for BrunoTable-owned controls. That does not authorize a local row-model stage. The actual integration is the View Server Translation Adapter plus the source generation/window protocol; `manual*` is only a private guard against running a TanStack transform.

## Why the TanStack Query examples are not the View Server design

The ordinary Query example demonstrates a good generic ownership rule: table state enters the query key, the result is passed directly to the table, previous data is retained deliberately, and `manualPagination` declares that the received array is already one page ([example](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/examples/react/with-tanstack-query/src/main.tsx#L52-L83)). Those concepts are relevant, but its pagination mechanism is forbidden by BrunoTable's continuous row-space contract.

The infinite example is even less suitable for the View Server Adapter. It fetches sequential page parameters, retains and flattens every page, makes the virtualizer's count equal the number already fetched, and asks for another page only near the current bottom ([example](https://github.com/TanStack/table/blob/d4d91a6cd6caa96b8d3bdb327b894b6125605350/examples/react/virtualized-infinite-scrolling/src/main.tsx#L88-L178)). A jump to an arbitrary unloaded absolute index is not represented.

effect-view-server already supplies the capabilities those examples assemble from Query and an HTTP API: live lifecycle, exact result count, sparse absolute-index delivery, semantic query replacement, window movement, and [source-owned switch-latest delivery](https://github.com/bmvantunes/effect-view-server/blob/1655f7bae897bcdd2a62b26b1e86737fbf400907/packages/effect-view-server/README.md#L88-L95). BrunoTable adds a Query Generation guard at the Adapter boundary. Wrapping that source in TanStack Query would add a competing cache and lifecycle authority without supplying a missing capability.

## Exact documentation follow-ups

No normative file was changed by this research task. The following changes are recommended when the corresponding implementation slice begins:

1. **`docs/grid/public-api-design.md` — `TanStack Table seam`**
   - State that manual flags are private bypasses, never backend integrations or public props.
   - Define the Server feature composition: keep only required state/API features, omit local filtered/grouped/sorted row-model factories, and explicitly disable local aggregate fallback when aggregation APIs are present.
   - State that neither `rowPaginationFeature`, `manualPagination`, TanStack `rowCount`, nor `pageCount` belongs in either public variant.

2. **`docs/grid/requirements.md` — `Client row model`, `Server viewport row model`, and filtering/grouping requirements**
   - Add one whole-result ownership invariant: Client stages operate on the complete Client Source; Server filtering, grouping, aggregation, sorting, and full-domain faceting are all source-owned, with no intentional local-on-loaded-subset mode in V1.
   - Keep the current separate live Server facet subscription as the consequence of that invariant.

3. **`docs/grid/server-viewport-model.md` — `Viewport requests` and `Row count`**
   - Explicitly distinguish the absolute sparse window protocol from TanStack's append-only infinite-query example.
   - Add that View Server `totalRows` is virtual geometry/source authority and must not be routed through TanStack pagination metadata.
   - Note that TanStack Query must not wrap the first-party effect-view-server source.

4. **`docs/grid/architecture.md` — TanStack/Adapter performance boundary**
   - Require stable `columns` and stable TanStack `data`/projection array references between meaningful publications, in addition to stable unchanged row objects.
   - Prohibit render-time `map`, `filter`, spread, or fallback-array creation that invalidates TanStack's memoized core row model.

5. **`docs/grid/implementation-plan.md` — row-pipeline and performance verification**
   - Add tests proving a Server configuration cannot run local filter, grouping, aggregation fallback, or sort over loaded sparse slots.
   - Add a test that source `totalRows` drives virtual geometry without installing pagination.
   - Add a stable-reference regression/benchmark showing that an unrelated lifecycle or same-generation publication does not rebuild all TanStack rows/cells.
   - Keep performance acceptance based on representative BrunoTable workloads rather than TanStack's maximum-row memory benchmark.

6. **`CONTEXT.md`**
   - No change is required. `Client Source`, `Server Table`, `Viewport Source`, `Continuous Row Space`, `Query Generation`, and source-owned Server identity already express the correct domain boundary.

## Final recommendation

Adopt the guide as an architectural cross-check, not as a new implementation recipe. Its strongest contribution is a simple rule BrunoTable should make impossible to violate: **never run a supposedly whole-result client stage over a sparse Server viewport**. Preserve the existing explicit Client/Server variants, continuous virtual row space, source-owned Server identity, and effect-view-server Query Generation design.
