---
bump: patch
type: fixed
brief: none
---

Let only the parent write `trio-batch-verdicts.json`, because each child rewrote it with its own one night. Report a run that judged nothing instead of crashing on it.
