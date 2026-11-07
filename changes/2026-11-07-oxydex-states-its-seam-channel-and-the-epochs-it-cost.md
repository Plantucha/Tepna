---
bump: patch
type: fixed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

OxyDex refuses a five-minute epoch that straddles a recorded clock seam. It drops that epoch from the motion series and lists it in the export. The night card drew one bar per surviving epoch, so a refused epoch looked exactly like an unmeasured one.

The card now states the channel above every figure in it. A refusal names the count, the minute and the node's own token. A scan the node could not run reads UNKNOWN, because an unexamined channel is not a clean one.

A seam that cost no epoch still gets a line, since the whole-night means cross it. A measured zero stays silent, because a banner on every clean night teaches the reader to skip it.
