---
bump: patch
type: fixed
brief: none
---

The PpgDex waveform explorer now scales the y-axis to the visible window, not to the whole night.
Before the fix, one motion spike set the scale for every view, so a Verity night drew as a flat line.
The scale clips at the 0.5th and 99.5th percentiles, so one spike inside the window does not flatten the pulses beside it.
The trace stops at the plot edge.
The mini-map keeps the whole-night scale, because it shows where the spike is.
ECGDex received the same fix on 2026-10-18.
