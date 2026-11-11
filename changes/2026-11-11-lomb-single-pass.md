---
bump: patch
type: fixed
brief: none
---

Compute each Lomb-Scargle bin in one pass over the samples, in ECGDex, PpgDex and PulseDex. The double-angle and angle-difference identities cut four trig calls per sample to two. Measured: 1.9x to 2.0x faster over nine cases, and every export stays identical.
