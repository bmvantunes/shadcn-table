# BrunoTable capable-hardware benchmark profile

BrunoTable's production Browser performance evidence uses the versioned profile
`chromium-capable-hardware-v1`. Results from a different environment are useful diagnostics, but
they are not comparable release evidence for the 8.33 ms target.

## Host protocol

- Run on an otherwise idle, AC-powered machine with low-power mode disabled.
- Use at least eight logical processors and 16 GiB of memory. The reference host is Apple silicon
  on current macOS; an equivalently provisioned dedicated Linux runner is acceptable.
- Start from a clean install and do not run the benchmark suites concurrently with another build,
  test, indexer, or browser workload.
- Use the repository-pinned Playwright Chromium in headless production mode, a 1440 × 900 CSS-pixel
  viewport, and device-pixel ratio 1. Browser throttling and CPU emulation must be disabled.
- Run `vp run @bruno/table#test:browser:performance`. Publication runs this command through
  `@bruno/table`'s `prepublishOnly` gate.

The suite validates the machine-visible portion of this protocol before recording evidence:
profile identity, Chromium user agent, production mode, viewport, device-pixel ratio, and logical
processor count. Each accepted environment artifact retains those observed values. Memory,
power-source, idle-host, and throttling preconditions are operator-controlled because browsers do
not expose reliable cross-platform values for them.

## Evidence contract

Every `chromium-capable-hardware-v1` release scenario declares at least 12 warm-up samples followed
by at least 100 measured samples, then finalizes exactly that declared total. The evidence finalizer
rejects a declaration below either minimum, a supplied count different from the declared total, or
a p99 budget looser than 8.33 ms for that profile. Tests may deliberately declare more samples or
use a stricter budget. Evidence records the scenario identity, profile identity, nearest-rank
percentiles, over-budget samples, and dropped-frame policy; an incomplete or over-collected run
relative to its declaration is invalid.
The finalizer accepts only the declared capable-hardware and presentation-cadence identities; an
unknown alias cannot bypass either protocol or be attached to the installed Browser evidence.

Frame-work evidence and presentation cadence are separate measurements. Frame-work scenarios use
`chromium-capable-hardware-v1` and the 8.33 ms p99 release budget. Scenarios that measure the
interval between consecutive animation frames use
`chromium-production-presentation-cadence-v1`, retain the same validated Browser environment and
minimum declared sample counts, and compare cadence with a 20 ms threshold. That threshold
describes host presentation scheduling, not permitted BrunoTable JavaScript work. Fixed-rate source
lifecycle tests still publish at their declared cadence, but their synchronous reconciliation or
delivery work is measured as capable-hardware release evidence under the 8.33 ms budget.
