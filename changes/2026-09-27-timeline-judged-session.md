---
bump: patch
type: fixed
brief: none
---

`timeline.build` and `nightqc.summarize` now call one selector, `nightqc.judged_session`, so the rendered timeline and the QC verdict describe the same session of a night. The timeline had kept the old latest-ending rule that `summarize` moved off with a measured argument; over the 64 nights carrying a QC summary the two rules chose differently on 27 of the 56 multi-session ones, twice choosing a session with zero rows. Closes residue `2026-09-26-timeline-selects-a-different-session-than-nightqc`.
