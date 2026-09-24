---
bump: patch
type: fixed
brief: none
---
The null-not-zero fix was already written into this file — twice, with its reasoning — and applied to **one of five inputs**.

`computeAHIestimates` refuses correctly on null for every input it uses, and says why:

> *"`null * 1.1` is 0, so an absent ODI-4 published an AHI estimate of 0.0 — the most reassuring possible reading of a measurement that never happened."*

and at the caller, `desSevRate` was given the same treatment:

> *"null, not 0 — … substituting 0 for an unmeasured DesSev drops its term from the Kulkas estimate and under-reports AHI, i.e. fail toward the reassuring answer."*

Its four siblings on the adjacent lines — `odi4Rate`, `odi3Rate`, `t95Pct`, `ct90Sec` — kept defaulting an **absent** index to `0` and fed it straight past that guard. The same four defaults appear again in the JSONL summary-import path. Eight sites, one already-documented rule.

**`computeMOS` had no guard at all.** `null >= K` is false and `null / 60` is 0, so absent inputs fell through every branch to score **1 — "Normal"**. A McGill Oximetry grade is a clinical claim, and that one was asserted about a night neither input described. It now refuses if either input is absent: the Normal verdict specifically requires knowing that *both* are low, and over-refusing is the safe direction. Its consumer (`oxydex-render.js:321`) already tested `mos.mos != null`, so nothing downstream needed changing — another guard that existed while the producer fed past it.

⚠️ **The gate found a site I had decided to skip, and it is pinned rather than hidden.** The scan is written against the shape, not the lines I edited, and it surfaced a fifth instance: the `spo2Score` ladder uses the same `odi4 ? odi4.rate : 0`, and an absent ODI-4 falls into `< 2` to score **25, the maximum**. That is the same absence with a *different* fix shape — a composite term to drop and renormalise, not a null to pass through — so it is logged as residue instead of widening this diff. The assertion pins it as an **equality**, so a new site still reds and the list may only shrink; narrowing the pattern to fit the code would have made the gate agree with me by construction.

Export-inert on the corpus: all four fixtures moved by `manifestHash`/`computeHash` only — every real night carries its ODI/T95/CT90, so the null paths do not fire there. The twin is the coverage.

Reverting the DSP reds 3 of 8, with `computeMOS(null, null)` returning `{"mos":1,"mosLabel":"Normal"}` verbatim and the scan enumerating all eight original sites. The anti-vacuity control fires too, which is what distinguishes a comment-stripped source scan that is reading code from one that is reading an empty string.
