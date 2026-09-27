---
bump: minor
type: changed
brief: TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md
---

**sensor-trio-night** reads the O2Ring corner from the ring's raw `_PPG.txt`. It uses the firmware's own `156` beat markers first (isolated by `parsePPG`, published as `beatMarkerSec`), then PPGDSP pulse feet on the pleth, then the `_SPO2.csv` 1 Hz pulse as fallback. This is the raw-first rule the H10 and Verity corners already follow. Measured before adopting, over the 39 box nights where all three sources solved: median O2Ring σ̂ is 3.38 bpm from the CSV, 1.98 from the pleth detector and 1.62 from the markers. The markers beat the CSV on 35/39 nights and the pleth detector on 36/39, and the median Σσ² falls from 14.06 to 5.57 bpm². The pre-stated bar was markers < CSV on ≥ 80 % of nights and a falling median total. Most of the ring's apparent HR noise was the smoothed 1 Hz summary, not the sensor. The worker adds `o2MarkerHrMap` and reports `h10Source`/`o2Source`; the page shows all three corners' sources, and the ring's series label and badge follow the source used. A caller that sends no ring PPG (the power tool) keeps the CSV corner unchanged.
