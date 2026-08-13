---
bump: patch
type: fixed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

Identified the cause of the PPG foot "bimodality": `ppgdex-dsp.js:orient()` picks the WRONG POLARITY on
10 of 20 box nights (0 of 22 phone nights). The two "modes" are the same pulse upside down — ensemble
average aligned on the peak shows the bad nights' minimum lands AFTER the peak and the upstroke is a
~1000 ms linear ramp rather than a 160 ms systolic rise. Forcing the correct sign collapses every bad
night (25.67 -> 2.27, 30.17 -> 2.71, 41.68 -> 7.65) AND restores rise time to ~300 ms, with pairing
counts going UP; forcing the wrong sign breaks a good night identically. The six "unmeasurable" nights
were MIXED polarity across channels, not defective recordings.

Retracts this brief's own §1b: "176 Hz doubles the odds of a good night" was measuring the bug. Within
the box tree at ONE rate, `orient()` is wrong on 10 of 19 nights, so rate cannot be the discriminator.
`PPG-SAMPLE-RATE-AND-PAT` §3 stands unamended — rate buys nothing.

Documentation only; the `orient()` replacement (choose the polarity whose median foot->peak rise is
shorter) moves exports and is a separate work-unit.
