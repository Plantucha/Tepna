---
bump: patch
type: added
nodes: [suite]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`docs/SHHS-COHORT-REFERENCE.md` — what the SHHS1 cohort contains, measured over all 5136 scored
records rather than the 99 that carry signals.

Discharges residue `2026-09-13-convention-measured-on-the-signal-subset`, which recorded that cohort
properties were being taken from the signal-carrying subset. Every figure here needs only the XML,
which is already local — no EDF, no download.

The finding that matters: **hypopneas are 85.3 % of all respiratory events** (1,038,249 against
179,054 apneas), and SHHS scored hypopneas without requiring a 4 % desaturation. That is the
quantified form of the confound which invalidated the first OxyDex comparison — an ODI-derived AHI
estimate is being asked to count events that mostly produce no qualifying desaturation, so it
structurally cannot track SHHS AHI. Previously this could only be described; now it has a number.

Also recorded: AHI median 35.0/h, arousal index 19.6/h, expert desaturation index 21.5/h, REM 19.7 %
of TST, TST 6.11 h.

Two things flagged for whoever reads it. The arousal index is the largest annotated signal in the
corpus that NO node consumes, and arousal is the criterion driving the hypopnea rule above. And the
REM fraction here (19.7 % of TST) and the one in `nsrr-stage-validate` (~12.5 % of all graded epochs)
differ only by denominator — the reconciliation is shown, because checking that before calling a
difference a defect is the lesson this lane keeps re-learning.
