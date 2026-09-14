<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: none
---
Read T95/T90 seconds from the exported `research.tIdx` on self-ingest instead of re-deriving them as `pct × durationMin × 60` — a sample-fraction times a wall-clock span, which hands every dropped second to time-below-95 (+25 % on a 20 %-dropout night).
