---
bump: patch
type: fixed
brief: none
---

The trio fold timer now commits the run ledger with the folded nights. Before, a successful fold left the ledger modified. The next run then stopped at its first step, and the timer stayed failed.
