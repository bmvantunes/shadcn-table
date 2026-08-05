# View Server viewport prototype

This throwaway package tests the BrunoTable server-row-model boundary against the published
`effect-view-server` package. It is deliberately not product code.

The prototype covers:

- exact raw projection and server ordering;
- AND-across-columns filters and an OR quick filter over configured fields;
- a live set-filter facet that excludes its own filter while counting values;
- explicit `all-except` / `only` set-filter intent, including a real select-none contradiction;
- raw and grouped viewport queries;
- authoritative row keys for raw rows and aggregate groups;
- semantic query replacement versus same-generation window movement;
- sparse immutable snapshots with stale-generation rejection and stable row reuse;
- live publication while the viewport and facet subscriptions are active;
- grouped `count`, `countDistinct`, `sum`, and `max` result shapes.

Run it with:

```sh
vp run @bruno/view-server-prototype#dev
```

## Verdict

The boundary works with `effect-view-server@2.1.0` without executing consumer package code or
inventing a second query language. BrunoTable should compile its filter, sort, grouping, aggregate,
projection, external-filter, and route inputs directly into View Server queries.

Interactive browser validation produced these results:

- the initial raw query returned 240 rows and mounted a 20-row sparse window with 20 authoritative
  row keys and zero identity failures;
- moving the logical window from `0–19` to `5–24` kept semantic generation `1`, reused the 15-row
  overlap, and wrote only five new rows;
- rapid quick-filter inputs `A`, `AA`, and `AAP` produced one 150 ms debounced semantic replacement;
- with the quick filter set to `Alpha`, the independent live status facet reported 20 rows for each
  status; selecting `None` returned zero rows instead of being normalized to no filter;
- restoring `All` and publishing a matching order updated the raw result from 60 to 61 rows and the
  facet's `closed` count from 20 to 21 without refresh or manual apply;
- grouping by `region → status` returned nine groups, grouping by `region` returned three, and both
  shapes carried authoritative group keys with zero identity failures;
- grouped `sum(price)` arrived as Effect `BigDecimal`, while `count` and `countDistinct` arrived as
  `bigint`;
- the compile-only leased-source proof accepts all and only the source-owned `region` and `desk`
  route fields.

## Decisions proven by the prototype

1. A semantic query change calls `viewport.replace`, starts a new BrunoTable generation, and clears
   the sparse cache.
2. A scroll-window change calls `generation.setWindow`, retains overlapping rows, and never starts a
   semantic generation.
3. BrunoTable owns that distinction. The optional `keepRenderedRows` value received by
   `setRowCount` is not a semantic-generation signal.
4. Every accepted viewport row or group requires its authoritative `rowKeysByIndex` entry. Missing
   keys are rejected and counted as identity failures.
5. Set-filter state preserves user intent as either `all-except` or `only`. An empty `only` set
   compiles to a real contradiction because an empty View Server `in` condition is normalized away.
6. A live facet is a separate query that excludes its own column filter but includes all other
   filters. It exists only while its overlay is mounted.
7. Quick-filter fields are explicit View Server fields and compile into one OR group; every other
   active column or external filter remains ANDed at the query root.
8. Group result identity comes from the View Server. BrunoTable must not synthesize keys from
   formatted aggregate values.

The roughly 805 kB prototype bundle is not representative of the grid library: it intentionally
ships the complete in-browser View Server runtime, React test provider, and seeded engine so the
contract can be tested without Kafka or a second process.

## Upstream lifecycle issue

Unmounting an active published viewport currently makes React 19.2.6 report
`useInsertionEffect must not schedule updates`. View Server uninstalls its stable viewport binding
inside an insertion-effect cleanup; deactivation then synchronously invokes the consumer sink's
`setRowCount` cleanup, which can publish an external-store snapshot. This is tracked upstream as
[effect-view-server#408](https://github.com/bmvantunes/effect-view-server/issues/408). BrunoTable
must not hide the warning or defer its sink artificially; the React lifecycle boundary belongs in
View Server.
