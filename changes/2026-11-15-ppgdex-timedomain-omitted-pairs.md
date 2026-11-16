---
bump: patch
type: fixed
brief: none
---

Skip every beat pair that touches an omitted interval in the PPGDex `timeDomain` beat-to-beat arm. rMSSD and pNN50 no longer read intervals the caller excluded. The return carries `nBeatPairsOmitted` beside `nBeatPairs`.
