---
bump: patch
type: fixed
brief: none
---

Report the night population each trio-root run covers, and refuse a run that covered none. `tools/ecg-apnea-correlate.mjs`, `tools/deep-vlf-probe.mjs` and `tools/pb-agreement.mjs` now snapshot the root before the walk and again after it. Each publishes that comparison as a `corpus-population` verdict and names every offered night its read removed. `tools/corpus-scope.mjs` answers NOT_RUN for a readable root that offers no night, where it used to throw at its own caller.
