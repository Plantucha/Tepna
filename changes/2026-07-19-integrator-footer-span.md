<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
The longitudinal footer rendered the **recording count** with a `d` (days) suffix, so a 12-recording series spanning 90 days read **"over 12d"**. Always in the alarming direction: the same delta compressed into a shorter apparent window looks like a steeper change than it is.

The series carries `t0Ms`, so the true span is computable — but only when **every** item is dated. §9.4 flags the same hazard for `slopePerDay`: one undated item makes a per-day figure meaningless. So the label now states the real span when it is knowable (`90d (12 recordings)`) and names the count honestly when it is not (`12 recordings`), rather than presenting a count as a duration.

`_spanLabel` is pure and exposed, because in a DOM-mutating render function the rule was unreachable by any test — the same reason §10.4's graft decision was hoisted into the DSP. 6 assertions, mutation-verified: restoring `count + 'd'` reds 5 of them. Both edges are pinned — a single recording spans nothing, an empty series renders no phantom duration — and a dense 8-night series is asserted to read 7d rather than 8, so the fix is not merely relabelling.
