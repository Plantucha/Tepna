---
bump: patch
type: fixed
brief: none
---

Skip every beat pair that touches an omitted interval in the PPGDex `timeDomain` beat-to-beat arm. rMSSD and pNN50 no longer read intervals the caller excluded. The return carries `nBeatPairsOmitted` beside `nBeatPairs`.

The triangular index now bins the kept intervals and divides the kept count. Before this fix, an omitted interval added a sample to the histogram and a beat to the numerator.
