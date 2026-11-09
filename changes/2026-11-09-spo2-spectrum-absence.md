---
bump: patch
type: fixed
brief: none
---

Keep an absent SpO2 sample out of the OxyDex spectrum. The mean and every bin read the absent rows
as a value, so a night with dropouts published a spectrum of its gaps. The spectrum now states the
covered sample count beside the recorded span.
