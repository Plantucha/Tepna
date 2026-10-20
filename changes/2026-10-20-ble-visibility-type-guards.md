---
bump: patch
type: fixed
brief: none
---

`ble_visibility.visibility` now tests the type of each persisted map, not its truth. A record whose `adapters`, adapter entry or `targets` is not a map no longer crashes the digest.
