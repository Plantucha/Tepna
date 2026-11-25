---
bump: patch
type: fixed
brief: none
---

Each CAMQ point in HRVDex now states how many of the three parasympathetic indicators it averages.

The three indicators use different scales, so a score over one of them does not compare with a score over all three. A point with a partial set draws a grey triangle or star, and the tooltip gives the count. The card named AMo50 as an input that the score does not read, and it no longer does.

The registry gains entries for ln(rMSSD), SD1 and SD2, which read `experimental` by fallback. SD2 of an rMSSD and SDNN pair that no RR series can give is now absent, where it read 0.
