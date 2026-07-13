<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [suite]
brief: CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md
---
An absent reading is not a miss, and a ×0.0 on 16 events is not a proof — `event-coupling.js` gets a coverage model and a power floor, and §M1's last surviving claim is retracted.

Two more defects in the primitive, both found on **real data after it shipped**, and both of which had
already made it into a brief as findings.

**(a) No coverage model.** An event stream has an **observation window**. The O2Ring records part of the
night, not all of it — and **30% of apneas happened while the oximeter was not recording at all**. The
primitive scored every one of them as a **miss**.

It does not merely add noise, it **biases, in the direction that looks like a finding**: an unobserved
event is a forced miss at shift 0, but the circular shuffle can carry it *back into* the recorded span
where it CAN hit. So chance rises above observed and lift lands **below 1** — manufactured
*anti*-coupling. That is precisely the ×0.5–0.7 and the "striking" ×0.0 the brief reported.

The suite already holds this principle one level down (DEEP-AUDIT §17–21: *an absent reading is not a
score of zero*). This was the same error one level up. `coverage: [[t0,t1], …]` now marks where B was
observing; an A-event counts only if its **whole window** lies inside a covered span, and its surrogate
wraps inside that **same** span — observed and null on identical footing. Unobserved events are reported
as `excluded`, never as misses. Omit `coverage` and you get the old behaviour **plus
`coverageAssumed: true`**, so nobody receives the broken answer silently.

**(b) No power floor.** The ×0.0 longest-duration bucket was published as *"provably no signal"*. It was
nothing of the sort: of those 48 apneas, **32 were unobserved**, and across the 16 actually watched
**chance alone predicts 0.9 hits** — so observing zero has probability ≈ **41%**. A coin toss was written
up as proof. Every measurement now reports `expectedHits`, and `underpowered` (expectedHits < 3) marks a
result whose low lift carries **no information**.

**Corrected §2** (wrapping null + coverage + power), *n = events the oximeter was observing*:

| class | n | lift, 0–30 s → 0–120 s |
|---|---|---|
| central | 527 | ×0.71 – 0.98 (×0.97–0.98 on the well-powered windows) |
| obstructive | 25 | ×1.11 – 1.52 — **LOW-N**, not a finding |
| hypopnea | 191 | ×0.82 – 1.33 |

**The conclusion is unchanged — no event class couples above chance.** But every magnitude was wrong,
and the ×0.0 is **retracted**.

That is now **three** defects in this null, each of which fooled it in a different direction: a
non-wrapping shift (inflated lift), no coverage (deflated it), no power floor (made a tiny bucket look
decisive). The §M1 lesson survives and sharpens: **a chance baseline only protects you if the baseline
is right.** Each defect is pinned by a regression assertion (35 self-test + 26 contract), and
`tools/cpap-oxy-couple.mjs` now passes the oximeter's recording span as coverage and reports the
observed denominator rather than the supplied one.
