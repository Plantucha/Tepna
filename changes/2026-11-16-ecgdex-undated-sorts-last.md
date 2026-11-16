---
bump: patch
type: fixed
brief: none
---

ECGDex sorts an undated recording after every dated one. Before this fix, four lists read an absent `t0Ms` as 0: the recording switcher, the cross-night panel and two multi-recording exports. So an undated recording took the first place. The event timeline in the review panel had the same defect for an event with no `tMs`. A measured stamp of 0 still sorts as a stamp.
