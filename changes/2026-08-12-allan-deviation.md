<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: ALLAN-DEVIATION-2026-08-12-BRIEF.md
---
`allan.py` — clock stability as a CURVE, because a single ppm is not an answer.

Three clock analyses in one session reached wrong or unsafe conclusions using ad-hoc statistics. Allan
built this estimator because standard deviation DIVERGES for these noise types as the sample count
grows, so "does it average down?", asked with SD of block means, was ill-posed before the data were
considered. Clock Contract §7's "never quote a ppm without the span beside it" is a hand-derived
special case of the tau-dependence ADEV makes explicit.

Overlapping ADEV from a phase series plus a slope classifier, because the slope names a MECHANISM a ppm
cannot: tau^-1 phase jitter, tau^-1/2 white FM, tau^0 a FLOOR where averaging buys nothing, tau^+1/2
random walk, tau^+1 drift. `arrival - device` from the packet sidecar is already a phase series, so
nothing new is captured.

MEASURED on the real sidecars: all four Polar streams are white/flicker PHASE (slope -0.99 to -1.00)
averaging to 0.023-0.094 ms — the clock sits ~100x inside PAT's 10 ms budget and is NOT the bottleneck,
and the "14 ms within-connection wander" was phase noise the fitted line already removes. The ring is
white FREQUENCY at 615 ms, four orders worse.

Known-answer tested against synthesised white-PM / white-FM / random-walk-FM / drift, recovering
-1.000 / -0.545 / +0.462 / +1.000 against theory's -1 / -0.5 / +0.5 / +1, with a canary asserting all
four map to DIFFERENT names — a classifier returning one label would satisfy any single-series test.
Reported in `nightqc` as `stability`, gated by NOTHING.
