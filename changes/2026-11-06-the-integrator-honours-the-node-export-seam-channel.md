---
bump: patch
type: changed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

The Integrator now reads the `recording.validity` seam channel five nodes publish, and honours it.
Its adapter dropped the seam keys, so every seam the box recorded stopped at the fusion boundary.
A recording with a recorded seam now leaves the event-lag estimator, and a beat pair spanning one refuses the drift fit under `clock-seam`.
Both estimators answer a whole-recording question with one number, which describes neither side of a discontinuity.
A measured zero keeps every number, and an unexamined channel stays UNKNOWN rather than reading as seam-free.
The new `clockSkew.seamCensus` states the channel for every recording, unconditionally, so a fusion silent about a seam cannot read as a clean one.
