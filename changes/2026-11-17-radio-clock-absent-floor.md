---
bump: patch
type: fixed
brief: none
---

The radio-clock floor reader drops an anchor when the correction curve answers no value, and it no longer subtracts that value as 0. A floor with no window reports a `null` window count, not `-Infinity`. A step sequence with no span reports a `null` ratio, not 0.
