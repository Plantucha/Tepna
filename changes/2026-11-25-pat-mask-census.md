---
bump: patch
type: added
brief: none
---

Measure how far the PAT foot set moves when the O2Ring beat markers are held over first. `tools/pat-mask-census.mjs` runs the shipped `ppgFootTimes` twice per recording through the worker's new optional `opts.holdGaps`. The default path holds nothing, so no published number moves.
