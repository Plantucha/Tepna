---
bump: patch
type: added
brief: none
---

`O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS` §8 records what the vendor SDK does with the ring's pleth byte: it smooths only the `156` marker, treats 0, 100 and 199 as signal, and carries validity out-of-band in a 1 Hz state field. It also pre-registers a capture design, NOT RUN, whose flashlight segment decides whether a worn flat-100 run of 200 samples or more is optical (the raw `PPG2W` channels pinned) or algorithmic (still pulsatile). The predictions are committed before any data is scored, and a retrospective arm over the 2026-09-19 sessions comes first.
