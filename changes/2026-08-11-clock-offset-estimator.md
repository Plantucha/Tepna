<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md
---
`clock_offset` spends the arrival sidecar with two PUBLISHED estimators and publishes an offset only
where they agree.

Recovering a clock offset from one-sided delays is a settled problem, so Moon et al.'s lower-envelope
LP and Paxson's minimum-of-subsets are implemented rather than a third hand-rolled quantile — the two
previous hand-rolled ones both produced a number with nothing to check it against. The LP needs no
solver: its optimum is a vertex of the feasible region, i.e. an edge of the points' lower convex hull,
so it collapses to a hull walk — exact, O(n) on sorted input, no numpy on a Pi-class box.

Both run because each breaks where the other does not: one early packet moved the envelope 818 ms
(Paxson 1.0 ms), while Paxson's worst error over 9600 planted configurations was 614 ms. So `offset_ms`
is None wherever they disagree. Over 19200 configurations, half carrying a planted outlier: certified
error p99 6.08 ms / worst 15.93 ms, and not one outlier-carrying configuration was ever certified.

Validated on real box captures against a truth known by construction — an H10 `_ECG` and `_ACC` pair
shares one crystal, so the two rates are identical and their difference IS each estimator's error.
Across the four such pairs in the corpus the envelope disagrees with itself by 0.17 ppm worst / 0.10
mean; `hostAxis`, which runs a median and so tracks the distribution's centre rather than its edge,
by 5.78 / 2.20. Self-consistency, not accuracy — and not a criticism of `hostAxis`, which exists to
interpolate a correction rather than to quote a rate.

⚠️ Retracts a reason from `PAT-PACKET-ARRIVAL` §6: a minimum over the ring's 1 s quantised counter does
NOT return the quantum (worst 31.5 ms over 270 configurations, 3.2 % of it). Fitting is owed on every
device anyway, because a minimum has no time model and is wrong by half the span's drift — 242 ms
measured on a real 8 h H10 capture, against PAT's 10 ms budget.
