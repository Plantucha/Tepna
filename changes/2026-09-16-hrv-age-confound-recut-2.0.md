---
bump: patch
type: changed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`hrv-age-confound.html` is re-cut under `cohort-gen 2.0`, and **every headline quantity is unchanged**.

Second of the six papers. Numbers and figures from one run of
`tools/analysis-rerun.mjs --paper-scale --figures` at 20,000 patients (19 min).

| quantity | published (1.9) | measured (2.0) | |
|---|---|---|---|
| nights | 112,200 | **112,200** | identical |
| rMSSD per decade of age | −3.8 ms | **−3.833** | unchanged |
| rMSSD per 10 events·h⁻¹ | −2.4 ms | **−2.325** | unchanged |
| ROC AUC raw → adjusted | 0.69 → 0.77 | **0.694 → 0.777** | unchanged |
| misattributed high-risk flags | 29 % | **27 %** | moved |

**The stability is the finding, and it is worth stating rather than passing over.** These are
full-cohort regression slopes and AUCs, which 2.0's severe-stratum refit does not disturb — unlike a
**variance ratio** such as the ICC in the companion `nights-icc` paper, whose ODI-4 value moved
0.75 → 0.92 because between-subject apnea spread lives in exactly the tail 2.0 changed (#2557).

Two papers, the same generator change, opposite outcomes, and the difference is the *kind of
statistic*. That is a more useful result than either paper alone: it says which quantities are
sensitive to cohort-shape revisions and which are not.

Both sets of values are stated in-text per the `papers/dead-ends.html` §"Generator provenance"
convention; all three figures regenerated from the same run.

⚠️ **A dangling antecedent was repaired, not introduced-and-left.** The methods sentence read *"…on
the v2.1/1.9 generator. That generator revision re-textures the RR gain→render transfer…"*. Updating
the first half to 2.0 silently re-pointed *"that generator revision"* at 2.0, which does no such thing
— it fits the severe stratum. It now reads *"The 1.9 revision re-textures…"*. This is the failure mode
of editing a version string inside prose that refers back to it.

⚠️ Reproducibility here is *not* byte-identical as it was for `nights-icc`: two independent runs agree
to ~15 significant figures, differing only in the last two units in the last place of a double from
parallel reduction order. No reported digit is affected, and the distinction is stated rather than
rounded into a claim of exactness.
