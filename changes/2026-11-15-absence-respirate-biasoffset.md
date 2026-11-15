---
bump: patch
type: fixed
brief: none
---

Refuse a respiration rate and a calibration offset that nothing measured.

ECGDex published 0 br/min when the autocorrelation found no period.
GlucoDex published an offset of 0 mg/dL when the caller asked for no calibration.
Both fields now answer null, and the rate names its own cause.
