---
bump: patch
type: fixed
brief: none
---

The survivor ledger retires an entry whose mutated line is gone from the source. The close path checks that itself and refuses the flag on a line that is still there.
