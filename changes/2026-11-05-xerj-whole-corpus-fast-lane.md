---
bump: patch
type: changed
brief: none
---

The search fast lane now upserts every changed repo and external file every 15 minutes, not only board posts.
A changed file loses its stale tail docs, and a file gone from the corpus loses its docs.
The hybrid-search generation rebuild moves from hourly to nightly at 03:20, so searches no longer stall each hour.
