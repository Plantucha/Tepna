---
bump: patch
type: fixed
brief: none
---

Skip the equivalence-ledger qualifier checks where the JS lane is absent. A mutation sandbox no longer reads this lane's own ledger under the JS lane's name.
