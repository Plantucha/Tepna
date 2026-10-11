---
bump: patch
type: fixed
brief: none
---

Stop the periodic-breathing detector reading absent seconds as baseline excursions: the rolling median takes present values only, an absent sample closes no excursion, and a cycle spanning a dropout breaks the run instead of bridging it.
