# Own View Server query generations in the Adapter

The private View Server Adapter owns one generation token for each semantic Feed Route, projection,
filter, sort, grouping, and aggregate query. It calls `viewport.replace` and clears the complete
sparse logical row space only when those semantics change; scrolling, overscan, and keyboard reveal
call `generation.setWindow`, retain overlapping keyed slots, and stay inside the active generation.
This keeps source lifecycle hints and React object allocation from becoming accidental row-space
authority.

## Consequences

- Every sink closes over its Adapter generation token and ignores writes after replacement or
  release; the public sink protocol needs no generation field.
- The optional `keepRenderedRows` argument to `setRowCount` is a source delivery hint, never a signal
  to retain rows across semantic generations.
- Rows and source-owned keys are accepted atomically over identical absolute indexes. The Adapter
  never reconstructs identity or treats position as identity.
- A compatible View Server React binding must deactivate without scheduling consumer sink updates
  inside `useInsertionEffect`; this is tracked in
  [effect-view-server#408](https://github.com/bmvantunes/effect-view-server/issues/408).
