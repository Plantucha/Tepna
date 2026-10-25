---
bump: patch
type: fixed
brief: none
---

Stamp the ring's `clock_synced` from the GET_INFO read that agrees with the host, and record the unacknowledged 0xC0 clock write as its own `ring_rtc_push` fact.
