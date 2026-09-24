---
bump: patch
type: fixed
brief: none
---
The CVHR screen resamples beats onto a 1 Hz HR grid by walking them, so every second inside a beat dropout kept the LAST PRE-GAP interval — `hr[s] = 60000 / nn[j]` with `j` frozen. A 1.5 h strap-off produced **5400 s of invented, perfectly constant HR**, which `hrSeries` exports and the CVHR card draws with `UI.lineChart` as a flat measured line.

`spansGap` — the mask `buildNN` already builds (1 where an interval straddles a `>GAP_S` dropout) and `epochEngine` already takes as a parameter (*"THE EPOCH IS NOT EXEMPT"*) — is what `detectCVHR` never asked for, though `nnRes.spansGap` was on hand at the call site. `validateHR` names the other half of this pair outright: the DEVICE side stopped holding forward because *"the CVHR grid this is compared against holds forward too"*, which made the two series agree BY CONSTRUCTION. That comment described a live defect; this closes it, and the validation is strengthened rather than changed — the ECG side's uncovered seconds are now NaN on both sides and excluded by the existing `isFinite` pairing guard.

Reduced coverage ANNOTATES (§∅ 2026-09-17): uncovered seconds are absent in the exported series, events landing on them are not counted, and `coveredSec` is published. The held value is KEPT internally — the band-pass is a chain of moving averages and a null would poison every window it touches — which is the same choice `buildNN` made for `spansGap` (*"neither fill it better nor drop it… mark it"*).

The null had to be followed downstream: `UI.lineChart` treated `null` as `0` in its domain scan and rendered `LNaN NaN` into the path, silently voiding the SVG. It now excludes non-finite points from the domain and BREAKS the path at them, so a dropout draws as a gap rather than a line ruled across it.

Measured on a planted 3 h night with a 1.5 h dropout: **5401 null seconds** with the mask against 0 without it, and the held stretch carries **5 distinct values over 5401 s where a measured stretch of equal length carries 2048**.
