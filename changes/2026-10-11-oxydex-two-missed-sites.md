---
bump: patch
type: fixed
brief: none
---

Guard the two row-value comparisons #3427 missed inside the functions it claimed — the artifact recovery walk was stepping through dropouts and cleaning 20 samples where 8 were artifact.
