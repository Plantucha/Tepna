---
bump: patch
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

The PpgDex perfusion index divided by the detector's zero-light pedestal, about 650,000 counts of
hardware offset, instead of by the light. Its denominator is now referenced to the ambient phase, and
each epoch integrates its own span rather than repeating one whole-record number. Measured over 27
nights the correction runs 0.78x to 3.90x, median 2.02x, and 1.14x to 177x within one night. The two
colour bands move onto the thresholds the reference guide already publishes.
