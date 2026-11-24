---
bump: patch
type: fixed
brief: none
---

Refuse a ResMed EDF frame whose BRP Flow channel is uncalibrated.

`readEDF` writes `NaN` into every sample of a signal with a degenerate digital range, and it marks
that signal `calibrated:false`. The `resmed-edf` adapter tested the payload length alone, so an
all-NaN waveform published `usable:true`. The adapter now reads the flag and refuses with the reason
named. The decoded sets still ride `frame.edfSets`, so the events-only path is unchanged.
