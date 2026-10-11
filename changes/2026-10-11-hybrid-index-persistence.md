---
bump: patch
type: added
brief: none
---

Add three user units so the local hybrid-search lane survives a reboot — a loopback-bound index server with `Restart=on-failure`, plus a reload service and timer that follow the hourly re-embed at `:20` rather than racing it — with a setup doc the owner enables from; restart survival is measured (54,180 documents in, 54,180 served after a kill, and a kNN query afterwards to prove the vectors persisted and not just the row count).
