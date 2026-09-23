---
bump: patch
type: fixed
brief: none
---
When a desaturation's 120 s look-forward expired without SpO2 returning to baseline-1, recovery had NOT BEEN OBSERVED — and was recorded as `0`. That is a legal recovery time, so **the same value was read two opposite ways in one file**: `meanRecovery` averaged it in as "recovered instantly" (and `nadirRecov` is `goodDirection: 'down'`, so that is the flattering direction), while `oxyDesatConf` twenty lines below read the same `0` as "no clean recovery" and withheld its bonus. One in-band value, two contradictory meanings — which is the argument for the sentinel itself being the defect rather than its handling.

**Measured on the real corpus, which for once expresses it:** a night with **14 desaturation events had only 5 observed to recover**; the other nine were averaged in as zero seconds, publishing a mean recovery of **2 s where it is 6 s** — three times too fast, in the direction that looks healthier. Another night reported a recovery of 0 s while recording no events at all; it now refuses.

`recov` is null when unobserved, `recoverySlope` refuses with it, the mean is taken over the events that recovered, and `recoveredCount` publishes that denominator beside it — a mean over 5 of 14 is a different statement from a mean over 14. Filtering was required rather than only nulling the sentinel, because `s + null` coerces to `s` and the divisor would have kept counting the unrecovered events (the coercion that made a 7-night SpO2 window read 83 % in #2941).

⚠️ The twin does NOT drive `computeDesaturationProfile`: four synthetic shapes were tried and the oximeter self-gate classified every one as an artifact, so the assertions would have been vacuous. It asserts what it can — that the shape is a real desat to the detector, that the sentinel is out of band, and the arithmetic that made the old value readable both ways — and the limit is stated in the test.
