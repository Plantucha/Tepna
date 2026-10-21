---
bump: patch
type: added
brief: none
---

Measure the night population a corpus-backed run covers, and say so when it moves mid-run. `tools/corpus-scope.mjs` gains a snapshot of the night set, an intersection and a `corpus-population` verdict. The firmware-reference tool takes one snapshot before it enumerates and one after it scores, and reports its figure over the intersection.
