---
bump: patch
type: fixed
brief: none
---

Retry the radio clock anchor enable when the adapter was still down at the first send. A service that lost this race after a boot recorded rows with no anchor until a restart.
