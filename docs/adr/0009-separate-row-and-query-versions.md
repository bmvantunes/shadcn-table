# Separate row concurrency versions from query versions

Editable tables use an explicit, typed Row Version capability and include that value in every optimistic save. A Viewport Source's top-level Query Version is never used as a row's expected version, and the effect-view-server runtime `patch` operation is not a save Adapter because it currently has no compare-and-set argument. `onSaveEdits` must cross an application write or RPC seam that atomically checks the Row Version and returns canonical values plus the next version.
