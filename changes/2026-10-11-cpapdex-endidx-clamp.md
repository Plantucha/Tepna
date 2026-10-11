---
bump: patch
type: fixed
brief: none
---

Clamp a terminal desaturation's `endIdx` to a sample that exists in CPAPDex — it was one past the end, so `spo2[endIdx]` read `undefined` and any arithmetic on it was NaN — and publish `terminal` beside it, because the clamp alone would make "no resaturation was observed" indistinguishable from "it resaturated on the last sample".
