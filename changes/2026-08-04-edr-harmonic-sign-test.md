---
bump: patch
type: fixed
nodes: [ECGDex]
brief: ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md
---

Finishes the EDR period-doubling fix, which shipped in a form that did not actually fix it. The harmonic
check in `_autocorrPeriod` compared the half-lag's correlation against `0.8 * best`, on the reasoning that
an attenuated fundamental "only has to be close". Measured, the band-edge fundamental carries 0.745 of the
harmonic's peak, so at 24 breaths/min the check ran, evaluated the true answer and rejected it by 0.035 --
leaving the estimator that far from a decision boundary, where the result depends on record length and
seed. The existing gate legs pinned 900 s, one of the lengths where it happened to pass; at 180 s and
300 s a true 24/min carrier still read 12.5, and at 1800 s one seed still period-doubled to 11.9.

The threshold is now a sign test rather than a near-equality test, which is the physically correct
statement: if the found lag is the octave, the half-lag is a real period so its correlation is positive;
if the found lag is already the fundamental, the half-lag is anti-phase so its correlation is strongly
negative. Measured over 6-24/min the populations do not overlap -- wrong cases run -1.26 to -2.89, the
right case +0.745 -- so 0.5 sits in the gap with 0.245 of margin instead of -0.035.

Nothing else moves: every rate from 6 to 22/min is byte-identical across four seeds, and on ten real
trio-corpus H10 nights both `respFromEDR` and `cpc.hfcPct` are unchanged, since no real night in the
corpus sits at the band edge. `cpc.hfcPct` also cannot be reached by this change -- `_cpc` integrates
fixed bands and never reads the estimated rate -- so the validated r = -0.408 against device-scored
residual AHI is unaffected.

Four new gate legs pin a short record and a long one; restoring 0.8 reds three of them by value.
