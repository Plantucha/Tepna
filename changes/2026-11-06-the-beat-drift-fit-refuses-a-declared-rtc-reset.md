---
bump: patch
type: fixed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

`_beatSkewCheck` now refuses a beat pair whose side declared `rtcResetSuspect`, under that reason.
`detectClockSkew` has vetoed such a recording from the event-pair estimator for months, and the beat check read no flag.
So one declared clock defect refused the event-pair lag, and the beat-level drift fit spent it.
A reset's own offset is unmeasured, so a fit across it carries that jump in both the offset and the rate.
Both estimators now route one predicate, and a recording carrying a seam and a reset reports the seam.
The rec-level vetoes still carry one entry per source, so the precedence loses nothing.
