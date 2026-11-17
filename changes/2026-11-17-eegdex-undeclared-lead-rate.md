---
bump: patch
type: fixed
brief: none
---

Read an EMG or EOG lead only at the rate that the caller declared.

EEGDex read a lead with no declared rate at the EEG rate.
That multiplied every epoch window by the ratio of the two rates.
Epochs with no samples then fell into REM through the permissive null arm.
A lead with no declared rate is now absent, and `leadAbsence` names the reason.
