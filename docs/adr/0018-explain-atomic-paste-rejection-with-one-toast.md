# Explain atomic paste rejection with one toast

Every rejected Client paste that has no open Paste Confirmation displays one accessible, table-scoped `Paste rejected` toast explaining why the atomic gesture applied nothing. BrunoTable never lets `Ctrl/Cmd+V` appear to do nothing and never emits one toast per destination cell. A supported linear source/destination mismatch is not silently rejected: it opens the modal confirmation workflow, whose description and inline errors become the authoritative explanation instead of a redundant toast. A two-dimensional clipboard matrix has no legal destination and is rejected directly with the toast.

Paste rejection reasons are a closed internal diagnostic union covering at least:

- unsupported two-dimensional clipboard source;
- destination outside current row or visible-column bounds;
- unavailable or stale target identity;
- non-editable or save-locked target;
- clipboard read or supported-text failure;
- input-budget rejection;
- parse failure; and
- synchronous local validation failure.

Messages use user-facing row and column labels when available and fall back to stable identities. A two-dimensional source says, for example, `Copied 3×2. BrunoTable accepts only one row or one column.` When several linear targets fail, the toast explains the first deterministic failure and summarizes the additional bounded count, such as `Price in order ORD-42 must be a number, plus 4 more invalid cells.` It never allocates or renders an unbounded error list. Supported linear mismatch details and proposed coordinates belong in Paste Confirmation.

The toast is dismissible, contains no Retry or mutation action, and remains until the user dismisses it or a later paste succeeds. Another rejected paste replaces the current paste toast with the latest diagnostic rather than stacking. Save failures retain their separate persistent operation-aware notification workflow because a rejected paste never invoked a Save Operation.

Unsupported source shape, target, parsing, and validation rejection creates no draft, edit transaction, Batch history command, XState save operation, or `onSaveEdits` call. The toast owns only immutable bounded diagnostic evidence and does not subscribe to source rows or trigger grid-root rendering. Its visible text is announced through the shared accessible toast region and never relies on color alone. A supported linear destination mismatch owns no toast because its AlertDialog provides the decision and explanation surface.
