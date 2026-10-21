---
bump: patch
type: fixed
brief: none
---

Deny a residue ledger read only for a row OPEN on disk and closed on the ref. The session that closes a row can read its own ledger.
