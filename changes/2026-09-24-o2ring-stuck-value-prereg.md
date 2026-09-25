---
bump: patch
type: added
brief: none
---

`O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS` §8 writes into a brief, for the first time, the vendor answer found by the 2026-09-06 decompile: the SDK smooths only the `156` marker and treats 0, 100 and 199 as signal. The ring's 1 Hz `sensorState` separates finger-off from worn, but it does not flag in-wear blanking (~98 % of 0/199 occur while it reads worn). It also pre-registers a capture design, NOT RUN, whose flashlight segment decides whether a worn flat-100 run of 200 samples or more is optical (the raw `PPG2W` channels pinned) or algorithmic (still pulsatile). The predictions are committed before any data is scored, and a retrospective arm over the 2026-09-19 sessions comes first.
