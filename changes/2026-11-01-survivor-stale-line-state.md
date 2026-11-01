---
bump: patch
type: added
brief: none
---

The survivor ledger gains a stale-line state for an entry whose recorded line has grown under it. The closer reads today's source and refuses any other state, and the ratchet excludes the entry instead of counting it as open debt.
