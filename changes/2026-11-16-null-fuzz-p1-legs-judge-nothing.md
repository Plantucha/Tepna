---
bump: patch
type: fixed
brief: none
---

Make the null fuzzer judge every projection key over an all-null night. Count the keys it cannot judge, and plant a P1 failure that proves the leg fires.
