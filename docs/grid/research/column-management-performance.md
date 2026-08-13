# Column-management performance evidence

BrunoTable's column-management target is the 8.33 ms frame budget for 120 Hz interaction. The
repository uses two complementary kinds of evidence:

## Deterministic CI proof

The Playwright-backed `column-management.browser.test.tsx` suite renders a realistic 160-column
Client Table with simultaneous pinned-start and pinned-end regions plus a virtualized centre, and
sends burst pointer moves before each animation frame. It verifies that a pointer resize and
pointer reorder each:

- keep at most one preview frame pending at a time (auto-scroll may schedule follow-up frames after
  viewport publication);
- commit exactly once at pointer release through the typed private Grid Command boundary;
- keep row-order planning and mounted-cell publication within fixed bounds for the fixture's
  mounted row/column window rather than the complete 160-column definition;
- write only one resize preview property and no more than the fixed mounted-column reorder preview
  bound; and
- leave no render/listener work pending after cancellation or unmount.

The suite records each preview duration and prints the observed samples alongside the 8.33 ms
budget, but it does not fail on a wall-clock threshold. Browser scheduling, CI contention, and
headless compositor variance make a strict timing assertion unreliable, and Issue #29 owns the
final production-hardware gate. The per-gesture frame counts, pinned-region assertions, CSS-write
bound, and fixed render, command, subscription, and lifecycle bounds are the repeatable Issue #10
CI gate; the printed durations are diagnostic benchmark evidence. CI proves bounded work and
coalescing for this fixture, while the benchmark reports repeatable timing samples for tracking
the 8.33 ms reference.

The Browser Mode provider keeps the repository's established Chromium viewport defaults. A global
viewport override was evaluated but changes the geometry contract exercised by existing browser
tests. The performance and pinned-resize fixtures therefore constrain their table width with an
explicit wrapper and assert the resulting measured geometry; this keeps the new evidence
deterministic without changing unrelated viewport-sensitive coverage.

## Repeatable benchmark

The Node benchmark exercises the private `BrunoTableGridRuntime` with 240 realistic columns and
reports fixed-sample min/max/mean and p99 command work durations for resize, reorder, and an
isolated complete-layout reset through Vitest's benchmark reporter. Each reset iteration starts
from a separately dirtied runtime, so every timed reset performs real layout work. Run it with:

```text
vp run @bruno/table#test:bench:column-management
```

The benchmark output compares those measurements with the 8.33 ms reference budget. It is
diagnostic evidence rather than a pass/fail wall-clock gate; regressions should be investigated
when the reported p99 approaches or exceeds the budget. The benchmark does not change the public
API or make TanStack state authoritative.
