---
bump: patch
type: fixed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---
The Mergify queue now waits 90 minutes for checks. The derived `auto` limit was 41 minutes. Mergify dequeued PR 5361 twice while its diff-scoped mutation job still ran. That job passed 2 minutes after the second dequeue.
