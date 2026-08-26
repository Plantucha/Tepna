---
bump: patch
type: changed
brief: none
---

Exclude cpapdex-dsp.js `_synthRaw` from the mutation worklist's ranked list: it is the synthetic-night
fixture builder that the already-excluded `selfTest` consumes, and all three call sites are inside
selfTest. 19 survivors move to the reported SET-ASIDE set, where the reader can disagree with them.
