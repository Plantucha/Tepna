<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [Integrator]
brief: POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md
---
`POOLED-CLOCK-FIT-FOLLOWUPS` §3 proposed a guard for half-period aliasing: flag a night when the channels' own argmaxes split into clusters wider than the peak's support. It insisted the guard be validated against the whole corpus first, and must not cost any correct confident night.

**It costs all of them.** Implemented as specified and scored over 36 reproducible nights, it falsely flags **22 of 22** correct confident nights. Restricting it to *agreeing* channels scores identically. Among agreeing channels on correct nights the own-argmax range runs **70 s to 9425 s** against a support width of **0–65 s** — individual channel argmaxes are noise, which is exactly why pooling replaced the vote. The guard reinstates the vote's statistic as a detector, and that statistic was replaced because it was bad.

**No guard is calibratable here.** 2026-07-23's raw data is gone from every tree, so the motivating night cannot be reproduced; among the 36 that can be there are **zero** confident-but-wrong nights. Calibrating on that is fitting to a single lost night — the error §3 itself warns about.

**The mechanism is already caught at its source.** Half-period aliasing is a property of the anchor train, and `ambiguous`/`alternativesSec` detect it first. Now pinned by planted known-answers: an aperiodic train is confident and recovers the offset within 5 s; a perfectly periodic one is flagged ambiguous with rivals one period either side and confidence withheld; and §3's exact scenario — responders firing at the anchor *and* at anchor + P/2 — still returns the **true** offset rather than the alias.

This corpus was never at risk: apnea-train interval CV is **1.04–2.18** across 36 nights, and an aperiodic train cannot form the comb that `IBI-ALIGNMENT-LIMIT` found between two beat trains.

No guard implemented. Re-open only if a confident-but-wrong night appears whose inputs still exist.
