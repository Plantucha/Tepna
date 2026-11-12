---
bump: patch
type: fixed
brief: none
---

Read both of the Integrator's export routes in the surface gate. Its enumerator missed the `var _exp = {` slim-export literal. Ten keys reached the node-export with no declaration, and `confirmedApneaIndex` is one of them.
