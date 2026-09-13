---
bump: minor
type: added
brief: null
---

`tools/nsrr-score-pool.mjs` — parallel, resumable, observable corpus scoring, with a sequential
precision monitor that lets a run stop once the answer is in.

Lifts the tiered-dispatch-with-reported-fallback shape from `sensor-trio-power-analysis.js`, the
checkpoint/`--resume` from `mutation-crawl.mjs`, and the heartbeat from `mutation-ai-probe.mjs`. The
pool clamps to `nproc - 2` (up to 32) rather than the browser tool's 8, because the constraint
differs: 8 is right for a tab sharing a machine with the user, this is a CLI on a dedicated box.

GPU was measured rather than assumed and does NOT apply: `processNight` is ~95 % of runtime and is
serial scalar work over a 32 520-sample array with one disk read each — the opposite shape to
`sensor-trio-gpu.js`'s millions of independent synthetic windows. The parallelism that pays is
across records.

New: work is ordered by `hash(id)`, so any prefix is a uniform random sample (NSRR ids track
recruitment, so a directory-order prefix is biased). That makes `--precision` sound — the run stops
when the 95 % half-width on the median crosses a PRE-STATED target. Validated against the real
n=2179 result: ±0.15 stopped at n=229 (89 % saved) landing 0.060 events/h from the full answer, every
target inside its own bound. `--precision` is refused with `--no-shuffle`.

Measured 8.2x over the serial driver (1.98 vs 0.24 rec/s), reproducing it exactly: 0 mismatches on
every overlapping record. Kill-tested with SIGKILL and resumed with 0 duplicates.
