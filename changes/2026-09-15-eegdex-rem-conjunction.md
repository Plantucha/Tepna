---
bump: patch
type: changed
brief: EEGDEX-BUILD-BRIEF.md
---

`eegdex-dsp.js`: records a second measured negative on REM detection, and the structural reason both
attempts failed.

EMG by expert stage (per-record median-normalised, 8 records): Wake 2.285, N1 1.092, N2 0.856,
N3 0.554, REM 0.610. REM is NOT the quietest stage — N3 is — and the shipped 0.95 threshold does admit
most of N2. Tightening to 0.75, the midpoint of the REM and N2 medians, measured A/B on identical
records: REM recall 23.7 % → 7.5 %, κ −0.0026. Worse.

The cause is the conjunction: REM requires low delta AND low EMG AND eye movement simultaneously, so
each arm's false-negative rate multiplies and tightening any single arm costs more recall than its
selectivity buys. Two principled single-arm changes have now lost. Improving REM needs the rule's
SHAPE changed, not another threshold or feature.

Code-inert.
