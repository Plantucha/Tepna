---
bump: patch
type: fixed
brief: none
---

GlucoDex no longer publishes a session span of 0.0 days when it measured no cadence. `detectSessions` multiplied the cell count by a null cadence, and JavaScript reads that product as 0. The session now carries `days: null`, and the session table shows a dash.

De-drift no longer reports that it ran when no wear had a measured span. `deDrifted` now reads true only when at least one session was re-centred. Shrike found both sites in its absence audit of `glucodex-dsp.js`, and Kestrel verified them on `origin/main`.
