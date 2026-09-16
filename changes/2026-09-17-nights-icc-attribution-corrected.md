---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`nights-icc.html` blamed cohort-gen 2.0 for a reversal the generator did not cause. Corrected on
measurement.

#2557 re-cut this paper and attributed ODI-4's ICC₁ rising **0.75 → 0.92** — and the conclusion
flipping from "two nights" to one — to 2.0's AHI-ceiling change, reasoning that 1.9's ceiling of 80
compressed the between-subject apnea spread that ICC is a ratio of. The reasoning was coherent, the
paper's own v1.9 note describes that mechanism, and the unchanged metrics matched. It was still wrong.

The A/B control from #2577 settles it:

| ICC(1,1) | published (1.9) | **@1.9** | @2.0 |
|---|---|---|---|
| odi | 0.75 | **0.9228** | 0.9238 |
| rmssd | 0.93 | 0.9294 | 0.9295 |
| minOcc ≥ 0.80 | **two nights** | **one** | one |

**The ICC is already 0.92 under cohort-gen 1.9 — the generator this paper was published on.** The
generator's entire contribution is **0.0010**. The 0.75 → 0.92 move happened between publication and
now *at a fixed generator*, so it is a change in the measurement pipeline, not in the cohort.

`subjects` reproduces the published **5,394** at *both* versions, which is what rules out a
configuration error: the cohort is right, the scoring changed.

## What changed in the paper

The numbers and the conclusion **stand** — one night does suffice on current code, at either
generator. What is withdrawn is the *cause*. Every ceiling-attribution sentence added by #2557 is
replaced with the measured A/B, and the v1.9 note's own account of 1.6 → 1.9 is left standing as its
own claim; only the assertion that it explains *this* revision is retracted. Verified by scan: zero
remaining ceiling-causation claims, zero stale "0.75 at cohort-gen 1.9" attributions.

**What did change in the pipeline is not established, and is deliberately not guessed at** — naming a
cause without evidence is the error being corrected, not a fix for it.

## Why this matters beyond one paper

My original reasoning had a mechanism, a citation, and matching controls, and was still false. The
control that caught it costs one 35-minute run and needs no inference. `hrv-age-confound` (#2562) and
`cgm-hrv-coupling` (#2563) report *unchanged* values, so they carry no causal claim to be wrong about
— but any future re-cut that attributes a delta to the generator owes this A/B first.
