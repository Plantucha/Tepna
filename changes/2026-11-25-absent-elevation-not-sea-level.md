---
bump: patch
type: fixed
nodes: [HRVDex]
brief: none
---

The HRVDex profile reads an absent elevation as `null` in both of its arms. The arm that reads the form answered 0 m. A sea level of 0 m is a legal elevation, so an empty field and a measurement read the same. Both altitude factors in the file now state the absent case. Each answers 1, which is the number it answered before.
