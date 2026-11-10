---
bump: patch
type: fixed
brief: none
---

Read the verdict guard off `ok` in the two Lomb-Scargle profilers. A `.length` read of a `validate` result is `undefined`, so the guard cannot fire.
