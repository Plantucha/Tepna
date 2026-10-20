---
bump: patch
type: fixed
brief: none
---

`ble_visibility.visibility` tests the type of each persisted map instead of its truth, so a record whose `adapters`, adapter entry or `targets` is not a map no longer crashes the digest.
