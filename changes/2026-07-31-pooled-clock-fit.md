<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [Integrator]
brief: POOLED-CLOCK-FIT-2026-07-31-BRIEF.md
---
The CPAP↔wearable clock offset is now fitted by **pooling every channel at one candidate offset** (`IntegratorDSP.fitClockOffsetPooled`) instead of estimating each channel separately and voting on distinct-node counts. On the 31-night corpus this puts **29/29** pre-correction nights in the expected band against **22/25** for the vote, and resolves four nights where no single channel could be fitted at all — eight weak channels together carry what none carries alone.

Per-night confidence is a **permutation p-value against that night's own gap-shuffled anchors**, not a node count. It is conservative in the safe direction: every night it calls confident is in band (21/21), and the 8 nights it does not are in band too. The gap shuffle is chosen over uniform scatter because it degrades honestly on periodic anchors, which pin the offset only modulo their period.

`fitClockOffset` is **deprecated, not removed**, and both stay exported so the comparison remains reproducible. The switch changes only what is *reported* — the applied skew correction still comes from `detectClockSkew`, untouched.

Also adds `underpowered` / `pFloor`: a permutation p-value from N shuffles bottoms out at 1/(N+1), so an under-shuffled run now says it could not have reached the threshold rather than reporting a negative result it was never able to contradict.
