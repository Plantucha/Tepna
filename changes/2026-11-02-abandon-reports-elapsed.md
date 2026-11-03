---
bump: patch
type: fixed
brief: none
---

Report the measured elapsed time on an abandoned offline op, so a connect that gave up at its own
30 s bound no longer reads as a 300 s overrun.
