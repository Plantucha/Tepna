---
bump: patch
type: fixed
brief: none
---

Stop an absent second counting as time below every SpO2 threshold and as a bradycardia event — `null < 90` and `null < 40` are both TRUE in JS, which #3408 made reachable by carrying absent rows — and mint the first OxyDex golden over an input with absent seconds, so this class is visible to every future PR.
