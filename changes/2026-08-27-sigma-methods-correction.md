---
bump: patch
type: fixed
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

The three-part methods correction lands in the paper surfaces that publish σ figures.

**`papers/sigma-no-reference.html`** gains **limitation (xi)**: a reference-free σ is also a σ at one DSP
**generation**, and that parameter is stated nowhere. `ppgdex-dsp.js` changed 20 times in the three weeks
after 2026-08-08 (filtfilt unpadded from zero state — a DC transient at both record ends; the frequency
domain over `correctRR`'s substituted intervals; a crystal axis running backward that hid real dropouts).
Measured on one night with the other two corners held **byte-identical**: σ_Verity **2.14 → 4.25** bpm.
The headline 2.41 / 1.28 / 1.42 has **no recorded generation**, so — unlike its corpus and its sample,
which are stated — it is **not presently re-derivable**.

**An invalid attribution is corrected.** The paper read that the pipeline disagreement *"is specific to
the two corners the node-export path summarises most aggressively"*. The hat is linear in the pairwise
variances and `σ²_H10 = ½(V_HV + V_HO − V_VO)` contains two that involve Verity, so a change confined to
one corner moves all three σ — demonstrated: the same PPG-only swap moved σ_H10 **1.64 → 1.85** with the
ECG code unchanged. *"Corner X's σ moved, therefore corner X's processing differs"* is not a valid
inference from this estimator, and the per-corner reconciliation the paper owes must hold the other two
corners fixed to mean anything.

**`papers/sensor-trio-nights.html`** Table 4's caption gains the same caveat, since it republishes the
same σ family.

Nothing is fabricated: where the producing generation is unrecorded the papers now **say so** rather than
being retro-stamped with a plausible commit. `docs/` twins rebuilt; staged from `git status`, not from
the builder's printed list.
