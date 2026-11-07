---
bump: patch
type: fixed
brief: none
---

The ntfy bridge closes a disk recovery in every domain. It keeps every escalation armed when it cannot parse the ack list. The escalation clock now starts at the publish time, and two alerts whose titles share 40 characters are two episodes.

The bridge now counts a merged sensor reopen. `board-nudge.sh` reads an unreadable status as unknown, not zero, and the board marks a capped PR count with a plus sign. The findings come from Muse's hunt, board #4267.
