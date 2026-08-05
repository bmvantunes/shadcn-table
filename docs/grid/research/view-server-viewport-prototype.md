# View Server viewport prototype verdict

Research and prototype verdict: 2026-08-05.

Primary source: throwaway [`codex/prototype-view-server` prototype at `0f65a67`](https://github.com/bmvantunes/shadcn-table/tree/0f65a67/packages/view-server-prototype).

## Question

Can `BrunoTableServer` compile its strict column, filter, sorting, grouping, projection, Feed Route,
and viewport state directly into the published `effect-view-server@2.1.0` API while preserving
source-owned identity and fine-grained sparse-store behavior?

## Verdict

Yes, with a private View Server Adapter that owns semantic Query Generation and sparse cache
authority. The published package accepts exact raw and grouped viewport queries, returns
authoritative raw and group keys beside absolute row indexes, preserves native `bigint` and
BigDecimal aggregate values, and supports separate live whole-result subscriptions for open Set
Filter facets.

Two upstream lifecycle/query semantics must land in a compatible release before the production
Server Adapter is complete: [effect-view-server#408](https://github.com/bmvantunes/effect-view-server/issues/408)
and [effect-view-server#409](https://github.com/bmvantunes/effect-view-server/issues/409).

## Browser observations

The prototype seeded 240 rows into the in-browser View Server runtime and mounted one 20-row raw
window. Every delivered row had an authoritative source key and the sink recorded zero identity
failures.

Moving the logical window from indexes `0–19` to `5–24` retained Query Generation `1`, reused the
15-row overlap, and wrote only the five new slots. The Adapter did not interpret the source's
`setRowCount(..., keepRenderedRows)` argument as generation authority.

Rapid Quick Filter inputs `A`, `AA`, and `AAP` produced exactly one semantic replacement after the
150 ms TanStack Pacer debounce. The replacement advanced the Adapter generation, cleared old rows
and count, and ignored the previous sink thereafter.

With Quick Filter `Alpha`, a separately mounted status facet returned 20 live rows for each status.
Publishing one matching high-price order updated the raw result from 60 to 61 rows and the facet's
`closed` count from 20 to 21 without refresh or Apply. Closing the overlay unmounted its whole-result
subscription.

Grouping by `region → status` returned nine groups; grouping by `region` returned three. Both result
shapes delivered authoritative group keys with zero identity failures. `count` and `countDistinct`
arrived as `bigint`; `sum(price)` arrived as Effect BigDecimal; `max(price)` retained the field's
`number` domain.

The compile-only leased-source proof accepted a Feed Route containing all and only the source-owned
`region` and `desk` fields. Missing and extra route fields failed typechecking without a duplicated
BrunoTable route-field declaration.

## Production conclusions

- One semantic change to Feed Route, projection, combined filters, sorting, grouping, or aggregates
  creates one new Adapter-owned Query Generation and calls `viewport.replace`.
- One scroll, overscan, or keyboard-reveal window change stays in that generation and calls only
  `generation.setWindow`.
- Each sink closes over the Adapter generation token. Late writes from any released sink are
  ignored even though public sink messages carry no generation field.
- The sparse store accepts rows and authoritative keys atomically over the same absolute-index set.
  Missing, extra, or invalid keys are rejected rather than reconstructed.
- Same-generation movement retains overlapping slots and exact row references; semantic replacement
  never retains old rows or old `totalRows` under new query meaning.
- Quick Filter compiles to one OR group over explicit Query Fields. Grid Filters and External Filters
  remain root-level AND inputs.
- An open Server Set Filter uses a separate live grouped query that excludes only its own Grid Filter
  and includes Feed Route, External Filters, Quick Filter, and every other Grid Filter.
- Set Filter `only []` needs a source-native Match-None Filter Expression. Enumerating and negating
  the current facet values is incorrect because future values would unexpectedly match.
- The View Server React binding may not invoke consumer sink callbacks from `useInsertionEffect`.
  BrunoTable must require the upstream lifecycle fix instead of delaying or suppressing its store
  publication locally.

The roughly 805 kB prototype bundle is not representative of `@bruno/table`: it deliberately embeds
the complete in-browser View Server runtime, React testing provider, and seeded engine so the
integration can run without Kafka or another process.
