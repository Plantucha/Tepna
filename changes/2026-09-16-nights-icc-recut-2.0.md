---
bump: patch
type: changed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`nights-icc.html` is re-cut under `cohort-gen 2.0`, and its central conclusion reverses.

First of the six papers in the re-cut. Numbers and figures come from one run of
`tools/analysis-rerun.mjs --paper-scale --figures` at 6,000 subjects (35 min).

| metric | cohort-gen 1.9 | cohort-gen 2.0 | |
|---|---|---|---|
| rMSSD ICC₁ | 0.93 | **0.9295** | unchanged |
| CGM-CV ICC₁ | ≈ 0 | **0** | unchanged |
| **ODI-4 ICC₁** | **0.75** | **0.9238** | **moved** |
| ODI-4 nights for ICC ≥ 0.80 | two | **one** | **reversed** |
| ODI-4 nights for ICC ≥ 0.90 | four | **one** | **reversed** |

**The "two nights" requirement was a ceiling artifact, not a property of the detector.** ICC is a
variance ratio; ODI-4's between-subject variance is largely the apnea spread; and 1.9's hard AHI
ceiling of 80 compressed that spread. 2.0 fits the severe stratum to real SHHS and raises the ceiling
to 300 — against a real SHHS maximum of **286.9** — so 2.0 is the more faithful cohort and the 1.9
result was the distorted one. The paper's own v1.9 revision note already identified this mechanism
running the *other* way from 1.6→1.9; it is retained, directly below the new note.

**Why this is a generator effect and not a broken re-run** — the discriminator the brief asks for:
rMSSD and CGM-CV did **not** move, `subjects = 5,394` matches the paper's stated figure exactly, and
two independent 35-minute runs produced byte-identical ICCs.

Both sets of values are stated in-text throughout, per the convention recorded at
`papers/dead-ends.html` §"Generator provenance" — every surviving `0.75` is explicitly attributed to
cohort-gen 1.9, verified by scan (0 unattributed). All three figures regenerated from the same run.

⚠️ **The brief predicted "no change — cohort-wide" for this paper and was wrong**, because a
cohort-wide *statistic* can be dominated by the stratum 2.0 changed. The inventory's `expect` field
is corrected in #2555; the remaining five papers' expectations should be read as hypotheses to test,
not as conclusions.
